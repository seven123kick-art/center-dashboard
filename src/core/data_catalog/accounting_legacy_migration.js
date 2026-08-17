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
  function batchId(period){
    const suffix=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')?globalThis.crypto.randomUUID().replace(/-/g,''):`${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    return `PL_ACTUAL_CONFIRMED_${period}_LEGACY_${suffix}`;
  }

  function activeConfirmed(period){
    const ym=clean(period);
    const list=window.Repository?.Dataset?.getAll?.()||[];
    return list.find(d=>d?.ym===ym&&d?.source!=='history'&&(d?.type||'confirmed')==='confirmed')||null;
  }

  function recordsFromDataset(ds){
    if(!ds||!ds.ym||!ds.rows||typeof ds.rows!=='object')return [];
    // app.jsのCONFIGはtop-level const（global lexical binding）でありwindow.CONFIGではない。
    // processDataset()と同じ正式な収入・費用キーを参照する。
    const cfg=(typeof CONFIG!=='undefined'&&CONFIG)?CONFIG:null;
    const keys=[...(cfg?.INCOME_KEYS||[]),...(cfg?.EXPENSE_KEYS||[])];
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
    if(!/^\d{6}$/.test(ym))return {ok:false,error:'INVALID_PERIOD',period:ym};
    if(!window.Repository?.NormalizedSource?.loadCurrent||!window.Repository?.NormalizedSource?.saveBatch)
      return {ok:false,error:'NORMALIZED_SOURCE_REPOSITORY_UNAVAILABLE',period:ym};

    // Always verify CURRENT from Cloud manifest before deciding that migration is unnecessary.
    const before=await Repository.NormalizedSource.loadCurrent('PL_ACTUAL',ym,{preferCache:false});
    if(!before?.ok)return {ok:false,error:before?.error||'PL_ACTUAL_CURRENT_READ_FAILED',period:ym,stage:'READ_BEFORE'};
    if(before?.batch?.batch_id){
      return {ok:true,skipped:true,reason:'PL_ACTUAL_ALREADY_EXISTS',period:ym,batch_id:before.batch.batch_id,verified_readback:true};
    }

    const ds=activeConfirmed(ym);
    if(!ds)return {ok:false,error:'CONFIRMED_DATASET_NOT_FOUND',period:ym};
    const records=recordsFromDataset(ds);
    if(!records.length){
      const cfg=(typeof CONFIG!=='undefined'&&CONFIG)?CONFIG:null;
      return {ok:false,error:cfg?'ACCOUNT_ROWS_NOT_FOUND':'ACCOUNT_CONFIG_UNAVAILABLE',period:ym,
        dataset_row_count:(ds?.rows&&typeof ds.rows==='object')?Object.keys(ds.rows).length:0};
    }

    const id=batchId(ym);
    const saved=await Repository.NormalizedSource.saveBatch({
      document_type:'PL_ACTUAL',period:ym,batch_id:id,
      source_file_id:`LEGACY_CONFIRMED_DATASET:${ym}`,
      records,
      meta:{
        document_state:'CONFIRMED',
        source_file_names:[ds.fileName||`legacy-confirmed-${ym}`],
        imported_at:new Date().toISOString(),
        migration_source:'LEGACY_CONFIRMED_DATASET',
        source_granularity:'ACCOUNT_TOTAL'
      }
    });
    if(!saved?.ok){
      return {ok:false,error:saved?.error||'NORMALIZED_SAVE_FAILED',period:ym,stage:'SAVE',save_result:saved||null};
    }

    // D4-29: save success is NOT migration success. Read CURRENT back from Cloud.
    const after=await Repository.NormalizedSource.loadCurrent('PL_ACTUAL',ym,{preferCache:false});
    const readId=after?.batch?.batch_id||null;
    const manifestId=after?.manifest?.current_batch_id||null;
    const readRows=Array.isArray(after?.records)?after.records:[];
    if(!after?.ok||readId!==saved.batch_id||manifestId!==saved.batch_id||!readRows.length){
      return {
        ok:false,error:'NORMALIZED_READBACK_VERIFICATION_FAILED',period:ym,stage:'READ_AFTER',
        expected_batch_id:saved.batch_id,read_batch_id:readId,manifest_current_batch_id:manifestId,
        read_record_count:readRows.length
      };
    }
    const confirmed=readRows.every(r=>r?.document_state==='CONFIRMED');
    const migrated=readRows.every(r=>r?.migration_source==='LEGACY_CONFIRMED_DATASET'&&r?.source_granularity==='ACCOUNT_TOTAL');
    if(!confirmed||!migrated){
      return {ok:false,error:'NORMALIZED_READBACK_CONTENT_INVALID',period:ym,stage:'VERIFY_CONTENT',batch_id:readId,confirmed,migrated};
    }

    try{window.ACCOUNTING_PARITY?.invalidate?.(ym);}catch(_e){}
    try{window.CANONICAL_ANALYSIS_READ_MODELS?.invalidate?.(ym);}catch(_e){}
    return {
      ok:true,period:ym,batch_id:readId,record_count:readRows.length,
      migration_source:'LEGACY_CONFIRMED_DATASET',source_granularity:'ACCOUNT_TOTAL',
      verified_readback:true
    };
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
    return {ok:results.every(x=>x.ok===true),fiscalYear:String(fiscalYear),results,failed:results.filter(x=>x.ok!==true)};
  }

  window.ACCOUNTING_LEGACY_MIGRATION=Object.freeze({activeConfirmed,recordsFromDataset,migrateMonth,migrateFiscalYear});
})();