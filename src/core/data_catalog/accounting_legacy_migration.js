/* ============================================================================
   Version6 D4-28: Legacy confirmed Dataset -> PL_ACTUAL migration bridge
   ----------------------------------------------------------------------------
   D3-8導入前に登録済みの確定収支は、現行Datasetには科目別集計値が残る一方、
   NormalizedSourceRepositoryにはPL_ACTUAL batchが存在しない。
   その既存確定値を「原CSV明細の復元」と偽装せず、ACCOUNT_TOTAL粒度の移行記録として
   明示的にNormalizedSourceへ保存する。

   制約:
   - confirmedのみ。
   - 元Datasetの科目別rowsをそのまま使用し、推測・補完しない。
   - source_granularity=ACCOUNT_TOTAL / migration_source=LEGACY_CONFIRMED_DATASET を保持。
   - 原票/HEAD/荷主/社員等は復元不能なのでnull。
============================================================================ */
'use strict';
(function(){
  if(window.ACCOUNTING_LEGACY_MIGRATION)return;
  const clean=v=>String(v??'').trim();
  const finite=v=>typeof v==='number'&&Number.isFinite(v);

  function activeConfirmed(period){
    const ym=clean(period);
    const list=window.Repository?.Dataset?.getActive?.()||[];
    return list.find(d=>d?.ym===ym&&d?.source!=='history'&&(d?.type||'confirmed')==='confirmed')||null;
  }

  function recordsFromDataset(ds){
    if(!ds||!ds.ym||!ds.rows||typeof ds.rows!=='object')return [];
    const keys=[...(window.CONFIG?.INCOME_KEYS||[]),...(window.CONFIG?.EXPENSE_KEYS||[])];
    const unique=[...new Set(keys)];
    const importedAt=ds.importedAt||ds.updatedAt||ds.savedAt||null;
    return unique.filter(k=>Object.prototype.hasOwnProperty.call(ds.rows,k)).map((accountName,i)=>{
      const raw=ds.rows[accountName];
      const amount=finite(raw)?raw:(Number.isFinite(Number(raw))?Number(raw):null);
      return {
        document_type:'PL_ACTUAL',document_state:'CONFIRMED',immutable:true,
        source_file_id:`LEGACY_CONFIRMED_DATASET:${ds.ym}`,
        source_record_id:`PL_ACTUAL:CONFIRMED:LEGACY_DATASET:${ds.ym}:${i+1}`,
        source_row_index:null,year_month:ds.ym,accounting_date:null,
        company_code:null,company_name:null,division_code:null,division_name:null,
        center_code:window.CENTER?.code||window.CENTER?.id||null,center_name:window.CENTER?.name||null,
        account_code:null,account_name:clean(accountName)||null,subaccount_code:null,subaccount_name:null,
        amount,partner_name:null,note:'D4-28 legacy confirmed Dataset migration (account total only)',
        head_no:null,slip_no:null,shipper_base_code:null,shipper_contract_code:null,
        shipper_account_source_code:null,source_shipper_name:null,source_contract_name:null,
        employee_code:null,employee_name:null,source_created_date:null,source_created_time:null,
        source_updated_date:null,source_updated_time:null,
        source_granularity:'ACCOUNT_TOTAL',migration_source:'LEGACY_CONFIRMED_DATASET',
        legacy_imported_at:importedAt
      };
    });
  }

  async function migrateMonth(period){
    const ym=clean(period);
    if(!/^\d{6}$/.test(ym))return {ok:false,skipped:true,error:'INVALID_PERIOD'};
    if(!window.Repository?.NormalizedSource?.loadCurrent||!window.ACCOUNTING_IMPORT_BRIDGE?.persistRecords)
      return {ok:false,skipped:true,error:'DEPENDENCY_UNAVAILABLE'};
    const current=await Repository.NormalizedSource.loadCurrent('PL_ACTUAL',ym);
    if(current?.batch?.batch_id)return {ok:true,skipped:true,reason:'PL_ACTUAL_ALREADY_EXISTS',batch_id:current.batch.batch_id};
    const ds=activeConfirmed(ym);
    if(!ds)return {ok:false,skipped:true,error:'CONFIRMED_DATASET_NOT_FOUND'};
    const records=recordsFromDataset(ds);
    if(!records.length)return {ok:false,skipped:true,error:'ACCOUNT_ROWS_NOT_FOUND'};
    const r=await ACCOUNTING_IMPORT_BRIDGE.persistRecords(records,{
      period:ym,document_state:'CONFIRMED',
      source_file_id:`LEGACY_CONFIRMED_DATASET:${ym}`,
      source_file_names:[ds.fileName||`legacy-confirmed-${ym}`]
    });
    if(r?.ok){
      try{window.ACCOUNTING_PARITY?.invalidate?.(ym);}catch(_e){}
      try{window.CANONICAL_ANALYSIS_READ_MODELS?.invalidate?.(ym);}catch(_e){}
    }
    return Object.assign({},r,{migration_source:'LEGACY_CONFIRMED_DATASET',source_granularity:'ACCOUNT_TOTAL'});
  }

  async function migrateFiscalYear(fiscalYear){
    const months=window.ACCOUNTING_PARITY?.fiscalMonths?.(fiscalYear)||[];
    const results=[];
    for(const ym of months){
      const ds=activeConfirmed(ym);
      if(!ds){results.push({period:ym,ok:false,skipped:true,error:'CONFIRMED_DATASET_NOT_FOUND'});continue;}
      try{results.push(Object.assign({period:ym},await migrateMonth(ym)));}
      catch(e){results.push({period:ym,ok:false,error:e?.message||String(e)});}
    }
    return {ok:results.every(x=>x.ok||x.skipped),fiscalYear:String(fiscalYear),results};
  }

  window.ACCOUNTING_LEGACY_MIGRATION=Object.freeze({activeConfirmed,recordsFromDataset,migrateMonth,migrateFiscalYear});
})();