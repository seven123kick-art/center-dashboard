/*
==============================================================================
Module
    SyncCoordinator

責務
    DatasetRepository・CloudRepository・StorageRepositoryの間を橋渡しし、
    「いつ・何を・どちらの方向へ同期するか」を判断する調整役。

    Version2 Cloud同期設計書で整理した3つの同期経路
      ・通常同期（manifest単位、pullManifestAndMissing等）
      ・Legacy同期（shared_bundle、pullLegacy等）
      ・State同期（full_state.json、mergeFullState/_applyFullState等）
    は、将来的にはすべて本Coordinatorが調整する対象となる想定。

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。
    core/cloud.js の pullManifestAndMissing() / pullFullState() /
    pullLegacy() / syncSmart()、および app.js の mergeFullState() は
    本ファイル作成後も一切変更していない。

依存
    現時点ではなし。
    将来的な移行時は DATASET_REPOSITORY / CLOUD_REPOSITORY /
    STORAGE_REPOSITORY（いずれも本フェーズで新規作成した3ファイル）を
    参照する想定。Repository間参照は本ファイルのみが行い、
    DatasetRepository・CloudRepository・StorageRepositoryが互いを
    直接参照することはない設計とする（循環依存の防止）。

公開API（将来使用予定。現時点では未呼び出し）
    window.SYNC_COORDINATOR

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V3)
    - pullManifestAndMissing() 相当の「通常同期」ロジックをここへ移設する
    - mergeFullState() 相当の「State同期マージ」ロジックをここへ移設する
      （ただし datasets は対象外という現行仕様を維持すること）
    - pullLegacy() 相当の「Legacy同期」は、全センター移行完了の確認後、
      本Coordinatorへ移設するか、削除するかを判断する
    - Dataset分離（Version3 Architecture Design ①）が完了した後、
      Dataset Identity（複合キー＋新規id）を意識した同期ロジックへ
      更新する
==============================================================================
*/
'use strict';

(function () {
    if (window.__SYNC_COORDINATOR_MODULE_LOADED__) {
        console.warn('[SyncCoordinator] already loaded.');
        return;
    }
    window.__SYNC_COORDINATOR_MODULE_LOADED__ = true;

    /* ====================================================================
       内部ヘルパー（private）
       ==================================================================== */

    /**
     * DatasetRepository・CloudRepositoryの両方が利用可能かを確認する。
     * 将来、本Coordinatorの各メソッドが安全に動作するための前提確認として
     * 使用する想定。
     */
    function _repositoriesReady() {
        return !!(window.DATASET_REPOSITORY && window.CLOUD_REPOSITORY && window.STORAGE_REPOSITORY);
    }

    /* ====================================================================
       公開API（将来使用予定）
       現時点ではいずれも「未接続」の状態で定義のみ行う。
       同期処理は一切実行しない（今回のルール厳守）。
       ==================================================================== */

    window.SYNC_COORDINATOR = {

        /**
         * 「通常同期」（manifest単位）を実行する。
         * 現行の CLOUD.pullManifestAndMissing() に相当する将来の置き換え先。
         * TODO(V3): 未実装。移設時はDatasetRepository.upsert()と
         * CloudRepository.fetch()を組み合わせる形で再実装すること。
         */
        async syncNormal() {
            // TODO(V3): 未実装
            return { ok: false, reason: 'not_implemented' };
        },

        /**
         * 「State同期」（full_state.json、Dataset以外の軽量データ）を実行する。
         * 現行の mergeFullState() + CLOUD._applyFullState() に相当する
         * 将来の置き換え先。
         * TODO(V3): 未実装。移設時は「datasetsは対象外」という現行仕様を
         * 必ず踏襲すること（Cloud同期設計書②State同期の節を参照）。
         */
        async syncState() {
            // TODO(V3): 未実装
            return { ok: false, reason: 'not_implemented' };
        },

        /**
         * 「Legacy同期」（旧shared_bundle形式）を実行する。
         * 現行の CLOUD.pullLegacy() に相当する将来の置き換え先。
         * TODO(V3): 未実装。全センターの移行完了確認が前提条件。
         */
        async syncLegacy() {
            // TODO(V3): 未実装
            return { ok: false, reason: 'not_implemented' };
        },

        /**
         * 3つの同期経路を状況に応じて呼び分ける統合窓口。
         * 現行の CLOUD.pull() に相当する将来の置き換え先。
         * TODO(V3): 未実装
         */
        async syncAll() {
            // TODO(V3): 未実装
            return { ok: false, reason: 'not_implemented' };
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: { _repositoriesReady }
    };

})();
