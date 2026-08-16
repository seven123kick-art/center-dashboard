/* ============================================================
   D2-1（改訂版）: 読取専用 Canonical Builder
   src/core/data_catalog/canonical_builder.js

   目的：
   既存STATE（routeData / workerCsvData / productAddressData）を
   一切変更せずに読み取り、D1改訂後のData Contract
   （DELIVERY_ROUTE / BUSINESS_SLIP / DELIVERY_ATTEMPT /
   ROUTE_WORKER / ROUTE_PAYMENT）に沿った Canonical Snapshot を
   メモリ上に生成する。

   重要：現D2-1 BuilderはSTATE.routeDataを起点にしているため、
   HEADを作らず原票へ直接完了登録するBUSINESS_SLIPは生成できない。
   これは異常ではなく、WORKER_SALES等から原票を生成するD2-2で補完する。

   【今回の改訂内容（実業務仕様確認に基づく）】
   - BUSINESS_SLIPの一意性を slip_no 単独に変更した（従来はroute
     単位で暗黙に1件ずつ生成していたが、原票NOはSKKS会社共通の
     番号であり、同一原票が複数センター・複数便に現れても同じ
     原票として扱う）。
   - BUSINESS_SLIPへの単一route_id直接参照を廃止し、新規
     DELIVERY_ATTEMPT（配送試行）を介してDELIVERY_ROUTEと関連付ける
     構造へ変更した。同一原票の複数回の持出（例：不在→再持出）を、
     それぞれ別のDELIVERY_ATTEMPTとして表現する。
   - DELIVERY_ROUTE/ROUTE_PAYMENTのフィールド名を head_number から
     head_no へ改称した（会社共通の強い業務キーであることを明示）。
   - ROUTE_WORKERのworker_position/worker_roleは、現行STATEからは
     作業者1/2を区別できないことを実コードで確認したため、推測で
     設定せず常にnullとする（下記コメント参照）。

   重要な原則（前回から継続）：
   - 本モジュールはpure関数のみで構成する。入力STATE・その配下の
     オブジェクト／配列を直接書き換える処理は一切持たない。
   - STATE / IndexedDB / localStorage / Supabase / Cloud への
     書き込みは一切行わない。
   - 既存データから確実に取得できない値は推測で埋めず、
     DATA_QUALITY（D1で定義済み、ここでは再定義しない）の
     UNMATCHED等で明示する。0による補完は行わない。
   - 既存parser（CSV.parseSKDL / parseWorkerCsvRows /
     parseProductAddressRows / parsePdf / parseHeadPaymentSheet）
     は一切呼び出さない・変更しない。既にSTATEへ格納済みの結果を
     読むだけである。
   - 生成するIDは、D2時点ではメモリ上Snapshot専用の
     deterministic keyであり、永続IDではない。
     BUSINESS_SLIPの一時IDは「年月+slip_no」ではなく「slip_no」
     単独に基づく（原票NOは会社共通の強いキーのため）。
     DELIVERY_ATTEMPTの一時IDは「slip_no+head_no」に基づき、
     同じ原票の再持出（異なるhead_no）を同一Attemptへ潰さない。

   ------------------------------------------------------------
   【実STATE調査結果（今回のセッションで再確認、変更なし）】
   STATE.routeData[].routes[].worker は単一の文字列。
   src/field/route_analysis.js の parsePageText は、単一の
   「作業者」ラベルのみを抽出する既存実装であり、作業者1/2を
   区別する情報を一切保持しない。
   STATE.routeData[].headPayments[].workerCode も、
   parseHeadPaymentSheet が「作業者１」列のみを読む実装であり、
   「作業者２」列に対応する読込は存在しない。
   したがって、現行STATEからはROUTE_WORKERのworker_position
   （1/2）・worker_role（PRIMARY/SECONDARY）を確実に判定できない。
   本Builderはこれをnullのまま生成し、SOURCE情報不足として
   明示する（推測でPRIMARY確定にしない）。
============================================================ */
'use strict';
(function(){
  if (window.__CANONICAL_BUILDER_MODULE_LOADED_20260816__) return;
  window.__CANONICAL_BUILDER_MODULE_LOADED_20260816__ = true;

  function safeArray(v) { return Array.isArray(v) ? v : []; }
  function safeString(v) { return (v === null || v === undefined) ? '' : String(v); }

  function qualityConst(name, fallback) {
    return (window.DATA_QUALITY && window.DATA_QUALITY.STATUS && window.DATA_QUALITY.STATUS[name]) || fallback;
  }

  /* deterministic key: 永続IDではない、メモリ上Snapshot専用の
     一時キー。呼出元にもその旨を明示する。 */
  function tempKey(...parts) {
    return parts.map(p => safeString(p).trim() || 'UNKNOWN').join('_');
  }

  /* ------------------------------------------------------------
     DELIVERY_ROUTE + ROUTE_WORKER + BUSINESS_SLIP + DELIVERY_ATTEMPT
     STATE.routeData を読むだけで、直接の書き換えは行わない。
  ------------------------------------------------------------ */
  function buildRoutesFromState(stateRouteData) {
    const monthEntries = safeArray(stateRouteData);

    const deliveryRoutesById = new Map();     // route_id -> DELIVERY_ROUTE
    const routeWorkers = [];
    const businessSlipsByNo = new Map();      // slip_no -> BUSINESS_SLIP（原票NO単独で一意化。配送有無とは独立）
    const deliveryAttemptsByKey = new Map(); // "slip_no|head_no" -> DELIVERY_ATTEMPT（業務キーでの重複防止）

    // center_idはSTATE.routeData自体に存在しないため、読み取り専用で
    // window.CENTERを参照する（存在すればsource値として保持するのみ。
    // 無ければ null のままにし、勝手なID生成は行わない）。
    const centerIdFromGlobal = (window.CENTER && window.CENTER.id) ? window.CENTER.id : null;
    const centerNameFromGlobal = (window.CENTER && window.CENTER.name) ? window.CENTER.name : null;

    for (const monthEntry of monthEntries) {
      const ym = monthEntry && monthEntry.ym;
      const routes = safeArray(monthEntry && monthEntry.routes);

      for (const r of routes) {
        if (!r) continue;
        const headNo = safeString(r.headNumber).trim();
        const date = safeString(r.date).trim();
        // 【業務仕様確定】head_noは会社共通・日付を跨いだ再利用なし・
        // 他センターとの重複なしの強い業務キーであるため、Canonical上の
        // route_idはhead_no単独を基準とする。ym/delivery_date/center_id
        // は一意性条件ではなく、将来の整合確認／CONFLICT検出材料として
        // 最初に観測された値を保持するにとどめる（今回はCONFLICT判定
        // ロジック自体は実装しない）。
        const routeId = tempKey('ROUTE', headNo);

        if (!deliveryRoutesById.has(routeId)) {
          deliveryRoutesById.set(routeId, {
            route_id: routeId,
            route_id_is_temporary: true, // 永続IDではないことを明示するフラグ
            head_no: headNo || null, // 会社共通の強い業務キー（旧head_numberから改称）
            center_id: centerIdFromGlobal, // 未確定ならnullのまま（推測で確定しない）
            source_center_label: centerNameFromGlobal, // SOURCE側の生の表記を保持
            delivery_date: date || null, // 最初に観測された値。将来の整合確認材料
            source_document_type: 'DELIVERY_LIST',
            source_file_id: null, // STATEにSOURCE_FILE相当の識別子が保持されていないため捏造しない
            source_record_id: null,
            quality_status: (headNo && date) ? qualityConst('OK', 'OK') : qualityConst('PARTIAL', 'PARTIAL'),
          });
        }

        // ---- ROUTE_WORKER（1 : N。現状のsource構造は単一workerだが、
        //      Canonical構造としては配列生成の形をそのまま維持する） ----
        const workerLabel = safeString(r.worker).trim();
        if (workerLabel) {
          routeWorkers.push({
            route_worker_id: tempKey('RW', routeId, workerLabel),
            route_worker_id_is_temporary: true,
            route_id: routeId,
            worker_id: null, // MASTER_RESOLUTION未実施のため未解決のまま
            // 【重要】現行STATEからは作業者1/2を区別できないため
            // worker_position/worker_roleは推測せずnullとする
            // （SOURCE情報不足。DELIVERY_LIST/ROUTE_PAYMENTとも
            // 単一作業者しか保持していないことを実コードで確認済み）。
            worker_position: null,
            worker_role: null,
            company_id_at_delivery: null,
            center_id_at_delivery: centerIdFromGlobal,
            source_worker_code: null, // route.workerはコードではなく氏名文字列のため区別する
            source_worker_name: workerLabel,
            match_method: null,
            match_confidence: null,
            quality_status: qualityConst('UNMATCHED', 'UNMATCHED'), // マスタ照合は今回未実施
            source_document_type: 'DELIVERY_LIST',
            source_file_id: null,
            source_record_id: null,
          });
        }
        // workerLabelが空の場合はROUTE_WORKERを生成しない
        // （0件＝未確定を、架空のレコードで埋めない）。

        // ---- BUSINESS_SLIP（slip_no単独で一意化） + DELIVERY_ATTEMPT ----
        for (const slipNoRaw of safeArray(r.slips)) {
          const slipNo = safeString(slipNoRaw).trim();
          if (!slipNo) continue;

          // BUSINESS_SLIP：原票NOはSKKS会社共通の番号であり、
          // 同一原票が複数センター・複数便に現れても別原票にしない。
          // 一時IDは年月やcenter・routeに依存させず、slip_no単独から
          // 生成する。
          if (!businessSlipsByNo.has(slipNo)) {
            businessSlipsByNo.set(slipNo, {
              slip_id: tempKey('SLIP', slipNo),
              slip_id_is_temporary: true,
              slip_no: slipNo,
              shipper_reference_no: null, // STATE.routeData.routesには保持されていない
              shipper_source_code: null,  // 同上（商品・住所CSV側の情報であり本Builderの対象データには含まれない）
              transaction_type: null,
              completion_status: null,
              completed_at: null,
              business_pattern: null, // HEADがあるだけでSTANDARD_DELIVERY等を推測しない
              source_document_type: 'DELIVERY_LIST',
              source_file_id: null,
              source_record_id: null,
              quality_status: qualityConst('OK', 'OK'),
            });
          }
          const slipId = businessSlipsByNo.get(slipNo).slip_id;

          // DELIVERY_ATTEMPT：この原票がこのheadへ持ち出されたこと
          // 自体はroute.slipsから確実に読み取れるため生成する。
          // ただし完了/不在等の状態はSOURCEに存在しないため常に
          // UNKNOWNとする（「最後に出現した日＝完了」という推測は
          // 行わない）。業務キーはslip_no+head_no。
          // 同じ原票の再持出（別head_no）は別Attemptとして区別される
          // （潰さない）一方、同一slip_no+head_noがSOURCE解析上
          // 複数回現れても、Mapによりこの読取Canonical Snapshot上では
          // 重複生成しない（SOURCE履歴自体を削除する意味ではない）。
          const attemptKey = `${slipNo}|${headNo}`;
          if (!deliveryAttemptsByKey.has(attemptKey)) {
            deliveryAttemptsByKey.set(attemptKey, {
              attempt_id: tempKey('ATTEMPT', slipNo, headNo),
              attempt_id_is_temporary: true,
              slip_id: slipId,
              route_id: routeId,
              attempt_date: date || null,
              center_id: centerIdFromGlobal,
              attempt_status: 'UNKNOWN', // SOURCEから確実に判定できないため常にUNKNOWN
              source_document_type: 'DELIVERY_LIST',
              source_file_id: null,
              source_record_id: null,
              quality_status: qualityConst('OK', 'OK'),
            });
          }
        }
      }
    }

    return {
      deliveryRoutes: [...deliveryRoutesById.values()],
      routeWorkers,
      businessSlips: [...businessSlipsByNo.values()],
      deliveryAttempts: [...deliveryAttemptsByKey.values()],
    };
  }

  /* ------------------------------------------------------------
     ROUTE_PAYMENT の生成
     STATE.routeData[].headPayments と routes を突き合わせる。
     NO_RECORD（資料に該当ヘッドが無い）と ZERO_PAYMENT（資料に
     存在し金額0）を区別する。「NO_RECORD＝自社便」という推測は
     一切行わない。ロジック自体は前回から変更していない
     （フィールド名をhead_noへ改称したのみ）。
  ------------------------------------------------------------ */
  function buildRoutePaymentsFromState(stateRouteData) {
    const monthEntries = safeArray(stateRouteData);
    const routePayments = [];

    for (const monthEntry of monthEntries) {
      const ym = monthEntry && monthEntry.ym;
      const routes = safeArray(monthEntry && monthEntry.routes);
      const headPayments = safeArray(monthEntry && monthEntry.headPayments);

      // 傭車料資料側を headNumber|date をキーにインデックス化する
      // （既存データをそのまま読むだけで、値の補正はしない）。
      const paymentIndex = new Map();
      for (const hp of headPayments) {
        if (!hp) continue;
        const key = `${safeString(hp.headNumber).trim()}|${safeString(hp.date).trim()}`;
        paymentIndex.set(key, hp);
      }

      for (const r of routes) {
        if (!r) continue;
        const headNo = safeString(r.headNumber).trim();
        const date = safeString(r.date).trim();
        // route_idはDELIVERY_ROUTE側と同じ規則（head_no単独）で
        // 生成し、参照整合性を保つ。
        const routeId = tempKey('ROUTE', headNo);
        const key = `${headNo}|${date}`;
        const hp = paymentIndex.get(key);

        if (!hp) {
          // 資料そのものに該当ヘッドが存在しない → NO_RECORD。
          // 0円支払として扱わない。「自社便」とも推測しない。
          routePayments.push({
            route_payment_id: tempKey('RP', ym, headNo, date),
            route_payment_id_is_temporary: true,
            route_id: routeId,
            delivery_date: date || null,
            head_no: headNo || null,
            amount: null,
            absence_status: 'NO_RECORD',
            quality_status: qualityConst('MISSING_SOURCE', 'MISSING_SOURCE'),
            source_document_type: 'ROUTE_PAYMENT',
            source_file_id: null,
            source_record_id: null,
          });
          continue;
        }

        /* 資料に存在する場合。既存parser側で既に Number(...)||0 の
           0埋めが行われた後の値をそのまま読む（本Builderはこれ以上
           補正しない）。値が0であれば、資料に明記された0円支払
           （ZERO_PAYMENT）として扱う。
           【既知のSOURCE品質課題】parseHeadPaymentSheetは、Excel
           セルが空欄の場合と正当に0円と記入された場合を区別せず、
           いずれも||0で0埋めしてしまう既存仕様がある。この既存
           parserを今回変更していないため、本Builderもこの2つの
           ケースを区別できない（下記CHANGELOGにも明記する）。 */
        const amount = Number(hp.yoshaFee);
        routePayments.push({
          route_payment_id: tempKey('RP', ym, headNo, date),
          route_payment_id_is_temporary: true,
          route_id: routeId,
          delivery_date: date || null,
          head_no: headNo || null,
          amount: Number.isFinite(amount) ? amount : null,
          absence_status: (Number.isFinite(amount) && amount === 0) ? 'ZERO_PAYMENT' : null,
          source_vehicle_company_code: safeString(hp.vehicleCompanyCode).trim() || null,
          source_worker_code: safeString(hp.workerCode).trim() || null,
          quality_status: qualityConst('OK', 'OK'),
          source_document_type: 'ROUTE_PAYMENT',
          source_file_id: null,
          source_record_id: null,
        });
      }
    }

    return routePayments;
  }

  /* ------------------------------------------------------------
     Canonical Snapshot 全体の組み立て（pure関数）
     入力STATEオブジェクト自体・その配下は一切変更しない。
  ------------------------------------------------------------ */
  function buildCanonicalSnapshot(sourceState) {
    const state = sourceState || (typeof window !== 'undefined' ? window.STATE : null);
    const routeDataInput = state ? state.routeData : [];

    const { deliveryRoutes, routeWorkers, businessSlips, deliveryAttempts } = buildRoutesFromState(routeDataInput);
    const routePayments = buildRoutePaymentsFromState(routeDataInput);

    return {
      generated_at: new Date().toISOString(),
      is_persistent: false, // メモリ上のみ。STATE/IndexedDB/Supabaseへは保存していない
      entities: {
        DELIVERY_ROUTE: deliveryRoutes,
        BUSINESS_SLIP: businessSlips,
        DELIVERY_ATTEMPT: deliveryAttempts,
        ROUTE_WORKER: routeWorkers,
        ROUTE_PAYMENT: routePayments,
      },
      counts: {
        DELIVERY_ROUTE: deliveryRoutes.length,
        BUSINESS_SLIP: businessSlips.length,
        DELIVERY_ATTEMPT: deliveryAttempts.length,
        ROUTE_WORKER: routeWorkers.length,
        ROUTE_PAYMENT: routePayments.length,
      },
    };
  }

  const CANONICAL_BUILDER = {
    /* 開発者向け・テスト向けの呼出しのみを想定する。
       既存画面（便別採算・データ確認・データ取込等）からは
       今回一切呼び出されていない。 */
    buildSnapshot: buildCanonicalSnapshot,
    _internal: {
      buildRoutesFromState,
      buildRoutePaymentsFromState,
      tempKey,
    },
  };

  window.CANONICAL_BUILDER = CANONICAL_BUILDER;
})();
