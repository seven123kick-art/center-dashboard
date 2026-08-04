/*
==============================================================================
Module
    CloudRepository

責務
    Supabaseとの通信（アップロード/ダウンロード/保存キー生成）のみを
    担当する将来の置き換え先。Version3 Architecture Design（②Repository
    設計）で明示した最重要ポイント―「CloudRepositoryはSTATEを直接
    書き換えない」―を体現する層として設計する。

    現行の core/cloud.js（CLOUD）には、_applyFullState() /
    _applyLegacyBundle() のように、通信結果をSTATEへ直接書き込む処理が
    混在している。これはVersion2 Cloud同期設計書・Phase4-4 Dataset分析
    報告書の両方で「循環依存・責務混在の原因」として指摘済みの箇所である。

    本Repositoryは、その反省を踏まえ「通信の詳細（キー生成・アップロード・
    ダウンロード）」のみを担当し、STATEへの反映はSyncCoordinator /
    DatasetRepository側の責務とする設計方針を明確にするために作成する。

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。
    core/cloud.js（CLOUD）の実装は本ファイル作成後も一切変更していない。

依存
    現時点ではなし。
    将来的な移行時は CLOUD（core/cloud.js）の通信部分
    （_uploadJSON, _downloadJSON, _datasetKey等の公開ラッパー）を
    内部で呼び出す想定。

公開API（将来使用予定。現時点では未呼び出し）
    window.CLOUD_REPOSITORY

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V3)
    - CLOUD.datasetKey()/workerMonthKey()/productMonthKey()/manifestKey()/
      planKey()/libraryFileKey()（Version2 Phase4-5で公開API化済み）を
      本Repositoryの内部実装として委譲する
    - CLOUD.downloadJSON()/pushMonth()/pushAll() 等、通信そのものを行う
      処理を本Repositoryへ集約する
    - _applyFullState() / _applyLegacyBundle() のように「通信結果を
      STATEへ直接書き込む」処理は、本Repositoryには移設しない
      （SyncCoordinatorの責務とする。詳細はsync_coordinator.js参照）
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
       内部ヘルパー（private）
       ==================================================================== */

    /**
     * 通信対象の種別（pl/worker/product/plan/library/manifest等）から
     * 保存キーを解決する。
     * TODO(V3): 実装時はCLOUD.datasetKey()等の公開ラッパーへ委譲する形にし、
     * キー生成ロジック自体はcore/cloud.js側から二重管理にならないよう
     * 注意すること（本Repositoryはあくまで「呼び出し窓口」に徹する）。
     */
    function _resolveKey(kind, ym, type) {
        // TODO(V3): 未実装。CLOUD.datasetKey/workerMonthKey/productMonthKey等へ
        // 委譲する分岐処理をここに実装する。
        return null;
    }

    /* ====================================================================
       公開API（将来使用予定）
       現時点ではいずれも「未接続」の状態で定義のみ行う。
       Supabaseへは一切通信しない（今回のルール厳守）。
       ==================================================================== */

    window.CLOUD_REPOSITORY = {

        /**
         * 指定キーのJSONをダウンロードする（通信のみ、STATE操作なし）。
         * 現行の CLOUD.downloadJSON() に相当する将来の置き換え先。
         * TODO(V3): 未実装。移設時はCLOUD.downloadJSON()をそのまま呼ぶだけの
         * 委譲とし、通信仕様（リトライ・エラー処理含む）は一切変更しないこと。
         */
        async fetch(kind, ym, type) {
            // TODO(V3): 未実装
            return null;
        },

        /**
         * 指定データをアップロードする（通信のみ、STATE操作なし）。
         * 現行の CLOUD.pushMonth() / pushAll() の「通信部分」のみに相当する
         * 将来の置き換え先。
         * TODO(V3): 未実装。pushMonth/pushAllにはAUTO_SYNC連携や
         * STORE.save()呼び出しも含まれるため、移設時はどこまでを
         * CloudRepositoryの責務としどこからをSyncCoordinatorの責務と
         * するかを再設計すること（現時点では線引きの検討のみ）。
         */
        async push(kind, ym, type, payload) {
            // TODO(V3): 未実装
            return { ok: false };
        },

        /**
         * manifest.json を取得する（通信のみ）。
         * TODO(V3): 未実装。CLOUD.manifestKey()/downloadJSON()へ委譲する形にする。
         */
        async fetchManifest() {
            // TODO(V3): 未実装
            return null;
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: { _resolveKey }
    };

})();
