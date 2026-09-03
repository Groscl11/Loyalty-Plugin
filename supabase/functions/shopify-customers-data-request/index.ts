import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhookHmac } from '../_shared/shopify-hmac.ts';

// H-24: No CORS headers — Shopify server-to-server webhook, never called from browser.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GDPR: customers/data_request
 * H-08: Responds to Shopify within 5s, queues the data export in
 * gdpr_data_requests for asynchronous merchant notification.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('Method Not Allowed', { status: 405 });
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

    // Resolve client_id and merchant contact email
    let clientId: string | null = null;
    let merchantEmail: string | null = null;

    const { data: si } = await supabase
      .from('store_installations').select('client_id, shop_email')
      .eq('shop_domain', shopDomain).maybeSingle();
    if (si) { clientId = si.client_id; merchantEmail = si.shop_email; }

    if (!clientId) {
      const { data: ic } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
      if (ic) clientId = ic.client_id;
    }

    // Log to gdpr_audit_log
    await supabase.from('gdpr_audit_log').insert({
      event_type: 'customers/data_request',
      shop_domain: shopDomain,
      client_id: clientId,
      shopify_customer_id: payload.customer?.id?.toString() || null,
      customer_email: payload.customer?.email || null,
      orders_requested: payload.orders_requested || [],
      payload_summary: { data_request_id: payload.data_request?.id, requested_at: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });

    // ── H-08: Queue the data export for asynchronous fulfilment ──────────────
    const customerEmail = payload.customer?.email;
    if (customerEmail && clientId) {
      let transactionCount = 0;
      let hasMember = false;

      const { data: member } = await supabase
        .from('member_users').select('id')
        .eq('email', customerEmail.trim().toLowerCase()).eq('client_id', clientId).maybeSingle();

      if (member) {
        hasMember = true;
        const { count } = await supabase
          .from('loyalty_points_transactions').select('id', { count: 'exact', head: true })
          .eq('member_user_id', member.id);
        transactionCount = count ?? 0;
      }

      // Insert into delivery queue (gdpr_data_requests table created by migration)
      await supabase.from('gdpr_data_requests').insert({
        shop_domain: shopDomain,
        client_id: clientId,
        shopify_customer_id: payload.customer?.id?.toString() || null,
        customer_email: customerEmail.trim().toLowerCase(),
        shopify_data_request_id: payload.data_request?.id?.toString() || null,
        merchant_contact_email: merchantEmail,
        status: 'pending',
        data_summary: {
          has_member_record: hasMember,
          transaction_count: transactionCount,
          requested_at: new Date().toISOString(),
        },
        requested_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }).then(() => {}).catch((err: Error) => {
        console.warn('[customers-data-request] gdpr_data_requests insert failed:', err.message);
      });
    }

    // Shopify requires 200 within 5 seconds
    return json({ success: true });

  } catch (err) {
    console.error('[customers-data-request] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
