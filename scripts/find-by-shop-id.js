const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function findByShopId() {
  const shopId = '71356907699';
  const email = 'groscl.ltd+8809@gmail.com';

  console.log('\n🔍 === DEBUGGING WITH SHOP ID ===\n');

  // 1. Find shop by ID
  console.log(`1️⃣ Looking for shop_id: ${shopId}`);
  const { data: shops } = await supabase
    .from('store_installations')
    .select('*')
    .eq('shopify_shop_id', shopId);

  if (!shops || shops.length === 0) {
    console.log('   ❌ Not found by shopify_shop_id');
    
    // Try shop_id column
    const { data: shops2 } = await supabase
      .from('store_installations')
      .select('*')
      .eq('shop_id', shopId);
    
    if (!shops2 || shops2.length === 0) {
      console.log('   ❌ Not found by shop_id either');
    } else {
      console.log(`   ✅ Found by shop_id:`);
      shops2.forEach(s => {
        console.log(`      - Domain: ${s.shop_domain}`);
        console.log(`      - Client: ${s.client_id}`);
        console.log(`      - Status: ${s.installation_status}`);
      });
      await checkClient(shops2[0].client_id, email);
    }
  } else {
    console.log(`   ✅ Found by shopify_shop_id: ${shops.length} record(s)`);
    shops.forEach(s => {
      console.log(`      - Domain: ${s.shop_domain}`);
      console.log(`      - Client: ${s.client_id}`);
      console.log(`      - Status: ${s.installation_status}`);
    });
    if (shops.length > 0) {
      await checkClient(shops[0].client_id, email);
    }
  }
}

async function checkClient(clientId, email) {
  console.log(`\n2️⃣ Checking client: ${clientId}`);
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check programs
  const { data: programs } = await supabase
    .from('loyalty_programs')
    .select('*')
    .eq('client_id', clientId);

  console.log(`   Programs: ${programs?.length || 0}`);
  if (programs && programs.length > 0) {
    programs.forEach(p => {
      console.log(`      - ${p.program_name} (Active: ${p.is_active}, ID: ${p.id})`);
    });
  }

  // Check current user's client
  const { data: member } = await supabase
    .from('member_users')
    .select('client_id')
    .eq('email', email)
    .maybeSingle();

  console.log(`\n3️⃣ User "${email}" client: ${member?.client_id || 'N/A'}`);
  
  if (member && member.client_id !== clientId) {
    console.log(`   ⚠️  MISMATCH! User is on client "${member.client_id}" but shop is on "${clientId}"`);
    console.log(`   🔧 FIX: User needs to be linked to client "${clientId}"`);
    
    // Show that client's programs
    const { data: userClientPrograms } = await supabase
      .from('loyalty_programs')
      .select('*')
      .eq('client_id', member.client_id);
    
    console.log(`\n   User's current client has ${userClientPrograms?.length || 0} program(s)`);
  } else if (member && member.client_id === clientId) {
    console.log(`   ✅ User is correctly linked to this client`);
  }
}

findByShopId().catch(err => console.error('Fatal error:', err));
