import { createClient } from 'npm:@supabase/supabase-js@2';

// H-24: No CORS headers — Shopify server-to-server webhooks never send Origin.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// C-11: Constant-time comparison to prevent HMAC timing oracle attacks.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyWebhookHmac(rawBody: string, hmacHeader: string): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || Deno.env.get('SHOPIFY_API_SECRET');
  if (!secret || !hmacHeader) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(computed, hmacHeader);
}

/**
 * app/uninstalled webhook handler.
 *
 * Shopify sends this immediately when a merchant uninstalls the app.
 * We must respond 200 quickly — Shopify retries on any non-2xx.
 *
 * Actions:
 *   1. Verify HMAC (H-24 / C-11)
 *   2. Set store_installations.installation_status = 'uninstalled' + uninstalled_at
 *   3. Set clients.is_active = false for the matching client
 *
 * Does NOT delete data — that happens in shop/redact 48 days later.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('Method Not Allowed', { status: 405 });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const rawBody = await req.text();
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256') || '';

  const isValid = await verifyWebhookHmac(rawBody, hmacHeader);
  if (!isValid) {
    console.error('[app-uninstalled] Invalid HMAC signature');
    return json({ error: 'Invalid webhook signature' }, 401);
  }

  const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';
  if (!shopDomain) {
    console.error('[app-uninstalled] Missing X-Shopify-Shop-Domain header');
    return json({ error: 'Missing shop domain' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const uninstalledAt = new Date().toISOString();

  // 1. Mark store installation as uninstalled
  const { data: si, error: siErr } = await supabase
    .from('store_installations')
    .update({
      installation_status: 'uninstalled',
      uninstalled_at: uninstalledAt,
    })
    .eq('shop_domain', shopDomain)
    .select('client_id')
    .maybeSingle();

  if (siErr) {
    console.error('[app-uninstalled] store_installations update error:', siErr.message);
  }

  const clientId = si?.client_id ?? null;

  // 2. Mark the client inactive so the admin dashboard reflects reality
  if (clientId) {
    const { error: clientErr } = await supabase
      .from('clients')
      .update({ is_active: false })
      .eq('id', clientId);
    if (clientErr) {
      console.error('[app-uninstalled] clients update error:', clientErr.message);
    }
  } else {
    // Fallback: some early installs used integration_configs instead of store_installations
    const { data: ic } = await supabase
      .from('integration_configs')
      .select('client_id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();
    if (ic?.client_id) {
      await supabase.from('clients').update({ is_active: false }).eq('id', ic.client_id);
    }
  }

  console.log(`[app-uninstalled] ${shopDomain} marked uninstalled at ${uninstalledAt}`);
  return json({ success: true });
});
