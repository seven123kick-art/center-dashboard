/* ============================================================================
   Version6 D3-6A: NormalizedSourceRepository
   ----------------------------------------------------------------------------
   NORMALIZED SOURCEをSTATE/full_stateから分離して永続化する正式境界。

   正本 : Supabase center_realtime_state（batchごとのimmutable row + manifest）
   cache: IndexedDB（Repository.Storage）

   設計原則:
   - 元SOURCEを上書きしない。訂正版は新batchとして保存する。
   - current切替はbatch正本保存成功後にmanifestで行う。
   - 旧batchはSUPERSEDEDとしてmanifestに残し、削除しない。
   - 0とnullを変換しない。Normalizerが生成した値をそのまま保持する。
   - Canonical/Resolution/UIにはまだ自動接続しない。
============================================================================ */
'use strict';
(function(){
  if(window.__NORMALIZED_SOURCE_REPOSITORY_LOADED_20260817__) return;
  window.__NORMALIZED_SOURCE_REPOSITORY_LOADED_20260817__=true;

  const VERSION=1;
  const PREFIX='normalized_source_v1';
  const CACHE_KIND='normalized_source';
  const SUPPORTED=new Set(['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT']);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').trim();

  function cloud(){
    const x=window.Repository?.Cloud;
    if(!x?.fetchRealtimeState||!x?.pushRealtimeState) throw new Error('[NormalizedSourceRepository] Repository.Cloud realtime-state API is required.');
    return x;
  }
  function storage(){ return window.Repository?.Storage||null; }
  function token(v){ return clean(v).replace(/[^A-Za-z0-9_-]/g,'_'); }
  function validateScope(documentType,period){
    const dt=clean(documentType).toUpperCase(), p=clean(period);
    if(!SUPPORTED.has(dt)) throw new Error(`Unsupported document_type: ${dt||'(empty)'}`);
    if(!/^\d{6}$/.test(p)) throw new Error(`period must be YYYYMM: ${p||'(empty)'}`);
    return {document_type:dt,period:p};
  }
  function baseKey(dt,p){ const s=validateScope(dt,p); return `${PREFIX}::${s.document_type}::${s.period}`; }
  function manifestKey(dt,p){ return `${baseKey(dt,p)}::manifest`; }
  function batchKey(dt,p,batchId){ return `${baseKey(dt,p)}::batch::${token(batchId)}`; }
  function cacheId(dt,p,suffix){ return `${token(dt)}::${token(p)}::${suffix}`; }

  function validateRecords(documentType,records){
    const dt=clean(documentType).toUpperCase(), rows=Array.isArray(records)?records:[], errors=[];
    rows.forEach((r,i)=>{
      if(!r||typeof r!=='object') errors.push(`[${i}] record must be object`);
      else if(clean(r.document_type).toUpperCase()!==dt) errors.push(`[${i}] document_type mismatch`);
      if(r&&r.source_record_id==null) errors.push(`[${i}] source_record_id is required`);
    });
    return {ok:errors.length===0,errors,records:clone(rows)};
  }
  function emptyManifest(dt,p){
    return {schema_version:VERSION,kind:'NORMALIZED_SOURCE_MANIFEST',document_type:dt,period:p,current_batch_id:null,updated_at:null,batches:[]};
  }
  function normalizeManifest(raw,dt,p){
    const m=raw&&typeof raw==='object'?clone(raw):emptyManifest(dt,p);
    m.schema_version=VERSION; m.kind='NORMALIZED_SOURCE_MANIFEST'; m.document_type=dt; m.period=p;
    m.current_batch_id=clean(m.current_batch_id)||null;
    m.batches=Array.isArray(m.batches)?m.batches:[];
    return m;
  }
  function makeBatch({document_type,period,batch_id,source_file_id=null,supersedes_batch_id=null,records,meta={}}){
    const now=meta.saved_at||new Date().toISOString();
    return {schema_version:VERSION,kind:'NORMALIZED_SOURCE_BATCH',document_type,period,batch_id,source_file_id:source_file_id||null,supersedes_batch_id:supersedes_batch_id||null,revision_status:'CURRENT',saved_at:now,record_count:records.length,records:clone(records)};
  }

  async function loadManifest(documentType,period){
    const s=validateScope(documentType,period), key=manifestKey(s.document_type,s.period);
    const row=await cloud().fetchRealtimeState(key);
    const manifest=normalizeManifest(row?.payload||null,s.document_type,s.period);
    return {ok:true,source:row?'CLOUD':'EMPTY',manifest};
  }

  async function loadBatch(documentType,period,batchId,options={}){
    const s=validateScope(documentType,period), id=clean(batchId);
    if(!id) return {ok:false,error:'BATCH_ID_REQUIRED'};
    const st=storage(), cid=cacheId(s.document_type,s.period,`batch::${token(id)}`);
    if(options.preferCache===true&&st?.getCached){ const c=await st.getCached(CACHE_KIND,cid); if(c) return {ok:true,source:'CACHE',batch:clone(c)}; }
    const row=await cloud().fetchRealtimeState(batchKey(s.document_type,s.period,id));
    if(!row) return {ok:false,error:'BATCH_NOT_FOUND'};
    if(st?.setCached){ try{ await st.setCached(CACHE_KIND,cid,row.payload); }catch(e){ console.warn('[NormalizedSourceRepository] cache refresh failed',e); } }
    return {ok:true,source:'CLOUD',batch:clone(row.payload)};
  }

  async function loadCurrent(documentType,period,options={}){
    const m=await loadManifest(documentType,period);
    if(!m.manifest.current_batch_id) return {ok:true,source:'EMPTY',manifest:m.manifest,batch:null,records:[]};
    const b=await loadBatch(documentType,period,m.manifest.current_batch_id,options);
    if(!b.ok) return Object.assign({},b,{manifest:m.manifest});
    return {ok:true,source:b.source,manifest:m.manifest,batch:b.batch,records:clone(b.batch.records||[])};
  }

  async function saveBatch(input={}){
    const s=validateScope(input.document_type,input.period), batchId=clean(input.batch_id);
    if(!batchId) return {ok:false,error:'BATCH_ID_REQUIRED'};
    const vr=validateRecords(s.document_type,input.records);
    if(!vr.ok) return {ok:false,error:'VALIDATION_ERROR',errors:vr.errors};

    const current=await loadManifest(s.document_type,s.period);
    const priorId=current.manifest.current_batch_id;
    // SKDL0003(CONFIRMED)は会社確定値でimmutable。同月の確定正本が既にある場合、
    // 内容差異のある新BatchでCURRENTを動かさない。同一内容の再投入だけ冪等成功とする。
    if(s.document_type==='PL_ACTUAL'&&priorId&&vr.records.some(r=>r?.document_state==='CONFIRMED')){
      const prior=await loadBatch(s.document_type,s.period,priorId);
      const priorRows=prior?.ok?(prior.batch?.records||[]):[];
      const semantic=row=>{ const x=Object.assign({},row); delete x.source_file_id; delete x.source_record_id; delete x.source_row_index; return x; };
      const sig=rows=>JSON.stringify((rows||[]).map(semantic));
      const priorConfirmed=priorRows.some(r=>r?.document_state==='CONFIRMED');
      if(priorConfirmed){
        if(sig(priorRows)===sig(vr.records)) return {ok:true,idempotent:true,batch_id:priorId,supersedes_batch_id:prior.batch?.supersedes_batch_id||null,record_count:priorRows.length,manifest:clone(current.manifest)};
        return {ok:false,error:'CONFIRMED_IMMUTABLE_CONFLICT',current_batch_id:priorId};
      }
    }
    const supersedes=clean(input.supersedes_batch_id)||priorId||null;
    if(priorId&&supersedes!==priorId) return {ok:false,error:'REVISION_CHAIN_MISMATCH',expected_supersedes_batch_id:priorId};

    const batch=makeBatch({document_type:s.document_type,period:s.period,batch_id:batchId,source_file_id:input.source_file_id,supersedes_batch_id:supersedes,records:vr.records,meta:input.meta||{}});
    const batchSave=await cloud().pushRealtimeState(batchKey(s.document_type,s.period,batchId),batch);
    if(!batchSave?.ok) return {ok:false,error:batchSave?.error||'BATCH_CLOUD_SAVE_FAILED'};

    const manifest=normalizeManifest(current.manifest,s.document_type,s.period);
    manifest.batches=manifest.batches.map(x=>Object.assign({},x,{revision_status:x.batch_id===priorId?'SUPERSEDED':x.revision_status}));
    const existing=manifest.batches.findIndex(x=>x.batch_id===batchId);
    const entry={batch_id:batchId,source_file_id:batch.source_file_id,supersedes_batch_id:supersedes,revision_status:'CURRENT',saved_at:batch.saved_at,record_count:batch.record_count};
    if(existing>=0) manifest.batches[existing]=entry; else manifest.batches.push(entry);
    manifest.current_batch_id=batchId; manifest.updated_at=batch.saved_at;

    const manifestSave=await cloud().pushRealtimeState(manifestKey(s.document_type,s.period),manifest);
    if(!manifestSave?.ok) return {ok:false,error:manifestSave?.error||'MANIFEST_CLOUD_SAVE_FAILED',batch_saved:true,batch_id:batchId};

    let cache_ok=null; const st=storage();
    if(st?.setCached){ try{ cache_ok=await st.setCached(CACHE_KIND,cacheId(s.document_type,s.period,`batch::${token(batchId)}`),batch); }catch(e){ cache_ok=false; } }
    try{ window.dispatchEvent(new CustomEvent('normalized-source-updated',{detail:{document_type:s.document_type,period:s.period,batch_id:batchId}})); }catch(_e){}
    return {ok:true,batch_id:batchId,supersedes_batch_id:supersedes,record_count:batch.record_count,cache_ok,manifest:clone(manifest)};
  }

  window.NORMALIZED_SOURCE_REPOSITORY=Object.freeze({VERSION,PREFIX,CACHE_KIND,SUPPORTED:Object.freeze([...SUPPORTED]),validateRecords,loadManifest,loadBatch,loadCurrent,saveBatch});
})();
