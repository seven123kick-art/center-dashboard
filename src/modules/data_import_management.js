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
    if(!/^\d{6}$/.test(period)){setMsg('対象年月を選択してください。','error');return;}
    if(!file){setMsg('SKDL0002のCSVを選択してください。','error');return;}
    if(!/\.csv$/i.test(file.name)){setMsg('CSVファイルを選択してください。','error');return;}
    if(!window.ACCOUNTING_IMPORT_BRIDGE?.persistCsvText){setMsg('速報取込基盤を読み込めません。','error');return;}
    setMsg('内容を確認して保存しています…');
    try{
      const text=window.CSV?.read?await CSV.read(file):await file.text();
      const r=await ACCOUNTING_IMPORT_BRIDGE.persistCsvText(text,{period,document_state:'PRELIMINARY',file_name:file.name});
      if(!r?.ok)throw new Error(r?.error||'保存に失敗しました');
      setMsg(`SKDL0002速報を登録しました（${period.slice(0,4)}年${Number(period.slice(4))}月 / ${r.record_count||0}行）`,'ok');
      if(document.getElementById('preliminary-pl-file'))document.getElementById('preliminary-pl-file').value='';
      const status=document.getElementById('normalized-status-month');if(status)status.value=month;
      await refresh();
      if(window.CANONICAL_MATERIALIZER?.materialize){
        try{
          await CANONICAL_MATERIALIZER.materialize({period});
        }catch(e){
          console.error('[DataImportManagement] Canonical rebuild failed after preliminary import',e);
          setMsg(`SKDL0002速報は登録済みですが、表示用データの再構築に失敗しました。データ確認画面で再構築してください。${e?.message?`（${e.message}）`:''}`,'error');
        }
      }
    }catch(e){setMsg(e?.message||String(e),'error');}
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
    root.innerHTML=`<table class="dim-source-table"><thead><tr><th>資料</th><th>状態</th><th>CURRENT</th><th>行数</th><th>改訂履歴</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(LABEL[x.type]||x.type)}</b><div class="dim-history">${esc(x.type)}</div></td><td>${x.error?`<span class="dim-state is-missing">ERROR</span>`:x.current?`<span class="dim-state is-current">${esc(x.state==='—'?'CURRENT':x.state)}</span>`:'<span class="dim-state is-missing">未登録</span>'}</td><td>${x.current?esc(x.current):'—'}</td><td>${x.count==null?'—':esc(x.count)}</td><td><div class="dim-history">${x.error?esc(x.error):(x.history||[]).slice().reverse().map(h=>`${esc(h.revision_status||'—')} · ${esc(h.record_count??'—')}行 · ${esc(h.saved_at||'')}`).join('<br>')||'—'}</div></td></tr>`).join('')}${budgetRow}</tbody></table>`;
  }
  document.addEventListener('DOMContentLoaded',()=>{const p=defaultPeriod();['preliminary-pl-month','normalized-status-month'].forEach(id=>{const el=document.getElementById(id);if(el&&!el.value&&p)el.value=monthFromPeriod(p);});refresh().catch(()=>{});});
  window.DATA_IMPORT_MANAGEMENT=Object.freeze({importPreliminary,refresh});
})();
