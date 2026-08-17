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
    if(!window.CANONICAL_MATERIALIZER?.materialize){ const out={status:'CANONICAL_UNAVAILABLE',period:ym,ready:false}; cache.set(ym,out); return out; }

    let m;
    try{m=await CANONICAL_MATERIALIZER.materialize({period:ym});}
    catch(e){const out={status:'CANONICAL_FAILED',period:ym,ready:false,error:e?.message||String(e)};cache.set(ym,out);return out;}
    const batch=m?.snapshot?.materialization?.current_batches?.PL_ACTUAL||null;
    if(!batch){const out={status:'PL_ACTUAL_NOT_NORMALIZED',period:ym,ready:false};cache.set(ym,out);return out;}

    const facts=m?.snapshot?.entities?.ACCOUNTING_FACT||[];
    const cr=canonicalRows(facts);
    const keys=[...(window.CONFIG?.INCOME_KEYS||[]),...(window.CONFIG?.EXPENSE_KEYS||[])];
    const unique=[...new Set(keys)];
    const comparisons=unique.map(k=>compareKey(cr.rows,legacy.rows||{},k));
    const unknown=comparisons.filter(x=>x.status==='UNKNOWN');
    const mismatch=comparisons.filter(x=>x.status==='MISMATCH');

    const sum=(ks,rows)=>ks.reduce((a,k)=>a+(finite(rows[k])?rows[k]:0),0);
    const canUnknownIncome=(window.CONFIG?.INCOME_KEYS||[]).some(k=>cr.rows[k]===null);
    const canUnknownExpense=(window.CONFIG?.EXPENSE_KEYS||[]).some(k=>cr.rows[k]===null);
    const canonicalIncome=canUnknownIncome?null:sum(window.CONFIG?.INCOME_KEYS||[],cr.rows);
    const canonicalExpense=canUnknownExpense?null:sum(window.CONFIG?.EXPENSE_KEYS||[],cr.rows);
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

  function invalidate(period){ if(period) cache.delete(clean(period)); else cache.clear(); }
  window.ACCOUNTING_PARITY=Object.freeze({checkMonth,invalidate,canonicalRows});
})();
