/**
 * Referral Widget — Thank You Page
 * Shows referral link for logged-in customers.
 * Shows a login prompt for guests.
 */

import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  Banner,
  Button,
  BlockStack,
  Text,
  Link,
  useApi,
  useSettings,
} from '@shopify/ui-extensions-react/checkout';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension('purchase.thank-you.block.render', () => <ReferralWidget />);

function ReferralWidget() {
  const { order, shop } = useApi();
  const settings = useSettings();

  const [status, setStatus] = useState('loading');
  const [referralUrl, setReferralUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const rewardText = settings.referral_reward_text || 'bonus rewards';
  const customerEmail = order?.customer?.email;
  const shopDomain = shop?.myshopifyDomain;
  const loginUrl = `https://${shopDomain}/account/login`;

  useEffect(() => {
    if (!customerEmail) { setStatus('guest'); return; }
    loadReferral();
  }, []);

  async function loadReferral() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-loyalty-status?email=${encodeURIComponent(customerEmail)}&shop_domain=${encodeURIComponent(shopDomain)}`,
        { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const data = await res.json();
      if (data.referral_code) {
        setReferralUrl(`https://${shopDomain}?ref=${data.referral_code}`);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  }

  if (status === 'loading') return null;
  if (status === 'error') return null;

  if (status === 'guest') {
    return (
      <Banner status="warning">
        <BlockStack spacing="tight">
          <Text>
            <Link to={loginUrl} external>Login</Link>
            {` to view your referral link and earn ${rewardText} on every successful referral`}
          </Text>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <Banner status="info" title="Refer a Friend & Earn Rewards">
      <BlockStack spacing="base">
        <Text>
          Share your unique referral link and earn <Text emphasis="bold">{rewardText}</Text> for every friend who places an order!
        </Text>
        <BlockStack spacing="extraTight">
          <Text size="small" appearance="subdued">Your referral link:</Text>
          <Text size="small">{referralUrl}</Text>
        </BlockStack>
        <Button onPress={copyLink} kind="secondary">
          {copied ? 'Copied!' : 'Copy Referral Link'}
        </Button>
      </BlockStack>
    </Banner>
  );
}