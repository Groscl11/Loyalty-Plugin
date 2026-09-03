import React, { useState, useEffect, useCallback } from 'react';
import {
  reactExtension,
  BlockStack, InlineStack,
  Text, Banner, Button, SkeletonText,
  useShop, useEmail, useTotalAmount,
  useApplyDiscountCodeChange, useDiscountCodes,
  useExtensionEditor, useSettings,
} from '@shopify/ui-extensions-react/checkout';

const _env = (function () { try { return process.env || {}; } catch (e) { return {}; } })();
const SUPABASE_URL      = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

export default reactExtension('purchase.checkout.block.render', () => <RedeemPoints />);

function authHeaders(extra) {
  return Object.assign({
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  }, extra || {});
}

function RedeemPoints() {
  let shop, hookEmail, totalAmount, applyDiscount, discountCodes, editor, settings;
  try { shop          = useShop();                    } catch (e) { shop          = null; }
  try { hookEmail     = useEmail();                   } catch (e) { hookEmail     = ''; }
  try { totalAmount   = useTotalAmount();             } catch (e) { totalAmount   = null; }
  try { applyDiscount = useApplyDiscountCodeChange(); } catch (e) { applyDiscount = null; }
  try { discountCodes = useDiscountCodes();           } catch (e) { discountCodes = []; }
  try { editor        = useExtensionEditor();         } catch (e) { editor        = null; }
  try { settings      = useSettings();                } catch (e) { settings      = null; }

  const isEditor      = !!editor;
  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const orderTotal    = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;

  const headingText = settings && settings.heading_text ? settings.heading_text : 'Redeem your points';
  const tone        = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'info';
  const alignment   = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';
  const validTone   = ['success', 'info', 'warning'].indexOf(tone) !== -1 ? tone : 'info';
  const validAlign  = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';

  const [token, setToken]     = useState(null);
  const [opts, setOpts]       = useState(null);   // null=loading, false=not redeemable
  const [applied, setApplied] = useState(null);   // {code, points, discount, currency, name}
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  // 1. Issue widget token once we have email + shop
  useEffect(function () {
    if (isEditor || !shopDomain || !customerEmail) { setOpts(false); return; }
    let cancelled = false;
    fetch(SUPABASE_URL + '/functions/v1/issue-widget-token', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ email: customerEmail, shop_domain: shopDomain }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!cancelled) { if (d && d.token) setToken(d.token); else setOpts(false); } })
      .catch(function () { if (!cancelled) setOpts(false); });
    return function () { cancelled = true; };
  }, [shopDomain, customerEmail, isEditor]);

  // 2. Fetch redeem options (recompute when cart total changes)
  useEffect(function () {
    if (!token || !shopDomain || orderTotal <= 0) return;
    let cancelled = false;
    fetch(SUPABASE_URL + '/functions/v1/get-redeem-options', {
      method: 'POST', headers: authHeaders({ 'X-Widget-Token': token }),
      body: JSON.stringify({ shop_domain: shopDomain, cart_total: orderTotal }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled) return;
        if (d && d.redeemable && d.max_redeemable_points > 0) setOpts(d);
        else setOpts(false);
      })
      .catch(function () { if (!cancelled) setOpts(false); });
    return function () { cancelled = true; };
  }, [token, shopDomain, orderTotal]);

  // 3. Detect external removal of our applied code (e.g. customer removed it)
  useEffect(function () {
    if (!applied) return;
    var codes = (discountCodes || []).map(function (c) { return (c.code || '').toUpperCase(); });
    if (codes.indexOf(applied.code.toUpperCase()) === -1) setApplied(null);
  }, [discountCodes]);

  const redeem = useCallback(function (points) {
    if (!token || !shopDomain || busy) return;
    setBusy(true); setError('');
    fetch(SUPABASE_URL + '/functions/v1/redeem-points-checkout', {
      method: 'POST', headers: authHeaders({ 'X-Widget-Token': token }),
      body: JSON.stringify({ shop_domain: shopDomain, points_requested: points, cart_total: orderTotal }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success || !d.discount_code) { setError((d && d.error) || 'Could not redeem points.'); setBusy(false); return; }
        if (!applyDiscount) { setError('Discounts are not available on this checkout.'); setBusy(false); return; }
        return applyDiscount({ type: 'addDiscountCode', code: d.discount_code }).then(function (res) {
          if (res && res.type === 'success') {
            setApplied({ code: d.discount_code, points: d.points_to_redeem, discount: d.discount_value, currency: d.currency, name: d.points_name });
          } else {
            setError((res && res.message) || 'Could not apply the discount. Please try again.');
          }
          setBusy(false);
        });
      })
      .catch(function () { setError('Something went wrong. Please try again.'); setBusy(false); });
  }, [token, shopDomain, orderTotal, busy, applyDiscount]);

  const remove = useCallback(function () {
    if (!applied || !applyDiscount || busy) return;
    setBusy(true);
    applyDiscount({ type: 'removeDiscountCode', code: applied.code })
      .then(function () { setApplied(null); setBusy(false); })
      .catch(function () { setApplied(null); setBusy(false); });
  }, [applied, applyDiscount, busy]);

  // ── Editor preview ──────────────────────────────────────────────────────────
  if (isEditor) {
    return (
      <Banner status={validTone} title={headingText}>
        <BlockStack spacing="tight" inlineAlignment={validAlign}>
          <Text>You have 500 Points (worth ₹500)</Text>
          <Button kind="primary">Redeem 200 Points → ₹200 off</Button>
        </BlockStack>
      </Banner>
    );
  }

  if (opts === null && token) {
    return <SkeletonText />;
  }
  if (!opts) return null; // not a member / nothing redeemable / guest

  const cur  = function (n) { return (opts.currency === 'INR' ? '₹' : (opts.currency + ' ')) + Number(n).toLocaleString(); };
  const name = opts.points_name || 'Points';

  // ── Applied state ─────────────────────────────────────────────────────────
  if (applied) {
    return (
      <Banner status="success" title="Points applied">
        <BlockStack spacing="tight" inlineAlignment={validAlign}>
          <Text>
            You redeemed {applied.points.toLocaleString()} {name} for {cur(applied.discount)} off this order. 🎉
          </Text>
          <Button kind="plain" onPress={remove} loading={busy}>Remove</Button>
        </BlockStack>
      </Banner>
    );
  }

  // ── Offer state ─────────────────────────────────────────────────────────────
  const maxPts  = opts.max_redeemable_points;
  const maxDisc = opts.max_discount_value;
  const halfPts = Math.floor(maxPts / 2);

  return (
    <Banner status={validTone} title={headingText}>
      <BlockStack spacing="tight" inlineAlignment={validAlign}>
        <Text>
          You have {opts.available_points.toLocaleString()} {name}
          {opts.points_value ? ' (worth ' + cur(Math.round(opts.available_points * opts.points_value)) + ')' : ''}.
        </Text>
        {error ? <Text appearance="critical">{error}</Text> : null}
        <InlineStack spacing="base">
          <Button kind="primary" onPress={function () { redeem(maxPts); }} loading={busy}>
            Redeem {maxPts.toLocaleString()} {name} → {cur(maxDisc)} off
          </Button>
          {halfPts >= 1 && halfPts < maxPts ? (
            <Button kind="secondary" onPress={function () { redeem(halfPts); }} loading={busy}>
              Use {halfPts.toLocaleString()}
            </Button>
          ) : null}
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
