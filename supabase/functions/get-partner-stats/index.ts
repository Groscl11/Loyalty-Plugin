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

  // Fetch attributed orders for date range
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders = [] } = await supabase
    .from('shopify_orders')
    .select('shopify_order_id, total_price, processed_at, order_data')
    .eq('client_id', client.id)
    .gte('processed_at', cutoff)
    .limit(10000);

  const activeCodes = new Set(
    (codeAssignments as any[])
      .filter((c: any) => c.status === 'active')
      .map((c: any) => (c.code as string).toUpperCase()),
  );

  // Attribute orders to this partner's codes
  const attributedOrders: { order_id: string; total_price: number; processed_at: string; matched_code: string }[] = [];
  for (const order of orders as any[]) {
    const discountCodes: { code: string }[] = order.order_data?.discount_codes ?? [];
    const match = discountCodes.find((d: any) => activeCodes.has((d.code as string).toUpperCase()));
    if (match) {
      attributedOrders.push({
        order_id: order.shopify_order_id,
        total_price: Number(order.total_price),
        processed_at: order.processed_at,
        matched_code: match.code,
      });
    }
  }

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
