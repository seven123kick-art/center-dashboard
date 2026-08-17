/* ============================================================
   D2-6: Attribution Subject Resolver（読取専用）

   WORKER_SALESの「作業者」欄は人物専用ではなく、売上・支払の
   帰属主体を表す。人物と確定した場合だけMASTER_RESOLVERの
   WORKER解決へ渡す。会社・拠点・処理用コードを架空の作業者
   としてWORKER_MASTERへ登録しない。

   本モジュールはルール/aliasを引数で受ける純粋Resolver。
   2026年6月で確認した個別表記をコードへベタ書きしない。
============================================================ */
'use strict';
(function(){
  if (window.__SUBJECT_RESOLVER_MODULE_LOADED_20260817__) return;
  window.__SUBJECT_RESOLVER_MODULE_LOADED_20260817__ = true;

  const TYPES = Object.freeze({
    PERSON:'PERSON', ORGANIZATION:'ORGANIZATION', OPERATION_UNIT:'OPERATION_UNIT', PROCESS:'PROCESS', UNKNOWN:'UNKNOWN'
  });
  function clean(v){ return v == null ? '' : String(v).trim(); }
  function norm(v){ return clean(v).normalize('NFKC').replace(/[\s　]/g,'').toLowerCase(); }
  function mapOf(list, labelKey, idKey){
    const m=new Map();
    (list||[]).forEach(x=>{
      const k=norm(x&&x[labelKey]); if(!k)return;
      const value=idKey?x[idKey]:x; if(value===null||value===undefined||value==='')return;
      const a=m.get(k)||[];
      // 同じマスタIDが正式名称とAliasの双方から入っても、
      // 同一候補を2件としてCONFLICT扱いしない。
      if(!idKey || !a.includes(value)) a.push(value);
      m.set(k,a);
    });
    return m;
  }
  function buildIndexes(data={}){
    return {
      subjectAlias: mapOf(data.subjectAliases,'alias_label'),
      workerName: mapOf(data.workers,'worker_name','worker_id'),
      companyName: mapOf([...(data.companies||[]),...(data.companyAliases||[]).map(a=>({company_name:a.alias_label,company_id:a.company_id}))],'company_name','company_id'),
      centerName: mapOf([...(data.centers||[]),...(data.centerAliases||[]).map(a=>({center_name:a.alias_label,center_id:a.center_id}))],'center_name','center_id'),
      processLabel: mapOf(data.processes,'process_label','process_code'),
    };
  }
  function result(type,label,opt={}){
    return {subject_type:type,source_subject_label:label||null,resolved_id:opt.resolved_id||null,match_method:opt.match_method||null,match_confidence:opt.match_confidence==null?null:opt.match_confidence,status:opt.status||'UNMATCHED',candidates:opt.candidates||[],worker_resolution:opt.worker_resolution||null};
  }
  function resolve(source={}, indexes=buildIndexes(), masterIndexes=null){
    const label=clean(source.source_subject_label||source.source_worker_name);
    if(!label) return result(TYPES.UNKNOWN,null,{status:'UNMATCHED'});
    const k=norm(label);
    const aliases=indexes.subjectAlias.get(k)||[];
    if(aliases.length===1){
      const a=aliases[0], type=a.subject_type||TYPES.UNKNOWN;
      return result(type,label,{resolved_id:a.subject_id||a.worker_id||a.company_id||a.center_id||a.process_code||null,match_method:'SUBJECT_ALIAS',match_confidence:1,status:'OK'});
    }
    if(aliases.length>1) return result(TYPES.UNKNOWN,label,{match_method:'SUBJECT_ALIAS',status:'CONFLICT',candidates:aliases});

    // PERSON: 名前一致だけでは人物確定しない。既存WORKER Resolverへ候補として渡す。
    const workers=indexes.workerName.get(k)||[];
    if(workers.length){
      let wr=null;
      if(window.MASTER_RESOLVER && masterIndexes){
        wr=window.MASTER_RESOLVER.resolveWorker({worker_name:label,effective_date:source.effective_date,company_name:source.source_subject_company_name||source.source_worker_company_name,center_id:source.center_id},masterIndexes);
      }
      if(wr && wr.resolved_id) return result(TYPES.PERSON,label,{resolved_id:wr.resolved_id,match_method:'WORKER_RESOLUTION',match_confidence:wr.match_confidence,status:wr.status,worker_resolution:wr});
      return result(TYPES.PERSON,label,{match_method:'WORKER_NAME_CANDIDATE',match_confidence:workers.length===1?0.5:null,status:workers.length===1?'PROVISIONAL':'CONFLICT',candidates:workers});
    }

    const companies=indexes.companyName.get(k)||[];
    if(companies.length===1) return result(TYPES.ORGANIZATION,label,{resolved_id:companies[0],match_method:'COMPANY_NAME_OR_ALIAS',match_confidence:.95,status:'OK'});
    if(companies.length>1) return result(TYPES.ORGANIZATION,label,{match_method:'COMPANY_NAME_OR_ALIAS',status:'CONFLICT',candidates:companies});
    const centers=indexes.centerName.get(k)||[];
    if(centers.length===1) return result(TYPES.OPERATION_UNIT,label,{resolved_id:centers[0],match_method:'CENTER_NAME_OR_ALIAS',match_confidence:.95,status:'OK'});
    if(centers.length>1) return result(TYPES.OPERATION_UNIT,label,{match_method:'CENTER_NAME_OR_ALIAS',status:'CONFLICT',candidates:centers});
    const processes=indexes.processLabel.get(k)||[];
    if(processes.length===1) return result(TYPES.PROCESS,label,{resolved_id:processes[0],match_method:'PROCESS_LABEL',match_confidence:1,status:'OK'});
    if(processes.length>1) return result(TYPES.PROCESS,label,{match_method:'PROCESS_LABEL',status:'CONFLICT',candidates:processes});
    return result(TYPES.UNKNOWN,label,{status:'UNMATCHED'});
  }

  window.SUBJECT_RESOLVER=Object.freeze({TYPES,buildIndexes,resolve,normalizeLabel:norm});
})();
