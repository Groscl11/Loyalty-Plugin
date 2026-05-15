import React, { useState, useEffect } from 'react';
import { reactExtension, BlockStack, InlineStack, Text, Button, Link, Heading, Divider, useCustomer, useShop, useOrder, useSettings, useTotalAmount } from '@shopify/ui-extensions-react/customer-account';

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

export default reactExtension('customer-account.order-status.block.render', () => <OrderStatusWidget />);

function OrderStatusWidget() {
  const customer = useCustomer();
  const shop = useShop();
  const order = useOrder();
  const settings = useSettings();
  const totalAmount = useTotalAmount();
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const email = customer && customer.email ? customer.email : '';
  const shopDomain = shop && shop.myshopifyDomain ? shop.myshopifyDomain : '';
  const orderId = order && order.id ? String(order.id).split('/').pop() : '';
  const projectId = settings && settings.supabase_project_id ? settings.supabase_project_id : 'lizgppzyyljqbmzdytia';
  const supabaseCfg = SUPABASE_CONFIGS[projectId] || SUPABASE_CONFIGS['lizgppzyyljqbmzdytia'];
  const SUPABASE_URL = supabaseCfg.url;
  const SUPABASE_ANON_KEY = supabaseCfg.key;

  // Fetch loyalty points status
  useEffect(function() {
    if (!email || !shopDomain) { setLoading(false); return; }
    fetch(
      SUPABASE_URL + '/functions/v1/get-loyalty-status?email=' + encodeURIComponent(email) + '&shop_domain=' + encodeURIComponent(shopDomain),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    ).then(function(r) { return r.json(); }).then(function(data) {
      setLoyaltyData(data); setLoading(false);
    }).catch(function() { setLoading(false); });
  }, [email, shopDomain]);

  var earnRate = loyaltyData && loyaltyData.tier && loyaltyData.tier.points_earn_rate != null ? loyaltyData.tier.points_earn_rate : 1;
  var earnDivisor = loyaltyData && loyaltyData.tier && loyaltyData.tier.points_earn_divisor != null ? loyaltyData.tier.points_earn_divisor : 1;
  var orderTotal = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;
  var pointsEarned = earnDivisor > 0 ? Math.floor((orderTotal / earnDivisor) * earnRate) : 0;
  var pointsName = loyaltyData && loyaltyData.program && loyaltyData.program.points_name ? loyaltyData.program.points_name : 'Points';
  var referralCode = loyaltyData && loyaltyData.referral_code;
  var referralUrl = referralCode ? 'https://' + shopDomain + '/discount/' + referralCode + '?ref=loyalty' : null;
  var rewardText = settings && settings.referral_reward_text ? settings.referral_reward_text : '15% Off Coupon';
  var headingText = settings && settings.heading_text ? settings.heading_text : 'Points Earned on This Order';

  function handleCopy() {
    if (!referralUrl) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'Shop and save!', text: 'Use my referral link to get ' + rewardText + ':', url: referralUrl }).catch(function() {});
      return;
    }
    try {
      navigator.clipboard.writeText(referralUrl).then(function() {
        setCopied(true); setTimeout(function() { setCopied(false); }, 2500);
      }).catch(execCopy);
    } catch(e) { execCopy(); }
  }
  function execCopy() {
    try {
      var el = document.createElement('textarea');
      el.value = referralUrl; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
      setCopied(true); setTimeout(function() { setCopied(false); }, 2500);
    } catch(e) {}
  }

  var shareMsg = referralUrl ? encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl) : '';

  return (
    <BlockStack spacing='base'>
      {!loading && loyaltyData && (
        <BlockStack spacing='tight'>
          <Divider />
          <Heading level={2}>{headingText}</Heading>
          <Text size='large' emphasis='bold'>{pointsEarned} {pointsName}</Text>
          <Text appearance='subdued'>{pointsName} will be rewarded once order is fulfilled</Text>
        </BlockStack>
      )}
      {!loading && loyaltyData && referralUrl && (
        <BlockStack spacing='tight'>
          <Divider />
          <Heading level={3}>Refer a Friend &amp; Earn {rewardText}</Heading>
          <Text appearance='subdued'>Gift your friends {rewardText} and earn 100 {pointsName} once their order is fulfilled!</Text>
          <Text size='small' appearance='subdued'>{referralUrl}</Text>
          <Link to={'https://wa.me/?text=' + shareMsg} external>
            <Button kind='primary'>Share on WhatsApp</Button>
          </Link>
          <InlineStack spacing='base'>
            <Link to={'https://twitter.com/intent/tweet?text=' + shareMsg} external><Button kind='secondary'>X (Twitter)</Button></Link>
            <Link to={'https://mail.google.com/mail/?view=cm&body=' + shareMsg} external><Button kind='secondary'>Gmail</Button></Link>
            <Link to={'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(referralUrl)} external><Button kind='secondary'>Facebook</Button></Link>
          </InlineStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}
