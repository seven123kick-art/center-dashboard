/* Version6 D3-16: Data Catalog unified import hub */
'use strict';
(function(){
  if(window.__DATA_IMPORT_HUB_LOADED_20260817__)return; window.__DATA_IMPORT_HUB_LOADED_20260817__=true;
  const DOCS=[
    {id:'PLAN_BUDGET',label:'年度予算',code:'SKFL0001',scope:'年度',action:'plan'},
    {id:'PL_PRELIMINARY',repo:'PL_ACTUAL',label:'月次収支 速報',code:'SKDL0002',scope:'年月',state:'PRELIMINARY',action:'prelim'},
    {id:'PL_CONFIRMED',repo:'PL_ACTUAL',label:'月次収支 確定',code:'SKDL0003',scope:'年月',state:'CONFIRMED',action:'confirmed'},
    {id:'WORKER_SALES',label:'作業者別売上明細',code:'WORKER_SALES',scope:'年月',action:'worker'},
    {id:'SHIPPER_AREA',label:'荷主別配送エリア物量',code:'SHIPPER_AREA',scope:'年月',action:'shipper'},
    {id:'DELIVERY_LIST',label:'配達持出予定リスト',code:'DELIVERY_LIST',scope:'配達日',action:'delivery'},
    {id:'ROUTE_PAYMENT',label:'配達ヘッド傭車料確認',code:'ROUTE_PAYMENT',scope:'年月',action:'payment'}
  ];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const period=v=>String(v||'').replace('-','');
  function fyOf(p){const y=+p.slice(0,4),m=+p.slice(4);return String(m>=4?y:y-1)}
  function syncLegacy(p){if(!/^\d{6}$/.test(p))return;const y=+p.slice(0,4),m=+p.slice(4),fy=m>=4?y:y-1;
    const pre=document.getElementById('preliminary-pl-month');if(pre)pre.value=`${p.slice(0,4)}-${p.slice(4)}`;
    [['field-worker-fy-select','field-worker-month-select'],['field-product-fy-select','field-product-month-select']].forEach(([a,b])=>{const A=document.getElementById(a),B=document.getElementById(b);if(A)A.value=String(fy);if(B)B.value=String(m);A?.dispatchEvent(new Event('change',{bubbles:true}));B?.dispatchEvent(new Event('change',{bubbles:true}));});
    const py=document.getElementById('plan-year-sel');if(py)py.value=String(fy);
  }
  function choose(kind){const p=period(document.getElementById('data-import-hub-month')?.value);syncLegacy(p);const ids={plan:'plan-pdf-file-input',prelim:'preliminary-pl-file',confirmed:'file-input',worker:'field-worker-file-input',shipper:'field-product-file-input',delivery:'route-pdf-file-input',payment:'route-head-payment-file-input'};document.getElementById(ids[kind])?.click();}
  async function statusFor(d,p){
    if(d.id==='PLAN_BUDGET'){const fy=fyOf(p),x=window.STATE?.planData?.[fy];if(!x)return {status:'MISSING',text:'未登録',detail:`${fy}年度`};const cov=x.coverage||x.sourceMeta?.coverage||'UNKNOWN';return {status:'CURRENT',text:cov==='FIRST_HALF_ONLY'?'上期策定済':'登録済',detail:`${fy}年度 · ${x.sourceMeta?.source_type||'SOURCE'}`};}
    if(!window.Repository?.NormalizedSource?.loadManifest)return {status:'UNKNOWN',text:'確認不能',detail:'Repository未読込'};
    const type=d.repo||d.id,r=await Repository.NormalizedSource.loadManifest(type,p),m=r?.manifest||{},bs=Array.isArray(m.batches)?m.batches:[],cur=bs.find(x=>x.batch_id===m.current_batch_id);
    if(!cur)return {status:'MISSING',text:'未登録',detail:'CURRENTなし',revisions:bs.length};
    if(type==='PL_ACTUAL'){const c=await Repository.NormalizedSource.loadCurrent(type,p),st=c?.records?.[0]?.document_state||'UNKNOWN';if(d.state&&st!==d.state)return {status:d.state==='PRELIMINARY'&&st==='CONFIRMED'?'SUPERSEDED':'MISSING',text:st==='CONFIRMED'?'確定済':'未登録',detail:`CURRENT=${st}`,revisions:bs.length};return {status:'CURRENT',text:st,detail:`${cur.record_count??'—'}行`,revisions:bs.length};}
    return {status:'CURRENT',text:'CURRENT',detail:`${cur.record_count??'—'}行`,revisions:bs.length};
  }
  async function refresh(){const host=document.getElementById('data-import-hub-root');if(!host)return;const p=period(document.getElementById('data-import-hub-month')?.value);if(!/^\d{6}$/.test(p)){host.innerHTML='<div class="dih-empty">対象年月を選択してください。</div>';return;}syncLegacy(p);host.innerHTML='<div class="dih-empty">登録状態を確認中…</div>';const rows=[];for(const d of DOCS){try{rows.push([d,await statusFor(d,p)])}catch(e){rows.push([d,{status:'ERROR',text:'確認エラー',detail:e?.message||String(e)}])}}
    const missing=rows.filter(([,s])=>s.status==='MISSING').length,errors=rows.filter(([,s])=>s.status==='ERROR').length;
    host.innerHTML=`<div class="dih-summary"><div><span>対象</span><b>${esc(p.slice(0,4))}年${esc(String(+p.slice(4)))}月</b></div><div><span>主要SOURCE</span><b>${DOCS.length}</b></div><div><span>未登録</span><b>${missing}</b></div><div><span>確認エラー</span><b>${errors}</b></div></div><div class="dih-grid">${rows.map(([d,s])=>`<article class="dih-source"><div class="dih-source-top"><div><small>${esc(d.code)}</small><h3>${esc(d.label)}</h3></div><span class="dih-status is-${esc(s.status.toLowerCase())}">${esc(s.text)}</span></div><div class="dih-meta"><span>単位：${esc(d.scope)}</span><span>${esc(s.detail||'')}</span>${s.revisions!=null?`<span>Revision ${esc(s.revisions)}</span>`:''}</div><button type="button" class="btn" onclick="DATA_IMPORT_HUB.choose('${esc(d.action)}')">ファイルを選択</button></article>`).join('')}</div><div class="dih-foot">CURRENT・RevisionはNormalized Source Repositoryを正本として表示します。予算は年度計画の登録状態を表示します。</div>`;
  }
  function init(){const m=document.getElementById('data-import-hub-month');if(m&&!m.value){const now=new Date(),y=now.getFullYear(),mm=String(now.getMonth()+1).padStart(2,'0');m.value=`${y}-${mm}`;}m?.addEventListener('change',refresh);refresh();window.addEventListener('normalized-source-updated',refresh);}
  document.addEventListener('DOMContentLoaded',init);
  window.DATA_IMPORT_HUB=Object.freeze({refresh,choose});
})();
