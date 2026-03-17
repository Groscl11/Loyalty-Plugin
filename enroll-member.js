const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://lizgppzyyljqbmzdytia.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function enrollMember() {
  console.log("\n🔍 === ENROLL MEMBER IN LOYALTY PROGRAM ===\n");

  const memberId = "bc0ec915-5e22-4b9e-8191-95648ea10e44";
  const programId = "a1000000-0000-0000-0000-000000000001";
  const clientId = "67b1e417-ec9a-41a1-813a-78437a37adf6";

  // Get default tier for the program
  const { data: tiers, error: tierErr } = await supabase
    .from("loyalty_tiers")
    .select("id, tier_name, is_default")
    .eq("loyalty_program_id", programId)
    .eq("is_default", true);

  if (tierErr) {
    console.log("❌ Error fetching default tier:", tierErr.message);
    return;
  }

  const defaultTierId = tiers?.[0]?.id;
  const defaultTierName = tiers?.[0]?.tier_name;

  console.log(`1️⃣ Default Tier: ${defaultTierName} (${defaultTierId})`);

  if (!defaultTierId) {
    // If no default, use the first tier
    const { data: allTiers } = await supabase
      .from("loyalty_tiers")
      .select("id, tier_name")
      .eq("loyalty_program_id", programId)
      .limit(1);

    if (allTiers && allTiers.length > 0) {
      defaultTierId = allTiers[0].id;
      defaultTierName = allTiers[0].tier_name;
      console.log(`   (No default marked, using first tier): ${defaultTierName} (${defaultTierId})`);
    } else {
      console.log("❌ No tiers found for program!");
      return;
    }
  }

  // Create member_loyalty_status record
  const { data: inserted, error: insertErr } = await supabase
    .from("member_loyalty_status")
    .insert([
      {
        member_user_id: memberId,
        loyalty_program_id: programId,
        current_tier_id: defaultTierId,
        points_balance: 0,
        lifetime_points_earned: 0,
        lifetime_points_redeemed: 0,
        total_orders: 0,
        total_spend: 0,
        tier_achieved_at: new Date().toISOString(),
        referral_points_earned: 0,
      },
    ])
    .select();

  if (insertErr) {
    console.log("❌ Error creating enrollment:", insertErr.message);
    console.log("   Details:", insertErr);
    return;
  }

  console.log(`\n2️⃣ ✅ Enrollment Created!`);
  console.log(`   - Member: ${memberId}`);
  console.log(`   - Program: ${programId}`);
  console.log(`   - Tier: ${defaultTierName}`);
  console.log(`   - Initial Points: 0`);

  console.log("\n✨ Member is now enrolled! Points can be awarded on next transactions.\n");
}

enrollMember();
