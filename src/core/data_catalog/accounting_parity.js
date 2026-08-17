/* ============================================================================
   Version6 D4-25: Accounting Canonical / Legacy Parity Check
   ホーム・年度推移をCanonicalへ切り替える前に、現在のVerified PL_ACTUALと
   既存Datasetが同じ月次収支値を再現できるかを読取専用で検証する。
   不一致を自動補正せず、移行可否の判断材料だけを返す。
============================================================================ */
'use strict';
(function(){
  if(window.ACCOUNTING_PARITY) return;

  const clean=v=>String(v??'').trim();
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const cache=new Map();

  function canonicalRows(facts){
    const rows={};
    const unknownAccounts=new Set();
    (facts||[]).forEach(f=>{
      const name=clean(f?.account_name);
      if(!name) return;
      if(!finite(f?.amount)) { unknownAccounts.add(name); return; }
      rows[name]=(rows[name]||0)+f.amount;
    });
    unknownAccounts.forEach(name=>{ rows[name]=null; });
    return {rows,unknownAccounts:[...unknownAccounts]};
  }

  function activeLegacy(ym){
    const list=window.Repository?.Dataset?.getActive?.()||[];
    return list.find(d=>d?.ym===ym&&d?.source!=='history')||null;
  }
  function legacyDatasetsForMonth(ym){
    const all=window.Repository?.Dataset?.getAll?.()||[];
    return all.filter(d=>d?.ym===ym&&d?.source!=='history');
  }
  function confirmedLegacy(ym){
    return legacyDatasetsForMonth(ym).find(d=>(d?.type||'confirmed')==='confirmed')||null;
  }

  function compareKey(rows,legacyRows,key){
    const cv=Object.prototype.hasOwnProperty.call(rows,key)?rows[key]:0;
    const lv=Number(legacyRows?.[key]??0);
    if(cv===null) return {key,status:'UNKNOWN',canonical:null,legacy:Number.isFinite(lv)?lv:0,difference:null};
    const c=Number(cv||0), l=Number.isFinite(lv)?lv:0;
    return {key,status:c===l?'EXACT':'MISMATCH',canonical:c,legacy:l,difference:c-l};
  }

  async function checkMonth(period,{force=false}={}){
    const ym=clean(period);
    if(!/^\d{6}$/.test(ym)) return {status:'INVALID_PERIOD',period:ym};
    if(!force&&cache.has(ym)) return cache.get(ym);
    const legacy=activeLegacy(ym);
    if(!legacy){ const out={status:'LEGACY_MISSING',period:ym,ready:false}; cache.set(ym,out); return out; }
    const confirmed=confirmedLegacy(ym);
    const legacyType=(legacy?.type||'confirmed');
    if(!window.CANONICAL_MATERIALIZER?.materialize){ const out={status:'CANONICAL_UNAVAILABLE',period:ym,ready:false,legacy_type:legacyType}; cache.set(ym,out); return out; }

    let m;
    try{m=await CANONICAL_MATERIALIZER.materialize({period:ym});}
    catch(e){const out={status:'CANONICAL_FAILED',period:ym,ready:false,error:e?.message||String(e)};cache.set(ym,out);return out;}
    const batch=m?.snapshot?.materialization?.current_batches?.PL_ACTUAL||null;
    if(!batch){
      let direct=null;
      try{direct=await Repository?.NormalizedSource?.loadCurrent?.('PL_ACTUAL',ym,{preferCache:false});}catch(_e){}
      const directBatch=direct?.batch?.batch_id||null;
      let status='PL_ACTUAL_NOT_NORMALIZED', error=null;
      if(directBatch){
        status='CANONICAL_FAILED';
        error='PL_ACTUAL CURRENTは存在するがCanonical Materializerが認識していません';
      }else if(!confirmed && legacyType==='daily'){
        status='PRELIMINARY_ONLY';
        error='日報Datasetのみ。確定Datasetがないため確定PL_ACTUAL移行対象外';
      }
      const out={
        status,period:ym,ready:false,legacy_type:legacyType,has_confirmed_legacy:!!confirmed,
        normalized_current_batch_id:directBatch,error
      };
      cache.set(ym,out);return out;
    }

    const facts=m?.snapshot?.entities?.ACCOUNTING_FACT||[];
    const cr=canonicalRows(facts);
    // app.jsのCONFIGはwindowプロパティではなくglobal lexical binding。
    // 現行processDataset()と完全に同じ科目集合で比較する。
    const cfg=(typeof CONFIG!=='undefined'&&CONFIG)?CONFIG:null;
    if(!cfg){
      const out={status:'CANONICAL_FAILED',period:ym,ready:false,error:'ACCOUNT_CONFIG_UNAVAILABLE'};
      cache.set(ym,out);return out;
    }
    const keys=[...(cfg.INCOME_KEYS||[]),...(cfg.EXPENSE_KEYS||[])];
    const unique=[...new Set(keys)];
    const comparisons=unique.map(k=>compareKey(cr.rows,legacy.rows||{},k));
    const unknown=comparisons.filter(x=>x.status==='UNKNOWN');
    const mismatch=comparisons.filter(x=>x.status==='MISMATCH');

    const sum=(ks,rows)=>ks.reduce((a,k)=>a+(finite(rows[k])?rows[k]:0),0);
    const canUnknownIncome=(cfg.INCOME_KEYS||[]).some(k=>cr.rows[k]===null);
    const canUnknownExpense=(cfg.EXPENSE_KEYS||[]).some(k=>cr.rows[k]===null);
    const canonicalIncome=canUnknownIncome?null:sum(cfg.INCOME_KEYS||[],cr.rows);
    const canonicalExpense=canUnknownExpense?null:sum(cfg.EXPENSE_KEYS||[],cr.rows);
    const canonicalProfit=(canonicalIncome===null||canonicalExpense===null)?null:canonicalIncome-canonicalExpense;
    const totals={
      totalIncome:{canonical:canonicalIncome,legacy:Number(legacy.totalIncome||0)},
      totalExpense:{canonical:canonicalExpense,legacy:Number(legacy.totalExpense||0)},
      profit:{canonical:canonicalProfit,legacy:Number(legacy.profit||0)}
    };
    const totalMismatch=Object.entries(totals).filter(([,v])=>v.canonical===null||v.canonical!==v.legacy).map(([key,v])=>({key,...v}));
    const ready=!unknown.length&&!mismatch.length&&!totalMismatch.length;
    const out={
      status:ready?'READY':unknown.length?'UNKNOWN_AMOUNT':'MISMATCH',ready,period:ym,current_batch_id:batch,
      document_state:[...new Set(facts.map(x=>x.document_state).filter(Boolean))],
      comparisons,mismatches:mismatch,unknown,totals,total_mismatches:totalMismatch,
      note:ready?'Canonical PL_ACTUALと既存Datasetの月次収支値は一致':'不一致は観測のみ。自動補正しない'
    };
    cache.set(ym,out); return out;
  }

  function fiscalMonths(fiscalYear){
    const fy=Number(fiscalYear);
    if(!Number.isInteger(fy)||fy<2000||fy>2100)return [];
    return [
      `${fy}04`,`${fy}05`,`${fy}06`,`${fy}07`,`${fy}08`,`${fy}09`,
      `${fy}10`,`${fy}11`,`${fy}12`,`${fy+1}01`,`${fy+1}02`,`${fy+1}03`
    ];
  }

  async function checkFiscalYear(fiscalYear,{force=false}={}){
    const fy=String(fiscalYear||'').trim();
    const months=fiscalMonths(fy);
    if(!months.length)return {status:'INVALID_FISCAL_YEAR',fiscalYear:fy,months:[]};
    const results=await Promise.all(months.map(ym=>checkMonth(ym,{force})));
    const counts={READY:0,MISMATCH:0,UNKNOWN_AMOUNT:0,PL_ACTUAL_NOT_NORMALIZED:0,PRELIMINARY_ONLY:0,LEGACY_MISSING:0,CANONICAL_FAILED:0,CANONICAL_UNAVAILABLE:0,OTHER:0};
    results.forEach(r=>{const k=Object.prototype.hasOwnProperty.call(counts,r.status)?r.status:'OTHER';counts[k]++;});
    const readyMonths=results.filter(r=>r.ready).map(r=>r.period);
    const blockedMonths=results.filter(r=>!r.ready).map(r=>({period:r.period,status:r.status,error:r.error||null}));
    return {
      status:blockedMonths.length?'REVIEW_REQUIRED':'READY',
      fiscalYear:fy,months:results,counts,readyMonths,blockedMonths,
      migrationReady:blockedMonths.length===0,
      note:blockedMonths.length
        ?'READY月のみ移行候補。不一致・UNKNOWN・未正規化月は現行Datasetを維持する。'
        :'年度12か月すべてでCanonical PL_ACTUALと既存Datasetが一致。'
    };
  }

  function peekMonth(period){
    return cache.get(clean(period))||null;
  }

  function invalidate(period){
    if(period) cache.delete(clean(period)); else cache.clear();
    try{window.ACCOUNTING_DATASET_READ_MODEL?.invalidate?.(period);}catch(_e){}
  }

  window.ACCOUNTING_PARITY=Object.freeze({checkMonth,checkFiscalYear,fiscalMonths,peekMonth,invalidate,canonicalRows});
})();

