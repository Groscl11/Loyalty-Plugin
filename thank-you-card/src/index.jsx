/**
 * Thank You Card - Checkout UI Extension
 * Shopify 2024-2025 Compliant
 *
 * Renders on Order Status (Thank You) page ONLY
 * NO manual script injection
 * Installed via: Checkout Settings → Customize → Order Status Page
 */

import React, { useEffect, useState } from 'react';
import {
  reactExtension,
  Banner,
  Button,
  Text,
  BlockStack,
  useApi,
  useSettings,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension('purchase.thank-you.block.render', () => <ThankYouCard />);

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

function ThankYouCard() {
  const { query, extensionPoint } = useExtensionApi();
  const settings = useSettings();
  const translate = useTranslate();
  const [rewardData, setRewardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const widgetId = settings.widget_id;

  useEffect(() => {
    if (!widgetId) {
      setLoading(false);
      return;
    }

    fetchRewardData();
  }, [widgetId]);

  async function fetchRewardData() {
    try {
      // Get comprehensive order and shop data from Shopify context
      const orderData = await query(
        `query {
          order {
            id
            totalPrice {
              amount
            }
            subtotalPrice {
              amount
              currencyCode
            }
            lineItems {
              id
              title
              quantity
              variant {
                id
                title
                sku
                price {
                  amount
                }
                product {
                  id
                  productType
                }
              }
            }
            shippingAddress {
              address1
              address2
              city
              province
              provinceCode
              country
              countryCode
              zip
              phone
            }
            billingAddress {
              address1
              address2
              city
              province
              provinceCode
              country
              countryCode
              zip
            }
            customer {
              id
              email
              phone
            }
            discountApplications {
              value {
                ... on PricingPercentageValue {
                  percentage
                }
                ... on MoneyValue {
                  amount {
                    amount
                  }
                }
              }
            }
          }
          shop {
            myshopifyDomain
          }
        }`
      );

      if (!orderData?.data?.order) {
        setLoading(false);
        return;
      }

      const order = orderData.data.order;
      const shopDomain = orderData.data.shop?.myshopifyDomain;

      // Build comprehensive order payload
      const orderPayload = {
        order_id: order.id,
        order_value: parseFloat(order.totalPrice?.amount || 0),
        currency: order.subtotalPrice?.currencyCode || 'USD',
        customer_email: order.customer?.email,
        customer_phone: order.customer?.phone || order.shippingAddress?.phone,
        shipping_address: order.shippingAddress ? {
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2,
          city: order.shippingAddress.city,
          province: order.shippingAddress.province,
          country: order.shippingAddress.country,
          zip: order.shippingAddress.zip,
        } : undefined,
        billing_address: order.billingAddress ? {
          address1: order.billingAddress.address1,
          address2: order.billingAddress.address2,
          city: order.billingAddress.city,
          province: order.billingAddress.province,
          country: order.billingAddress.country,
          zip: order.billingAddress.zip,
        } : undefined,
        line_items: order.lineItems?.map(item => ({
          product_id: item.variant?.product?.id,
          variant_id: item.variant?.id,
          title: item.title,
          quantity: item.quantity,
          price: parseFloat(item.variant?.price?.amount || 0),
          sku: item.variant?.sku,
          product_type: item.variant?.product?.productType,
        })),
        shop_domain: shopDomain,
      };

      // Use get-order-reward-link with retry (webhook may still be processing)
      const orderId = order.id?.toString().replace('gid://shopify/Order/', '');
      const customerEmail = order?.customer?.email;
      if (!orderId || !customerEmail) { setLoading(false); return; }

      const tryFetch = async (attempt = 0) => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-order-reward-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: orderId,
            customer_email: customerEmail,
            shop_domain: shopDomain,
          }),
        });
        const data = await res.json();
        if (data.has_rewards) {
          setRewardData(data);
          setLoading(false);
        } else if (data.reason === 'not_yet' && attempt < 5) {
          setTimeout(() => tryFetch(attempt + 1), 2000);
        } else {
          setLoading(false);
        }
      };
      await tryFetch();
    } catch (err) {
      console.error('Thank you card error:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  if (loading) {
    return null;
  }

  if (!rewardData?.has_rewards) return null;

  const rewardCount = rewardData.rewards?.length || 0;

  return (
    <BlockStack spacing="base">
      <Banner
        status="success"
        title={`🎁 You've earned ${rewardCount} reward${rewardCount !== 1 ? 's' : ''}!`}
      >
        <BlockStack spacing="base">
          <Text>Thank you for your purchase! Your rewards are ready to claim.</Text>
          {rewardData.rewards?.slice(0, 3).map((r, i) => (
            <Text key={i} size="small" appearance="subdued">• {r.title || r.campaign_name}</Text>
          ))}
          <Button kind="primary" to={rewardData.redemption_url}>
            Claim Rewards →
          </Button>
        </BlockStack>
      </Banner>
    </BlockStack>
  );
}
