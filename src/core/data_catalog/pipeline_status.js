/* ============================================================================
   Version6 D4-17: Data Pipeline Status
   SOURCE -> NORMALIZED -> CANONICAL -> DISPLAY_SNAPSHOT -> CLOUD の進行状態を
   period/document_type単位で記録する共通監査レイヤー。
   業務データそのものは変更せず、観測できた事実だけを保存する。
============================================================================ */
'use strict';
(function(){
  if(window.__DATA_PIPELINE_STATUS_LOADED_20260817__) return;
  window.__DATA_PIPELINE_STATUS_LOADED_20260817__=true;
  const CACHE_KIND='data_pipeline_status_v1';
  const VERSION=1;
  const STAGES=Object.freeze(['SOURCE','NORMALIZED','CANONICAL','DISPLAY_SNAPSHOT','CLOUD']);
  const STATUS=Object.freeze({UNKNOWN:'UNKNOWN',RUNNING:'RUNNING',OK:'OK',PARTIAL:'PARTIAL',FAILED:'FAILED'});
  const clean=v=>String(v??'').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const memory=new Map();
  function key(period,documentType='ALL'){return `${clean(period)}::${clean(documentType).toUpperCase()||'ALL'}`;}
  function empty(period,documentType='ALL'){
    const stages={}; STAGES.forEach(s=>stages[s]={status:STATUS.UNKNOWN,updated_at:null,message:null,detail:null});
    return {schema_version:VERSION,period:clean(period),document_type:clean(documentType).toUpperCase()||'ALL',updated_at:null,stages};
  }
  function validStatus(v){return Object.values(STATUS).includes(v)?v:STATUS.UNKNOWN;}
  async function load(period,documentType='ALL'){
    const k=key(period,documentType); if(memory.has(k)) return clone(memory.get(k));
    let row=null;
    try{row=await window.Repository?.Storage?.getCached?.(CACHE_KIND,k);}catch(_e){}
    const out=row&&typeof row==='object'?row:empty(period,documentType);
    memory.set(k,out); return clone(out);
  }
  async function setStage(period,documentType,stage,status,meta={}){
    const st=clean(stage).toUpperCase(); if(!STAGES.includes(st)) throw new Error(`Unsupported pipeline stage: ${st}`);
    const rec=await load(period,documentType), now=new Date().toISOString();
    rec.stages[st]={status:validStatus(status),updated_at:now,message:meta.message||null,detail:meta.detail??null};
    rec.updated_at=now; const k=key(period,documentType); memory.set(k,rec);
    try{await window.Repository?.Storage?.setCached?.(CACHE_KIND,k,rec);}catch(e){console.warn('[DATA_PIPELINE_STATUS] cache save failed',e);}
    try{window.dispatchEvent(new CustomEvent('data-pipeline-status-updated',{detail:{period:rec.period,document_type:rec.document_type,stage:st,status:rec.stages[st].status}}));}catch(_e){}
    return clone(rec);
  }
  async function markNormalizedResult(period,documentType,result){
    if(result?.ok){
      await setStage(period,documentType,'NORMALIZED',STATUS.OK,{detail:{batch_id:result.batch_id||result.current_batch_id||null,record_count:result.record_count??null}});
      await setStage(period,documentType,'CLOUD',STATUS.OK,{message:'CURRENT normalized source saved to Cloud'});
    }else if(result?.batch_saved){
      await setStage(period,documentType,'NORMALIZED',STATUS.PARTIAL,{message:'Batch saved but CURRENT manifest was not updated',detail:{batch_id:result.batch_id||null,error:result.error||null}});
      await setStage(period,documentType,'CLOUD',STATUS.FAILED,{message:result.error||'Cloud manifest save failed'});
    }else{
      await setStage(period,documentType,'NORMALIZED',STATUS.FAILED,{message:result?.error||'Normalized source save failed'});
      await setStage(period,documentType,'CLOUD',STATUS.FAILED,{message:result?.error||'Cloud save failed'});
    }
  }
  function summarize(rec){
    const stages=rec?.stages||{}, values=STAGES.map(s=>stages[s]?.status||STATUS.UNKNOWN);
    if(values.includes(STATUS.FAILED)) return STATUS.FAILED;
    if(values.includes(STATUS.PARTIAL)) return STATUS.PARTIAL;
    if(values.includes(STATUS.RUNNING)) return STATUS.RUNNING;
    if(values.some(x=>x===STATUS.OK)) return STATUS.OK;
    return STATUS.UNKNOWN;
  }
  window.DATA_PIPELINE_STATUS=Object.freeze({VERSION,CACHE_KIND,STAGES,STATUS,load,setStage,markNormalizedResult,summarize});
})();
