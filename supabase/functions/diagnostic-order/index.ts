import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const url = new URL(req.url);
    const orderNumber = url.searchParams.get('order') || '1135';
    const email = url.searchParams.get('email') || 'groscl.ltd+889999@gmail.com';

    console.log(`[diagnostic] Checking order ${orderNumber} for email ${email}`);

    // 1. Check order
    const { data: order, error: orderErr } = await supabase
      .from('shopify_orders')
      .select('order_number, customer_email, total_price, financial_status, created_at')
      .eq('order_number', parseInt(orderNumber))
      .eq('shop_domain', 'houmetest.myshopify.com')
      .maybeSingle();

    // 2. Check member
    const { data: member, error: memberErr } = await supabase
      .from('member_users')
      .select('id, email, created_at, client_id')
      .ilike('email', email)
      .maybeSingle();

    // 3. Check enrollment
    let enrollment = null;
    if (member) {
      const { data: enroll } = await supabase
        .from('member_loyalty_status')
        .select('id, points_balance, lifetime_points_earned, current_tier_id, created_at')
        .eq('member_user_id', member.id)
        .maybeSingle();
      enrollment = enroll;
    }

    // 4. Check tier
    let tier = null;
    if (enrollment?.current_tier_id) {
      const { data: tierData } = await supabase
        .from('loyalty_tiers')
        .select('id, tier_name, points_earn_rate, points_earn_divisor')
        .eq('id', enrollment.current_tier_id)
        .maybeSingle();
      tier = tierData;
    }

    // 5. Check transactions
    let transactions = [];
    if (member) {
      const { data: txns } = await supabase
        .from('loyalty_points_transactions')
        .select('id, points_amount, balance_after, description, created_at')
        .eq('member_user_id', member.id)
        .order('created_at', { ascending: false })
        .limit(10);
      transactions = txns || [];
    }

    // 6. Check webhook logs
    const { data: webhookLogs, error: webhookErr } = await supabase
      .from('webhook_logs')
      .select('id, event_type, status, error_message, created_at')
      .or(`payload->>'order_number'.eq.${orderNumber},payload->>'customer_email'.ilike.${email}`)
      .order('created_at', { ascending: false })
      .limit(10);

    // 7. Check edge function logs
    const { data: funcLogs } = await supabase
      .from('edge_function_logs')
      .select('id, function_slug, event_message, status_code, error_message, created_at')
      .eq('function_slug', 'shopify-order-webhook')
      .order('created_at', { ascending: false })
      .limit(10);

    const result = {
      timestamp: new Date().toISOString(),
      diagnostic: {
        order_exists: !!order,
        order_data: order,
        member_created: !!member,
        member_data: member,
        enrollment_created: !!enrollment,
        enrollment_data: enrollment,
        tier_data: tier,
        transactions: transactions,
        webhook_logs: webhookLogs || [],
        edge_function_logs: funcLogs || [],
      },
      summary: {
        step_1_order_received: !!order ? '✅ YES' : '❌ NO',
        step_2_member_created: !!member ? '✅ YES' : '❌ NO',
        step_3_enrollment_created: !!enrollment ? '✅ YES' : '❌ NO',
        step_4_tier_assigned: !!tier ? '✅ YES' : '❌ NO',
        step_5_points_awarded: transactions.length > 0 ? '✅ YES' : '❌ NO',
        overall_status: !order ? 'Order not received' : !member ? 'Member creation failed' : !enrollment ? 'Enrollment creation failed' : !tier ? 'Tier assignment failed' : transactions.length === 0 ? 'No points awarded' : 'SUCCESS',
      },
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[diagnostic] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
