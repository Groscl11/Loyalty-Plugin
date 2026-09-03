import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhookHmac } from '../_shared/shopify-hmac.ts';

// H-24: No CORS headers — Shopify server-to-server webhooks never send Origin.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GDPR: shop/redact
 * C-10: Erases PII from ALL 8 tables for all members of this shop/client.
 * Shopify sends this 48 days after a shop uninstalls the app.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('Method Not Allowed', { status: 405 });
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
    const { data: si } = await supabase.from('store_installations').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
    if (si) clientId = si.client_id;
    if (!clientId) {
      const { data: ic } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
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
      payload_summary: { shop_id: payload.shop_id, requested_at: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });

    if (!clientId) {
      return json({ success: true, message: 'Shop not found in our records' });
    }

    // Collect all member IDs for this client
    const { data: members } = await supabase.from('member_users').select('id').eq('client_id', clientId);
    let membersRedacted = 0;

    if (members && members.length > 0) {
      const memberIds = members.map((m: { id: string }) => m.id);
      const batchSize = 500;

      for (let i = 0; i < memberIds.length; i += batchSize) {
        const batch = memberIds.slice(i, i + batchSize);

        // ── 1. member_users ─────────────────────────────────────────────────────
        await supabase.from('member_users').update({
          email: `shop-redacted-${Date.now()}-${i}@gdpr.invalid`,
          first_name: '[Redacted]', last_name: '[Redacted]',
          phone: null, customer_id: null, date_of_birth: null, anniversary_date: null,
          updated_at: new Date().toISOString(),
        }).in('id', batch);

        // ── 2. loyalty_points_transactions ────────────────────────────────────
        await supabase.from('loyalty_points_transactions')
          .update({ description: '[Redacted per GDPR shop/redact]' })
          .in('member_user_id', batch);

        // ── 3. member_loyalty_status ─────────────────────────────────────────
        await supabase.from('member_loyalty_status')
          .update({ referral_code: null })
          .in('member_user_id', batch);

        // ── 4. C-10: shopify_orders ───────────────────────────────────────────
        await supabase.from('shopify_orders').update({
          customer_email: null,
          customer_phone: null,
          order_data: { redacted: true, reason: 'GDPR shop/redact' },
        }).in('member_id', batch);

        // ── 5. C-10: campaign_trigger_logs ────────────────────────────────────
        await supabase.from('campaign_trigger_logs').update({
          customer_email: null,
          customer_phone: null,
        }).in('member_id', batch).eq('client_id', clientId);

        // ── 6. C-10: member_referrals ─────────────────────────────────────────
        await supabase.from('member_referrals').update({
          referred_email: null,
          referred_phone: null,
        }).or(`referrer_member_id.in.(${batch.join(',')}),referred_member_id.in.(${batch.join(',')})`);

        // ── 7. C-10: campaign_tokens ──────────────────────────────────────────
        await supabase.from('campaign_tokens').update({
          email: null,
          phone: null,
        }).in('member_id', batch);

        // ── 8. C-10: communication_logs ───────────────────────────────────────
        await supabase.from('communication_logs').update({
          metadata: { redacted: true },
        }).in('member_id', batch).eq('client_id', clientId);

        membersRedacted += batch.length;
      }
    }

    // ── Mark store_installations as redacted (erase access_token) ─────────────
    await supabase.from('store_installations').update({
      installation_status: 'redacted',
      access_token: '[redacted]',
      shopify_access_token: '[redacted]',
      updated_at: new Date().toISOString(),
    }).eq('shop_domain', shopDomain);

    // ── Mark integration_configs as redacted ──────────────────────────────────
    await supabase.from('integration_configs').update({
      api_key: '[redacted]',
      webhook_secret: '[redacted]',
      updated_at: new Date().toISOString(),
    }).eq('shop_domain', shopDomain);

    // Update audit log
    await supabase.from('gdpr_audit_log').update({
      completed_at: new Date().toISOString(),
      data_summary: { members_redacted: membersRedacted, tables_cleared: 8, status: 'completed' },
    }).eq('event_type', 'shop/redact').eq('shop_domain', shopDomain)
      .order('created_at', { ascending: false }).limit(1);

    return json({ success: true, shop_domain: shopDomain, members_redacted: membersRedacted });

  } catch (err) {
    console.error('[shop-redact] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
