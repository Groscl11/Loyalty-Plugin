/**
 * Pre-Purchase Rewards — Shared JS
 * Loaded once, initialises all PPR widgets on the page.
 */
(function (w) {
  if (w.RhPPR) return; // already loaded

  var SUPABASE_URL = 'https://jblqyvicxhmqqjhostcj.supabase.co';
  var ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }

  /**
   * fetchRewards — calls the edge function read-only.
   * @param {string}   campaignId
   * @param {function} onSuccess  called with (rewards[], responseData)
   * @param {function} onEmpty    called when response is ok but rewards=[]
   * @param {function} onError    called on network / parse errors
   */
  function fetchRewards(campaignId, onSuccess, onEmpty, onError) {
    fetch(SUPABASE_URL + '/functions/v1/claim-standalone-campaign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY
      },
      body: JSON.stringify({ campaign_rule_id: campaignId })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.success && d.rewards && d.rewards.length) {
        onSuccess(d.rewards, d);
      } else {
        if (onEmpty) onEmpty(d);
      }
    })
    .catch(function (e) {
      if (onError) onError(e);
    });
  }

  function initials(str) {
    return (str || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase();
  }

  function logoOrInitials(brand, cls, initCls) {
    if (brand && brand.logo_url) {
      return '<img class="' + cls + '" src="' + brand.logo_url + '" alt="' + (brand.name || '') + '" loading="lazy">';
    }
    return '<div class="' + initCls + '">' + initials((brand && brand.name) || '') + '</div>';
  }

  function rewardCard(r) {
    var brand = r.brand || {};
    return '<div class="rh-ppr-reward-card">' +
      logoOrInitials(brand, 'rh-ppr-reward-logo', 'rh-ppr-reward-logo-initials') +
      (r.category ? '<span class="rh-ppr-reward-category">' + r.category + '</span>' : '') +
      '<span class="rh-ppr-reward-brand">' + (brand.name || '') + '</span>' +
      '<span class="rh-ppr-reward-title">' + r.title + '</span>' +
      (r.value_description ? '<span class="rh-ppr-reward-value">' + r.value_description + '</span>' : '') +
      (r.available_vouchers > 0 && r.available_vouchers < 20 ? '<span class="rh-ppr-reward-avail">Only ' + r.available_vouchers + ' left!</span>' : '') +
      '</div>';
  }

  function chipsHtml(rewards, max, extraMoreClass) {
    var html = '';
    max = max || 3;
    var cnt = Math.min(rewards.length, max);
    for (var i = 0; i < cnt; i++) {
      var r = rewards[i]; var brand = r.brand || {};
      var logo = brand.logo_url
        ? '<img class="rh-ppr-chip-logo" src="' + brand.logo_url + '" alt="' + (brand.name || '') + '" loading="lazy">'
        : '<span class="rh-ppr-chip-initials">' + initials(brand.name || r.title) + '</span>';
      html += '<span class="rh-ppr-chip">' + logo + '<span>' + (r.value_description || brand.name || r.title) + '</span></span>';
    }
    if (rewards.length > max) {
      html += '<span class="rh-ppr-chip-more' + (extraMoreClass ? ' ' + extraMoreClass : '') + '">+' + (rewards.length - max) + ' more</span>';
    }
    return html;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PRODUCT STRIP
  ═══════════════════════════════════════════════════════════════════════ */
  w.RhPPR_initProductStrip = function (cfg) {
    var id = cfg.id;
    if (!cfg.campaignId) return;

    var wrap    = el('rh-pps-' + id);
    var chipsEl = el('rh-pps-chips-' + id);
    var gridEl  = el('rh-pps-grid-'  + id);
    var loadEl  = el('rh-pps-load-'  + id);

    if (!wrap) return;

    // Show immediately with loading chips so layout is stable
    if (chipsEl) chipsEl.innerHTML = '<span class="rh-ppr-spinner"></span>';
    wrap.style.display = '';

    fetchRewards(cfg.campaignId,
      // success
      function (rewards) {
        if (chipsEl) chipsEl.innerHTML = chipsHtml(rewards, 3);
        if (gridEl) {
          var html = '';
          for (var i = 0; i < rewards.length; i++) html += rewardCard(rewards[i]);
          gridEl.innerHTML = html;
          if (loadEl) loadEl.style.display = 'none';
        }
        // Progress bar
        if (cfg.minOrder > 0) {
          fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
            var total = (cart.total_price || 0) / 100;
            var pct   = Math.min(100, Math.round((total / cfg.minOrder) * 100));
            var pFill = el('rh-pps-pf-' + id);
            var pLbl  = el('rh-pps-pl-' + id);
            var pWrap = el('rh-pps-pw-' + id);
            if (pFill) pFill.style.width = pct + '%';
            if (pLbl)  pLbl.textContent = total < cfg.minOrder
              ? 'Add ' + cfg.currency + Math.ceil(cfg.minOrder - total) + ' more to unlock'
              : '✓ You qualify for rewards!';
            if (pWrap) pWrap.style.display = '';
          }).catch(function () {});
        }
      },
      // empty / no rewards
      function () { wrap.style.display = 'none'; },
      // error
      function () { wrap.style.display = 'none'; }
    );

    // Drawer toggle
    var btn   = el('rh-pps-btn-'   + id);
    var close = el('rh-pps-close-' + id);
    var ov    = el('rh-pps-ov-'    + id);
    function openDrawer()  { if (ov) { ov.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
    function closeDrawer() { if (ov) { ov.style.display = 'none'; document.body.style.overflow = ''; } }
    if (btn)   btn.addEventListener('click', openDrawer);
    if (close) close.addEventListener('click', closeDrawer);
    if (ov)    ov.addEventListener('click', function (e) { if (e.target === ov) closeDrawer(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  };

  /* ═══════════════════════════════════════════════════════════════════════
     HOMEPAGE HERO
  ═══════════════════════════════════════════════════════════════════════ */
  w.RhPPR_initHomepageHero = function (cfg) {
    var id = cfg.id;
    if (!cfg.campaignId) return;

    var wrap     = el('rh-hero-' + id);
    var brandsEl = el('rh-hero-brands-' + id);
    var cardsEl  = el('rh-hero-cards-'  + id);
    var loadEl   = el('rh-hero-load-'   + id);

    if (!wrap) return;

    // Show immediately — hero is a full section, always visible
    wrap.style.display = '';

    fetchRewards(cfg.campaignId,
      // success
      function (rewards) {
        if (loadEl) loadEl.style.display = 'none';

        if (brandsEl) {
          var bHtml = '';
          for (var i = 0; i < rewards.length; i++) {
            var r = rewards[i]; var brand = r.brand || {};
            var logo = brand.logo_url
              ? '<img class="rh-hero-brand-logo" src="' + brand.logo_url + '" alt="' + (brand.name || '') + '" loading="lazy">'
              : '<div class="rh-hero-brand-initials">' + initials(brand.name || r.title) + '</div>';
            bHtml += '<div class="rh-hero-brand-pill">' + logo +
              '<div><div style="font-size:13px;font-weight:700;color:#111">' + (brand.name || r.title) + '</div>' +
              (r.value_description ? '<div class="rh-hero-brand-value">' + r.value_description + '</div>' : '') +
              '</div></div>';
          }
          brandsEl.innerHTML = bHtml;
        }

        if (cfg.showCards && cardsEl) {
          var cHtml = ''; var max = Math.min(rewards.length, 3);
          for (var j = 0; j < max; j++) {
            var rw = rewards[j]; var brd = rw.brand || {};
            var logo2 = brd.logo_url
              ? '<img class="rh-hero-card-logo" src="' + brd.logo_url + '" alt="' + (brd.name || '') + '" loading="lazy">'
              : '<div class="rh-hero-card-logo-initials">' + initials(brd.name || rw.title) + '</div>';
            cHtml += '<div class="rh-hero-card">' + logo2 +
              '<span class="rh-hero-card-brand">' + (brd.name || '') + '</span>' +
              '<span class="rh-hero-card-title">' + rw.title + '</span>' +
              (rw.value_description ? '<span class="rh-hero-card-val">' + rw.value_description + '</span>' : '') +
              '</div>';
          }
          cardsEl.innerHTML = cHtml;
          cardsEl.style.display = 'flex';
        }
      },
      // empty
      function () { if (loadEl) loadEl.style.display = 'none'; },
      // error
      function () { if (loadEl) loadEl.style.display = 'none'; }
    );
  };

  /* ═══════════════════════════════════════════════════════════════════════
     STICKY BANNER
  ═══════════════════════════════════════════════════════════════════════ */
  w.RhPPR_initStickyBanner = function (cfg) {
    var id = cfg.id;
    if (!cfg.campaignId) return;
    var sessionKey = 'rh_sticky_' + cfg.campaignId;

    var wrapEl      = el('rh-sticky-'       + id);
    var panelEl     = el('rh-sticky-panel-' + id);
    var cardsEl     = el('rh-sticky-cards-' + id);
    var brandsEl    = el('rh-sticky-brands-'+ id);
    var expandBtn   = el('rh-sticky-exp-'   + id);
    var collapseBtn = el('rh-sticky-col-'   + id);
    var dismissBtn  = el('rh-sticky-dis-'   + id);
    var pillEl      = el('rh-sticky-pill-'  + id);
    var pillOpenBtn = el('rh-sticky-popen-' + id);
    var barLeft     = el('rh-sticky-bl-'    + id);

    if (!wrapEl) return;

    var expanded = false;

    function togglePanel() {
      expanded = !expanded;
      if (panelEl) panelEl.style.display = expanded ? '' : 'none';
      var bar = el('rh-sticky-bar-' + id);
      if (bar)    bar.style.display   = expanded ? 'none' : '';
    }
    function dismiss() {
      if (wrapEl)  wrapEl.style.display = 'none';
      if (pillEl)  pillEl.style.display = '';
      try { sessionStorage.setItem(sessionKey, '1'); } catch (e) {}
    }
    function reopen() {
      if (wrapEl) wrapEl.style.display = '';
      if (pillEl) pillEl.style.display = 'none';
      try { sessionStorage.removeItem(sessionKey); } catch (e) {}
    }

    if (expandBtn)   expandBtn.addEventListener('click',   togglePanel);
    if (collapseBtn) collapseBtn.addEventListener('click', togglePanel);
    if (dismissBtn)  dismissBtn.addEventListener('click',  dismiss);
    if (pillOpenBtn) pillOpenBtn.addEventListener('click', reopen);
    if (barLeft)     barLeft.addEventListener('click',     togglePanel);

    fetchRewards(cfg.campaignId,
      // success
      function (rewards) {
        if (brandsEl) {
          brandsEl.textContent = rewards.map(function (r) {
            return (r.brand && r.brand.name) ? r.brand.name : r.title;
          }).slice(0, 4).join(' · ');
        }
        if (cardsEl) {
          var html = '';
          for (var i = 0; i < rewards.length; i++) {
            var r = rewards[i]; var brand = r.brand || {};
            var logo = brand.logo_url
              ? '<img class="rh-sticky-card-logo" src="' + brand.logo_url + '" alt="' + (brand.name || '') + '" loading="lazy">'
              : '<div class="rh-sticky-card-initials">' + initials(brand.name || r.title) + '</div>';
            html += '<div class="rh-sticky-card">' + logo +
              '<span class="rh-sticky-card-brand">' + (brand.name || '') + '</span>' +
              '<span class="rh-sticky-card-title">' + r.title + '</span>' +
              (r.value_description ? '<span class="rh-sticky-card-val">' + r.value_description + '</span>' : '') +
              '</div>';
          }
          cardsEl.innerHTML = html;
        }
        // Respect dismiss
        try {
          if (sessionStorage.getItem(sessionKey)) {
            if (pillEl) pillEl.style.display = '';
            return;
          }
        } catch (e) {}
        wrapEl.style.display = '';
      },
      // empty / error — don't show sticky
      function () {},
      function () {}
    );
  };

  /* ═══════════════════════════════════════════════════════════════════════
     COLLECTION BANNER
  ═══════════════════════════════════════════════════════════════════════ */
  w.RhPPR_initCollectionBanner = function (cfg) {
    var id = cfg.id;
    if (!cfg.campaignId) return;

    var wrapEl    = el('rh-coll-'        + id);
    var chipsEl   = el('rh-coll-chips-'  + id);
    var panelEl   = el('rh-coll-panel-'  + id);
    var gridEl    = el('rh-coll-grid-'   + id);
    var loadEl    = el('rh-coll-load-'   + id);
    var toggleBtn = el('rh-coll-toggle-' + id);
    var arrowEl   = el('rh-coll-arrow-'  + id);
    var toggleLbl = el('rh-coll-tlbl-'   + id);
    var isOpen    = cfg.autoExpand;

    if (!wrapEl) return;

    function applyState() {
      if (panelEl)   panelEl.style.display = isOpen ? '' : 'none';
      if (arrowEl)   arrowEl.style.transform = isOpen ? 'rotate(180deg)' : '';
      if (toggleLbl) toggleLbl.textContent  = isOpen ? cfg.collapseText : cfg.expandText;
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () { isOpen = !isOpen; applyState(); });
    }
    applyState();

    // Show immediately with spinner chips
    if (chipsEl) chipsEl.innerHTML = '<span class="rh-ppr-spinner"></span>';
    wrapEl.style.display = '';

    fetchRewards(cfg.campaignId,
      // success
      function (rewards) {
        if (chipsEl) {
          var cHtml = ''; var max = Math.min(rewards.length, 4);
          for (var i = 0; i < max; i++) {
            var r = rewards[i]; var brand = r.brand || {};
            var logo = brand.logo_url
              ? '<img class="rh-coll-chip-logo" src="' + brand.logo_url + '" alt="' + (brand.name || '') + '" loading="lazy">'
              : '<span class="rh-coll-chip-initials">' + initials(brand.name || r.title) + '</span>';
            cHtml += '<span class="rh-coll-chip">' + logo + '<span>' + (brand.name || r.title) + '</span></span>';
          }
          if (rewards.length > 4) cHtml += '<span style="font-size:11px;opacity:.75;color:inherit">+' + (rewards.length - 4) + ' more</span>';
          chipsEl.innerHTML = cHtml;
        }
        if (gridEl) {
          var gHtml = '';
          for (var j = 0; j < rewards.length; j++) gHtml += rewardCard(rewards[j]);
          gridEl.innerHTML = gHtml;
          if (loadEl) loadEl.style.display = 'none';
        }
      },
      // empty
      function () { wrapEl.style.display = 'none'; },
      // error
      function () { wrapEl.style.display = 'none'; }
    );
  };

  w.RhPPR = true;

  // Process any inits queued before this script loaded
  var queue = w._RhPPRQueue;
  if (Array.isArray(queue)) {
    for (var qi = 0; qi < queue.length; qi++) queue[qi]();
  }
  // Replace the array with an object whose push() runs the callback immediately
  w._RhPPRQueue = { push: function (fn) { fn(); } };
})(window);
