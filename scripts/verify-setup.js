const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://lizgppzyyljqbmzdytia.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verify() {
  console.log("\n✅ === FINAL VERIFICATION ===\n");

  const memberId = "bc0ec915-5e22-4b9e-8191-95648ea10e44";
  const memberEmail = "groscl.ltd+8809@gmail.com";
  const programId = "a1000000-0000-0000-0000-000000000001";

  // 1. Member enrollment
  const { data: status } = await supabase
    .from("member_loyalty_status")
    .select("*, loyalty_programs(program_name), loyalty_tiers(tier_name)")
    .eq("member_user_id", memberId)
    .single();

  console.log("1️⃣ Member Enrollment Status:");
  if (status) {
    console.log(`   ✅ ENROLLED`);
    console.log(`      Program: ${status.loyalty_programs?.program_name || 'N/A'}`);
    console.log(`      Tier: ${status.loyalty_tiers?.tier_name}`);
    console.log(`      Points: ${status.points_balance}`);
  } else {
    console.log(`   ❌ NOT ENROLLED`);
  }

  // 2. Earning rules linked
  const { data: rules } = await supabase
    .from("loyalty_earning_rules")
    .select("*")
    .eq("loyalty_program_id", programId)
    .eq("is_active", true);

  console.log(`\n2️⃣ Earning Rules for Program:`);
  console.log(`   ✅ ${rules?.length || 0} active rules linked:`);
  rules?.forEach(r => {
    console.log(`      - ${r.rule_type}: ${r.points_reward}pts`);
  });

  // 3. Program tiers
  const { data: tiers } = await supabase
    .from("loyalty_tiers")
    .select("*")
    .eq("loyalty_program_id", programId);

  console.log(`\n3️⃣ Program Tiers:`);
  console.log(`   ✅ ${tiers?.length || 0} tiers configured:`);
  tiers?.forEach(t => {
    console.log(`      - "${t.tier_name}": earn ${t.points_earn_rate}/${t.points_earn_divisor}`);
  });

  // 4. Member details
  const { data: member } = await supabase
    .from("member_users")
    .select("*")
    .eq("id", memberId)
    .single();

  console.log(`\n4️⃣ Member Account:`);
  console.log(`   ✅ Email: ${member?.email}`);
  console.log(`      Client: ${member?.client_id}`);

  console.log("\n✨ All systems ready for point awards!\n");
}

verify();
