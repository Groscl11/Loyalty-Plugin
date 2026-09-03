/**
 * get-redeem-options — Redeem-at-Checkout (read side)
 *
 * Returns everything the checkout extension needs to render the
 * "redeem your points" control, computed server-side from the member's tier:
 *   - available_points  = points_balance − outstanding reserved holds
 *   - points_value      (₹ per point, from the member's current tier)
 *   - max_redemption_percent / max_redemption_points (tier caps)
 *   - max_redeemable_points + max_discount_value for THIS cart total
 *
 * Auth: X-Widget-Token (member identity from token, never from body).
 * CORS: widget (reflects origin) — safe, token-gated.
 *
 * POST { shop_domain, cart_total }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getWidgetCorsHeaders } from '../_shared/cors.ts';
import { verifyWidgetToken } from '../_shared/widget-auth.ts';

Deno.serve(async (req: Request) => {
  const corsHeaders = getWidgetCorsHeaders(req.headers.get('origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const claims = await verifyWidgetToken(req);
    if (!claims) return json({ error: 'Unauthorized' }, 401);

    const { shop_domain, cart_total } = await req.json().catch(() => ({}));
    const cartTotal = Math.max(0, parseFloat(cart_total) || 0);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Active program for this client (identity comes from the token)
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id, points_name, points_name_singular, currency, allow_redemption, is_active')
      .eq('client_id', claims.cid)
      .eq('is_active', true)
      .maybeSingle();

    if (!program?.id) return json({ redeemable: false, reason: 'no_program' });
    if (program.allow_redemption === false) {
      return json({ redeemable: false, reason: 'redemption_disabled', points_name: program.points_name });
    }

    // Member loyalty status (token-scoped member + this program)
    const { data: status } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, current_tier_id')
      .eq('member_user_id', claims.mid)
      .eq('loyalty_program_id', program.id)
      .maybeSingle();

    if (!status?.id) return json({ redeemable: false, reason: 'not_a_member', points_name: program.points_name });

    // Tier redemption config
    let pointsValue = 1, maxPercent = 100, maxPoints: number | null = null, tierName = '';
    if (status.current_tier_id) {
      const { data: tier } = await supabase
        .from('loyalty_tiers')
        .select('tier_name, points_value, max_redemption_percent, max_redemption_points')
        .eq('id', status.current_tier_id)
        .maybeSingle();
      if (tier) {
        pointsValue = Number(tier.points_value) || 1;
        maxPercent = tier.max_redemption_percent != null ? Number(tier.max_redemption_percent) : 100;
        maxPoints = tier.max_redemption_points != null ? Number(tier.max_redemption_points) : null;
        tierName = tier.tier_name || '';
      }
    }

    // Outstanding reserved holds (not yet applied/expired) reduce what's spendable.
    const nowIso = new Date().toISOString();
    const { data: holds } = await supabase
      .from('point_redemption_holds')
      .select('points_reserved')
      .eq('member_loyalty_status_id', status.id)
      .eq('status', 'reserved')
      .gt('expires_at', nowIso);
    const outstanding = (holds || []).reduce((s, h) => s + (Number(h.points_reserved) || 0), 0);

    const availablePoints = Math.max(0, (status.points_balance || 0) - outstanding);

    // Compute the cap for THIS cart.
    const { points: maxRedeemablePoints, discount: maxDiscountValue } =
      clampRedemption(availablePoints, pointsValue, maxPercent, maxPoints, cartTotal);

    return json({
      redeemable: maxRedeemablePoints > 0,
      points_name: program.points_name || 'Points',
      points_name_singular: program.points_name_singular || 'Point',
      currency: program.currency || 'INR',
      tier_name: tierName,
      points_balance: status.points_balance || 0,
      available_points: availablePoints,
      points_value: pointsValue,
      max_redemption_percent: maxPercent,
      max_redemption_points: maxPoints,
      max_redeemable_points: maxRedeemablePoints,
      max_discount_value: maxDiscountValue,
    });
  } catch (err) {
    console.error('[get-redeem-options] error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Clamp a desired redemption to all caps. Returns the largest valid
 * (points, discount) pair that satisfies balance, per-redemption point cap,
 * and the % -of-order cap. Points and discount stay mutually consistent
 * (discount = points × points_value).
 */
export function clampRedemption(
  available: number,
  pointsValue: number,
  maxPercent: number,
  maxPoints: number | null,
  cartTotal: number,
): { points: number; discount: number } {
  if (available <= 0 || pointsValue <= 0) return { points: 0, discount: 0 };

  let pts = Math.floor(available);
  if (maxPoints != null && maxPoints > 0) pts = Math.min(pts, Math.floor(maxPoints));

  // % -of-order cap (only when we know the cart total)
  if (cartTotal > 0 && maxPercent >= 0 && maxPercent < 100) {
    const maxDiscountByPercent = (cartTotal * maxPercent) / 100;
    const maxPtsByPercent = Math.floor(maxDiscountByPercent / pointsValue);
    pts = Math.min(pts, maxPtsByPercent);
  }
  // Never discount more than the order itself.
  if (cartTotal > 0) {
    const maxPtsByTotal = Math.floor(cartTotal / pointsValue);
    pts = Math.min(pts, maxPtsByTotal);
  }

  if (pts < 1) return { points: 0, discount: 0 };
  const discount = Math.round(pts * pointsValue * 100) / 100;
  if (discount <= 0) return { points: 0, discount: 0 };
  return { points: pts, discount };
}
