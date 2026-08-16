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
      employee_code: field('string', false, '自社社員等で利用できる社員/作業者コード。コード体系が存在しない委託作業者はnullを許容する'),
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
      assignment_type: field('string', false, 'PRIMARY/WORK_LOCATION等を将来区別できる余地。D2-5では値を強制しない'),
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
     SHIPPER（今回改訂：荷主コード／荷主NO／店舗の関係を明確化）
     ------------------------------------------------------------
     【業務仕様確定】
     ・荷主コード＝エスラインギフ側が荷主を管理するためのコード。
       請求先・料金・締め日等の契約/請求条件に関係する。同じ荷主
       企業でも、請求先違い・料金違い・契約違い・その他管理条件
       違いにより、荷主コードが複数存在するのが普通である
       （これはデータ不整合ではなく正しい業務状態）。
       → SHIPPER_MASTER＝荷主企業そのもの
       → SHIPPER_ACCOUNT＝エスラインギフ側の荷主コード・契約単位
         （1 SHIPPER_MASTER : N SHIPPER_ACCOUNT）
     ・荷主NO＝荷主側が管理する伝票・売上等の番号。主に荷主からの
       問い合わせ時に使用する。これはマスタではなく配送案件側の
       参照番号のため、SHIPPER側のEntityではなくBUSINESS_SLIP側
       （contract.jsのshipper_reference_no）に持たせている。
     ・店舗は荷主コードと必ず1:1ではない（1荷主コードの中に複数
       店舗コードを持つ荷主と、荷主コード単位で店舗を分ける荷主の
       両方がある）。基本集計軸は荷主コード単位（SHIPPER_ACCOUNT）
       とし、店舗情報が取得できる場合はSHIPPER_STOREで店舗単位
       集計も可能にする。店舗マスタ照合ができないことを理由に
       取込不能とする構造にはしない（SHIPPER_STOREへの参照は任意
       フィールドとする）。
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
      shipper_id: field('string', true, 'SHIPPER_MASTERへの参照。1荷主企業に複数のSHIPPER_ACCOUNTが存在するのは正常（請求先・料金・契約違い等）'),
      source_shipper_code: field('string', false, '当社管理の荷主コード。実データ検証でSHIPPER_AREA荷主コード = SKDL荷主基本コード+荷主契約コードの一致を確認済み。'),
      billing_condition_label: field('string', false, '請求先・料金・締め日等の契約/請求条件の識別用ラベル。D2時点では未確定（UNSPECIFIED許容）'),
    },
  };
  /* 荷主コードと店舗は必ず1:1ではないため、独立したEntityとして
     分離する（SHIPPER_ACCOUNTへ店舗コードを直接埋め込まない）。 */
  const SHIPPER_STORE = {
    entity: 'SHIPPER_STORE',
    fields: {
      shipper_store_id: field('string', true),
      shipper_account_id: field('string', false, 'SHIPPER_ACCOUNTへの参照。1荷主コードに複数店舗、または荷主コード単位で店舗を分ける荷主の両方があり得るため任意参照とする'),
      source_store_code: field('string', false),
      store_name: field('string', false),
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
    SHIPPER_MASTER, SHIPPER_ACCOUNT, SHIPPER_STORE, SHIPPER_LOCATION, SHIPPER_GROUP, SHIPPER_ALIAS,

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

  const MASTER_RESOLUTION_DECISION = {
    entity: 'MASTER_RESOLUTION_DECISION',
    fields: {
      resolution_decision_id: field('string', true),
      entity_type: field('string', true),
      source_value: field('string', true),
      source_document_type: field('string', false),
      source_record_id: field('string', false),
      selected_master_id: field('string', true, '人が確認して選択した既存マスタID。SOURCEから自動で新規マスタを作らない'),
      effective_date: field('string', false, '配送日・売上日等。所属履歴を解決する基準日'),
      remember_as_alias: field('boolean', false, 'trueの場合もD2-5ではAlias候補を返すだけで永続化しない'),
      decided_at: field('string', false),
      decided_by: field('string', false),
    },
  };

  const MASTER_ALIAS_PROPOSAL = {
    entity: 'MASTER_ALIAS_PROPOSAL',
    fields: {
      entity_type: field('string', true),
      master_id: field('string', true),
      alias_label: field('string', true),
      source_document_type: field('string', false),
      status: field('string', true, 'PROPOSED。D2-5では保存処理を持たない'),
    },
  };

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
    decisionContract: MASTER_RESOLUTION_DECISION,
    aliasProposalContract: MASTER_ALIAS_PROPOSAL,
    isValidEntityType,
    validate: validateResolutionResult,
    makeUnresolvedResult,
  };

  window.MASTER_CONTRACT = MASTER_CONTRACT;
  window.MASTER_RESOLUTION = MASTER_RESOLUTION;
})();
