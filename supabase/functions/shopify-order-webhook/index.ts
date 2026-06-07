import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptToken } from '../_shared/token-crypto.ts';

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

// Run a background task without blocking the webhook response. Falls back to
// awaiting when the runtime has no waitUntil (keeps correctness either way).
function runInBackground(p: Promise<unknown>): Promise<unknown> | void {
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') { er.waitUntil(p); return; }
  return p; // caller awaits the fallback
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    // ── HMAC verification ────────────────────────────────────────────────────
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';
    if (!(await verifyShopifyWebhook(rawBody, hmacHeader))) {
      console.error('[shopify-order-webhook] HMAC verification failed');
      return json({ error: 'Invalid webhook signature' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const order = JSON.parse(rawBody);
    const topic = req.headers.get('X-Shopify-Topic') || '';
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';

    if (!topic || !shopDomain) return json({ error: 'Missing topic or shop domain' }, 400);

    console.log(`[shopify-order-webhook] topic=${topic} shop=${shopDomain} order=${order.id}`);

    if (!topic.startsWith('orders/')) {
      return json({ message: `Ignored non-order topic: ${topic}` });
    }

    // ── Resolve client_id ────────────────────────────────────────────────────
    let clientId: string | null = null;
    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id, id')
      .eq('shop_domain', shopDomain)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (si) {
      clientId = si.client_id;
      await supabase.from('store_installations').update({ last_active_at: new Date().toISOString() }).eq('id', si.id);
    }
    if (!clientId) {
      const { data: ic } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
      if (ic) clientId = ic.client_id;
    }
    // Permanent condition → 200. Returning 4xx/5xx would make Shopify retry
    // forever and eventually auto-remove the webhook subscription.
    if (!clientId) {
      console.warn('[shopify-order-webhook] Shop not integrated (no-op):', shopDomain);
      return json({ message: 'Shop not integrated — ignored' });
    }

    // ── Upsert order into shopify_orders (all order topics) ──────────────────
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
    const { error: orderUpsertErr } = await supabase
      .from('shopify_orders')
      .upsert(orderRecord, { onConflict: 'shopify_order_id' });
    if (orderUpsertErr) console.error('[shopify-order-webhook] Order upsert failed:', orderUpsertErr.message);

    // ── Award points synchronously (fast path) for orders/paid ───────────────
    let pointsOutcome: Record<string, unknown> = { topic };
    if (topic === 'orders/paid') {
      pointsOutcome = await awardOrderPoints(supabase, clientId, order, customerEmail, customerPhone);
    }

    // ── Campaign evaluation + comms → background. The slow part (rule eval +
    //    a live Shopify Admin API customer fetch) no longer blocks the webhook
    //    response. Idempotent + re-run on the next order webhook, so deferring
    //    is safe; points (above) stay synchronous and reliable. ──────────────
    const transactionId = crypto.randomUUID();
    const shopifyOrderName: string | null = order.name ?? null;
    const bg = (async () => {
      try {
        await checkAndExecuteCampaignRules(supabase, clientId!, orderRecord, transactionId, shopifyOrderName);
        await checkAdvancedCampaignRules(supabase, clientId!, order, orderRecord, transactionId, shopifyOrderName);
        await processPendingCommunications(supabase);
      } catch (e) {
        console.error('[shopify-order-webhook] background campaign eval error:', (e as Error).message);
      }
    })();
    const fallback = runInBackground(bg);
    if (fallback) await fallback; // runtime lacks waitUntil → await before responding

    return json({ success: true, ...pointsOutcome });
  } catch (err) {
    // Genuine transient/unexpected failure → 500 so Shopify retries.
    console.error('[shopify-order-webhook] Unhandled error:', (err as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});

// ─── Points award (synchronous, idempotent) ──────────────────────────────────
// Returns a small status object. Permanent/expected conditions resolve to a
// no-op result (still HTTP 200 upstream); only true transient failures throw (→ 500).
async function awardOrderPoints(
  supabase: any, clientId: string, order: any,
  customerEmail: string | null, customerPhone: string | null,
): Promise<Record<string, unknown>> {
  if (!customerEmail && !customerPhone) return { status: 'no_identity' };

  const { data: program } = await supabase
    .from('loyalty_programs').select('id').eq('client_id', clientId).eq('is_active', true).maybeSingle();
  if (!program?.id) {
    console.warn('[shopify-order-webhook] No active loyalty program (no-op):', clientId);
    return { status: 'no_active_program' };
  }

  // Resolve/create member by email OR phone via the RPC (fixes the 42P10 upsert
  // failure and enables phone-only identity).
  const fullName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || '';
  const { data: memberId, error: rpcErr } = await supabase.rpc('resolve_or_create_member', {
    p_client_id: clientId,
    p_email: customerEmail,
    p_phone: customerPhone,
    p_name: fullName,
    p_external_id: order.customer?.id?.toString() || null,
  });
  if (rpcErr) throw new Error(`resolve_or_create_member: ${rpcErr.message}`); // transient → retry
  if (!memberId) return { status: 'no_member' };

  await supabase.from('shopify_orders').update({ member_id: memberId }).eq('shopify_order_id', order.id.toString());

  // Resolve a tier (default, else lowest-created)
  let tierId: string | null = null;
  const { data: defaultTier } = await supabase
    .from('loyalty_tiers').select('id').eq('loyalty_program_id', program.id).eq('is_default', true).maybeSingle();
  if (defaultTier?.id) tierId = defaultTier.id;
  else {
    const { data: firstTier } = await supabase
      .from('loyalty_tiers').select('id').eq('loyalty_program_id', program.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    tierId = firstTier?.id || null;
  }
  if (!tierId) {
    console.warn('[shopify-order-webhook] No tier configured (no-op) program:', program.id);
    return { status: 'no_tier' };
  }

  // Get-or-create loyalty status (this unique index is non-partial → onConflict OK)
  const { data: upsertedStatus } = await supabase
    .from('member_loyalty_status')
    .upsert({
      member_user_id: memberId,
      loyalty_program_id: program.id,
      current_tier_id: tierId,
      points_balance: 0,
      lifetime_points_earned: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'member_user_id,loyalty_program_id', ignoreDuplicates: true })
    .select('id, points_balance, lifetime_points_earned, current_tier_id, total_orders, total_spend')
    .maybeSingle();

  let status = upsertedStatus;
  if (!status) {
    const { data: existing } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_earned, current_tier_id, total_orders, total_spend')
      .eq('member_user_id', memberId).eq('loyalty_program_id', program.id).maybeSingle();
    status = existing;
  }
  if (!status) throw new Error('Failed to load loyalty status after upsert'); // transient → retry

  // Earn rates from current tier
  let earnRate = 1, earnDivisor = 1;
  if (status.current_tier_id) {
    const { data: tier } = await supabase
      .from('loyalty_tiers').select('points_earn_rate, points_earn_divisor').eq('id', status.current_tier_id).maybeSingle();
    if (tier) { earnRate = tier.points_earn_rate || 1; earnDivisor = tier.points_earn_divisor || 1; }
  }

  const orderTotal = parseFloat(order.total_price || '0');
  const pointsEarned = Math.floor((orderTotal / earnDivisor) * earnRate);
  if (pointsEarned <= 0) return { status: 'zero_points', order_total: orderTotal };

  // Idempotency: already awarded for this order?
  const { data: existingTxn } = await supabase
    .from('loyalty_points_transactions')
    .select('id').eq('member_user_id', memberId).eq('transaction_type', 'earned').eq('reference_id', order.id.toString()).maybeSingle();
  if (existingTxn) return { status: 'already_awarded' };

  const newBalance = (status.points_balance || 0) + pointsEarned;
  const newLifetime = (status.lifetime_points_earned || 0) + pointsEarned;

  const { error: updErr } = await supabase
    .from('member_loyalty_status')
    .update({
      points_balance: newBalance,
      lifetime_points_earned: newLifetime,
      total_orders: ((status as any).total_orders || 0) + 1,
      total_spend: ((status as any).total_spend || 0) + orderTotal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', status.id);
  if (updErr) throw new Error(`status update: ${updErr.message}`); // transient → retry

  const { error: txnErr } = await supabase
    .from('loyalty_points_transactions')
    .insert({
      member_loyalty_status_id: status.id,
      member_user_id: memberId,
      transaction_type: 'earned',
      points_amount: pointsEarned,
      balance_after: newBalance,
      reference_id: order.id.toString(),
      description: `Points earned on order ${order.name || '#' + order.id}`,
    });
  if (txnErr) throw new Error(`txn insert: ${txnErr.message}`); // transient → retry

  console.log(`[shopify-order-webhook] Awarded ${pointsEarned} pts to member ${memberId} for order ${order.id}`);
  return { status: 'awarded', points_awarded: pointsEarned, new_balance: newBalance, order_id: order.id };
}

// ─── Campaign evaluation helpers (unchanged; now invoked in the background) ───

async function logCampaignTrigger(
  supabase: any, clientId: string, campaignRuleId: string, orderRecord: any,
  result: string, reason: string, memberId: string | null = null,
  membershipId: string | null = null, metadata: any = {}
) {
  try {
    await supabase.from('campaign_trigger_logs').insert({
      client_id: clientId,
      campaign_rule_id: campaignRuleId,
      order_id: orderRecord.order_id,
      order_number: orderRecord.order_number,
      order_value: parseFloat(orderRecord.total_price),
      trigger_result: result,
      member_id: memberId,
      membership_id: membershipId,
      customer_email: orderRecord.customer_email,
      customer_phone: orderRecord.customer_phone,
      reason: reason,
      metadata: metadata,
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
        if (operator === 'eq') return count === parseInt(value);
        if (operator === 'lte') return count <= parseInt(value);
        return false;
      }
      case 'payment_method': {
        const gw = order.gateway?.toLowerCase() || '';
        const pgn = order.payment_gateway_names?.[0]?.toLowerCase() || '';
        if (value === 'cod') return gw.includes('cod') || pgn.includes('cash');
        if (value === 'prepaid') return !gw.includes('cod') && !pgn.includes('cash');
        return false;
      }
      case 'customer_type': {
        const oc = customer?.orders_count || 0;
        if (value === 'new') return oc <= 1;
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
        const sv = value.toLowerCase();
        if (operator === 'exact') return city === sv;
        if (operator === 'in_list') return value.split(',').map((v: string) => v.trim().toLowerCase()).includes(city);
        return false;
      }
      case 'shipping_pincode': {
        const pin = order.shipping_address?.zip || '';
        if (operator === 'exact') return pin === value;
        if (operator === 'starts_with') return pin.startsWith(value);
        if (operator === 'in_list') return value.split(',').map((v: string) => v.trim()).includes(pin);
        return false;
      }
      case 'shipping_state': {
        const state = order.shipping_address?.province?.toLowerCase() || '';
        const sv = value.toLowerCase();
        if (operator === 'exact') return state === sv;
        if (operator === 'in_list') return value.split(',').map((v: string) => v.trim().toLowerCase()).includes(state);
        return false;
      }
      case 'collection_contains': {
        const items: any[] = order.line_items || [];
        const sv = value.toLowerCase();
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
      .eq('client_id', clientId)
      .eq('is_active', true)
      .eq('trigger_type', 'advanced')
      .eq('rule_version', 2);

    if (error) { console.error('[shopify-order-webhook] Error fetching advanced rules:', error); return; }
    if (!rules || rules.length === 0) return;

    let customer = null;
    if (orderData.customer?.id) {
      const { data: store } = await supabase
        .from('store_installations')
        .select('access_token, shop_domain')
        .eq('client_id', clientId)
        .eq('installation_status', 'active')
        .maybeSingle();
      if (store?.access_token) {
        try {
          const plainToken = await decryptToken(store.access_token);
          const res = await fetch(
            `https://${store.shop_domain}/admin/api/2026-01/customers/${orderData.customer.id}.json`,
            { headers: { 'X-Shopify-Access-Token': plainToken } }
          );
          if (res.ok) customer = (await res.json()).customer;
        } catch (e) { console.error('[shopify-order-webhook] Error fetching customer:', e); }
      }
    }

    for (const rule of rules) {
      try {
        const { data: existing } = await supabase
          .from('campaign_trigger_logs')
          .select('id, trigger_result')
          .eq('campaign_rule_id', rule.id)
          .eq('order_id', orderRecord.order_id)
          .in('trigger_result', ['success', 'already_enrolled', 'max_reached', 'below_threshold', 'not_matched'])
          .maybeSingle();
        if (existing) continue;

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
        if (!memberId && ruleMode === 'standalone' && orderRecord.customer_email) {
          const { data: nm } = await supabase.from('member_users')
            .insert({ client_id: clientId, email: orderRecord.customer_email, full_name: orderRecord.customer_email })
            .select('id').single();
          if (nm) memberId = nm.id;
        }
        if (!memberId) {
          await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'no_member', 'No member found for this order', null, null, { campaign_name: rule.name, rule_type: 'advanced', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
          continue;
        }

        if (ruleMode === 'membership') {
          const { data: em } = await supabase.from('member_memberships').select('id').eq('member_id', memberId).eq('program_id', rule.program_id).maybeSingle();
          if (em) {
            await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'already_enrolled', 'Member already enrolled in program', memberId, em.id, { campaign_name: rule.name, rule_type: 'advanced', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
            continue;
          }
        }

        const ctx = { order: orderData, customer: customer || { email: orderRecord.customer_email, phone: orderRecord.customer_phone }, clientId };
        const triggerR = evaluateConditionsLocally(rule.trigger_conditions || [], ctx);
        const eligibilityR = evaluateConditionsLocally(rule.eligibility_conditions || [], ctx);
        const locationR = evaluateConditionsLocally(rule.location_conditions || [], ctx);
        const attributionR = evaluateConditionsLocally(rule.attribution_conditions || [], ctx);
        const allPassed = triggerR.allPassed &&
          (!(rule.eligibility_conditions?.length) || eligibilityR.allPassed) &&
          (!(rule.location_conditions?.length) || locationR.allPassed) &&
          (!(rule.attribution_conditions?.length) || attributionR.allPassed);

        if (allPassed) {
          if (ruleMode === 'standalone') {
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + (rule.link_expiry_hours || 72));
            let resolvedToken: string | null = null;
            const shopifyOrderRef = orderRecord.shopify_order_id;
            const { data: nt } = await supabase
              .from('campaign_tokens')
              .upsert(
                { campaign_rule_id: rule.id, shopify_order_ref: shopifyOrderRef, member_id: memberId, email: orderRecord.customer_email, phone: orderRecord.customer_phone || null, is_pre_verified: true, expires_at: expiresAt.toISOString() },
                { onConflict: 'campaign_rule_id,shopify_order_ref', ignoreDuplicates: true }
              )
              .select('token')
              .maybeSingle();
            if (nt) {
              resolvedToken = nt.token;
            } else {
              const { data: existing2, error: te } = await supabase
                .from('campaign_tokens').select('token').eq('campaign_rule_id', rule.id).eq('shopify_order_ref', shopifyOrderRef).maybeSingle();
              if (te || !existing2) {
                await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'failed', `Token creation failed: ${te?.message ?? 'not found'}`, memberId, null, { campaign_name: rule.name, rule_type: 'standalone', transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
                continue;
              }
              resolvedToken = existing2.token;
            }
            await supabase.rpc('increment_campaign_enrollments', { campaign_id: rule.id });
            await supabase.from('communication_logs').insert({ client_id: clientId, member_id: memberId, campaign_rule_id: rule.id, type: 'standalone_reward_link', status: 'queued', metadata: { token: resolvedToken, expires_at: expiresAt.toISOString(), order_id: orderRecord.order_id, campaign_name: rule.name } });
            const claimUrl = `${Deno.env.get('FRONTEND_URL') || 'https://goself.netlify.app'}/claim-rewards?token=${resolvedToken}`;
            await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'success', 'Standalone campaign token issued', memberId, null, { campaign_name: rule.name, rule_type: 'standalone', token: resolvedToken, reward_link: claimUrl, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
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
          await logCampaignTrigger(supabase, clientId, rule.id, orderRecord, 'not_matched', `Conditions not met: ${failed.join(', ')}`, memberId, null, { campaign_name: rule.name, rule_type: 'advanced', failed_conditions: failed, transaction_id: transactionId, campaign_display_id: rule.campaign_id, shopify_order_name: shopifyOrderName });
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
      .from('campaign_rules')
      .select('*, membership_programs(*)')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .eq('trigger_type', 'order_value');
    if (error || !rules || rules.length === 0) return;

    const sorted = rules.sort((a: any, b: any) => (b.trigger_conditions?.min_order_value || 0) - (a.trigger_conditions?.min_order_value || 0));
    for (const rule of sorted) {
      const minVal = rule.trigger_conditions?.min_order_value || 0;
      const { data: existing } = await supabase.from('campaign_trigger_logs').select('id').eq('campaign_rule_id', rule.id).eq('order_id', orderRecord.order_id).in('trigger_result', ['success', 'already_enrolled', 'max_reached', 'below_threshold', 'not_matched']).maybeSingle();
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
