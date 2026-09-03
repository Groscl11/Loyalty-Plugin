import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptToken } from '../_shared/token-crypto.ts';

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

async function shopifyPost(shop: string, token: string, path: string, payload: unknown): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2025-01${path}`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { /* non-JSON body (HTML error page, etc.) */ }
  if (!res.ok) {
    const msg = data?.errors
      ? JSON.stringify(data.errors)
      : `Shopify ${path} → ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function shopifyGet(shop: string, token: string, path: string): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2025-01${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(`Shopify GET ${path} → ${res.status}`);
  return data;
}

/** Generate random alphanumeric suffix */
function randomSuffix(len = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0 to avoid confusion
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Poll batch job until done or timeout */
async function pollBatch(
  shop: string, token: string, priceRuleId: number, batchId: number, maxMs = 20_000,
): Promise<string[]> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const data = await shopifyGet(
      shop, token,
      `/price_rules/${priceRuleId}/batch_discount_codes/${batchId}.json`,
    );
    const batch = data.discount_codes_creation;
    if (batch?.status === 'completed' || batch?.status === 'done') {
      // Fetch the actual codes
      const codesData = await shopifyGet(
        shop, token,
        `/price_rules/${priceRuleId}/discount_codes.json?limit=250`,
      );
      return (codesData.discount_codes || []).map((c: any) => c.code as string);
    }
    if (batch?.status === 'errored') throw new Error('Shopify batch discount creation errored');
  }
  throw new Error('Timed out waiting for Shopify batch discount codes');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const body = await req.json();
    const {
      client_id,
      shop_domain,
      title,
      reward_type,          // 'flat_discount' | 'percentage_discount'
      discount_value,       // number
      min_purchase_amount,  // number (0 = no minimum)
      codes_count,          // number (1–250)
      code_prefix,          // string
      usage_limit_per_code, // number (0 = unlimited)
      valid_until,          // ISO date string or null
      shopify_customer_id,  // M-15: optional — bind code to a specific customer
    } = body;

    if (!client_id || !title || discount_value == null) {
      return json({ success: false, error: 'client_id, title, and discount_value are required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Resolve access token ─────────────────────────────────────────────────
    let q = supabase
      .from('store_installations')
      .select('access_token, shop_domain')
      .eq('installation_status', 'active');
    if (shop_domain) q = q.eq('shop_domain', shop_domain);
    else             q = q.eq('client_id', client_id);

    const { data: installation } = await q.maybeSingle();

    if (!installation?.access_token) {
      return json({ success: false, error: 'No active Shopify store connected. Complete store setup first.' }, 404);
    }

    const shop  = installation.shop_domain;
    const token = await decryptToken(installation.access_token); // C-03

    // ── 1. Create price rule ─────────────────────────────────────────────────
    const valueType = reward_type === 'percentage_discount' ? 'percentage' : 'fixed_amount';
    const value     = valueType === 'percentage'
      ? -Math.abs(discount_value)           // Shopify uses negative for percentage
      : -Math.abs(discount_value);          // and negative for fixed amount too

    const priceRulePayload: any = {
      price_rule: {
        title: `Loyalty: ${title}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: valueType,
        value: String(value),
        // M-15: bind to specific customer when shopify_customer_id is provided
        // For bulk catalog codes (no customer specified), keep 'all'
        customer_selection: shopify_customer_id ? 'prerequisite' : 'all',
        starts_at: new Date().toISOString(),
      },
    };

    if (valid_until) {
      priceRulePayload.price_rule.ends_at = new Date(valid_until).toISOString();
    }

    if (min_purchase_amount > 0) {
      priceRulePayload.price_rule.prerequisite_subtotal_range = {
        greater_than_or_equal_to: String(min_purchase_amount),
      };
    }

    if (usage_limit_per_code > 0) {
      priceRulePayload.price_rule.usage_limit = codes_count * usage_limit_per_code;
    }

    // M-15: when binding to a specific customer, add them as the only entitled customer
    if (shopify_customer_id) {
      priceRulePayload.price_rule.prerequisite_customer_ids = [Number(shopify_customer_id)];
    }

    const priceRuleData = await shopifyPost(shop, token, '/price_rules.json', priceRulePayload);
    const priceRuleId: number = priceRuleData.price_rule?.id;

    if (!priceRuleId) throw new Error('Failed to create Shopify price rule');

    console.log(`[shopify-create-discount] Created price rule ${priceRuleId} for ${shop}`);

    // ── 2. Generate unique codes locally and batch-create in Shopify ─────────
    const count      = Math.min(Math.max(1, codes_count || 10), 250);
    const prefix     = (code_prefix || title.replace(/\s+/g, '').toUpperCase().slice(0, 4)).toUpperCase();
    const usedSuffixes = new Set<string>();

    const codeObjects = Array.from({ length: count }, () => {
      let suffix: string;
      do { suffix = randomSuffix(6); } while (usedSuffixes.has(suffix));
      usedSuffixes.add(suffix);
      return { code: `${prefix}-${suffix}` };
    });

    // Shopify batch create
    const batchData = await shopifyPost(
      shop, token,
      `/price_rules/${priceRuleId}/batch_discount_codes.json`,
      { codes: codeObjects },
    );

    const batchId: number = batchData.discount_codes_creation?.id;
    if (!batchId) throw new Error('Shopify did not return a batch ID');

    console.log(`[shopify-create-discount] Batch ${batchId} queued, polling…`);

    // ── 3. Poll until batch completes ────────────────────────────────────────
    const codes = await pollBatch(shop, token, priceRuleId, batchId, 25_000);

    console.log(`[shopify-create-discount] Created ${codes.length} codes for price rule ${priceRuleId}`);

    return json({ success: true, codes, price_rule_id: priceRuleId });

  } catch (err: any) {
    console.error('[shopify-create-discount] error:', err.message);
    return json({ success: false, error: err.message }, 500);
  }
});
