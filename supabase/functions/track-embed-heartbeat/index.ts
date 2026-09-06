/**
 * track-embed-heartbeat
 *
 * Called once per visitor session by the "Affiliate Attribution Tracking"
 * theme app embed. Records that the embed is live on this shop's theme so the
 * dashboard can tell the merchant whether attribution tracking is actually
 * switched on, and prompt them to enable it if not.
 *
 * Why self-reporting instead of reading the theme: detecting the embed
 * server-side means reading config/settings_data.json via the Admin API, which
 * needs the read_themes scope — adding a scope forces a re-consent screen on
 * every existing install. Not worth it for a status indicator.
 *
 * Public and unauthenticated (called from the storefront), same posture as
 * track-utm-click. It can only ever bump a timestamp on a shop that is already
 * an active installation — no data is read back, nothing else is writable.
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

    if (!shop || !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase
      .from('store_installations')
      .update({ attribution_embed_last_seen_at: new Date().toISOString() })
      .eq('shop_domain', shop)
      .eq('installation_status', 'active');

    if (error) console.error('[track-embed-heartbeat] update failed:', error.message);

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    console.error('[track-embed-heartbeat] error:', (err as Error).message);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
});
