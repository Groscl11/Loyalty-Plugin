import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── GraphQL query — fetches all discounts; we filter code-type by __typename ──
const GQL_QUERY = `
query FetchDiscountCodes($cursor: String) {
  discountNodes(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      discount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          endsAt
          codes(first: 10) { nodes { code } }
          minimumRequirement {
            ... on DiscountMinimumSubtotal {
              greaterThanOrEqualToSubtotal { amount }
            }
          }
          customerGets {
            value {
              __typename
              ... on DiscountAmount    { amount { amount } }
              ... on DiscountPercentage { percentage }
            }
          }
        }
        ... on DiscountCodeFreeShipping {
          title
          status
          endsAt
          codes(first: 10) { nodes { code } }
          minimumRequirement {
            ... on DiscountMinimumSubtotal {
              greaterThanOrEqualToSubtotal { amount }
            }
          }
        }
        ... on DiscountCodeBxgy {
          title
          status
          endsAt
          codes(first: 10) { nodes { code } }
        }
      }
    }
  }
}`;

// Only these __typename values are code-based discounts (not automatic)
const CODE_DISCOUNT_TYPES = new Set([
  'DiscountCodeBasic',
  'DiscountCodeFreeShipping',
  'DiscountCodeBxgy',
]);

class TokenExpiredError extends Error {
  constructor(status: number) {
    super(`Shopify GraphQL → ${status}`);
    this.name = 'TokenExpiredError';
  }
}

async function graphql(shop: string, token: string, query: string, variables: Record<string, any> = {}): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new TokenExpiredError(res.status);
  if (!res.ok) throw new Error(`Shopify GraphQL → ${res.status}`);
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(data.errors.map((e: any) => e.message).join('; '));
  }
  return data;
}

/** Map a DiscountCodeBasic/Bxgy/FreeShipping node to our format. Returns null for automatic discounts. */
function mapDiscount(node: any, importedCodeSet: Set<string>): any | null {
  const d = node.discount;
  if (!d) return null;

  const typename: string = d.__typename || '';

  // Skip automatic discounts — only keep code-type discounts
  if (!CODE_DISCOUNT_TYPES.has(typename)) return null;

  const codes: string[] = (d.codes?.nodes || []).map((c: any) => c.code as string);
  const totalCodes: number = codes.length;

  let rewardType = 'flat_discount';
  let discountValue = 0;
  let minPurchase = 0;

  if (typename === 'DiscountCodeBasic') {
    const val = d.customerGets?.value;
    if (val?.__typename === 'DiscountPercentage') {
      rewardType = 'percentage_discount';
      discountValue = Math.round((val.percentage ?? 0) * 100);
    } else if (val?.__typename === 'DiscountAmount') {
      rewardType = 'flat_discount';
      discountValue = parseFloat(val.amount?.amount ?? '0');
    }
    minPurchase = parseFloat(
      d.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount ?? '0',
    );
  } else if (typename === 'DiscountCodeFreeShipping') {
    rewardType = 'flat_discount';
    discountValue = 0;
    minPurchase = parseFloat(
      d.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount ?? '0',
    );
  } else if (typename === 'DiscountCodeBxgy') {
    rewardType = 'flat_discount';
  }

  const alreadyImported = codes.some((c) => importedCodeSet.has(c.toUpperCase()));

  return {
    id: node.id,          // gid://shopify/DiscountCodeNode/123
    title: d.title,
    reward_type: rewardType,
    discount_value: discountValue,
    min_purchase_amount: minPurchase,
    ends_at: d.endsAt ?? null,
    status: (d.status ?? '').toLowerCase(),
    codes,
    total_codes: totalCodes,
    already_imported: alreadyImported,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url        = new URL(req.url);
    const shopDomain = url.searchParams.get('shop_domain') || '';
    const clientId   = url.searchParams.get('client_id')   || '';

    if (!shopDomain && !clientId) {
      return json({ success: false, error: 'shop_domain or client_id is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Resolve installation ──────────────────────────────────────────────────
    let q = supabase
      .from('store_installations')
      .select('access_token, shop_domain, client_id')
      .eq('installation_status', 'active');
    if (shopDomain) q = q.eq('shop_domain', shopDomain);
    else            q = q.eq('client_id', clientId);

    const { data: installation } = await q.maybeSingle();
    if (!installation?.access_token) {
      return json({ success: false, error: 'No active Shopify store connected. Complete store setup first.' }, 404);
    }

    const shop             = installation.shop_domain;
    const token            = installation.access_token;
    const resolvedClientId = clientId || installation.client_id;

    // ── Get already-imported codes from our DB ────────────────────────────────
    // Check both offer_codes (unique/bulk imports) and generic_coupon_code (single-code imports)
    const { data: ownedRewards } = await supabase
      .from('rewards')
      .select('id, generic_coupon_code')
      .eq('owner_client_id', resolvedClientId);

    const ownedRewardIds = (ownedRewards || []).map((r: any) => r.id);
    const importedCodeSet = new Set<string>();

    // Add generic_coupon_code values (single-code imports stored on the reward row itself)
    for (const r of ownedRewards || []) {
      if (r.generic_coupon_code) importedCodeSet.add((r.generic_coupon_code as string).toUpperCase());
    }

    // Add unique codes from offer_codes table (bulk/multi-code imports)
    if (ownedRewardIds.length > 0) {
      const { data: existingCodes } = await supabase
        .from('offer_codes')
        .select('code')
        .in('offer_id', ownedRewardIds);
      for (const c of existingCodes || []) {
        if (c.code) importedCodeSet.add((c.code as string).toUpperCase());
      }
    }

    // ── Fetch via GraphQL, paginate up to 100 code discounts ─────────────────
    const results: any[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage && results.length < 100) {
      const data = await graphql(shop, token, GQL_QUERY, cursor ? { cursor } : {});
      const page = data?.data?.discountNodes;
      if (!page) break;

      for (const node of page.nodes || []) {
        const mapped = mapDiscount(node, importedCodeSet);
        if (mapped) results.push(mapped);
      }

      hasNextPage = page.pageInfo?.hasNextPage ?? false;
      cursor      = page.pageInfo?.endCursor   ?? null;
    }

    console.log(`[shopify-fetch-discounts] Found ${results.length} code discounts for ${shop}`);

    return json({ success: true, price_rules: results });

  } catch (err: any) {
    console.error('[shopify-fetch-discounts] error:', err.message);
    const isTokenExpired = err instanceof TokenExpiredError;
    return json({
      success: false,
      error: err.message,
      token_expired: isTokenExpired,
    }, isTokenExpired ? 401 : 500);
  }
});
