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

    Version6 Phase8で、Phase7の分解結果に基づき、汎用オプション型の
    syncNormal()/syncState()ではなく、既存4関数（pullInitialForBoot/
    pullFieldDataForFiscalYear/syncSmart/pushAll）にそれぞれ対応する
    用途別メソッドへ再設計した：
      - syncBoot()：pullInitialForBoot()相当
      - syncFieldFiscalYear()：pullFieldDataForFiscalYear()相当
      - syncSmart()：既存CLOUD.syncSmart()相当
      - syncPush()：既存CLOUD.pushAll()相当
      - syncLegacy()：未実装のまま維持

    Version6 Phase8-Cで、CloudRepositoryへbuildManifest()/
    buildFullState()/validateWorkerMonthRecord()/
    validateProductMonthRecord()/fetchFullState()/pushFullState()/
    pushMemos()/removeLegacyArtifacts()の8メソッドが追加されたことを
    受け、Phase8-Dで、Phase8時点でSyncCoordinator内に存在していた
    複製ロジック4つ（_buildManifestFromState/_buildFullStateFromState/
    _validWorkerMonthRecord/_validProductMonthRecord）を削除し、
    全てCloudRepository経由の呼び出しへ置き換えた。あわせて、
    Phase8時点でCloudRepositoryの不足により未実装だったステップ
    （syncBootのDailyRecords反映、syncSmartのLegacy削除・FullState
    Push、syncPushのMemos・FullState Push・Legacy削除）も、
    新たに利用可能になったCloudRepository APIを使って実装した。

    DatasetRepository・CloudRepository・StorageRepositoryの実装は
    本ファイル作成後も一切変更していない。core/cloud.js（CLOUD）・
    app.js・core/auto_sync.jsも一切変更していない。

Phase8-Eで解消した事項（旧Phase8-D未解決事項）
    syncSmart()のマージ結果STATE反映は、Phase8-D時点では
    CloudRepositoryにapplyFullState()相当のAPIが存在しなかったため
    未実装だった。Phase8-Eで、cloud.js側に既に公開済みだった
    applyFullState()（Phase3-1で追加）をCloudRepositoryへ委譲するのみで
    追加し、SyncCoordinator側はCR.applyFullState(mergedFull)を呼ぶのみで
    解消した。STATEへのフィールド代入ロジックはSyncCoordinator内に
    一切新規記述していない。

依存
    window.DATASET_REPOSITORY / window.CLOUD_REPOSITORY /
    window.STORAGE_REPOSITORY（本Coordinatorのみがこの3つを横断的に
    参照する）。
    window.AUTO_SYNC（同期タイミング制御）。
    mergeFullState() / mergeDeletedStates() / applyDeletionTombstonesToState() /
    sanitizePersonalDataState() / dataDeleteKey() / isDeletedSince() /
    deletedAt() / clearDataDeleted() / mergePlanDataByUpdatedAt() /
    fiscalYearFromYM() / monthsOfFiscalYear() / getDefaultFiscalYear()
    （app.js側の既存グローバル関数。他の全ファイルと同じ、classic
    scriptの共有スコープ経由での参照）。

公開API
    window.SYNC_COORDINATOR

    【Version6 Phase8で新規追加（用途別）】
    syncBoot(preferredView) / syncFieldFiscalYear(fiscalYear, options) /
    syncSmart() / syncPush(options) / syncLegacy()

    【Version6 Phase5実装分（互換維持、非推奨）】
    syncNormal() / syncState() / syncAll()
    → 既存4関数のいずれとも一致しない独自設計だったため、
      Phase8では削除せず、明示的なdeprecatedエラーを返す形に変更した。
      詳細は各メソッドのコメント参照。

更新日
    2026-08-04（Phase8）

