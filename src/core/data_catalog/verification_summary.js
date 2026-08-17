/* ============================================================
   D3-1: Data Verification Summary（読取専用）

   「データ確認」画面が個別SOURCE/STATEを直接集計しないための
   共通サマリー層。DOM/STATE/Storage/Cloudへ一切書き込まない。

   原則：
   - SOURCEがないだけでMISSING_SOURCE/ERRORと断定しない。
     固定チャーター、HEADなし直接完了、0完等の正常パターンがある。
   - 0 と UNKNOWN(null/undefined) を別集計する。
   - PRELIMINARY/CONFIRMED/ESTIMATED等の値確定度と、
     OK/PARTIAL/CONFLICT等のData Qualityを混同しない。
============================================================ */
'use strict';
(function(){
  if(window.__DATA_VERIFICATION_SUMMARY_MODULE_LOADED_20260817__) return;
  window.__DATA_VERIFICATION_SUMMARY_MODULE_LOADED_20260817__=true;

  const DOC_TYPES=Object.freeze(['PL_ACTUAL','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT']);
  const SUBJECT_TYPES=Object.freeze(['PERSON','ORGANIZATION','OPERATION_UNIT','PROCESS','UNKNOWN']);
  const RESOLUTION_STATUSES=Object.freeze(['OK','PROVISIONAL','UNMATCHED','CONFLICT']);

  function arr(v){return Array.isArray(v)?v:[];}
  function obj(v){return v&&typeof v==='object'?v:{};}
  function clean(v){return v==null?'':String(v).trim();}
  function isNumber(v){return typeof v==='number'&&Number.isFinite(v);}
  function countBy(rows,fn,known){
    const out={}; (known||[]).forEach(k=>out[k]=0);
    arr(rows).forEach(r=>{const k=clean(fn(r))||'UNKNOWN';out[k]=(out[k]||0)+1;});
    return out;
  }
  function valueStats(rows,field){
    const out={total_records:0,known_value:0,known_zero:0,unknown:0,sum_known:0};
    arr(rows).forEach(r=>{
      out.total_records++;
      const v=r&&r[field];
      if(v===null||v===undefined){out.unknown++;return;}
      if(isNumber(v)){out.known_value++;out.sum_known+=v;if(v===0)out.known_zero++;return;}
      out.unknown++;
    });
    return out;
  }

  function normalizeSourceStatus(input){
    const explicit=obj(input&&input.source_status);
    const files=arr(input&&input.source_files);
    const batches=arr(input&&input.import_batches);
    const out={};
    DOC_TYPES.forEach(type=>{
      const e=obj(explicit[type]);
      const fs=files.filter(x=>x&&x.document_type===type);
      const bs=batches.filter(x=>x&&x.document_type===type);
      const states=[...new Set(fs.concat(bs).map(x=>x.document_state||x.state).filter(Boolean))];
      out[type]={
        present:e.present!==undefined?!!e.present:(fs.length>0||bs.length>0),
        document_states:Array.isArray(e.document_states)?[...e.document_states]:states,
        file_count:e.file_count!==undefined?e.file_count:fs.length,
        batch_count:e.batch_count!==undefined?e.batch_count:bs.length,
        revision_status:e.revision_status||null,
        current_revision:e.current_revision===undefined?null:e.current_revision,
        note:e.note||null,
      };
    });
    return out;
  }

  function entityCounts(snapshot){
    const entities=obj(snapshot&&snapshot.entities); const counts={};
    ['BUSINESS_SLIP','DELIVERY_ROUTE','DELIVERY_ATTEMPT','ROUTE_WORKER','ROUTE_PAYMENT','SALES_DETAIL','PRODUCT_DETAIL','SOURCE_LINK','RECONCILIATION_RESULT'].forEach(k=>counts[k]=arr(entities[k]).length);
    return counts;
  }

  function summarizeLinks(snapshot){
    const e=obj(snapshot&&snapshot.entities);
    const slips=arr(e.BUSINESS_SLIP), attempts=arr(e.DELIVERY_ATTEMPT), links=arr(e.SOURCE_LINK), recs=arr(e.RECONCILIATION_RESULT);
    const slipWithAttempt=new Set(attempts.map(x=>x&&x.slip_id).filter(Boolean));
    const recStatus=countBy(recs,x=>x&&x.status,['EXACT','SOURCE_VARIANCE','SINGLE_SOURCE']);
    const linkStatus=countBy(links,x=>x&&x.link_status,['EXACT','AGGREGATED','SOURCE_VARIANCE','SINGLE_SOURCE']);
    return {
      business_slip_count:slips.length,
      slips_with_delivery_attempt:[...slipWithAttempt].length,
      slips_without_delivery_attempt:Math.max(0,slips.length-slipWithAttempt.size),
      source_link_count:links.length,
      source_link_status:linkStatus,
      reconciliation_count:recs.length,
      reconciliation_status:recStatus,
      // HEADなし自体は正常ケースがあるためissue_countには含めない。
      headless_is_not_automatically_an_issue:true,
    };
  }

  function summarizeSubjects(snapshot){
    const sales=arr(obj(snapshot&&snapshot.entities).SALES_DETAIL).filter(x=>x&&x.source_document_type==='WORKER_SALES');
    const evaluated=sales.filter(x=>x&&x.subject_resolution_status);
    const typeCounts=countBy(evaluated,x=>x&&x.attribution_subject_type,SUBJECT_TYPES);
    typeCounts.NOT_EVALUATED=sales.length-evaluated.length;
    const statusCounts=countBy(evaluated,x=>x&&x.subject_resolution_status,RESOLUTION_STATUSES);
    statusCounts.NOT_EVALUATED=sales.length-evaluated.length;
    const executed=evaluated.length;
    const resolved=evaluated.filter(x=>x&&['OK','PROVISIONAL'].includes(x.subject_resolution_status)).length;
    return {
      worker_sales_detail_count:sales.length,
      resolution_executed_count:executed,
      resolution_not_executed_count:Math.max(0,sales.length-executed),
      subject_type:typeCounts,
      resolution_status:statusCounts,
      resolved_or_provisional_count:resolved,
      resolution_rate:executed?resolved/executed:null,
    };
  }

  function summarizeValues(snapshot,accountingFacts){
    const e=obj(snapshot&&snapshot.entities);
    return {
      sales_amount:valueStats(e.SALES_DETAIL,'amount'),
      route_payment_amount:valueStats(e.ROUTE_PAYMENT,'amount'),
      accounting_amount:valueStats(accountingFacts,'amount'),
    };
  }

  function summarizeAccounting(accountingFacts,accountingReconciliations){
    const facts=arr(accountingFacts), recs=arr(accountingReconciliations);
    const states=countBy(facts,x=>x&&x.document_state,['PRELIMINARY','CONFIRMED']);
    const statuses=countBy(recs,x=>x&&x.status,['EXACT','ACCOUNTING_VARIANCE','OPERATIONAL_ONLY','ACCOUNTING_ONLY','UNRESOLVED']);
    const hasConfirmed=(states.CONFIRMED||0)>0;
    const hasPreliminary=(states.PRELIMINARY||0)>0;
    let valueStatus='UNKNOWN';
    if(hasConfirmed)valueStatus='CONFIRMED'; else if(hasPreliminary)valueStatus='PRELIMINARY';
    return {
      fact_count:facts.length,
      document_state:states,
      value_status:valueStatus,
      reconciliation_count:recs.length,
      reconciliation_status:statuses,
      confirmed_available:hasConfirmed,
      preliminary_available:hasPreliminary,
    };
  }

  function issueSummary(parts){
    const subject=parts.subject_summary, accounting=parts.accounting_summary, values=parts.value_summary;
    const subjectConflict=(subject.resolution_status.CONFLICT||0);
    const subjectUnmatched=(subject.resolution_status.UNMATCHED||0);
    const unknownValues=(values.sales_amount.unknown||0)+(values.route_payment_amount.unknown||0)+(values.accounting_amount.unknown||0);
    return {
      subject_conflict:subjectConflict,
      subject_unmatched:subjectUnmatched,
      subject_not_evaluated:subject.resolution_not_executed_count||0,
      accounting_unresolved:(accounting.reconciliation_status.UNRESOLVED||0),
      unknown_value_count:unknownValues,
      total_attention_count:subjectConflict+subjectUnmatched+(accounting.reconciliation_status.UNRESOLVED||0)+unknownValues,
      source_absence_not_counted_as_issue:true,
    };
  }

  function observationSummary(parts){
    const link=parts.link_summary, accounting=parts.accounting_summary;
    return {
      source_variance:(link.reconciliation_status.SOURCE_VARIANCE||0),
      single_source:(link.reconciliation_status.SINGLE_SOURCE||0),
      accounting_variance:(accounting.reconciliation_status.ACCOUNTING_VARIANCE||0),
      operational_only:(accounting.reconciliation_status.OPERATIONAL_ONLY||0),
      accounting_only:(accounting.reconciliation_status.ACCOUNTING_ONLY||0),
      note:'差異・片側SOURCEは業務上正常なケースを含み得るため、自動的にData Quality issueへ昇格しない',
    };
  }

  function overall(parts){
    const i=parts.issue_summary, c=parts.entity_counts, a=parts.accounting_summary;
    const anyData=Object.values(c).some(x=>x>0)||a.fact_count>0;
    if(!anyData)return 'NO_DATA';
    if(i.subject_conflict>0)return 'CONFLICT';
    if(i.subject_unmatched>0||i.accounting_unresolved>0||i.unknown_value_count>0)return 'PARTIAL';
    // Resolver未実行はデータ不良ではないが、検証未完了なのでPROVISIONAL。
    if(i.subject_not_evaluated>0)return 'PROVISIONAL';
    if(a.value_status==='PRELIMINARY')return 'PROVISIONAL';
    return 'OK';
  }

  function build(input={}){
    const snapshot=input.canonical_snapshot||input.snapshot||{};
    const accountingFacts=arr(input.accounting_facts);
    const accountingReconciliations=arr(input.accounting_reconciliations);
    const parts={
      center_id:input.center_id||null,
      year_month:input.year_month||null,
      generated_at:new Date().toISOString(),
      source_status:normalizeSourceStatus(input),
      entity_counts:entityCounts(snapshot),
      link_summary:summarizeLinks(snapshot),
      subject_summary:summarizeSubjects(snapshot),
      value_summary:summarizeValues(snapshot,accountingFacts),
      accounting_summary:summarizeAccounting(accountingFacts,accountingReconciliations),
    };
    parts.issue_summary=issueSummary(parts);
    parts.observation_summary=observationSummary(parts);
    parts.overall_status=overall(parts);
    return parts;
  }

  window.DATA_VERIFICATION_SUMMARY=Object.freeze({build,_internal:Object.freeze({normalizeSourceStatus,entityCounts,summarizeLinks,summarizeSubjects,summarizeValues,summarizeAccounting})});
})();
