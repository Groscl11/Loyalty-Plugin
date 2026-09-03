/**
 * issue-widget-token — C-01 fix
 *
 * Issues a short-lived HMAC-signed widget token that proves a customer is an
 * enrolled loyalty member for a specific shop. All protected widget endpoints
 * require this token in the X-Widget-Token header instead of trusting email /
 * member_user_id values from the request body.
 *
 * POST /issue-widget-token
 * Body: { email: string, shop_domain: string }
 *
 * Response: { token, member_user_id, client_id, expires_at }
 *
 * Rate limiting: Supabase edge function invocation limits apply.
 * The endpoint returns 404 for unknown email+shop combinations so it cannot
 * be used to enumerate whether an email is registered on a given shop.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getWidgetCorsHeaders } from '../_shared/cors.ts';
import { issueWidgetToken, WIDGET_TOKEN_TTL } from '../_shared/widget-auth.ts';

Deno.serve(async (req: Request) => {
  // Widget CORS (reflects origin): this issuer runs on arbitrary merchant
  // storefronts AND inside the sandboxed checkout-extension origin. It is gated
  // by knowledge of a valid (email, shop) pair returning a short-lived HMAC
  // token, uses no cookies, and CORS is not its access-control boundary.
  const corsHeaders = getWidgetCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  // Require WIDGET_TOKEN_SECRET to be configured
  if (!Deno.env.get('WIDGET_TOKEN_SECRET')) {
    console.error('[issue-widget-token] WIDGET_TOKEN_SECRET not set');
    return json({ error: 'Server misconfiguration' }, 500);
  }

  try {
    const { email, shop_domain } = await req.json();

    if (!email || !shop_domain) {
      return json({ error: 'email and shop_domain are required' }, 400);
    }

    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop_domain)) {
      return json({ error: 'Invalid shop_domain format' }, 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Masked diagnostics only (no full PII, no enumeration via response body).
    // mask: keep first 2 chars of local-part + domain →  sh***@gmail.com
    const maskEmail = (e: string) => {
      const [lp, dom] = e.split('@');
      if (!dom) return '***';
      return `${lp.slice(0, 2)}***@${dom}`;
    };

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Resolve client_id from shop_domain ───────────────────────────────────
    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop_domain)
      .eq('installation_status', 'active')
      .maybeSingle();

    if (!si?.client_id) {
      // Return generic 404 — don't reveal whether shop exists
      console.warn(`[issue-widget-token] 404 NO_ACTIVE_INSTALL shop=${shop_domain} email=${maskEmail(normalizedEmail)}`);
      return json({ error: 'Not found' }, 404);
    }

    const clientId: string = si.client_id;

    // ── Resolve member — must belong to this specific client ─────────────────
    const { data: member } = await supabase
      .from('member_users')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('client_id', clientId)
      .maybeSingle();

    if (!member) {
      // Generic 404 — don't reveal whether email is registered elsewhere
      console.warn(`[issue-widget-token] 404 NO_MEMBER_MATCH shop=${shop_domain} client=${clientId} email=${maskEmail(normalizedEmail)}`);
      return json({ error: 'Not found' }, 404);
    }

    // ── Issue token ──────────────────────────────────────────────────────────
    const token = await issueWidgetToken(member.id, clientId);
    const expiresAt = new Date(Date.now() + WIDGET_TOKEN_TTL * 1000).toISOString();

    return json({
      token,
      member_user_id: member.id,
      client_id: clientId,
      expires_at: expiresAt,
    });

  } catch (err) {
    console.error('[issue-widget-token] error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
