import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { widget_id, shop_domain } = await req.json();

    if (!widget_id) {
      return new Response(
        JSON.stringify({ error: "widget_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get widget configuration
    const { data: config, error } = await supabase
      .rpc('get_widget_config', {
        p_widget_id: widget_id,
        p_shop_domain: shop_domain
      })
      .maybeSingle();

    if (error || !config) {
      return new Response(
        JSON.stringify({
          error: "Widget configuration not found",
          widget_id,
          shop_domain
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Track widget view
    if (config.id) {
      await supabase
        .from("widget_analytics")
        .insert({
          widget_config_id: config.id,
          event_type: "view",
          metadata: {
            shop_domain,
            user_agent: req.headers.get("user-agent"),
          },
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        config: config.config,
        styles: config.styles,
        content: config.content,
        placement: config.placement,
        widget_type: config.widget_type,
        widget_config_id: config.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in get-widget-config:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
