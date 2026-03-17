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

    // Resolve client_id from shop_domain
    let resolvedClientId = client_id || null;
    const shopDomain = shop_domain || shop || null;

    if (shopDomain && !resolvedClientId) {
      const { data: inst } = await supabase
        .from('store_installations')
        .select('client_id')
        .eq('shop_domain', shopDomain)
        .eq('installation_status', 'active')
        .maybeSingle();
      resolvedClientId = inst?.client_id || null;
    }

    // Find member
    let memberQuery = supabase.from('member_users').select('id, client_id').eq('email', customer_email);
    if (resolvedClientId) memberQuery = memberQuery.eq('client_id', resolvedClientId);
    const { data: member } = await memberQuery.maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ success: true, rewards: [], vouchers: [], message: 'Member not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get available and redeemed vouchers
    const { data: vouchers } = await supabase
      .from('reward_vouchers')
      .select('voucher_code, status, expires_at, reward:rewards(title, description, discount_value, reward_type)')
      .eq('member_id', member.id)
      .in('status', ['available', 'redeemed'])
      .limit(20);

    // Get reward allocations
    const { data: allocations } = await supabase
      .from('member_rewards_allocation')
      .select('*, reward:rewards(title, description, discount_value, reward_type, generic_coupon_code)')
      .eq('member_id', member.id)
      .gt('quantity_allocated', 0);

    return new Response(
      JSON.stringify({
        success: true,
        member_id: member.id,
        vouchers: vouchers || [],
        rewards: allocations || [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('get-customer-rewards error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
