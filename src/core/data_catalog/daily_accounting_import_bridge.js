/* Version6 M2-2: PL_DAILY_ACTUAL Import Bridge */
'use strict';
(function(){
  if(window.__DAILY_ACCOUNTING_IMPORT_BRIDGE_LOADED_20260819__) return;
  window.__DAILY_ACCOUNTING_IMPORT_BRIDGE_LOADED_20260819__=true;
  const clean=v=>String(v??'').trim();
  function batchId(period){const x=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')?globalThis.crypto.randomUUID().replace(/-/g,''):`${Date.now()}_${Math.random().toString(36).slice(2,10)}`;return `PL_DAILY_ACTUAL_${period}_${x}`;}
  function normalizeCsvText(text,input={}){const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV;if(!window.DAILY_ACCOUNTING_NORMALIZER?.normalizeRows||!csv?.toRows)throw new Error('DEPENDENCY_UNAVAILABLE');return DAILY_ACCOUNTING_NORMALIZER.normalizeRows(csv.toRows(text),{file_name:input.file_name||null,source_file_id:input.source_file_id||null});}
  async function persistRecords(records,input={}){const period=clean(input.period);if(!/^\d{6}$/.test(period))return{ok:false,skipped:true,error:'INVALID_PERIOD'};if(!window.Repository?.NormalizedSource?.saveBatch)return{ok:false,skipped:true,error:'DEPENDENCY_UNAVAILABLE'};const rows=(Array.isArray(records)?records:[]).filter(r=>r?.year_month===period);if(!rows.length)return{ok:false,skipped:true,error:'NO_NORMALIZED_RECORDS'};return Repository.NormalizedSource.saveBatch({document_type:'PL_DAILY_ACTUAL',period,batch_id:batchId(period),source_file_id:input.source_file_id||null,records:rows,meta:{source_file_names:Array.from(input.source_file_names||[]),imported_at:new Date().toISOString(),usage:'LANDING_FORECAST_ONLY'}});}
  window.DAILY_ACCOUNTING_IMPORT_BRIDGE=Object.freeze({normalizeCsvText,persistRecords});
})();