TODO(V6以降)
    - syncLegacy()の実装は、CloudRepositoryへのlegacy取得APIの追加、
      および全センター移行完了確認の両方が揃ってから着手する
    - syncBoot()のDailyRecords反映、syncSmart()のFullState取得/Push、
      および_makeManifest/_makeFullStateの複製ロジックは、将来
      CloudRepositoryにfetchFullState()/pushFullState()/buildManifest()/
      buildFullState()が追加された時点で、本ファイル内の複製実装を
      削除し、CloudRepository経由の呼び出しへ置き換えること
    - 既存画面への接続はまだ行っていない
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

    function _repositoriesReady() {
        return !!(window.DATASET_REPOSITORY && window.CLOUD_REPOSITORY && window.STORAGE_REPOSITORY);
    }

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

        // syncFieldFiscalYear用の年度別キャッシュ状態
        // （既存cloud.jsの_fieldPullDone/_fieldPullPromisesに相当）
        _fieldPullDone: {},
        _fieldPullPromises: {},
        // syncSmart/syncPush用の排他制御フラグ（既存cloud.jsの_busyに相当）
        _busy: false,

        /**
         * 既存 CLOUD.pullInitialForBoot() と同一挙動を再現する。
         * 詳細はVersion6 Phase7分解報告書「1. pullInitialForBoot()の分解」
         * を参照。
         *
         * Version6 Phase8-Dで、CloudRepository.fetchFullState()を使い
         * DailyRecordsの反映を実装した（Phase8時点では未実装だった）。
         *
         * Version6 Phase9-2で発見された差異への対応：
         * 既存pullInitialForBoot()はManifest取得に
         * _loadManifestOrBuildFromDb()（manifest.json取得不能・破損時に
         * DB本体から台帳を再構築するフォールバックを含む）を使用して
         * いたが、Phase8時点ではCR.fetchManifest()（単純な
         * downloadJSON）を使っており、このフォールバック機構が
         * 欠落していた。Phase9-2Aで、CloudRepository.
         * fetchManifestWithDbFallback()（cloud.js
         * loadManifestOrBuildFromDb()への委譲のみ）へ置換し、解消した。
         *
         * Version6 Phase9-2Cで、以下を追加で解消した：
         * - Manifest/DB全滅時のLegacyフォールバックを、
         *   syncLegacy()（CloudRepository.pullLegacy()経由）へ接続した
         * - UI.updateCloudBadge('ok')を、既存と同じ2箇所
         *   （no_cloud_dataパス、正常終了時）に追加した
         * - UI.updateCloudBadge('error')を例外時に追加した
         * - 既存pullInitialForBoot()のcatch節にある
         *   fy/perfStart未定義変数参照（確認済みのReferenceErrorバグ、
         *   詳細はCHANGELOG参照）は、Repository版へ新規コピーしていない。
         *   catch節は「UI.updateCloudBadge('error')を呼び、
         *   {ok:false, error:e.message}を返す」という、バグを除いた
         *   本来の正常設計のみを実装している。
         * 【重要】この時点ではまだ既存画面へ接続していない
         * （Case A〜Nの比較検証結果は別途報告）。
         */
        async syncBoot(preferredView = 'dashboard') {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            const STATE = window.STATE;
            const CR = window.CLOUD_REPOSITORY;

            try {
                let manifest;
                try {
                    manifest = await CR.fetchManifestWithDbFallback();
                } catch (e) {
                    manifest = null;
                }

                if (!manifest) {
                    const legacy = await this.syncLegacy();
                    if (legacy && legacy.ok) return legacy;
                    if (typeof window.UI !== 'undefined' && window.UI && typeof window.UI.updateCloudBadge === 'function') window.UI.updateCloudBadge('ok');
                    return { ok: true, changed: false, source: 'no_cloud_data', noData: true, note: legacy?.error || 'クラウドに対象センターのデータがありません' };
                }

                // manifest.deleted は古い削除フラグ汚染の原因になるためマージしない（既存仕様を踏襲）。

                let changed = 0;
                const metas = Array.isArray(manifest.datasets) ? manifest.datasets.filter(m => m && m.ym) : [];
                const localActive = window.DATASET_REPOSITORY.getActive();
                const localLatest = localActive.length ? localActive[localActive.length - 1] : null;
                const sorted = metas.slice().sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
                const latestYm = sorted.length ? sorted[sorted.length - 1].ym : (localLatest && localLatest.ym ? localLatest.ym : null);

                const fySet = new Set();
                if (STATE.fiscalYear) fySet.add(String(STATE.fiscalYear));
                for (const m of metas) {
                    if (m.ym && typeof fiscalYearFromYM === 'function') fySet.add(String(fiscalYearFromYM(m.ym)));
                }
                if (!fySet.size && typeof getDefaultFiscalYear === 'function') fySet.add(String(getDefaultFiscalYear()));

                const targetYms = new Set();
                for (const fy of fySet) {
                    if (typeof monthsOfFiscalYear === 'function') {
                        monthsOfFiscalYear(fy).forEach(ym => targetYms.add(ym));
                    }
                }

                const targetMetas = metas.filter(m => targetYms.has(m.ym));

                for (const meta of targetMetas) {
                    const metaType = meta.type || 'confirmed';
                    const delKey = dataDeleteKey(meta.ym, metaType);
                    if (isDeletedSince('datasets', delKey, meta.importedAt || meta.updatedAt || '')) {
                        if (typeof clearDataDeleted === 'function') clearDataDeleted('datasets', delKey);
                    }
                }

                for (const meta of targetMetas) {
                    try {
                        const metaType = meta.type || 'confirmed';
                        if (isDeletedSince('datasets', dataDeleteKey(meta.ym, metaType), meta.importedAt || meta.updatedAt || '')) continue;
                        const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
                        if (local && String(meta.importedAt || '') <= String(local.importedAt || '')) continue;
                        const ds = await CR.fetchDataset(meta.ym, metaType);
                        if (ds && ds.ym) { window.DATASET_REPOSITORY.upsert(ds); changed++; }
                    } catch (e) {
                        console.warn('[SyncCoordinator.syncBoot] 月別データ取得失敗:', meta.ym, e?.message || e);
                    }
                }

                if (manifest.hasPlanData) {
                    const cloudPlan = await CR.fetchPlan();
                    if (cloudPlan && typeof cloudPlan === 'object' && typeof mergePlanDataByUpdatedAt === 'function') {
                        STATE.planData = mergePlanDataByUpdatedAt(STATE.planData, cloudPlan);
                        changed++;
                    }
                }

                if (manifest.hasCapacity && !STATE.capacity) {
                    const cap = await CR.fetchCapacity();
                    if (cap) { STATE.capacity = cap; changed++; }
                }

                if (manifest.hasDailyRecords) {
                    const full = await CR.fetchFullState();
                    if (full && Array.isArray(full.dailyRecords)) {
                        STATE.dailyRecords = full.dailyRecords;
                        changed++;
                    }
                }

                if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
                if (typeof sanitizePersonalDataState === 'function') sanitizePersonalDataState(STATE);
                if (window.FIELD_DATA_ACCESS?.invalidate) window.FIELD_DATA_ACCESS.invalidate();
                if (changed) window.STORAGE_REPOSITORY.save();

                if (typeof window.UI !== 'undefined' && window.UI && typeof window.UI.updateCloudBadge === 'function') window.UI.updateCloudBadge('ok');
                return { ok: true, changed: !!changed, source: 'boot_fiscal_year_skdl_only' };
            } catch (e) {
                if (typeof window.UI !== 'undefined' && window.UI && typeof window.UI.updateCloudBadge === 'function') window.UI.updateCloudBadge('error');
                return { ok: false, error: e.message || String(e) };
            }
        },

        /**
         * 既存 CLOUD.pullFieldDataForFiscalYear() と同一挙動を再現する。
         * 詳細はVersion6 Phase7分解報告書「2. pullFieldDataForFiscalYear()の分解」
         * を参照。全ステップが既存実装と一致する（CloudRepositoryの
         * 範囲内で完結できるため）。
         */
        async syncFieldFiscalYear(fiscalYear, options = {}) {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            const STATE = window.STATE;
            const CR = window.CLOUD_REPOSITORY;
            const CENTER = window.CENTER;

            const fy = String(fiscalYear || STATE.fiscalYear || (typeof getDefaultFiscalYear === 'function' ? getDefaultFiscalYear() : ''));
            const loadKey = `${CENTER.id}:${fy}`;

            if (!options.force && this._fieldPullDone[loadKey]) {
                return { ok: true, changed: 0, skipped: true, source: 'field_lazy_cache', fiscalYear: fy };
            }
            if (!options.force && this._fieldPullPromises[loadKey]) {
                return this._fieldPullPromises[loadKey];
            }

            const run = (async () => {
                try {
                    const months = (typeof monthsOfFiscalYear === 'function') ? monthsOfFiscalYear(fy) : [];
                    const monthSet = new Set(months);
                    const manifest = await CR.fetchManifest();
                    if (!manifest) return { ok: false, error: 'manifestなし' };
                    // manifest.deleted は古い削除フラグ汚染の原因になるためマージしない（既存仕様を踏襲）。

                    if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
                    if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];

                    let changed = 0, workerDownloaded = 0, productDownloaded = 0;

                    const workerMetas = (Array.isArray(manifest.workerCsvData) ? manifest.workerCsvData : [])
                        .filter(meta => meta && meta.ym && monthSet.has(meta.ym));
                    for (const meta of workerMetas) {
                        if (deletedAt('workerMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
                        const local = STATE.workerCsvData.find(d => d && d.ym === meta.ym);
                        const localAt = String(local?.importedAt || local?.updatedAt || local?.savedAt || '');
                        const cloudAt = String(meta.importedAt || meta.updatedAt || meta.savedAt || '');
                        if (!local || !CR.validateWorkerMonthRecord(local, meta) || cloudAt > localAt) {
                            const rec = await CR.fetchWorkerMonth(meta.ym);
                            if (rec && rec.ym && CR.validateWorkerMonthRecord(rec, meta)) {
                                STATE.workerCsvData = STATE.workerCsvData.filter(d => d && d.ym !== rec.ym);
                                STATE.workerCsvData.push(rec);
                                changed++; workerDownloaded++;
                            }
                        }
                    }

                    const productMetas = (Array.isArray(manifest.productAddressData) ? manifest.productAddressData : [])
                        .filter(meta => meta && meta.ym && monthSet.has(meta.ym));
                    for (const meta of productMetas) {
                        if (deletedAt('productMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
                        const local = STATE.productAddressData.find(d => d && d.ym === meta.ym);
                        const localAt = String(local?.importedAt || local?.updatedAt || local?.savedAt || '');
                        const cloudAt = String(meta.importedAt || meta.updatedAt || meta.savedAt || '');
                        if (!local || !CR.validateProductMonthRecord(local, meta) || cloudAt > localAt) {
                            const rec = await CR.fetchProductMonth(meta.ym);
                            if (rec && rec.ym && CR.validateProductMonthRecord(rec, meta)) {
                                STATE.productAddressData = STATE.productAddressData.filter(d => d && d.ym !== rec.ym);
                                STATE.productAddressData.push(rec);
                                changed++; productDownloaded++;
                            }
                        }
                    }

                    if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
                    if (window.FIELD_DATA_ACCESS?.invalidate) window.FIELD_DATA_ACCESS.invalidate();
                    if (changed) window.STORAGE_REPOSITORY.save();

                    this._fieldPullDone[loadKey] = true;
                    return { ok: true, changed, source: 'field_lazy', fiscalYear: fy, workerMonths: workerMetas.length, productMonths: productMetas.length, workerDownloaded, productDownloaded };
                } catch (e) {
                    return { ok: false, error: e.message || String(e) };
                }
            })();

            this._fieldPullPromises[loadKey] = run;
            try {
                return await run;
            } finally {
                delete this._fieldPullPromises[loadKey];
            }
        },

        /**
         * 既存 CLOUD.syncSmart() と同一挙動を再現する。
         * 詳細はVersion6 Phase7分解報告書「3. syncSmart()の分解」を参照。
         *
         * Version6 Phase8-Dで、CloudRepository.fetchFullState()/
         * pushFullState()/removeLegacyArtifacts()を使い、Legacyファイル
         * 削除・最終FullStateのPushを実装した。
         *
         * Version6 Phase8-Eで、CloudRepository.applyFullState()を使い、
         * マージ結果のSTATE反映（旧・未解決事項）を実装した。
         * cloud.js側は既にPhase3-1で公開済みのapplyFullState()を
         * そのまま使っており、cloud.js自体の変更は不要だった。
         * STATEへのフィールド代入ロジックはSyncCoordinator側では一切
         * 書かず、全てCloudRepository経由でcloud.js
         * _applyFullState()へ委譲している。全ステップが既存実装と
         * 一致する。
         */
        async syncSmart() {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            if (this._busy) return { ok: false, error: '同期処理中' };
            this._busy = true;

            const STATE = window.STATE;
            const CR = window.CLOUD_REPOSITORY;

            const run = async () => {
                const localFull = CR.buildFullState();
                let cloudFull = null;
                try { cloudFull = await CR.fetchFullState(); } catch (e) { cloudFull = null; }
                const mergedFull = (cloudFull && typeof cloudFull === 'object' && typeof mergeFullState === 'function')
                    ? mergeFullState(localFull, cloudFull)
                    : localFull;

                if (typeof mergeDeletedStates === 'function') {
                    mergedFull.deleted = mergeDeletedStates(localFull.deleted || {}, (cloudFull && cloudFull.deleted) || {});
                }
                if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(mergedFull);
                CR.applyFullState(mergedFull);

                // Manifestベースで不足しているDatasetを取得する（syncBootと同様のロジック）。
                let manifestResult = { ok: false, changed: false };
                try {
                    const manifest = await CR.fetchManifest();
                    if (manifest) {
                        const metas = Array.isArray(manifest.datasets) ? manifest.datasets.filter(m => m && m.ym) : [];
                        let changed = false;
                        for (const meta of metas) {
                            const metaType = meta.type || 'confirmed';
                            const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
                            if (local && String(meta.importedAt || '') <= String(local.importedAt || '')) continue;
                            const ds = await CR.fetchDataset(meta.ym, metaType);
                            if (ds && ds.ym) { window.DATASET_REPOSITORY.upsert(ds); changed = true; }
                        }
                        manifestResult = { ok: true, changed };
                    }
                } catch (e) {
                    manifestResult = { ok: false, error: e.message || String(e) };
                }

                await CR.pushFullState(CR.buildFullState());
                await CR.pushPlan(STATE.planData || {});
                for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) {
                    await CR.pushWorkerMonth(w.ym, w);
                }
                for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) {
                    await CR.pushProductMonth(pr.ym, pr);
                }
                if (STATE.capacity) await CR.pushCapacity();

                await CR.removeLegacyArtifacts();

                await CR.pushManifest(CR.buildManifest());

                return { ok: true, changed: true, source: 'smart+manifest', manifestChanged: !!(manifestResult && manifestResult.changed) };
            };

            try {
                return await _runSuppressed(run);
            } catch (e) {
                return { ok: false, error: e.message || String(e) };
            } finally {
                this._busy = false;
            }
        },

        /**
         * 既存 CLOUD.pushAll(options) と同一挙動を再現する。
         * 詳細はVersion6 Phase7分解報告書「4. pushAll()の分解」を参照。
         *
         * Version6 Phase9-3Bで、既存pushAll()と同じ
         * skipIfUnchangedをDataset/Worker/Product/Capacity/Plan/
         * Memos/Libraryへ伝播するよう修正した（Phase9-3A調査で
         * この伝播が欠落していたことが判明したため）。Manifest/
         * FullStateへはskipIfUnchangedを渡さない（既存pushAll()と
         * 同じく、常に無条件Push）。UI.updateCloudBadge()は今回も
         * 追加していない（AUTO_SYNC.flush()側の責務として維持する
         * 方針のため）。
         */
        async syncPush(options = {}) {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            if (this._busy) return { ok: false, error: '同期処理中' };
            this._busy = true;

            const STATE = window.STATE;
            const CR = window.CLOUD_REPOSITORY;
            const onlyChanged = !!options.onlyChanged;
            const pushOptions = { skipIfUnchanged: onlyChanged };

            try {
                for (const ds of STATE.datasets.filter(d => d.source !== 'history')) {
                    await CR.pushDataset(ds.ym, ds.type || 'confirmed', ds, pushOptions);
                }
                for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) {
                    await CR.pushWorkerMonth(w.ym, w, pushOptions);
                }
                for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) {
                    await CR.pushProductMonth(pr.ym, pr, pushOptions);
                }
                if (STATE.capacity) await CR.pushCapacity(STATE.capacity, pushOptions);
                await CR.pushPlan(STATE.planData || {}, pushOptions);
                if (STATE.memos && Object.keys(STATE.memos).length) await CR.pushMemos(STATE.memos, pushOptions);
                if (STATE.library && STATE.library.length) await CR.pushLibrary(STATE.library, pushOptions);

                if (!onlyChanged) {
                    await CR.removeLegacyArtifacts();
                }

                await CR.pushManifest(CR.buildManifest());
                await CR.pushFullState(CR.buildFullState());

                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message || String(e) };
            } finally {
                this._busy = false;

            }
        },

        /**
         * 「Legacy同期」（旧shared_bundle形式）。
         * Version9-2Cで、CloudRepository.pullLegacy()（既存
         * CLOUD.pullLegacy()への委譲）へ接続した。SyncCoordinator自身は
         * Legacy復元ロジックを一切持たない。STATE反映・STORE.save・
         * migrate（デフォルトtrue、既存仕様を維持）・
         * UI.updateCloudBadge()は全てCloud側の既存処理としてそのまま
         * 発生する（migrate成功時にBadgeが2回呼ばれる既存挙動も、
         * この委譲によって自然に再現される。SyncCoordinator側で
         * 「2回呼ぶ」ロジックを新規記述してはいけないという方針の通り、
         * 何も追加していない）。
         */
        async syncLegacy(options = {}) {
            if (!_repositoriesReady()) return { ok: false, reason: 'repositories_not_ready' };
            return window.CLOUD_REPOSITORY.pullLegacy(options);
        },

        /**
         * @deprecated Version6 Phase5で実装した汎用オプション型の
         * 「通常同期」。既存4関数（pullInitialForBoot/
         * pullFieldDataForFiscalYear/syncSmart/pushAll）のいずれとも
         * 一致しない独自設計だったため、Phase8で非推奨とした。
         * syncBoot() または syncFieldFiscalYear() を使用すること。
         */
        async syncNormal() {
            return { ok: false, reason: 'deprecated_use_syncBoot_or_syncFieldFiscalYear' };
        },

        /**
         * @deprecated Version6 Phase5で実装した汎用オプション型の
         * 「State同期」。既存4関数のいずれとも一致しない独自設計
         * だったため、Phase8で非推奨とした。
         * syncSmart() を使用すること（ただしFullState関連は未実装）。
         */
        async syncState() {
            return { ok: false, reason: 'deprecated_use_syncSmart' };
        },

        /**
         * @deprecated syncNormal()/syncState()に依存していたため、
         * 同様に非推奨とした。用途に応じてsyncBoot()/
         * syncFieldFiscalYear()/syncSmart()/syncPush()を使い分けること。
         */
        async syncAll() {
            return { ok: false, reason: 'deprecated_use_specific_sync_methods' };
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: {
            _repositoriesReady, _runSuppressed
        }
    };

})();
