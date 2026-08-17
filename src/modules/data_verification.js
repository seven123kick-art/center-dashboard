/* ============================================================
   D3-2: データ確認 UI
   DATA_VERIFICATION_SUMMARY を唯一の画面向け集計入口として使用する。
   STATE/SOURCEをDOM描画側で直接集計しない。
============================================================ */
'use strict';
(function(){
  if(window.__DATA_VERIFICATION_UI_LOADED_20260817__) return;
  window.__DATA_VERIFICATION_UI_LOADED_20260817__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0).toLocaleString('ja-JP');
  const ymLabel2=ym=>/^\d{6}$/.test(String(ym||''))?`${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`:'対象月未選択';
  const statusLabel={OK:'正常',PROVISIONAL:'確認途中',PARTIAL:'要確認',CONFLICT:'不一致',NO_DATA:'データなし'};

  function allYms(){
    const set=new Set();
    const add=x=>{const y=String(x?.ym||'').replace(/\D/g,'').slice(0,6);if(/^\d{6}$/.test(y))set.add(y);};
    (STATE.datasets||[]).forEach(add); (STATE.workerCsvData||[]).forEach(add); (STATE.productAddressData||[]).forEach(add); (STATE.routeData||[]).forEach(add);
    return [...set].sort();
  }
  function selectedYm(){
    const el=document.getElementById('data-verification-ym');
    return el?.value||allYms().at(-1)||'';
  }
  function sourceStatus(ym){
    const ds=(STATE.datasets||[]).filter(x=>x?.ym===ym&&x.source!=='history');
    const confirmed=ds.some(x=>(x.type||'confirmed')==='confirmed');
    const worker=(STATE.workerCsvData||[]).filter(x=>x?.ym===ym);
    const product=(STATE.productAddressData||[]).filter(x=>x?.ym===ym);
    const route=(STATE.routeData||[]).filter(x=>x?.ym===ym);
    const hasRoute=route.some(x=>Array.isArray(x.routes)&&x.routes.length);
    const hasPayment=route.some(x=>Array.isArray(x.headPayments)&&x.headPayments.length);
    return {
      PL_ACTUAL:{present:confirmed,document_states:confirmed?['CONFIRMED']:[],file_count:confirmed?1:0},
      WORKER_SALES:{present:worker.length>0,file_count:worker.length},
      SHIPPER_AREA:{present:product.length>0,file_count:product.length},
      DELIVERY_LIST:{present:hasRoute,file_count:hasRoute?route.length:0},
      ROUTE_PAYMENT:{present:hasPayment,file_count:hasPayment?route.length:0},
    };
  }
  function buildSummary(ym){
    if(!window.CANONICAL_BUILDER||!window.DATA_VERIFICATION_SUMMARY) return null;
    const routeData=(STATE.routeData||[]).filter(x=>x?.ym===ym);
    const snapshot=CANONICAL_BUILDER.buildSnapshot({routeData});
    return DATA_VERIFICATION_SUMMARY.build({
      center_id:window.CENTER?.id||null, year_month:ym, canonical_snapshot:snapshot,
      source_status:sourceStatus(ym), accounting_facts:[], accounting_reconciliations:[]
    });
  }
  function sourceCards(s){
    const names={PL_ACTUAL:'月次収支（確定）',WORKER_SALES:'作業者別売上明細',SHIPPER_AREA:'荷主別配送エリア物量',DELIVERY_LIST:'配達持出予定リスト',ROUTE_PAYMENT:'配達ヘッド傭車料確認'};
    return Object.entries(names).map(([k,label])=>{const x=s.source_status[k]||{};return `<div class="dv-source ${x.present?'is-present':'is-missing'}"><div class="dv-source-mark">${x.present?'✓':'—'}</div><div><div class="dv-source-name">${esc(label)}</div><div class="dv-source-meta">${x.present?`登録あり${x.document_states?.length?' / '+x.document_states.join(', '):''}`:'未登録'}</div></div></div>`}).join('');
  }
  function render(){
    const host=document.getElementById('data-verification-root'); if(!host)return;
    const ym=selectedYm(), yms=allYms();
    const sel=document.getElementById('data-verification-ym');
    if(sel){const keep=sel.value;sel.innerHTML=yms.map(y=>`<option value="${y}">${ymLabel2(y)}</option>`).join('');sel.value=(keep&&yms.includes(keep))?keep:(ym||'');}
    if(!ym){host.innerHTML='<div class="dv-empty">確認できるデータがありません。先にデータ取込を行ってください。</div>';return;}
    const s=buildSummary(ym); if(!s){host.innerHTML='<div class="dv-empty">データ確認基盤を読み込めませんでした。</div>';return;}
    const c=s.entity_counts||{}, l=s.link_summary||{}, i=s.issue_summary||{}, o=s.observation_summary||{}, v=s.value_summary||{};
    host.innerHTML=`
      <div class="dv-overview">
        <div><div class="dv-eyebrow">総合状態</div><div class="dv-status dv-${esc(s.overall_status)}">${esc(statusLabel[s.overall_status]||s.overall_status)}</div></div>
        <div class="dv-overview-note">${esc(ymLabel2(ym))} / ${esc(window.CENTER?.name||'')}</div>
      </div>
      <div class="dv-section-title">必要資料</div><div class="dv-source-grid">${sourceCards(s)}</div>
      <div class="dv-section-title">連動状況</div>
      <div class="dv-kpis">
        <div class="dv-kpi"><span>配送HEAD</span><strong>${n(c.DELIVERY_ROUTE)}</strong></div>
        <div class="dv-kpi"><span>原票</span><strong>${n(c.BUSINESS_SLIP)}</strong></div>
        <div class="dv-kpi"><span>持出履歴</span><strong>${n(c.DELIVERY_ATTEMPT)}</strong></div>
        <div class="dv-kpi"><span>HEADなし原票</span><strong>${n(l.slips_without_delivery_attempt)}</strong><small>正常ケースを含む</small></div>
      </div>
      <div class="dv-two-col">
        <div class="card"><div class="card-header"><span class="card-title">要確認</span></div><div class="card-body dv-lines">
          <div><span>Subject不一致</span><b>${n(i.subject_conflict)}</b></div><div><span>Subject未照合</span><b>${n(i.subject_unmatched)}</b></div><div><span>未評価</span><b>${n(i.subject_not_evaluated)}</b></div><div><span>金額UNKNOWN</span><b>${n(i.unknown_value_count)}</b></div>
        </div></div>
        <div class="card"><div class="card-header"><span class="card-title">差異・観測</span></div><div class="card-body dv-lines">
          <div><span>SOURCE差異</span><b>${n(o.source_variance)}</b></div><div><span>片側SOURCE</span><b>${n(o.single_source)}</b></div><div><span>会計差異</span><b>${n(o.accounting_variance)}</b></div><div><span>会計のみ</span><b>${n(o.accounting_only)}</b></div>
          <p>差異や片側SOURCEは正常な業務ケースを含むため、自動的にエラー扱いしません。</p>
        </div></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">金額データ品質</span></div><div class="card-body"><div class="dv-value-grid">
        <div><span>売上・既知</span><b>${n(v.sales_amount?.known_value)}</b></div><div><span>売上・明示0円</span><b>${n(v.sales_amount?.known_zero)}</b></div><div><span>売上・UNKNOWN</span><b>${n(v.sales_amount?.unknown)}</b></div>
        <div><span>傭車料・既知</span><b>${n(v.route_payment_amount?.known_value)}</b></div><div><span>傭車料・明示0円</span><b>${n(v.route_payment_amount?.known_zero)}</b></div><div><span>傭車料・UNKNOWN</span><b>${n(v.route_payment_amount?.unknown)}</b></div>
      </div><div class="dv-footnote">現在の画面はD3-1共通サマリーを参照しています。未接続の詳細SOURCEは0件ではなく「未評価」として扱います。</div></div></div>`;
  }
  window.DATA_VERIFICATION_UI=Object.freeze({render,buildSummary});
})();
