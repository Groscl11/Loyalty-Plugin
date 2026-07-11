/**
 * recalculate-member-tiers
 * POST { program_id: string }
 *
 * Called after a tier is created/updated in the dashboard so all existing
 * members are moved to the correct tier immediately. Returns { upgraded: number }.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apikey',
};

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')             || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const programId: string = (body.program_id || '').trim();

    if (!programId) {
      return new Response(
        JSON.stringify({ error: 'program_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all tiers for this program, highest tier_level first
    const { data: tiers, error: tierErr } = await supabase
      .from('loyalty_tiers')
      .select('id, tier_level, is_default, qualification_mode, min_lifetime_points, min_lifetime_spend, min_orders, min_spend')
      .eq('loyalty_program_id', programId)
      .order('tier_level', { ascending: false });

    if (tierErr || !tiers?.length) {
      return new Response(
        JSON.stringify({ upgraded: 0, reason: 'no_tiers' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const defaultTier = tiers.find(t => t.is_default) || tiers[tiers.length - 1];

    // Fetch all member loyalty statuses for this program
    const { data: members, error: memberErr } = await supabase
      .from('member_loyalty_status')
      .select('id, current_tier_id, lifetime_points_earned, total_orders, total_spend')
      .eq('loyalty_program_id', programId);

    if (memberErr || !members?.length) {
      return new Response(
        JSON.stringify({ upgraded: 0, reason: memberErr ? 'db_error' : 'no_members' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine correct tier for a member based on tier qualification_mode
    function resolveTargetTier(member: {
      lifetime_points_earned: number;
      total_orders: number;
      total_spend: number;
    }): string {
      for (const tier of tiers) {
        const mode = tier.qualification_mode || 'lifetime_points';
        let qualifies = false;

        if (mode === 'lifetime_points') {
          qualifies = (member.lifetime_points_earned ?? 0) >= (tier.min_lifetime_points ?? 0);
        } else if (mode === 'lifetime_spend') {
          qualifies = (member.total_spend ?? 0) >= (tier.min_lifetime_spend ?? 0);
        } else if (mode === 'orders') {
          qualifies = (member.total_orders ?? 0) >= (tier.min_orders ?? 0);
        } else if (mode === 'spend') {
          qualifies = (member.total_spend ?? 0) >= (tier.min_spend ?? 0);
        } else {
          // Unknown mode — treat as lifetime_points
          qualifies = (member.lifetime_points_earned ?? 0) >= (tier.min_lifetime_points ?? 0);
        }

        if (qualifies) return tier.id;
      }
      return defaultTier.id;
    }

    // Build list of members whose tier needs to change
    const updates: Array<{ id: string; current_tier_id: string }> = [];
    for (const member of members) {
      const targetTierId = resolveTargetTier(member);
      if (targetTierId !== member.current_tier_id) {
        updates.push({ id: member.id, current_tier_id: targetTierId });
      }
    }

    if (!updates.length) {
      return new Response(
        JSON.stringify({ upgraded: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apply updates in parallel batches of 50
    const BATCH = 50;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      await Promise.all(
        batch.map(u =>
          supabase
            .from('member_loyalty_status')
            .update({ current_tier_id: u.current_tier_id, updated_at: new Date().toISOString() })
            .eq('id', u.id)
        )
      );
    }

    return new Response(
      JSON.stringify({ upgraded: updates.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('recalculate-member-tiers unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
