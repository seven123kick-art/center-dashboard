/* ============================================================
   D2-3: Operational / Accounting Reconciliation（読取専用）
   業務売上とSKDL会計明細を混同せず、原票単位で比較する。
   差異から自動補正・倍率補正は行わない。
============================================================ */
'use strict';
(function(){
  if(window.__ACCOUNTING_RECONCILIATION_MODULE_LOADED_20260817__) return;
  window.__ACCOUNTING_RECONCILIATION_MODULE_LOADED_20260817__=true;
  const sum=(arr,fn)=>arr.reduce((a,x)=>{const v=fn(x); return a+(typeof v==='number'&&Number.isFinite(v)?v:0);},0);
  function group(rows,key){ const m=new Map(); (rows||[]).forEach(r=>{const k=r&&r[key]; if(!k)return; if(!m.has(k))m.set(k,[]); m.get(k).push(r);}); return m; }
  function buildAccountingFacts(records){
    return (records||[]).map(r=>({
      accounting_fact_id:`ACCOUNTING_FACT:${r.source_record_id}`,
      document_type:'PL_ACTUAL', document_state:r.document_state, immutable:!!r.immutable,
      center_code:r.center_code, year_month:r.year_month, accounting_date:r.accounting_date,
      account_code:r.account_code, account_name:r.account_name, subaccount_code:r.subaccount_code, subaccount_name:r.subaccount_name,
      amount:r.amount, slip_no:r.slip_no, head_no:r.head_no,
      shipper_base_code:r.shipper_base_code, shipper_contract_code:r.shipper_contract_code,
      employee_code:r.employee_code, source_file_id:r.source_file_id, source_record_id:r.source_record_id,
      value_status:r.document_state==='CONFIRMED'?'CONFIRMED':'PRELIMINARY'
    }));
  }
  function reconcileBySlip(operationalSales, accountingFacts, businessSlips){
    const slipNoById=new Map((businessSlips||[]).filter(x=>x&&x.slip_id&&x.slip_no).map(x=>[x.slip_id,x.slip_no]));
    const normalizedOperational=(operationalSales||[]).map(x=>{
      if(x&&x.slip_no) return x;
      const slipNo=x&&x.slip_id?slipNoById.get(x.slip_id):null;
      return slipNo?Object.assign({},x,{slip_no:slipNo}):x;
    });
    const op=group(normalizedOperational,'slip_no'), ac=group(accountingFacts,'slip_no');
    const keys=new Set([...op.keys(),...ac.keys()]); const out=[];
    for(const slipNo of keys){
      const o=op.get(slipNo)||[], a=ac.get(slipNo)||[];
      const ov=o.length?sum(o,x=>x.amount):null, av=a.length?sum(a,x=>x.amount):null;
      let status='UNRESOLVED';
      if(o.length&&a.length) status=ov===av?'EXACT':'ACCOUNTING_VARIANCE';
      else if(o.length) status='OPERATIONAL_ONLY'; else if(a.length) status='ACCOUNTING_ONLY';
      const states=[...new Set(a.map(x=>x.document_state).filter(Boolean))];
      out.push({
        accounting_reconciliation_id:`ACCOUNTING_RECON:SLIP:${slipNo}`,
        slip_no:slipNo, operational_value:ov, accounting_value:av,
        difference:(ov!==null&&av!==null)?av-ov:null,
        status, accounting_states:states,
        is_confirmed:states.includes('CONFIRMED'),
        note:'金額差は観測事実として保持し、自動補正しない'
      });
    }
    return out;
  }
  function summarizeByAccount(accountingFacts){
    const m=new Map();
    (accountingFacts||[]).forEach(r=>{
      const k=[r.document_state||'',r.center_code||'',r.account_code||'',r.account_name||'',r.subaccount_code||'',r.subaccount_name||''].join('|');
      if(!m.has(k)) m.set(k,{document_state:r.document_state,center_code:r.center_code,account_code:r.account_code,account_name:r.account_name,subaccount_code:r.subaccount_code,subaccount_name:r.subaccount_name,amount:0,row_count:0});
      const x=m.get(k); if(typeof r.amount==='number'&&Number.isFinite(r.amount)) x.amount+=r.amount; x.row_count++;
    });
    return [...m.values()];
  }
  window.ACCOUNTING_RECONCILIATION=Object.freeze({buildAccountingFacts,reconcileBySlip,summarizeByAccount});
})();
