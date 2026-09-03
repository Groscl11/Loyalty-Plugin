import { createClient } from 'npm:@supabase/supabase-js@2';

async function verifyShopifyWebhook(rawBody: string, hmacHeader: string): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || Deno.env.get('SHOPIFY_API_SECRET');
  if (!secret || !hmacHeader) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const er = (globalThis as any).EdgeRuntime;
const hasWaitUntil = er && typeof er.waitUntil === 'function';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    // ── HMAC verification — only blocking work before the 200 ─────────────────
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';
    if (!(await verifyShopifyWebhook(rawBody, hmacHeader))) {
      console.error('[shopify-order-webhook] HMAC verification failed');
      return json({ error: 'Invalid webhook signature' }, 401);
    }

    const order   = JSON.parse(rawBody);
    const topic   = req.headers.get('X-Shopify-Topic') || '';
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';
    if (!topic || !shopDomain) return json({ error: 'Missing topic or shop domain' }, 400);

    console.log(`[shopify-order-webhook] waitUntil=${hasWaitUntil} topic=${topic} shop=${shopDomain} order=${order.id}`);

    if (!topic.startsWith('orders/')) return json({ message: `Ignored non-order topic: ${topic}` });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── All heavy DB work runs in the background so we respond to Shopify
    //    within the 5-second deadline. If waitUntil is unavailable we fall
    //    back to awaiting (same correctness, slower — catches misconfigured runtimes).
    const bgTask = processOrder(supabase, order, topic, shopDomain);
    if (hasWaitUntil) {
      er.waitUntil(bgTask.catch((e: Error) =>
        console.error('[shopify-order-webhook] background task failed:', e.message)
      ));
    } else {
      await bgTask; // fallback: block until done (avoids data loss when no waitUntil)
    }

    return json({ success: true, topic, shop: shopDomain });
  } catch (err) {
    console.error('[shopify-order-webhook] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});

// ─── All order processing — runs in background ───────────────────────────────
async function processOrder(supabase: any, order: any, topic: string, shopDomain: string) {
  // ── Resolve client_id ──────────────────────────────────────────────────────
  let clientId: string | null = null;
  const { data: si } = await supabase
    .from('store_installations')
    .select('client_id, id')
    .eq('shop_domain', shopDomain)
    .eq('installation_status', 'active')
    .maybeSingle();
  if (si) {
    clientId = si.client_id;
    // fire-and-forget — don't await this housekeeping update
    supabase.from('store_installations').update({ last_active_at: new Date().toISOString() }).eq('id', si.id);
  }
  if (!clientId) {
    const { data: ic } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
    if (ic) clientId = ic.client_id;
  }
  if (!clientId) {
    console.warn('[shopify-order-webhook] Shop not integrated (no-op):', shopDomain);
    return;
  }

  // ── Upsert order + award points in parallel ────────────────────────────────
  const customerEmail = order.customer?.email?.trim().toLowerCase() || null;
  const customerPhone = order.customer?.phone?.trim() || null;
  const orderRecord = {
    client_id: clientId,
    order_id: order.id?.toString(),
    shopify_order_id: order.id?.toString(),
    order_number: order.name || order.order_number?.toString() || null,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    total_price: parseFloat(order.total_price || '0'),
    currency: order.currency || null,
    financial_status: order.financial_status || null,
    fulfillment_status: order.fulfillment_status || null,
    order_status: order.cancelled_at ? 'cancelled' : (order.financial_status || 'pending'),
    payment_method: order.payment_gateway || null,
    processed_at: order.processed_at || order.created_at || new Date().toISOString(),
    order_data: order,
    synced_at: new Date().toISOString(),
  };

  const orderIsPaid = topic === 'orders/paid' || order.financial_status === 'paid';
  const [, pointsOutcome] = await Promise.all([
    // upsert order record
    supabase.from('shopify_orders').upsert(orderRecord, { onConflict: 'shopify_order_id' })
      .then(({ error: e }: any) => { if (e) console.error('[shopify-order-webhook] order upsert:', e.message); }),
    // award points (parallelised internally)
    orderIsPaid
      ? awardOrderPoints(supabase, clientId, order, customerEmail, customerPhone)
      : Promise.resolve({ status: 'not_paid', topic }),
  ]);
  console.log(`[shopify-order-webhook] points outcome:`, JSON.stringify(pointsOutcome));

  // ── Campaign evaluation ────────────────────────────────────────────────────
  const transactionId = crypto.randomUUID();
  const shopifyOrderName: string | null = order.name ?? null;
  try {
    await Promise.all([
      checkAndExecuteCampaignRules(supabase, clientId, orderRecord, transactionId, shopifyOrderName),
      checkAdvancedCampaignRules(supabase, clientId, order, orderRecord, transactionId, shopifyOrderName),
    ]);
    await processPendingCommunications(supabase);
  } catch (e) {
    console.error('[shopify-order-webhook] campaign eval error:', (e as Error).message);
  }

  // ── Attribution recording (fire-and-forget) ────────────────────────────────
  recordAttribution(supabase, clientId, order).catch((e: Error) =>
    console.error('[shopify-order-webhook] attribution record failed:', e.message)
  );
}

// ─── Attribution recording ────────────────────────────────────────────────────
async function recordAttribution(supabase: any, clientId: string, order: any) {
  const orderId = order.id?.toString();
  if (!orderId) return;

  // Parse note_attributes written by goself-attribution.js on the storefront
  const attrs: Record<string, string> = {};
  for (const a of (order.note_attributes ?? [])) {
    if (a.name && a.value) attrs[a.name] = a.value;
  }

  const ft = {
    ref:      attrs['_aff_ft_ref']  || null,
    source:   attrs['_aff_ft_src']  || null,
    medium:   attrs['_aff_ft_med']  || null,
    campaign: attrs['_aff_ft_cam']  || null,
    ts:       attrs['_aff_ft_ts']   || null,
  };
  const lt = {
    ref:      attrs['_aff_lt_ref']  || null,
    source:   attrs['_aff_lt_src']  || null,
    medium:   attrs['_aff_lt_med']  || null,
    campaign: attrs['_aff_lt_cam']  || null,
    ts:       attrs['_aff_lt_ts']   || null,
  };
  const touchCount = parseInt(attrs['_aff_touches'] || '1', 10);

  // Fallback 1: many stores run a checkout-tracking script/app that already
  // writes utm_source/utm_medium/utm_campaign + landing_page_url onto every
  // order's note_attributes — completely independent of us. bg_ref rides
  // along inside landing_page_url's query string. This is the most reliable
  // fallback for stores on a third-party checkout (e.g. Fastrr/Shiprocket
  // one-click checkout): those replace Shopify's own checkout page, which
  // breaks the Web Pixel's checkout_completed event (fallback 2 below) since
  // it only fires on Shopify's native checkout/thank-you page.
  if (!lt.ref) {
    const landingUrl = attrs['landing_page_url'] || null;
    if (landingUrl) {
      try {
        const params = new URL(landingUrl).searchParams;
        const foundRef = params.get('bg_ref') || params.get('bg_aff') || params.get('ref') || params.get('aff');
        if (foundRef) {
          lt.ref = foundRef;
          lt.source = attrs['utm_source'] || null;
          lt.medium = attrs['utm_medium'] || null;
          lt.campaign = attrs['utm_campaign'] || null;
        }
      } catch { /* malformed landing_page_url — ignore */ }
    }
  }

  // Fallback 2: for stores on Shopify's own native checkout, the Web Pixel
  // reports {ref, checkout_token} at checkout_completed via
  // track-checkout-attribution, staged in pending_checkout_attributions.
  // Join it back to this order by checkout token — order.token is the same
  // value Checkout.token carries in the Web Pixel event.
  if (!lt.ref) {
    const checkoutToken: string | null = order.token || order.checkout_token || null;
    if (checkoutToken) {
      const { data: pending } = await supabase
        .from('pending_checkout_attributions')
        .select('ref, source, medium, campaign, utm_link_id')
        .eq('client_id', clientId)
        .eq('checkout_token', checkoutToken)
        .is('consumed_at', null)
        .maybeSingle();
      if (pending) {
        lt.ref = pending.ref;
        lt.source = pending.source;
        lt.medium = pending.medium;
        lt.campaign = pending.campaign;
        supabase.from('pending_checkout_attributions')
          .update({ consumed_at: new Date().toISOString() })
          .eq('client_id', clientId).eq('checkout_token', checkoutToken)
          .then(({ error }: any) => { if (error) console.error('[recordAttribution] consume pending failed:', error.message); });
      }
    }
  }

  // Resolve coupon-based conversion (coupon code on the order)
  const discountCodes: string[] = (order.discount_codes ?? []).map((d: any) => d.code?.toUpperCase()).filter(Boolean);
  let convertedBy: string | null = null;
  let convertedPartnerId: string | null = null;
  let convertedCouponCode: string | null = null;
  let convertedUtmLinkId: string | null = null;

  if (discountCodes.length > 0) {
    // Match first recognised coupon code to an affiliate_code_assignment
    const { data: codeMatch } = await supabase
      .from('affiliate_code_assignments')
      .select('id, partner_id, code')
      .eq('client_id', clientId)
      .in('code', discountCodes)
      .maybeSingle();
    if (codeMatch) {
      convertedBy = 'coupon';
      convertedPartnerId = codeMatch.partner_id;
      convertedCouponCode = codeMatch.code;
    }
  }

  // If no coupon match, try UTM last-touch ref
  if (!convertedBy && lt.ref) {
    const { data: utmMatch } = await supabase
      .from('attribution_utm_links')
      .select('id, partner_id')
      .eq('client_id', clientId)
      .eq('attribution_param_value', lt.ref)
      .maybeSingle();
    if (utmMatch) {
      convertedBy = 'utm';
      convertedPartnerId = utmMatch.partner_id;
      convertedUtmLinkId = utmMatch.id;
    }
  }

  // Resolve UTM link IDs for first/last touch
  let ftLinkId: string | null = null;
  let ltLinkId: string | null = null;

  if (ft.ref) {
    const { data: ftLink } = await supabase
      .from('attribution_utm_links')
      .select('id')
      .eq('client_id', clientId)
      .eq('attribution_param_value', ft.ref)
      .maybeSingle();
    if (ftLink) ftLinkId = ftLink.id;
  }
  if (lt.ref && lt.ref !== ft.ref) {
    const { data: ltLink } = await supabase
      .from('attribution_utm_links')
      .select('id')
      .eq('client_id', clientId)
      .eq('attribution_param_value', lt.ref)
      .maybeSingle();
    if (ltLink) ltLinkId = ltLink.id;
  } else if (lt.ref === ft.ref) {
    ltLinkId = ftLinkId;
  }

  if (!convertedBy && !ft.ref && !lt.ref) {
    // No affiliate signal on this order — nothing to record
    return;
  }

  const record = {
    client_id:              clientId,
    shopify_order_id:       orderId,
    order_revenue:          parseFloat(order.total_price || '0'),
    order_currency:         order.currency || 'INR',
    converted_by:           convertedBy || 'direct',
    converted_partner_id:   convertedPartnerId,
    converted_coupon_code:  convertedCouponCode,
    converted_utm_link_id:  convertedUtmLinkId,
    ft_ref:      ft.ref,
    ft_source:   ft.source,
    ft_medium:   ft.medium,
    ft_campaign: ft.campaign,
    ft_utm_link_id: ftLinkId,
    ft_at:       ft.ts ? new Date(ft.ts).toISOString() : null,
    lt_ref:      lt.ref,
    lt_source:   lt.source,
    lt_medium:   lt.medium,
    lt_campaign: lt.campaign,
    lt_utm_link_id: ltLinkId,
    lt_at:       lt.ts ? new Date(lt.ts).toISOString() : null,
    touch_count:            touchCount,
    attribution_window_days: 30,
  };

  const { error } = await supabase
    .from('order_attribution')
    .upsert(record, { onConflict: 'client_id,shopify_order_id' });

  if (error) console.error('[shopify-order-webhook] order_attribution upsert:', error.message);
  else console.log(`[shopify-order-webhook] attribution recorded: order=${orderId} converted_by=${convertedBy} partner=${convertedPartnerId}`);
}

// ─── Points award (parallelised, idempotent) ─────────────────────────────────
async function awardOrderPoints(
  supabase: any, clientId: string, order: any,
  customerEmail: string | null, customerPhone: string | null,
): Promise<Record<string, unknown>> {
  if (!customerEmail && !customerPhone) return { status: 'no_identity' };

  // Phase 1: loyalty program + member resolution in parallel
  const [{ data: program }, { data: memberId, error: rpcErr }] = await Promise.all([
    supabase.from('loyalty_programs').select('id').eq('client_id', clientId).eq('is_active', true).maybeSingle(),
    supabase.rpc('resolve_or_create_member', {
      p_client_id: clientId,
      p_email: customerEmail,
      p_phone: customerPhone,
      p_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || '',
      p_external_id: order.customer?.id?.toString() || null,
    }),
  ]);

  if (!program?.id) {
    console.warn('[shopify-order-webhook] No active loyalty program (no-op):', clientId);
    return { status: 'no_active_program' };
  }
  if (rpcErr) throw new Error(`resolve_or_create_member: ${rpcErr.message}`);
  if (!memberId) return { status: 'no_member' };

  // Phase 2: tier, loyalty status, idempotency check — all in parallel
  const [
    { data: defaultTier },
    { data: existingStatus },
    { data: existingTxn },
  ] = await Promise.all([
    supabase.from('loyalty_tiers')
      .select('id, points_earn_rate, points_earn_divisor')
      .eq('loyalty_program_id', program.id).eq('is_default', true).maybeSingle(),
    supabase.from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_earned, current_tier_id, total_orders, total_spend')
      .eq('member_user_id', memberId).eq('loyalty_program_id', program.id).maybeSingle(),
    supabase.from('loyalty_points_transactions')
      .select('id').eq('member_user_id', memberId)
      .eq('transaction_type', 'earned').eq('reference_id', order.id.toString()).maybeSingle(),
    // fire-and-forget: link member to order row
    supabase.from('shopify_orders').update({ member_id: memberId }).eq('shopify_order_id', order.id.toString()),
  ]);

  if (existingTxn) return { status: 'already_awarded' };

  // Resolve tier (default → first created → none)
  let tier = defaultTier;
  if (!tier) {
    const { data: firstTier } = await supabase.from('loyalty_tiers')
      .select('id, points_earn_rate, points_earn_divisor')
      .eq('loyalty_program_id', program.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
    tier = firstTier;
  }
  if (!tier) {
    console.warn('[shopify-order-webhook] No tier configured (no-op) program:', program.id);
    return { status: 'no_tier' };
  }

  // Upsert loyalty status if it doesn't exist yet
  let status = existingStatus;
  if (!status) {
    const { data: upserted } = await supabase.from('member_loyalty_status')
      .upsert({
        member_user_id: memberId,
        loyalty_program_id: program.id,
        current_tier_id: tier.id,
        points_balance: 0, lifetime_points_earned: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'member_user_id,loyalty_program_id', ignoreDuplicates: true })
      .select('id, points_balance, lifetime_points_earned, current_tier_id, total_orders, total_spend')
      .maybeSingle();
    if (!upserted) {
      const { data: fetched } = await supabase.from('member_loyalty_status')
        .select('id, points_balance, lifetime_points_earned, current_tier_id, total_orders, total_spend')
        .eq('member_user_id', memberId).eq('loyalty_program_id', program.id).maybeSingle();
      status = fetched;
    } else {
      status = upserted;
    }
  }
  if (!status) throw new Error('Failed to load loyalty status after upsert');

  const earnRate    = tier.points_earn_rate    || 1;
  const earnDivisor = tier.points_earn_divisor || 1;
  const orderTotal  = parseFloat(order.total_price || '0');
  const pointsEarned = Math.floor((orderTotal / earnDivisor) * earnRate);
  if (pointsEarned <= 0) return { status: 'zero_points', order_total: orderTotal };

  const newBalance  = (status.points_balance || 0) + pointsEarned;
  const newLifetime = (status.lifetime_points_earned || 0) + pointsEarned;

  // Phase 3: update status + insert transaction in parallel
  const [{ error: updErr }, { error: txnErr }] = await Promise.all([
    supabase.from('member_loyalty_status').update({
      points_balance: newBalance, lifetime_points_earned: newLifetime,
      total_orders: ((status as any).total_orders || 0) + 1,
      total_spend: ((status as any).total_spend || 0) + orderTotal,
      updated_at: new Date().toISOString(),
    }).eq('id', status.id),
    supabase.from('loyalty_points_transactions').insert({
      member_loyalty_status_id: status.id,
      member_user_id: memberId,
      transaction_type: 'earned',
      points_amount: pointsEarned,
      balance_after: newBalance,
      reference_id: order.id.toString(),
      description: `Points earned on order ${order.name || '#' + order.id}`,
    }),
  ]);

  if (updErr) throw new Error(`status update: ${updErr.message}`);
  if (txnErr) throw new Error(`txn insert: ${txnErr.message}`);

  console.log(`[shopify-order-webhook] Awarded ${pointsEarned} pts to member ${memberId} for order ${order.id}`);
  return { status: 'awarded', points_awarded: pointsEarned, new_balance: newBalance, order_id: order.id };
}

// ─── Campaign evaluation helpers ──────────────────────────────────────────────

async function logCampaignTrigger(
  supabase: any, clientId: string, campaignRuleId: string, orderRecord: any,
  result: string, reason: string, memberId: string | null = null,
  membershipId: string | null = null, metadata: any = {}
) {
  try {
    await supabase.from('campaign_trigger_logs').insert({
      client_id: clientId, campaign_rule_id: campaignRuleId,
      order_id: orderRecord.order_id, order_number: orderRecord.order_number,
      order_value: parseFloat(orderRecord.total_price), trigger_result: result,
      member_id: memberId, membership_id: membershipId,
      customer_email: orderRecord.customer_email, customer_phone: orderRecord.customer_phone,
      reason, metadata,
      transaction_id: metadata.transaction_id ?? null,
      reward_link: metadata.reward_link ?? null,
      campaign_display_id: metadata.campaign_display_id ?? null,
      shopify_order_name: metadata.shopify_order_name ?? null,
    });
  } catch (error) {
    console.error('[shopify-order-webhook] Error logging campaign trigger:', error);
  }
}

function evaluateConditionsLocally(conditions: any[], context: any): { allPassed: boolean; failed: string[] } {
  const failed: string[] = [];
  for (const condition of conditions) {
    if (!evaluateConditionLocally(condition, context)) {
      failed.push(`${condition.type} ${condition.operator} ${condition.value}`);
    }
  }
  return { allPassed: conditions.length === 0 || failed.length === 0, failed };
}

function evaluateConditionLocally(condition: any, context: any): boolean {
  const { type, operator, value } = condition;
  const { order, customer } = context;
  try {
    switch (type) {
      case 'order_value_gte':
        return parseFloat(order.total_price || 0) >= parseFloat(value);
      case 'order_value_between': {
        const [min, max] = value.split(',').map((v: string) => parseFloat(v.trim()));
        const ov = parseFloat(order.total_price || 0);
        return ov >= min && ov <= max;
      }
      case 'order_item_count': {
        const count = order.line_items?.length || 0;
        if (operator === 'gte') return count >= parseInt(value);
        if (operator === 'eq')  return count === parseInt(value);
        if (operator === 'lte') return count <= parseInt(value);
        return false;
      }
      case 'payment_method': {
        const gw  = order.gateway?.toLowerCase() || '';
        const pgn = order.payment_gateway_names?.[0]?.toLowerCase() || '';
        if (value === 'cod')     return gw.includes('cod') || pgn.includes('cash');
        if (value === 'prepaid') return !gw.includes('cod') && !pgn.includes('cash');
        return false;
      }
      case 'customer_type': {
        const oc = customer?.orders_count || 0;
        if (value === 'new')       return oc <= 1;
        if (value === 'returning') return oc > 1;
        return false;
      }
      case 'lifetime_orders': {
        const oc = customer?.orders_count || 0;
        if (operator === 'gte') return oc >= parseInt(value);
        if (operator === 'lte') return oc <= parseInt(value);
        return false;
      }
      case 'shipping_city': {
        const city = order.shipping_address?.city?.toLowerCase() || '';
        const sv   = value.toLowerCase();
        if (operator === 'exact')   return city === sv;
        if (operator === 'in_list') return value.split(',').map((v: string) => v.trim().toLowerCase()).includes(city);
        return false;
      }
      case 'shipping_pincode': {
        const pin = order.shipping_address?.zip || '';
        if (operator === 'exact')       return pin === value;
        if (operator === 'starts_with') return pin.startsWith(value);
        if (operator === 'in_list')     return value.split(',').map((v: string) => v.trim()).includes(pin);
        return false;
      }
      case 'shipping_state': {
        const state = order.shipping_address?.province?.toLowerCase() || '';
        const sv    = value.toLowerCase();
        if (operator === 'exact')   return state === sv;
        if (operator === 'in_list') return value.split(',').map((v: string) => v.trim().toLowerCase()).includes(state);
        return false;
      }
      case 'collection_contains': {
        const items: any[] = order.line_items || [];
        const sv   = value.toLowerCase();
        const tags = (order.tags || '').toLowerCase().split(',').map((t: string) => t.trim());
        if (tags.includes(sv)) return true;
        return items.some((i: any) =>
          i.product_type?.toLowerCase() === sv ||
          (i.properties || []).some((p: any) => p.name?.toLowerCase() === 'collection' && p.value?.toLowerCase() === sv)
        );
      }
      default:
        console.warn(`[shopify-order-webhook] Unrecognized condition type "${type}" — failing safe`);
        return false;
    }
  } catch (err) {
    console.error(`[shopify-order-webhook] Error evaluating condition ${type}:`, err);
    return false;
  }
}

async function checkAdvancedCampaignRules(
  supabase: any, clientId: string, orderData: any, orderRecord: any,
  transactionId: string | null = null, shopifyOrderName: string | null = null
) {
  try {
    const { data: rules, error } = await supabase
      .from('campaign_rules')
      .select('*, membership_programs(*)')
      .eq('client_id', clientId).eq('is_active', true)
      .eq('trigger_type', 'advanced').eq('rule_version', 2);

    if (error) { console.error('[shopify-order-webhook] Error fetching advanced rules:', error); return; }
    if (!rules || rules.length === 0) return;

    // Use customer data from the order payload directly — avoids a live Shopify
    // API call (was adding 1–3 s per webhook). The webhook payload already
    // includes orders_count, total_spent, tags and other fields that campaign
    // conditions need for customer_type / lifetime_orders checks.
    const customer = orderData.customer || null;

    for (const rule of rules) {
      try {
        const { data: existing } = await supabase
          .from('campaign_trigger_logs').select('id, trigger_result')
          .eq('campaign_rule_id', rule.id).eq('order_id', orderRecord.order_id)
          .in('trigger_result', ['success', 'already_enrolled', 'max_reached', 'below_threshold', 'not_matched'])
          .maybeSingle();
        if (existing) {
          // A later webhook event (e.g. orders/paid) may carry the correct order
          // name and total that an earlier event (orders/created) lacked. Refresh
          // display fields without re-running campaign logic.
          const orderValueNum = parseFloat(orderRecord.total_price);
          const patch: Record<string, unknown> = {};
          if (!isNaN(orderValueNum) && orderValueNum > 0) patch.order_value = orderValueNum;
          if (orderRecord.order_number) patch.order_number = orderRecord.order_number;
          if (shopifyOrderName) patch.shopify_order_name = shopifyOrderName;
          if (Object.keys(patch).length) {
            await supabase.from('campaign_trigger_logs').update(patch).eq('id', existing.id);
          }
          continue;
        }

        let memberId: string | null = null;
        if (orderRecord.customer_phone) {
          const { data: m } = await supabase.from('member_users').select('id').eq('client_id', clientId).eq('phone', orderRecord.customer_phone).maybeSingle();
          if (m) memberId = m.id;
        }
        if (!memberId && orderRecord.customer_email) {
          const { data: m } = await supabase.from('member_users').select('id').eq('client_id', clientId).eq('email', orderRecord.customer_email).maybeSingle();
          if (m) memberId = m.id;
        }
        const ruleMode = rule.rule_mode || 'membership';
        if (!memberId && (ruleMode === 'standalone' || ruleMode === 'instant_reward') && orderRecord.customer_email) {
          const { data: nm } = await supabase.from('member_users')
            .insert({ client_id: clientId, email: orderRecord.customer_email, full_name: orderRecord.customer_email })
            .select('id').single();
          if (nm) memberId = nm.id;
        }
        if (!memberId) {
          await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'no_member', 'No member found for this order', null, null, { campaign_name: rule.name, rule_type: ruleMode, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
          continue;
        }

        if (ruleMode === 'membership') {
          const { data: em } = await supabase.from('member_memberships').select('id').eq('member_id', memberId).eq('program_id', rule.program_id).maybeSingle();
          if (em) {
            await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'already_enrolled', 'Member already enrolled in program', memberId, em.id, { campaign_name: rule.name, rule_type: 'advanced', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
            continue;
          }
        }

        const ctx = { order: orderData, customer, clientId };
        const toArr = (v: any) => Array.isArray(v) ? v : [];
        const triggerR     = evaluateConditionsLocally(toArr(rule.trigger_conditions), ctx);
        const eligibilityR = evaluateConditionsLocally(toArr(rule.eligibility_conditions), ctx);
        const locationR    = evaluateConditionsLocally(toArr(rule.location_conditions), ctx);
        const attributionR = evaluateConditionsLocally(toArr(rule.attribution_conditions), ctx);
        const allPassed = triggerR.allPassed &&
          (!(rule.eligibility_conditions?.length) || eligibilityR.allPassed) &&
          (!(rule.location_conditions?.length)    || locationR.allPassed) &&
          (!(rule.attribution_conditions?.length) || attributionR.allPassed);

        if (allPassed) {
          if (ruleMode === 'standalone' || ruleMode === 'instant_reward') {
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + (rule.link_expiry_hours || 72));
            let resolvedToken: string | null = null;
            const shopifyOrderRef = orderRecord.shopify_order_id;
            const { data: nt, error: ntErr } = await supabase
              .from('campaign_tokens')
              .insert({ campaign_rule_id: rule.id, shopify_order_ref: shopifyOrderRef, member_id: memberId, email: orderRecord.customer_email, phone: orderRecord.customer_phone || null, is_pre_verified: true, expires_at: expiresAt.toISOString() })
              .select('token').single();
            if (nt) {
              resolvedToken = nt.token;
            } else if (ntErr?.code === '23505') {
              const { data: existing2 } = await supabase
                .from('campaign_tokens').select('token').eq('campaign_rule_id', rule.id).eq('shopify_order_ref', shopifyOrderRef).maybeSingle();
              if (existing2) resolvedToken = existing2.token;
            }
            if (!resolvedToken) {
              await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'failed', `Token creation failed: ${ntErr?.message ?? 'not found'}`, memberId, null, { campaign_name: rule.name, rule_type: ruleMode, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
              continue;
            }
            await supabase.rpc('increment_campaign_enrollments', { campaign_id: rule.id });
            await supabase.from('communication_logs').insert({ client_id: clientId, member_id: memberId, campaign_rule_id: rule.id, type: 'standalone_reward_link', status: 'queued', metadata: { token: resolvedToken, expires_at: expiresAt.toISOString(), order_id: orderRecord.order_id, campaign_name: rule.name } });
            const claimUrl = `${Deno.env.get('FRONTEND_URL') || 'https://app.goself.in'}/claim-rewards?token=${resolvedToken}`;
            await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'success', `${ruleMode === 'instant_reward' ? 'Instant reward' : 'Standalone'} campaign token issued`, memberId, null, { campaign_name: rule.name, rule_type: ruleMode, token: resolvedToken, reward_link: claimUrl, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
          } else {
            const validityDays = rule.membership_programs?.validity_days || 365;
            const exp = new Date(); exp.setDate(exp.getDate() + validityDays);
            const { data: nm, error: ee } = await supabase.from('member_memberships').insert({ member_id: memberId, program_id: rule.program_id, campaign_rule_id: rule.id, enrollment_source: 'campaign_auto', status: 'active', activated_at: new Date().toISOString(), expires_at: exp.toISOString(), enrollment_metadata: { order_id: orderRecord.order_id, order_value: orderRecord.total_price, triggered_by: 'advanced_campaign', campaign_name: rule.name, rule_version: 2 } }).select().single();
            if (ee) {
              if (ee.code === '23505') {
                const { data: em2 } = await supabase.from('member_memberships').select('id').eq('member_id', memberId).eq('program_id', rule.program_id).maybeSingle();
                await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'already_enrolled', 'Concurrent enrollment (idempotent skip)', memberId, em2?.id || null, { campaign_name: rule.name, rule_type: 'advanced', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
              } else {
                await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'failed', `Enrollment failed: ${ee.message}`, memberId, null, { campaign_name: rule.name, rule_type: 'advanced', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
              }
            } else {
              await supabase.rpc('increment_campaign_enrollments', { campaign_id: rule.id });
              await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'success', 'Member enrolled via advanced campaign', memberId, nm.id, { campaign_name: rule.name, rule_type: 'advanced', program_id: rule.program_id, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
            }
          }
        } else {
          const failed = [...triggerR.failed, ...eligibilityR.failed, ...locationR.failed, ...attributionR.failed];
          await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'not_matched', `Conditions not met: ${failed.join(', ')}`, memberId, null, { campaign_name: rule.name, rule_type: ruleMode, failed_conditions: failed, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
        }
      } catch (ruleErr) {
        console.error(`[shopify-order-webhook] Error evaluating rule "${rule.name}":`, ruleErr);
      }
    }
  } catch (err) {
    console.error('[shopify-order-webhook] Error in checkAdvancedCampaignRules:', err);
  }
}

async function checkAndExecuteCampaignRules(
  supabase: any, clientId: string, orderRecord: any,
  transactionId: string | null = null, shopifyOrderName: string | null = null
) {
  try {
    const { data: rules, error } = await supabase
      .from('campaign_rules').select('*, membership_programs(*)')
      .eq('client_id', clientId).eq('is_active', true).eq('trigger_type', 'order_value');
    if (error || !rules || rules.length === 0) return;

    const sorted = rules.sort((a: any, b: any) => (b.trigger_conditions?.min_order_value || 0) - (a.trigger_conditions?.min_order_value || 0));
    for (const rule of sorted) {
      const minVal = rule.trigger_conditions?.min_order_value || 0;
      const { data: existing } = await supabase.from('campaign_trigger_logs').select('id')
        .eq('campaign_rule_id', rule.id).eq('order_id', orderRecord.order_id)
        .in('trigger_result', ['success', 'already_enrolled', 'max_reached', 'below_threshold', 'not_matched']).maybeSingle();
      if (existing) continue;

      if (parseFloat(orderRecord.total_price) >= minVal) {
        let memberId: string | null = null;
        if (orderRecord.customer_phone) { const { data: m } = await supabase.from('member_users').select('id').eq('client_id', clientId).eq('phone', orderRecord.customer_phone).maybeSingle(); if (m) memberId = m.id; }
        if (!memberId && orderRecord.customer_email) { const { data: m } = await supabase.from('member_users').select('id').eq('client_id', clientId).eq('email', orderRecord.customer_email).maybeSingle(); if (m) memberId = m.id; }
        if (!memberId) { await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'no_member', 'No member found', null, null, { campaign_name: rule.name, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName }); continue; }

        const { data: em } = await supabase.from('member_memberships').select('id').eq('member_id', memberId).eq('program_id', rule.program_id).maybeSingle();
        if (em) { await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'already_enrolled', 'Already enrolled', memberId, em.id, { campaign_name: rule.name, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName }); continue; }
        if (rule.max_enrollments && rule.current_enrollments >= rule.max_enrollments) { await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'max_reached', 'Max enrollments reached', memberId, null, { campaign_name: rule.name, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName }); continue; }

        const exp = new Date(); exp.setDate(exp.getDate() + (rule.membership_programs?.validity_days || 365));
        const { data: nm, error: ee } = await supabase.from('member_memberships').insert({ member_id: memberId, program_id: rule.program_id, campaign_rule_id: rule.id, enrollment_source: 'campaign_auto', status: 'active', activated_at: new Date().toISOString(), expires_at: exp.toISOString(), enrollment_metadata: { order_id: orderRecord.order_id, order_value: orderRecord.total_price, triggered_by: 'order_value_campaign', campaign_name: rule.name, min_order_value: minVal } }).select().single();
        if (ee) {
          if (ee.code === '23505') { const { data: em2 } = await supabase.from('member_memberships').select('id').eq('member_id', memberId).eq('program_id', rule.program_id).maybeSingle(); await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'already_enrolled', 'Concurrent enrollment', memberId, em2?.id || null, { campaign_name: rule.name, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName }); }
          else { await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'failed', `Enrollment failed: ${ee.message}`, memberId, null, { campaign_name: rule.name, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName }); }
        } else {
          await supabase.rpc('increment_campaign_enrollments', { campaign_id: rule.id });
          await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'success', 'Member enrolled via order_value campaign', memberId, nm.id, { campaign_name: rule.name, program_id: rule.program_id, min_order_value: minVal, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
          break;
        }
      } else {
        await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'below_threshold', `Order value ${orderRecord.total_price} below minimum ${minVal}`, null, null, { campaign_name: rule.name, min_order_value: minVal, order_value: orderRecord.total_price, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
      }
    }
  } catch (err) {
    console.error('[shopify-order-webhook] Error in checkAndExecuteCampaignRules:', err);
  }
}

async function processPendingCommunications(supabase: any) {
  try {
    const { data: pending, error } = await supabase.from('communication_logs').select('id').eq('status', 'pending').limit(10);
    if (error || !pending || pending.length === 0) return;
    for (const c of pending) {
      try { await supabase.from('communication_logs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', c.id); } catch (e) { console.error('[shopify-order-webhook] Failed to update comm:', e); }
    }
  } catch (err) {
    console.error('[shopify-order-webhook] Error in processPendingCommunications:', err);
  }
}
