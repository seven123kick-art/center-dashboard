/* ============================================================
   D2-2: SOURCE Normalizer（読取専用）
   src/core/data_catalog/source_normalizer.js

   目的：
   WORKER_SALES（4.作業者別売上明細表）と
   SHIPPER_AREA（14.荷主別配送エリア物量）のCSV行を、
   既存STATEの集計済み構造を経由せず、明細行単位のSOURCE事実を
   保持した正規化レコードへ変換する。

   重要：
   - 既存parser / STATE / Storage / Cloud / UIは変更しない。
   - 顧客氏名・電話番号・住所全文は本Normalizerの出力へ保持しない。
   - 金額0は有効値。空欄/解釈不能と0を同一視しない。
   - 商品/作業/リサイクル等の業務分類はここでは行わない。
   - source_record_idはD2のメモリ上Snapshot用deterministic keyであり、
     将来の永続SOURCE_RECORD ID仕様ではない。
============================================================ */
'use strict';
(function(){
  if (window.__SOURCE_NORMALIZER_MODULE_LOADED_20260817__) return;
  window.__SOURCE_NORMALIZER_MODULE_LOADED_20260817__ = true;

  function safeString(v){ return (v === null || v === undefined) ? '' : String(v); }
  function clean(v){ return safeString(v).replace(/^\uFEFF/, '').trim(); }
  function normalizeHeader(v){ return clean(v).replace(/[\s　]/g, ''); }
  function normalizeSlipNo(v){
    const raw = clean(v).replace(/\.0$/, '');
    if (!raw) return '';
    if (/^\d+$/.test(raw)) return raw.replace(/^0+/, '') || '0';
    return raw;
  }
  function normalizeDate(v){
    const raw = clean(v).split(/\s+/)[0];
    if (!raw) return '';
    if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    const m = raw.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    return raw;
  }
  function numericOrNull(v){
    const raw = clean(v).replace(/[,，￥¥円\s　]/g, '');
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  function normalizeZip(v){ return clean(v).replace(/[〒\s　\-]/g, '').replace(/[^0-9]/g, ''); }
  function normalizeMatchLabel(v){
    return clean(v).normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();
  }
  function findIndex(header, names, fallback){
    const h = header.map(normalizeHeader);
    const ns = names.map(normalizeHeader);
    const exact = h.findIndex(x => ns.includes(x));
    if (exact >= 0) return exact;
    const partial = h.findIndex(x => ns.some(n => n && x.includes(n)));
    return partial >= 0 ? partial : fallback;
  }
  function sourceRecordId(documentType, meta, rowIndex){
    const filePart = clean(meta && (meta.source_file_id || meta.file_name || meta.fileName)) || 'UNSPECIFIED_FILE';
    return `${documentType}:${filePart}:${rowIndex + 2}`;
  }
  function sourceFileId(meta){
    return clean(meta && meta.source_file_id) || null;
  }
  function centerId(meta){ return clean(meta && meta.center_id) || null; }
  function yearMonth(meta){ return clean(meta && meta.year_month) || null; }

  function normalizeWorkerSalesRows(rows, meta = {}){
    if (!Array.isArray(rows) || !rows.length) return [];
    const header = rows[0] || [];
    const body = rows.slice(1);
    const idx = {
      date: findIndex(header, ['配達完了日','日付','作業日','配送日','計上日'], 0),
      transactionType: findIndex(header, ['伝票区分'], 1),
      slip: findIndex(header, ['原票番号','エスライン原票番号'], 2),
      shipperReference: findIndex(header, ['荷主伝票番号'], 3),
      shipperName: findIndex(header, ['荷主名','荷主名称'], 4),
      storeName: findIndex(header, ['荷主店舗名','店舗名','店名'], 5),
      productName: findIndex(header, ['商品名','商品名型番','品名'], 8),
      companyName: findIndex(header, ['協力会社名','協力会社'], 10),
      workerName: findIndex(header, ['作業者','作業者名','担当者','社員名','氏名'], 11),
      billingType: findIndex(header, ['付帯区分','請求区分','売上区分'], 12),
      workName: findIndex(header, ['作業内容','作業名','内容'], 13),
      unitPrice: findIndex(header, ['単価'], 14),
      quantity: findIndex(header, ['数量'], 15),
      amount: findIndex(header, ['金額','売上金額','請求金額'], 16),
    };
    const out = [];
    body.forEach((r, rowIndex) => {
      if (!Array.isArray(r) || !r.some(c => clean(c))) return;
      const slipNo = normalizeSlipNo(r[idx.slip]);
      if (!slipNo) return;
      out.push({
        document_type: 'WORKER_SALES',
        source_file_id: sourceFileId(meta),
        source_record_id: sourceRecordId('WORKER_SALES', meta, rowIndex),
        source_row_index: rowIndex + 2,
        year_month: yearMonth(meta),
        center_id: centerId(meta),
        delivery_date: normalizeDate(r[idx.date]) || null,
        transaction_type: clean(r[idx.transactionType]) || null,
        slip_no: slipNo,
        shipper_reference_no: clean(r[idx.shipperReference]) || null,
        source_shipper_name: clean(r[idx.shipperName]) || null,
        source_store_name: clean(r[idx.storeName]) || null,
        source_product_name: clean(r[idx.productName]) || null,
        source_worker_company_name: clean(r[idx.companyName]) || null,
        source_worker_name: clean(r[idx.workerName]) || null,
        billing_type: clean(r[idx.billingType]) || null,
        source_work_name: clean(r[idx.workName]) || null,
        unit_price: numericOrNull(r[idx.unitPrice]),
        quantity: numericOrNull(r[idx.quantity]),
        amount: numericOrNull(r[idx.amount]),
      });
    });
    return out;
  }

  function normalizeShipperAreaRows(rows, meta = {}){
    if (!Array.isArray(rows) || !rows.length) return [];
    const header = rows[0] || [];
    const body = rows.slice(1);
    const idx = {
      date: findIndex(header, ['配達完了日','日付','作業日','配送日','完了日'], 0),
      shipperCode: findIndex(header, ['荷主コード','荷主基本コード','荷主CD','荷主ＣＤ'], 1),
      shipperName: findIndex(header, ['荷主名','荷主名称'], 2),
      storeCode: findIndex(header, ['受注店コード','店舗コード','店コード'], 3),
      storeName: findIndex(header, ['店名','店舗名','荷主店舗名'], 4),
      deliveryCenterCode: findIndex(header, ['配達支店コード','配送センターコード','センターコード'], 6),
      deliveryCenterName: findIndex(header, ['配達支店名','配送センター名','センター名'], 7),
      slip: findIndex(header, ['エスライン原票番号','原票番号'], 8),
      shipperReference: findIndex(header, ['荷主伝票番号'], 9),
      zip: findIndex(header, ['お届け先郵便番号','郵便番号'], 11),
      productName: findIndex(header, ['商品名型番','商品名','品名'], 15),
      productCode: findIndex(header, ['コード','商品コード'], 16),
      workName: findIndex(header, ['作業内容','作業名','内容'], 17),
      unitPrice: findIndex(header, ['単価'], 18),
      quantity: findIndex(header, ['数量'], 19),
      amount: findIndex(header, ['金額','売上金額','請求金額'], 20),
      recycleTicketNo: findIndex(header, ['リサイクル券番号'], 21),
      recycleCompletedDate: findIndex(header, ['リサイクル完了日'], 22),
    };
    const out = [];
    body.forEach((r, rowIndex) => {
      if (!Array.isArray(r) || !r.some(c => clean(c))) return;
      const slipNo = normalizeSlipNo(r[idx.slip]);
      if (!slipNo) return;
      out.push({
        document_type: 'SHIPPER_AREA',
        source_file_id: sourceFileId(meta),
        source_record_id: sourceRecordId('SHIPPER_AREA', meta, rowIndex),
        source_row_index: rowIndex + 2,
        year_month: yearMonth(meta),
        center_id: centerId(meta),
        delivery_date: normalizeDate(r[idx.date]) || null,
        slip_no: slipNo,
        source_shipper_code: clean(r[idx.shipperCode]) || null,
        source_shipper_name: clean(r[idx.shipperName]) || null,
        source_store_code: clean(r[idx.storeCode]) || null,
        source_store_name: clean(r[idx.storeName]) || null,
        source_delivery_center_code: clean(r[idx.deliveryCenterCode]) || null,
        source_delivery_center_name: clean(r[idx.deliveryCenterName]) || null,
        shipper_reference_no: clean(r[idx.shipperReference]) || null,
        zip_code: normalizeZip(r[idx.zip]) || null,
        source_product_name: clean(r[idx.productName]) || null,
        source_product_code: clean(r[idx.productCode]) || null,
        source_work_name: clean(r[idx.workName]) || null,
        unit_price: numericOrNull(r[idx.unitPrice]),
        quantity: numericOrNull(r[idx.quantity]),
        amount: numericOrNull(r[idx.amount]),
        recycle_ticket_no: clean(r[idx.recycleTicketNo]) || null,
        recycle_completed_date: normalizeDate(r[idx.recycleCompletedDate]) || null,
      });
    });
    return out;
  }


  /* 配達ヘッド傭車料確認Excelの新データ基盤用Normalizer。
     既存parseHeadPaymentSheetとは独立した読取専用経路で、空欄金額を
     0へ変換しない。削除フラグ行もSOURCE事実として保持する。 */
  function normalizeRoutePaymentRows(rows, meta = {}){
    if (!Array.isArray(rows) || !rows.length) return [];
    const header = rows[0] || [];
    const idx = {
      head: findIndex(header, ['ヘッド番号'], -1),
      date: findIndex(header, ['配達日'], -1),
      company: findIndex(header, ['車両所属コード'], -1),
      worker1: findIndex(header, ['作業者１','作業者1'], -1),
      fee: findIndex(header, ['傭車料'], -1),
      calc: findIndex(header, ['傭車計算区分'], -1),
      toll: findIndex(header, ['通行料'], -1),
      deleted: findIndex(header, ['削除フラグ'], -1),
      confirmed: findIndex(header, ['支払確定済フラグ'], -1),
    };
    if (idx.head < 0 || idx.date < 0 || idx.fee < 0) {
      throw new Error('必要列（ヘッド番号・配達日・傭車料）を確認できません');
    }
    const out=[];
    rows.slice(1).forEach((r,rowIndex)=>{
      if(!Array.isArray(r) || !r.some(c=>clean(c))) return;
      const headNo=clean(r[idx.head]).replace(/\D/g,'');
      const deliveryDate=normalizeDate(r[idx.date]);
      if(!headNo || !deliveryDate) return;
      const deletedRaw=idx.deleted>=0?clean(r[idx.deleted]):'';
      const confirmedRaw=idx.confirmed>=0?clean(r[idx.confirmed]):'';
      out.push({
        document_type:'ROUTE_PAYMENT',
        source_file_id:sourceFileId(meta),
        source_record_id:sourceRecordId('ROUTE_PAYMENT',meta,rowIndex),
        source_row_index:rowIndex+2,
        year_month:yearMonth(meta), center_id:centerId(meta),
        delivery_date:deliveryDate, head_no:headNo,
        source_vehicle_company_code:idx.company>=0?(clean(r[idx.company])||null):null,
        source_worker1_code:idx.worker1>=0?(clean(r[idx.worker1])||null):null,
        payment_amount:numericOrNull(r[idx.fee]),
        toll_amount:idx.toll>=0?numericOrNull(r[idx.toll]):null,
        calc_type:idx.calc>=0?(clean(r[idx.calc])||null):null,
        is_deleted:deletedRaw===''?null:deletedRaw==='1',
        payment_confirmed:confirmedRaw===''?null:confirmedRaw==='1',
      });
    });
    return out;
  }


  function normalizeDeliveryListRoutes(routes, meta = {}){
    const out=[];
    const fileId=sourceFileId(meta);
    (Array.isArray(routes)?routes:[]).forEach((r,routeIndex)=>{
      const headNo=clean(r?.headNumber||r?.head_no).replace(/\.0$/,'');
      const deliveryDate=normalizeDate(r?.date||r?.delivery_date);
      if(!headNo||!deliveryDate) return;
      const slips=[...new Set((Array.isArray(r?.slips)?r.slips:[]).map(normalizeSlipNo).filter(Boolean))];
      const base={
        document_type:'DELIVERY_LIST', source_file_id:fileId,
        year_month:yearMonth(meta)||deliveryDate.replace(/\D/g,'').slice(0,6), center_id:centerId(meta),
        delivery_date:deliveryDate, head_no:headNo,
        source_worker1_label:clean(r?.worker)||null,
        source_page_number:Number.isFinite(Number(r?._source_page))?Number(r._source_page):null,
      };
      if(!slips.length){
        out.push({...base,slip_no:null,source_record_id:`DELIVERY_LIST:${fileId}:${routeIndex+1}:HEAD`,source_row_index:routeIndex+1});
      } else slips.forEach((slipNo,slipIndex)=>out.push({...base,slip_no:slipNo,source_record_id:`DELIVERY_LIST:${fileId}:${routeIndex+1}:${slipIndex+1}`,source_row_index:routeIndex+1}));
    });
    return out;
  }

  window.SOURCE_NORMALIZER = Object.freeze({
    normalizeWorkerSalesRows,
    normalizeShipperAreaRows,
    normalizeRoutePaymentRows,
    normalizeDeliveryListRoutes,
    normalizeSlipNo,
    normalizeDate,
    normalizeMatchLabel,
  });
})();
