/* ============================================================
   D3-5A: Resolution Ledger（永続化前の正本契約）
   ------------------------------------------------------------
   人が確定したResolution Decision / Aliasを、削除・上書きせず
   履歴として扱うためのpure/read-only基盤。

   重要:
   - 本モジュール自身はSTATE / IndexedDB / Storage / Cloud / Supabaseへ書かない。
   - 現行RepositoryにはResolution専用の安全な永続API/DB schemaが存在しないため、
     推測で既存FullStateへ混入させない。
   - D3-5Bで永続先schema/APIを正式に決めた後、このLedgerをRepositoryへ接続する。
============================================================ */
'use strict';
(function(){
  if(window.__RESOLUTION_LEDGER_LOADED_20260817__) return;
  window.__RESOLUTION_LEDGER_LOADED_20260817__=true;
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>v==null?'':String(v).trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function normalizeDecision(d={}){
    return {
      resolution_decision_id:clean(d.resolution_decision_id)||null,
      entity_type:clean(d.entity_type)||null,
      source_value:clean(d.source_value),
      source_document_type:clean(d.source_document_type)||null,
      source_record_id:clean(d.source_record_id)||null,
      selected_master_id:clean(d.selected_master_id)||null,
      effective_date:clean(d.effective_date)||null,
      remember_as_alias:d.remember_as_alias===true,
      decided_at:clean(d.decided_at)||null,
      decided_by:clean(d.decided_by)||null,
      decision_status:clean(d.decision_status)||'ACTIVE',
      revoked_at:clean(d.revoked_at)||null,
      revoked_by:clean(d.revoked_by)||null,
      revoke_reason:clean(d.revoke_reason)||null,
      supersedes_resolution_decision_id:clean(d.supersedes_resolution_decision_id)||null
    };
  }

  function validateDecision(d){
    const x=normalizeDecision(d), errors=[];
    if(!x.resolution_decision_id) errors.push('resolution_decision_idが未設定です');
    if(!x.entity_type) errors.push('entity_typeが未設定です');
    if(!x.source_value) errors.push('source_valueが未設定です');
    if(!x.selected_master_id) errors.push('selected_master_idが未設定です');
    if(!['ACTIVE','REVOKED'].includes(x.decision_status)) errors.push('decision_statusが不正です');
    if(x.decision_status==='REVOKED'&&!x.revoked_at) errors.push('REVOKEDにはrevoked_atが必要です');
    return {ok:errors.length===0,errors,value:x};
  }

  function activeDecisions(decisions){
    const rows=arr(decisions).map(normalizeDecision);
    const byId=new Map(rows.filter(x=>x.resolution_decision_id).map(x=>[x.resolution_decision_id,x]));
    const superseded=new Set(rows.map(x=>x.supersedes_resolution_decision_id).filter(Boolean));
    return rows.filter(x=>x.decision_status==='ACTIVE'&&!superseded.has(x.resolution_decision_id)&&!byId.get(x.resolution_decision_id)?.revoked_at);
  }

  function aliasKey(a={}){
    return [clean(a.entity_type||a.subject_type),clean(a.alias_label),clean(a.source_document_type)].join('|');
  }

  function materializeAliases(decisions, existingAliases=[]){
    const out=new Map(arr(existingAliases).map(x=>[aliasKey(x),clone(x)]));
    for(const d of activeDecisions(decisions)){
      if(!d.remember_as_alias) continue;
      const a={entity_type:d.entity_type,alias_label:d.source_value,master_id:d.selected_master_id,source_document_type:d.source_document_type,status:'ACTIVE',resolution_decision_id:d.resolution_decision_id};
      out.set(aliasKey(a),a);
    }
    return [...out.values()];
  }

  function revoke(decisions,id,meta={}){
    const rows=arr(decisions).map(clone), i=rows.findIndex(x=>clean(x.resolution_decision_id)===clean(id));
    if(i<0) return {ok:false,error:'対象Decisionが見つかりません',decisions:rows};
    if((rows[i].decision_status||'ACTIVE')==='REVOKED') return {ok:false,error:'既にREVOKEDです',decisions:rows};
    rows[i]=Object.assign({},rows[i],{decision_status:'REVOKED',revoked_at:meta.revoked_at||null,revoked_by:meta.revoked_by||null,revoke_reason:meta.revoke_reason||null});
    const v=validateDecision(rows[i]);
    return v.ok?{ok:true,decisions:rows,revoked:v.value}:{ok:false,error:v.errors.join(' / '),decisions:arr(decisions).map(clone)};
  }

  window.RESOLUTION_LEDGER=Object.freeze({normalizeDecision,validateDecision,activeDecisions,materializeAliases,revoke});
})();
