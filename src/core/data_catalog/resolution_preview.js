/* ============================================================
   D3-4: Resolution Preview（読取専用）
   既存マスタを新Resolver用の参照形へ変換し、帰属主体の候補と
   「保存した場合に作られる決定/Alias案」をプレビューする。
   STATE / Master / Alias / Storage / Cloud への書込みは行わない。
============================================================ */
'use strict';
(function(){
  if(window.__RESOLUTION_PREVIEW_LOADED_20260817__) return;
  window.__RESOLUTION_PREVIEW_LOADED_20260817__=true;
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>v==null?'':String(v).trim();

  function legacyMasterData(input={}){
    const workers=arr(input.workers).filter(x=>x&&x.analysisTarget!==false&&clean(x.workerName)).map(x=>({
      worker_id:clean(x.workerCode)||`LEGACY_WORKER_${clean(x.workerName)}`,
      employee_code:clean(x.workerCode)||null,
      worker_name:clean(x.workerName)
    }));
    const companies=arr(input.companies).filter(x=>x&&x.active!==false&&clean(x.companyName)).map(x=>({
      company_id:clean(x.companyCode)||`LEGACY_COMPANY_${clean(x.companyName)}`,
      company_name:clean(x.companyName)
    }));
    const center=input.center&&clean(input.center.name||input.center.centerName)?[{center_id:clean(input.center.id||input.center.code||input.center.centerCode)||'CURRENT_CENTER',center_name:clean(input.center.name||input.center.centerName)}]:[];
    return {workers,companies,centers:center,workerAssignments:[],workerAliases:[],companyAliases:[],centerAliases:[],subjectAliases:[],processes:[]};
  }

  function buildContext(input={}){
    const masterData=input.masterData||legacyMasterData(input);
    const decisions=arr(input.resolutionDecisions);
    const persistedAliases=window.RESOLUTION_LEDGER?.materializeAliases?.(decisions,masterData.subjectAliases||[])||arr(masterData.subjectAliases);
    const subjectData=Object.assign({},masterData,{subjectAliases:persistedAliases});
    return {
      masterData,
      subjectData,
      resolutionDecisions:decisions,
      subjectIndexes:window.SUBJECT_RESOLVER?.buildIndexes?.(subjectData)||null,
      masterIndexes:window.MASTER_RESOLVER?.buildIndexes?.(masterData)||null
    };
  }

  function resolveLabel(input={},context=buildContext()){
    const label=clean(input.source_label||input.source_subject_label);
    if(!window.SUBJECT_RESOLVER) return {source_label:label,status:'NOT_EVALUATED',subject_type:null,resolved_id:null,match_method:null,match_confidence:null,candidates:[],preview:null};
    const r=window.SUBJECT_RESOLVER.resolve({source_subject_label:label,source_subject_company_name:clean(input.source_company)||null,center_id:input.center_id||null,effective_date:input.effective_date||null},context.subjectIndexes,context.masterIndexes);
    const candidateIds=[...new Set([...(arr(r.candidates)),...(r.resolved_id?[r.resolved_id]:[])].filter(Boolean))];
    let preview=null;
    if(r.resolved_id&&window.MASTER_RESOLVER?.makeResolutionDecision){
      const p=window.MASTER_RESOLVER.makeResolutionDecision({entity_type:r.subject_type,source_value:label,source_document_type:'WORKER_SALES',source_record_id:input.source_record_id||null,selected_master_id:r.resolved_id,effective_date:input.effective_date||null,remember_as_alias:true,decided_at:null,decided_by:null});
      preview=p.ok?{decision:Object.assign({},p.decision,{resolution_decision_id:'(保存時に採番)',decided_at:'(保存時)',decided_by:'(保存時)'}),alias_proposal:p.alias_proposal}:null;
    }
    return {source_label:label,status:r.status,subject_type:r.subject_type,resolved_id:r.resolved_id,match_method:r.match_method,match_confidence:r.match_confidence,candidates:candidateIds,preview};
  }

  function build(input={}){
    const context=input.context||buildContext(input);
    const rows=arr(input.labels).map(x=>Object.assign({},x,{resolution:resolveLabel(x,context)}));
    return Object.freeze({rows,context,read_only:true});
  }
  window.RESOLUTION_PREVIEW=Object.freeze({legacyMasterData,buildContext,resolveLabel,build});
})();
