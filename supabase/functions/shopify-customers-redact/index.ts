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
 * GDPR: customers/redact
 * Shopify calls this when a customer requests deletion of their personal data.
 * We anonymise all PII fields but keep transaction records (financial obligation).
 * Points balances and transaction amounts are retained without identifying info.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';

    const isValid = await verifyWebhookHmac(rawBody, hmacHeader);
    if (!isValid) {
      console.error('[customers-redact] Invalid HMAC signature');
      return json({ error: 'Invalid webhook signature' }, 401);
    }

    const payload = JSON.parse(rawBody);
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Resolve client_id
    let clientId: string | null = null;
    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shopDomain)
      .eq('installation_status', 'active')
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

    // Log the redact request for compliance audit
    await supabase.from('gdpr_audit_log').insert({
      event_type: 'customers/redact',
      shop_domain: shopDomain,
      client_id: clientId,
      shopify_customer_id: payload.customer?.id?.toString() || null,
      customer_email: payload.customer?.email || null,
      orders_requested: payload.orders_to_redact || [],
      payload_summary: {
        data_request_id: payload.data_request?.id,
        requested_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    const customerEmail = payload.customer?.email;
    if (!customerEmail) {
      return json({ success: true, message: 'No customer email — nothing to redact' });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();

    // Find the member record(s) matching this customer
    let memberQuery = supabase
      .from('member_users')
      .select('id')
      .eq('email', normalizedEmail);

    if (clientId) memberQuery = memberQuery.eq('client_id', clientId);

    const { data: members } = await memberQuery;

    if (!members || members.length === 0) {
      return json({ success: true, message: 'No member record found — nothing to redact' });
    }

    const memberIds = members.map((m: { id: string }) => m.id);

    // ── Anonymise member_users PII ───────────────────────────────────────────
    // Replace all PII with anonymised placeholders; keep the row for FK integrity
    await supabase
      .from('member_users')
      .update({
        email: `redacted-${Date.now()}@gdpr.invalid`,
        first_name: '[Redacted]',
        last_name: '[Redacted]',
        phone: null,
        customer_id: null,
        date_of_birth: null,
        anniversary_date: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', memberIds);

    // ── Scrub PII from loyalty transactions description field ─────────────────
    // Retain amounts and types for financial records; remove any descriptive PII
    await supabase
      .from('loyalty_points_transactions')
      .update({ description: '[Redacted per GDPR]' })
      .in('member_user_id', memberIds);

    // ── Remove referral_code (personally identifiable link) ──────────────────
    await supabase
      .from('member_loyalty_status')
      .update({ referral_code: null })
      .in('member_user_id', memberIds);

    // Update audit log with completion
    await supabase
      .from('gdpr_audit_log')
      .update({
        completed_at: new Date().toISOString(),
        data_summary: {
          members_redacted: memberIds.length,
          status: 'completed',
        },
      })
      .eq('event_type', 'customers/redact')
      .eq('shop_domain', shopDomain)
      .eq('customer_email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1);

    return json({ success: true, members_redacted: memberIds.length });

  } catch (err) {
    console.error('[customers-redact] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
