/* ============================================================
   D1: Data Contract
   src/core/data_catalog/contract.js

   目的：
   SOURCE / NORMALIZED / CANONICAL という将来の3層構造を、
   DBスキーマ・IndexedDB schema・Supabase schemaには一切触れず、
   JavaScript上の「契約定義＋軽量validation」として表現する。

   重要な原則：
   - 本ファイルはSTATE/IndexedDB/Supabaseへ何も保存しない。
   - 既存routeData等を、この形式へ変換して保存する処理は含まない。
   - ROUTE_WORKERは、配送便に複数作業者（複数所属会社）が
     同乗し得るという業務事実を踏まえ、DELIVERY_ROUTEとの
     1対多を前提とした構造にする（worker_idをROUTE直下の単一
     フィールドとして固定しない）。
============================================================ */
'use strict';
(function(){
  if (window.__DATA_CONTRACT_MODULE_LOADED_20260816__) return;
  window.__DATA_CONTRACT_MODULE_LOADED_20260816__ = true;

  /* ---------- 共通ヘルパー：フィールド定義の最小記述 ----------
     各フィールドは { required, type, note } の形で記述する。
     typeは厳密なスキーマ強制のためではなく、将来の実装者への
     ドキュメントとして最小限の意味を持たせる。 */
  function field(type, required, note) {
    return { type, required: !!required, note: note || null };
  }

  /* ============================================================
     SOURCE層：取り込んだファイル・レコード・バッチそのもの
  ============================================================ */
  const SOURCE_FILE = {
    entity: 'SOURCE_FILE',
    layer: 'SOURCE',
    fields: {
      source_file_id: field('string', true, 'このファイル取込を一意に識別するID（D1時点では採番方式は未確定）'),
      document_type: field('string', true, 'DATA_CATALOGのdocument_typeのいずれか'),
      file_name: field('string', true),
      file_extension: field('string', true),
      imported_at: field('string', true, 'ISO8601文字列'),
      center_id: field('string', false, 'D1時点ではUNSPECIFIED。センター判定ロジックが既存コード上に確認できていないため'),
      year_month: field('string', false),
      import_batch_id: field('string', false, 'IMPORT_BATCHへの参照（任意）'),
    },
  };

  const SOURCE_RECORD = {
    entity: 'SOURCE_RECORD',
    layer: 'SOURCE',
    fields: {
      source_record_id: field('string', true),
      source_file_id: field('string', true, 'SOURCE_FILEへの参照'),
      row_index: field('number', false),
      raw_values: field('object', false, '生の行データ（列名は帳票により異なるため型を固定しない）'),
    },
  };

  const IMPORT_BATCH = {
    entity: 'IMPORT_BATCH',
    layer: 'SOURCE',
    fields: {
      import_batch_id: field('string', true),
      started_at: field('string', true),
      finished_at: field('string', false),
      status: field('string', true, 'D1時点では値の集合を固定しない（UNSPECIFIED許容）'),
      file_ids: field('array', false, 'SOURCE_FILEのID配列'),
    },
  };

  /* ============================================================
     NORMALIZED層：配送実績の正規化構造
  ============================================================ */
  const DELIVERY_ROUTE = {
    entity: 'DELIVERY_ROUTE',
    layer: 'NORMALIZED',
    fields: {
      route_id: field('string', true),
      center_id: field('string', false),
      delivery_date: field('string', false, 'YYYY-MM-DD'),
      head_number: field('string', false),
      // 重要：worker_idという単一フィールドで固定しない。
      // 配送便は1作業者とは限らず、複数の会社の作業者が同乗し得るため、
      // 作業者との関係はROUTE_WORKER（1対多）を介して表現する。
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
    relations: {
      workers: { to: 'ROUTE_WORKER', cardinality: 'ONE_TO_MANY', note: '1便に複数作業者（複数所属会社）が同乗し得る' },
      slips: { to: 'DELIVERY_SLIP', cardinality: 'ONE_TO_MANY' },
      payment: { to: 'ROUTE_PAYMENT', cardinality: 'ONE_TO_ONE_OR_NONE' },
    },
  };

  const DELIVERY_SLIP = {
    entity: 'DELIVERY_SLIP',
    layer: 'NORMALIZED',
    fields: {
      slip_id: field('string', true),
      route_id: field('string', false, 'DELIVERY_ROUTEへの参照（未連携の場合はnull許容）'),
      slip_number: field('string', false),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  /* ---------- ROUTE_WORKER（今回の重要な設計変更） ----------
     DELIVERY_ROUTE : ROUTE_WORKER = 1 : 多 を前提とする。
     「人物」「所属履歴」「配送便への参加」を混同しない構造にする
     （ご指示9番の原則）。 */
  const ROUTE_WORKER = {
    entity: 'ROUTE_WORKER',
    layer: 'NORMALIZED',
    fields: {
      route_worker_id: field('string', true),
      route_id: field('string', true, 'DELIVERY_ROUTEへの参照'),
      worker_id: field('string', false, 'WORKER_MASTERへの参照。未解決の場合はnull許容（quality_statusで表現）'),

      // 配達"時点"での所属・センター（人物の恒久属性ではなく、
      // その便に参加した時点でのスナップショットとして保持する）。
      company_id_at_delivery: field('string', false),
      center_id_at_delivery: field('string', false),

      worker_role: field('string', false, 'D1時点では値の集合を固定しない（例：主担当/同乗者等、業務ルール未確定のためUNSPECIFIED許容）'),

      // 照合前の生データ（ソース側の表記そのまま）
      source_worker_code: field('string', false),
      source_worker_name: field('string', false),

      // MASTER_RESOLUTIONとの連携情報
      match_method: field('string', false, 'MASTER_RESOLUTIONのmatch_methodと同じ語彙を使う想定'),
      match_confidence: field('number', false, '0.0〜1.0を想定。D1時点では採点方式は未確定'),
      quality_status: field('string', false, 'DATA_QUALITYのいずれかの値を想定'),

      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
    relations: {
      route: { to: 'DELIVERY_ROUTE', cardinality: 'MANY_TO_ONE' },
      worker: { to: 'WORKER_MASTER', cardinality: 'MANY_TO_ONE_OR_UNRESOLVED' },
    },
  };

  const ROUTE_PAYMENT_ENTITY = {
    entity: 'ROUTE_PAYMENT',
    layer: 'NORMALIZED',
    fields: {
      route_payment_id: field('string', true),
      route_id: field('string', false, 'DELIVERY_ROUTEへの参照（未連携の場合はnull許容）'),
      delivery_date: field('string', false),
      head_number: field('string', false),
      amount: field('number', false, '0円支払を明示的に表現できる。未記載の場合はamount自体をnullとし、absence_status（NO_RECORD等）で区別する'),
      absence_status: field('string', false, 'DATA_CATALOG.ROUTE_PAYMENT.absence_ruleのNO_RECORD/ZERO_PAYMENTを想定。0とUNKNOWN/NULLを同一視しない'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  /* ============================================================
     NORMALIZED層：収支・商品・配送先
  ============================================================ */
  const SALES_DETAIL = {
    entity: 'SALES_DETAIL',
    layer: 'NORMALIZED',
    fields: {
      sales_detail_id: field('string', true),
      center_id: field('string', false),
      year_month: field('string', false),
      worker_source_label: field('string', false),
      amount: field('number', false),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  const PRODUCT_DETAIL = {
    entity: 'PRODUCT_DETAIL',
    layer: 'NORMALIZED',
    fields: {
      product_detail_id: field('string', true),
      slip_id: field('string', false, 'DELIVERY_SLIPへの参照'),
      product_label: field('string', false),
      work_type_label: field('string', false),
      amount: field('number', false),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  const DELIVERY_LOCATION = {
    entity: 'DELIVERY_LOCATION',
    layer: 'NORMALIZED',
    fields: {
      delivery_location_id: field('string', true),
      slip_id: field('string', false),
      zip_code: field('string', false, '7桁を想定（既存validateProductCsvSignatureの判定基準を参照）'),
      address_label: field('string', false),
      shipper_source_code: field('string', false),
      shipper_source_name: field('string', false),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  /* ============================================================
     CANONICAL層：会計事実（最も抽象化された集計対象）
  ============================================================ */
  const ACCOUNTING_FACT = {
    entity: 'ACCOUNTING_FACT',
    layer: 'CANONICAL',
    fields: {
      accounting_fact_id: field('string', true),
      document_type: field('string', true, 'DATA_CATALOGのdocument_typeのいずれか'),
      center_id: field('string', false),
      year_month: field('string', false),
      amount: field('number', false, '0とUNKNOWN/NULLを同一視しない。値が確定できない場合はnullのままにし、quality_statusで理由を表現する'),
      quality_status: field('string', false, 'DATA_QUALITYのいずれかの値を想定'),
      source_file_ids: field('array', false),
    },
  };

  const CONTRACT_ENTRIES = {
    SOURCE_FILE,
    SOURCE_RECORD,
    IMPORT_BATCH,
    DELIVERY_ROUTE,
    DELIVERY_SLIP,
    ROUTE_WORKER,
    ROUTE_PAYMENT: ROUTE_PAYMENT_ENTITY,
    SALES_DETAIL,
    PRODUCT_DETAIL,
    DELIVERY_LOCATION,
    ACCOUNTING_FACT,
  };

  /* ---------- 最低限のvalidation関数 ----------
     契約定義に基づき、渡されたオブジェクトが必須フィールドを
     満たしているかどうかだけを確認する軽量な関数。
     実際のCanonical生成・保存処理は今回実装しない（D2以降）。 */
  function validate(entityName, obj) {
    const def = CONTRACT_ENTRIES[entityName];
    if (!def) {
      return { ok: false, errors: [`未定義のentity: ${entityName}`] };
    }
    const errors = [];
    for (const [key, spec] of Object.entries(def.fields)) {
      if (spec.required && (obj == null || obj[key] === undefined || obj[key] === null)) {
        errors.push(`必須フィールドが未設定: ${key}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  const DATA_CONTRACT = {
    get(entityName) {
      return Object.prototype.hasOwnProperty.call(CONTRACT_ENTRIES, entityName)
        ? CONTRACT_ENTRIES[entityName]
        : null;
    },
    has(entityName) {
      return Object.prototype.hasOwnProperty.call(CONTRACT_ENTRIES, entityName);
    },
    list() {
      return Object.keys(CONTRACT_ENTRIES);
    },
    validate,
  };

  window.DATA_CONTRACT = DATA_CONTRACT;
})();
