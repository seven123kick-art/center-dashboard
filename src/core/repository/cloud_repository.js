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

公開API（Version6 Step1で実装。詳細はメソッドごとのコメント参照）
    window.CLOUD_REPOSITORY

    【実装済み（CLOUDの既存公開APIへ100%委譲）】
    fetchDataset() / fetchWorkerMonth() / fetchProductMonth() /
    fetchPlan() / fetchManifest() / pushCapacity() /
    uploadFile() / deleteFile() / createSignedUrl()

    【未実装（下記「実装できなかった理由」参照）】
    pushDataset() / pushWorkerMonth() / pushProductMonth() /
    pushPlan() / pushLibrary() / pushManifest() /
    fetchCapacity() / fetchLibrary()

実装できなかった理由（Version6 Step1時点）
    上記8メソッドは、CLOUD（core/cloud.js）側に対応する「1件だけを
    通信する」公開メソッド、または対応するキー生成の公開メソッドが
    存在しないため、既存コードへの100%委譲という条件を満たせなかった。

    具体的には：
    - pushDataset/pushWorkerMonth/pushProductMonth/pushPlan/
      pushManifest：CLOUDには`pushMonth(ym)`（1ヶ月分のDataset・
      作業者・商品住所をまとめてアップロードし、副作用でManifest・
      FullStateも更新する）や`pushAll()`（全件アップロード）という
      複合処理はあるが、「1件だけ」を通信する公開メソッドが存在しない
    - pushLibrary/fetchLibrary：CLOUDには`libraryFileKey()`
      （個々の添付ファイル用のキー）は公開されているが、
      ライブラリ一覧（メタデータ）自体の保存キーを返す公開メソッドが
      存在しない
    - fetchCapacity：CLOUDにはキャパシティの保存キーを返す公開メソッドが
      存在しない（`_capacityKey()`は非公開）

    これらを実装するには、core/cloud.js側に新たな公開ラッパー
    （例：`capacityKey()`, `libraryKey()`）を追加するか、CLOUDの非公開
    メンバーへ直接アクセスする必要があるが、今回は「src/core/repository/
    cloud_repository.jsのみ変更」というご指示のため、いずれも行っていない。
    次フェーズでcore/cloud.js側に必要な公開ラッパーを追加することを
    推奨する（datasetKey()等6メソッドをVersion2 Phase4-5で追加した際と
    同じ手法）。

互換API
    なし（新規追加のため）

更新日
    2026-08-04

TODO(V6)
    - core/cloud.js側へ capacityKey() / libraryKey() の公開ラッパーを
      追加した上で、fetchCapacity() / fetchLibrary() を実装する
    - core/cloud.js側またはCloudRepository側に、1件だけをアップロードする
      汎用の公開委譲経路を用意した上で、pushDataset() 等6メソッドを
      実装する
    - 実装完了後、SyncCoordinator側でpushMonth()/pushAll()相当の
      オーケストレーションを、これらの個別pushメソッドの組み合わせで
      再構築する
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

    /**
     * core/cloud.js側に対応する公開APIが存在しない場合の、
     * 明示的な未実装エラー。黙って誤った動作をするより、
     * 呼び出し元が気づける形にする（既存プロジェクトの一貫した方針）。
     */
    function _notYetAvailable(methodName, reason) {
        throw new Error(`[CloudRepository] ${methodName}() is not yet available: ${reason}`);
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

        /* ---------- Push系：実装済み（1件のみ、既存の同名公開APIへ委譲） ---------- */

        /**
         * 【注記】CLOUD.pushCapacity()は引数を取らず、内部でSTATE.capacityを
         * 直接参照する設計のため、本メソッドも同様に引数なしとしている
         * （既存動作を変更しないための委譲）。
         */
        async pushCapacity() {
            const CLOUD = _requireCloud();
            return CLOUD.pushCapacity();
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

        /* ---------- 未実装：core/cloud.js側に対応する公開APIが存在しない ---------- */

        async pushDataset(ym, type, dataset) {
            _notYetAvailable('pushDataset', 'CLOUDに1件だけDatasetをアップロードする公開メソッドが存在しない（pushMonth()は複合処理のため代用不可）');
        },

        async pushWorkerMonth(ym, record) {
            _notYetAvailable('pushWorkerMonth', '同上（pushMonth()は複合処理のため代用不可）');
        },

        async pushProductMonth(ym, record) {
            _notYetAvailable('pushProductMonth', '同上');
        },

        async pushPlan(planData) {
            _notYetAvailable('pushPlan', 'CLOUDに計画データ単体をアップロードする公開メソッドが存在しない（pushAll()は複合処理のため代用不可）');
        },

        async pushLibrary(library) {
            _notYetAvailable('pushLibrary', 'CLOUDにライブラリ一覧の保存キーを返す公開メソッド（libraryKey相当）が存在しない');
        },

        async pushManifest(manifest) {
            _notYetAvailable('pushManifest', 'CLOUDにManifestを単体でアップロードする公開メソッドが存在しない（pushMonth/pushCapacity/pushAllの副作用としてのみ更新される）');
        },

        async fetchCapacity() {
            _notYetAvailable('fetchCapacity', 'CLOUDにキャパシティの保存キーを返す公開メソッド（capacityKey相当）が存在しない');
        },

        async fetchLibrary() {
            _notYetAvailable('fetchLibrary', 'CLOUDにライブラリ一覧の保存キーを返す公開メソッド（libraryKey相当）が存在しない');
        },

    };

})();
