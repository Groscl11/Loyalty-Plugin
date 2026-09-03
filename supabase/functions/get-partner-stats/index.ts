import { createClient } from 'npm:@supabase/supabase-js@2';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return json({ error: 'Authorization required' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Validate the partner's JWT and extract their email
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return json({ error: 'Invalid session' }, 401);

  const partnerEmail = user.email.toLowerCase();

  const body = await req.json().catch(() => ({}));
  const { client_slug, days = 30 } = body as { client_slug: string; days?: number };

  if (!client_slug) return json({ error: 'client_slug required' }, 400);

  // Look up client by slug
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, logo_url, primary_color')
    .eq('slug', client_slug)
    .eq('is_active', true)
    .maybeSingle();

  if (clientError || !client) return json({ error: 'Client not found' }, 404);

  // Look up partner record
  const { data: partner, error: partnerError } = await supabase
    .from('affiliate_partners')
    .select('id, name, partner_type, status')
    .ilike('email', partnerEmail)
    .eq('client_id', client.id)
    .neq('status', 'archived')
    .maybeSingle();

  if (partnerError || !partner) {
    return json({ error: 'No partner account found for this email at this brand.' }, 403);
  }

  // Fetch code assignments
  const { data: codeAssignments = [] } = await supabase
    .from('affiliate_code_assignments')
    .select('id, code, discount_description, status, assigned_at, code_source')
    .eq('partner_id', partner.id)
    .eq('client_id', client.id)
    .neq('status', 'removed')
    .order('assigned_at', { ascending: false });

  // Fetch UTM links
  const { data: utmLinks = [] } = await supabase
    .from('attribution_utm_links')
    .select('id, slug, destination_url, utm_campaign, utm_medium, clicks, created_at')
    .eq('partner_id', partner.id)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });

  const activeCodes = new Set(
    (codeAssignments as any[])
      .filter((c: any) => c.status === 'active')
      .map((c: any) => (c.code as string).toUpperCase()),
  );

  // Orders converted by this partner — order_attribution is written by
  // shopify-order-webhook for EVERY order and already covers both coupon-code
  // redemptions and UTM-link conversions. Matching discount codes against
  // orders here would miss any partner tracked only via a UTM link, no coupon.
  const { data: attributionRows = [] } = await supabase
    .from('order_attribution')
    .select('shopify_order_id, order_revenue, converted_by, converted_coupon_code, lt_ref, created_at')
    .eq('client_id', client.id)
    .eq('converted_partner_id', partner.id)
    .order('created_at', { ascending: false });

  const shopifyOrderIds = (attributionRows as any[]).map(a => a.shopify_order_id);
  const { data: matchedOrders = [] } = shopifyOrderIds.length
    ? await supabase
        .from('shopify_orders')
        .select('shopify_order_id, processed_at')
        .eq('client_id', client.id)
        .in('shopify_order_id', shopifyOrderIds)
    : { data: [] };
  const processedAtByOrderId = new Map((matchedOrders as any[]).map(o => [o.shopify_order_id, o.processed_at]));

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const attributedOrders: { order_id: string; total_price: number; processed_at: string; matched_code: string; source: string }[] = (attributionRows as any[])
    .map(a => ({
      order_id: a.shopify_order_id,
      total_price: Number(a.order_revenue),
      processed_at: processedAtByOrderId.get(a.shopify_order_id) ?? a.created_at,
      matched_code: a.converted_by === 'coupon' ? a.converted_coupon_code : a.lt_ref,
      source: a.converted_by,
    }))
    .filter(o => new Date(o.processed_at).getTime() >= cutoffMs);

  const revenue = attributedOrders.reduce((s, o) => s + o.total_price, 0);
  const totalClicks = (utmLinks as any[]).reduce((s: number, l: any) => s + (l.clicks ?? 0), 0);

  return json({
    partner: {
      id: partner.id,
      name: partner.name,
      partner_type: partner.partner_type,
    },
    client: {
      name: client.name,
      logo_url: client.logo_url,
      primary_color: client.primary_color,
    },
    stats: {
      orders: attributedOrders.length,
      revenue,
      total_clicks: totalClicks,
      active_codes: activeCodes.size,
    },
    code_assignments: codeAssignments,
    utm_links: utmLinks,
    attributed_orders: attributedOrders.slice(0, 100),
    period_days: days,
  });
});
