/**
 * track-checkout-attribution
 *
 * Called by the attribution-pixel Web Pixel at checkout_completed with the
 * ref it saw on this visitor's last tracked page view + the checkout token
 * Shopify assigned to this checkout. Stashes the pair in
 * pending_checkout_attributions; shopify-order-webhook joins it back to the
 * order it receives moments later by checkout token.
 *
 * This is the order-level counterpart to track-utm-click's click counting —
 * both exist because goself-attribution.js (the note_attributes-writing
 * storefront script) requires a merchant to manually edit their theme, which
 * most never do. Best-effort, no auth (called from the storefront pixel
 * sandbox) — a bad payload just means that one order stays unattributed,
 * never a hard failure for the shopper.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response('POST required', { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const shop: string = (body.shop || '').trim().toLowerCase();
    const checkoutToken: string = (body.checkout_token || '').trim();
    const ref: string = (body.ref || '').trim();
    const source: string | null = body.source || null;
    const medium: string | null = body.medium || null;
    const campaign: string | null = body.campaign || null;

    if (!shop || !checkoutToken || !ref) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: installation } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (!installation?.client_id) return new Response(null, { status: 204, headers: corsHeaders });

    const { data: utmLink } = await supabase
      .from('attribution_utm_links')
      .select('id, partner_id')
      .eq('client_id', installation.client_id)
      .eq('attribution_param_value', ref)
      .maybeSingle();

    const { error } = await supabase
      .from('pending_checkout_attributions')
      .upsert({
        client_id: installation.client_id,
        checkout_token: checkoutToken,
        ref,
        source,
        medium,
        campaign,
        utm_link_id: utmLink?.id ?? null,
        partner_id: utmLink?.partner_id ?? null,
      }, { onConflict: 'client_id,checkout_token' });

    if (error) console.error('[track-checkout-attribution] upsert failed:', error.message);

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    console.error('[track-checkout-attribution] error:', (err as Error).message);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
});
