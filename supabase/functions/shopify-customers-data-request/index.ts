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
 * GDPR: customers/data_request
 * Shopify calls this when a customer requests a copy of their data.
 * We must respond 200 quickly; actual data delivery is done out-of-band (email/portal).
 * Here we log the request in a dedicated audit table.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';

    const isValid = await verifyWebhookHmac(rawBody, hmacHeader);
    if (!isValid) {
      console.error('[customers-data-request] Invalid HMAC signature');
      return json({ error: 'Invalid webhook signature' }, 401);
    }

    const payload = JSON.parse(rawBody);
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Resolve client_id from shop_domain
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

    // Log the GDPR data request for audit purposes
    await supabase.from('gdpr_audit_log').insert({
      event_type: 'customers/data_request',
      shop_domain: shopDomain,
      client_id: clientId,
      shopify_customer_id: payload.customer?.id?.toString() || null,
      customer_email: payload.customer?.email || null,
      orders_requested: payload.orders_requested || [],
      payload_summary: {
        data_request_id: payload.data_request?.id,
        requested_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    // Data held about this customer (for operator reference)
    const customerEmail = payload.customer?.email;
    if (customerEmail && clientId) {
      const { data: member } = await supabase
        .from('member_users')
        .select('id, email, first_name, last_name, phone, created_at')
        .eq('email', customerEmail.trim().toLowerCase())
        .eq('client_id', clientId)
        .maybeSingle();

      if (member) {
        const { data: loyaltyStatus } = await supabase
          .from('member_loyalty_status')
          .select('points_balance, lifetime_points_earned, lifetime_points_redeemed, created_at')
          .eq('member_user_id', member.id)
          .maybeSingle();

        const { data: transactions } = await supabase
          .from('loyalty_points_transactions')
          .select('transaction_type, points_amount, description, created_at')
          .eq('member_user_id', member.id)
          .order('created_at', { ascending: false });

        // Update audit log with data summary (non-PII count)
        await supabase
          .from('gdpr_audit_log')
          .update({
            data_summary: {
              has_member_record: true,
              transaction_count: transactions?.length || 0,
              has_loyalty_status: !!loyaltyStatus,
            },
          })
          .eq('event_type', 'customers/data_request')
          .eq('shop_domain', shopDomain)
          .eq('customer_email', customerEmail.trim().toLowerCase())
          .order('created_at', { ascending: false })
          .limit(1);
      }
    }

    // Shopify requires a 200 response within 5 seconds
    return json({ success: true });

  } catch (err) {
    console.error('[customers-data-request] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
