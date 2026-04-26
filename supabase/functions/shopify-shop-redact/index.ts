import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhookHmac } from '../_shared/shopify-hmac.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * GDPR: shop/redact
 * Shopify sends this 48 days after a shop uninstalls your app.
 * By this point all customer data for that shop must be deleted or anonymised.
 * We anonymise all member PII for the given client and mark the installation deleted.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';

    const isValid = await verifyWebhookHmac(rawBody, hmacHeader);
    if (!isValid) {
      console.error('[shop-redact] Invalid HMAC signature');
      return json({ error: 'Invalid webhook signature' }, 401);
    }

    const payload = JSON.parse(rawBody);
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || payload.myshopify_domain || '';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Resolve client_id — check both tables (installation may already be inactive)
    let clientId: string | null = null;

    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();
    if (si) clientId = si.client_id;

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shopDomain)
        .maybeSingle();
      if (ic) clientId = ic.client_id;
    }

    // Log the shop redact request
    await supabase.from('gdpr_audit_log').insert({
      event_type: 'shop/redact',
      shop_domain: shopDomain,
      client_id: clientId,
      shopify_customer_id: null,
      customer_email: null,
      orders_requested: [],
      payload_summary: {
        shop_id: payload.shop_id,
        requested_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    if (!clientId) {
      // Shop not found — nothing to redact, respond 200 so Shopify doesn't retry
      return json({ success: true, message: 'Shop not found in our records' });
    }

    // ── Step 1: Anonymise all member PII for this client ─────────────────────
    const { data: members } = await supabase
      .from('member_users')
      .select('id')
      .eq('client_id', clientId);

    let membersRedacted = 0;

    if (members && members.length > 0) {
      const memberIds = members.map((m: { id: string }) => m.id);
      const batchSize = 500;

      for (let i = 0; i < memberIds.length; i += batchSize) {
        const batch = memberIds.slice(i, i + batchSize);

        await supabase
          .from('member_users')
          .update({
            email: `shop-redacted-${Date.now()}-${i}@gdpr.invalid`,
            first_name: '[Redacted]',
            last_name: '[Redacted]',
            phone: null,
            customer_id: null,
            date_of_birth: null,
            anniversary_date: null,
            updated_at: new Date().toISOString(),
          })
          .in('id', batch);

        await supabase
          .from('loyalty_points_transactions')
          .update({ description: '[Redacted per GDPR shop/redact]' })
          .in('member_user_id', batch);

        await supabase
          .from('member_loyalty_status')
          .update({ referral_code: null })
          .in('member_user_id', batch);

        membersRedacted += batch.length;
      }
    }

    // ── Step 2: Mark store_installations as redacted ─────────────────────────
    await supabase
      .from('store_installations')
      .update({
        installation_status: 'redacted',
        access_token: '[redacted]',
        updated_at: new Date().toISOString(),
      })
      .eq('shop_domain', shopDomain);

    // ── Step 3: Mark integration_configs as redacted ─────────────────────────
    await supabase
      .from('integration_configs')
      .update({
        api_key: '[redacted]',
        webhook_secret: '[redacted]',
        updated_at: new Date().toISOString(),
      })
      .eq('shop_domain', shopDomain);

    // Update audit log with completion
    await supabase
      .from('gdpr_audit_log')
      .update({
        completed_at: new Date().toISOString(),
        data_summary: {
          members_redacted: membersRedacted,
          status: 'completed',
        },
      })
      .eq('event_type', 'shop/redact')
      .eq('shop_domain', shopDomain)
      .order('created_at', { ascending: false })
      .limit(1);

    return json({
      success: true,
      shop_domain: shopDomain,
      members_redacted: membersRedacted,
    });

  } catch (err) {
    console.error('[shop-redact] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
