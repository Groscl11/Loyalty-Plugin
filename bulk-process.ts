#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Bulk reprocess unprocessed orders
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const orderNumbers = [1131, 1132, 1133, 1135, 1136, 1137, 1138, 1139, 1141, 1142, 1143, 1144, 1145];

async function processOrder(orderNumber) {
  try {
    console.log(`\n📦 Processing order ${orderNumber}...`);

    const { data: order, error: orderError } = await supabase
      .from('shopify_orders')
      .select('*')
      .eq('order_number', orderNumber)
      .single();

    if (orderError || !order) {
      console.error(`❌ Order ${orderNumber} not found:`, orderError);
      return;
    }

    console.log(`   Order total: ${order.total_price} INR`);

    // Find or create member
    const { data: existingMembers } = await supabase
      .from('member_users')
      .select('id')
      .eq('email', order.customer_email)
      .eq('client_id', order.client_id);

    let memberId;
    if (existingMembers && existingMembers.length > 0) {
      memberId = existingMembers[0].id;
      console.log(`   Found existing member: ${memberId}`);
    } else {
      const { data: newMember, error: createError } = await supabase
        .from('member_users')
        .insert({
          email: order.customer_email,
          client_id: order.client_id,
          full_name: order.customer_name || 'Guest',
          is_active: true,
        })
        .select('id')
        .single();

      if (createError) {
        console.error(`❌ Error creating member:`, createError);
        return;
      }
      memberId = newMember.id;
      console.log(`   Created new member: ${memberId}`);
    }

    // Get loyalty program
    const { data: programs } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('client_id', order.client_id);

    if (!programs || programs.length === 0) {
      console.error(`❌ No loyalty program found`);
      return;
    }
    const programId = programs[0].id;

    // Find or create loyalty status
    const { data: statuses } = await supabase
      .from('member_loyalty_status')
      .select('id')
      .eq('member_user_id', memberId)
      .eq('loyalty_program_id', programId);

    let loyaltyStatusId;
    if (statuses && statuses.length > 0) {
      loyaltyStatusId = statuses[0].id;
      console.log(`   Found existing loyalty status: ${loyaltyStatusId}`);
    } else {
      const { data: tiers } = await supabase
        .from('loyalty_tiers')
        .select('id')
        .eq('loyalty_program_id', programId)
        .eq('is_default', true);

      const tierId = tiers?.[0]?.id;

      const { data: newStatus, error: createStatusError } = await supabase
        .from('member_loyalty_status')
        .insert({
          member_user_id: memberId,
          loyalty_program_id: programId,
          current_tier_id: tierId,
          points_balance: 0,
          lifetime_points_earned: 0,
        })
        .select('id')
        .single();

      if (createStatusError) {
        console.error(`❌ Error creating loyalty status:`, createStatusError);
        return;
      }
      loyaltyStatusId = newStatus.id;
      console.log(`   Created loyalty status: ${loyaltyStatusId}`);
    }

    // Get tier earning rates
    const { data: tierData } = await supabase
      .from('loyalty_tiers')
      .select('points_earn_rate, points_earn_divisor')
      .eq('loyalty_program_id', programId)
      .eq('is_default', true)
      .single();

    const points = Math.floor((order.total_price / tierData.points_earn_divisor) * tierData.points_earn_rate);
    console.log(`   Calculated points: ${points}`);

    // Check if transaction exists
    const { data: existingTx } = await supabase
      .from('loyalty_points_transactions')
      .select('id')
      .eq('member_loyalty_status_id', loyaltyStatusId)
      .eq('reference_id', `shopify_order_${orderNumber}`);

    if (existingTx && existingTx.length > 0) {
      console.log(`   ✅ Transaction already exists`);
    } else {
      const { data: currentStatus } = await supabase
        .from('member_loyalty_status')
        .select('points_balance, lifetime_points_earned')
        .eq('id', loyaltyStatusId)
        .single();

      const newBalance = currentStatus.points_balance + points;
      const newLifetime = currentStatus.lifetime_points_earned + points;

      await supabase
        .from('loyalty_points_transactions')
        .insert({
          member_loyalty_status_id: loyaltyStatusId,
          member_user_id: memberId,
          transaction_type: 'earned',
          points_amount: points,
          balance_after: newBalance,
          reference_id: `shopify_order_${orderNumber}`,
          reference_type: 'shopify_order',
        });

      await supabase
        .from('member_loyalty_status')
        .update({
          points_balance: newBalance,
          lifetime_points_earned: newLifetime,
        })
        .eq('id', loyaltyStatusId);

      console.log(`   ✅ Points awarded: ${points}`);
    }

    // Link order to member
    await supabase
      .from('shopify_orders')
      .update({ member_id: memberId })
      .eq('id', order.id);

    console.log(`✅ Order ${orderNumber} processed`);
  } catch (error) {
    console.error(`❌ Error processing order ${orderNumber}:`, error);
  }
}

async function main() {
  console.log('🔄 Bulk reprocessing orders: ' + orderNumbers.join(', '));

  for (const orderNumber of orderNumbers) {
    await processOrder(orderNumber);
  }

  console.log('\n✨ Complete!');
}

main().catch(console.error);
