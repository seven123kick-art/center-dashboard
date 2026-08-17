/* ============================================================================
   Version6 D4-34: Canonical Route Profitability Safety Adapter
   ----------------------------------------------------------------------------
   便別採算をCanonicalへ切り替える際の安全条件を厳格化する。

   原則
   - DELIVERY_LIST CURRENTが存在する月だけCanonical便基盤を使用。
   - DELIVERY_LISTがなければ月全体をLegacyへfallbackし、同一集計内で混在させない。
   - ROUTE_PAYMENTのNO_RECORD / ZERO_PAYMENT / UNKNOWNを区別する。
   - 売上・傭車料のどちらかが未確定なら利益は確定しない。
   - 0円による補完や自社便推定は行わない。
============================================================================ */
'use strict';
(function(){
  if(window.CANONICAL_ROUTE_LEDGER) return;

  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>String(v??'').trim();
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const cache=new Map();

  function paymentState(pay,hasPaymentBatch){
    if(!hasPaymentBatch) return 'SOURCE_NOT_REGISTERED';
    if(!pay || pay.absence_status==='NO_RECORD') return 'NO_RECORD';
    if(pay.absence_status==='ZERO_PAYMENT') return 'ZERO_PAYMENT';
    if(!finite(pay.amount)) return 'UNKNOWN_AMOUNT';
    return Number(pay.amount)===0?'ZERO_PAYMENT':'KNOWN';
  }

  function salesState(details,slipIds,hasDetailBatch){
    if(!slipIds.length) return 'NO_SLIPS';
    if(!hasDetailBatch) return 'SOURCE_NOT_REGISTERED';
    if(!details.length) return 'UNMATCHED';
    if(details.some(x=>!finite(x?.amount))) return 'UNKNOWN_AMOUNT';
    return 'KNOWN';
  }

  function statusText({rw,slipIds,salesStatus,paymentStatus}){
    if(!rw) return '作業者未一致';
    if(!slipIds.length) return '原票未取得';
    if(salesStatus==='SOURCE_NOT_REGISTERED') return '売上SOURCE未登録';
    if(salesStatus==='UNMATCHED') return '売上未一致';
    if(salesStatus==='UNKNOWN_AMOUNT') return '売上金額UNKNOWN';
    if(paymentStatus==='SOURCE_NOT_REGISTERED') return '傭車料SOURCE未登録';
    if(paymentStatus==='NO_RECORD') return '傭車料資料に該当なし';
    if(paymentStatus==='UNKNOWN_AMOUNT') return '傭車料金額UNKNOWN';
    if(paymentStatus==='ZERO_PAYMENT') return '傭車料0円';
    return '完全連動';
  }

  function build(snapshot,period){
    const e=snapshot?.entities||{};
    const mat=snapshot?.materialization||{};
    const batches=mat.current_batches||{};
    const routes=arr(e.DELIVERY_ROUTE);
    const workers=arr(e.ROUTE_WORKER);
    const attempts=arr(e.DELIVERY_ATTEMPT);
    const slips=arr(e.BUSINESS_SLIP);
    const sales=arr(e.SALES_DETAIL);
    const payments=arr(e.ROUTE_PAYMENT);

    const hasDeliveryList=!!batches.DELIVERY_LIST;
    const hasPaymentBatch=!!batches.ROUTE_PAYMENT;
    const hasWorkerSales=!!batches.WORKER_SALES;
    const hasShipperArea=!!batches.SHIPPER_AREA;
    const hasDetailBatch=hasWorkerSales||hasShipperArea;

    const slipNoById=new Map(slips.map(x=>[x.slip_id,clean(x.slip_no)]));
    const salesBySlip=new Map();
    sales.forEach(x=>{
      if(!x?.slip_id)return;
      if(!salesBySlip.has(x.slip_id))salesBySlip.set(x.slip_id,[]);
      salesBySlip.get(x.slip_id).push(x);
    });

    const attemptsByRoute=new Map();
    attempts.forEach(x=>{
      if(!x?.route_id)return;
      if(!attemptsByRoute.has(x.route_id))attemptsByRoute.set(x.route_id,[]);
      attemptsByRoute.get(x.route_id).push(x);
    });

    const workerByRoute=new Map();
    workers.forEach(x=>{
      if(x?.route_id&&!workerByRoute.has(x.route_id))workerByRoute.set(x.route_id,x);
    });

    const paymentByRoute=new Map();
    payments.forEach(x=>{
      if(x?.route_id&&!paymentByRoute.has(x.route_id))paymentByRoute.set(x.route_id,x);
    });

    const rows=routes.map(r=>{
      const ats=attemptsByRoute.get(r.route_id)||[];
      const slipIds=[...new Set(ats.map(x=>x.slip_id).filter(Boolean))];
      const slipNos=slipIds.map(id=>slipNoById.get(id)).filter(Boolean);
      const details=slipIds.flatMap(id=>salesBySlip.get(id)||[]);
      const sState=salesState(details,slipIds,hasDetailBatch);
      const salesKnown=sState==='KNOWN';
      const salesAmount=salesKnown?details.reduce((a,x)=>a+Number(x.amount),0):null;

      const pay=paymentByRoute.get(r.route_id)||null;
      const pState=paymentState(pay,hasPaymentBatch);
      const paymentKnown=pState==='KNOWN'||pState==='ZERO_PAYMENT';
      const paymentAmount=paymentKnown?Number(pay?.amount||0):null;

      const rw=workerByRoute.get(r.route_id)||null;
      const workerName=clean(rw?.source_worker_name);
      const master=workerName&&window.WORKERS?.find?WORKERS.find(workerName,r.delivery_date):null;

      const profitabilityConfirmed=
        slipIds.length>0 &&
        salesKnown &&
        paymentKnown;

      let linkLevel='未連動';
      const linkedParts=[
        !!rw,
        slipIds.length>0,
        salesKnown,
        paymentKnown
      ].filter(Boolean).length;
      if(profitabilityConfirmed) linkLevel='完全連動';
      else if(linkedParts>1) linkLevel='部分連動';

      return {
        routeId:r.route_id,
        ym:period,
        date:clean(r.delivery_date),
        headNumber:clean(r.head_no),
        worker:workerName,
        companyName:clean(master?.companyName),
        operationType:clean(master?.operationType),
        workerRegistered:!!master,

        // 配送件数はDELIVERY_LISTに載っている原票件数。売上照合の成否で0件にしない。
        slips:slipNos,
        slipRows:[],
        count:slipIds.length,
        listedCount:slipIds.length,

        sales:salesAmount,
        salesStatus:sState,
        payment:paymentAmount,
        paymentStatus:pState,
        paymentSource:paymentKnown?'Canonical ROUTE_PAYMENT':'',
        headPayment:pay||null,

        vehicleCompanyCode:clean(pay?.source_vehicle_company_code),
        workerCode:clean(pay?.source_worker_code),
        toll:finite(pay?.toll_amount)?Number(pay.toll_amount):null,

        linkLevel,
        profitabilityConfirmed,
        margin:profitabilityConfirmed?salesAmount-paymentAmount:null,
        avg:salesKnown&&slipIds.length?salesAmount/slipIds.length:null,
        status:statusText({rw,slipIds,salesStatus:sState,paymentStatus:pState}),
        matchMode:'Canonical',
        partner:'',
        yoshaCode:'',
        canonical:true
      };
    });

    const sourceStatus={
      routePdf:hasDeliveryList,
      headPayment:hasPaymentBatch,
      workerCsv:hasWorkerSales,
      productCsv:hasShipperArea,
      skdl0001:false
    };

    const routeSlipTotal=rows.reduce((a,r)=>a+r.listedCount,0);
    const salesLinkedSlipTotal=rows
      .filter(r=>r.salesStatus==='KNOWN')
      .reduce((a,r)=>a+r.listedCount,0);

    return {
      ym:period,
      rows:[],
      routes:rows,
      source:'CANONICAL',
      diagnostics:{
        ym:period,
        sourceStatus,
        routeCount:rows.length,
        routeSlipTotal,
        matchedRouteSlipCount:salesLinkedSlipTotal,
        unmatchedRouteSlipCount:Math.max(0,routeSlipTotal-salesLinkedSlipTotal),
        workerSlipTotal:0,
        unmatchedWorkerSlipCount:0,
        productSlipTotal:0,
        unmatchedProductSlipCount:0,
        paymentRowTotal:payments.length,

        routesWithoutPayment:rows.filter(r=>!['KNOWN','ZERO_PAYMENT'].includes(r.paymentStatus)).length,
        routesNoPaymentRecord:rows.filter(r=>r.paymentStatus==='NO_RECORD').length,
        routesZeroPayment:rows.filter(r=>r.paymentStatus==='ZERO_PAYMENT').length,
        routesUnknownPayment:rows.filter(r=>r.paymentStatus==='UNKNOWN_AMOUNT').length,
        routesPaymentSourceMissing:rows.filter(r=>r.paymentStatus==='SOURCE_NOT_REGISTERED').length,

        routesWithoutWorker:rows.filter(r=>r.status==='作業者未一致').length,
        routesWithUnregisteredWorker:rows.filter(r=>r.worker&&!r.workerRegistered).length,
        unregisteredWorkers:[...new Set(rows.filter(r=>r.worker&&!r.workerRegistered).map(r=>r.worker))],
        pdfNoiseWorkerCount:0,
        routesWithoutSales:rows.filter(r=>r.salesStatus!=='KNOWN').length,

        integrationRate:routeSlipTotal?salesLinkedSlipTotal/routeSlipTotal*100:0,
        fullyLinkedRoutes:rows.filter(r=>r.linkLevel==='完全連動').length,
        partiallyLinkedRoutes:rows.filter(r=>r.linkLevel==='部分連動').length,
        unlinkedRoutes:rows.filter(r=>r.linkLevel==='未連動').length,
        headLinkedRoutes:rows.filter(r=>r.paymentStatus==='KNOWN'||r.paymentStatus==='ZERO_PAYMENT').length,
        headPaymentRowTotal:payments.filter(x=>x.absence_status!=='NO_RECORD').length,

        dataPath:'CANONICAL',
        noMixedAggregation:true,
        note:'DELIVERY_LIST CURRENTを便の基礎SOURCEとし、他SOURCE不足は部分連動として保持。Legacyとの混在集計はしない。'
      }
    };
  }

  async function buildMonth(period,{force=false}={}){
    const ym=clean(period);
    if(!/^\d{6}$/.test(ym)) return {ym,routes:[],rows:[],diagnostics:null,source:'EMPTY'};
    if(!force&&cache.has(ym)) return cache.get(ym);

    if(!window.CANONICAL_MATERIALIZER?.materialize){
      const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
      return {...legacy,source:'LEGACY_FALLBACK',fallbackReason:'Canonical Materializer unavailable'};
    }

    try{
      const m=await CANONICAL_MATERIALIZER.materialize({period:ym});
      const batches=m?.snapshot?.materialization?.current_batches||{};

      // D4-34: Canonical便集計の基礎SOURCEはDELIVERY_LIST。
      // PL_ACTUALやWORKER_SALESだけが存在してもCanonical便へ切り替えない。
      if(!batches.DELIVERY_LIST){
        const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
        const out={
          ...legacy,
          source:'LEGACY_FALLBACK',
          fallbackReason:'DELIVERY_LIST CURRENT not registered',
          canonicalSourceStatus:{
            DELIVERY_LIST:false,
            ROUTE_PAYMENT:!!batches.ROUTE_PAYMENT,
            WORKER_SALES:!!batches.WORKER_SALES,
            SHIPPER_AREA:!!batches.SHIPPER_AREA
          }
        };
        cache.set(ym,out);
        return out;
      }

      const out=build(m.snapshot,ym);
      cache.set(ym,out);
      return out;
    }catch(e){
      console.warn('[CanonicalRouteLedger] materialize failed',e);
      const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
      return {...legacy,source:'LEGACY_FALLBACK',fallbackReason:e?.message||String(e)};
    }
  }

  function invalidate(period){
    if(period) cache.delete(clean(period));
    else cache.clear();
  }

  window.addEventListener?.('normalized-source-updated',ev=>{
    const p=clean(ev?.detail?.period);
    if(p) invalidate(p);
  });

  window.CANONICAL_ROUTE_LEDGER=Object.freeze({buildMonth,invalidate,_internal:Object.freeze({build,paymentState,salesState})});
})();
