const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function listAll() {
  console.log('\n📋 === ALL TABLES CONTENT ===\n');

  // List all with NO filters
  const { data: allInstalls, error: err1 } = await supabase
    .from('store_installations')
    .select('*');

  const { data: allConfigs, error: err2 } = await supabase
    .from('integration_configs')
    .select('*');

  const { data: allPrograms, error: err3 } = await supabase
    .from('loyalty_programs')
    .select('*');

  const { data: allMembers, error: err4 } = await supabase
    .from('member_users')
    .select('id, email, client_id')
    .limit(10);

  console.log('1️⃣ store_installations:');
  if (err1) console.error('   ❌ Error:', err1.message);
  else if (!allInstalls || allInstalls.length === 0) console.log('   ❌ Empty');
  else {
    console.log(`   ✅ ${allInstalls.length} record(s):`);
    allInstalls.forEach(s => {
      console.log(`      - ID: ${s.id}`);
      console.log(`        Shop ID: ${s.shop_id || s.shopify_shop_id || 'N/A'}`);
      console.log(`        Domain: ${s.shop_domain}`);
      console.log(`        Client: ${s.client_id}`);
    });
  }

  console.log('\n2️⃣ integration_configs:');
  if (err2) console.error('   ❌ Error:', err2.message);
  else if (!allConfigs || allConfigs.length === 0) console.log('   ❌ Empty');
  else {
    console.log(`   ✅ ${allConfigs.length} record(s):`);
    allConfigs.forEach(c => {
      console.log(`      - Domain: ${c.shop_domain}`);
      console.log(`        Client: ${c.client_id}`);
    });
  }

  console.log('\n3️⃣ loyalty_programs:');
  if (err3) console.error('   ❌ Error:', err3.message);
  else if (!allPrograms || allPrograms.length === 0) console.log('   ❌ Empty');
  else {
    console.log(`   ✅ ${allPrograms.length} record(s):`);
    allPrograms.forEach(p => {
      console.log(`      - Name: ${p.program_name}`);
      console.log(`        Client: ${p.client_id}`);
      console.log(`        Active: ${p.is_active}`);
    });
  }

  console.log('\n4️⃣ member_users (sample):');
  if (err4) console.error('   ❌ Error:', err4.message);
  else if (!allMembers || allMembers.length === 0) console.log('   ❌ Empty');
  else {
    console.log(`   ✅ ${allMembers.length} record(s):`);
    allMembers.forEach(m => {
      console.log(`      - Email: ${m.email}`);
      console.log(`        Client: ${m.client_id}`);
    });
  }

  console.log('\n✨ Done!\n');
}

listAll().catch(err => console.error('Fatal error:', err));
