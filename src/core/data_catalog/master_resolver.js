/* ============================================================
   D2-5: Master Resolver（読取専用・所属履歴対応）
   CENTER / COMPANY / WORKER / SHIPPER_ACCOUNT の照合に加え、
   WORKER_ASSIGNMENT の有効期間から「業務発生日当時の所属」を解決する。

   原則：
   - 人物の同定と所属履歴の解決を分離する。
   - employee_code は人物同定の強いキー。
   - 会社/センターは現在値ではなく effective_date 時点の履歴を使う。
   - 同一時点で異なる会社への複数所属は CONFLICT。
   - 同一会社内の複数センター候補は会社を確定してもセンターを推測しない。
   - 人が未照合を解決しても、このモジュールはDB/STATE/Aliasへ書き込まない。
============================================================ */
'use strict';
(function(){
  if (window.__MASTER_RESOLVER_MODULE_LOADED_20260817__) return;
  window.__MASTER_RESOLVER_MODULE_LOADED_20260817__ = true;

  const clean=v=>(v==null?'':String(v)).trim();
  const norm=v=>clean(v).replace(/[\s　]/g,'').toUpperCase();
  const key=(...xs)=>xs.map(norm).join('|');

  function result(entityType, sourceValue, resolvedId, method, confidence, status, candidates=[], extra={}){
    return Object.assign({
      entity_type:entityType,
      source_value:sourceValue==null?'':String(sourceValue),
      normalized_value:norm(sourceValue),
      resolved_id:resolvedId||null,
      match_method:method||null,
      match_confidence:confidence==null?null:confidence,
      status:status||'UNMATCHED',
      candidate_ids:candidates
    }, extra);
  }
  function add(map,k,id){ if(!k||!id)return; const a=map.get(k)||[]; if(!a.includes(id))a.push(id); map.set(k,a); }

  function isoDate(v){
    const s=clean(v);
    if(!s)return null;
    const m=s.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})$/);
    if(!m)return null;
    return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  }
  function activeOn(a,date){
    const d=isoDate(date); if(!d)return false;
    const from=isoDate(a&&a.valid_from), to=isoDate(a&&a.valid_to);
    return (!from||from<=d)&&(!to||d<=to);
  }

  function buildIndexes(masters={}){
    const idx={
      centerCode:new Map(),centerName:new Map(),companyName:new Map(),
      workerCode:new Map(),workerName:new Map(),workerAlias:new Map(),
      shipperCode:new Map(),shipperName:new Map(), assignmentsByWorker:new Map()
    };
    (masters.centers||[]).forEach(x=>{add(idx.centerCode,norm(x.center_code),x.center_id);add(idx.centerName,norm(x.center_name),x.center_id);});
    (masters.centerAliases||[]).forEach(x=>add(idx.centerName,norm(x.alias_label),x.center_id));
    (masters.companies||[]).forEach(x=>add(idx.companyName,norm(x.company_name),x.company_id));
    (masters.companyAliases||[]).forEach(x=>add(idx.companyName,norm(x.alias_label),x.company_id));
    (masters.workers||[]).forEach(w=>{add(idx.workerCode,norm(w.employee_code),w.worker_id);add(idx.workerName,norm(w.worker_name),w.worker_id);});
    (masters.workerAliases||[]).forEach(a=>{add(idx.workerAlias,norm(a.alias_label),a.worker_id);add(idx.workerName,norm(a.alias_label),a.worker_id);});
    (masters.workerAssignments||[]).forEach(a=>{ if(!a||!a.worker_id)return; const xs=idx.assignmentsByWorker.get(a.worker_id)||[]; xs.push(a); idx.assignmentsByWorker.set(a.worker_id,xs); });
    (masters.shipperAccounts||[]).forEach(a=>add(idx.shipperCode,norm(a.source_shipper_code),a.shipper_account_id));
    (masters.shippers||[]).forEach(s=>add(idx.shipperName,norm(s.shipper_name),s.shipper_id));
    (masters.shipperAliases||[]).forEach(a=>add(idx.shipperName,norm(a.alias_label),a.shipper_id));
    return idx;
  }

  function resolveAssignment(workerId,effectiveDate,idx,source={}){
    const all=(idx.assignmentsByWorker.get(workerId)||[]);
    const d=isoDate(effectiveDate);
    if(!d) return {status:'UNMATCHED',match_method:null,worker_id:workerId,company_id:null,center_id:null,assignment_id:null,effective_date:null,candidate_assignment_ids:all.map(a=>a.worker_assignment_id).filter(Boolean),reason:'EFFECTIVE_DATE_REQUIRED'};
    const active=all.filter(a=>activeOn(a,d));
    if(!active.length) return {status:'UNMATCHED',match_method:'ASSIGNMENT_DATE',worker_id:workerId,company_id:null,center_id:null,assignment_id:null,effective_date:d,candidate_assignment_ids:[],reason:'NO_ACTIVE_ASSIGNMENT'};

    const companies=[...new Set(active.map(a=>a.company_id).filter(Boolean))];
    if(companies.length>1) return {status:'CONFLICT',match_method:'ASSIGNMENT_DATE',worker_id:workerId,company_id:null,center_id:null,assignment_id:null,effective_date:d,candidate_assignment_ids:active.map(a=>a.worker_assignment_id).filter(Boolean),reason:'MULTIPLE_ACTIVE_COMPANIES'};

    const companyId=companies[0]||null;
    const sourceCenter=clean(source.center_id);
    let candidates=active;
    if(sourceCenter){
      const exact=active.filter(a=>clean(a.center_id)===sourceCenter);
      if(exact.length)candidates=exact;
    }
    const centers=[...new Set(candidates.map(a=>a.center_id).filter(Boolean))];
    const centerId=centers.length===1?centers[0]:null;
    const assignmentId=candidates.length===1?(candidates[0].worker_assignment_id||null):null;
    return {
      status:centerId||assignmentId?'OK':'PROVISIONAL', match_method:sourceCenter&&centerId?'ASSIGNMENT_DATE_CENTER':'ASSIGNMENT_DATE',
      worker_id:workerId,company_id:companyId,center_id:centerId,assignment_id:assignmentId,effective_date:d,
      candidate_assignment_ids:candidates.map(a=>a.worker_assignment_id).filter(Boolean),
      reason:centers.length>1?'MULTIPLE_ACTIVE_CENTERS_SAME_COMPANY':null
    };
  }

  function resolveShipperAccount(source, idx){
    const code=norm(source&&source.source_shipper_code), a=idx.shipperCode.get(code)||[];
    if(code&&a.length===1)return result('SHIPPER',source.source_shipper_code,a[0],'SHIPPER_ACCOUNT_CODE',1,'OK');
    if(code&&a.length>1)return result('SHIPPER',source.source_shipper_code,null,'SHIPPER_ACCOUNT_CODE',null,'CONFLICT',a);
    return result('SHIPPER',source&&source.source_shipper_code,null,null,null,'UNMATCHED');
  }

  function resolveWorkerIdentity(source,idx){
    const code=norm(source&&source.employee_code); let a=idx.workerCode.get(code)||[];
    if(code&&a.length===1)return result('WORKER',source.employee_code,a[0],'EMPLOYEE_CODE',1,'OK');
    if(code&&a.length>1)return result('WORKER',source.employee_code,null,'EMPLOYEE_CODE',null,'CONFLICT',a);
    const name=source&&source.worker_name; a=idx.workerName.get(norm(name))||[];
    if(a.length===1){
      const isAlias=(idx.workerAlias.get(norm(name))||[]).includes(a[0]);
      return result('WORKER',name,a[0],isAlias?'WORKER_ALIAS':'NAME_ONLY',isAlias?0.95:0.5,isAlias?'OK':'PROVISIONAL',a);
    }
    if(a.length>1)return result('WORKER',name,null,'NAME_ONLY',null,'CONFLICT',a);
    return result('WORKER',name,null,null,null,'UNMATCHED');
  }

  function resolveWorker(source,idx){
    const identity=resolveWorkerIdentity(source,idx);
    if(!identity.resolved_id) return identity;
    const effectiveDate=source&&source.effective_date;
    if(!effectiveDate){
      // 人物同定はできても、所属会社/センターを日付なしで推測しない。
      return Object.assign({},identity,{assignment:null});
    }
    const assignment=resolveAssignment(identity.resolved_id,effectiveDate,idx,source||{});
    const status=assignment.status==='CONFLICT'?'CONFLICT':identity.status;
    return Object.assign({},identity,{status,assignment});
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

  function makeResolutionDecision(input={}){
    const entityType=clean(input.entity_type), sourceValue=input.source_value==null?'':String(input.source_value), selected=clean(input.selected_master_id);
    if(!entityType||!selected) return {ok:false,errors:['entity_typeとselected_master_idは必須です'],decision:null,alias_proposal:null};
    const id=`RESOLUTION_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const decision={resolution_decision_id:id,entity_type:entityType,source_value:sourceValue,source_document_type:clean(input.source_document_type)||null,source_record_id:clean(input.source_record_id)||null,selected_master_id:selected,effective_date:isoDate(input.effective_date),remember_as_alias:input.remember_as_alias===true,decided_at:clean(input.decided_at)||null,decided_by:clean(input.decided_by)||null};
    const aliasProposal=decision.remember_as_alias&&sourceValue?{entity_type:entityType,master_id:selected,alias_label:sourceValue,source_document_type:decision.source_document_type,status:'PROPOSED'}:null;
    return {ok:true,errors:[],decision,alias_proposal:aliasProposal};
  }

  window.MASTER_RESOLVER=Object.freeze({buildIndexes,resolveAssignment,resolveWorkerIdentity,resolveShipperAccount,resolveWorker,resolveCenter,resolveCompany,deriveShipperAccountCodeFromAccounting,makeResolutionDecision});
})();
