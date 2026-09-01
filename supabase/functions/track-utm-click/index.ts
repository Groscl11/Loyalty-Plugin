import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const url = new URL(req.url);
  const slug = url.searchParams.get('s');
  const ref = url.searchParams.get('ref');

  if (!slug && !ref) {
    return new Response('Missing slug or ref', { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const query = supabase
    .from('attribution_utm_links')
    .select('id, destination_url, attribution_param_name, attribution_param_value, utm_source, utm_medium, utm_campaign, utm_content, utm_term, clicks');

  const { data: link, error } = slug
    ? await query.eq('slug', slug).maybeSingle()
    : await query.eq('attribution_param_value', ref).maybeSingle();

  if (error || !link) {
    return new Response('Link not found', { status: 404, headers: corsHeaders });
  }

  // Increment click count (fire and forget)
  supabase
    .from('attribution_utm_links')
    .update({ clicks: (link.clicks ?? 0) + 1 })
    .eq('id', link.id)
    .then(() => {});

  // Beacon mode (ref, no slug): just acknowledge — the visitor is already on
  // the destination page (a raw long-form link was used, not a short link).
  if (!slug) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Redirect mode (slug): build the full attribution URL and 302 the visitor.
  const dest = link.destination_url;
  const params: string[] = [];

  if (link.attribution_param_value) {
    const paramName = link.attribution_param_name || 'ref';
    params.push(`${paramName}=${encodeURIComponent(link.attribution_param_value)}`);
  }
  if (link.utm_source)   params.push(`utm_source=${encodeURIComponent(link.utm_source)}`);
  if (link.utm_medium)   params.push(`utm_medium=${encodeURIComponent(link.utm_medium)}`);
  if (link.utm_campaign) params.push(`utm_campaign=${encodeURIComponent(link.utm_campaign)}`);
  if (link.utm_content)  params.push(`utm_content=${encodeURIComponent(link.utm_content)}`);
  if (link.utm_term)     params.push(`utm_term=${encodeURIComponent(link.utm_term)}`);

  const separator = dest.includes('?') ? '&' : '?';
  const redirectUrl = params.length > 0 ? `${dest}${separator}${params.join('&')}` : dest;

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: redirectUrl,
      'Cache-Control': 'no-store',
    },
  });
});
