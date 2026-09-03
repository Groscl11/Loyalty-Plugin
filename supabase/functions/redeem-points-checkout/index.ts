/**
 * redeem-points-checkout — Redeem-at-Checkout (write side, RESERVE model)
 *
 * Member reserves points for an instant discount on the current checkout.
 * Flow:
 *   1. Verify X-Widget-Token (member identity from token).
 *   2. Re-derive ALL caps server-side from the member's tier (never trust body):
 *      points_value, max_redemption_percent, max_redemption_points, available
 *      balance (net of other outstanding reserved holds).
 *   3. Clamp the requested points to those caps for this cart total.
 *   4. Create a SINGLE-USE, short-lived Shopify discount code (fixed amount).
 *   5. Insert a 'reserved' hold. NO points are deducted here.
 *   6. Return the code; the extension applies it to checkout.
 *
 * Points are deducted only when the order is PAID and the code was used —
 * finalized idempotently in shopify-order-webhook. Abandoned carts cost nothing.
 *
 * CORS: widget (reflects origin) — safe, token-gated.
 * POST { points_requested, cart_total }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getWidgetCorsHeaders } from '../_shared/cors.ts';
import { verifyWidgetToken } from '../_shared/widget-auth.ts';
import { decryptToken } from '../_shared/token-crypto.ts';

const HOLD_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function randomCode(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function clampRedemption(
  available: number, pointsValue: number, maxPercent: number,
  maxPoints: number | null, cartTotal: number, requested: number,
): { points: number; discount: number } {
  if (available <= 0 || pointsValue <= 0) return { points: 0, discount: 0 };
  let pts = Math.floor(Math.min(available, requested > 0 ? requested : available));
  if (maxPoints != null && maxPoints > 0) pts = Math.min(pts, Math.floor(maxPoints));
  if (cartTotal > 0 && maxPercent >= 0 && maxPercent < 100) {
    const maxPtsByPercent = Math.floor(((cartTotal * maxPercent) / 100) / pointsValue);
    pts = Math.min(pts, maxPtsByPercent);
  }
  if (cartTotal > 0) pts = Math.min(pts, Math.floor(cartTotal / pointsValue));
  if (pts < 1) return { points: 0, discount: 0 };
  const discount = Math.round(pts * pointsValue * 100) / 100;
  if (discount <= 0) return { points: 0, discount: 0 };
  return { points: pts, discount };
}

async function shopifyPost(shop: string, token: string, path: string, payload: unknown): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2025-01${path}`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.errors ? JSON.stringify(data.errors) : `Shopify ${path} → ${res.status}`);
  return data;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getWidgetCorsHeaders(req.headers.get('origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const claims = await verifyWidgetToken(req);
    if (!claims) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const requested = Math.floor(parseFloat(body.points_requested) || 0);
    const cartTotal = Math.max(0, parseFloat(body.cart_total) || 0);
    if (requested < 1) return json({ success: false, error: 'points_requested must be at least 1' }, 400);
    if (cartTotal <= 0) return json({ success: false, error: 'cart_total is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Program + redemption gate ────────────────────────────────────────────
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id, points_name, currency, allow_redemption')
      .eq('client_id', claims.cid)
      .eq('is_active', true)
      .maybeSingle();
    if (!program?.id) return json({ success: false, error: 'No active loyalty program' }, 400);
    if (program.allow_redemption === false) return json({ success: false, error: 'Redemption is not enabled' }, 403);

    // ── Member status ─────────────────────────────────────────────────────────
    const { data: status } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, current_tier_id')
      .eq('member_user_id', claims.mid)
      .eq('loyalty_program_id', program.id)
      .maybeSingle();
    if (!status?.id) return json({ success: false, error: 'Not a loyalty member' }, 403);

    // ── Tier caps (server-authoritative) ─────────────────────────────────────
    let pointsValue = 1, maxPercent = 100, maxPoints: number | null = null;
    if (status.current_tier_id) {
      const { data: tier } = await supabase
        .from('loyalty_tiers')
        .select('points_value, max_redemption_percent, max_redemption_points')
        .eq('id', status.current_tier_id)
        .maybeSingle();
      if (tier) {
        pointsValue = Number(tier.points_value) || 1;
        maxPercent = tier.max_redemption_percent != null ? Number(tier.max_redemption_percent) : 100;
        maxPoints = tier.max_redemption_points != null ? Number(tier.max_redemption_points) : null;
      }
    }

    // ── Available = balance − outstanding reserved holds ─────────────────────
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const { data: holds } = await supabase
      .from('point_redemption_holds')
      .select('points_reserved')
      .eq('member_loyalty_status_id', status.id)
      .eq('status', 'reserved')
      .gt('expires_at', nowIso);
    const outstanding = (holds || []).reduce((s, h) => s + (Number(h.points_reserved) || 0), 0);
    const available = Math.max(0, (status.points_balance || 0) - outstanding);

    const { points, discount } = clampRedemption(available, pointsValue, maxPercent, maxPoints, cartTotal, requested);
    if (points < 1 || discount <= 0) {
      return json({ success: false, error: 'No redeemable points for this order', available_points: available }, 400);
    }

    // ── Resolve shop + access token (authoritative, by client_id) ────────────
    const { data: installation } = await supabase
      .from('store_installations')
      .select('shop_domain, access_token')
      .eq('client_id', claims.cid)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (!installation?.access_token) return json({ success: false, error: 'Store not connected' }, 400);
    const shop = installation.shop_domain;
    const token = await decryptToken(installation.access_token);

    // ── Create single-use, short-lived Shopify discount code ─────────────────
    const code = `RHPTS-${randomCode(8)}`;
    const expiresIso = new Date(nowMs + HOLD_TTL_MS).toISOString();

    const priceRuleData = await shopifyPost(shop, token, '/price_rules.json', {
      price_rule: {
        title: `GoSelf Points Redemption (${code})`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'fixed_amount',
        value: String(-Math.abs(discount)),
        customer_selection: 'all',
        usage_limit: 1,                 // single-use: prevents code sharing
        once_per_customer: true,
        starts_at: nowIso,
        ends_at: expiresIso,            // expires with the hold
      },
    });
    const priceRuleId: number | undefined = priceRuleData.price_rule?.id;
    if (!priceRuleId) throw new Error('Failed to create Shopify price rule');

    await shopifyPost(shop, token, `/price_rules/${priceRuleId}/discount_codes.json`, {
      discount_code: { code },
    });

    // ── Reserve the hold (NO points deducted yet) ────────────────────────────
    const { error: holdErr } = await supabase.from('point_redemption_holds').insert({
      client_id: claims.cid,
      member_user_id: claims.mid,
      member_loyalty_status_id: status.id,
      shop_domain: shop,
      discount_code: code,
      shopify_price_rule_id: String(priceRuleId),
      points_reserved: points,
      discount_value: discount,
      currency: program.currency || 'INR',
      status: 'reserved',
      expires_at: expiresIso,
    });
    if (holdErr) {
      console.error('[redeem-points-checkout] hold insert failed:', holdErr.message);
      return json({ success: false, error: 'Could not reserve points' }, 500);
    }

    console.log(`[redeem-points-checkout] reserved ${points} pts (₹${discount}) code=${code} member=${claims.mid}`);

    return json({
      success: true,
      discount_code: code,
      points_to_redeem: points,
      discount_value: discount,
      currency: program.currency || 'INR',
      points_name: program.points_name || 'Points',
      available_after: available - points,
      expires_at: expiresIso,
    });
  } catch (err) {
    console.error('[redeem-points-checkout] error:', (err as Error).message);
    return json({ success: false, error: 'Internal server error' }, 500);
  }
});
