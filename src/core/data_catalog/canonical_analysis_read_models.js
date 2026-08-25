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

  function normalizeShipperCode(v){
    let c=clean(v).replace(/\.0$/,'').replace(/[^0-9A-Za-z]/g,'');
    if(!c)return '';
    if(!c.startsWith('0'))c='0'+c;
    return c;
  }
  function shipperGroupCode(code){return normalizeShipperCode(code).slice(0,4);}
  function simplifyShipperName(name){
    const n=clean(name).replace(/（.*?）/g,'').replace(/\(.*?\)/g,'').trim();
    if(/でんきち|デンキチ/i.test(n))return 'でんきち';
    if(/コジマ/i.test(n))return 'コジマ';
    if(/ビックカメラ|ビック/i.test(n))return 'ビックカメラ';
    if(/ジェイトップ/i.test(n))return 'ジェイトップ';
    if(/スリーエス/i.test(n))return 'スリーエスサンキ家具';
    if(/プラスカーゴ/i.test(n))return 'プラスカーゴサービス';
    if(/フジ医療器/i.test(n))return 'フジ医療器';
    return n||'未設定';
  }
  function majorityShipperName(values,simplify=true){
    const counts=new Map();
    for(const value of values||[]){
      const n=simplify?simplifyShipperName(value):(clean(value)||'未設定');
      counts.set(n,(counts.get(n)||0)+1);
    }
    if(!counts.size)return '未設定';
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ja'))[0][0];
  }
  function classifyOtherIncomeFact(f){
    const account=clean(f?.account_name);
    if(account.includes('雑'))return '雑収入';
    if(account.includes('調整'))return '調整';
    if(account.includes('値引'))return '値引戻し';
    if(account.includes('返品'))return '返品関連';
    if(account.includes('手数料'))return '手数料';
    return account||'その他';
  }

  function makeShipperReadModel(materialized,period){
    const snap=materialized?.snapshot||{}, e=snap.entities||{};
    const facts=safe(e.ACCOUNTING_FACT).filter(f=>
      f?.document_type==='PL_ACTUAL' &&
      f?.document_state==='CONFIRMED' &&
      clean(f?.account_name).includes('収入')
    );
    const groups=new Map(), contracts=new Map(), allSlips=new Set(), issues=[];
    let totalIncome=0, targetRows=0, skippedNoCode=0;

    facts.forEach((f,rowIndex)=>{
      targetRows++;
      const amount=numberOrNull(f.amount);
      if(amount===null){
        issues.push({source_record_id:f.source_record_id||null,reason:'売上金額UNKNOWN'});
        return;
      }
      totalIncome+=amount;

      const rawCode=clean(f.shipper_base_code);
      const hasCode=!!rawCode;
      const fullCode=hasCode?normalizeShipperCode(rawCode):'9999';
      const gKey=hasCode?shipperGroupCode(fullCode):'9999';
      if(!gKey){skippedNoCode++;return;}
      if(!hasCode)skippedNoCode++;

      const shipperName=hasCode?(clean(f.source_shipper_name)||'未設定'):'その他収入（荷主未設定）';
      const otherClass=classifyOtherIncomeFact(f);
      const contractName=hasCode?(clean(f.source_contract_name)||shipperName||'未設定'):otherClass;
      const contractKey=hasCode?fullCode:`9999_${otherClass}`;
      const slip=clean(f.slip_no)||`__row_slip_${rowIndex}`;

      if(hasCode)allSlips.add(slip);
      if(!groups.has(gKey))groups.set(gKey,{code4:gKey,names:new Set(),slips:new Set(),income:0,contracts:new Set(),breakdown:new Map()});
      const g=groups.get(gKey);
      g.names.add(shipperName);
      if(hasCode)g.slips.add(slip);
      g.income+=amount;

      if(!hasCode){
        g.breakdown.set(otherClass,(g.breakdown.get(otherClass)||0)+amount);
        return;
      }

      if(!contracts.has(contractKey))contracts.set(contractKey,{code:contractKey,groupCode:gKey,shipperNames:new Set(),contractNames:new Set(),slips:new Set(),income:0});
      const c=contracts.get(contractKey);
      c.shipperNames.add(shipperName); c.contractNames.add(contractName); c.slips.add(slip); c.income+=amount;
      g.contracts.add(contractKey);
    });

    const contractList=[...contracts.values()].map(c=>{
      const name=majorityShipperName(c.contractNames,false);
      return {
        code:c.code,groupCode:c.groupCode,name,
        shipperName:majorityShipperName(c.shipperNames,true),contractName:name,
        count:c.slips.size,income:c.income,unit:c.slips.size?Math.round(c.income/c.slips.size):0
      };
    }).sort((a,b)=>b.income-a.income||b.count-a.count||a.code.localeCompare(b.code,'ja'));

    const groupList=[...groups.values()].map(g=>({
      code4:g.code4,code3:g.code4,name:majorityShipperName(g.names,true),
      count:g.slips.size,income:g.income,unit:g.code4==='9999'?null:(g.slips.size?Math.round(g.income/g.slips.size):0),
      isOther:g.code4==='9999',
      contracts:[...g.contracts].map(code=>contractList.find(c=>c.code===code)).filter(Boolean).sort((a,b)=>b.income-a.income||b.count-a.count||a.code.localeCompare(b.code,'ja')),
      breakdown:[...g.breakdown.entries()].map(([name,income])=>({name,income})).sort((a,b)=>b.income-a.income)
    })).sort((a,b)=>b.income-a.income||b.count-a.count||a.name.localeCompare(b.name,'ja'));

    return {
      ym:period,groups:groupList,contracts:contractList,issues,
      ticketCount:allSlips.size,totalIncome,targetRows,skippedNoCode,
      sourceRule:'Canonical PL_ACTUAL(CONFIRMED)：収支科目名に「収入」を含む行 / 金額合算 / 原票番号ユニーク件数 / 荷主基本コード0補完左4桁統合 / 荷主コードなし収入も売上へ含む',
      source:'CANONICAL',dataPath:'CANONICAL_ACCOUNTING',
      current_batch_id:snap?.materialization?.current_batches?.PL_ACTUAL||null
    };
  }

  function makeFieldProductAreaReadModel(materialized,period){
    const records=safe(materialized?.normalized?.SHIPPER_AREA?.records);
    const ticketsBySlip=new Map();
    let unknownAmountRows=0;
    records.forEach((r,idx)=>{
      const slip=clean(r.slip_no); if(!slip)return;
      if(!ticketsBySlip.has(slip)) ticketsBySlip.set(slip,{
        slip,slipNo:slip,date:clean(r.delivery_date),zip:clean(r.zip_code),
        product:clean(r.source_product_name),productName:clean(r.source_product_name),
        productCode:clean(r.source_product_code),amount:0,amountKnown:true,workDetails:[],works:{}
      });
      const t=ticketsBySlip.get(slip);
      if(!t.zip&&r.zip_code)t.zip=clean(r.zip_code);
      if(!t.product&&r.source_product_name){t.product=t.productName=clean(r.source_product_name);}
      const work=clean(r.source_work_name);
      const amount=numberOrNull(r.amount);
      if(amount===null){t.amountKnown=false;unknownAmountRows++;}
      else t.amount+=amount;
      if(work){
        t.workDetails.push({work,amount:amount===null?null:amount,quantity:numberOrNull(r.quantity),unitPrice:numberOrNull(r.unit_price)});
        if(amount!==null)t.works[work]=(t.works[work]||0)+amount;
        else if(!(work in t.works))t.works[work]=null;
      }
    });
    const tickets=[...ticketsBySlip.values()];
    return {
      ym:period,tickets,uniqueCount:tickets.length,detailRows:records.length,
      amount:tickets.filter(t=>t.amountKnown).reduce((a,t)=>a+t.amount,0),
      unknownAmountRows,source:'CANONICAL',dataPath:'CANONICAL',
      current_batch_id:materialized?.snapshot?.materialization?.current_batches?.SHIPPER_AREA||null
    };
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
        if(!batches.WORKER_SALES&&!batches.SHIPPER_AREA&&!batches.PL_ACTUAL){const out={status:'LEGACY_FALLBACK',period:ym,reason:'Normalized CURRENT source not registered'};monthCache.set(ym,out);return out;}
        const out={status:'READY',period:ym,materialized:m,worker:batches.WORKER_SALES?makeWorkerReadModel(m,ym):null,shipper:batches.PL_ACTUAL?makeShipperReadModel(m,ym):null,fieldProductArea:batches.SHIPPER_AREA?makeFieldProductAreaReadModel(m,ym):null};
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
