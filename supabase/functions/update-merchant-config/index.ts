import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'PATCH' && req.method !== 'POST') return json({ error: 'PATCH or POST required' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const {
      shop_domain,
      prizes,
      settings,
    } = body as {
      shop_domain?: string;
      prizes?: unknown;
      settings?: Record<string, unknown>;
    };

    if (!shop_domain) {
      return json({ error: 'shop_domain is required' }, 400);
    }

    // ── Resolve client_id ────────────────────────────────────────────────────
    let clientId: string | null = null;
    let tableUsed: 'store_installations' | 'integration_configs' | null = null;

    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop_domain)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (si) { clientId = si.client_id; tableUsed = 'store_installations'; }

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shop_domain)
        .maybeSingle();
      if (ic) { clientId = ic.client_id; tableUsed = 'integration_configs'; }
    }

    if (!clientId) {
      return json({ error: 'Shop not found or not integrated', shop_domain }, 404);
    }

    // ── Build settings payload ────────────────────────────────────────────────
    // Merge explicit settings + prizes into communication_settings JSONB on clients.
    const newSettings: Record<string, unknown> = { ...(settings || {}) };
    if (prizes !== undefined) {
      newSettings.leaderboard_prizes = prizes;
    }
    newSettings.updated_at = new Date().toISOString();

    // Read existing communication_settings so we merge (not overwrite) the whole object
    const { data: existingClient } = await supabase
      .from('clients')
      .select('communication_settings')
      .eq('id', clientId)
      .maybeSingle();

    const merged = {
      ...(existingClient?.communication_settings || {}),
      ...newSettings,
    };

    const { error: clientErr } = await supabase
      .from('clients')
      .update({ communication_settings: merged, updated_at: new Date().toISOString() })
      .eq('id', clientId);

    if (clientErr) {
      console.error('[update-merchant-config] clients update failed:', clientErr.message);
      return json({
        error: 'Failed to save config',
        details: clientErr.message,
      }, 500);
    }

    return json({ success: true, client_id: clientId, updated: newSettings });
  } catch (err) {
    console.error('[update-merchant-config] unexpected error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
