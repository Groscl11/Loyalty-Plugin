/**
 * Real-Time Update Integration Guide
 *
 * This file shows how to integrate the three solutions for real-time points updates
 * into your action handlers (surveys, referrals, profile updates, etc.).
 *
 * Three Integration Patterns:
 * 1. Direct refetch from useCustomerData hook
 * 2. Global window API calls
 * 3. Server-side invalidation (Supabase triggers)
 */

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 1: Use refetch from useCustomerData hook
// ─────────────────────────────────────────────────────────────────────────────

// In your component that uses useCustomerData:
import { useCustomerData } from '../hooks/useCustomerData';

export function SurveyComponent() {
  const { refetchCustomerSession, refetch } = useCustomerData();

  const handleSurveySubmit = async (responses) => {
    try {
      // Submit survey to backend
      const result = await fetch('/api/submit-survey', {
        method: 'POST',
        body: JSON.stringify({ responses }),
      });

      if (result.ok) {
        console.log('Survey submitted, points awarded!');
        
        // SOLUTION 3: Refetch customer session immediately to show updated points
        await refetchCustomerSession();
        // Alternative: refetch() to reload all data
      }
    } catch (error) {
      console.error('Survey submission failed:', error);
    }
  };

  return (
    <button onClick={() => handleSurveySubmit(data)}>
      Submit Survey
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 2: Global window API (external action handlers)
// ─────────────────────────────────────────────────────────────────────────────

// If your action handlers are in separate scripts or third-party libraries,
// use the global window API we expose:

// Directly after survey submission (in external script):
async function onSurveyComplete() {
  // Tell GoSelf widget to refetch customer session
  if (window.GoSelfWidget?.refetchCustomerSession) {
    await window.GoSelfWidget.refetchCustomerSession();
    console.log('Widget points updated!');
  }
}

// Or refetch all data:
async function onOrderPlaced() {
  if (window.GoSelfWidget?.refetchAll) {
    await window.GoSelfWidget.refetchAll();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 3: Server triggers (Supabase Realtime)
// ─────────────────────────────────────────────────────────────────────────────

// SOLUTION 2: The widget automatically listens for Supabase Realtime events.
// When your backend updates member_loyalty_status, the widget detects it and
// refetches automatically. No client-side integration needed!

// Example: In your Supabase Edge Function (when granting points):
/*
async function submitSurvey(req) {
  const { email, shop_domain } = await req.json();
  
  // Grant points
  const { data } = await supabase
    .from('member_loyalty_status')
    .update({ points_balance: newBalance + 75 })
    .eq('customer_email', email)
    .eq('shop_domain', shop_domain);
  
  // Realtime automatically notifies widget, cache invalidates, + points display updates
}
*/

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE: Complete Survey Submission Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function completeSurveyWithRealTimeUpdate(responses, shopDomain, customerEmail) {
  try {
    // 1. Submit survey response to edge function
    const result = await fetch(
      'https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/submit-survey-response',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          survey_id: 'survey_1',
          responses,
          shop_domain: shopDomain,
          customer_email: customerEmail,
        }),
      }
    );

    if (!result.ok) {
      throw new Error('Survey submission failed');
    }

    const data = await result.json();
    console.log('Survey completed, points awarded:', data.points_awarded);

    // 2. SOLUTION 3: Manually refetch to show updated points immediately
    // (while SOLUTION 2 Realtime subscription is also listening for updates)
    if (window.GoSelfWidget?.refetchCustomerSession) {
      await window.GoSelfWidget.refetchCustomerSession();
    }

    return { success: true, pointsAwarded: data.points_awarded };
  } catch (error) {
    console.error('Survey submission failed:', error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS TO INTEGRATE
// ─────────────────────────────────────────────────────────────────────────────

// Call refetch() after any of these user actions:

// 1. Survey submitted → refetch('customer_session')
// 2. Order placed → refetch('customer_session')
// 3. Referral accepted → refetch() [reload all data]
// 4. Profile updated → refetch('customer_session')
// 5. Tier changed → refetch() [reload tier + rules]
// 6. Reward redeemed → refetch('customer_session') + refetch('wallet')
// 7. Milestone completed → refetch()

// ─────────────────────────────────────────────────────────────────────────────
// CACHING STRATEGY SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

// SOLUTION 1 (SWR): Auto-polling + focus refetch
//   - Customer session: polled every 10s + on focus
//   - Earn rules: polled every 60s
//   - Partner data: polled every 5 min
//   → Ensures eventual consistency without manual intervention

// SOLUTION 2 (Realtime): Push updates from backend
//   - Supabase Realtime listens to member_loyalty_status changes
//   - Instant notification when points awarded server-side
//   → Real-time single source of truth

// SOLUTION 3 (Manual): Explicit invalidation
//   - Call refetch() after user actions complete
//   - Clears session cache + refetches from API
//   → Immediate UI update without waiting for polling interval

// Layer them: Realtime + automatic polling + manual refetch
// = guaranteed fresh data within 1-2 seconds

export default {
  completeSurveyWithRealTimeUpdate, // Now uses unified submit-action-reward function
  // Export other handlers...
};
