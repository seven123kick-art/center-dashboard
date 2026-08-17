/*
==============================================================================
Module
    CloudRepository

責務
    Supabaseとの通信（アップロード/ダウンロード）のみを担当する。
    「1種類のデータを1回、通信する」という最小単位のAPIのみを持ち、
    「どの組み合わせで、いつ呼ぶか」という判断はSyncCoordinatorへ委ねる
    （Version6 CloudRepository API Design で確定した設計方針）。

    CloudRepositoryはSTATEを直接書き換えない。現行のcore/cloud.js
    （CLOUD）にある_applyFullState()/_applyLegacyBundle()のような
    「通信結果をSTATEへ直接書き込む処理」は、本Repositoryには一切
    含めない（SyncCoordinatorの責務とする）。

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。
    core/cloud.js（CLOUD）の実装は本ファイル作成後も一切変更していない。

依存
    CLOUD（core/cloud.js）の公開メソッドへの薄い委譲のみ。
    CLOUDの非公開メンバー（アンダースコア始まり）へは一切アクセスしない
    （プロジェクト全体の設計方針：他ファイルから私有メンバーへ直接
    アクセスしない、を厳守）。

公開API（Version6 Step1〜Phase9-4Rで全31メソッド実装完了）
    window.CLOUD_REPOSITORY

    【実装済み・全31メソッド、CLOUDの公開APIへ100%委譲】
    fetchDataset() / fetchWorkerMonth() / fetchProductMonth() /
    fetchPlan() / fetchManifest() / fetchManifestWithDbFallback() /
    fetchCapacity() / fetchLibrary() / fetchMemos() / fetchFullState() /
    applyFullState() /
    pushDataset() / pushWorkerMonth() / pushProductMonth() /
    pushPlan() / pushLibrary() / pushManifest() / pushCapacity() /
    pushFullState() / pushMemos() / pushMonth() / pushCapacityFull() /
    buildManifest() / buildFullState() /
    validateWorkerMonthRecord() / validateProductMonthRecord() /
    removeLegacyArtifacts() / pullLegacy() /
    uploadFile() / deleteFile() / createSignedUrl()

Phase9-4Rでの追加
    fetchMemos()を追加した。既存CLOUD.downloadJSON(CLOUD.memosKey())
    への完全な薄い委譲のみ（fetchLibrary()と同型）。cloud.js側は
    memosKey()・downloadJSON()とも既に公開済みのため、cloud.js側の
    変更は不要だった。SyncCoordinator.syncSmart()のMemos欠落分Pull
    補完で使用する。

Phase9-4M-1での追加
    pushCapacityFull()を追加した。既存CLOUD.pushCapacity()（Capacity+
    Manifest+FullStateを常に強制Pushする複合公開API）への完全な
    薄い委譲のみ。既存のpushCapacity(capacity,options)（Capacity単体
    Pushプリミティブ、syncPush/syncSmartが使用）とは別用途のため、
    別名称とし、既存pushCapacity()は一切変更していない。

Phase9-4I-2での追加
    pushMonth(ym)を追加した。cloud.js側は既にCLOUD.pushMonth(ym)という
    公開メソッド（`_`プレフィックスなし）が存在していたため、cloud.js
    側の変更は不要だった。Dataset/Worker/Product抽出ロジック・busy
    制御・Badge処理・Manifest/FullState構築処理は、いずれもCloud
    Repositoryへ複製していない（既存CLOUD.pushMonth()の内部処理を
    そのまま利用する）。field_core.js側の接続、および既存fallback
    構造（pushMonth API不存在時のみpushAllへ切替）はPhase9-4I-2の
    対象外とし、変更していない。

Phase8-Eでの追加
    applyFullState(fullState)を追加した。cloud.js側は既にPhase3-1で
    `applyFullState(full) { return this._applyFullState(full); }`という
    公開ラッパーが追加済みだったため、cloud.js側の変更は不要だった。
    CloudRepository側は、この既存公開APIへの委譲のみで実装している。

Phase9-2Aでの追加
    fetchManifestWithDbFallback()を追加した。cloud.js側へ
    loadManifestOrBuildFromDb()（_loadManifestOrBuildFromDb()への
    薄い委譲）を新規追加した上で、CloudRepositoryはそれへ委譲している。

Phase9-2Cでの追加・責務定義の明確化
    pullLegacy(options)を追加した。cloud.js側は既にCLOUD.pullLegacy()
    という公開メソッド（`_`プレフィックスなし）が存在していたため、
    cloud.js側の変更は不要だった。

    【CloudRepositoryの責務定義（Phase9-2Cで確定）】
    CloudRepository自身にSTATE変更ロジックを書かない。ただし既存
    cloud.js公開APIがSTATE変更・STORE.save等を含む場合、既存動作100%
    維持のため、その公開APIへ薄く委譲することは許可する
    （applyFullState()・pullLegacy()がこの原則の実例）。

Phase9-3Bでの変更（syncPush onlyChanged完全互換化のための準備）
    pushDataset()/pushWorkerMonth()/pushProductMonth()/pushPlan()/
    pushMemos()/pushLibrary()へoptions引数を追加し、
    CLOUD.putObject()（元々options対応済み、cloud.js側の変更は
    不要だった）へ正しく伝播できるようにした。これにより、既存
    CLOUD.pushAll({onlyChanged:true})が持つ「前回Pushと内容が同じ
    キーはアップロードを省略する」というハッシュベースの差分Push
    機構を、Repository経由でも利用可能にした。新しい差分判定ロジックは
    一切書いておらず、既存のCLOUD.putObject()→_uploadJSON()→
    skipIfUnchangedという既存機構への委譲のみ。

    pushCapacity()は、既存CLOUD.pushCapacity()が
    （1）skipIfUnchangedを渡さない（常に無条件Push）
    （2）Manifest/FullStateも一緒にPushしてしまう
    という、pushAll()内のCapacity処理とは異なる副作用を持つことが
    実コード比較で判明したため、CLOUD.pushCapacity()への委譲を廃止し、
    pushAll()内のCapacity処理と同じプリミティブ（putObject+
    capacityKey）を組み合わせる方式へ変更した。これに伴い、
    引数なし呼び出しから`pushCapacity(capacity, options={})`という
    シグネチャへ変更した（他のpushXxxメソッドと同じ「値を引数で
    受け取る」パターンに統一）。

    pushManifest()/pushFullState()は、既存pushAll()がこの2つへ
    skipIfUnchangedを渡さない（常に無条件Push）ため、意図的に
    options引数を追加していない。

Phase8-Cでの追加（Phase8-Bの設計レビューに基づく）
    fetchFullState()/pushFullState()/pushMemos()/buildManifest()/
    buildFullState()/validateWorkerMonthRecord()/
    validateProductMonthRecord()/removeLegacyArtifacts()の8メソッドを
    追加した。いずれもcloud.js側にPhase8-Cで追加した公開API
    （fullStateKey/memosKey/legacyKey/fieldKey/buildManifest/
    buildFullState/validateWorkerMonthRecord/validateProductMonthRecord/
    removeStorageObjects）への委譲のみで実装しており、
    CloudRepository自身は一切ロジックを持たない。

    buildFullState()は、CLOUD.buildFullState()（内部で_makeFullState()を
    呼ぶ）が持つ「sanitizePersonalDataState(STATE)を呼びSTATEを直接
    書き換える」という既存の副作用を、変更・除去せずそのまま継承する。

    validateWorkerMonthRecord()/validateProductMonthRecord()は、
    既存の_validWorkerMonthRecord()/_validProductMonthRecord()と同じ
    (record, meta)という2引数シグネチャをそのまま踏襲している
    （ymではない）。

    removeLegacyArtifacts()は、CLOUD.legacyKey()/CLOUD.fieldKey()/
    CLOUD.removeStorageObjects()の3つの委譲呼び出しの組み合わせのみで
    実装しており、Supabase Storage SDKを直接扱うコードは一切含まない。

Phase4での実装経緯
    Step1時点で8メソッドが未実装だったのは、CLOUD（core/cloud.js）側に
    対応する公開APIが存在しなかったため。Version6 Phase2の調査で
    「capacityKey()・libraryKey()・putObject()の3つを追加すれば
    全て解消できる」ことを確認し、Phase3でcloud.js側にこの3メソッドを
    追加した。本Phase4では、その3メソッドを含む既存の公開APIのみを
    使って、残る8メソッドを実装した。

    CLOUDの非公開メンバー（_capacityKey/_libraryKey/_uploadJSON等）へは
    一切アクセスしていない。全て公開API（capacityKey/libraryKey/
    putObject/datasetKey/workerMonthKey/productMonthKey/planKey/
    manifestKey/downloadJSON）経由の委譲のみで実装している。
互換API
    なし（新規追加のため）

更新日
    2026-08-04（Phase4）

TODO(V6)
    - 実装完了後、SyncCoordinator側でpushMonth()/pushAll()相当の
      オーケストレーションを、これらの個別pushメソッドの組み合わせで
      再構築する（本Repositoryの責務ではない）
    - pushFullState()/fetchFullState()（State同期用）、pushMemos()/
      fetchMemos()は、当初設計にあったが今回の実装対象には含めていない
      （必要になった時点でfullStateKey()/memosKey()の公開ラッパー追加と
      合わせて別途検討する）
==============================================================================
*/
'use strict';

