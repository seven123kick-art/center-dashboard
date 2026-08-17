/* ============================================================
   D3-3: データ確認 UI
   Summary=集計、Detail=掘り下げをそれぞれ共通派生レイヤーから取得。
   UIからSOURCEを直接判定・解決・保存しない。
============================================================ */
'use strict';
(function(){
  if(window.__DATA_VERIFICATION_UI_LOADED_20260817__) return;
  window.__DATA_VERIFICATION_UI_LOADED_20260817__=true;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0).toLocaleString('ja-JP');
  const yen=v=>`${Number(v||0).toLocaleString('ja-JP')}円`;
  const ymLabel=ym=>/^\d{6}$/.test(String(ym||''))?`${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`:'対象月未選択';
  const statusLabel={OK:'正常',PROVISIONAL:'確認途中',PARTIAL:'要確認',CONFLICT:'不一致',NO_DATA:'データなし'};
  let detailMode='WORKER_LABELS';
  let resolutionPreviewState=null;
  let persistedResolutionDecisions=[];
  let resolutionLoadState='IDLE';
  let resolutionMessage=null;
  const materializedByYm=new Map();
  const materializeStateByYm=new Map();

  async function ensureResolutionLoaded(force=false){
    if(!window.Repository?.Resolution) return;
    if(!force&&['LOADING','LOADED'].includes(resolutionLoadState)) return;
    resolutionLoadState='LOADING';
    try{
      const r=await Repository.Resolution.load();
      if(!r?.ok) throw new Error(r?.error||'Resolutionの読込に失敗しました');
      persistedResolutionDecisions=Array.isArray(r.decisions)?r.decisions:[];
      resolutionLoadState='LOADED';
      if(force) resolutionMessage={type:'success',text:'保存内容をCloudから再取得し、Resolverへ反映しました。'};
    }catch(e){
      resolutionLoadState='ERROR';
      resolutionMessage={type:'error',text:e?.message||String(e)};
    }
    render();
  }

  function allYms(){const set=new Set(),add=x=>{const y=String(x?.ym||'').replace(/\D/g,'').slice(0,6);if(/^\d{6}$/.test(y))set.add(y)};(STATE.datasets||[]).forEach(add);(STATE.workerCsvData||[]).forEach(add);(STATE.productAddressData||[]).forEach(add);(STATE.routeData||[]).forEach(add);return [...set].sort();}
  function selectedYm(){const el=document.getElementById('data-verification-ym');return el?.value||allYms().at(-1)||'';}
  function sourceStatus(ym){const ds=(STATE.datasets||[]).filter(x=>x?.ym===ym&&x.source!=='history'),confirmed=ds.some(x=>(x.type||'confirmed')==='confirmed'),worker=(STATE.workerCsvData||[]).filter(x=>x?.ym===ym),product=(STATE.productAddressData||[]).filter(x=>x?.ym===ym),route=(STATE.routeData||[]).filter(x=>x?.ym===ym),hasRoute=route.some(x=>Array.isArray(x.routes)&&x.routes.length),hasPayment=route.some(x=>Array.isArray(x.headPayments)&&x.headPayments.length);return {PL_ACTUAL:{present:confirmed,document_states:confirmed?['CONFIRMED']:[],file_count:confirmed?1:0},WORKER_SALES:{present:worker.length>0,file_count:worker.length},SHIPPER_AREA:{present:product.length>0,file_count:product.length},DELIVERY_LIST:{present:hasRoute,file_count:hasRoute?route.length:0},ROUTE_PAYMENT:{present:hasPayment,file_count:hasPayment?route.length:0}};}
  async function ensureMaterialized(ym,force=false){
    if(!ym||!window.CANONICAL_MATERIALIZER) return;
    if(!force&&materializeStateByYm.get(ym)==='LOADED') return;
    if(!force&&materializeStateByYm.get(ym)==='LOADING') return;
    materializeStateByYm.set(ym,'LOADING');
    try{
      const r=await CANONICAL_MATERIALIZER.materialize({period:ym,resolutionDecisions:persistedResolutionDecisions});
      if(r?.snapshot?.materialization && Object.values(r.snapshot.materialization.current_batches||{}).some(Boolean)) materializedByYm.set(ym,r);
      else materializedByYm.delete(ym);
      materializeStateByYm.set(ym,'LOADED');
    }catch(e){
      materializeStateByYm.set(ym,'ERROR');
      console.warn('[DataVerification] Canonical materialize failed',e);
    }
    render();
  }
  function buildData(ym){
    if(!window.CANONICAL_BUILDER||!window.DATA_VERIFICATION_SUMMARY)return null;
    const m=materializedByYm.get(ym)||null;
    const routeData=(STATE.routeData||[]).filter(x=>x?.ym===ym);
    const snapshot=m?.snapshot||CANONICAL_BUILDER.buildSnapshot({routeData});
    const legacyMaster={workers:[...(STATE.workerMaster||[])],companies:[...(STATE.companyMaster||[])],center:window.CENTER||null};
    const resolutionContext=m?.resolutionContext||window.RESOLUTION_PREVIEW?.buildContext?.(Object.assign({},legacyMaster,{resolutionDecisions:persistedResolutionDecisions}))||null;
    const normalizedStatus=sourceStatus(ym);
    if(m?.snapshot?.materialization?.current_batches){
      const cb=m.snapshot.materialization.current_batches;
      for(const k of ['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT']) if(cb[k]){ normalizedStatus[k]={...(normalizedStatus[k]||{}),present:true,batch_count:1}; }
      if(cb.PL_ACTUAL){ const states=[...new Set((snapshot.entities.ACCOUNTING_FACT||[]).map(x=>x.document_state).filter(Boolean))]; normalizedStatus.PL_ACTUAL.document_states=states; }
    }
    return {snapshot,materialization:m?.snapshot?.materialization||null,summary:DATA_VERIFICATION_SUMMARY.build({center_id:window.CENTER?.id||null,year_month:ym,canonical_snapshot:snapshot,source_status:normalizedStatus,accounting_facts:snapshot.entities.ACCOUNTING_FACT||[],accounting_reconciliations:snapshot.entities.ACCOUNTING_RECONCILIATION||[]}),detail:window.DATA_VERIFICATION_DETAIL?.build({center_id:window.CENTER?.id||null,year_month:ym,canonical_snapshot:snapshot,worker_csv_data:STATE.workerCsvData||[],resolution_context:resolutionContext})||null};
  }
  function buildSummary(ym){return buildData(ym)?.summary||null;}
  function sourceCards(s){const names={PL_ACTUAL:'月次収支（確定）',WORKER_SALES:'作業者別売上明細',SHIPPER_AREA:'荷主別配送エリア物量',DELIVERY_LIST:'配達持出予定リスト',ROUTE_PAYMENT:'配達ヘッド傭車料確認'};return Object.entries(names).map(([k,label])=>{const x=s.source_status[k]||{};return `<div class="dv-source ${x.present?'is-present':'is-missing'}"><div class="dv-source-mark">${x.present?'✓':'—'}</div><div><div class="dv-source-name">${esc(label)}</div><div class="dv-source-meta">${x.present?`登録あり${x.document_states?.length?' / '+x.document_states.join(', '):''}`:'未登録'}</div></div></div>`}).join('');}
  function detailTable(d){if(!d)return '<div class="dv-empty-inline">詳細基盤を読み込めません。</div>';
    if(detailMode==='WORKER_LABELS'){const rows=d.resolution_preview?.rows||[];return `<div class="dv-detail-note">既存マスタと保存済みAliasを照合した候補です。確定した紐付けはResolution履歴としてCloudへ保存し、SOURCEやMaster本体は変更しません。</div><table class="dv-table"><thead><tr><th>原表記</th><th>件数</th><th>Resolver結果</th><th>根拠 / 信頼度</th><th>候補</th><th></th></tr></thead><tbody>${rows.map((x,i)=>{const r=x.resolution||{},ids=r.candidates||[],opts=ids.map(id=>`<option value="${esc(id)}" ${id===r.resolved_id?'selected':''}>${esc(id)}</option>`).join('');return `<tr><td>${esc(x.source_label)}</td><td>${n(x.slip_count)}</td><td><span class="dv-pill ${r.status==='CONFLICT'||r.status==='UNMATCHED'?'is-attention':''}">${esc(r.subject_type||'UNKNOWN')} / ${esc(r.status||'NOT_EVALUATED')}</span></td><td>${esc(r.match_method||'—')} / ${r.match_confidence==null?'—':Math.round(r.match_confidence*100)+'%'}</td><td>${ids.length?`<select class="dv-candidate" id="dv-candidate-${i}">${opts}</select>`:'—'}</td><td>${ids.length?`<button type="button" class="btn dv-preview-btn" onclick="DATA_VERIFICATION_UI.previewResolution(${i})">保存時プレビュー</button>`:'<span class="dv-muted">候補なし</span>'}</td></tr>`}).join('')||'<tr><td colspan="6">対象データなし</td></tr>'}</tbody></table>${resolutionPreviewState?`<div class="dv-preview-box"><b>保存内容の確認</b><div>原表記：${esc(resolutionPreviewState.source_value)}</div><div>種別：${esc(resolutionPreviewState.entity_type)} ／ 選択先：${esc(resolutionPreviewState.selected_master_id)}</div><div>Alias：${resolutionPreviewState.alias_label?esc(resolutionPreviewState.alias_label)+' → '+esc(resolutionPreviewState.selected_master_id):'作成なし'}</div><div class="dv-preview-actions"><button type="button" class="btn" onclick="DATA_VERIFICATION_UI.saveResolution()">この内容で保存</button></div><small>保存後はCloudから再取得して確認し、有効Aliasを再構成してResolverを再評価します。</small></div>`:''}${resolutionMessage?`<div class="dv-resolution-message is-${esc(resolutionMessage.type)}">${esc(resolutionMessage.text)}</div>`:''}`;}
    if(detailMode==='HEADLESS'){const rows=d.headless_observations||[];return `<div class="dv-detail-note">HEADなしは直接完了等の正常ケースを含むため、異常とは判定しません。</div><table class="dv-table"><thead><tr><th>原票NO</th><th>状態</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.slip_no||'—')}</td><td><span class="dv-pill is-observation">観測</span></td></tr>`).join('')||'<tr><td colspan="2">対象データなし</td></tr>'}</tbody></table>`;}
    if(detailMode==='VALUE'){const rows=d.value_attention||[];return `<div class="dv-detail-note">0円ではなく、金額を確定できないレコードだけを表示します。</div><table class="dv-table"><thead><tr><th>対象</th><th>原票NO</th><th>HEAD</th><th>状態</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.entity)}</td><td>${esc(x.slip_no||'—')}</td><td>${esc(x.head_no||'—')}</td><td><span class="dv-pill is-attention">${esc(x.status)}</span></td></tr>`).join('')||'<tr><td colspan="4">対象データなし</td></tr>'}</tbody></table>`;}
    const rows=d.reconciliation_observations||[];return `<div class="dv-detail-note">差異・片側SOURCEは正常ケースを含むため、観測情報として表示します。</div><table class="dv-table"><thead><tr><th>状態</th><th>左値</th><th>右値</th><th>差額</th></tr></thead><tbody>${rows.map(x=>`<tr><td><span class="dv-pill is-observation">${esc(x.status)}</span></td><td>${x.left_value==null?'—':yen(x.left_value)}</td><td>${x.right_value==null?'—':yen(x.right_value)}</td><td>${x.difference==null?'—':yen(x.difference)}</td></tr>`).join('')||'<tr><td colspan="4">対象データなし</td></tr>'}</tbody></table>`;}
  function previewResolution(index){const ym=selectedYm(),data=buildData(ym),row=data?.detail?.resolution_preview?.rows?.[index],sel=document.getElementById(`dv-candidate-${index}`);if(!row||!sel?.value||!window.MASTER_RESOLVER?.makeResolutionDecision)return;const r=row.resolution||{};const p=MASTER_RESOLVER.makeResolutionDecision({entity_type:r.subject_type||'UNKNOWN',source_value:row.source_label,source_document_type:'WORKER_SALES',selected_master_id:sel.value,remember_as_alias:true});if(!p.ok)return;resolutionPreviewState={index,source_value:row.source_label,entity_type:r.subject_type||'UNKNOWN',selected_master_id:sel.value,alias_label:p.alias_proposal?.alias_label||null};resolutionMessage=null;render();}
  async function saveResolution(){
    const x=resolutionPreviewState;
    if(!x||!window.MASTER_RESOLVER?.makeResolutionDecision||!window.Repository?.Resolution) return;
    if(!confirm(`「${x.source_value}」を ${x.selected_master_id} に紐付けて記憶します。よろしいですか？`)) return;
    const p=MASTER_RESOLVER.makeResolutionDecision({entity_type:x.entity_type,source_value:x.source_value,source_document_type:'WORKER_SALES',selected_master_id:x.selected_master_id,remember_as_alias:true,decided_at:new Date().toISOString(),decided_by:null});
    if(!p.ok){resolutionMessage={type:'error',text:(p.errors||['Decision作成に失敗しました']).join(' / ')};render();return;}
    const active=window.RESOLUTION_LEDGER?.activeDecisions?.(persistedResolutionDecisions)||[];
    const previous=active.find(d=>d.entity_type===x.entity_type&&d.source_value===x.source_value&&d.source_document_type==='WORKER_SALES');
    if(previous?.selected_master_id===x.selected_master_id){resolutionPreviewState=null;resolutionMessage={type:'success',text:'同じ紐付けが既に有効です。追加保存は行いませんでした。'};render();return;}
    if(previous?.resolution_decision_id) p.decision.supersedes_resolution_decision_id=previous.resolution_decision_id;
    resolutionMessage={type:'working',text:'Cloudへ保存しています…'};render();
    try{
      const saved=await Repository.Resolution.appendDecision(p.decision);
      if(!saved?.ok) throw new Error(saved?.error||'Resolution保存に失敗しました');
      const verify=await Repository.Resolution.load();
      if(!verify?.ok) throw new Error(verify?.error||'保存後の再取得に失敗しました');
      const found=(verify.decisions||[]).some(d=>d.resolution_decision_id===p.decision.resolution_decision_id&&d.decision_status==='ACTIVE');
      if(!found) throw new Error('保存後の再取得でDecisionを確認できませんでした');
      persistedResolutionDecisions=verify.decisions||[];
      resolutionLoadState='LOADED';
      resolutionPreviewState=null;
      resolutionMessage={type:'success',text:'保存・Cloud再取得確認・Alias再構成・Canonical再構築が完了しました。'};
      await ensureMaterialized(selectedYm(),true);
      render();
    }catch(e){resolutionMessage={type:'error',text:e?.message||String(e)};render();}
  }
  const parityByFy=new Map();
  const parityStateByFy=new Map();
  const parityLabel=Object.freeze({READY:'一致',MISMATCH:'差異あり',UNKNOWN_AMOUNT:'金額不明',PL_ACTUAL_NOT_NORMALIZED:'PL未正規化',LEGACY_MISSING:'現行Datasetなし',CANONICAL_FAILED:'Canonical失敗',CANONICAL_UNAVAILABLE:'Canonical未利用'});
  const parityYen=v=>Number.isFinite(Number(v))?`${Math.round(Number(v)).toLocaleString('ja-JP')}円`:'—';
  function fiscalYearOfYm(ym){return Number(String(ym).slice(4))>=4?String(ym).slice(0,4):String(Number(String(ym).slice(0,4))-1);}
  function ensureParity(ym,force=false){
    if(!ym||!window.ACCOUNTING_PARITY?.checkFiscalYear)return;
    const fy=fiscalYearOfYm(ym);
    if(!force&&['LOADING','LOADED'].includes(parityStateByFy.get(fy)))return;
    parityStateByFy.set(fy,'LOADING');
    return ACCOUNTING_PARITY.checkFiscalYear(fy,{force}).then(r=>{
      parityByFy.set(fy,r); parityStateByFy.set(fy,'LOADED'); render(); return r;
    }).catch(e=>{
      parityByFy.set(fy,{status:'ERROR',fiscalYear:fy,error:e?.message||String(e),months:[]});
      parityStateByFy.set(fy,'ERROR'); render(); throw e;
    });
  }
  function parityHtml(ym){
    if(!window.ACCOUNTING_PARITY?.checkFiscalYear)return '';
    const fy=fiscalYearOfYm(ym),state=parityStateByFy.get(fy),report=parityByFy.get(fy);
    if(!state){ensureParity(ym);return `<div class="card dv-parity-card"><div class="card-header"><span class="card-title">収支データ移行診断</span><span class="dv-readonly">${esc(fy)}年度</span></div><div class="card-body"><div class="dv-parity-loading">Canonical PL_ACTUALと現行Datasetを比較しています…</div></div></div>`;}
    if(state==='LOADING')return `<div class="card dv-parity-card"><div class="card-header"><span class="card-title">収支データ移行診断</span><span class="dv-readonly">${esc(fy)}年度</span></div><div class="card-body"><div class="dv-parity-loading">Canonical PL_ACTUALと現行Datasetを比較しています…</div></div></div>`;
    if(state==='ERROR'||report?.status==='ERROR')return `<div class="card dv-parity-card"><div class="card-header"><span class="card-title">収支データ移行診断</span><span class="dv-readonly">${esc(fy)}年度</span></div><div class="card-body"><div class="dv-parity-error">${esc(report?.error||'診断に失敗しました')}</div></div></div>`;
    const c=report?.counts||{};
    const cards=(report?.months||[]).map(r=>{
      const mm=Number(String(r.period||'').slice(4));
      const cls=r.status==='READY'?'is-ready':r.status==='MISMATCH'?'is-mismatch':r.status==='UNKNOWN_AMOUNT'?'is-unknown':'is-pending';
      const diffs=(r.mismatches||[]).slice(0,3).map(x=>`${esc(x.key)} ${parityYen(x.legacy)} → ${parityYen(x.canonical)}（差 ${parityYen(x.difference)}）`).join('<br>');
      const totals=(r.total_mismatches||[]).slice(0,2).map(x=>`${esc(x.key)} ${parityYen(x.legacy)} → ${parityYen(x.canonical)}`).join('<br>');
      const detail=diffs||totals||(r.error?esc(r.error):'');
      return `<div class="dv-parity-month ${cls}"><div><strong>${mm}月</strong><span>${esc(parityLabel[r.status]||r.status)}</span></div>${detail?`<small>${detail}</small>`:''}</div>`;
    }).join('');
    return `<div class="card dv-parity-card"><div class="card-header"><span class="card-title">収支データ移行診断</span><span class="dv-readonly">${esc(fy)}年度</span></div><div class="card-body"><div class="dv-parity-head"><span class="dv-parity-summary ${report?.migrationReady?'is-ready':'is-review'}">${report?.migrationReady?'12か月一致':'確認が必要'}</span><div class="dv-parity-actions">${(c.PL_ACTUAL_NOT_NORMALIZED||0)>0?`<button type="button" class="btn dv-parity-migrate" onclick="DATA_VERIFICATION_UI.migrateLegacyAccounting()">既存確定データを移行</button>`:''}<button type="button" class="btn dv-parity-refresh" onclick="DATA_VERIFICATION_UI.refreshParity()">再診断</button></div></div><div class="dv-parity-counts"><span>一致 ${n(c.READY)}</span><span>差異 ${n(c.MISMATCH)}</span><span>金額不明 ${n(c.UNKNOWN_AMOUNT)}</span><span>未正規化 ${n(c.PL_ACTUAL_NOT_NORMALIZED)}</span><span>現行なし ${n(c.LEGACY_MISSING)}</span></div><div class="dv-parity-months">${cards}</div><div class="dv-footnote">${esc(report?.note||'診断結果による自動修正・自動切替は行いません。')}</div></div></div>`;
  }
  async function migrateLegacyAccounting(){
    const ym=selectedYm(),fy=fiscalYearOfYm(ym);
    if(!window.ACCOUNTING_LEGACY_MIGRATION?.migrateFiscalYear){UI?.toast?.('収支移行基盤を読み込めません','error');return;}
    const targets=(parityByFy.get(fy)?.months||[]).filter(x=>x.status==='PL_ACTUAL_NOT_NORMALIZED').map(x=>x.period);
    if(!targets.length){UI?.toast?.('移行対象の確定収支はありません','warn');return;}
    const ok=confirm(`${fy}年度のうち、PL未正規化の既存確定収支（${targets.map(x=>Number(x.slice(4))+'月').join('・')}）をCanonical PL_ACTUALへ移行します。\n\n原CSV明細を復元する処理ではなく、現在保存されている確定科目合計をACCOUNT_TOTAL粒度で移行します。既存の収支Datasetは変更しません。\n\n実行しますか？`);
    if(!ok)return;
    try{
      UI?.toast?.('既存確定収支を移行しています…');
      const verified=[];
      for(const period of targets){
        const r=await ACCOUNTING_LEGACY_MIGRATION.migrateMonth(period);
        if(!r?.ok)throw new Error(`${period}: ${r?.error||'移行失敗'}${r?.stage?` [${r.stage}]`:''}`);
        if(!r?.verified_readback)throw new Error(`${period}: Cloud読戻し確認が完了していません`);
        verified.push(period);
      }
      parityStateByFy.delete(fy);parityByFy.delete(fy);
      try{await ensureMaterialized(ym,true);}catch(e){console.warn('[D4-29] selected month rematerialize failed',e);}
      await ensureParity(ym,true);
      UI?.toast?.(`既存確定収支をCloud読戻し確認済みで移行しました（${verified.map(x=>Number(x.slice(4))+'月').join('・')}）`);
    }catch(e){console.error('[D4-28] accounting migration failed',e);UI?.toast?.(`収支移行に失敗しました：${e?.message||e}`,'error');}
  }
  function setDetail(mode){detailMode=mode;resolutionPreviewState=null;render();}
  function render(){const host=document.getElementById('data-verification-root');if(!host)return;if(resolutionLoadState==='IDLE')ensureResolutionLoaded();const ym=selectedYm(),yms=allYms(),sel=document.getElementById('data-verification-ym');if(ym&&resolutionLoadState==='LOADED'&&!materializeStateByYm.has(ym))ensureMaterialized(ym);if(sel){const keep=sel.value;sel.innerHTML=yms.map(y=>`<option value="${y}">${ymLabel(y)}</option>`).join('');sel.value=(keep&&yms.includes(keep))?keep:(ym||'');}if(!ym){host.innerHTML='<div class="dv-empty">確認できるデータがありません。先にデータ取込を行ってください。</div>';return;}const data=buildData(ym);if(!data){host.innerHTML='<div class="dv-empty">データ確認基盤を読み込めませんでした。</div>';return;}const s=data.summary,c=s.entity_counts||{},l=s.link_summary||{},i=s.issue_summary||{},o=s.observation_summary||{},v=s.value_summary||{};
    host.innerHTML=`<div class="dv-overview"><div><div class="dv-eyebrow">総合状態</div><div class="dv-status dv-${esc(s.overall_status)}">${esc(statusLabel[s.overall_status]||s.overall_status)}</div></div><div class="dv-overview-note">${esc(ymLabel(ym))} / ${esc(window.CENTER?.name||'')}</div></div>
    <div class="dv-section-title">必要資料</div><div class="dv-source-grid">${sourceCards(s)}</div>
    <div class="dv-section-title">連動状況</div><div class="dv-kpis"><div class="dv-kpi"><span>配送HEAD</span><strong>${n(c.DELIVERY_ROUTE)}</strong></div><div class="dv-kpi"><span>原票</span><strong>${n(c.BUSINESS_SLIP)}</strong></div><div class="dv-kpi"><span>持出履歴</span><strong>${n(c.DELIVERY_ATTEMPT)}</strong></div><div class="dv-kpi"><span>HEADなし原票</span><strong>${n(l.slips_without_delivery_attempt)}</strong><small>正常ケースを含む</small></div></div>
    <div class="dv-two-col"><div class="card"><div class="card-header"><span class="card-title">要確認</span></div><div class="card-body dv-lines"><div><span>Subject不一致</span><b>${n(i.subject_conflict)}</b></div><div><span>Subject未照合</span><b>${n(i.subject_unmatched)}</b></div><div><span>未評価</span><b>${n(i.subject_not_evaluated)}</b></div><div><span>金額UNKNOWN</span><b>${n(i.unknown_value_count)}</b></div></div></div><div class="card"><div class="card-header"><span class="card-title">差異・観測</span></div><div class="card-body dv-lines"><div><span>SOURCE差異</span><b>${n(o.source_variance)}</b></div><div><span>片側SOURCE</span><b>${n(o.single_source)}</b></div><div><span>会計差異</span><b>${n(o.accounting_variance)}</b></div><div><span>会計のみ</span><b>${n(o.accounting_only)}</b></div><p>差異や片側SOURCEは正常な業務ケースを含むため、自動的にエラー扱いしません。</p></div></div></div>
    <div class="card"><div class="card-header"><span class="card-title">金額データ品質</span></div><div class="card-body"><div class="dv-value-grid"><div><span>売上・既知</span><b>${n(v.sales_amount?.known_value)}</b></div><div><span>売上・明示0円</span><b>${n(v.sales_amount?.known_zero)}</b></div><div><span>売上・UNKNOWN</span><b>${n(v.sales_amount?.unknown)}</b></div><div><span>傭車料・既知</span><b>${n(v.route_payment_amount?.known_value)}</b></div><div><span>傭車料・明示0円</span><b>${n(v.route_payment_amount?.known_zero)}</b></div><div><span>傭車料・UNKNOWN</span><b>${n(v.route_payment_amount?.unknown)}</b></div></div></div></div>
    <div class="card dv-detail-card"><div class="card-header"><span class="card-title">確認詳細</span><span class="dv-readonly">Resolution保存対応</span></div><div class="card-body"><div class="dv-tabs">${[['WORKER_LABELS','帰属主体表記'],['HEADLESS','HEADなし原票'],['VALUE','金額UNKNOWN'],['RECON','SOURCE差異']].map(([k,t])=>`<button type="button" class="dv-tab ${detailMode===k?'active':''}" onclick="DATA_VERIFICATION_UI.setDetail('${k}')">${t}</button>`).join('')}</div><div class="dv-detail-scroll">${detailTable(data.detail)}</div><div class="dv-footnote">D3-5Cでは人が確定したResolutionのみを履歴保存します。SOURCE・Master本体は変更せず、Aliasは有効Decisionから再構成します。</div></div></div>
    ${parityHtml(ym)}`;}
  window.addEventListener?.('normalized-source-updated',ev=>{
    const ym=ev?.detail?.period; if(!ym)return;
    materializeStateByYm.delete(ym); materializedByYm.delete(ym);
    if(selectedYm()===ym&&resolutionLoadState==='LOADED') ensureMaterialized(ym,true);
  });
  window.DATA_VERIFICATION_UI=Object.freeze({render,buildSummary,setDetail,previewResolution,saveResolution,refreshResolution:async()=>{await ensureResolutionLoaded(true);await ensureMaterialized(selectedYm(),true);},refreshCanonical:()=>ensureMaterialized(selectedYm(),true),refreshParity:()=>ensureParity(selectedYm(),true),migrateLegacyAccounting});
})();
