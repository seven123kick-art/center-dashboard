/* ============================================================
   D1: Master関連契約 ＋ Master Resolution契約
   src/core/data_catalog/master.js

   目的：
   将来のマスタ管理・名寄せ処理を、DB実装なしにJavaScript上の
   契約として先に定義する。

   重要な原則（ご指示8番）：
   作業者は必ずどこか1社に所属するが、A社退職→B社入社のような
   移籍はあり得る（同一時点での複数所属はない）。
   一方、配送実績では複数会社の作業者が同じ便へ同乗し得る。
   したがって「人物（WORKER_MASTER）」「所属履歴
   （WORKER_ASSIGNMENT）」「配送便への参加（contract.js側の
   ROUTE_WORKER）」を混同しない構造にする。
============================================================ */
'use strict';
(function(){
  if (window.__MASTER_CONTRACT_MODULE_LOADED_20260816__) return;
  window.__MASTER_CONTRACT_MODULE_LOADED_20260816__ = true;

  function field(type, required, note) {
    return { type, required: !!required, note: note || null };
  }

  /* ============================================================
     CENTER
  ============================================================ */
  const CENTER_MASTER = {
    entity: 'CENTER_MASTER',
    fields: {
      center_id: field('string', true),
      center_name: field('string', true),
    },
  };
  const CENTER_ALIAS = {
    entity: 'CENTER_ALIAS',
    fields: {
      center_alias_id: field('string', true),
      center_id: field('string', true, 'CENTER_MASTERへの参照'),
      alias_label: field('string', true, 'ソース側での表記揺れ（例：センター名の略称・旧名称）'),
    },
  };

  /* ============================================================
     COMPANY
  ============================================================ */
  const COMPANY_MASTER = {
    entity: 'COMPANY_MASTER',
    fields: {
      company_id: field('string', true),
      company_name: field('string', true),
    },
  };
  const COMPANY_ALIAS = {
    entity: 'COMPANY_ALIAS',
    fields: {
      company_alias_id: field('string', true),
      company_id: field('string', true, 'COMPANY_MASTERへの参照'),
      alias_label: field('string', true),
    },
  };

  /* ============================================================
     WORKER
     ------------------------------------------------------------
     「人物」「所属履歴」「配送便への参加」を明確に分離する：
       WORKER_MASTER      … 人物そのもの（恒久的な識別）
       WORKER_ASSIGNMENT  … いつどの会社に所属していたかの履歴
       ROUTE_WORKER（contract.js） … ある便に参加した記録
                                     （所属会社は配達時点のスナップ
                                     ショットとしてROUTE_WORKER側に
                                     も保持する。同じ人物が将来
                                     転籍しても、過去の便の記録が
                                     後から書き換わらないため）
  ============================================================ */
  const WORKER_MASTER = {
    entity: 'WORKER_MASTER',
    fields: {
      worker_id: field('string', true),
      worker_name: field('string', true),
    },
  };
  const WORKER_ASSIGNMENT = {
    entity: 'WORKER_ASSIGNMENT',
    fields: {
      worker_assignment_id: field('string', true),
      worker_id: field('string', true, 'WORKER_MASTERへの参照'),
      company_id: field('string', true, 'COMPANY_MASTERへの参照'),
      center_id: field('string', false),
      // 業務ルール：同一時点で複数会社への所属はない。
      // ただしA社退職→B社入社のような移籍はあり得るため、
      // 有効期間（valid_from/valid_to）を持つ履歴として表現する。
      valid_from: field('string', false, 'YYYY-MM-DD。未確定ならnull'),
      valid_to: field('string', false, 'YYYY-MM-DD。現在も所属中の場合はnull'),
    },
    business_rule_note: '同一時点で複数会社に同時所属することはない、という制約はD1では強制せず、将来のvalidation実装時の前提として記録するにとどめる（架空の強制ロジックを今回作らない）。',
  };
  const WORKER_ALIAS = {
    entity: 'WORKER_ALIAS',
    fields: {
      worker_alias_id: field('string', true),
      worker_id: field('string', true, 'WORKER_MASTERへの参照'),
      alias_label: field('string', true, 'ソース側での表記揺れ（例：CSV上の作業者名/コード、PDF解析上の作業者名）'),
      source_document_type: field('string', false, 'このaliasがどの帳票由来かを記録する（DATA_CATALOGのdocument_typeを想定）'),
    },
  };

  /* ============================================================
     SHIPPER
  ============================================================ */
  const SHIPPER_MASTER = {
    entity: 'SHIPPER_MASTER',
    fields: {
      shipper_id: field('string', true),
      shipper_name: field('string', true),
    },
  };
  const SHIPPER_ACCOUNT = {
    entity: 'SHIPPER_ACCOUNT',
    fields: {
      shipper_account_id: field('string', true),
      shipper_id: field('string', true, 'SHIPPER_MASTERへの参照'),
      source_shipper_code: field('string', false, '既存CSVの荷主コードに相当すると考えられる（対応関係は今回断定しない）'),
    },
  };
  const SHIPPER_LOCATION = {
    entity: 'SHIPPER_LOCATION',
    fields: {
      shipper_location_id: field('string', true),
      shipper_id: field('string', true),
      zip_code: field('string', false),
      address_label: field('string', false),
    },
  };
  const SHIPPER_GROUP = {
    entity: 'SHIPPER_GROUP',
    fields: {
      shipper_group_id: field('string', true),
      shipper_group_name: field('string', true),
      member_shipper_ids: field('array', false, 'グループ統合表示（既存画面の「荷主別（グループ統合）」相当と考えられるが対応関係は断定しない）'),
    },
  };
  const SHIPPER_ALIAS = {
    entity: 'SHIPPER_ALIAS',
    fields: {
      shipper_alias_id: field('string', true),
      shipper_id: field('string', true, 'SHIPPER_MASTERへの参照'),
      alias_label: field('string', true),
      source_document_type: field('string', false),
    },
  };

  const MASTER_ENTRIES = {
    CENTER_MASTER, CENTER_ALIAS,
    COMPANY_MASTER, COMPANY_ALIAS,
    WORKER_MASTER, WORKER_ASSIGNMENT, WORKER_ALIAS,
    SHIPPER_MASTER, SHIPPER_ACCOUNT, SHIPPER_LOCATION, SHIPPER_GROUP, SHIPPER_ALIAS,
  };

  function validateMaster(entityName, obj) {
    const def = MASTER_ENTRIES[entityName];
    if (!def) return { ok: false, errors: [`未定義のentity: ${entityName}`] };
    const errors = [];
    for (const [key, spec] of Object.entries(def.fields)) {
      if (spec.required && (obj == null || obj[key] === undefined || obj[key] === null)) {
        errors.push(`必須フィールドが未設定: ${key}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  const MASTER_CONTRACT = {
    get(entityName) {
      return Object.prototype.hasOwnProperty.call(MASTER_ENTRIES, entityName) ? MASTER_ENTRIES[entityName] : null;
    },
    has(entityName) {
      return Object.prototype.hasOwnProperty.call(MASTER_ENTRIES, entityName);
    },
    list() { return Object.keys(MASTER_ENTRIES); },
    validate: validateMaster,
  };

  /* ============================================================
     Master Resolution契約
     ------------------------------------------------------------
     CENTER / COMPANY / WORKER / SHIPPER を共通思想で解決する
     ための、照合結果の共通構造。
     今回は既存の実際の取込処理をこのResolverへ置換しない
     （構造の定義・validationのみ）。
  ============================================================ */
  const RESOLVABLE_ENTITY_TYPES = Object.freeze(['CENTER', 'COMPANY', 'WORKER', 'SHIPPER']);

  const MASTER_RESOLUTION_RESULT = {
    entity: 'MASTER_RESOLUTION_RESULT',
    fields: {
      entity_type: field('string', true, 'CENTER/COMPANY/WORKER/SHIPPERのいずれか'),
      source_value: field('string', true, '照合前の生の表記'),
      normalized_value: field('string', false, '正規化後の表記（未実施ならnull）'),
      resolved_id: field('string', false, '解決できたマスタID。未解決ならnull（0や空文字と同一視しない）'),
      match_method: field('string', false, 'D1時点では値の集合を固定しない（例：EXACT/ALIAS/FUZZY等を想定するが未確定）'),
      match_confidence: field('number', false, '0.0〜1.0を想定。未算出ならnull'),
      status: field('string', false, 'DATA_QUALITY.STATUSのいずれかを想定'),
    },
  };

  function isValidEntityType(entityType) {
    return RESOLVABLE_ENTITY_TYPES.includes(entityType);
  }

  function validateResolutionResult(obj) {
    const errors = [];
    if (!obj || !isValidEntityType(obj.entity_type)) {
      errors.push(`entity_typeが不正です（CENTER/COMPANY/WORKER/SHIPPERのいずれかである必要があります）: ${obj && obj.entity_type}`);
    }
    if (!obj || obj.source_value === undefined || obj.source_value === null) {
      errors.push('source_valueが未設定です');
    }
    // resolved_idが未解決（null）であること自体はエラーではない
    // （未解決状態を許容する契約であるため）。
    return { ok: errors.length === 0, errors };
  }

  /* D1時点では実際の名寄せロジックは実装しない。
     未解決の結果を生成するためのヘルパーのみ提供する
     （呼出しは任意、既存処理からは呼ばれていない）。 */
  function makeUnresolvedResult(entityType, sourceValue) {
    return {
      entity_type: entityType,
      source_value: sourceValue,
      normalized_value: null,
      resolved_id: null,
      match_method: null,
      match_confidence: null,
      status: (window.DATA_QUALITY && window.DATA_QUALITY.STATUS.UNMATCHED) || 'UNMATCHED',
    };
  }

  const MASTER_RESOLUTION = {
    ENTITY_TYPES: RESOLVABLE_ENTITY_TYPES,
    resultContract: MASTER_RESOLUTION_RESULT,
    isValidEntityType,
    validate: validateResolutionResult,
    makeUnresolvedResult,
  };

  window.MASTER_CONTRACT = MASTER_CONTRACT;
  window.MASTER_RESOLUTION = MASTER_RESOLUTION;
})();
