/* ============================================================================
   Version6 D3-6C/D3-7: Canonical Materializer
   CURRENT NORMALIZED SOURCE + ACTIVE ResolutionからCanonical Snapshotを再構築する。
   SOURCE/STATE/Masterは変更しない。永続化済みNORMALIZED SOURCEを正本として優先し、
   未保存SOURCEは空配列として扱う（旧STATEから明細を推測復元しない）。
============================================================================ */
'use strict';
(function(){
  if(window.__CANONICAL_MATERIALIZER_LOADED_20260817__) return;
  window.__CANONICAL_MATERIALIZER_LOADED_20260817__=true;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>String(v??'').trim();

  function requireDeps(){
    if(!window.Repository?.NormalizedSource) throw new Error('Repository.NormalizedSource is required');
    if(!window.CANONICAL_BUILDER) throw new Error('CANONICAL_BUILDER is required');
  }
  function legacyMaster(decisions){
    return window.RESOLUTION_PREVIEW?.buildContext?.({
      workers:[...(window.STATE?.workerMaster||[])],
      companies:[...(window.STATE?.companyMaster||[])],
      center:window.CENTER||null,
      resolutionDecisions:arr(decisions)
    })||null;
  }
  async function loadDecisions(){
    if(!window.Repository?.Resolution) return [];
    const r=await Repository.Resolution.load();
    if(!r?.ok) throw new Error(r?.error||'Resolution load failed');
    return arr(r.decisions);
  }
  async function loadCurrent(type,period){
    // CURRENT manifest is always verified against Cloud; the immutable batch body may
    // be reused from IndexedDB when the exact current_batch_id is already cached.
    const r=await Repository.NormalizedSource.loadCurrent(type,period,{preferCache:true});
    if(!r?.ok) throw new Error(r?.error||`${type} load failed`);
    return r;
  }
  function routePaymentsFromNormalized(records, routes){
    const byHead=new Map();
    arr(records).forEach(r=>{if(r&&!r.is_deleted&&clean(r.head_no)) byHead.set(clean(r.head_no),r);});
    const out=[];
    const seen=new Set();
    arr(routes).forEach(r=>{
      const head=clean(r?.head_no); if(!head||seen.has(head)) return; seen.add(head);
      const src=byHead.get(head)||null;
      out.push({
        route_payment_id:`RP_${head}`,
        route_payment_id_is_temporary:true,
        route_id:r.route_id,
        delivery_date:r.delivery_date||src?.delivery_date||null,
        head_no:head,
        amount:src?src.payment_amount:null,
        toll_amount:src?src.toll_amount:null,
        absence_status:src?(src.payment_amount===0?'ZERO_PAYMENT':null):'NO_RECORD',
        source_vehicle_company_code:src?.source_vehicle_company_code||null,
        source_worker_code:src?.source_worker1_code||null,
        payment_confirmed:src?.payment_confirmed??null,
        quality_status:src?'OK':'MISSING_SOURCE',
        source_document_type:'ROUTE_PAYMENT',
        source_file_id:src?.source_file_id||null,
        source_record_id:src?.source_record_id||null,
      });
    });
    return out;
  }

  function routeDataFromDeliveryList(records,period){
    const byHead=new Map();
    arr(records).forEach(rec=>{
      if(!rec||rec.is_deleted) return;
      const head=clean(rec.head_no); if(!head) return;
      if(!byHead.has(head)) byHead.set(head,{date:rec.delivery_date||null,headNumber:head,worker:rec.source_worker1_label||'',slips:[]});
      const r=byHead.get(head);
      if(!r.worker&&rec.source_worker1_label) r.worker=rec.source_worker1_label;
      if(rec.slip_no&&!r.slips.includes(clean(rec.slip_no))) r.slips.push(clean(rec.slip_no));
    });
    return byHead.size?[{ym:period,routes:[...byHead.values()],source:'normalized_delivery_list'}]:[];
  }

  async function materializeCore(input={}){
    requireDeps();
    const period=clean(input.period);
    if(!/^\d{6}$/.test(period)) throw new Error('period must be YYYYMM');
    try{ await window.DATA_PIPELINE_STATUS?.setStage?.(period,'ALL','CANONICAL','RUNNING',{message:'Canonical materialization started'}); }catch(_e){}
    const [worker,shipper,payment,delivery,accounting]=await Promise.all([
      loadCurrent('WORKER_SALES',period), loadCurrent('SHIPPER_AREA',period), loadCurrent('ROUTE_PAYMENT',period),
      loadCurrent('DELIVERY_LIST',period), loadCurrent('PL_ACTUAL',period)
    ]);
    const decisions=input.resolutionDecisions!==undefined?arr(input.resolutionDecisions):await loadDecisions();
    const resolutionContext=input.resolutionContext||legacyMaster(decisions);
    const legacyRouteData=arr(input.routeData!==undefined?input.routeData:(window.STATE?.routeData||[])).filter(x=>clean(x?.ym)===period);
    const normalizedRouteData=routeDataFromDeliveryList(delivery.records,period);
    const routeData=delivery.batch?normalizedRouteData:legacyRouteData;
    const snapshot=CANONICAL_BUILDER.buildSnapshotFromNormalizedSources({
      routeData,
      workerSalesRecords:worker.records,
      shipperAreaRecords:shipper.records,
      resolutionContext
    });
    snapshot.entities.ROUTE_PAYMENT=routePaymentsFromNormalized(payment.records,snapshot.entities.DELIVERY_ROUTE);
    snapshot.counts.ROUTE_PAYMENT=snapshot.entities.ROUTE_PAYMENT.length;
    const accountingFacts=window.ACCOUNTING_RECONCILIATION?.buildAccountingFacts?.(accounting.records)||[];
    const accountingReconciliation=window.ACCOUNTING_RECONCILIATION?.reconcileBySlip?.(snapshot.entities.SALES_DETAIL,accountingFacts,snapshot.entities.BUSINESS_SLIP)||[];
    snapshot.entities.ACCOUNTING_FACT=accountingFacts;
    snapshot.entities.ACCOUNTING_RECONCILIATION=accountingReconciliation;
    snapshot.counts.ACCOUNTING_FACT=accountingFacts.length;
    snapshot.counts.ACCOUNTING_RECONCILIATION=accountingReconciliation.length;
    snapshot.materialization={
      period, generated_at:new Date().toISOString(),
      normalized_source:true,
      resolution_decision_count:decisions.length,
      current_batches:{
        WORKER_SALES:worker.batch?.batch_id||null,
        SHIPPER_AREA:shipper.batch?.batch_id||null,
        ROUTE_PAYMENT:payment.batch?.batch_id||null,
        DELIVERY_LIST:delivery.batch?.batch_id||null,
        PL_ACTUAL:accounting.batch?.batch_id||null
      },
      source_record_counts:{WORKER_SALES:worker.records.length,SHIPPER_AREA:shipper.records.length,ROUTE_PAYMENT:payment.records.length,DELIVERY_LIST:delivery.records.length,PL_ACTUAL:accounting.records.length},
      has_normalized_detail_source:!!(worker.batch||shipper.batch),
      has_normalized_route_payment:!!payment.batch,
      has_normalized_delivery_list:!!delivery.batch,
      has_normalized_accounting:!!accounting.batch
    };
    try{
      await window.DATA_PIPELINE_STATUS?.setStage?.(period,'ALL','CANONICAL','OK',{detail:{counts:clone(snapshot.counts||{}),current_batches:clone(snapshot.materialization.current_batches||{})}});
      await window.DATA_PIPELINE_STATUS?.setStage?.(period,'ALL','DISPLAY_SNAPSHOT','OK',{message:'Verified display snapshot built',detail:{generated_at:snapshot.materialization.generated_at}});
    }catch(e){ console.warn('[CanonicalMaterializer] pipeline status update failed',e); }
    return {ok:true,snapshot,decisions:clone(decisions),resolutionContext,normalized:{WORKER_SALES:worker,SHIPPER_AREA:shipper,ROUTE_PAYMENT:payment,DELIVERY_LIST:delivery,PL_ACTUAL:accounting}};
  }

  async function materialize(input={}){
    const period=clean(input.period);
    try{ return await materializeCore(input); }
    catch(e){
      if(/^\d{6}$/.test(period)){
        try{ await window.DATA_PIPELINE_STATUS?.setStage?.(period,'ALL','CANONICAL','FAILED',{message:e?.message||String(e)}); }catch(_e){}
        try{ await window.DATA_PIPELINE_STATUS?.setStage?.(period,'ALL','DISPLAY_SNAPSHOT','FAILED',{message:'Canonical materialization failed'}); }catch(_e){}
      }
      throw e;
    }
  }

  window.CANONICAL_MATERIALIZER=Object.freeze({materialize,_internal:Object.freeze({routePaymentsFromNormalized,routeDataFromDeliveryList})});
})();
