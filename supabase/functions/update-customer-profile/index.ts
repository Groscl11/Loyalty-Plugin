import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const {
      email,
      shop_domain,
      first_name,
      phone,
      dob,
      anniversary,
    } = body as {
      email?: string;
      shop_domain?: string;
      first_name?: string;
      phone?: string;
      dob?: string | null;
      anniversary?: string | null;
    };

    if (!email || !shop_domain) {
      return json({ error: 'email and shop_domain are required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // DIAGNOSTIC: Log for specific user
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Starting for user', normalizedEmail, 'shop_domain:', shop_domain);
    }

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

    // DIAGNOSTIC: Log client resolution
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Resolved client_id:', clientId);
    }

    // ── Resolve member ───────────────────────────────────────────────────────
    let { data: member } = await supabase
      .from('member_users')
      .select('id, full_name, phone, date_of_birth, anniversary_date')
      .eq('email', normalizedEmail)
      .eq('client_id', clientId)
      .maybeSingle();

    // Fallback: email-only lookup (multiple clients edge-case)
    if (!member) {
      const { data: fallback } = await supabase
        .from('member_users')
        .select('id, full_name, phone, date_of_birth, anniversary_date')
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();
      member = fallback;
    }

    if (!member) {
      return json({ error: 'Member not found' }, 404);
    }

    // DIAGNOSTIC: Log member found
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Found member id:', member.id, 'profile:', { full_name: member.full_name, phone: member.phone, dob: member.date_of_birth, anniv: member.anniversary_date });
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

    // DIAGNOSTIC: Log updates payload
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Updates to apply:', updates);
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
    const updatedAnniv     = (updates.anniversary_date  ?? member.anniversary_date)        || '';

    const profileNowComplete = !!(updatedFullName && updatedPhone && updatedDob && updatedAnniv);
    let pointsAwarded = 0;
    let profileRuleId: string | null = null;

    // DIAGNOSTIC: Log profile completion check
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Profile now complete?', profileNowComplete, 'fields:', { fullName: updatedFullName, phone: updatedPhone, dob: updatedDob, anniv: updatedAnniv });
    }

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
            if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
              console.log('[DIAG] update-customer-profile: AUTO-ENROLLED member to default tier:', defaultTier.id);
            }
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

        // DIAGNOSTIC: Log rule and existing txn
        if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
          console.log('[DIAG] update-customer-profile: Found profile rule id:', profileRule.id, 'points:', profileRule.points_reward, 'existing txn:', !!existingTxn);
        }

        if (!existingTxn) {
          const pts = profileRule.points_reward || 100;

          // Update balance
          await supabase
            .from('member_loyalty_status')
            .update({
              points_balance:         (statusRow.points_balance        || 0) + pts,
              lifetime_points_earned: (statusRow.lifetime_points_earned || 0) + pts,
            })
            .eq('id', statusRow.id);

          // Insert transaction with rule_id in metadata (so get-earning-rules marks it complete)
          await supabase
            .from('loyalty_points_transactions')
            .insert({
              member_loyalty_status_id: statusRow.id,
              member_user_id:           member.id,
              points_amount:            pts,
              transaction_type:         'earned',
              description:              'Profile completion bonus',
              metadata:                 { rule_id: profileRule.id },
            });

          pointsAwarded = pts;
        }

        // DIAGNOSTIC: Log points awarded
        if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
          console.log('[DIAG] update-customer-profile: Awarded points:', pointsAwarded, 'for rule:', profileRuleId);
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

    // DIAGNOSTIC: Log final response
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] update-customer-profile: Response:', { success: true, member_user_id: member.id, profile_complete: profileNowComplete, points_awarded: pointsAwarded, profile_rule_id: profileRuleId });
    }
  } catch (err) {
    console.error('[update-customer-profile] unexpected error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
