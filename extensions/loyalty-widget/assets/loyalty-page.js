/* GoSelf — Loyalty Landing Page logic (shared asset).
   Inits every .rh-lp[data-rh-shop] on the page from its data-* config.
   Public data via get-program-overview (no PII); member balance via token flow. */
(function(){
  var SUPABASE_URL='https://jblqyvicxhmqqjhostcj.supabase.co';
  var ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';
  var EARN_ICON={order:'🛍️',purchase:'🛍️',signup:'🎉',welcome_bonus:'🎉',register:'🎉',join:'🎉',profile_complete:'👤',referral:'📣',review:'⭐',social:'📸',survey:'📋',birthday:'🎂',anniversary:'💍'};
  var MEDAL=['🥉','🥈','🥇','💎','👑','⭐'];
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  function initOne(root){
    var shop=root.getAttribute('data-rh-shop');
    var email=root.getAttribute('data-rh-email')||'';
    var cur=root.getAttribute('data-rh-currency')||'₹';
    if(!shop) return;
    var hdrs={apikey:ANON_KEY,Authorization:'Bearer '+ANON_KEY,'Content-Type':'application/json'};
    var q=function(sel){return root.querySelector(sel);};
    var tiersData=[]; var pointsName='Points';

    // 1. PUBLIC overview
    fetch(SUPABASE_URL+'/functions/v1/get-program-overview?shop_domain='+encodeURIComponent(shop),{headers:{apikey:ANON_KEY,Authorization:'Bearer '+ANON_KEY}})
    .then(function(r){return r.json();}).then(function(d){
      if(!d||d.error) return;
      pointsName=d.points_name||'Points'; tiersData=d.tiers||[];
      var eg=q('.rh-lp-earn');
      if(eg&&d.earn_rules){ eg.innerHTML=d.earn_rules.map(function(r){
        var icon=EARN_ICON[r.rule_type]||'✨';
        return '<div class="rh-lp-card"><div class="ic">'+icon+'</div><h3>'+esc(r.name||r.rule_type)+'</h3><p>'+esc(r.description||'')+'</p>'+(r.points_reward?'<div class="pts">+'+r.points_reward+' '+esc(pointsName)+'</div>':'')+'</div>';
      }).join('')||'<p style="text-align:center;color:#9aa0ad">Earn rules coming soon</p>'; }
      var rg=q('.rh-lp-redeem');
      if(rg&&d.redeem){ rg.innerHTML=d.redeem.slice(0,8).map(function(r){
        var img=r.image_url?'<img src="'+esc(r.image_url)+'" alt="">':'';
        var val=r.discount_value?esc(r.discount_value):esc(r.title);
        return '<div class="rh-lp-rcard">'+img+'<div class="big">'+val+'</div><div class="c">'+esc(r.title)+' · '+(r.points_cost||0)+' '+esc(pointsName)+'</div></div>';
      }).join('')||'<p style="grid-column:1/-1;text-align:center;color:#9aa0ad">Rewards coming soon</p>'; }
      var tg=q('.rh-lp-tiers');
      if(tg&&d.tiers){ tg.innerHTML=d.tiers.map(function(t,i){
        var perks=t.benefits?('<ul>'+t.benefits.split(/[\n;]+/).filter(Boolean).map(function(p){return '<li>'+esc(p.trim())+'</li>';}).join('')+'</ul>')
          :('<ul><li>'+(t.earn_rate||1)+' '+esc(pointsName)+' / '+cur+(t.earn_divisor||1)+'</li><li>Redeem up to '+(t.max_redemption_percent||100)+'% of order</li></ul>');
        var bg=t.color?('background:'+t.color+'22'):'';
        return '<div class="rh-lp-tier" style="'+bg+'"><h3>'+(MEDAL[i]||'⭐')+' '+esc(t.name)+'</h3><div class="req">'+(t.min_lifetime_points||0)+'+ '+esc(pointsName)+'</div>'+perks+'</div>';
      }).join(''); }
    }).catch(function(){});

    // 2. Member balance/tier (logged-in only)
    if(!email) return;
    fetch(SUPABASE_URL+'/functions/v1/issue-widget-token',{method:'POST',headers:hdrs,body:JSON.stringify({email:email,shop_domain:shop})})
    .then(function(r){return r.json();}).then(function(tk){
      if(!tk||!tk.token) return;
      fetch(SUPABASE_URL+'/functions/v1/get-loyalty-status',{method:'POST',headers:Object.assign({},hdrs,{'X-Widget-Token':tk.token}),body:JSON.stringify({shop_domain:shop})})
      .then(function(r){return r.json();}).then(function(d){
        if(!d||d.error||d.points_balance==null) return;
        var name=(d.program&&d.program.points_name)||pointsName;
        var box=q('.rh-lp-herocard'); if(box) box.style.display='inline-flex';
        var bal=q('.rh-lp-bal'); if(bal) bal.textContent=(d.points_balance||0).toLocaleString()+' '+name;
        var tier=q('.rh-lp-tierv'); if(tier) tier.textContent=(d.tier&&d.tier.name)||'—';
        var lifetime=d.lifetime_points_earned||0; var next=null;
        for(var i=0;i<tiersData.length;i++){ if((tiersData[i].min_lifetime_points||0)>lifetime){next=tiersData[i];break;} }
        var nx=q('.rh-lp-next'); var nxw=q('.rh-lp-next-wrap');
        if(next&&nx){ nx.textContent=(next.min_lifetime_points-lifetime).toLocaleString()+' '+name; }
        else if(nxw){ nxw.style.display='none'; }
        var cta=q('.rh-lp-cta-join'); if(cta) cta.style.display='none';
      }).catch(function(){});
    }).catch(function(){});
  }

  function boot(){ var nodes=document.querySelectorAll('.rh-lp[data-rh-shop]'); for(var i=0;i<nodes.length;i++) initOne(nodes[i]); }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();
