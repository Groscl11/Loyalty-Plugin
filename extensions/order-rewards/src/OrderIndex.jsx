import React, { useState, useEffect } from 'react';
import { reactExtension, BlockStack, InlineStack, Text, Button, Link, Heading, Divider, useCustomer, useShop, useSettings } from '@shopify/ui-extensions-react/customer-account';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension('customer-account.order-index.block.render', () => <OrderIndexWidget />);

function OrderIndexWidget() {
  const customer = useCustomer();
  const shop = useShop();
  const settings = useSettings();
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const email = customer && customer.email ? customer.email : '';
  const shopDomain = shop && shop.myshopifyDomain ? shop.myshopifyDomain : '';

  useEffect(function() {
    if (!email || !shopDomain) { setLoading(false); return; }
    fetch(
      SUPABASE_URL + '/functions/v1/get-loyalty-status?email=' + encodeURIComponent(email) + '&shop_domain=' + encodeURIComponent(shopDomain),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    ).then(function(r) { return r.json(); }).then(function(data) {
      setLoyaltyData(data); setLoading(false);
    }).catch(function() { setLoading(false); });
  }, [email, shopDomain]);

  if (loading || !loyaltyData) return null;

  var points = loyaltyData.points_balance != null ? loyaltyData.points_balance : 0;
  var tier = loyaltyData.tier && loyaltyData.tier.name ? loyaltyData.tier.name : 'Member';
  var pointsName = loyaltyData.program && loyaltyData.program.points_name ? loyaltyData.program.points_name : 'Points';
  var referralCode = loyaltyData.referral_code;
  var referralUrl = referralCode ? 'https://' + shopDomain + '/discount/' + referralCode + '?ref=loyalty' : null;
  var rewardText = settings && settings.referral_reward_text ? settings.referral_reward_text : '15% Off Coupon';

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

  var shareMsg = encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl);

  return (
    <BlockStack spacing='base'>
      <Divider />
      <BlockStack spacing='tight'>
        <Heading level={2}>Your Loyalty {pointsName}</Heading>
        <InlineStack spacing='base' blockAlignment='center'>
          <Text size='large' emphasis='bold'>{points} {pointsName}</Text>
          <Text appearance='subdued'>{tier} Tier</Text>
        </InlineStack>
      </BlockStack>
      {referralUrl && (
        <BlockStack spacing='tight'>
          <Divider />
          <Heading level={3}>Refer a Friend &amp; Earn {rewardText}</Heading>
          <Text appearance='subdued'>Gift your friends {rewardText} and earn 100 {pointsName} once their order is fulfilled!</Text>
          <Text size='small' appearance='subdued'>{referralUrl}</Text>
          <Link to={'https://wa.me/?text=' + shareMsg} external>Share via WhatsApp</Link>
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
