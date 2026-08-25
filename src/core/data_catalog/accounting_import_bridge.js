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
    const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV;
    if(!window.ACCOUNTING_NORMALIZER?.normalizeRows||!csv?.toRows) throw new Error('速報CSVの解析基盤を読み込めません。画面を再読み込みしてから再度お試しください。');
    const records=ACCOUNTING_NORMALIZER.normalizeRows(csv.toRows(text),{document_state:state,year_month:period,file_name:input.file_name||null,source_file_id:input.source_file_id||null});
    const actualPeriods=[...new Set(records.map(r=>String(r?.accounting_date||'').replace(/\D/g,'').slice(0,6)).filter(x=>/^\d{6}$/.test(x)))].sort();
    if(actualPeriods.length!==1||actualPeriods[0]!==period){
      const actual=actualPeriods.length?actualPeriods.map(x=>`${x.slice(0,4)}年${Number(x.slice(4))}月`).join('、'):'判定不能';
      throw new Error(`CSV内部の計上日は ${actual} です。画面の対象年月 ${period.slice(0,4)}年${Number(period.slice(4))}月 と一致しないため保存を中止しました。`);
    }
    return records;
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
