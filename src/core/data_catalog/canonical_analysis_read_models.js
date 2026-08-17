/* ============================================================================
   Version6 D4-23: Canonical Analysis Read Models
   荷主分析・作業者分析がCanonical Entityを直接解釈しないための読取Adapter。
   VERIFIED CURRENT SOURCEがある月はCanonical優先、未移行月のみLegacyへfallback。
============================================================================ */
'use strict';
(function(){
  if(window.CANONICAL_ANALYSIS_READ_MODELS) return;
  const monthCache=new Map();
  const loading=new Map();
  const clean=v=>String(v??'').trim();
  const safe=v=>Array.isArray(v)?v:[];
  const numberOrNull=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const normalizeLabel=v=>clean(v).normalize('NFKC').replace(/[\s　]/g,'').toLowerCase();
  const isTrunk=s=>/幹線|幹線料|中継|中継料/.test(clean(s));
  const isDirect=s=>/直収/.test(clean(s));
  const code3=v=>clean(v).replace(/\.0$/,'').slice(0,3);
  const displayName=v=>clean(v)||'未設定';
  const subjectId=d=>clean(d?.worker_id||d?.attribution_subject_id||d?.source_subject_label);

  function makeWorkerReadModel(materialized,period){
    const snap=materialized?.snapshot||{};
    const e=snap.entities||{};
    const slips=new Map(safe(e.BUSINESS_SLIP).map(x=>[x.slip_id,x]));
    const rows=safe(e.SALES_DETAIL).filter(x=>x?.source_document_type==='WORKER_SALES');
    const workers=new Map();
    const allDays=new Set();
    let includedAmount=0,excludedAmount=0,excludedLineRows=0,lineRows=0;

    rows.forEach(d=>{
      const label=displayName(d.source_subject_label);
      if(!label) return;
      const key=subjectId(d)||label;
      if(!workers.has(key)) workers.set(key,{
        name:label,rows:0,lineRows:0,amount:0,salesAmount:0,directAmount:0,excludedAmount:0,excludedLineRows:0,
        works:{},chartWorks:{},directWorks:{},excludedWorks:{},slips:{},workDays:[],workDayCount:0,
        attribution_subject_type:d.attribution_subject_type||null,attribution_subject_id:d.attribution_subject_id||null,
        worker_id:d.worker_id||null,worker_company_id:d.worker_company_id||null
      });
      const w=workers.get(key); w.lineRows++; lineRows++;
      const slip=slips.get(d.slip_id)||null;
      const slipNo=clean(slip?.slip_no)||clean(d.slip_id);
      const day=clean(slip?.completed_at).slice(0,10);
      if(day){ if(!w.workDays.includes(day)) w.workDays.push(day); allDays.add(day); }
      if(!w.slips[slipNo]) w.slips[slipNo]={slip:slipNo,date:day,amount:0,includedAmount:0,salesAmount:0,directAmount:0,excludedAmount:0,works:{},chartWorks:{},directWorks:{}};
      const so=w.slips[slipNo];
      const work=displayName(d.source_detail_name);
      so.works[work]=(so.works[work]||0)+1;
      w.works[work]=(w.works[work]||0)+1;
      const amount=numberOrNull(d.amount);
      if(isTrunk(work)){
        w.excludedLineRows++; excludedLineRows++;
        if(amount!==null){w.excludedAmount+=amount;so.excludedAmount+=amount;excludedAmount+=amount;}
        w.excludedWorks[work]=(w.excludedWorks[work]||0)+1;
        return;
      }
      w.chartWorks[work]=(w.chartWorks[work]||0)+1;
      so.chartWorks[work]=(so.chartWorks[work]||0)+1;
      if(isDirect(d.billing_type)){
        w.directWorks[work]=(w.directWorks[work]||0)+1;
        so.directWorks[work]=(so.directWorks[work]||0)+1;
      }
      if(amount!==null){
        w.amount+=amount;so.amount+=amount;so.includedAmount+=amount;includedAmount+=amount;
        if(isDirect(d.billing_type)){w.directAmount+=amount;so.directAmount+=amount;}
        else {w.salesAmount+=amount;so.salesAmount+=amount;}
      }
    });
    for(const w of workers.values()){
      w.rows=Object.keys(w.slips).length;
      w.workDays.sort(); w.workDayCount=w.workDays.length;
    }
    const workerObj={}; for(const [k,w] of workers) workerObj[k]=w;
    return {
      ym:period,workers:workerObj,rowCount:rows.length,workerCount:workers.size,workDays:[...allDays].sort(),workDayCount:allDays.size,
      includedAmount,excludedAmount,excludedLineRows,amountMode:'Canonical WORKER_SALES：幹線料系除外後',
      source:'CANONICAL',dataPath:'CANONICAL',current_batch_id:snap?.materialization?.current_batches?.WORKER_SALES||null
    };
  }

  function chooseShipperMeta(recordsBySlip,slipId,slipNo){
    const list=recordsBySlip.get(slipNo)||[];
    const codes=[...new Set(list.map(x=>clean(x.source_shipper_code)).filter(Boolean))];
    const names=[...new Set(list.map(x=>clean(x.source_shipper_name)).filter(Boolean))];
    if(codes.length!==1) return {ok:false,reason:codes.length?'荷主コード競合':'荷主コード未取得',codes,names};
    const code=codes[0];
    return {ok:true,code,code3:code3(code),name:names[0]||code,contractName:names[0]||code};
  }

  function makeShipperReadModel(materialized,period){
    const snap=materialized?.snapshot||{}, e=snap.entities||{};
    const slips=safe(e.BUSINESS_SLIP), sales=safe(e.SALES_DETAIL);
    const normalized=safe(materialized?.normalized?.SHIPPER_AREA?.records);
    const normalizedBySlip=new Map();
    normalized.forEach(r=>{const no=clean(r.slip_no);if(!no)return;if(!normalizedBySlip.has(no))normalizedBySlip.set(no,[]);normalizedBySlip.get(no).push(r);});
    const salesBySlip=new Map();
    sales.forEach(d=>{if(!d?.slip_id)return;if(!salesBySlip.has(d.slip_id))salesBySlip.set(d.slip_id,[]);salesBySlip.get(d.slip_id).push(d);});
    const groups=new Map(),contracts=new Map();
    const issues=[];
    slips.forEach(slip=>{
      const slipNo=clean(slip.slip_no); if(!slipNo)return;
      const meta=chooseShipperMeta(normalizedBySlip,slip.slip_id,slipNo);
      if(!meta.ok){ if((normalizedBySlip.get(slipNo)||[]).length) issues.push({slip_no:slipNo,reason:meta.reason}); return; }
      const details=salesBySlip.get(slip.slip_id)||[];
      if(!details.length) return;
      const amounts=details.map(x=>numberOrNull(x.amount));
      if(amounts.some(v=>v===null)){ issues.push({slip_no:slipNo,reason:'売上金額UNKNOWN'}); return; }
      const income=amounts.reduce((a,v)=>a+v,0);
      const full=meta.code, c3=meta.code3||full;
      if(!contracts.has(full))contracts.set(full,{code:full,groupCode:c3,name:meta.contractName,count:0,income:0,slips:new Set()});
      const c=contracts.get(full); if(!c.slips.has(slipNo)){c.slips.add(slipNo);c.count++;c.income+=income;}
      if(!groups.has(c3))groups.set(c3,{code3:c3,name:meta.name,count:0,income:0,slips:new Set(),contracts:new Set()});
      const g=groups.get(c3); g.contracts.add(full); if(!g.slips.has(slipNo)){g.slips.add(slipNo);g.count++;g.income+=income;}
    });
    const contractList=[...contracts.values()].map(c=>({code:c.code,groupCode:c.groupCode,name:c.name,groupName:groups.get(c.groupCode)?.name||c.groupCode,count:c.count,income:c.income,unit:c.count?Math.round(c.income/c.count):0})).sort((a,b)=>b.income-a.income||b.count-a.count);
    const groupList=[...groups.values()].map(g=>({code3:g.code3,name:g.name,count:g.count,income:g.income,unit:g.count?Math.round(g.income/g.count):0,contracts:[...g.contracts].map(code=>contractList.find(c=>c.code===code)).filter(Boolean).sort((a,b)=>b.income-a.income)})).sort((a,b)=>b.income-a.income||b.count-a.count);
    return {ym:period,groups:groupList,contracts:contractList,issues,source:'CANONICAL',dataPath:'CANONICAL',current_batch_id:snap?.materialization?.current_batches?.SHIPPER_AREA||null};
  }

  async function loadMonth(period,{force=false}={}){
    const ym=clean(period); if(!/^\d{6}$/.test(ym))return {status:'EMPTY',period:ym};
    if(!force&&monthCache.has(ym))return monthCache.get(ym);
    if(loading.has(ym))return loading.get(ym);
    const promise=(async()=>{
      if(!window.CANONICAL_MATERIALIZER?.materialize){const out={status:'LEGACY_FALLBACK',period:ym,reason:'Canonical Materializer unavailable'};monthCache.set(ym,out);return out;}
      try{
        const m=await CANONICAL_MATERIALIZER.materialize({period:ym});
        const batches=m?.snapshot?.materialization?.current_batches||{};
        if(!batches.WORKER_SALES&&!batches.SHIPPER_AREA){const out={status:'LEGACY_FALLBACK',period:ym,reason:'Normalized CURRENT source not registered'};monthCache.set(ym,out);return out;}
        const out={status:'READY',period:ym,materialized:m,worker:batches.WORKER_SALES?makeWorkerReadModel(m,ym):null,shipper:batches.SHIPPER_AREA?makeShipperReadModel(m,ym):null};
        monthCache.set(ym,out);return out;
      }catch(e){const out={status:'LEGACY_FALLBACK',period:ym,reason:e?.message||String(e)};monthCache.set(ym,out);return out;}
      finally{loading.delete(ym);}
    })();
    loading.set(ym,promise);return promise;
  }
  function peek(period){return monthCache.get(clean(period))||null;}
  function invalidate(period){if(period)monthCache.delete(clean(period));else monthCache.clear();}
  window.addEventListener?.('normalized-source-updated',ev=>{const p=clean(ev?.detail?.period); if(p)invalidate(p);});
  window.CANONICAL_ANALYSIS_READ_MODELS=Object.freeze({loadMonth,peek,invalidate});
})();
