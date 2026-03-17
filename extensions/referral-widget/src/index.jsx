import React, { useState, useEffect } from 'react';
import { reactExtension, Banner, Button, BlockStack, InlineStack, Text, Link, useShop, useSettings, useEmail } from '@shopify/ui-extensions-react/checkout';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension('purchase.thank-you.block.render', () => <ReferralWidget />);

function ReferralWidget() {
  let shop, settings, hookEmail;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { hookEmail = useEmail(); } catch(e) { hookEmail = ''; }

  const shopDomain = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const rewardText = settings && settings.referral_reward_text ? settings.referral_reward_text : '15% Off Coupon';

  const [referralUrl, setReferralUrl] = useState('');
  const [memberLoaded, setMemberLoaded] = useState(false);

  useEffect(function() {
    if (!shopDomain || !customerEmail) return;
    fetch(
      SUPABASE_URL + '/functions/v1/get-loyalty-status?email=' + encodeURIComponent(customerEmail) + '&shop_domain=' + encodeURIComponent(shopDomain),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    ).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.referral_code) {
        setReferralUrl('https://' + shopDomain + '?ref=' + data.referral_code);
        setMemberLoaded(true);
      }
    }).catch(function() {});
  }, [customerEmail, shopDomain]);

  function copyLink() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'Shop and save!', text: 'Use my referral link to get ' + rewardText + ':', url: referralUrl }).catch(function() {});
      return;
    }
    try {
      navigator.clipboard.writeText(referralUrl).then(function() {
        setCopied(true);
        setTimeout(function() { setCopied(false); }, 2500);
      }).catch(execCopy);
    } catch(e) { execCopy(); }
  }
  function execCopy() {
    try {
      var el = document.createElement('textarea');
      el.value = referralUrl; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true); setTimeout(function() { setCopied(false); }, 2500);
    } catch(e) {}
  }

  if (memberLoaded) {
    return (
      <Banner status='success' title='Refer a Friend and Earn Rewards'>
        <BlockStack spacing='base'>
          <Text>Gift your friends a <Text emphasis='bold'>{rewardText}</Text> and get 100 Points once their order is fulfilled!</Text>
          <BlockStack spacing='extraTight'>
            <Text size='small' appearance='subdued'>Your referral link:</Text>
            <Text size='small'>{referralUrl}</Text>
          </BlockStack>
          <Link to={'https://wa.me/?text=' + encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl)} external>
            <Button kind='primary'>Share on WhatsApp</Button>
          </Link>
          <InlineStack spacing='base'>
            <Link to={'https://twitter.com/intent/tweet?text=' + encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl)} external><Button kind='secondary'>X (Twitter)</Button></Link>
            <Link to={'https://mail.google.com/mail/?view=cm&body=' + encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl)} external><Button kind='secondary'>Gmail</Button></Link>
            <Link to={'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(referralUrl)} external><Button kind='secondary'>Facebook</Button></Link>
          </InlineStack>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <Banner status='warning' title='Refer a Friend'>
      <BlockStack spacing='tight'>
        <Text>Login to view your referral link and earn {rewardText} on every successful referral</Text>
        {shopDomain ? <Text size='small'>{'Login at https://' + shopDomain + '/account/login'}</Text> : null}
      </BlockStack>
    </Banner>
  );
}
