/* ============================================================
   D2-3: Accounting SOURCE Normalizer（読取専用）
   SKDL0002 / SKDL0003 の明細行を、既存STATEを変更せず
   ACCOUNTING_SOURCE_RECORDへ正規化する。
============================================================ */
'use strict';
(function(){
  if (window.__ACCOUNTING_NORMALIZER_MODULE_LOADED_20260817__) return;
  window.__ACCOUNTING_NORMALIZER_MODULE_LOADED_20260817__ = true;

  function clean(v){ return (v == null ? '' : String(v)).replace(/^\uFEFF/, '').trim(); }
  function nh(v){ return clean(v).replace(/[\s　]/g, ''); }
  function num(v){ const s=clean(v).replace(/[,，￥¥円\s　]/g,''); if(s==='') return null; const n=Number(s); return Number.isFinite(n)?n:null; }
  function date(v){ const s=clean(v); if(/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; return s || null; }
  function idnum(v){ const s=clean(v).replace(/\.0$/,''); if(!s) return null; return /^\d+$/.test(s) ? (s.replace(/^0+/,'')||'0') : s; }
  function idx(header, name){ const n=nh(name), h=header.map(nh); return h.findIndex(x=>x===n); }
  function sourceId(meta,rowIndex,state){ const f=clean(meta.source_file_id||meta.file_name||meta.fileName)||'UNSPECIFIED_FILE'; return `PL_ACTUAL:${state}:${f}:${rowIndex+2}`; }

  function normalizeRows(rows, meta={}){
    if(!Array.isArray(rows)||rows.length<2) return [];
    const h=rows[0]||[];
    const required=['計上支店コード','計上日','収支科目コード','収支科目名','金額'];
    const missing=required.filter(x=>idx(h,x)<0);
    if(missing.length) throw new Error(`PL_ACTUALの必須列がありません: ${missing.join(', ')}`);
    const state=clean(meta.document_state||meta.state).toUpperCase();
    if(state!=='PRELIMINARY'&&state!=='CONFIRMED') throw new Error('document_stateはPRELIMINARYまたはCONFIRMEDを指定してください');
    const col={
      companyCode:idx(h,'計上会社コード'), companyName:idx(h,'計上会社名'),
      divisionCode:idx(h,'計上本部コード'), divisionName:idx(h,'計上本部名'),
      centerCode:idx(h,'計上支店コード'), centerName:idx(h,'計上支店名'), date:idx(h,'計上日'),
      accountCode:idx(h,'収支科目コード'), accountName:idx(h,'収支科目名'),
      subCode:idx(h,'収支補助科目コード'), subName:idx(h,'収支補助科目名'), amount:idx(h,'金額'),
      partner:idx(h,'取引先'), note:idx(h,'備考'), head:idx(h,'ヘッド番号'), slip:idx(h,'原票番号'),
      shipperBase:idx(h,'荷主基本コード'), shipperContract:idx(h,'荷主契約コード'),
      shipperName:idx(h,'荷主名'), contractName:idx(h,'契約名'), employeeCode:idx(h,'社員コード'), employeeName:idx(h,'社員名'),
      createdDate:idx(h,'作成日'), createdTime:idx(h,'作成時刻'), updatedDate:idx(h,'更新日'), updatedTime:idx(h,'更新時刻')
    };
    const get=(r,k)=>col[k]>=0?clean(r[col[k]]):'';
    const out=[];
    rows.slice(1).forEach((r,i)=>{
      if(!Array.isArray(r)||!r.some(x=>clean(x))) return;
      const amount=col.amount>=0?num(r[col.amount]):null;
      out.push({
        document_type:'PL_ACTUAL', document_state:state, immutable:state==='CONFIRMED',
        source_file_id:clean(meta.source_file_id)||null, source_record_id:sourceId(meta,i,state), source_row_index:i+2,
        year_month:clean(meta.year_month)||null,
        accounting_date:date(get(r,'date')), company_code:get(r,'companyCode')||null, company_name:get(r,'companyName')||null,
        division_code:get(r,'divisionCode')||null, division_name:get(r,'divisionName')||null,
        center_code:get(r,'centerCode')||null, center_name:get(r,'centerName')||null,
        account_code:get(r,'accountCode')||null, account_name:get(r,'accountName')||null,
        subaccount_code:get(r,'subCode')||null, subaccount_name:get(r,'subName')||null,
        amount, partner_name:get(r,'partner')||null, note:get(r,'note')||null,
        head_no:idnum(get(r,'head')), slip_no:idnum(get(r,'slip')),
        shipper_base_code:get(r,'shipperBase')||null, shipper_contract_code:get(r,'shipperContract')||null,
        shipper_account_source_code:(get(r,'shipperBase')||get(r,'shipperContract')) ? `${get(r,'shipperBase')}${get(r,'shipperContract')}` : null,
        source_shipper_name:get(r,'shipperName')||null, source_contract_name:get(r,'contractName')||null,
        employee_code:get(r,'employeeCode')||null, employee_name:get(r,'employeeName')||null,
        source_created_date:date(get(r,'createdDate')), source_created_time:get(r,'createdTime')||null,
        source_updated_date:date(get(r,'updatedDate')), source_updated_time:get(r,'updatedTime')||null,
      });
    });
    return out;
  }

  window.ACCOUNTING_NORMALIZER=Object.freeze({normalizeRows});
})();
