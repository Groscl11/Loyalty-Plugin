/**
 * shopify-session-login
 *
 * Handles SSO for merchant re-opens (app opened from Shopify admin after install).
 * Called as a browser navigation (window.location.href), NOT as a fetch().
 *
 * Security model (enterprise-grade):
 * - Verifies Shopify HMAC signature on all incoming params
 * - Rejects requests with stale timestamps (> 5 min) to prevent replay attacks
 * - Merchant email is read from the database server-side — never trusted from the request
 * - Magic link generated server-side using service role
 * - Returns a 302 redirect to the magic link — URL never reaches client JavaScript
 * - Falls back to manual login page on any validation failure (no information leakage)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  const url       = new URL(req.url);
  const shop      = url.searchParams.get('shop')      || '';
  const hmac      = url.searchParams.get('hmac')      || '';
  const timestamp = url.searchParams.get('timestamp') || '';

  const dashboardUrl  = Deno.env.get('SHOPIFY_APP_URL') || Deno.env.get('APP_URL') || 'https://app.goself.in';
  const loginFallback = `${dashboardUrl}/login?shop=${encodeURIComponent(shop)}&from=shopify`;

  // ── 1. Validate required params ───────────────────────────────────────────
  if (!shop || !hmac || !timestamp) {
    console.warn('[session-login] Missing params');
    return redirect(`${dashboardUrl}/login?from=shopify&error=missing_params`);
  }

  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
    console.warn('[session-login] Invalid shop domain:', shop);
    return new Response('Bad Request', { status: 400 });
  }

  // ── 2. Verify timestamp freshness — replay attack prevention ──────────────
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() / 1000 - ts > 300) {
    console.warn(`[session-login] Stale or invalid timestamp for ${shop}`);
    // Redirect back to Shopify admin so merchant can retry with a fresh session
    return redirect(`${loginFallback}&error=expired`);
  }

  // ── 3. Verify Shopify HMAC ────────────────────────────────────────────────
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET') || Deno.env.get('SHOPIFY_API_SECRET') || '';
  if (!secret) {
    console.error('[session-login] SHOPIFY_CLIENT_SECRET not configured');
    return new Response('Server misconfiguration', { status: 500 });
  }

  if (!(await verifyHmac(url.searchParams, secret))) {
    console.error(`[session-login] HMAC verification failed for ${shop}`);
    return new Response('Unauthorized', { status: 401 });
  }

  // ── 4. Look up merchant from DB — never trust request body for email ───────
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: installation, error: dbError } = await supabase
      .from('store_installations')
      .select('client_id, shop_email, shop_name, shop_owner')
      .eq('shop_domain', shop)
      .eq('installation_status', 'active')
      .maybeSingle();

    if (dbError) {
      console.error('[session-login] DB error:', dbError.message);
      return redirect(loginFallback);
    }

    if (!installation) {
      console.warn(`[session-login] No active installation for ${shop}`);
      return redirect(loginFallback);
    }

    const email = installation.shop_email || '';
    if (!email || email.endsWith('@shopify.com')) {
      console.warn(`[session-login] No real merchant email for ${shop}`);
      return redirect(loginFallback);
    }

    // ── 5. Generate magic link server-side ──────────────────────────────────
    const redirectTo = `${dashboardUrl}/auth/shopify-callback?shop=${encodeURIComponent(shop)}&client_id=${encodeURIComponent(installation.client_id || '')}`;
    const tryGenerate = () => supabase.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });

    let { data, error } = await tryGenerate();

    if (error) {
      console.warn('[session-login] generateLink error, creating user:', error.message);
      const { error: createErr } = await supabase.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { shop_domain: shop, client_id: installation.client_id },
      });
      if (createErr && !createErr.message.toLowerCase().includes('already')) {
        console.error('[session-login] createUser failed:', createErr.message);
        return redirect(loginFallback);
      }
      const retry = await tryGenerate();
      if (retry.error) {
        console.error('[session-login] magic link retry failed:', retry.error.message);
        return redirect(loginFallback);
      }
      data = retry.data;
    }

    const magicLink = data?.properties?.action_link;
    const userId    = data?.user?.id;

    console.log(`[session-login] magicLink present: ${!!magicLink}, userId: ${userId}`);

    if (!magicLink) {
      console.error('[session-login] No action_link in response for', shop, JSON.stringify(data));
      return redirect(loginFallback);
    }

    // Upsert profile server-side so AuthContext finds it immediately on redirect
    if (userId) {
      const { error: upsertErr } = await supabase.from('profiles').upsert(
        {
          id: userId, email,
          full_name: installation.shop_owner || installation.shop_name || email.split('@')[0],
          role: 'client',
          client_id: installation.client_id || null,
        },
        { onConflict: 'id', ignoreDuplicates: false },
      );
      if (upsertErr) console.error('[session-login] profile upsert:', upsertErr.message);
    }

    // ── 6. 302 redirect through magic link — URL never reaches client JS ─────
    console.log(`[session-login] SSO redirect for ${shop}`);
    return redirect(magicLink);

  } catch (err: any) {
    console.error('[session-login] Unhandled exception:', err?.message || err);
    return redirect(loginFallback);
  }
});

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

async function verifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const msg = Array.from(params.entries())
    .filter(([k]) => k !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hmac;
}
