import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { shop_domain, email, client_id, shop_name, shop_owner, redirect_to } = await req.json();

    if (!email || !shop_domain || !redirect_to) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const generateLink = () =>
      supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: redirect_to },
      });

    let { data: linkData, error: linkError } = await generateLink();

    if (linkError) {
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          shop_domain,
          client_id,
          shop_name,
          shop_owner,
        },
      });

      if (createError && !createError.message.toLowerCase().includes('already')) {
        console.error('[shopify-merchant-login] Failed to create user:', createError);
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const retry = await generateLink();
      linkData = retry.data;
      linkError = retry.error;
    }

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[shopify-merchant-login] Failed to generate magic link:', linkError);
      // Fall back to sending email
      const { error: emailError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (emailError) {
        return new Response(JSON.stringify({ error: emailError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ email_sent: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = linkData.user?.id;
    if (userId) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          email,
          full_name: shop_owner || shop_name || email.split('@')[0],
          role: 'client',
          client_id: client_id || null,
        }, { onConflict: 'id', ignoreDuplicates: false });

      if (profileError) {
        console.error('[shopify-merchant-login] Failed to upsert profile:', profileError);
      }
    }

    return new Response(JSON.stringify({
      magic_link: linkData.properties.action_link,
      user_id: userId,
      email_sent: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[shopify-merchant-login] Unexpected error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
