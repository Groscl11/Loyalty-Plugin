/**
 * Bulk reprocess unprocessed orders (1131-1145, excluding 1146 which was manually fixed)
 * These orders exist in shopify_orders but are missing:
 * - member_id linking
 * - member_loyalty_status records  
 * - loyalty_points_transactions records
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Orders to reprocess (1131-1145, excluding 1146)
const orderNumbers = [1131, 1132, 1133, 1135, 1136, 1137, 1138, 1139, 1141, 1142, 1143, 1144, 1145];

async function processOrder(orderNumber) {
  try {
    console.log(`\n📦 Processing order ${orderNumber}...`);

    // 1. Get order details
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

    // 2. Find or create member
    const { data: member, error: memberError } = await supabase
      .from('member_users')
      .select('id')
      .eq('email', order.customer_email)
      .eq('client_id', order.client_id)
      .single();

    if (memberError && memberError.code !== 'PGRST116') {
      console.error(`❌ Error finding member:`, memberError);
      return;
    }

    let memberId = member?.id;

    if (!memberId) {
      console.log(`   Creating new member...`);
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
    } else {
      console.log(`   Found existing member ${memberId}`);
    }

    // 3. Find or create loyalty status
    const { data: loyaltyProgram, error: programError } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('client_id', order.client_id)
      .single();

    if (programError) {
      console.error(`❌ Error finding loyalty program:`, programError);
      return;
    }

    const { data: loyaltyStatus, error: statusError } = await supabase
      .from('member_loyalty_status')
      .select('id')
      .eq('member_user_id', memberId)
      .eq('loyalty_program_id', loyaltyProgram.id)
      .single();

    let loyaltyStatusId = loyaltyStatus?.id;

    if (!loyaltyStatusId) {
      console.log(`   Creating loyalty status...`);
      // Get default tier
      const { data: tier, error: tierError } = await supabase
        .from('loyalty_tiers')
        .select('id')
        .eq('loyalty_program_id', loyaltyProgram.id)
        .eq('is_default', true)
        .single();

      if (tierError) {
        console.error(`❌ Error finding default tier:`, tierError);
        return;
      }

      const { data: newStatus, error: createStatusError } = await supabase
        .from('member_loyalty_status')
        .insert({
          member_user_id: memberId,
          loyalty_program_id: loyaltyProgram.id,
          current_tier_id: tier.id,
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
    } else {
      console.log(`   Found existing loyalty status ${loyaltyStatusId}`);
    }

    // 4. Get tier earning rates
    const { data: tierData, error: tierDataError } = await supabase
      .from('loyalty_tiers')
      .select('points_earn_rate, points_earn_divisor')
      .eq('loyalty_program_id', loyaltyProgram.id)
      .eq('is_default', true)
      .single();

    if (tierDataError) {
      console.error(`❌ Error getting tier data:`, tierDataError);
      return;
    }

    // 5. Calculate points
    const points = Math.floor((order.total_price / tierData.points_earn_divisor) * tierData.points_earn_rate);
    console.log(`   Calculated points: ${points}`);

    // 6. Check if transaction already exists
    const { data: existingTransaction, error: txError } = await supabase
      .from('loyalty_points_transactions')
      .select('id')
      .eq('member_loyalty_status_id', loyaltyStatusId)
      .eq('reference_id', `shopify_order_${orderNumber}`)
      .single();

    if (existingTransaction) {
      console.log(`   ✅ Transaction already exists, skipping points award`);
    } else {
      // 7. Create transaction
      console.log(`   Creating transaction...`);
      const { data: currentStatus, error: getStatusError } = await supabase
        .from('member_loyalty_status')
        .select('points_balance, lifetime_points_earned')
        .eq('id', loyaltyStatusId)
        .single();

      if (getStatusError) {
        console.error(`❌ Error getting current balance:`, getStatusError);
        return;
      }

      const newBalance = currentStatus.points_balance + points;
      const newLifetime = currentStatus.lifetime_points_earned + points;

      const { error: transactionError } = await supabase
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

      if (transactionError) {
        console.error(`❌ Error creating transaction:`, transactionError);
        return;
      }

      // 8. Update loyalty status balance
      const { error: updateError } = await supabase
        .from('member_loyalty_status')
        .update({
          points_balance: newBalance,
          lifetime_points_earned: newLifetime,
        })
        .eq('id', loyaltyStatusId);

      if (updateError) {
        console.error(`❌ Error updating balance:`, updateError);
        return;
      }

      console.log(`   ✅ Points awarded: ${points} (new balance: ${newBalance})`);
    }

    // 9. Link order to member
    const { error: linkError } = await supabase
      .from('shopify_orders')
      .update({ member_id: memberId })
      .eq('id', order.id);

    if (linkError) {
      console.error(`❌ Error linking order to member:`, linkError);
      return;
    }

    console.log(`✅ Order ${orderNumber} processed successfully`);
  } catch (error) {
    console.error(`❌ Unexpected error processing order ${orderNumber}:`, error);
  }
}

async function main() {
  console.log('🔄 Bulk reprocessing unprocessed orders...');
  console.log(`Orders to process: ${orderNumbers.join(', ')}`);

  for (const orderNumber of orderNumbers) {
    await processOrder(orderNumber);
  }

  console.log('\n✨ Bulk reprocessing complete!');
}

main().catch(console.error);
