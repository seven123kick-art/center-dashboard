/* ============================================================================
   Version6 D4-19: Pipeline Verification / Recovery
   既存CURRENT NORMALIZED SOURCEをCloudで再検証し、確認できた事実だけを
   Pipeline Statusへbackfillする。必要に応じてCanonical/Snapshotを再構築する。
============================================================================ */
'use strict';
(function(){
  if(window.__DATA_PIPELINE_RECOVERY_LOADED_20260817__) return;
  window.__DATA_PIPELINE_RECOVERY_LOADED_20260817__=true;
  const TYPES=Object.freeze(['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT']);
  const clean=v=>String(v??'').trim();

  async function verifyCurrent(period,documentType){
    if(!/^\d{6}$/.test(clean(period))) throw new Error('period must be YYYYMM');
    if(!window.Repository?.NormalizedSource?.loadCurrent) throw new Error('Repository.NormalizedSource is required');
    const r=await Repository.NormalizedSource.loadCurrent(documentType,period,{preferCache:false});
    if(!r?.ok) throw new Error(r?.error||`${documentType} CURRENT load failed`);
    if(!r?.manifest?.current_batch_id){
      return {ok:true,document_type:documentType,registered:false,status:'NOT_REGISTERED'};
    }
    const batch=r.batch, currentId=r.manifest.current_batch_id;
    if(!batch||batch.batch_id!==currentId) throw new Error(`${documentType}: CURRENT manifest/batch mismatch`);
    const records=Array.isArray(r.records)?r.records:[];
    if(Number(batch.record_count)!==records.length) throw new Error(`${documentType}: record_count mismatch`);
    const hasLineage=records.length>0&&records.every(x=>x&&x.source_record_id!=null);
    if(hasLineage){
      await DATA_PIPELINE_STATUS.setStage(period,documentType,'SOURCE','OK',{message:'CURRENT normalized records contain source lineage',detail:{batch_id:currentId,record_count:records.length}});
    }
    await DATA_PIPELINE_STATUS.setStage(period,documentType,'NORMALIZED','OK',{message:'CURRENT normalized batch verified from Cloud',detail:{batch_id:currentId,record_count:records.length}});
    await DATA_PIPELINE_STATUS.setStage(period,documentType,'CLOUD','OK',{message:'CURRENT manifest and batch verified from Cloud',detail:{batch_id:currentId}});
    return {ok:true,document_type:documentType,registered:true,batch_id:currentId,record_count:records.length,source_lineage_verified:hasLineage};
  }

  async function verifyAndRebuild(period){
    const p=clean(period); if(!/^\d{6}$/.test(p)) throw new Error('period must be YYYYMM');
    const results=await Promise.all(TYPES.map(async type=>{
      try{ return await verifyCurrent(p,type); }
      catch(e){
        await DATA_PIPELINE_STATUS.setStage(p,type,'CLOUD','FAILED',{message:e?.message||String(e)});
        return {ok:false,document_type:type,error:e?.message||String(e)};
      }
    }));
    let materialized=null;
    try{
      if(window.CANONICAL_MATERIALIZER?.materialize) materialized=await CANONICAL_MATERIALIZER.materialize({period:p});
    }catch(e){ materialized={ok:false,error:e?.message||String(e)}; }
    return {ok:results.every(x=>x.ok)&&materialized?.ok!==false,period:p,sources:results,materialized};
  }

  window.DATA_PIPELINE_RECOVERY=Object.freeze({TYPES,verifyCurrent,verifyAndRebuild});
})();