/* ============================================================================
   Version6 D4-32: Accounting Canonical Dataset Read Model
   ----------------------------------------------------------------------------
   既存画面を壊さず、Parity READYの確定月だけCanonical PL_ACTUALを
   Dataset互換オブジェクトへ変換して表示系に供給する。

   - READY以外は必ず既存Datasetへfallback。
   - daily / historyはCanonicalへ昇格させない。
   - CanonicalとLegacyが完全一致してからしか切り替えない。
   - 非同期判定中はLegacyを表示し、数字を未確認値へ差し替えない。
============================================================================ */
(function(){
  if(window.ACCOUNTING_DATASET_READ_MODEL) return;

  const canonicalCache=new Map();
  const stateCache=new Map();
  const loading=new Map();

  const original=Object.freeze({
    activeDatasets: typeof window.activeDatasets==='function' ? window.activeDatasets : null,
    activeDatasetByYM: typeof window.activeDatasetByYM==='function' ? window.activeDatasetByYM : null,
    activeRealCsvDatasets: typeof window.activeRealCsvDatasets==='function' ? window.activeRealCsvDatasets : null,
    activeRealCsvDatasetByYM: typeof window.activeRealCsvDatasetByYM==='function' ? window.activeRealCsvDatasetByYM : null
  });

  const ym=v=>String(v??'').trim();
  function isConfirmedLegacy(ds){
    return !!ds && ds.source!=='history' && (ds.type||'confirmed')==='confirmed' && ds.source!=='canonical';
  }

  function buildCanonicalDataset(legacy, parity){
    if(!legacy || !parity?.ready || parity.status!=='READY') return null;
    if(typeof processDataset!=='function') return null;

    const rows={};
    (parity.comparisons||[]).forEach(c=>{
      if(c?.key && Number.isFinite(Number(c.canonical))) rows[c.key]=Number(c.canonical);
    });

    const canonical=processDataset(legacy.ym,'confirmed',rows);
    return {
      ...legacy,
      ...canonical,
      ym:legacy.ym,
      type:'confirmed',
      source:'canonical',
      unit:'円',
      fileName:legacy.fileName||'Canonical PL_ACTUAL',
      importedAt:legacy.importedAt||canonical.importedAt,
      fiscalYear:legacy.fiscalYear,
      routePayments:legacy.routePayments,
      _dataPath:'CANONICAL',
      _canonicalVerified:true,
      _canonicalBatchId:parity.current_batch_id||null,
      _legacySource:legacy.source||'csv',
      _legacyFileName:legacy.fileName||null
    };
  }

  async function warmMonth(period, legacyOverride=null, {force=false}={}){
    const periodKey=ym(period);
    if(!/^\d{6}$/.test(periodKey)) return {status:'INVALID_PERIOD',period:periodKey};
    if(!force && canonicalCache.has(periodKey)) return {status:'CANONICAL',period:periodKey,dataset:canonicalCache.get(periodKey)};
    if(loading.has(periodKey)) return loading.get(periodKey);

    const legacy=legacyOverride
      || original.activeRealCsvDatasetByYM?.(periodKey)
      || original.activeDatasetByYM?.(periodKey)
      || null;

    if(!isConfirmedLegacy(legacy)){
      const status=legacy?.source==='history'?'HISTORY_FALLBACK':legacy?.type==='daily'?'PRELIMINARY_FALLBACK':'LEGACY_FALLBACK';
      stateCache.set(periodKey,{status,period:periodKey,reason:'Canonical切替対象は確定CSVのみ'});
      canonicalCache.delete(periodKey);
      return stateCache.get(periodKey);
    }

    const task=(async()=>{
      try{
        const parity=await window.ACCOUNTING_PARITY?.checkMonth?.(periodKey,{force});
        if(parity?.ready && parity.status==='READY'){
          const ds=buildCanonicalDataset(legacy,parity);
          if(ds){
            canonicalCache.set(periodKey,ds);
            const out={status:'CANONICAL',period:periodKey,current_batch_id:parity.current_batch_id||null};
            stateCache.set(periodKey,out);
            return {...out,dataset:ds};
          }
        }
        canonicalCache.delete(periodKey);
        const out={
          status:'LEGACY_FALLBACK',period:periodKey,
          reason:parity?.status||'PARITY_NOT_READY',
          parity_status:parity?.status||null
        };
        stateCache.set(periodKey,out);
        return out;
      }catch(e){
        canonicalCache.delete(periodKey);
        const out={status:'LEGACY_FALLBACK',period:periodKey,reason:e?.message||String(e)};
        stateCache.set(periodKey,out);
        return out;
      }finally{
        loading.delete(periodKey);
      }
    })();
    loading.set(periodKey,task);
    return task;
  }

  function resolveSync(ds){
    if(!ds?.ym) return ds;
    const periodKey=ym(ds.ym);
    if(isConfirmedLegacy(ds)){
      const canonical=canonicalCache.get(periodKey);
      if(canonical) return canonical;
      // 非同期判定中はLegacyをそのまま返す。表示中の数字を未検証値へ変えない。
      warmMonth(periodKey,ds).catch(()=>{});
    }
    return ds;
  }

  function resolveList(list){
    return (Array.isArray(list)?list:[]).map(resolveSync);
  }

  function inspect(period){
    const periodKey=ym(period);
    const canonical=canonicalCache.get(periodKey);
    if(canonical) return {
      status:'CANONICAL',period:periodKey,
      current_batch_id:canonical._canonicalBatchId||null,
      source:canonical.source
    };
    if(loading.has(periodKey)) return {status:'LOADING',period:periodKey};
    return stateCache.get(periodKey)||{status:'NOT_WARMED',period:periodKey};
  }

  function invalidate(period){
    if(period){
      const periodKey=ym(period);
      canonicalCache.delete(periodKey);
      stateCache.delete(periodKey);
      loading.delete(periodKey);
    }else{
      canonicalCache.clear();
      stateCache.clear();
      loading.clear();
    }
  }

  // 既存Dataset選択層を安全にoverlayする。
  // 各画面個別のKPI/グラフ計算は変更せず、既存Dataset互換形で供給する。
  if(original.activeDatasetByYM){
    window.activeDatasetByYM=function(period){
      return resolveSync(original.activeDatasetByYM(period));
    };
  }
  if(original.activeDatasets){
    window.activeDatasets=function(){
      return resolveList(original.activeDatasets());
    };
  }
  if(original.activeRealCsvDatasetByYM){
    window.activeRealCsvDatasetByYM=function(period){
      return resolveSync(original.activeRealCsvDatasetByYM(period));
    };
  }
  if(original.activeRealCsvDatasets){
    window.activeRealCsvDatasets=function(){
      return resolveList(original.activeRealCsvDatasets());
    };
  }

  window.addEventListener?.('normalized-source-updated',ev=>{
    const periodKey=ym(ev?.detail?.period);
    if(periodKey){
      invalidate(periodKey);
      try{window.ACCOUNTING_PARITY?.invalidate?.(periodKey);}catch(_e){}
    }
  });

  window.ACCOUNTING_DATASET_READ_MODEL=Object.freeze({
    warmMonth,resolveSync,inspect,invalidate,buildCanonicalDataset
  });
})();

