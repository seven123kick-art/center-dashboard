/* ============================================================
   D2-4: Master Resolver（読取専用）
   CENTER / COMPANY / WORKER / SHIPPER_ACCOUNT の照合を、
   SOURCE値を変更せず決定的なキーから解決する。
   DB/STATE/Storage/Cloudへの書込みは行わない。
============================================================ */
'use strict';
(function(){
  if (window.__MASTER_RESOLVER_MODULE_LOADED_20260817__) return;
  window.__MASTER_RESOLVER_MODULE_LOADED_20260817__ = true;

  const clean=v=>(v==null?'':String(v)).trim();
  const norm=v=>clean(v).replace(/[\s　]/g,'').toUpperCase();
  const key=(...xs)=>xs.map(norm).join('|');

  function result(entityType, sourceValue, resolvedId, method, confidence, status, candidates=[]){
    return { entity_type:entityType, source_value:sourceValue==null?'':String(sourceValue), normalized_value:norm(sourceValue),
      resolved_id:resolvedId||null, match_method:method||null, match_confidence:confidence==null?null:confidence,
      status:status||'UNMATCHED', candidate_ids:candidates };
  }
  function add(map,k,id){ if(!k||!id)return; const a=map.get(k)||[]; if(!a.includes(id))a.push(id); map.set(k,a); }
  function one(map,k){ const a=map.get(k)||[]; return a.length===1?a[0]:null; }

  function buildIndexes(masters={}){
    const idx={centerCode:new Map(),centerName:new Map(),companyName:new Map(),workerCode:new Map(),workerNameCompanyCenter:new Map(),workerNameCenter:new Map(),workerName:new Map(),shipperCode:new Map(),shipperName:new Map()};
    (masters.centers||[]).forEach(x=>{add(idx.centerCode,norm(x.center_code),x.center_id);add(idx.centerName,norm(x.center_name),x.center_id);});
    (masters.centerAliases||[]).forEach(x=>add(idx.centerName,norm(x.alias_label),x.center_id));
    (masters.companies||[]).forEach(x=>add(idx.companyName,norm(x.company_name),x.company_id));
    (masters.companyAliases||[]).forEach(x=>add(idx.companyName,norm(x.alias_label),x.company_id));
    const assignments=masters.workerAssignments||[];
    (masters.workers||[]).forEach(w=>{
      add(idx.workerCode,norm(w.employee_code),w.worker_id); add(idx.workerName,norm(w.worker_name),w.worker_id);
      assignments.filter(a=>a.worker_id===w.worker_id).forEach(a=>{
        add(idx.workerNameCompanyCenter,key(w.worker_name,a.company_id,a.center_id),w.worker_id);
        add(idx.workerNameCenter,key(w.worker_name,a.center_id),w.worker_id);
      });
    });
    (masters.workerAliases||[]).forEach(a=>add(idx.workerName,norm(a.alias_label),a.worker_id));
    (masters.shipperAccounts||[]).forEach(a=>add(idx.shipperCode,norm(a.source_shipper_code),a.shipper_account_id));
    (masters.shippers||[]).forEach(s=>add(idx.shipperName,norm(s.shipper_name),s.shipper_id));
    (masters.shipperAliases||[]).forEach(a=>add(idx.shipperName,norm(a.alias_label),a.shipper_id));
    return idx;
  }

  function resolveShipperAccount(source, idx){
    const code=norm(source&&source.source_shipper_code);
    const a=idx.shipperCode.get(code)||[];
    if(code&&a.length===1)return result('SHIPPER',source.source_shipper_code,a[0],'SHIPPER_ACCOUNT_CODE',1,'OK');
    if(code&&a.length>1)return result('SHIPPER',source.source_shipper_code,null,'SHIPPER_ACCOUNT_CODE',null,'CONFLICT',a);
    return result('SHIPPER',source&&source.source_shipper_code,null,null,null,'UNMATCHED');
  }
  function resolveWorker(source, idx){
    const code=norm(source&&source.employee_code);
    let a=idx.workerCode.get(code)||[];
    if(code&&a.length===1)return result('WORKER',source.employee_code,a[0],'EMPLOYEE_CODE',1,'OK');
    if(code&&a.length>1)return result('WORKER',source.employee_code,null,'EMPLOYEE_CODE',null,'CONFLICT',a);
    const name=source&&source.worker_name, company=source&&source.company_id, center=source&&source.center_id;
    if(name&&company&&center){a=idx.workerNameCompanyCenter.get(key(name,company,center))||[];if(a.length===1)return result('WORKER',name,a[0],'NAME_COMPANY_CENTER',0.95,'OK');if(a.length>1)return result('WORKER',name,null,'NAME_COMPANY_CENTER',null,'CONFLICT',a);}
    if(name&&center){a=idx.workerNameCenter.get(key(name,center))||[];if(a.length===1)return result('WORKER',name,a[0],'NAME_CENTER',0.8,'PROVISIONAL');if(a.length>1)return result('WORKER',name,null,'NAME_CENTER',null,'CONFLICT',a);}
    a=idx.workerName.get(norm(name))||[];
    if(a.length===1)return result('WORKER',name,null,'NAME_ONLY',0.5,'UNMATCHED',a); // 氏名のみでは自動確定しない
    if(a.length>1)return result('WORKER',name,null,'NAME_ONLY',null,'CONFLICT',a);
    return result('WORKER',name,null,null,null,'UNMATCHED');
  }
  function resolveCenter(source,idx){
    let a=idx.centerCode.get(norm(source&&source.center_code))||[];
    if(a.length===1)return result('CENTER',source.center_code,a[0],'CENTER_CODE',1,'OK');
    if(a.length>1)return result('CENTER',source.center_code,null,'CENTER_CODE',null,'CONFLICT',a);
    a=idx.centerName.get(norm(source&&source.center_name))||[];
    if(a.length===1)return result('CENTER',source.center_name,a[0],'CENTER_NAME_OR_ALIAS',0.95,'OK');
    return result('CENTER',(source&&source.center_code)||(source&&source.center_name),null,null,null,a.length?'CONFLICT':'UNMATCHED',a);
  }
  function resolveCompany(source,idx){
    const a=idx.companyName.get(norm(source&&source.company_name))||[];
    if(a.length===1)return result('COMPANY',source.company_name,a[0],'COMPANY_NAME_OR_ALIAS',0.95,'OK');
    return result('COMPANY',source&&source.company_name,null,null,null,a.length?'CONFLICT':'UNMATCHED',a);
  }

  function deriveShipperAccountCodeFromAccounting(r){
    if(!r)return null;
    if(clean(r.shipper_account_source_code)) return clean(r.shipper_account_source_code);
    const b=clean(r.shipper_base_code), c=clean(r.shipper_contract_code);
    return (b||c)?`${b}${c}`:null;
  }

  window.MASTER_RESOLVER=Object.freeze({buildIndexes,resolveShipperAccount,resolveWorker,resolveCenter,resolveCompany,deriveShipperAccountCodeFromAccounting});
})();
