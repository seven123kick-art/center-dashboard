/* ============================================================================
   Version6 D4-22: Canonical Route Profitability Adapter
   便別採算UIがCanonical Snapshotを直接解釈し始めないための読取Adapter。
   Canonicalが実データを持つ月はCanonicalを優先し、移行前月のみLegacy Ledgerへ戻す。
============================================================================ */
'use strict';
(function(){
  if(window.CANONICAL_ROUTE_LEDGER) return;
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>String(v??'').trim();
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const cache=new Map();

  function build(snapshot,period){
    const e=snapshot?.entities||{};
    const routes=arr(e.DELIVERY_ROUTE), workers=arr(e.ROUTE_WORKER), attempts=arr(e.DELIVERY_ATTEMPT);
    const slips=arr(e.BUSINESS_SLIP), sales=arr(e.SALES_DETAIL), payments=arr(e.ROUTE_PAYMENT);
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
    workers.forEach(x=>{if(x?.route_id&&!workerByRoute.has(x.route_id))workerByRoute.set(x.route_id,x);});
    const paymentByRoute=new Map(payments.map(x=>[x.route_id,x]));

    const rows=routes.map(r=>{
      const ats=attemptsByRoute.get(r.route_id)||[];
      const slipIds=[...new Set(ats.map(x=>x.slip_id).filter(Boolean))];
      const slipNos=slipIds.map(id=>slipNoById.get(id)).filter(Boolean);
      const details=slipIds.flatMap(id=>salesBySlip.get(id)||[]);
      const amountValues=details.map(x=>x.amount).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
      const salesAmount=amountValues.reduce((a,v)=>a+Number(v),0);
      const pay=paymentByRoute.get(r.route_id)||null;
      const rw=workerByRoute.get(r.route_id)||null;
      const hasSales=details.length>0 && amountValues.length===details.length;
      const hasPayment=!!pay && pay.absence_status!=='NO_RECORD' && pay.amount!==null && pay.amount!==undefined;
      const confirmed=hasSales&&hasPayment&&slipIds.length>0;
      const workerName=clean(rw?.source_worker_name);
      const master=workerName&&window.WORKERS?.find?WORKERS.find(workerName,r.delivery_date):null;
      let status='完全連動';
      if(!rw)status='作業者未一致';
      else if(!slipIds.length)status='原票未取得';
      else if(!hasSales)status='売上未一致';
      else if(!hasPayment)status='傭車費なし';
      return {
        routeId:r.route_id, ym:period, date:clean(r.delivery_date), headNumber:clean(r.head_no),
        worker:workerName, companyName:clean(master?.companyName), operationType:clean(master?.operationType),
        workerRegistered:!!master, slips:slipNos, slipRows:[], count:hasSales?slipIds.length:0,
        listedCount:slipIds.length, sales:salesAmount, payment:hasPayment?num(pay.amount):0,
        paymentSource:hasPayment?'Canonical ROUTE_PAYMENT':'', headPayment:null,
        vehicleCompanyCode:clean(pay?.source_vehicle_company_code), workerCode:clean(pay?.source_worker_code),
        toll:num(pay?.toll_amount), linkLevel:confirmed?'完全連動':(hasPayment?'配達ヘッド':'未照合'),
        profitabilityConfirmed:confirmed, margin:confirmed?salesAmount-num(pay.amount):null,
        avg:hasSales&&slipIds.length?salesAmount/slipIds.length:0, status, matchMode:'Canonical',
        partner:'', yoshaCode:'', canonical:true
      };
    });
    const sourceStatus={
      routePdf:!!snapshot?.materialization?.has_normalized_delivery_list,
      headPayment:!!snapshot?.materialization?.has_normalized_route_payment,
      workerCsv:!!snapshot?.materialization?.current_batches?.WORKER_SALES,
      productCsv:!!snapshot?.materialization?.current_batches?.SHIPPER_AREA,
      skdl0001:false
    };
    const routeSlipTotal=rows.reduce((a,r)=>a+r.listedCount,0);
    const matched=rows.reduce((a,r)=>a+r.count,0);
    return {
      ym:period, rows:[], routes:rows, source:'CANONICAL',
      diagnostics:{
        ym:period,sourceStatus,routeCount:rows.length,routeSlipTotal,matchedRouteSlipCount:matched,
        unmatchedRouteSlipCount:Math.max(0,routeSlipTotal-matched),workerSlipTotal:0,unmatchedWorkerSlipCount:0,
        productSlipTotal:0,unmatchedProductSlipCount:0,paymentRowTotal:payments.length,
        routesWithoutPayment:rows.filter(r=>!r.paymentSource).length,routesWithoutWorker:rows.filter(r=>r.status==='作業者未一致').length,
        routesWithUnregisteredWorker:rows.filter(r=>r.worker&&!r.workerRegistered).length,
        unregisteredWorkers:[...new Set(rows.filter(r=>r.worker&&!r.workerRegistered).map(r=>r.worker))],
        pdfNoiseWorkerCount:0,routesWithoutSales:rows.filter(r=>r.status==='売上未一致'||r.status==='原票未取得').length,
        integrationRate:routeSlipTotal?matched/routeSlipTotal*100:0,
        fullyLinkedRoutes:rows.filter(r=>r.linkLevel==='完全連動').length,
        headLinkedRoutes:rows.filter(r=>r.linkLevel==='配達ヘッド').length,
        headPaymentRowTotal:payments.filter(x=>x.absence_status!=='NO_RECORD').length,
        dataPath:'CANONICAL'
      }
    };
  }

  async function buildMonth(period,{force=false}={}){
    const ym=clean(period);
    if(!/^\d{6}$/.test(ym)) return {ym,routes:[],rows:[],diagnostics:null,source:'EMPTY'};
    if(!force&&cache.has(ym))return cache.get(ym);
    if(!window.CANONICAL_MATERIALIZER?.materialize){
      const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
      return {...legacy,source:'LEGACY_FALLBACK',fallbackReason:'Canonical Materializer unavailable'};
    }
    try{
      const m=await CANONICAL_MATERIALIZER.materialize({period:ym});
      const batches=m?.snapshot?.materialization?.current_batches||{};
      const hasCanonicalSource=Object.values(batches).some(Boolean);
      if(!hasCanonicalSource){
        const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
        const out={...legacy,source:'LEGACY_FALLBACK',fallbackReason:'Normalized CURRENT source not registered'};
        cache.set(ym,out); return out;
      }
      const out=build(m.snapshot,ym); cache.set(ym,out); return out;
    }catch(e){
      console.warn('[CanonicalRouteLedger] materialize failed',e);
      const legacy=window.LEDGER?.buildMonth?.(ym)||{ym,routes:[],rows:[],diagnostics:null};
      return {...legacy,source:'LEGACY_FALLBACK',fallbackReason:e?.message||String(e)};
    }
  }
  function invalidate(period){if(period)cache.delete(clean(period));else cache.clear();}
  window.CANONICAL_ROUTE_LEDGER=Object.freeze({buildMonth,invalidate});
})();
