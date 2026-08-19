/* Version6 M2-4B: Forecast Context Loader */
'use strict';
(function(){
  if(window.FORECAST_CONTEXT_LOADER) return;
  const clean=v=>String(v??'').trim();
  function shiftMonth(ym,delta){const d=new Date(Number(ym.slice(0,4)),Number(ym.slice(4,6))-1+delta,1);return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;}
  async function formalDaily(ym){
    const repo=window.Repository?.NormalizedSource,aggregate=window.DAILY_FORECAST_READ_MODEL?.aggregate;
    if(!repo?.loadCurrent||!aggregate)return null;
    const current=await repo.loadCurrent('PL_DAILY_ACTUAL',ym,{preferCache:true});
    if(!current?.ok||!current.batch)return null;
    const built=aggregate(current.records,ym);
    return {ym,records:built.records,issues:built.issues||[],eligible:!(built.issues||[]).length,reason:(built.issues||[]).length?'PL_DAILY_ACTUAL_UNKNOWN':null};
  }
  async function confirmed(ym){
    if(!window.MONTHLY_MANAGEMENT_STATUS?.build)return false;
    const status=await MONTHLY_MANAGEMENT_STATUS.build(ym);
    return status?.areas?.pl?.status==='CONFIRMED';
  }
  async function load(currentYM,{months=24}={}){
    const ym=clean(currentYM);if(!/^\d{6}$/.test(ym))throw new Error('currentYM must be YYYYMM');
    const history=[];
    for(let back=months;back>=1;back--){
      const hYM=shiftMonth(ym,-back);
      try{const daily=await formalDaily(hYM);if(!daily)continue;const c=await confirmed(hYM);history.push({...daily,confirmed:c,eligible:daily.eligible&&c});}
      catch(e){console.warn('[M2-4B] forecast history load failed',hYM,e);}
    }
    const pyYM=shiftMonth(ym,-12),priorYear=history.find(x=>x.ym===pyYM&&x.confirmed&&x.eligible)||null;
    return {current_ym:ym,history,priorYear,formal_history_count:history.length,eligible_history_count:history.filter(x=>x.eligible&&x.confirmed).length};
  }
  window.FORECAST_CONTEXT_LOADER=Object.freeze({load,_internal:Object.freeze({shiftMonth,formalDaily,confirmed})});
})();
