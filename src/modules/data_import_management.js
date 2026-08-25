/* Version6 D3-10: Data Catalog based import management */
'use strict';
(function(){
  if(window.__DATA_IMPORT_MANAGEMENT_LOADED_20260817__)return; window.__DATA_IMPORT_MANAGEMENT_LOADED_20260817__=true;
  const TYPES=['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT'];
  const LABEL={PL_ACTUAL:'収支実績',WORKER_SALES:'作業者別売上明細',SHIPPER_AREA:'荷主別配送エリア物量',DELIVERY_LIST:'配達持出予定リスト',ROUTE_PAYMENT:'配達ヘッド傭車料確認'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periodFromMonth=v=>String(v||'').replace('-','');
  const monthFromPeriod=v=>/^\d{6}$/.test(String(v||''))?`${String(v).slice(0,4)}-${String(v).slice(4)}`:'';
  function defaultPeriod(){const ym=window.STATE?.selectedYM||window.STATE?.currentYM||'';return /^\d{6}$/.test(ym)?ym:'';}
  function setMsg(text,type=''){const el=document.getElementById('preliminary-pl-msg');if(el){el.textContent=text||'';el.className=`dim-message ${type?`is-${type}`:''}`;}}
  async function importPreliminary(){
    const month=document.getElementById('preliminary-pl-month')?.value||'', period=periodFromMonth(month), file=document.getElementById('preliminary-pl-file')?.files?.[0];
    const fail=message=>{setMsg(message,'error');throw new Error(message);};
    if(!/^\d{6}$/.test(period))return fail('対象年月を選択してください。');
    if(!file)return fail('SKDL0002のCSVを選択してください。');
    if(!/\.csv$/i.test(file.name))return fail('CSVファイルを選択してください。');
    if(!window.ACCOUNTING_IMPORT_BRIDGE?.persistCsvText)return fail('速報取込基盤を読み込めません。');
    setMsg('内容を確認して保存しています…');
    try{ await window.DATA_PIPELINE_STATUS?.setStage?.(period,'PL_ACTUAL','SOURCE','OK',{message:'SKDL0002 file selected',detail:{file_name:file.name}}); }catch(_e){}
    try{
      const text=window.CSV?.read?await CSV.read(file):await file.text();
      const r=await ACCOUNTING_IMPORT_BRIDGE.persistCsvText(text,{period,document_state:'PRELIMINARY',file_name:file.name});
      if(!r?.ok)throw new Error(r?.error||'保存に失敗しました');
      if(document.getElementById('preliminary-pl-file'))document.getElementById('preliminary-pl-file').value='';
      const status=document.getElementById('normalized-status-month');if(status)status.value=month;
      await refresh();
      let canonicalOk=true,canonicalError='';
      if(window.CANONICAL_MATERIALIZER?.materialize){
        try{await CANONICAL_MATERIALIZER.materialize({period});}
        catch(e){
          canonicalOk=false;canonicalError=e?.message||String(e);
          console.error('[DataImportManagement] Canonical rebuild failed after preliminary import',e);
        }
      }
      const result={ok:true,period,record_count:r.record_count||0,batch_id:r.batch_id||null,canonical_ok:canonicalOk,canonical_error:canonicalError};
      setMsg(canonicalOk
        ?`SKDL0002速報を登録しました（${period.slice(0,4)}年${Number(period.slice(4))}月 / ${result.record_count}行）`
        :`SKDL0002速報は登録済みですが、表示用データの再構築に失敗しました。データ確認画面で再構築してください。（${canonicalError}）`,canonicalOk?'ok':'error');
      return result;
    }catch(e){
      const message=e?.message||String(e);setMsg(message,'error');throw e;
    }
  }
  const PIPELINE_STATUS_LABELS=Object.freeze({OK:'正常',PARTIAL:'部分完了',FAILED:'失敗',RUNNING:'処理中',UNKNOWN:'未確認'});
  const PIPELINE_STAGE_LABELS=Object.freeze({SOURCE:'SOURCE',NORMALIZED:'NORMALIZED',CANONICAL:'CANONICAL',DISPLAY_SNAPSHOT:'SNAPSHOT',CLOUD:'CLOUD'});
  function setPipelineActionMessage(text,type=''){
    const el=document.getElementById('pipeline-action-msg');
    if(el){el.textContent=text||'';el.className=`dim-pipeline-action-msg ${type?`is-${type}`:''}`;}
  }
  async function verifyAndRebuildCurrent(){
    const input=document.getElementById('normalized-status-month');
    const period=periodFromMonth(input?.value||'');
    if(!/^\d{6}$/.test(period)){setPipelineActionMessage('確認年月を選択してください。','error');return;}
    if(!window.DATA_PIPELINE_RECOVERY?.verifyAndRebuild){setPipelineActionMessage('データ再確認基盤を読み込めません。','error');return;}
    setPipelineActionMessage('CloudのCURRENTデータを確認し、表示用データを再構築しています…');
    const btn=document.getElementById('pipeline-verify-rebuild-btn'); if(btn)btn.disabled=true;
    try{
      const r=await DATA_PIPELINE_RECOVERY.verifyAndRebuild(period);
      const failed=(r.sources||[]).filter(x=>!x.ok);
      const missing=(r.sources||[]).filter(x=>x.ok&&!x.registered);
      if(failed.length){setPipelineActionMessage(`再確認は完了しましたが、${failed.length}資料で取得/整合エラーがあります。詳細状態を確認してください。`,'error');}
      else if(r.materialized?.ok===false){setPipelineActionMessage(`SOURCE確認は完了しましたが、Canonical再構築に失敗しました。（${r.materialized.error||'詳細不明'}）`,'error');}
      else{setPipelineActionMessage(`再確認・再構築が完了しました。未登録資料 ${missing.length}件。`,'ok');}
      await refresh();
    }catch(e){setPipelineActionMessage(e?.message||String(e),'error');}
    finally{if(btn)btn.disabled=false;}
  }

  function formatPipelineTime(value){
    if(!value)return '—';
    try{return new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
    catch(_e){return String(value);}
  }
  function issueInfo(type,stages){
    const order=['SOURCE','NORMALIZED','CANONICAL','DISPLAY_SNAPSHOT','CLOUD'];
    const problem=order.find(k=>['FAILED','PARTIAL'].includes(stages[k]?.status))
      ||order.find(k=>(stages[k]?.status||'UNKNOWN')==='UNKNOWN');
    if(!problem)return null;
    const state=stages[problem]?.status||'UNKNOWN';
    const message=stages[problem]?.message||'処理状態を確認できません。';
    let action='状態を再確認';
    if(problem==='SOURCE'&&state==='UNKNOWN') action='SOURCE履歴を再確認。確認できない場合は元資料の再取込';
    else if(problem==='SOURCE') action='元資料を確認し、必要なら再取込';
    else if(problem==='NORMALIZED'||problem==='CLOUD') action='状態を再確認・再構築';
    else if(problem==='CANONICAL'||problem==='DISPLAY_SNAPSHOT') action='再構築';
    const lastOk=order.map(k=>stages[k]?.last_ok_at).filter(Boolean).sort().at(-1)||null;
    return {type,problem,state,message,action,lastOk};
  }
  async function pipelineHtml(period){
    if(!window.DATA_PIPELINE_STATUS?.load) return '';
    const all=await DATA_PIPELINE_STATUS.load(period,'ALL');
    const rows=[],issues=[];
    for(const type of TYPES){
      const own=await DATA_PIPELINE_STATUS.load(period,type), stages={...(own?.stages||{})};
      ['CANONICAL','DISPLAY_SNAPSHOT'].forEach(k=>{
        if(all?.stages?.[k]?.status&&all.stages[k].status!=='UNKNOWN') stages[k]=all.stages[k];
      });
      const order=['SOURCE','NORMALIZED','CANONICAL','DISPLAY_SNAPSHOT','CLOUD'];
      const values=order.map(k=>stages[k]?.status||'UNKNOWN');
      const overall=values.includes('FAILED')?'FAILED':values.includes('PARTIAL')?'PARTIAL':values.includes('RUNNING')?'RUNNING':values.includes('UNKNOWN')?'UNKNOWN':'OK';
      const chips=order.map(k=>{const st=stages[k]?.status||'UNKNOWN';return `<span class="dim-pipe-chip is-${st.toLowerCase()}">${PIPELINE_STAGE_LABELS[k]}:${PIPELINE_STATUS_LABELS[st]||st}</span>`;}).join('');
      rows.push(`<div class="dim-pipe-row"><div class="dim-pipe-name"><strong>${esc(LABEL[type]||type)}</strong><span class="dim-pipe-overall is-${overall.toLowerCase()}">${PIPELINE_STATUS_LABELS[overall]||overall}</span></div><div class="dim-pipe-chips">${chips}</div></div>`);
      const issue=issueInfo(type,stages); if(issue)issues.push(issue);
    }
    const rank={FAILED:0,PARTIAL:1,UNKNOWN:2,RUNNING:3};
    issues.sort((a,b)=>(rank[a.state]??9)-(rank[b.state]??9));
    const issueHtml=issues.length
      ?`<section class="dim-pipeline-issues"><div class="dim-issue-title"><b>要対応</b><span>${issues.length}件</span></div>${issues.map(x=>`<div class="dim-issue-row is-${x.state.toLowerCase()}"><div class="dim-issue-main"><strong>${esc(LABEL[x.type]||x.type)}</strong><span>${esc(PIPELINE_STAGE_LABELS[x.problem]||x.problem)} · ${esc(PIPELINE_STATUS_LABELS[x.state]||x.state)}</span></div><div class="dim-issue-reason">${esc(x.message)}</div><div class="dim-issue-meta"><span>最終正常 ${esc(formatPipelineTime(x.lastOk))}</span><strong>${esc(x.action)}</strong></div></div>`).join('')}</section>`
      :`<section class="dim-pipeline-all-ok"><strong>要対応なし</strong><span>確認できた処理はすべて正常です。</span></section>`;
    return `<section class="dim-pipeline-status"><div class="dim-pipeline-head"><div><b>データ処理状況</b><span>SOURCE → NORMALIZED → CANONICAL → SNAPSHOT → CLOUD</span></div><button id="pipeline-verify-rebuild-btn" class="btn-secondary dim-pipeline-action" type="button">状態を再確認・再構築</button></div><div id="pipeline-action-msg" class="dim-pipeline-action-msg"></div>${issueHtml}<details class="dim-pipeline-detail"><summary>全データの処理状況を表示</summary><div class="dim-pipeline-status-body">${rows.join('')}</div></details></section>`;
  }
  const PARITY_LABEL=Object.freeze({
    READY:'一致',MISMATCH:'差異あり',UNKNOWN_AMOUNT:'金額不明',
    PL_ACTUAL_NOT_NORMALIZED:'PL未正規化',LEGACY_MISSING:'現行Datasetなし',
    CANONICAL_FAILED:'Canonical失敗',CANONICAL_UNAVAILABLE:'Canonical未利用'
  });
  const yen=v=>Number.isFinite(Number(v))?`${Math.round(Number(v)).toLocaleString('ja-JP')}円`:'—';
  async function accountingParityHtml(period){
    if(!window.ACCOUNTING_PARITY?.checkFiscalYear)return '';
    const fy=Number(period.slice(4))>=4?period.slice(0,4):String(Number(period.slice(0,4))-1);
    let report;
    try{report=await ACCOUNTING_PARITY.checkFiscalYear(fy);}
    catch(e){return `<section class="dim-parity"><div class="dim-parity-head"><b>収支データ移行診断</b><span>${esc(fy)}年度</span></div><div class="dim-parity-error">${esc(e?.message||String(e))}</div></section>`;}
    const monthCards=(report.months||[]).map(r=>{
      const mm=Number(String(r.period||'').slice(4));
      const cls=r.status==='READY'?'is-ready':r.status==='MISMATCH'?'is-mismatch':r.status==='UNKNOWN_AMOUNT'?'is-unknown':'is-pending';
      const diffs=(r.mismatches||[]).slice(0,3).map(x=>`${esc(x.key)} ${yen(x.legacy)} → ${yen(x.canonical)}（差 ${yen(x.difference)}）`).join('<br>');
      const totalDiffs=(r.total_mismatches||[]).slice(0,2).map(x=>`${esc(x.key)} ${yen(x.legacy)} → ${yen(x.canonical)}`).join('<br>');
      const detail=diffs||totalDiffs||(r.error?esc(r.error):'');
      return `<div class="dim-parity-month ${cls}"><div><strong>${mm}月</strong><span>${esc(PARITY_LABEL[r.status]||r.status)}</span></div>${detail?`<small>${detail}</small>`:''}</div>`;
    }).join('');
    const c=report.counts||{};
    return `<section class="dim-parity"><div class="dim-parity-head"><div><b>収支データ移行診断</b><span>${esc(fy)}年度 · Canonical PL_ACTUAL ↔ 現行Dataset</span></div><span class="dim-parity-summary ${report.migrationReady?'is-ready':'is-review'}">${report.migrationReady?'12か月一致':'確認が必要'}</span></div><div class="dim-parity-counts"><span>一致 ${c.READY||0}</span><span>差異 ${c.MISMATCH||0}</span><span>金額不明 ${c.UNKNOWN_AMOUNT||0}</span><span>未正規化 ${c.PL_ACTUAL_NOT_NORMALIZED||0}</span><span>現行なし ${c.LEGACY_MISSING||0}</span></div><div class="dim-parity-months">${monthCards}</div><p class="dim-parity-note">${esc(report.note||'')}</p></section>`;
  }

  async function refresh(){
    const root=document.getElementById('normalized-source-status');if(!root)return;
    const input=document.getElementById('normalized-status-month');
    if(input&&!input.value){const p=defaultPeriod();if(p)input.value=monthFromPeriod(p);}
    const period=periodFromMonth(input?.value||'');
    if(!/^\d{6}$/.test(period)){root.innerHTML='<div class="dim-empty">確認年月を選択してください。</div>';return;}
    if(!window.Repository?.NormalizedSource?.loadManifest){root.innerHTML='<div class="dim-empty">Normalized Source Repositoryを読み込めません。</div>';return;}
    root.innerHTML='<div class="dim-empty">確認中…</div>';
    const rows=[];
    for(const type of TYPES){
      try{
        const r=await Repository.NormalizedSource.loadManifest(type,period),m=r?.manifest||{},b=Array.isArray(m.batches)?m.batches:[],cur=b.find(x=>x.batch_id===m.current_batch_id)||null;
        let state='—';
        if(type==='PL_ACTUAL'&&m.current_batch_id){const c=await Repository.NormalizedSource.loadCurrent(type,period);state=c?.records?.[0]?.document_state||'UNKNOWN';}
        rows.push({type,current:m.current_batch_id||null,count:cur?.record_count??null,state,history:b});
      }catch(e){rows.push({type,error:e?.message||String(e),history:[]});}
    }
    const fy=Number(period.slice(4))>=4?period.slice(0,4):String(Number(period.slice(0,4))-1),plan=window.STATE?.planData?.[fy]||null;
    const coverage=plan?.coverage||plan?.sourceMeta?.coverage||'UNKNOWN'; const coverageLabel=coverage==='FIRST_HALF_ONLY'?'上期策定済・下期未策定':coverage==='FULL_FISCAL_YEAR'?'12か月策定済':'登録済';
    const budgetRow=`<tr><td><b>予算計画</b><div class="dim-history">SKFL0001 / PLAN_BUDGET</div></td><td>${plan?`<span class="dim-state is-current">${esc(coverageLabel)}</span>`:'<span class="dim-state is-missing">未登録</span>'}</td><td>${plan?esc(`${fy}年度`):'—'}</td><td>${plan?esc(plan.itemCount??Object.keys(plan.rows||{}).length):'—'}</td><td><div class="dim-history">${plan?`${esc(plan.sourceMeta?.source_type||'LEGACY_PASTE')} · ${esc(plan.importedAt||'')}`:'—'}</div></td></tr>`;
    const pipeline=await pipelineHtml(period);
    const parity=await accountingParityHtml(period);
    root.innerHTML=`<table class="dim-source-table"><thead><tr><th>資料</th><th>状態</th><th>CURRENT</th><th>行数</th><th>改訂履歴</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(LABEL[x.type]||x.type)}</b><div class="dim-history">${esc(x.type)}</div></td><td>${x.error?`<span class="dim-state is-missing">ERROR</span>`:x.current?`<span class="dim-state is-current">${esc(x.state==='—'?'CURRENT':x.state)}</span>`:'<span class="dim-state is-missing">未登録</span>'}</td><td>${x.current?esc(x.current):'—'}</td><td>${x.count==null?'—':esc(x.count)}</td><td><div class="dim-history">${x.error?esc(x.error):(x.history||[]).slice().reverse().map(h=>`${esc(h.revision_status||'—')} · ${esc(h.record_count??'—')}行 · ${esc(h.saved_at||'')}`).join('<br>')||'—'}</div></td></tr>`).join('')}${budgetRow}</tbody></table>${pipeline}${parity}`;
  }
  document.addEventListener('DOMContentLoaded',()=>{const p=defaultPeriod();['preliminary-pl-month','normalized-status-month'].forEach(id=>{const el=document.getElementById(id);if(el&&!el.value&&p)el.value=monthFromPeriod(p);});document.addEventListener('click',e=>{if(e.target?.id==='pipeline-verify-rebuild-btn')verifyAndRebuildCurrent();});refresh().catch(()=>{});});
  window.DATA_IMPORT_MANAGEMENT=Object.freeze({importPreliminary,refresh,verifyAndRebuildCurrent});
})();
