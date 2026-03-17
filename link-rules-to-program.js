const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://lizgppzyyljqbmzdytia.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function linkRulesToProgram() {
  console.log("\n🔍 === LINK EARNING RULES TO PROGRAM ===\n");

  const clientId = "67b1e417-ec9a-41a1-813a-78437a37adf6";
  const programId = "a1000000-0000-0000-0000-000000000001";

  // Get all earning rules for this client that are NOT linked to a program
  const { data: rules, error: ruleErr } = await supabase
    .from("loyalty_earning_rules")
    .select("*")
    .eq("client_id", clientId)
    .is("loyalty_program_id", null);

  if (ruleErr) {
    console.log("❌ Error fetching rules:", ruleErr.message);
    return;
  }

  console.log(`1️⃣ Found ${rules?.length || 0} unlinked rules:\n`);
  rules?.forEach(r => {
    console.log(`   - ${r.rule_type}: ${r.points_reward}pts (${r.name})`);
  });

  if (!rules || rules.length === 0) {
    console.log("   All rules already linked!");
    return;
  }

  // Update all unlinked rules to be linked to the program
  const { error: updateErr, data: updated } = await supabase
    .from("loyalty_earning_rules")
    .update({ loyalty_program_id: programId })
    .eq("client_id", clientId)
    .is("loyalty_program_id", null)
    .select();

  if (updateErr) {
    console.log("\n❌ Error linking rules:", updateErr.message);
    return;
  }

  console.log(`\n2️⃣ ✅ Linked ${updated?.length || 0} rules to program ${programId}`);

  console.log("\n✨ Done! All earning rules are now linked to the program.\n");
}

linkRulesToProgram();
