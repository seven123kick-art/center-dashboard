/* ============================================================================
   Version6 M1-1: Monthly Management Status Read Model
   ----------------------------------------------------------------------------
   月単位の「経営判断に使える範囲」を、CURRENT Normalized Source / Canonical
   Read Model / Canonical Route Ledger から自動算出する読み取り専用Adapter。

   原則
   - 状態をSTATE / IndexedDB / Supabaseへ重複保存しない。
   - PLの確定状態と、分析データの完成度を分離する。
   - CURRENT batchが存在する0件月と、SOURCE未登録を区別する。
   - UNKNOWN / NO_RECORD / MISSING_SOURCEを0へ補完しない。
   - DATA_PIPELINE_STATUSは補助的な監査情報として表示するだけで、CURRENT
     SOURCE実体より優先して業務状態を決めない。
============================================================================ */
'use strict';
(function(){
  if(window.MONTHLY_MANAGEMENT_STATUS) return;

  const VERSION=1;
  const TYPES=Object.freeze(['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT']);
  const STATUS=Object.freeze({
    CONFIRMED:'CONFIRMED',
    PRELIMINARY:'PRELIMINARY',
    READY:'READY',
    PARTIAL:'PARTIAL',
    MISSING:'MISSING',
    ERROR:'ERROR',
    NOT_APPLICABLE:'NOT_APPLICABLE'
  });
  const OVERALL=Object.freeze({
    CONFIRMED:'CONFIRMED',
    CONFIRMED_WITH_WARNINGS:'CONFIRMED_WITH_WARNINGS',
    PRELIMINARY:'PRELIMINARY',
    INCOMPLETE:'INCOMPLETE',
    ERROR:'ERROR'
  });

  const cache=new Map();
  const clean=v=>String(v??'').trim();
  const arr=v=>Array.isArray(v)?v:[];
  const clone=v=>JSON.parse(JSON.stringify(v));

  function validatePeriod(period){
    const ym=clean(period);
    if(!/^\d{6}$/.test(ym)) throw new Error(`period must be YYYYMM: ${ym||'(empty)'}`);
    return ym;
  }
  function normalizedRepo(){
    const repo=window.Repository?.NormalizedSource;
    if(!repo?.loadCurrent) throw new Error('Repository.NormalizedSource is required');
    return repo;
  }
  function sourceSummary(type,result){
    if(!result?.ok){
      return {document_type:type,registered:false,current_batch_id:null,record_count:null,error:result?.error||'LOAD_FAILED'};
    }
    const batch=result.batch||null;
    return {
      document_type:type,
      registered:!!batch,
      current_batch_id:batch?.batch_id||result?.manifest?.current_batch_id||null,
      record_count:batch?arr(result.records).length:null,
      source:result.source||null,
      error:null
    };
  }
  async function loadSources(period){
    const repo=normalizedRepo();
    const entries=await Promise.all(TYPES.map(async type=>{
      try{
        const result=await repo.loadCurrent(type,period,{preferCache:true});
        return [type,result];
      }catch(e){
        return [type,{ok:false,error:e?.message||String(e),batch:null,records:[]}];
      }
    }));
    const byType={}; entries.forEach(([type,result])=>{byType[type]=result;});
    return byType;
  }
  async function loadPipeline(period){
    if(!window.DATA_PIPELINE_STATUS?.load) return null;
    const out={};
    for(const type of TYPES){
      try{
        const rec=await DATA_PIPELINE_STATUS.load(period,type);
        out[type]={summary:DATA_PIPELINE_STATUS.summarize?.(rec)||'UNKNOWN',stages:clone(rec?.stages||{})};
      }catch(e){
        out[type]={summary:'UNKNOWN',error:e?.message||String(e),stages:{}};
      }
    }
    return out;
  }

  function plStatus(result){
    const src=sourceSummary('PL_ACTUAL',result);
    if(src.error) return {status:STATUS.ERROR,...src,issues:[src.error],document_state:null};
    if(!src.registered) return {status:STATUS.MISSING,...src,issues:['PL_ACTUAL CURRENT未登録'],document_state:null};
    const records=arr(result.records);
    if(!records.length) return {status:STATUS.PARTIAL,...src,issues:['PL_ACTUAL CURRENTは存在するが0件'],document_state:null};
    const states=[...new Set(records.map(r=>clean(r?.document_state)).filter(Boolean))];
    if(states.length===1&&states[0]==='CONFIRMED') return {status:STATUS.CONFIRMED,...src,issues:[],document_state:'CONFIRMED'};
    if(states.length===1&&states[0]==='PRELIMINARY') return {status:STATUS.PRELIMINARY,...src,issues:[],document_state:'PRELIMINARY'};
    if(!states.length) return {status:STATUS.PARTIAL,...src,issues:['PL_ACTUAL document_stateを確認できない'],document_state:null};
    return {status:STATUS.PARTIAL,...src,issues:[`PL_ACTUAL document_stateが混在: ${states.join(', ')}`],document_state:states.join('|')};
  }

  function baseAnalysisStatus(type,result){
    const src=sourceSummary(type,result);
    if(src.error) return {status:STATUS.ERROR,...src,issues:[src.error],warning_count:0};
    if(!src.registered) return {status:STATUS.MISSING,...src,issues:[`${type} CURRENT未登録`],warning_count:0};
    return {status:STATUS.READY,...src,issues:[],warning_count:0};
  }

  function workerStatus(result,analysis){
    const base=baseAnalysisStatus('WORKER_SALES',result);
    if(base.status!==STATUS.READY) return base;
    if(!analysis){
      return {...base,status:STATUS.ERROR,issues:['Canonical作業者Read Modelを確認できない']};
    }
    if(analysis.status!=='READY'||!analysis.worker){
      return {...base,status:STATUS.ERROR,issues:[analysis.reason||'Canonical作業者Read ModelがREADYではない']};
    }
    const details=arr(analysis.materialized?.snapshot?.entities?.SALES_DETAIL)
      .filter(x=>x?.source_document_type==='WORKER_SALES');
    const unresolved=details.filter(x=>['UNMATCHED','CONFLICT'].includes(clean(x?.subject_resolution_status))).length;
    const provisional=details.filter(x=>clean(x?.subject_resolution_status)==='PROVISIONAL').length;
    const issues=[];
    if(unresolved) issues.push(`作業者帰属の未一致/競合 ${unresolved}件`);
    if(provisional) issues.push(`作業者帰属の暫定一致 ${provisional}件`);
    return {
      ...base,
      status:unresolved?STATUS.PARTIAL:STATUS.READY,
      issues,
      warning_count:unresolved+provisional,
      worker_count:Number(analysis.worker.workerCount||0),
      read_model_row_count:Number(analysis.worker.rowCount||0),
      unresolved_count:unresolved,
      provisional_count:provisional
    };
  }

  function shipperStatus(result,analysis){
    const base=baseAnalysisStatus('SHIPPER_AREA',result);
    if(base.status!==STATUS.READY) return base;
    if(!analysis){
      return {...base,status:STATUS.ERROR,issues:['Canonical荷主Read Modelを確認できない']};
    }
    if(analysis.status!=='READY'||!analysis.shipper){
      return {...base,status:STATUS.ERROR,issues:[analysis.reason||'Canonical荷主Read ModelがREADYではない']};
    }
    const readIssues=arr(analysis.shipper.issues);
    return {
      ...base,
      status:readIssues.length?STATUS.PARTIAL:STATUS.READY,
      issues:readIssues.slice(0,20).map(x=>x?.reason?`${x.slip_no||'原票'}: ${x.reason}`:String(x)),
      warning_count:readIssues.length,
      group_count:arr(analysis.shipper.groups).length,
      contract_count:arr(analysis.shipper.contracts).length,
      issue_count:readIssues.length
    };
  }

  function deliveryStatus(result,routeLedger){
    const base=baseAnalysisStatus('DELIVERY_LIST',result);
    if(base.status!==STATUS.READY) return base;
    if(!routeLedger){
      return {...base,status:STATUS.ERROR,issues:['Canonical Route Ledgerを確認できない']};
    }
    if(routeLedger.source!=='CANONICAL'){
      return {...base,status:STATUS.ERROR,issues:[routeLedger.fallbackReason||'DELIVERY_LIST CURRENTがあるがCanonical便基盤を使用できない']};
    }
    const d=routeLedger.diagnostics||{};
    const routeCount=Number(d.routeCount||0);
    return {
      ...base,
      status:STATUS.READY,
      issues:[],
      warning_count:0,
      route_count:routeCount,
      slip_count:Number(d.routeSlipTotal||0)
    };
  }

  function routeProfitStatus(deliveryResult,paymentResult,routeLedger){
    const delivery=sourceSummary('DELIVERY_LIST',deliveryResult);
    const payment=sourceSummary('ROUTE_PAYMENT',paymentResult);
    if(delivery.error||payment.error){
      return {status:STATUS.ERROR,registered:delivery.registered&&payment.registered,current_batch_id:payment.current_batch_id,issues:[delivery.error,payment.error].filter(Boolean),warning_count:0};
    }
    if(!delivery.registered){
      return {status:STATUS.MISSING,registered:false,current_batch_id:null,issues:['DELIVERY_LIST CURRENT未登録'],warning_count:0};
    }
    if(!routeLedger||routeLedger.source!=='CANONICAL'){
      return {status:STATUS.ERROR,registered:payment.registered,current_batch_id:payment.current_batch_id,issues:[routeLedger?.fallbackReason||'Canonical Route Ledgerを確認できない'],warning_count:0};
    }
    const routes=arr(routeLedger.routes);
    if(!routes.length){
      return {status:STATUS.NOT_APPLICABLE,registered:payment.registered,current_batch_id:payment.current_batch_id,issues:[],warning_count:0,route_count:0,confirmed_route_count:0};
    }
    if(!payment.registered){
      return {status:STATUS.MISSING,registered:false,current_batch_id:null,issues:['ROUTE_PAYMENT CURRENT未登録'],warning_count:routes.length,route_count:routes.length,confirmed_route_count:0};
    }
    const confirmed=routes.filter(r=>r?.profitabilityConfirmed===true).length;
    const unconfirmed=routes.length-confirmed;
    const issues=[];
    const d=routeLedger.diagnostics||{};
    if(Number(d.routesNoPaymentRecord||0)) issues.push(`傭車料資料に該当なし ${Number(d.routesNoPaymentRecord)}便`);
    if(Number(d.routesUnknownPayment||0)) issues.push(`傭車料金額UNKNOWN ${Number(d.routesUnknownPayment)}便`);
    if(Number(d.routesWithoutSales||0)) issues.push(`売上未確定 ${Number(d.routesWithoutSales)}便`);
    return {
      status:unconfirmed?STATUS.PARTIAL:STATUS.CONFIRMED,
      registered:true,
      current_batch_id:payment.current_batch_id,
      record_count:payment.record_count,
      issues,
      warning_count:unconfirmed,
      route_count:routes.length,
      confirmed_route_count:confirmed,
      unconfirmed_route_count:unconfirmed,
      routes_no_payment_record:Number(d.routesNoPaymentRecord||0),
      routes_zero_payment:Number(d.routesZeroPayment||0),
      routes_unknown_payment:Number(d.routesUnknownPayment||0),
      routes_without_sales:Number(d.routesWithoutSales||0)
    };
  }

  function decideOverall(areas){
    const pl=areas.pl;
    const analyses=[areas.worker,areas.shipper,areas.delivery,areas.route_profit];
    const anyError=analyses.some(x=>x.status===STATUS.ERROR);
    const anyIncomplete=analyses.some(x=>[STATUS.PARTIAL,STATUS.MISSING].includes(x.status));
    if(pl.status===STATUS.ERROR) return OVERALL.ERROR;
    if(pl.status===STATUS.MISSING||pl.status===STATUS.PARTIAL) return anyError?OVERALL.ERROR:OVERALL.INCOMPLETE;
    if(pl.status===STATUS.PRELIMINARY) return OVERALL.PRELIMINARY;
    if(pl.status===STATUS.CONFIRMED){
      return (anyError||anyIncomplete)?OVERALL.CONFIRMED_WITH_WARNINGS:OVERALL.CONFIRMED;
    }
    return OVERALL.INCOMPLETE;
  }

  function usability(areas){
    const usable=s=>[STATUS.CONFIRMED,STATUS.PRELIMINARY,STATUS.READY,STATUS.PARTIAL,STATUS.NOT_APPLICABLE].includes(s);
    return {
      confirmed_financials:areas.pl.status===STATUS.CONFIRMED,
      preliminary_financials:[STATUS.CONFIRMED,STATUS.PRELIMINARY].includes(areas.pl.status),
      worker_analysis:usable(areas.worker.status)&&areas.worker.status!==STATUS.MISSING,
      shipper_analysis:usable(areas.shipper.status)&&areas.shipper.status!==STATUS.MISSING,
      delivery_analysis:usable(areas.delivery.status)&&areas.delivery.status!==STATUS.MISSING,
      route_profitability:areas.route_profit.status===STATUS.CONFIRMED,
      route_profitability_partial:areas.route_profit.status===STATUS.PARTIAL
    };
  }

  async function build(period,{force=false}={}){
    const ym=validatePeriod(period);
    if(!force&&cache.has(ym)) return clone(cache.get(ym));

    const sourceResults=await loadSources(ym);
    const sources={}; TYPES.forEach(type=>{sources[type]=sourceSummary(type,sourceResults[type]);});

    let analysis=null;
    if(sources.WORKER_SALES.registered||sources.SHIPPER_AREA.registered){
      try{
        analysis=window.CANONICAL_ANALYSIS_READ_MODELS?.loadMonth
          ? await CANONICAL_ANALYSIS_READ_MODELS.loadMonth(ym,{force})
          : null;
      }catch(e){ analysis={status:'ERROR',period:ym,reason:e?.message||String(e)}; }
    }

    let routeLedger=null;
    if(sources.DELIVERY_LIST.registered){
      try{
        routeLedger=window.CANONICAL_ROUTE_LEDGER?.buildMonth
          ? await CANONICAL_ROUTE_LEDGER.buildMonth(ym,{force})
          : null;
      }catch(e){ routeLedger={source:'ERROR',fallbackReason:e?.message||String(e),routes:[],diagnostics:null}; }
    }

    const areas={
      pl:plStatus(sourceResults.PL_ACTUAL),
      worker:workerStatus(sourceResults.WORKER_SALES,analysis),
      shipper:shipperStatus(sourceResults.SHIPPER_AREA,analysis),
      delivery:deliveryStatus(sourceResults.DELIVERY_LIST,routeLedger),
      route_profit:routeProfitStatus(sourceResults.DELIVERY_LIST,sourceResults.ROUTE_PAYMENT,routeLedger)
    };

    const missing_sources=TYPES.filter(type=>!sources[type].registered&&!sources[type].error);
    const source_errors=TYPES.filter(type=>!!sources[type].error);
    const issues=[];
    Object.entries(areas).forEach(([area,v])=>arr(v.issues).forEach(message=>issues.push({area,message})));
    const pipeline=await loadPipeline(ym);
    const current_batches={}; TYPES.forEach(type=>{current_batches[type]=sources[type].current_batch_id||null;});

    const result={
      schema_version:VERSION,
      period:ym,
      generated_at:new Date().toISOString(),
      overall_status:decideOverall(areas),
      areas,
      usability:usability(areas),
      sources,
      current_batches,
      source_signature:clone(current_batches),
      missing_sources,
      source_errors,
      issue_count:issues.length,
      issues,
      pipeline,
      notes:[
        '月次PLの確定と分析データの完成度は別判定。',
        'CURRENT batchが存在する0件はSOURCE未登録と同一視しない。',
        'Pipeline Statusは監査補助情報であり、CURRENT SOURCE実体より優先しない。'
      ]
    };
    cache.set(ym,result);
    return clone(result);
  }

  function peek(period){ return cache.has(clean(period))?clone(cache.get(clean(period))):null; }
  function invalidate(period){ if(period) cache.delete(clean(period)); else cache.clear(); }

  window.addEventListener?.('normalized-source-updated',ev=>{const p=clean(ev?.detail?.period);if(p)invalidate(p);});
  window.addEventListener?.('data-pipeline-status-updated',ev=>{const p=clean(ev?.detail?.period);if(p)invalidate(p);});

  window.MONTHLY_MANAGEMENT_STATUS=Object.freeze({
    VERSION,TYPES,STATUS,OVERALL,build,peek,invalidate,
    _internal:Object.freeze({sourceSummary,plStatus,decideOverall,usability})
  });
})();
