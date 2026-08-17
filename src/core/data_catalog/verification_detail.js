/* ============================================================
   D3-3: Data Verification Detail（読取専用）
   DATA_VERIFICATION_SUMMARY の件数から掘り下げる詳細データを統一生成する。
   保存・自動解決は行わない。
============================================================ */
'use strict';
(function(){
  if(window.__DATA_VERIFICATION_DETAIL_LOADED_20260817__) return;
  window.__DATA_VERIFICATION_DETAIL_LOADED_20260817__=true;
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>v==null?'':String(v).trim();
  const finite=v=>typeof v==='number'&&Number.isFinite(v);

  function subjectDetails(snapshot){
    return arr(snapshot?.entities?.SALES_DETAIL)
      .filter(x=>x&&x.source_document_type==='WORKER_SALES')
      .filter(x=>!x.subject_resolution_status||['UNMATCHED','CONFLICT'].includes(x.subject_resolution_status))
      .map(x=>({
        category:'SUBJECT', status:x.subject_resolution_status||'NOT_EVALUATED',
        slip_no:x.slip_no||null, source_label:x.source_subject_label||null,
        source_company:x.source_subject_company_name||null,
        subject_type:x.attribution_subject_type||null, candidates:arr(x.subject_resolution_candidates),
        source_record_id:x.source_record_id||null
      }));
  }
  function valueDetails(snapshot){
    const out=[];
    arr(snapshot?.entities?.SALES_DETAIL).forEach(x=>{if(x&&x.amount==null)out.push({category:'VALUE',status:'UNKNOWN',entity:'SALES_DETAIL',slip_no:x.slip_no||null,head_no:null,source_label:x.source_subject_label||null});});
    arr(snapshot?.entities?.ROUTE_PAYMENT).forEach(x=>{if(x&&x.amount==null)out.push({category:'VALUE',status:x.absence_status||'UNKNOWN',entity:'ROUTE_PAYMENT',slip_no:null,head_no:x.head_no||null,source_label:null});});
    return out;
  }
  function reconciliationDetails(snapshot){
    return arr(snapshot?.entities?.RECONCILIATION_RESULT)
      .filter(x=>x&&x.status&&x.status!=='EXACT')
      .map(x=>({category:'RECONCILIATION',status:x.status,metric:x.metric||null,target_id:x.target_id||null,left_value:finite(x.left_value)?x.left_value:null,right_value:finite(x.right_value)?x.right_value:null,difference:finite(x.difference)?x.difference:null}));
  }
  function headlessDetails(snapshot){
    const e=snapshot?.entities||{}, attempts=new Set(arr(e.DELIVERY_ATTEMPT).map(x=>x?.slip_id).filter(Boolean));
    return arr(e.BUSINESS_SLIP).filter(x=>x?.slip_id&&!attempts.has(x.slip_id)).map(x=>({category:'HEADLESS',status:'OBSERVATION',slip_no:x.slip_no||null,slip_id:x.slip_id}));
  }

  function canonicalWorkerLabels(snapshot){
    const map=new Map();
    arr(snapshot?.entities?.SALES_DETAIL).filter(x=>x?.source_document_type==='WORKER_SALES').forEach(x=>{
      const label=clean(x.source_subject_label); if(!label)return;
      const old=map.get(label)||{source_label:label,slip_ids:new Set(),amount:0,known_amount_rows:0};
      if(x.slip_id) old.slip_ids.add(x.slip_id);
      if(finite(x.amount)){old.amount+=x.amount;old.known_amount_rows++;}
      map.set(label,old);
    });
    return [...map.values()].map(x=>({source_label:x.source_label,slip_count:x.slip_ids.size,amount:x.amount,known_amount_rows:x.known_amount_rows})).sort((a,b)=>b.slip_count-a.slip_count||a.source_label.localeCompare(b.source_label,'ja'));
  }

  function legacyWorkerLabels(workerCsvData,ym){
    const map=new Map();
    arr(workerCsvData).filter(x=>x?.ym===ym).forEach(month=>Object.values(month.workers||{}).forEach(w=>{
      const label=clean(w?.name); if(!label)return;
      const old=map.get(label)||{source_label:label,slip_count:0,amount:0};
      old.slip_count+=Number(w?.slipCount??w?.rows??0)||0;
      old.amount+=Number(w?.includedAmount??w?.amount??0)||0;
      map.set(label,old);
    }));
    return [...map.values()].sort((a,b)=>b.slip_count-a.slip_count||a.source_label.localeCompare(b.source_label,'ja'));
  }
  function build(input={}){
    const snapshot=input.canonical_snapshot||input.snapshot||{};
    const canonicalLabels=canonicalWorkerLabels(snapshot);
    const labels=canonicalLabels.length?canonicalLabels:legacyWorkerLabels(input.worker_csv_data,input.year_month);
    const resolutionPreview=window.RESOLUTION_PREVIEW?.build?.({labels,context:input.resolution_context})||null;
    return Object.freeze({
      center_id:input.center_id||null,year_month:input.year_month||null,generated_at:new Date().toISOString(),
      subject_attention:subjectDetails(snapshot), value_attention:valueDetails(snapshot),
      reconciliation_observations:reconciliationDetails(snapshot), headless_observations:headlessDetails(snapshot),
      worker_labels:labels, worker_labels_source:canonicalLabels.length?'CANONICAL_NORMALIZED':'LEGACY_FALLBACK', resolution_preview:resolutionPreview,
      read_only:true
    });
  }
  window.DATA_VERIFICATION_DETAIL=Object.freeze({build});
})();
