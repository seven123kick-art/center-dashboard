/* ============================================================================
   Version6 D3-8: Accounting Import Bridge
   SKDL0002/0003の原CSV行をACCOUNTING_SOURCE_RECORDへ正規化し、
   NormalizedSourceRepositoryへ保存する。SKDL0001（日報）は対象外。
============================================================================ */
'use strict';
(function(){
  if(window.__ACCOUNTING_IMPORT_BRIDGE_LOADED_20260817__) return;
  window.__ACCOUNTING_IMPORT_BRIDGE_LOADED_20260817__=true;
  const clean=v=>String(v??'').trim();
  function batchId(period,state){
    const suffix=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')?globalThis.crypto.randomUUID().replace(/-/g,''):`${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    return `PL_ACTUAL_${state}_${period}_${suffix}`;
  }
  function normalizeCsvText(text,input={}){
    const period=clean(input.period), state=clean(input.document_state).toUpperCase();
    if(!/^\d{6}$/.test(period)) throw new Error('INVALID_PERIOD');
    if(state!=='PRELIMINARY'&&state!=='CONFIRMED') throw new Error('UNSUPPORTED_DOCUMENT_STATE');
    if(!window.ACCOUNTING_NORMALIZER?.normalizeRows||!window.CSV?.toRows) throw new Error('DEPENDENCY_UNAVAILABLE');
    return ACCOUNTING_NORMALIZER.normalizeRows(CSV.toRows(text),{document_state:state,year_month:period,file_name:input.file_name||null,source_file_id:input.source_file_id||null});
  }
  async function persistRecords(records,input={}){
    const period=clean(input.period), state=clean(input.document_state).toUpperCase();
    if(!/^\d{6}$/.test(period)) return {ok:false,skipped:true,error:'INVALID_PERIOD'};
    if(state!=='PRELIMINARY'&&state!=='CONFIRMED') return {ok:false,skipped:true,error:'UNSUPPORTED_DOCUMENT_STATE'};
    if(!window.Repository?.NormalizedSource?.saveBatch) return {ok:false,skipped:true,error:'DEPENDENCY_UNAVAILABLE'};
    const rows=Array.isArray(records)?records:[]; if(!rows.length) return {ok:false,skipped:true,error:'NO_NORMALIZED_RECORDS'};
    return Repository.NormalizedSource.saveBatch({document_type:'PL_ACTUAL',period,batch_id:batchId(period,state),source_file_id:input.source_file_id||null,records:rows,meta:{document_state:state,source_file_names:Array.from(input.source_file_names||[]),imported_at:new Date().toISOString()}});
  }
  async function persistCsvText(text,input={}){
    const period=clean(input.period), state=clean(input.document_state).toUpperCase();
    if(!/^\d{6}$/.test(period)) return {ok:false,skipped:true,error:'INVALID_PERIOD'};
    if(state!=='PRELIMINARY'&&state!=='CONFIRMED') return {ok:false,skipped:true,error:'UNSUPPORTED_DOCUMENT_STATE'};
    let records; try{ records=normalizeCsvText(text,input); }catch(e){ return {ok:false,skipped:true,error:e.message}; }
    return persistRecords(records,{period,state:undefined,document_state:state,source_file_id:input.source_file_id||null,source_file_names:[input.file_name].filter(Boolean)});
  }
  window.ACCOUNTING_IMPORT_BRIDGE=Object.freeze({normalizeCsvText,persistRecords,persistCsvText});
})();
