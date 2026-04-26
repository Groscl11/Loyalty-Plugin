/**
 * get-customer-rewards
 * POST /get-customer-rewards { customer_email, shop_domain?, shop?, client_id? }
 *
 * Returns issued codes (offer_codes) and the available reward catalog
 * (offer_distributions JOIN rewards) for a member.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { customer_email, shop_domain, shop, client_id } = body;

    if (!customer_email) {
      return new Response(
        JSON.stringify({ success: false, error: 'customer_email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Resolve client_id ─────────────────────────────────────────────────────
    let resolvedClientId: string | null = client_id || null;
    const shopDomain = shop_domain || shop || null;

    if (shopDomain && !resolvedClientId) {
      const { data: si } = await supabase
        .from('store_installations')
        .select('client_id')
        .eq('shop_domain', shopDomain)
        .eq('installation_status', 'active')
        .maybeSingle();
      resolvedClientId = si?.client_id || null;

      if (!resolvedClientId) {
        const { data: ic } = await supabase
          .from('integration_configs')
          .select('client_id')
          .eq('shop_domain', shopDomain)
          .maybeSingle();
        resolvedClientId = ic?.client_id || null;
      }
    }

    // ── Find member ───────────────────────────────────────────────────────────
    let memberQuery = supabase
      .from('member_users')
      .select('id, client_id')
      .eq('email', customer_email.trim().toLowerCase());

    if (resolvedClientId) memberQuery = memberQuery.eq('client_id', resolvedClientId);

    const { data: member } = await memberQuery.maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ success: true, vouchers: [], rewards: [], message: 'Member not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveClientId = resolvedClientId || member.client_id;

    // ── Fetch issued codes from offer_codes ───────────────────────────────────
    const { data: issuedCodes } = await supabase
      .from('offer_codes')
      .select('id, code, status, expires_at, assigned_at, offer:rewards(id, title, description, discount_value, offer_type)')
      .eq('assigned_to_member_id', member.id)
      .in('status', ['assigned', 'used'])
      .limit(20);

    // ── Fetch available reward catalog via offer_distributions ─────────────────
    const { data: distributions } = await supabase
      .from('offer_distributions')
      .select('id, points_cost, offer:rewards(id, title, description, discount_value, offer_type, coupon_type, generic_coupon_code, is_active, status)')
      .eq('distributing_client_id', effectiveClientId)
      .eq('is_active', true);

    const activeRewards = (distributions ?? [])
      .filter((d: any) => d.offer?.is_active === true && d.offer?.status === 'active')
      .map((d: any) => ({
        id: d.offer.id,
        distribution_id: d.id,
        title: d.offer.title,
        description: d.offer.description,
        discount_value: d.offer.discount_value,
        offer_type: d.offer.offer_type,
        coupon_type: d.offer.coupon_type,
        generic_coupon_code: d.offer.coupon_type === 'generic' ? d.offer.generic_coupon_code : null,
        points_cost: d.points_cost,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        member_id: member.id,
        vouchers: issuedCodes ?? [],
        rewards: activeRewards,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('get-customer-rewards error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
