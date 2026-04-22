const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkAndEnrollUser() {
  const email = 'groscl.ltd+8809@gmail.com';
  const shopDomain = 'houmetest.myshopify.com';
  
  console.log('\n🔄 === ENROLLING USER IN LOYALTY PROGRAM ===\n');

  // 1. Get the member
  const { data: member } = await supabase
    .from('member_users')
    .select('id, client_id')
    .eq('email', email)
    .maybeSingle();

  if (!member) {
    console.log('❌ Member not found');
    return;
  }

  console.log(`✅ Found member: ${member.id}`);

  // 2. Get the client
  const { data: client } = await supabase
    .from('integration_configs')
    .select('client_id, shop_domain')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!client && member.client_id) {
    console.log(`ℹ️  client_id from member: ${member.client_id}`);
  }

  const clientId = client?.client_id || member.client_id;

  // 3. Check loyalty program
  console.log(`\n🔍 Checking loyalty program for client ${clientId}...`);
  const { data: program } = await supabase
    .from('loyalty_programs')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle();

  if (!program) {
    console.log('❌ No active loyalty program for this client');
    return;
  }

  console.log(`✅ Found program: ${program.program_name}`);
  console.log(`   - Welcome bonus: ${program.welcome_bonus_points} pts`);

  // 4. Check default tier
  const { data: tier } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .eq('loyalty_program_id', program.id)
    .eq('is_default', true)
    .maybeSingle();

  if (!tier) {
    console.log('❌ No default tier for this program');
    return;
  }

  console.log(`✅ Found tier: ${tier.tier_name}`);
  console.log(`   - Earn rate: ${tier.points_earn_rate} per ${tier.points_earn_divisor}`);

  // 5. Manually create loyalty status (since enrollment may have failed)
  console.log('\n📝 Creating loyalty status for member...');
  
  const welcomePoints = program.welcome_bonus_points || 0;
  
  const { data: newStatus, error: createErr } = await supabase
    .from('member_loyalty_status')
    .insert({
      member_user_id: member.id,
      loyalty_program_id: program.id,
      current_tier_id: tier.id,
      points_balance: welcomePoints,
      lifetime_points_earned: welcomePoints,
      lifetime_points_redeemed: 0,
      total_orders: 0,
      total_spend: 0,
    })
    .select()
    .single();

  if (createErr) {
    if (createErr.message.includes('duplicate')) {
      console.log('ℹ️  Loyalty status already exists (duplicate)');
    } else {
      console.error('❌ Error creating loyalty status:', createErr.message);
    }
    return;
  }

  console.log(`✅ Created loyalty status: ${newStatus.id}`);

  // 6. Award welcome bonus points
  if (welcomePoints > 0) {
    console.log(`\n💰 Awarding welcome bonus: ${welcomePoints} pts`);
    
    const { error: txnErr } = await supabase
      .from('loyalty_points_transactions')
      .insert({
        member_loyalty_status_id: newStatus.id,
        member_user_id: member.id,
        transaction_type: 'bonus',
        points_amount: welcomePoints,
        balance_after: welcomePoints,
        description: 'Welcome bonus - Enrollment',
      });

    if (txnErr) {
      console.error('❌ Error creating welcome bonus transaction:', txnErr.message);
    } else {
      console.log('✅ Welcome bonus transaction created');
    }
  }

  console.log('\n✨ Enrollment complete!\n');
}

checkAndEnrollUser().catch(err => console.error('Fatal error:', err));
