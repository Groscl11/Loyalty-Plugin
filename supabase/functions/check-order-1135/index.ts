import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  console.log('[DIAGNOSTIC] Starting Order #1135 diagnostic...');

  try {
    // 1. Check order
    console.log('[DIAGNOSTIC] Checking order 1135...');
    const { data: order, error: orderErr } = await supabase
      .from('shopify_orders')
      .select('*')
      .eq('order_number', 1135)
      .eq('shop_domain', 'houmetest.myshopify.com')
      .single()
      .catch(() => ({ data: null, error: null }));

    console.log('[DIAGNOSTIC] Order check:', order ? 'FOUND' : 'NOT FOUND');

    // 2. Check member
    console.log('[DIAGNOSTIC] Checking member...');
    const { data: member } = await supabase
      .from('member_users')
      .select('*')
      .ilike('email', '%889999%')
      .single()
      .catch(() => ({ data: null }));

    console.log('[DIAGNOSTIC] Member check:', member ? 'FOUND' : 'NOT FOUND');

    // 3. Check enrollment
    let enrollment = null;
    if (member) {
      console.log('[DIAGNOSTIC] Checking enrollment...');
      const { data: enroll } = await supabase
        .from('member_loyalty_status')
        .select('*')
        .eq('member_user_id', member.id)
        .single()
        .catch(() => ({ data: null }));

      enrollment = enroll;
      console.log('[DIAGNOSTIC] Enrollment check:', enrollment ? 'FOUND' : 'NOT FOUND');
    }

    // 4. Check transactions
    let transactions = null;
    if (member) {
      console.log('[DIAGNOSTIC] Checking transactions...');
      const { data: txns } = await supabase
        .from('loyalty_points_transactions')
        .select('*')
        .eq('member_user_id', member.id)
        .order('created_at', { ascending: false })
        .limit(5)
        .catch(() => ({ data: [] }));

      transactions = txns || [];
      console.log('[DIAGNOSTIC] Found', transactions.length, 'transactions');
    }

    // 5. Check webhook logs
    console.log('[DIAGNOSTIC] Checking webhook logs...');
    const { data: logs } = await supabase
      .from('webhook_logs')
      .select('*')
      .or(`payload->>'order_number'.eq.1135,payload->>'customer_email'.ilike.%889999%`)
      .order('created_at', { ascending: false })
      .limit(10)
      .catch(() => ({ data: [] }));

    console.log('[DIAGNOSTIC] Found', logs?.length || 0, 'webhook logs');

    // Build result
    const diagnostic = {
      timestamp: new Date().toISOString(),
      checks: {
        step1_order_exists: !!order,
        step2_member_created: !!member,
        step3_enrollment_created: !!enrollment,
        step4_transactions_awarded: (transactions?.length || 0) > 0,
      },
      data: {
        order: order ? {
          order_number: order.order_number,
          customer_email: order.customer_email,
          total_price: order.total_price,
          financial_status: order.financial_status,
        } : null,
        member: member ? {
          id: member.id,
          email: member.email,
          created_at: member.created_at,
        } : null,
        enrollment: enrollment ? {
          id: enrollment.id,
          points_balance: enrollment.points_balance,
          current_tier_id: enrollment.current_tier_id,
          created_at: enrollment.created_at,
        } : null,
        transactions: transactions ? transactions.map(t => ({
          id: t.id,
          points_amount: t.points_amount,
          description: t.description,
          created_at: t.created_at,
        })) : [],
        webhook_logs: logs ? logs.map(l => ({
          id: l.id,
          event_type: l.event_type,
          status: l.status,
          error_message: l.error_message,
          created_at: l.created_at,
        })) : [],
      },
      summary: {
        status: !order ? 'FAIL: Order not in database' 
                : !member ? 'FAIL: Member not auto-created'
                : !enrollment ? 'FAIL: Enrollment not created'
                : transactions && transactions.length === 0 ? 'PARTIAL: Enrolled but no points'
                : 'SUCCESS: All checks passed',
      },
    };

    return new Response(JSON.stringify(diagnostic, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[DIAGNOSTIC] Error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      stack: (error as Error).stack,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
