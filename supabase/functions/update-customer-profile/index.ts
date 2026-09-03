import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWidgetToken } from '../_shared/widget-auth.ts';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...getCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Widget-Token' };

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  // C-01: Verify widget token
  const claims = await verifyWidgetToken(req);
  if (!claims) return json({ error: 'Unauthorized — valid X-Widget-Token required' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { shop_domain, first_name, phone, dob, anniversary } = body as {
      shop_domain?: string;
      first_name?: string;
      phone?: string;
      dob?: string | null;
      anniversary?: string | null;
    };

    if (!shop_domain) return json({ error: 'shop_domain is required' }, 400);

    // Identity from token — cannot be overridden by request body
    const memberUserId = claims.mid;

    // ── Resolve client_id from shop_domain ───────────────────────────────────
    let clientId: string | null = null;

    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop_domain)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (si) clientId = si.client_id;

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shop_domain)
        .maybeSingle();
      if (ic) clientId = ic.client_id;
    }

    if (!clientId) {
      return json({ error: 'Shop not found or not integrated', shop_domain }, 404);
    }

    // ── Fetch member by ID from token — never by email from body ────────────
    const { data: member } = await supabase
      .from('member_users')
      .select('id, full_name, phone, date_of_birth, anniversary_date')
      .eq('id', memberUserId)
      .eq('client_id', clientId)  // defence-in-depth: must belong to the token's client
      .maybeSingle();

    if (!member) {
      return json({ error: 'Member not found' }, 404);
    }

    // ── Build update payload ─────────────────────────────────────────────────
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    if (first_name !== undefined && first_name !== null) {
      updates.full_name = first_name.trim();
    }

    if (phone !== undefined) {
      updates.phone = phone ? phone.trim() : null;
    }

    if (dob !== undefined) {
      if (dob !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return json({ error: 'dob must be YYYY-MM-DD format' }, 400);
      }
      updates.date_of_birth = dob;
    }

    if (anniversary !== undefined) {
      if (anniversary !== null && !/^\d{4}-\d{2}-\d{2}$/.test(anniversary)) {
        return json({ error: 'anniversary must be YYYY-MM-DD format' }, 400);
      }
      updates.anniversary_date = anniversary;
    }

    const { error: updateErr } = await supabase
      .from('member_users')
      .update(updates)
      .eq('id', member.id);

    if (updateErr) {
      console.error('[update-customer-profile] update error:', updateErr);
      return json({ error: 'Failed to update profile', details: updateErr.message }, 500);
    }

    // ── Check if profile is now complete, award points ────────────────────────
    const updatedFullName  = (updates.full_name        ?? member.full_name)?.trim()        || '';
    const updatedPhone     = (updates.phone             ?? member.phone)?.trim()            || '';
    const updatedDob       = (updates.date_of_birth     ?? member.date_of_birth)           || '';

    // Anniversary is now a separate earn action — profile_complete only requires
    // name + phone + birthday so more members can reach the bonus.
    const profileNowComplete = !!(updatedFullName && updatedPhone && updatedDob);
    let pointsAwarded = 0;
    let profileRuleId: string | null = null;

    // ── AUTO-ENROLLMENT: Ensure member is enrolled before awarding points ─────
    let statusRow = (await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_earned, loyalty_program_id')
      .eq('member_user_id', member.id)
      .maybeSingle()).data;

    // If not enrolled, auto-enroll with default tier
    if (!statusRow) {
      // Get loyalty program for this client
      const { data: program } = await supabase
        .from('loyalty_programs')
        .select('id')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle();

      if (program) {
        // Get default tier
        const { data: defaultTier } = await supabase
          .from('loyalty_tiers')
          .select('id')
          .eq('loyalty_program_id', program.id)
          .eq('is_default', true)
          .maybeSingle();

        if (defaultTier) {
          // Create enrollment
          const { data: newStatus, error: enrollErr } = await supabase
            .from('member_loyalty_status')
            .insert({
              member_user_id: member.id,
              loyalty_program_id: program.id,
              current_tier_id: defaultTier.id,
              points_balance: 0,
              lifetime_points_earned: 0,
            })
            .select('id, points_balance, lifetime_points_earned, loyalty_program_id')
            .single();

          if (!enrollErr) {
            statusRow = newStatus;
          }
        }
      }
    }

    // ── EARN POINTS: Award profile completion points if enrolled ───────────
    if (profileNowComplete && statusRow) {
      // Find active profile_complete earning rule for this client
      const { data: profileRule } = await supabase
        .from('loyalty_earning_rules')
        .select('id, points_reward')
        .eq('client_id', clientId)
        .eq('rule_type', 'profile_complete')
        .eq('is_active', true)
        .maybeSingle();

      if (profileRule) {
        profileRuleId = profileRule.id;

        // Check if points already awarded for this rule
        const { data: existingTxn } = await supabase
          .from('loyalty_points_transactions')
          .select('id')
          .eq('member_user_id', member.id)
          .eq('transaction_type', 'earned')
          .filter('metadata->>rule_id', 'eq', profileRule.id)
          .maybeSingle();

        if (!existingTxn) {
          const pts = profileRule.points_reward || 100;

          // INSERT transaction FIRST — if this fails (duplicate key, RLS, etc.)
          // we skip the balance update so points are never awarded without a record.
          const { error: txnErr } = await supabase
            .from('loyalty_points_transactions')
            .insert({
              member_loyalty_status_id: statusRow.id,
              member_user_id:           member.id,
              points_amount:            pts,
              transaction_type:         'earned',
              description:              'Profile completion bonus',
              metadata:                 { rule_id: profileRule.id },
            });

          if (txnErr) {
            console.error('[update-customer-profile] transaction insert failed:', txnErr.message);
            // Do NOT update balance — skip awarding points to stay consistent
          } else {
            // Transaction committed — now update the running balance
            const { error: balErr } = await supabase
              .from('member_loyalty_status')
              .update({
                points_balance:         (statusRow.points_balance        || 0) + pts,
                lifetime_points_earned: (statusRow.lifetime_points_earned || 0) + pts,
              })
              .eq('id', statusRow.id);

            if (balErr) {
              console.error('[update-customer-profile] balance update failed:', balErr.message);
              // Transaction row exists but balance wasn't updated — log for manual reconciliation
            } else {
              pointsAwarded = pts;
            }
          }
        }
      }
    }

    return json({
      success:          true,
      member_user_id:   member.id,
      profile_complete: profileNowComplete,
      points_awarded:   pointsAwarded,
      profile_rule_id:  profileRuleId,
    });
  } catch (err) {
    console.error('[update-customer-profile] unexpected error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
