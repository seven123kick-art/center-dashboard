/* ============================================================
   D1: Data Catalog / データ基盤契約
   src/core/data_catalog/catalog.js

   目的：
   将来の共通データ基盤（D2以降）へ移行するための、既存処理へ
   一切の副作用を与えない「帳票の中央カタログ定義」。

   重要な原則：
   - 本ファイルは既存parser/validationを置換しない。
   - 既存のparser/validationが「どこにあるか」を参照情報として
     記録するにとどめ、実際の判定処理はそれらへ委ねる
     （content_check: 'DEFERRED_TO_EXISTING_PARSER' 等）。
   - 未確定・未確認の項目は、推測で埋めず null / [] / 'UNSPECIFIED'
     のいずれかで明示する。
   - 本CatalogはSOURCE帳票の入口仕様を定義する。DELIVERY_ROUTEや
     BUSINESS_SLIP等の業務Entityの一意性はDATA_CONTRACTを正本とし、
     Catalog側へ重複定義しない。source_link_fieldsはSOURCE間の照合に
     利用可能な項目を示すだけで、一意性を保証する主キーではない。

   本ファイルは何もSTATE/Storage/Cloud/DOMへ書き込まない。
   window.DATA_CATALOG という読み取り専用の定義オブジェクトを
   公開するだけであり、副作用を一切持たない。
============================================================ */
'use strict';
(function(){
  if (window.__DATA_CATALOG_MODULE_LOADED_20260816__) return;
  window.__DATA_CATALOG_MODULE_LOADED_20260816__ = true;

  /* ------------------------------------------------------------
     PL_ACTUAL（収支実績）
     対象：SKDL0002（速報） / SKDL0003（確定）
     ------------------------------------------------------------
     【業務仕様確定（2026-08-16）】
     新データ基盤（本Catalog）が対象とする収支データは、
       SKDL0002 = 速報（PRELIMINARY）
       SKDL0003 = 確定（CONFIRMED）
     と正式に確定した。

     【既存システムとの共存について】
     既存システム（center.html／src/app.js）には、現在
     「SKDL0001（日報）」を扱う既存の取込UI・既存処理
     （CSV.parseSKDL/IMPORT.processCSV等）が存在するが、これは
     既存機能であり、現時点で新データ基盤（本Catalog）が使用する
     予定はない。本Catalogのstatesは、既存のSKDL0001処理を
     置換・変更するものではなく、新データ基盤上でPRELIMINARY／
     CONFIRMEDとして扱う対象を「SKDL0002／SKDL0003」と定義する
     ものである。既存のSKDL0001（日報）UI・取込処理・表示は今回
     一切変更していない。
     つまり、
       既存システム：SKDL0001（日報） → 現状維持（本Catalog対象外）
       新Data Catalog：SKDL0002 → PRELIMINARY／SKDL0003 → CONFIRMED
     として両者は共存する。

     【filename_policyについて】
     SKDL0002／SKDL0003はあくまでCatalog上の帳票・データ種別の
     定義であり、実際に投入されるファイル名が必ず"SKDL0002.csv"
     "SKDL0003.csv"になるとは限らない。そのため、本Catalogを
     「実ファイル名の完全一致でなければ判定できない」構造にはせず、
     filename_policyは意図的に'UNSPECIFIED'のままとしている
     （既存の内容判定ベースの取込ロジック自体も、今回一切変更して
     いない）。
  ------------------------------------------------------------ */
  const PL_ACTUAL = {
    document_type: 'PL_ACTUAL',
    display_name: '収支実績（PL）',
    source_system: 'SKKS',
    allowed_extensions: ['.csv'],
    // ファイル名からの帳票確定可否：実ファイル名がSKDL0002/0003と
    // 完全一致する保証はないため、ファイル名への依存を前提とした
    // 判定構造にはしていない（内容判定に依存する既存方式を踏襲）。
    filename_policy: 'UNSPECIFIED',
    target_scope: 'CENTER_MONTH',
    business_role: '月次の営業収益・費用・利益（科目別実績）を提供する',
    source_link_fields: ['center_id', 'year_month', 'document_state', 'account_code'],
    business_entity_key_contract: 'DATA_CONTRACT.ACCOUNTING_FACT',
    canonical_fields: [], // D1時点では未確定（推測で定義しない）
    validation: {
      content_check: 'DEFERRED_TO_EXISTING_PARSER',
      existing_reference: {
        file: 'src/app.js',
        function: 'CSV.parseSKDL(text, monthCol)',
        note: '科目別の行が読み取れない場合はnullを返す既存仕様がある。本Catalogはこの検証結果を置換しない。なお、この既存parserはSKDL0001（日報）も含めて処理する既存の共通関数であり、本Catalogの対象（SKDL0002/0003）に限定されたものではない。'
      }
    },
    // 実コード確認：IMPORT.processCSV(files, ym, opt) はymを呼出元
    // （年月選択モーダル／bulk_import.jsのファイル名からの年月抽出）
    // から受け取る。ファイル内部からの年月自動判定ロジックは
    // CSV.parseSKDL自体には確認できなかった。
    year_month_detection: 'USER_SELECTED_OR_FILENAME',
    center_detection: 'UNSPECIFIED',
    completion_rule: 'UNSPECIFIED',
    absence_rule: 'UNSPECIFIED',
    states: {
      // 【業務仕様確定】CONFIRMED（SKDL0003）は会社として確定した
      // 会計値であり、決算等にも利用され、確定後に内容が変更される
      // ことはない（immutable: true）。同一center/year_month/account
      // について、既にCONFIRMEDが存在する状態で内容の異なる
      // SKDL0003が来た場合、「新Versionだから上書き」とはせず、
      // 将来はCONFLICT/ERRORとして止める設計とする（D2時点では
      // 判定ロジック自体は実装せず、Contract上に不変性の意味を
      // 表現するにとどめる）。PRELIMINARY（SKDL0002）は速報であり
      // 修正・更新され得るため immutable: false とする。
      PRELIMINARY: { source_label: 'SKDL0002', display_label: '速報', immutable: false },
      CONFIRMED:   { source_label: 'SKDL0003', display_label: '確定', immutable: true }
    },
    // 確定が優先されるが、CONFIRMED取込後もPRELIMINARYのSOURCEを
    // 削除する意味ではない。
    // 注：既存システムには、SKDL0001（日報）とSKDL0003（確定）を
    // 対象にしたsupersedeDailyWithConfirmed()（src/app.js）という
    // 既存処理が存在するが、これは既存機能（本Catalog対象外の
    // SKDL0001に関するもの）であり、本Catalogが定義する
    // PRELIMINARY（SKDL0002）とは異なる対象を扱う別処理である。
    // 本Catalogは、この既存処理を置換・参照するものではない。
    state_priority: ['CONFIRMED', 'PRELIMINARY'],
  };

  /* ------------------------------------------------------------
     PL_DAILY_ACTUAL（SKDL0001 日報 / 着地予測専用）
     ------------------------------------------------------------
     【業務仕様確定（M2-2 / 2026-08-19）】
     SKDL0001は月次PLの正本ではない。月途中の進捗・着地予測と、
     月末のSKDL0003確定値とのRECONCILIATIONにだけ使用する。
     PL_ACTUALへ混ぜず、独立SOURCEとして保持する。
  ------------------------------------------------------------ */
  const PL_DAILY_ACTUAL = {
    document_type: 'PL_DAILY_ACTUAL',
    display_name: '日別収支実績（SKDL0001 / 着地予測用）',
    source_system: 'SKKS',
    allowed_extensions: ['.csv'],
    filename_policy: 'UNSPECIFIED',
    target_scope: 'CENTER_MONTH',
    business_role: '月途中の日別進捗・着地予測、および月末確定PLとの突合に使用する。月次PLの正式値には使用しない',
    source_link_fields: ['accounting_date', 'account_name'],
    business_entity_key_contract: null,
    canonical_fields: [],
    validation: { content_check: 'REQUIRES_ACCOUNTING_DATE_ACCOUNT_NAME_AMOUNT',
      existing_reference: { file: 'src/modules/landing_forecast.js', function: 'LANDING_FORECAST_UI.importFiles(files)',
        note: '既存SKDL0001取込と並行してNormalized Sourceへ保存する。M2-2では着地予測の読取元はまだSTATE.dailyRecordsを維持する。' } },
    year_month_detection: 'ACCOUNTING_DATE',
    center_detection: 'CURRENT_CENTER_CONTEXT',
    completion_rule: 'FORECAST_INPUT_ONLY',
    revision_policy: 'REVISABLE',
    absence_rule: 'NO_FORECAST_WHEN_MISSING',
    monthly_pl_authority: false,
    forecast_source: true
  };

  /* ------------------------------------------------------------
     WORKER_SALES（作業者別売上明細表）
  ------------------------------------------------------------ */
  const WORKER_SALES = {
    document_type: 'WORKER_SALES',
    display_name: '4.作業者別売上明細表',
    source_system: 'SKKS',
    allowed_extensions: ['.csv'],
    filename_policy: 'RANDOM', // ランダム採番のためファイル名だけでは帳票確定不可（ご指示通り）
    target_scope: 'CENTER_MONTH',
    business_role: '作業者ごとの配送件数・金額・作業内容を提供する',
    source_link_fields: ['slip_no'],
    business_entity_key_contract: 'DATA_CONTRACT.WORKER_SALES_SOURCE_RECORD',
    canonical_fields: [],
    validation: {
      content_check: 'DEFERRED_TO_EXISTING_VALIDATOR',
      existing_reference: {
        file: 'src/field/field_core.js',
        functions: ['validateWorkerCsvSignature(rows, fileName)', 'assertNotForeignCsv(...)', 'parseWorkerCsvRows(rows, fileName)'],
        note: 'ヘッダー名（作業者名/作業者/担当者/社員名/氏名）＋値パターンで実データ性を確認する既存positive validationがある。本Catalogはこの検証結果を置換しない。'
      }
    },
    year_month_detection: 'USER_SELECTED_OR_FILENAME',
    center_detection: 'UNSPECIFIED',
    completion_rule: 'UNSPECIFIED',
    revision_policy: 'REVISABLE', // 将来Revision管理対象になり得る（D2時点では保存機構未実装）
    absence_rule: 'UNSPECIFIED',
  };

  /* ------------------------------------------------------------
     SHIPPER_AREA（荷主別配送エリア物量）
  ------------------------------------------------------------ */
  const SHIPPER_AREA = {
    document_type: 'SHIPPER_AREA',
    display_name: '14.荷主別配送エリア物量',
    source_system: 'SKKS',
    allowed_extensions: ['.csv'],
    filename_policy: 'RANDOM',
    target_scope: 'CENTER_MONTH',
    business_role: '荷主・エリア（郵便番号/住所）・商品別の配送実績（物量・金額）を提供する',
    source_link_fields: ['slip_no'],
    business_entity_key_contract: 'DATA_CONTRACT.BUSINESS_SLIP',
    canonical_fields: [],
    validation: {
      content_check: 'DEFERRED_TO_EXISTING_VALIDATOR',
      existing_reference: {
        file: 'src/field/field_core.js',
        functions: ['validateProductCsvSignature(rows, fileName)', 'assertNotForeignCsv(...)', 'parseProductAddressRows(rows, fileName)'],
        note: '郵便番号列が7桁になる割合等、複数の値パターンで実データ性を確認する既存positive validationがある。本Catalogはこの検証結果を置換しない。'
      }
    },
    year_month_detection: 'USER_SELECTED_OR_FILENAME',
    center_detection: 'UNSPECIFIED',
    completion_rule: 'UNSPECIFIED',
    revision_policy: 'REVISABLE', // 将来Revision管理対象になり得る（D2時点では保存機構未実装）
    absence_rule: 'UNSPECIFIED',
    // 正直な報告：実装（UI）上は「商品・住所CSV」(field-product-file-input)
    // という名称で存在する。列構成（原票番号/郵便番号/住所/商品/作業内容/
    // 金額/荷主コード/荷主名）から「14.荷主別配送エリア物量」に対応すると
    // 推測されるが、正式帳票名との対応を実コード上で断定できる記述は
    // 見つからなかったため、対応関係は推測であることを明記する。
    _implementation_note: 'UI実装名は「商品・住所CSV」。正式帳票名との対応は列構成からの推測であり断定していない。'
  };

  /* ------------------------------------------------------------
     DELIVERY_LIST（配達持出予定リスト）
  ------------------------------------------------------------ */
  const DELIVERY_LIST = {
    document_type: 'DELIVERY_LIST',
    display_name: '3.配達持出予定リスト',
    source_system: 'SKKS',
    allowed_extensions: ['.pdf'],
    filename_policy: 'UNSPECIFIED',
    target_scope: 'CENTER_DAY',
    business_role: '配達便（ヘッド番号・配達日・作業者・原票番号）の一覧を提供する',
    source_link_fields: ['head_no', 'slip_no'],
    business_entity_key_contract: 'DATA_CONTRACT.DELIVERY_ROUTE / DATA_CONTRACT.DELIVERY_ATTEMPT',
    canonical_fields: [],
    validation: {
      content_check: 'DEFERRED_TO_EXISTING_PARSER',
      existing_reference: {
        file: 'src/field/route_analysis.js',
        functions: ['parsePdf(file)', 'parsePageText(text, items)', 'parsePdfWithEngine(...)'],
        note: '既存v7解析。ヘッド番号・配達日等の抽出件数を診断情報として保持している。本Catalogはこの検証結果を置換しない。'
      }
    },
    // 実コード確認：importFiles内で ymOfDate(r.date) によりPDF内部の
    // 配達日から年月を算出している（ファイル名からの年月確定ではない）。
    year_month_detection: 'DERIVED_FROM_CONTENT',
    center_detection: 'UNSPECIFIED',
    completion_rule: 'UNSPECIFIED',
    revision_policy: 'REVISABLE', // 将来Revision管理対象になり得る（D2時点では保存機構未実装）
    absence_rule: 'UNSPECIFIED',
  };

  /* ------------------------------------------------------------
     ROUTE_PAYMENT（配達ヘッド傭車料確認）
  ------------------------------------------------------------ */
  const ROUTE_PAYMENT = {
    document_type: 'ROUTE_PAYMENT',
    display_name: '配達ヘッド傭車料確認',
    source_system: 'UNSPECIFIED', // 「月末Excel」として入手経路は確認できたが、生成元システムはコード上確認できなかった
    allowed_extensions: ['.xls', '.xlsx'],
    filename_policy: 'UNSPECIFIED',
    target_scope: 'CENTER_DAY',
    business_role: '配達便（ヘッド番号・配達日）ごとの傭車支払額を提供する',
    source_link_fields: ['head_no'],
    business_entity_key_contract: 'DATA_CONTRACT.ROUTE_PAYMENT',
    canonical_fields: [],
    validation: {
      content_check: 'DEFERRED_TO_EXISTING_PARSER',
      existing_reference: {
        file: 'src/field/route_analysis.js',
        function: 'parseHeadPaymentSheet(rows)',
        note: 'ヘッド番号・配達日・傭車料の3列が揃わない場合はErrorを投げる既存必須列チェックがある。本Catalogはこの検証結果を置換しない。'
      }
    },
    // 実コード確認：importHeadPaymentFiles内で ymOfDate(rec.date) に
    // より内部の配達日から年月を算出している。
    year_month_detection: 'DERIVED_FROM_CONTENT',
    center_detection: 'UNSPECIFIED',
    completion_rule: 'UNSPECIFIED',
    revision_policy: 'REVISABLE', // 将来Revision管理対象になり得る（D2時点では保存機構未実装）
    /* 重要（ご指示に基づく明示的な制約）：
       NO_RECORD（資料に存在しない）とZERO_PAYMENT（0円支払）は別。
       資料に存在しないことを0円支払として扱ってはならない。
       また「支払資料に存在しない＝自社便」とも判定してはならない
       （この業務判定に必要な情報は今回のコード調査だけでは確認
       できないため、prohibited_inferenceとして明示するにとどめ、
       実際の判定ロジックはD1では実装しない）。
       【正直な報告】既存parseHeadPaymentSheetはyoshaFeeへ||0を
       使用しており、Excelに正当に0円と記入された場合とセルが
       空欄だった場合を既存STATEから区別できない既知の課題がある。
       本Catalog・Canonical Builderはこれを補正・推測しない。 */
    absence_rule: {
      NO_RECORD: '当該ヘッド番号・配達日の組合せが傭車料確認資料に一切存在しない状態。ZERO_PAYMENTと同一視しない。',
      ZERO_PAYMENT: '傭車料確認資料に存在し、金額として0円が明記されている状態。NO_RECORDとは区別する。',
      prohibited_inference: 'NO_RECORDから「自社便である」と推測してはならない。'
    },
  };

  /* ------------------------------------------------------------
     PLAN_BUDGET（年度予算計画）
     対象：SKFL0001 月次収支一覧表（計画）PDF / 既存貼付テキスト
  ------------------------------------------------------------ */
  const PLAN_BUDGET = {
    document_type: 'PLAN_BUDGET',
    display_name: '年度予算計画（SKFL0001）',
    source_system: 'SKKS',
    allowed_extensions: ['.pdf'],
    filename_policy: 'CONTENT_VALIDATED',
    target_scope: 'CENTER_FISCAL_YEAR',
    business_role: '4月から翌3月までの科目別月次予算を提供する',
    source_link_fields: ['center_id','fiscal_year','account_label'],
    canonical_fields: ['fiscal_year','account_label','month','amount','plan_status'],
    validation: { content_check:'SKFL0001_LAYOUT_AND_REQUIRED_ACCOUNTS', existing_reference:{file:'src/modules/plan_pdf_import.js',function:'parseFile(file)',note:'PDF内部の年度・月列・主要科目を検証し、単位は千円のまま既存planDataへ保存する。'} },
    year_month_detection: 'FISCAL_YEAR_DERIVED_FROM_CONTENT',
    center_detection: 'DERIVED_FROM_CONTENT',
    completion_rule: 'PLANNED_MONTHS_ONLY; future months may be NOT_PLANNED_YET',
    revision_policy: 'FULL_REPLACE_WITH_CONFIRMATION',
    absence_rule: 'MISSING_ACCOUNT_IS_NOT_ZERO; NOT_PLANNED_YET_IS_NOT_ZERO',
  };

  const DATA_CATALOG_ENTRIES = {
    PLAN_BUDGET,
    PL_ACTUAL,
    PL_DAILY_ACTUAL,
    WORKER_SALES,
    SHIPPER_AREA,
    DELIVERY_LIST,
    ROUTE_PAYMENT,
  };

  const DATA_CATALOG = {
    /* 存在するdocument_typeなら定義オブジェクトを返す。
       存在しない場合はnullを返す（例外を投げない、明確な挙動）。 */
    get(documentType) {
      return Object.prototype.hasOwnProperty.call(DATA_CATALOG_ENTRIES, documentType)
        ? DATA_CATALOG_ENTRIES[documentType]
        : null;
    },
    has(documentType) {
      return Object.prototype.hasOwnProperty.call(DATA_CATALOG_ENTRIES, documentType);
    },
    list() {
      return Object.keys(DATA_CATALOG_ENTRIES);
    },
    all() {
      // 呼出元が誤って定義を書き換えないよう、浅いコピーを返す。
      return { ...DATA_CATALOG_ENTRIES };
    },
  };

  window.DATA_CATALOG = DATA_CATALOG;
})();
