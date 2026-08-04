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

公開API（Version6 Step1〜Phase8-Cで全25メソッド実装完了）
    window.CLOUD_REPOSITORY

    【実装済み・全25メソッド、CLOUDの公開APIへ100%委譲】
    fetchDataset() / fetchWorkerMonth() / fetchProductMonth() /
    fetchPlan() / fetchManifest() / fetchCapacity() / fetchLibrary() /
    fetchFullState() /
    pushDataset() / pushWorkerMonth() / pushProductMonth() /
    pushPlan() / pushLibrary() / pushManifest() / pushCapacity() /
    pushFullState() / pushMemos() /
    buildManifest() / buildFullState() /
    validateWorkerMonthRecord() / validateProductMonthRecord() /
    removeLegacyArtifacts() /
    uploadFile() / deleteFile() / createSignedUrl()

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

        async fetchCapacity() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.capacityKey());
        },

        async fetchLibrary() {
            const CLOUD = _requireCloud();
            return CLOUD.downloadJSON(CLOUD.libraryKey());
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

        /**
         * 1件のDatasetをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.datasetKey() + CLOUD.putObject()
         */
        async pushDataset(ym, type, dataset) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.datasetKey(ym, type), dataset);
        },

        /**
         * 1ヶ月分の作業者CSVデータをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.workerMonthKey() + CLOUD.putObject()
         */
        async pushWorkerMonth(ym, record) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.workerMonthKey(ym), record);
        },

        /**
         * 1ヶ月分の商品住所CSVデータをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.productMonthKey() + CLOUD.putObject()
         */
        async pushProductMonth(ym, record) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.productMonthKey(ym), record);
        },

        /**
         * 計画データをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.planKey() + CLOUD.putObject()
         */
        async pushPlan(planData) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.planKey(), planData);
        },

        /**
         * ライブラリ一覧（メタデータ）をアップロードする。
         * 添付ファイル本体は別途 uploadFile() を使うこと。
         * 内部で呼ぶ既存処理：CLOUD.libraryKey() + CLOUD.putObject()
         */
        async pushLibrary(library) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.libraryKey(), library);
        },

        /**
         * Manifestをアップロードする。
         * 内部で呼ぶ既存処理：CLOUD.manifestKey() + CLOUD.putObject()
         */
        async pushManifest(manifest) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.manifestKey(), manifest);
        },

        /* ---------- Version6 Phase8-Cで追加 ---------- */

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
        async pushMemos(memos) {
            const CLOUD = _requireCloud();
            return CLOUD.putObject(CLOUD.memosKey(), memos);
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
