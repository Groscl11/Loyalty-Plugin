import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      member_user_id,
      client_id,
      date_of_birth,
      anniversary_date,
    } = body as {
      member_user_id?: string;
      client_id?: string;
      date_of_birth?: string | null;
      anniversary_date?: string | null;
    };

    if (!member_user_id || !client_id) {
      return json({ error: "member_user_id and client_id are required" }, 400);
    }

    // Verify member belongs to this client
    const { data: member, error: memberErr } = await supabase
      .from("member_users")
      .select("id, date_of_birth, anniversary_date")
      .eq("id", member_user_id)
      .eq("client_id", client_id)
      .maybeSingle();

    if (memberErr || !member) {
      return json({ error: "Member not found for this client" }, 404);
    }

    // Build update payload — only include fields that were sent
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    if (date_of_birth !== undefined) {
      // Basic date format validation YYYY-MM-DD
      if (date_of_birth !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
        return json({ error: "date_of_birth must be YYYY-MM-DD format" }, 400);
      }
      updates.date_of_birth = date_of_birth;
    }

    if (anniversary_date !== undefined) {
      if (anniversary_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(anniversary_date)) {
        return json({ error: "anniversary_date must be YYYY-MM-DD format" }, 400);
      }
      updates.anniversary_date = anniversary_date;
    }

    if (Object.keys(updates).length === 1) {
      // only updated_at — nothing to do
      return json({ success: true, message: "No fields to update", member_user_id });
    }

    const { error: updateErr } = await supabase
      .from("member_users")
      .update(updates)
      .eq("id", member_user_id);

    if (updateErr) {
      console.error("Profile update error:", updateErr);
      return json({ error: "Failed to update member profile" }, 500);
    }

    console.log(`Profile updated for member ${member_user_id}:`, JSON.stringify(updates));

    return json({
      success: true,
      member_user_id,
      updated_fields: Object.keys(updates).filter(k => k !== "updated_at"),
      // Indicate if this is a new save (was null before)
      birthday_newly_saved: date_of_birth !== undefined && !member.date_of_birth && !!date_of_birth,
      anniversary_newly_saved: anniversary_date !== undefined && !member.anniversary_date && !!anniversary_date,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unhandled error in update-member-profile:", message);
    return json({ error: message }, 500);
  }
});
