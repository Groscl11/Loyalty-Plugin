/**
 * Floating Widget - Theme App Extension
 * Shopify 2024-2025 Compliant
 *
 * This widget renders as a floating button in the bottom-right corner.
 * Installed via: Theme Customizer → App Embeds
 * No manual script injection required.
 */

(function() {
  'use strict';

  // Get widget configuration from Shopify settings
  const widgetId = window.FloatingWidgetSettings?.widget_id;
  const enabled = window.FloatingWidgetSettings?.enabled;

  if (!enabled || !widgetId) {
    return;
  }

  const API_BASE = 'https://lizgppzyyljqbmzdytia.supabase.co';

  async function initWidget() {
    try {
      // Gather context
      const context = {
        widget_type: 'floating',
        widget_id: widgetId,
        shop: Shopify.shop,
        customer_id: window.Shopify?.customerPrivacy?.userCanBeTracked() ? window.Shopify.customer?.id : null,
        page_context: {
          type: getPageType(),
          url: window.location.href
        }
      };

      // Call unified API endpoint
      const response = await fetch(`https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/loyalty-widget-panel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_domain: window.Shopify?.shop || window.location.hostname,
          customer_email: window.Shopify?.customerEmail || null,
        })
      });

      if (!response.ok) return;

      const data = await response.json();

      // Fetch earning rules to check for survey
      const shopDomain = window.Shopify?.shop || window.location.hostname;
      const memberUserId = window.Shopify?.customer?.id || null;
      let hasSurvey = false;
      let surveyRule = null;
      try {
        const earnRulesRes = await fetch(`${API_BASE}/functions/v1/get-earning-rules?shop_domain=${encodeURIComponent(shopDomain)}${memberUserId ? `&member_user_id=${encodeURIComponent(memberUserId)}` : ''}`);
        if (earnRulesRes.ok) {
          const earnRulesData = await earnRulesRes.json();
          if (Array.isArray(earnRulesData.rules)) {
            surveyRule = earnRulesData.rules.find(r => r.rule_type === 'custom_action' || r.rule_type === 'survey');
            hasSurvey = !!surveyRule;
          }
        }
      } catch (e) {
        // Ignore errors, just don't show survey
      }

      if (data.should_render) {
        renderFloatingWidgetWithSurvey(data.ui_payload, data.redeem_url, hasSurvey, surveyRule);
      }
    } catch (error) {
      console.error('Floating widget error:', error);
    }
  }

  function getPageType() {
    if (window.location.pathname === '/') return 'home';
    if (window.location.pathname.includes('/products/')) return 'product';
    if (window.location.pathname.includes('/collections/')) return 'collection';
    if (window.location.pathname.includes('/cart')) return 'cart';
    return 'other';
  }

  function renderFloatingWidgetWithSurvey(payload, redeemUrl, hasSurvey, surveyRule) {
    const container = document.createElement('div');
    container.id = 'rewards-floating-widget';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      max-width: 320px;
      cursor: pointer;
      animation: slideIn 0.3s ease-out;
    `;

    let html = `
      <div style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px 24px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        transition: transform 0.2s;
      " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
        <div style="font-size: 24px; margin-bottom: 8px;">🎁 ${escapeHtml(payload.title || 'Special Reward')}</div>
        <div style="font-size: 14px; opacity: 0.95; line-height: 1.4;">
          ${escapeHtml(payload.description || 'Click to claim your exclusive reward!')}
        </div>
      </div>
    `;

    // Add Quick Survey if available
    if (hasSurvey && surveyRule) {
      html += `
        <div style="margin-top: 16px; background: #fffbe6; color: #7c5c00; padding: 12px 16px; border-radius: 8px; font-size: 15px;">
          <b>Quick Survey</b> — Earn ${surveyRule.points_reward || ''} pts!<br>
          <button id="survey-action-btn" style="margin-top:8px; background: #ffd700; color: #333; border: none; border-radius: 6px; padding: 6px 16px; font-weight: bold; cursor: pointer;">Take Survey</button>
        </div>
      `;
    }

    container.innerHTML = html;

    if (redeemUrl) {
      container.addEventListener('click', () => {
        window.location.href = redeemUrl;
      });
    }

    // Survey action handler
    if (hasSurvey && surveyRule) {
      setTimeout(() => {
        const btn = document.getElementById('survey-action-btn');
        if (btn) {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = 'Submitting...';
            try {
              const res = await fetch(`${API_BASE}/functions/v1/submit-earn-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  member_user_id: window.Shopify?.customer?.id || '',
                  client_id: surveyRule.client_id || '',
                  rule_id: surveyRule.id,
                  rule_type: surveyRule.rule_type,
                  metadata: { source: 'floating-widget' }
                })
              });
              if (res.ok) {
                btn.textContent = 'Points Awarded!';
              } else {
                btn.textContent = 'Try Again Later';
              }
            } catch (err) {
              btn.textContent = 'Error';
            }
            setTimeout(() => { btn.textContent = 'Take Survey'; btn.disabled = false; }, 3000);
          });
        }
      }, 100);
    }

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(container);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
