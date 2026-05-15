import React, { useState, useEffect } from 'react';
import { reactExtension, BlockStack, Text, Divider, Banner, useShop, useSettings, useEmail, useTotalAmount } from '@shopify/ui-extensions-react/checkout';

// Supabase config map — keyed by project ID (set via extension setting supabase_project_id).
// Default key 'lizgppzyyljqbmzdytia' = production; 'jblqyvicxhmqqjhostcj' = staging.
const SUPABASE_CONFIGS = {
  'lizgppzyyljqbmzdytia': {
    url: 'https://lizgppzyyljqbmzdytia.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0',
  },
  'jblqyvicxhmqqjhostcj': {
    url: 'https://jblqyvicxhmqqjhostcj.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE',
  },
};

export default reactExtension('purchase.thank-you.block.render', () => <PointsEarnedWidget />);

function PointsEarnedWidget() {
  let shop, settings, hookEmail, totalAmount;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { hookEmail = useEmail(); } catch(e) { hookEmail = ''; }
  try { totalAmount = useTotalAmount(); } catch(e) { totalAmount = null; }

  const shopDomain = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const headingText = settings && settings.heading_text ? settings.heading_text : 'Rewards Earned on This Order';
  const projectId = settings && settings.supabase_project_id ? settings.supabase_project_id : 'jblqyvicxhmqqjhostcj';
  const supabaseCfg = SUPABASE_CONFIGS[projectId] || SUPABASE_CONFIGS['jblqyvicxhmqqjhostcj'];
  const SUPABASE_URL = supabaseCfg.url;
  const SUPABASE_ANON_KEY = supabaseCfg.key;
  const orderTotal = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;

  // isMember: null = still loading, false = not a member / API failed, true = member found
  const [isMember, setIsMember] = useState(null);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [pointsName, setPointsName] = useState('Points');
  const [pointsBalance, setPointsBalance] = useState(0);

  // Try to enrich display with member data — widget always renders regardless of outcome
  useEffect(function() {
    if (!shopDomain || !customerEmail) {
      setIsMember(false);
      return;
    }
    fetch(
      SUPABASE_URL + '/functions/v1/get-loyalty-status?email=' + encodeURIComponent(customerEmail) + '&shop_domain=' + encodeURIComponent(shopDomain),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    ).then(function(r) { return r.json(); }).then(function(data) {
      if (data && !data.error && data.points_balance != null) {
        var rate    = data.tier && data.tier.points_earn_rate    != null ? data.tier.points_earn_rate    : 1;
        var divisor = data.tier && data.tier.points_earn_divisor != null ? data.tier.points_earn_divisor : 1;
        var name    = data.program && data.program.points_name   ? data.program.points_name : 'Points';
        setEstimatedPoints(divisor > 0 ? Math.floor((orderTotal / divisor) * rate) : 0);
        setPointsName(name);
        setPointsBalance(data.points_balance || 0);
        setIsMember(true);
      } else {
        setIsMember(false);
      }
    }).catch(function() { setIsMember(false); });
  }, [customerEmail, shopDomain, orderTotal]);

  // Always render — the widget shows regardless of loyalty status.
  // isMember===null means the API call is still in-flight; show generic message.
  return (
    <BlockStack spacing='base'>
      <Divider />
      {isMember === true ? (
        // Existing member: show personalised points earned + running total
        <BlockStack spacing='tight'>
          <Text size='small' appearance='subdued'>{headingText}</Text>
          <Text size='large' emphasis='bold'>+{estimatedPoints} {pointsName} on this order 🎉</Text>
          <Text size='small' appearance='subdued'>
            Your new balance after fulfilment: {pointsBalance + estimatedPoints} {pointsName}
          </Text>
          <Text size='small' appearance='subdued'>
            {pointsName} are credited once your order is fulfilled.
          </Text>
        </BlockStack>
      ) : (
        // Non-member or API pending/failed: always show a CTA to join / earn
        <Banner title='You could be earning rewards on this order!'>
          <BlockStack spacing='tight'>
            <Text>
              Join our loyalty programme and earn {pointsName} on every purchase — redeemable for exclusive discounts.
            </Text>
            {shopDomain ? (
              <Text size='small'>
                {'Sign up or log in at https://' + shopDomain + '/account/login'}
              </Text>
            ) : null}
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}