(function () {
    if (window.__CLOUD_REPOSITORY_MODULE_LOADED__) {
        console.warn('[CloudRepository] already loaded.');
        return;
    }
    window.__CLOUD_REPOSITORY_MODULE_LOADED__ = true;

    /* ====================================================================
       共通ヘルパー（private）
       ==================================================================== */

    function _requireCloud() {
        if (typeof window.CLOUD === 'undefined' || !window.CLOUD) {
            throw new Error('[CloudRepository] CLOUD is required but not available. Check script load order.');
        }
        return window.CLOUD;
    }

    /* ====================================================================
       公開API
       ==================================================================== */

    window.CLOUD_REPOSITORY = {

        /* ---------- Fetch系（実装済み、CLOUD.downloadJSON()への委譲） ---------- */

        async fetchDataset(ym, type) {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.datasetKey(ym, type));
        },

        async fetchWorkerMonth(ym) {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.workerMonthKey(ym));
        },

        async fetchProductMonth(ym) {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.productMonthKey(ym));
        },

        async fetchPlan() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.planKey());
        },

        async fetchManifest() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.manifestKey());
        },

        /**
         * manifest.jsonが取得不能・破損等の場合に、DB本体から
         * Manifest相当を再構築するフォールバックを含むManifest取得。
         * 内部ロジックは一切持たず、CLOUD.loadManifestOrBuildFromDb()
         * への委譲のみ（Version6 Phase9-2Aで追加）。
         */
        async fetchManifestWithDbFallback() {
            const CLOUD = _requireCloud();
            return CLOUD.loadManifestOrBuildFromDb();
        },

        async fetchCapacity() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.capacityKey());
        },

        async fetchLibrary() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.libraryKey());
        },

        /**
         * 既存CLOUD.downloadJSON(CLOUD.memosKey())への完全な薄い委譲。
         * fetchLibrary()と同じ思想（Version9-4R）。
         */
        async fetchMemos() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.memosKey());
        },

        /* ---------- Push系：実装済み（1件のみ、既存の同名公開APIへ委譲） ---------- */

        /**
         * 【Version6 Phase9-3Bで変更】CLOUD.pushCapacity()は
         * skipIfUnchangedを渡さず（常に無条件Push）、かつManifest/
         * FullStateも一緒にPushしてしまうため、pushAll()内のCapacity
         * 処理とは異なる副作用を持つ（実コード比較で確認済み）。
         * そのため、既存のpushAll()内Capacity処理と同じプリミティブ
         * （putObject + capacityKey）を組み合わせる方式に変更した。
         * 新しい差分判定ロジックは書いておらず、既存putObject()への
         * 委譲のみ。
         */
        /**
         * 【重要な後方互換対応】既存syncSmart()（今回変更禁止）は
         * CR.pushCapacity()を引数なしで呼んでいる（実コード確認済み）。
         * このメソッドのシグネチャをpushDataset等と同じ「値を引数で
         * 受け取る」方式へ変更したことで、syncSmart()側のこの呼び出しが
         * 壊れないよう、capacityが未指定（undefined）の場合のみ
         * window.STATE.capacityへフォールバックする。既存
         * CLOUD.pushCapacity()自体も内部でSTATE.capacityを直接参照する
         * 設計だったため、この後方互換フォールバックは既存動作からの
         * 逸脱ではない。
         */
        async pushCapacity(capacity, options = {}) {
            const CLOUD = _requireCloud();
            const value = (capacity !== undefined) ? capacity : window.STATE.capacity;
            return CLOUD.putObject(CLOUD.capacityKey(), value, options);
        },

        /**
         * 1件のDatasetをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.datasetKey() + CLOUD.putObject()
         */
        async pushDataset(ym, type, dataset, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.datasetKey(ym, type), dataset, options);
        },

        /**
         * 1ヶ月分の作業者CSVデータをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.workerMonthKey() + CLOUD.putObject()
         */
        async pushWorkerMonth(ym, record, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.workerMonthKey(ym), record, options);
        },

        /**
         * 1ヶ月分の商品住所CSVデータをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.productMonthKey() + CLOUD.putObject()
         */
        async pushProductMonth(ym, record, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.productMonthKey(ym), record, options);
        },

        /**
         * 計画データをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.planKey() + CLOUD.putObject()
         */
        async pushPlan(planData, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.planKey(), planData, options);
        },

        /**
         * ライブラリ一覧（メタデータ）をアップロードする。
         * 添付ファイル本体は別途 uploadFile() を使うこと。
         * 内部で呼ぶ既存処理：CLOUD.libraryKey() + CLOUD.putObject()
         */
        async pushLibrary(library, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.libraryKey(), library, options);
        },

        /**
         * Manifestをアップロードする。
         * 【注記】既存pushAll()はManifestへskipIfUnchangedを渡さない
         * （常に無条件Push）ため、本メソッドもoptionsを受け取らない。
         * 内部で呼ぶ既存処理：CLOUD.manifestKey() + CLOUD.putObject()
         */
        async pushManifest(manifest) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.manifestKey(), manifest);
        },

        /* ---------- Version6 Phase8-Cで追加 ---------- */

        /**
         * マージ済みFullStateをSTATEへ反映する。
         * 既存CLOUD.applyFullState()（Phase3-1で公開済み）への
         * 委譲のみ。STATEへの反映ロジック自体はcloud.js
         * _applyFullState()側にあり、CloudRepositoryは一切
         * ロジックを持たない。
         * 内部で呼ぶ既存処理：CLOUD.applyFullState()
         */
        applyFullState(fullState) {
            const CLOUD = _requireCloud();
            return CLOUD.applyFullState(fullState);
        },

        /**
         * State同期用の軽量フルステートを取得する。
         * 内部で呼ぶ既存処理：CLOUD.fullStateKey() + CLOUD.downloadJSON()
         */
        async fetchFullState() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.fullStateKey());
        },

        /**
         * State同期用の軽量フルステートをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.fullStateKey() + CLOUD.putObject()
         */
        async pushFullState(fullState) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.fullStateKey(), fullState);
        },

        /**
         * メモデータをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.memosKey() + CLOUD.putObject()
         */
        async pushMemos(memos, options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.memosKey(), memos, options);
        },

        /**
         * 現在のSTATEからManifestを構築する（通信を伴わない）。
         * 内部で呼ぶ既存処理：CLOUD.buildManifest()
         */
        buildManifest() {
            const CLOUD = _requireCloud();
            return CLOUD.buildManifest();
        },

        /**
         * 現在のSTATEから軽量フルステートを構築する（通信を伴わない）。
         * 【注記】CLOUD.buildFullState()は内部でSTATEへの副作用
         * （sanitizePersonalDataStateによる個人情報除去）を持つ。
         * この副作用は既存動作の一部であり、本メソッドは一切変更・
         * 除去せずそのまま委譲する。
         * 内部で呼ぶ既存処理：CLOUD.buildFullState()
         */
        buildFullState() {
            const CLOUD = _requireCloud();
            return CLOUD.buildFullState();
        },

        /**
         * 作業者月別レコードの妥当性を検証する。
         * 内部で呼ぶ既存処理：CLOUD.validateWorkerMonthRecord()
         */
        validateWorkerMonthRecord(record, meta) {
            const CLOUD = _requireCloud();
            return CLOUD.validateWorkerMonthRecord(record, meta);
        },

        /**
         * 商品住所月別レコードの妥当性を検証する。
         * 内部で呼ぶ既存処理：CLOUD.validateProductMonthRecord()
         */
        validateProductMonthRecord(record, meta) {
            const CLOUD = _requireCloud();
            return CLOUD.validateProductMonthRecord(record, meta);
        },

        /**
         * 旧形式のストレージオブジェクト（data_v5.json、field/data.json）を
         * 削除する。
         * 内部で呼ぶ既存処理：CLOUD.legacyKey() + CLOUD.fieldKey() +
         * CLOUD.removeStorageObjects()
         */
        async removeLegacyArtifacts() {
            const CLOUD = _requireCloud();
            return CLOUD.removeStorageObjects([CLOUD.legacyKey(), CLOUD.fieldKey()]);
        },

        /**
         * 旧DB一括保存（shared_bundle）からの復元。
         * 既存CLOUD.pullLegacy()（cloud.js側で既に公開済みのメソッド、
         * `_`プレフィックスなし）への薄い委譲のみ。
         *
         * 【重要】この処理は単純な取得（fetch）ではない。既存の
         * CLOUD.pullLegacy()自体が、STATEへの直接反映（11項目）・
         * STORE.save()の直接呼び出し・migrateオプション（デフォルト
         * true）による大量のPush処理・UI.updateCloudBadge()の呼び出しを
         * 全て内包している。CloudRepositoryはこれらのロジックを一切
         * 複製・記述せず、既存メソッドへそのまま委譲することで、
         * 既存動作100%維持を実現する（Version6 Phase9-2Cで確定した
         * 責務定義：「CloudRepository自身にSTATE変更ロジックを
         * 書かない。ただし既存cloud.js公開APIがSTATE変更・STORE.save等を
         * 含む場合、既存動作100%維持のため、その公開APIへ薄く委譲する
         * ことは許可する」に基づく）。
         *
         * 命名について：fetchLegacy()という名前は「読み取り専用」と
         * 誤解させるため採用せず、既存と同じpullLegacy()という名前を
         * そのまま使用している。
         */
        async pullLegacy(options = {}) {
            const CLOUD = _requireCloud();
            return CLOUD.pullLegacy(options);
        },

        /**
         * 対象月のDataset/Worker/Product、およびManifest/FullStateを
         * まとめてアップロードする（Version9-4I-1調査で確認した既存
         * CLOUD.pushMonth(ym)への薄い委譲のみ）。
         *
         * 【重要】Dataset/Worker/Product抽出ロジック・busy制御・
         * Badge処理・Manifest/FullState構築処理は、いずれもCloud
         * Repositoryへ複製していない。全て既存のCLOUD.pushMonth()
         * （cloud.js側、既に`_`プレフィックスなしで公開済み）の
         * 内部処理としてそのまま実行される。
         */
        async pushMonth(ym) {
            const CLOUD = _requireCloud();
            return CLOUD.pushMonth(ym);
        },

        /**
         * 既存CLOUD.pushCapacity()（Capacity+Manifest+FullStateを
         * 常に強制Pushする複合公開API、busy制御・Badge処理・
         * Capacityなし判定を全て内包する）への完全な薄い委譲。
         *
         * 【重要】このメソッドと、既存のpushCapacity(capacity,options)
         * （Capacity単体Pushプリミティブ、syncPush/syncSmartが使用）は
         * 全く別の用途を持つ。名前の混同を避けるため
         * pushCapacityFull()という名称にしている。
         *
         * busy制御・Badge処理・Manifest/FullState構築処理・
         * Capacityなし判定は、いずれもCloudRepositoryへ複製していない。
         * 全て既存CLOUD.pushCapacity()の内部処理としてそのまま実行
         * される（Version9-4M-1）。
         */
        async pushCapacityFull() {
            const CLOUD = _requireCloud();
            return CLOUD.pushCapacity();
        },

        /* ---------- 汎用Realtime State：D3-5B ---------- */
        // full_stateへ混在させない独立正本データ用。通信以外の判断は持たない。
        async fetchRealtimeState(stateKey, centerKey) {
            const CLOUD = _requireCloud();
            return CLOUD.getRealtimeState(stateKey, centerKey);
        },

        async pushRealtimeState(stateKey, payload, centerKey) {
            const CLOUD = _requireCloud();
            return CLOUD.putRealtimeState(stateKey, payload, centerKey);
        },

        /* ---------- ファイル系：実装済み（既存の同名公開APIへ委譲） ---------- */

        async uploadFile(key, file) {
            const CLOUD = _requireCloud();
            return CLOUD.uploadFile(key, file);
        },

        async deleteFile(key) {
            const CLOUD = _requireCloud();
            return CLOUD.deleteFile(key);
        },

        async createSignedUrl(key) {
            const CLOUD = _requireCloud();
            return CLOUD.createSignedUrl(key);
        },

    };

})();
