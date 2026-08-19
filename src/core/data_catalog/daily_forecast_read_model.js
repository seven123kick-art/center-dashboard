/* Version6 M2-3: PL_DAILY_ACTUAL -> Landing Forecast Read Model */
'use strict';
(function(){
  if(window.__DAILY_FORECAST_READ_MODEL_LOADED_20260819__) return;
  window.__DAILY_FORECAST_READ_MODEL_LOADED_20260819__=true;
  const clean=v=>String(v??'').trim();
  const categoryKey=Object.freeze({REVENUE:'revenue',LABOR:'labor',YOSHA:'yosha',OTHER_EXPENSE:'other'});
  function legacyRecords(ym){return (window.STATE?.dailyRecords||[]).filter(r=>r&&r.ym===ym).map(r=>Object.assign({},r)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));}
  function aggregate(rows,ym){
    const byDate=new Map(),issues=[];
    for(const row of (Array.isArray(rows)?rows:[])){
      const date=clean(row?.accounting_date);
      if(!date||date.slice(0,7).replace('-','')!==ym) continue;
      const key=categoryKey[clean(row?.category).toUpperCase()];
      if(!key) continue;
      if(!byDate.has(date)) byDate.set(date,{date,ym,revenue:0,labor:0,yosha:0,other:0,profit:0,rowCount:0,unknown:{revenue:false,labor:false,yosha:false,other:false}});
      const rec=byDate.get(date); rec.rowCount++;
      if(row?.amount_known===false||row?.amount==null||!Number.isFinite(Number(row.amount))){
        rec.unknown[key]=true; issues.push({code:'AMOUNT_UNKNOWN',date,category:row?.category||null,source_record_id:row?.source_record_id||null}); continue;
      }
      rec[key]+=Number(row.amount);
    }
    const records=Array.from(byDate.values()).sort((a,b)=>a.date.localeCompare(b.date));
    records.forEach(rec=>{const u=Object.keys(rec.unknown).filter(k=>rec.unknown[k]);rec.hasUnknown=u.length>0;rec.unknownCategories=u;rec.profit=rec.hasUnknown?null:rec.revenue-rec.labor-rec.yosha-rec.other;});
    return {records,issues};
  }
  async function loadMonth(ym){
    const period=clean(ym);
    if(!/^\d{6}$/.test(period)) return {status:'ERROR',source:'NONE',records:[],issues:[{code:'INVALID_PERIOD'}]};
    if(!window.Repository?.NormalizedSource?.loadCurrent) return {status:'LEGACY_FALLBACK',source:'LEGACY',records:legacyRecords(period),issues:[]};
    try{
      const current=await Repository.NormalizedSource.loadCurrent('PL_DAILY_ACTUAL',period);
      if(!current?.ok) return {status:'ERROR',source:'PL_DAILY_ACTUAL',records:[],issues:[{code:current?.error||'LOAD_FAILED'}]};
      if(!current.batch) return {status:'LEGACY_FALLBACK',source:'LEGACY',records:legacyRecords(period),issues:[],current_batch_id:null};
      const built=aggregate(current.records,period);
      return {status:built.issues.length?'PARTIAL':'READY',source:'PL_DAILY_ACTUAL',records:built.records,issues:built.issues,current_batch_id:current.manifest?.current_batch_id||current.batch?.batch_id||null};
    }catch(e){return {status:'ERROR',source:'PL_DAILY_ACTUAL',records:[],issues:[{code:'LOAD_EXCEPTION',message:e?.message||String(e)}]};}
  }
  window.DAILY_FORECAST_READ_MODEL=Object.freeze({loadMonth,aggregate});
})();
