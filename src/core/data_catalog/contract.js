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


  /* ---------- 帳票別の明細SOURCE契約（D2-2） ----------
     既存STATE.workerCsvData / productAddressData は画面集計用に原票・
     作業者単位へ集約されており、元CSVの明細行（単価・数量・金額・
     請求/直収等）の一部を失う。新データ基盤ではその集約済みSTATEを
     Canonicalの正本SOURCEにせず、元CSVの行単位事実をこの契約で
     正規化してからLINK/Canonical化する。
     顧客氏名・電話番号・住所全文は本契約の必須SOURCE項目に含めない。 */
  const WORKER_SALES_SOURCE_RECORD = {
    entity: 'WORKER_SALES_SOURCE_RECORD',
    layer: 'NORMALIZED',
    fields: {
      source_record_id: field('string', true),
      source_file_id: field('string', false),
      source_row_index: field('number', false),
      year_month: field('string', false),
      center_id: field('string', false),
      delivery_date: field('string', false),
      transaction_type: field('string', false),
      slip_no: field('string', true, '会社共通の強い原票業務キー'),
      shipper_reference_no: field('string', false),
      source_shipper_name: field('string', false),
      source_store_name: field('string', false),
      source_product_name: field('string', false),
      source_worker_company_name: field('string', false),
      source_worker_name: field('string', false),
      billing_type: field('string', false, '請求/直収等。SOURCE原値を保持'),
      source_work_name: field('string', false),
      unit_price: field('number', false),
      quantity: field('number', false),
      amount: field('number', false, '0は有効値。空欄/UNKNOWNと同一視しない'),
    },
  };

  const SHIPPER_AREA_SOURCE_RECORD = {
    entity: 'SHIPPER_AREA_SOURCE_RECORD',
    layer: 'NORMALIZED',
    fields: {
      source_record_id: field('string', true),
      source_file_id: field('string', false),
      source_row_index: field('number', false),
      year_month: field('string', false),
      center_id: field('string', false),
      delivery_date: field('string', false),
      slip_no: field('string', true, '会社共通の強い原票業務キー'),
      source_shipper_code: field('string', false, '当社管理の荷主コードSOURCE値'),
      source_shipper_name: field('string', false),
      source_store_code: field('string', false),
      source_store_name: field('string', false),
      source_delivery_center_code: field('string', false),
      source_delivery_center_name: field('string', false),
      shipper_reference_no: field('string', false),
      zip_code: field('string', false),
      source_product_name: field('string', false),
      source_product_code: field('string', false),
      source_work_name: field('string', false),
      unit_price: field('number', false),
      quantity: field('number', false),
      amount: field('number', false, '0は有効値。空欄/UNKNOWNと同一視しない'),
      recycle_ticket_no: field('string', false),
      recycle_completed_date: field('string', false),
    },
  };

  /* ============================================================
     NORMALIZED層：原票・配送実績の正規化構造
  ============================================================ */
  const DELIVERY_ROUTE = {
    entity: 'DELIVERY_ROUTE',
    layer: 'NORMALIZED',
    fields: {
      route_id: field('string', true, '内部ID。head_noとは別に維持する'),
      // 【業務仕様確定】head_noは会社共通システムで採番される番号で、
      // 日付を跨いだ再利用・他センターでの重複使用がない。したがって
      // head_noはPRIMARY級の業務キーとして扱える（route_idは内部IDとして
      // 別に維持し、head_noを置き換えるものではない）。
      head_no: field('string', false, '会社共通・重複なしの強い業務キー。旧head_numberから改称'),
      center_id: field('string', false),
      delivery_date: field('string', false, 'YYYY-MM-DD。head_no+center+delivery_dateは整合確認に利用できるが、一意性の根拠はhead_no自体が持つ'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
    relations: {
      workers: { to: 'ROUTE_WORKER', cardinality: 'ONE_TO_MANY', note: '1便に作業者は最大2名（PRIMARY/SECONDARY）。3名以上は業務上想定されていない' },
      // 【業務仕様確定】BUSINESS_SLIPへ単一route_idを固定する設計は廃止。
      // 同一原票が「8/10持出→不在」「8/12再持出→完了」のように複数回
      // 持ち出されることがあるため、SLIPとROUTEの関係はDELIVERY_ATTEMPT
      // を介したN:Mで表現する。
      attempts: { to: 'DELIVERY_ATTEMPT', cardinality: 'ONE_TO_MANY', note: 'この便に含まれる配送試行（複数原票を1便で運ぶため）' },
      payment: { to: 'ROUTE_PAYMENT', cardinality: 'ONE_TO_ONE_OR_NONE' },
    },
  };

  /* ---------- BUSINESS_SLIP（原票） ----------
     【業務仕様確定】
     ・原票は「配送案件」そのものではなく、SKKS上の業務・売上の基本単位。
       通常配送だけでなく、固定チャーター、月末集計、継走等の直接完了、
       0完などにも原票が存在し得る。
     ・slip_no（原票NO）は会社共通システム上の強い業務キーで、
       他センターでの再利用・重複は基本的にない。内部PKはslip_idを別に持つ。
     ・原票が存在しても配送HEADが存在するとは限らない。HEADを作らず原票へ
       直接完了情報を登録して売上計上する正常ケースがある。
     ・逆に固定チャーターのようにHEADが存在して実際に車両・作業者が動いても、
       売上は個別商品配送の積上げではなく日額等で計上される場合がある。
     ・したがって原票と配送運行を分離し、配送がある場合のみ
       DELIVERY_ATTEMPTを介してDELIVERY_ROUTEへ関連付ける。
  ---------------------------------------------------- */
  const BUSINESS_SLIP = {
    entity: 'BUSINESS_SLIP',
    layer: 'NORMALIZED',
    fields: {
      slip_id: field('string', true, '内部ID。slip_noとは別に維持する'),
      slip_no: field('string', true, 'SKKS会社共通の原票番号。資料間LINKのPRIMARY級業務キー'),
      shipper_account_id: field('string', false, 'SHIPPER_ACCOUNTへの参照。未照合時はnull'),
      shipper_reference_no: field('string', false, '荷主側が管理する伝票・売上等の参照番号（荷主NO）'),
      shipper_source_code: field('string', false, 'SOURCE上の荷主コード。MASTER照合前の生値'),
      transaction_type: field('string', false, '通常/返品/差替/引取等。SOURCE原値を保持し、金額符号とは独立させる'),
      completion_status: field('string', false, 'SOURCEから確定できる場合のみ。HEADなしを未完了と推測しない'),
      completed_at: field('string', false, '最終完了日時/日。SOURCEから確定できる場合のみ'),
      business_pattern: field('string', false, 'STANDARD_DELIVERY/FIXED_CHARTER/DIRECT_COMPLETION等を将来表現可能。ただしD2時点では文字列推測で自動分類しない'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
      quality_status: field('string', false, 'SOURCE有無だけで異常判定しない。業務パターンと期待SOURCEを踏まえて評価する'),
    },
    relations: {
      sales: { to: 'SALES_DETAIL', cardinality: 'ONE_TO_MANY', note: 'HEADなしでも正常に存在できる' },
      attempts: { to: 'DELIVERY_ATTEMPT', cardinality: 'ONE_TO_MANY_OR_NONE', note: '配送持出がある場合のみ。直接完了では0件が正常' },
      products: { to: 'PRODUCT_DETAIL', cardinality: 'ONE_TO_MANY_OR_NONE', note: '商品を伴わない集計請求等では0件が正常' },
      locations: { to: 'DELIVERY_LOCATION', cardinality: 'ONE_TO_MANY_OR_NONE' },
    },
  };

  /* ---------- DELIVERY_ATTEMPT（今回新規追加） ----------
     【業務仕様確定】
     BUSINESS_SLIP（原票）と、実際の配送試行（いつ・どの便
     で持ち出したか）を分離するためのEntity。
     例：8/10persist→不在、8/12再持出→配送完了、のように配達持出
     予定リストには同一原票が複数日にわたって正常に存在し得る。
     一方、売上は最終完了時に1回だけ計上される（金額計算は
     D2-1では実装しない、将来のSALES_DETAIL/RECONCILIATIONの課題）。

     関係：BUSINESS_SLIP 1 : N DELIVERY_ATTEMPT
           DELIVERY_ATTEMPT N : 1 DELIVERY_ROUTE

     attempt_statusについて：完了・不在等の状態をSOURCEから確実に
     判定できない場合は必ずUNKNOWNとする。「配達持出予定リストに
     最後に出現した日＝完了」という推測は禁止する（本Contractは
     判定ロジックを持たず、状態を表現できる構造だけを定義する）。
  ---------------------------------------------------- */
  const DELIVERY_ATTEMPT = {
    entity: 'DELIVERY_ATTEMPT',
    layer: 'NORMALIZED',
    fields: {
      attempt_id: field('string', true, '内部ID。D2読取Snapshotではslip_no+head_no等、実際の配送試行を区別できる確実なSOURCEキーから生成する（年月+slip_noのような弱いキーには依存しない）'),
      slip_id: field('string', true, 'BUSINESS_SLIPへの参照。配送がない原票にはDELIVERY_ATTEMPT自体を作らない'),
      route_id: field('string', true, 'DELIVERY_ROUTEへの参照'),
      attempt_date: field('string', false, 'YYYY-MM-DD'),
      center_id: field('string', false),
      attempt_status: field('string', false, 'SOURCEから確実に判定できない場合はUNKNOWNとする。COMPLETED/ABSENT等の値の集合はD2時点では未確定（推測で固定しない）'),
      source_document_type: field('string', false, 'DATA_CATALOGのdocument_typeを想定（主にDELIVERY_LIST）'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
      quality_status: field('string', false, 'DATA_QUALITYのいずれかを想定'),
    },
    relations: {
      slip: { to: 'BUSINESS_SLIP', cardinality: 'MANY_TO_ONE' },
      route: { to: 'DELIVERY_ROUTE', cardinality: 'MANY_TO_ONE' },
    },
  };

  /* ---------- ROUTE_WORKER（今回改訂：worker_position/worker_role追加） ----------
     【業務仕様確定】
     1ヘッドの作業者は最大2名。作業者1＝上段＝PRIMARY、
     作業者2＝下段＝SECONDARY。作業者1が配送途中で交代することは
     ない。同一作業者が同日に複数HEADを担当することはある。
     「人物」「所属履歴」「配送便への参加」を混同しない構造にする
     （既存原則を維持）。

     【実STATE調査結果・重要な制約】
     現在のSTATE.routeData.routes[].workerは単一の文字列のみで、
     作業者1/2を区別する情報を一切保持していない
     （src/field/route_analysis.js parsePageTextは単一の「作業者」
     ラベルのみを抽出する既存実装であることを確認した）。
     配達ヘッド傭車料確認側（parseHeadPaymentSheet）も「作業者１」
     列のみを読み、「作業者２」列に対応する読込は存在しない。
     したがって、現行STATEからはworker_position/worker_roleを
     確実に判定できない。D2-1 Builderでは、既存route.worker由来の
     ROUTE_WORKERについてworker_position/worker_roleを推測で
     PRIMARY確定とせず、SOURCE情報不足を明示する値（null/UNKNOWN）
     とする。 */
  const ROUTE_WORKER = {
    entity: 'ROUTE_WORKER',
    layer: 'NORMALIZED',
    fields: {
      route_worker_id: field('string', true),
      route_id: field('string', true, 'DELIVERY_ROUTEへの参照'),
      worker_id: field('string', false, 'WORKER_MASTERへの参照。未解決の場合はnull許容（quality_statusで表現）'),

      worker_position: field('number', false, '1または2。SOURCEから確実に判定できない場合はnull（推測しない）'),
      worker_role: field('string', false, "'PRIMARY'（作業者1・上段）または'SECONDARY'（作業者2・下段）。SOURCEから確実に判定できない場合はnull（推測しない）。売上は原則PRIMARY側へ帰属する（将来のSALES_DETAIL/RECONCILIATIONルール、D2-1では未実装）"),

      // 配達"時点"での所属・センター（人物の恒久属性ではなく、
      // その便に参加した時点でのスナップショットとして保持する）。
      company_id_at_delivery: field('string', false),
      center_id_at_delivery: field('string', false),

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

  /* ---------- ROUTE_PAYMENT ----------
     【業務仕様確定】1ヘッドにつき支払先会社1社・支払金額1つ。
     作業者1側の所属会社へ支払われる。自社社員が作業者1の場合、
     傭車料確認Excelには基本掲載されない。ただしNO_RECORDから
     「自社便である」と推測してはならない（既存原則を維持）。
     既存の1ヘッド=1レコードという構造は業務仕様と一致しているため、
     フィールド構造自体は変更していない。 */
  const ROUTE_PAYMENT_ENTITY = {
    entity: 'ROUTE_PAYMENT',
    layer: 'NORMALIZED',
    fields: {
      route_payment_id: field('string', true),
      route_id: field('string', false, 'DELIVERY_ROUTEへの参照（未連携の場合はnull許容）'),
      delivery_date: field('string', false),
      head_no: field('string', false, '旧head_numberから改称。会社共通の強い業務キー'),
      amount: field('number', false, '0円支払を明示的に表現できる。未記載の場合はamount自体をnullとし、absence_status（NO_RECORD等）で区別する'),
      absence_status: field('string', false, 'DATA_CATALOG.ROUTE_PAYMENT.absence_ruleのNO_RECORD/ZERO_PAYMENTを想定。0とUNKNOWN/NULLを同一視しない'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  /* ============================================================
     NORMALIZED層：収支・商品・配送先
  ============================================================ */
  /* ---------- SALES_DETAIL（今回、将来ルールとして整理。D2-1では未実装） ----------
     【業務仕様確定】
     ・ヘッド内に作業者1・作業者2がいても、売上は作業者1（上段）
       側へ帰属する。作業者2へ売上を按分しない。ただしこれは金額
       捏造のルールではなく、作業者別売上明細表をSOURCEとして
       金額を取得し、配達持出予定リストの作業者1と一致するかを
       RECONCILIATION（突合）で確認する将来設計とする。
     ・1原票の売上が複数センター・複数売上種別へ分かれることが
       ある（例：原票総売上6,000円のうち、北埼玉:配送5,000円、
       戸田:幹線1,000円）。したがって 1 BUSINESS_SLIP = 1 center
       ではない。SALES_DETAILはslip_id単位に対し複数のcenter_id・
       amount_typeを持てる構造とする。
     ・分納（1原票に複数商品、完了日が商品ごとに異なる）について、
       原票売上は最終完了側へ全額計上され、途中配送側へは按分し
       ない。ただし現在のSOURCEから商品単位の配送日まで確実に
       追跡できることは未確認のため、DELIVERY_ATTEMPT_PRODUCT等の
       Entityは今回推測で追加しない（D2-1では実装しない）。
     ・幹線料込み/抜きの差を自動補正しない。 */
  const SALES_DETAIL = {
    entity: 'SALES_DETAIL',
    layer: 'NORMALIZED',
    fields: {
      sales_detail_id: field('string', true),
      slip_id: field('string', false, 'BUSINESS_SLIPへの参照。1原票が複数センター・複数売上種別のSALES_DETAILを持ち得る'),
      center_id: field('string', false),
      worker_id: field('string', false, '売上帰属作業者。ROUTE_WORKER（実際の運行参加者）とは別概念。HEADなし売上でも存在し得る'),
      worker_company_id: field('string', false, '売上帰属作業者の会社。配送HEADの支払先とは独立してSOURCE/MASTERから解決する'),
      year_month: field('string', false),
      revenue_class: field('string', false, 'DELIVERY/TRUNK/DIRECT_SALE/WORK/RECYCLE/OTHER等を将来分類可能。ただしD2時点では推測分類しない'),
      billing_type: field('string', false, 'WORKER_SALESの付帯区分（請求/直収等）のSOURCE原値。revenue_classとは別軸'),
      transaction_type: field('string', false, '通常/返品/差替/引取等のSOURCE原値。金額符号とは独立'),
      source_detail_name: field('string', false, 'SOURCE上の作業内容・明細名称を原値として保持'),
      unit_price: field('number', false),
      quantity: field('number', false),
      amount: field('number', false, '0は有効値。UNKNOWN/NULLと同一視しない。詳細SOURCE間の70%差等を自動補正しない'),
      worker_source_label: field('string', false),
      source_document_type: field('string', false, 'Canonical金額の採用元帳票。D2-2ではWORKER_SALESを原則優先し、WORKER_SALESがない原票のみSHIPPER_AREAを単独SOURCEとして利用可能'),
      source_file_id: field('string', false),
      source_record_id: field('string', false),
    },
  };

  /* ---------- PRODUCT_DETAIL ----------
     【業務仕様確定】1 BUSINESS_SLIP : N PRODUCT_DETAIL。
     商品コード・商品名は荷主ごとに表記揺れ・コード揺れがあり、
     SKKSに会社共通の商品マスタは存在しない（荷主別料金表と
     サイズ区分1〜7を利用する既存運用）。将来的に「明細種別
     （PRODUCT/WORK/RECYCLE/SERVICE/OTHER）」とその下の商品名
     （冷蔵庫/洗濯機/テレビ等）という2段階分類を検討するが、
     今回この分類自体は実装しない（単純キーワード一致で
     「冷蔵庫商品」「冷蔵庫リサイクル」「冷蔵庫搬出作業」を
     同一カテゴリにしないことだけを設計上の注意点として残す）。 */
  const PRODUCT_DETAIL = {
    entity: 'PRODUCT_DETAIL',
    layer: 'NORMALIZED',
    fields: {
      product_detail_id: field('string', true),
      slip_id: field('string', true, 'BUSINESS_SLIPへの参照。1 BUSINESS_SLIP : N PRODUCT_DETAIL'),
      source_product_code: field('string', false, '荷主ごとのSOURCE商品コード。会社共通コードとはみなさない'),
      source_product_name: field('string', false, 'SOURCE表記の商品名・型番'),
      source_work_name: field('string', false, 'SOURCE表記の作業内容'),
      detail_nature: field('string', false, 'PRODUCT/WORK/RECYCLE/OTHER/UNCLASSIFIED等を将来分類。D2時点では未分類可'),
      product_category: field('string', false, '冷蔵庫/洗濯機/テレビ等の業務カテゴリ。detail_natureとは別軸'),
      size_category: field('string', false, '荷主別料金表のサイズ区分1〜7を想定。D2時点では未実装'),
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

  /* ---------- SOURCE_LINK ----------
     同じ業務事実が複数帳票へ異なる切り口で出力されるため、
     Canonical/Normalized Entityと複数SOURCE_RECORDの根拠関係を保持する。
     例：同じ物販売上をWORKER_SALESとSHIPPER_AREAの双方が表現する。
     両SOURCEを単純加算せず、LINKして1つの売上事実として扱う。 */
  const SOURCE_LINK = {
    entity: 'SOURCE_LINK',
    layer: 'NORMALIZED',
    fields: {
      source_link_id: field('string', true),
      target_entity: field('string', true),
      target_id: field('string', true),
      source_record_id: field('string', true, 'SOURCE_RECORDへの参照'),
      link_status: field('string', false, 'EXACT/AGGREGATED/SOURCE_VARIANCE/SINGLE_SOURCE等を将来利用。D2時点では自動判定未実装'),
      link_method: field('string', false, '原票NO等、照合に使用した根拠'),
    },
  };

  /* ---------- RECONCILIATION_RESULT ----------
     複数SOURCEが同じ業務事実を異なる切り口で表す場合の突合結果。
     SOURCE値を上書き・補正せず、差異そのものを正式データとして保持する。
     D2-2では原票単位のWORKER_SALES合計とSHIPPER_AREA合計を比較する。 */
  const RECONCILIATION_RESULT = {
    entity: 'RECONCILIATION_RESULT',
    layer: 'NORMALIZED',
    fields: {
      reconciliation_id: field('string', true),
      target_entity: field('string', true),
      target_id: field('string', true),
      metric: field('string', true, '例：SALES_AMOUNT'),
      left_document_type: field('string', false),
      right_document_type: field('string', false),
      left_value: field('number', false, '0は有効値。SOURCEなしはnull'),
      right_value: field('number', false, '0は有効値。SOURCEなしはnull'),
      difference: field('number', false, 'right-left。両SOURCEが存在する場合のみ'),
      ratio: field('number', false, 'leftが0でなく両SOURCEが存在する場合のright/left。補正ルールには使わない'),
      status: field('string', true, 'EXACT/SOURCE_VARIANCE/SINGLE_SOURCE'),
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
    WORKER_SALES_SOURCE_RECORD,
    SHIPPER_AREA_SOURCE_RECORD,
    DELIVERY_ROUTE,
    BUSINESS_SLIP,
    DELIVERY_ATTEMPT,
    ROUTE_WORKER,
    ROUTE_PAYMENT: ROUTE_PAYMENT_ENTITY,
    SALES_DETAIL,
    PRODUCT_DETAIL,
    DELIVERY_LOCATION,
    SOURCE_LINK,
    RECONCILIATION_RESULT,
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
