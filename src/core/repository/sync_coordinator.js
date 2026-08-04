/*
==============================================================================
Module
    SyncCoordinator

責務
    DatasetRepository・CloudRepository・StorageRepositoryの間を橋渡しし、
    「いつ・何を・どちらの方向へ同期するか」を判断する調整役。
    Merge・Conflict判定・AUTO_SYNC制御・同期順序のみを担当し、
    Cloudへの直接アクセス（window.CLOUDの参照）は一切行わない
    （必ずCloudRepository経由）。

    Version6 Phase5で以下を実装した：
    - syncNormal()：Manifest単位の通常同期
      （CloudRepository.fetchManifest/fetchDataset ＋
       DatasetRepository.upsert ＋ StorageRepository.save）
    - syncState()：Dataset以外の軽量データのState同期
      （CloudRepository.fetchCapacity/fetchPlan/fetchLibrary ＋ 既存の
       mergeFullState()/mergeDeletedStates()をそのまま呼び出してマージ）
    - syncAll()：syncNormal→syncStateの順で実行する統合窓口
    - syncLegacy()：未実装（下記「syncLegacyを実装しなかった理由」参照）

    DatasetRepository・CloudRepository・StorageRepositoryの実装は
    本ファイル作成後も一切変更していない。core/cloud.js（CLOUD）・
    app.js（mergeFullState等）も一切変更していない。

syncLegacyを実装しなかった理由
    CloudRepositoryには、旧shared_bundle形式を取得するための公開API
    （legacyKey/fetchLegacy相当）が存在しない。これを実装するには
    CloudRepositoryの変更が必要になるが、今回は「CloudRepository変更
    禁止」というご指示のため実装していない。また、Legacy同期は
    「全センターの移行完了確認」という別の前提条件が満たされていない
    （Phase4-0調査以来、状況変化なし）。

依存
    window.DATASET_REPOSITORY / window.CLOUD_REPOSITORY /
    window.STORAGE_REPOSITORY（本Coordinatorのみがこの3つを横断的に
    参照する。3つのRepository同士が互いを直接参照することはない）。
    window.AUTO_SYNC（同期タイミング制御のため、本Coordinatorのみが
    参照する）。
    mergeFullState() / mergeDeletedStates() / applyDeletionTombstonesToState()
    （app.js側の既存グローバル関数。他の全ファイルと同じ、classic
    scriptの共有スコープ経由での参照であり、私有メンバーへのアクセスでは
    ない）。

公開API
    window.SYNC_COORDINATOR

    syncNormal() ／ syncState() ／ syncAll()：実装済み
    syncLegacy()：未実装（理由は上記参照）

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。

互換API
    なし（新規追加のため）

更新日
    2026-08-04（Phase5）

TODO(V6以降)
    - syncLegacy()の実装は、CloudRepositoryへのlegacy取得APIの追加、
      および全センター移行完了確認の両方が揃ってから着手する
    - syncState()は現状、CloudRepositoryにfetchFullState()が無いため、
      fetchCapacity/fetchPlan/fetchLibraryを個別に呼んで合成した
      擬似的なcloudFullオブジェクトをmergeFullState()へ渡している。
      fiscalYear/routeData/dailyRecords/reportKnowledgeはCloud側の
      個別fetch手段がまだ無いため、今回のマージには含めていない
      （ローカル値をそのまま維持する）
    - 既存画面への接続はまだ行っていない。接続時は既存の
      pullManifestAndMissing()/pull()等との並行稼働・比較検証を
      経ること（Version3〜5で確立した手法を踏襲）
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
     * DatasetRepository・CloudRepository・StorageRepositoryの
     * 3つ全てが利用可能かを確認する。
     */
    function _repositoriesReady() {
        return !!(window.DATASET_REPOSITORY && window.CLOUD_REPOSITORY && window.STORAGE_REPOSITORY);
    }

    /**
     * AUTO_SYNCが利用可能なら、その抑制機構の中で処理を実行する。
     * 利用できない場合はそのまま実行する（既存cloud.jsのsyncSmart()等と
     * 同じフォールバック方針）。
     */
    async function _runSuppressed(fn) {
        if (typeof window.AUTO_SYNC !== 'undefined' && window.AUTO_SYNC && typeof window.AUTO_SYNC.withoutSyncAsync === 'function') {
            return window.AUTO_SYNC.withoutSyncAsync(fn);
        }
        return fn();
    }

    /* ====================================================================
       公開API
       ==================================================================== */

    window.SYNC_COORDINATOR = {

        /**
         * 「通常同期」（Manifest単位でDatasetを同期する）。
         * 手順：
         *   1. CloudRepository.fetchManifest() でManifestを取得
         *   2. Manifest内のdeletedをローカルのSTATE.deletedとマージ
         *      （mergeDeletedStates()、削除は新しい方を優先）
         *   3. Manifestに載っている各Datasetについて、ローカルに無いか
         *      Cloud側の方が新しければ CloudRepository.fetchDataset() で
         *      取得し、DatasetRepository.upsert() でSTATE.datasetsへ反映
         *   4. 変更があればTombstoneを再適用し、StorageRepository.save()
         *      でローカルへ永続化
         */
        async syncNormal() {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };

            return _runSuppressed(async () => {
                let manifest;
                try {
                    manifest = await window.CLOUD_REPOSITORY.fetchManifest();
                } catch (e) {
                    return { ok: false, error: e.message || String(e) };
                }
                if (!manifest) return { ok: true, changed: false, reason: 'no_manifest' };

                if (manifest.deleted && window.STATE) {
                    window.STATE.deleted = mergeDeletedStates(window.STATE.deleted || {}, manifest.deleted);
                }

                const localActive = window.DATASET_REPOSITORY.getActive();
                const localMap = {};
                localActive.forEach(d => { localMap[`${d.ym}_${d.type || 'confirmed'}`] = d; });

                let changed = false;
                const remoteDatasets = Array.isArray(manifest.datasets) ? manifest.datasets : [];
                for (const meta of remoteDatasets) {
                    if (!meta || !meta.ym) continue;
                    const type = meta.type || 'confirmed';
                    const key = `${meta.ym}_${type}`;
                    const local = localMap[key];
                    const remoteTime = String(meta.importedAt || '');
                    const localTime = local ? String(local.importedAt || '') : '';
                    if (!local || remoteTime > localTime) {
                        let full;
                        try {
                            full = await window.CLOUD_REPOSITORY.fetchDataset(meta.ym, type);
                        } catch (e) {
                            continue; // 1件の取得失敗で全体を止めない。既存pullManifestAndMissing()の方針を踏襲
                        }
                        if (full) {
                            window.DATASET_REPOSITORY.upsert(full);
                            changed = true;
                        }
                    }
                }

                if (changed || manifest.deleted) {
                    if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(window.STATE);
                    window.STORAGE_REPOSITORY.save();
                }
                return { ok: true, changed };
            });
        },

        /**
         * 「State同期」（Dataset以外の軽量データ：capacity/planData/library等）。
         * 現行のfull_state.json方式とは異なり、CloudRepositoryには
         * fetchFullState()が無いため、fetchCapacity/fetchPlan/fetchLibraryを
         * 個別に取得し、既存のmergeFullState()へ渡せる形へ組み立ててから
         * マージする。datasets/workerCsvData/productAddressDataは、
         * 既存のState同期仕様に合わせて対象外のまま。
         */
        async syncState() {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };

            return _runSuppressed(async () => {
                let cloudCapacity = null, cloudPlan = null, cloudLibrary = null;
                try { cloudCapacity = await window.CLOUD_REPOSITORY.fetchCapacity(); } catch (e) {}
                try { cloudPlan = await window.CLOUD_REPOSITORY.fetchPlan(); } catch (e) {}
                try { cloudLibrary = await window.CLOUD_REPOSITORY.fetchLibrary(); } catch (e) {}

                if (!window.STATE) return { ok: false, reason: 'state_not_ready' };

                const localFull = {
                    capacity: window.STATE.capacity || null,
                    planData: window.STATE.planData || {},
                    fiscalYear: window.STATE.fiscalYear || null,
                    memos: window.STATE.memos || {},
                    library: window.STATE.library || [],
                    reportKnowledge: window.STATE.reportKnowledge || {},
                    routeData: window.STATE.routeData || [],
                    dailyRecords: window.STATE.dailyRecords || [],
                    deleted: window.STATE.deleted || {},
                };
                const cloudFull = {
                    capacity: cloudCapacity || null,
                    planData: cloudPlan || {},
                    library: cloudLibrary || [],
                    deleted: {},
                };

                const merged = mergeFullState(localFull, cloudFull);

                window.STATE.capacity = merged.capacity;
                window.STATE.planData = merged.planData;
                window.STATE.memos = merged.memos;
                window.STATE.library = merged.library;
                window.STATE.reportKnowledge = merged.reportKnowledge;
                window.STATE.routeData = merged.routeData;
                window.STATE.dailyRecords = merged.dailyRecords;
                window.STATE.deleted = merged.deleted;

                window.STORAGE_REPOSITORY.save();
                return { ok: true, changed: true };
            });
        },

        /**
         * 「Legacy同期」（旧shared_bundle形式）。
         * 未実装。理由はファイルヘッダーの「syncLegacyを実装しなかった
         * 理由」を参照。
         */
        async syncLegacy() {
            return { ok: false, reason: 'not_implemented_cloud_repository_lacks_legacy_api' };
        },

        /**
         * syncNormal → syncState の順で実行する統合窓口。
         */
        async syncAll() {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            const normalResult = await this.syncNormal();
            const stateResult = await this.syncState();
            return {
                ok: !!(normalResult.ok && stateResult.ok),
                normal: normalResult,
                state: stateResult,
            };
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: { _repositoriesReady, _runSuppressed }
    };

})();