/* ============================================================================
   Version6 D4-33: Accounting Actual Read-Path Proof
   ----------------------------------------------------------------------------
   D4-32で実装したRead Modelが実際にどの経路を選んでいるかを、
   データ確認画面の収支移行診断直下へ読取専用で表示する。
   business logic / Dataset / Canonical / Cloudへの書込は一切行わない。
============================================================================ */
(function(){
  if(window.__ACCOUNTING_READ_PATH_PROOF_D433__) return;
  window.__ACCOUNTING_READ_PATH_PROOF_D433__=true;

  const LABEL=Object.freeze({
    CANONICAL:'Canonical利用中',
    PRELIMINARY_FALLBACK:'日報Dataset利用中',
    HISTORY_FALLBACK:'収支補完Dataset利用中',
    LEGACY_FALLBACK:'現行Dataset利用中',
    LOADING:'確認中',
    NOT_WARMED:'未確認'
  });

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function selectedFiscalYear(){
    const ym=document.getElementById('data-verification-ym')?.value||'';
    if(!/^\d{6}$/.test(ym)) return null;
    return Number(ym.slice(4))>=4?Number(ym.slice(0,4)):Number(ym.slice(0,4))-1;
  }

  async function collect(){
    const fy=selectedFiscalYear();
    const rm=window.ACCOUNTING_DATASET_READ_MODEL;
    if(!fy||!rm?.inspect||!rm?.warmMonth||!window.ACCOUNTING_PARITY?.fiscalMonths) return null;
    const months=ACCOUNTING_PARITY.fiscalMonths(fy);
    const out=[];
    for(const period of months){
      let state=rm.inspect(period);
      if(['NOT_WARMED','LOADING'].includes(state?.status)){
        try{await rm.warmMonth(period);}catch(_e){}
        state=rm.inspect(period);
      }
      out.push({period,status:state?.status||'NOT_WARMED',reason:state?.reason||null});
    }
    return {fy,months:out};
  }

  function render(report){
    const parity=document.querySelector('#data-verification-root .dv-parity-card');
    if(!parity||!report) return;
    let host=document.getElementById('dv-accounting-read-path-proof');
    if(!host){
      host=document.createElement('div');
      host.id='dv-accounting-read-path-proof';
      host.className='card dv-parity-card';
      parity.insertAdjacentElement('afterend',host);
    }
    const visible=report.months.filter(x=>x.status!=='NOT_WARMED'||x.reason);
    host.innerHTML=`<div class="card-header"><span class="card-title">収支読取経路</span><span class="dv-readonly">${esc(report.fy)}年度 / 読取専用</span></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px">
          ${visible.map(x=>{
            const mm=Number(x.period.slice(4));
            const good=x.status==='CANONICAL';
            const prelim=x.status==='PRELIMINARY_FALLBACK';
            const bg=good?'#f0faf5':prelim?'#f3f8fb':'#fafbfa';
            const bd=good?'rgba(61,187,131,.16)':prelim?'rgba(67,191,239,.18)':'rgba(31,58,48,.07)';
            return `<div style="min-height:50px;padding:9px 10px;border:1px solid ${bd};border-radius:12px;background:${bg}">
              <div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><strong style="font-size:12px">${mm}月</strong><span style="font-size:10px;font-weight:800;color:var(--text2)">${esc(LABEL[x.status]||x.status)}</span></div>
            </div>`;
          }).join('')}
        </div>
        <div class="dv-footnote" style="margin-top:10px">D4-32の実表示経路を確認しています。Canonicalへの書込・自動補正は行いません。</div>
      </div>`;
  }

  let running=false;
  async function refresh(){
    if(running) return;
    if(!document.querySelector('#data-verification-root .dv-parity-card')) return;
    running=true;
    try{render(await collect());}finally{running=false;}
  }

  const observer=new MutationObserver(()=>{setTimeout(refresh,0);});
  function start(){
    const root=document.getElementById('data-verification-root');
    if(!root) return;
    observer.observe(root,{childList:true,subtree:true});
    refresh();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();

  window.ACCOUNTING_READ_PATH_PROOF=Object.freeze({collect,refresh});
})();

