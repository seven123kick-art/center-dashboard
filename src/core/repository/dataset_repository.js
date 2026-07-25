/*
==============================================================================
Module
    DatasetRepository

責務
    STATE.datasets への読み書きを将来的に一元化するための受け皿。
    Version3 Architecture Design（②Repository設計）で定義した
    DatasetRepository / DatasetService の責務のうち、まず
    「データの出し入れ」（Repository）部分の器を用意する。

    【Phase3-3-3で読み取り系メソッドのみ実装済み】
    getAll() / findByKey() / getActive() / priorityOf() の4メソッドを
    実装した。既存画面・既存関数からはまだ一切呼び出されていない
    （center.htmlにも未接続）。

    既存の processDataset() / upsertDataset() / activeDatasets() /
    mergeFullState() 等は本ファイル作成・更新後も一切変更せず、そのまま
    app.js 側に残っている。書き込み系（upsert/remove）は今回も未実装
    のまま。

依存
    実行時：window.STATE（読み取りのみ、変更しない）
    tombstone判定のみ、以下が存在すれば使用する（無ければ安全側にスキップ）：
      window.dataDeleteKey(ym, type)
      window.isDeletedSince(kind, key, itemTime)
      window.fiscalYearFromYM(ym)
    上記3関数は「呼べれば使う・無ければ諦める」という設計であり、
    本ファイル単体をNode.js等で読み込んでも構文エラー・例外は発生しない
    （下記「調査結果と判断が必要な箇所」を参照）。

公開API
    window.DATASET_REPOSITORY.getAll()
    window.DATASET_REPOSITORY.findByKey(ym, type, source)
    window.DATASET_REPOSITORY.getActive()
    window.DATASET_REPOSITORY.priorityOf(dataset)

    ※ Repository.Dataset.getAll() 等でも同じ実体を参照できる
      （src/core/repository/registry.js 経由、Phase3-3-2で導入済み）

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V3)
    - upsert() / remove() を実装する（今回未実装）
    - Dataset ID導入（_generateId）は別フェーズ
    - tombstone判定の外部関数依存（dataDeleteKey/isDeletedSince/
      fiscalYearFromYM）を、将来的にどう扱うか要判断
      （下記「調査結果と判断が必要な箇所」参照）
==============================================================================

■ 調査結果：既存Dataset関数とその場所（すべてsrc/app.js）
   - upsertDataset()             790行  複合キー判定・追加/上書き・ソート
   - datasetSourceKind()        1169行  種別判定（confirmed/daily/history）
   - datasetPriority()          1183行  優先順位（confirmed=30>daily=20>history=10）
   - activeDatasets()           1192行  ym単位で最優先の1件へ絞り込み
   - activeDatasetByYM()        1214行  activeDatasets()からym一致を検索
   - datasetStoredAsKyen()      1150行  収支補完（千円）データの判定
   - normalizeDatasetForDisplay() 1154行  千円→円の表示用換算
   - applyDeletionTombstonesToState() 497行  STATE.datasetsからTombstone対象を除去（STATEを直接書き換える）
   - dataDeleteKey()             463行  削除キー生成 `${ym}_${type}`
   - isDeletedSince()            491行  指定キーが指定時刻以降に削除されたか
   - fiscalYearFromYM()         1463行  年月→年度（CONFIG.FISCAL_STARTに依存）

■ 調査結果と判断が必要な箇所（推測で実装していない点）

   1. tombstone適用は「STATEを書き換える関数」でしか提供されていない
      applyDeletionTombstonesToState() は STATE.datasets を
      target.datasets = target.datasets.filter(...) という形で
      直接書き換える設計になっている（app.js 500-514行）。
      DatasetRepositoryはSTATE変更禁止のため、この関数はそのまま呼べない。
      → 対応：フィルタ条件（dataDeleteKey/isDeletedSince/fiscalYearFromYM
        を使った判定式）だけを読み取り専用で再現し、STATEへの書き戻しは
        行わない実装とした。

   2. fiscalYearFromYM() は CONFIG.FISCAL_START（現在4月）と
      getDefaultFiscalYear()（現在日時）に依存している
      「収支補完（history）」データのtombstone判定にのみ必要。
      この関数を本ファイル内に独自複製すると、将来CONFIG.FISCAL_START
      が変更された場合に本Repositoryだけ古い仕様のまま取り残される
      （ロジック二重管理・乖離のリスク）と判断した。
      → 対応：複製せず、window.fiscalYearFromYM が実際に存在する場合
        のみ呼び出す設計とした。存在しない場合（＝本ファイル単体を
        app.js無しで読み込んだ場合）は、history種別のtombstone判定を
        スキップする（＝安全側＝除外されるべきデータが除外されない
        方向にのみ倒れる）。これは「差異が生まれ得る」ため、⑥で
        明記する。
      要判断：この依存を許容するか、それとも fiscalYearFromYM 相当を
      本ファイルへ複製すべきか、方針を確定していただきたい。

   3. findByKey()の「tombstone適用有無」は既存コードに前例がない
      既存コードには「tombstone適用済みのfindByKey」に相当する関数が
      存在しない（upsertDataset内のfindIndexはtombstone非適用、
      activeDatasetByYMはtombstone適用のactiveDatasets()経由）。
      → 対応：findByKey()はupsertDataset()のfindIndex述語をそのまま
        踏襲し、tombstone非適用（生のSTATE.datasetsを検索）とした。
        tombstone適用検索が必要な場合は getActive() の結果に対して
        呼び出し側でym一致を探す（=activeDatasetByYMと同じ経路）
        こと。

==============================================================================
*/
'use strict';

(function () {
    if (window.__DATASET_REPOSITORY_MODULE_LOADED__) {
        console.warn('[DatasetRepository] already loaded.');
        return;
    }
    window.__DATASET_REPOSITORY_MODULE_LOADED__ = true;

    /* ====================================================================
       内部ヘルパー（private）
       ==================================================================== */

    /**
     * Dataset識別用の複合キーを生成する（ログ・デバッグ表示用途）。
     * 実際の検索比較には使わず、findByKey()はupsertDataset()と同じ
     * 述語（下記_matchesKey）で直接比較する。
     */
    function _makeKey(ym, type, source) {
        const t = type || 'confirmed';
        const s = source === 'history' ? 'history' : 'csv';
        return `${ym}_${t}_${s}`;
    }

    /**
     * 将来のDataset Identity改善（専用ID）用のプレースホルダー。
     * Phase3-3-3では未使用のまま維持する（ID導入は別フェーズ）。
     */
    function _generateId(ym, type, source) {
        // TODO(V3): 未実装。呼び出し元が無いことを確認しながら段階的に実装する。
        return null;
    }

    /**
     * app.js の upsertDataset() 内で使われている複合キー判定述語を
     * そのまま踏襲する（790-797行を参照）。
     */
    function _matchesKey(d, ym, type, source) {
        if (!d) return false;
        const t = type || 'confirmed';
        const sourceKey = source === 'history' ? 'history' : 'csv';
        const dSourceKey = d.source === 'history' ? 'history' : 'csv';
        return d.ym === ym && (d.type || 'confirmed') === t && dSourceKey === sourceKey;
    }

    /**
     * app.js の datasetSourceKind()（1169行）を忠実に複製したもの。
     * 外部依存が無い純粋関数のため、複製してもロジック乖離のリスクは低いと判断した。
     */
    function _sourceKindOf(ds) {
        if (!ds) return 'none';
        if (ds.source === 'history') return 'history';
        if (ds.type === 'daily') return 'daily';
        if (ds.source === 'csv' || !ds.source) return 'confirmed';
        return ds.type || ds.source || 'confirmed';
    }

    /**
     * app.js の datasetPriority()（1183行）を忠実に複製したもの。
     * confirmed=30 > daily=20 > history=10 > その他=0
     */
    function _priorityOf(dataset) {
        const kind = _sourceKindOf(dataset);
        if (kind === 'confirmed') return 30;
        if (kind === 'daily') return 20;
        if (kind === 'history') return 10;
        return 0;
    }

    /**
     * app.js の n()（759行）を忠実に複製したもの（数値変換）。
     */
    function _n(v) {
        return typeof v === 'number' ? v : (parseFloat(v) || 0);
    }

    /**
     * app.js の datasetStoredAsKyen()（1150行）を忠実に複製したもの。
     */
    function _isStoredAsKyen(ds) {
        if (!ds) return false;
        return ds.source === 'history' || String(ds.unit || '').includes('千円');
    }

    /**
     * app.js の normalizeDatasetForDisplay()（1154行）を忠実に複製したもの。
     * 千円保存データを円換算した「コピー」を返す。元データ（STATE.datasets
     * の要素）は変更しない。
     */
    function _normalizeForDisplay(ds) {
        if (!_isStoredAsKyen(ds)) return ds;
        const out = { ...ds, _displayNormalizedFromKyen: true };
        ['totalIncome', 'totalExpense', 'profit', 'laborCost', 'fixedCost', 'varCost'].forEach(k => {
            if (out[k] != null && !isNaN(out[k])) out[k] = _n(out[k]) * 1000;
        });
        if (ds.rows && typeof ds.rows === 'object') {
            out.rows = {};
            Object.keys(ds.rows).forEach(k => { out.rows[k] = _n(ds.rows[k]) * 1000; });
        }
        return out;
    }

    /**
     * app.js の applyDeletionTombstonesToState()（497-515行）のうち、
     * datasets部分の「除外すべきか」の判定条件のみを読み取り専用で再現する。
     * STATEへの書き戻しは行わない。
     *
     * 依存する外部関数（window.dataDeleteKey / window.isDeletedSince /
     * window.fiscalYearFromYM）が存在しない場合は、判定不能として
     * 「削除されていない」扱い（=除外しない）にフォールバックする。
     * これは安全側（表示されすぎる方向）へのフォールバックであり、
     * 「表示されなさすぎる」方向の誤りは発生しない設計としている。
     */
    function _isTombstoned(ds, deletedState) {
        if (!ds || !ds.ym) return true; // 元のfilterと同じく、ym欠損は除外対象
        const source = ds.source || 'csv';
        const time = ds.importedAt || ds.updatedAt || ds.savedAt || '';

        if (source === 'history') {
            if (typeof window.fiscalYearFromYM !== 'function') {
                // fiscalYearFromYMが無いと年度別tombstone判定ができないため、
                // 安全側（除外しない）にフォールバックする。
                return false;
            }
            const fy = String(ds.fiscalYear || window.fiscalYearFromYM(ds.ym));
            if (deletedState && deletedState.historyFiscalYears && deletedState.historyFiscalYears[fy]) return true;
            if (deletedState && deletedState.historyMonths && deletedState.historyMonths[ds.ym]) return true;
            return false;
        }

        if (typeof window.dataDeleteKey !== 'function' || typeof window.isDeletedSince !== 'function') {
            // 判定に必要な関数が無い場合は安全側（除外しない）にフォールバックする。
            return false;
        }
        const key = window.dataDeleteKey(ds.ym, ds.type || 'confirmed');
        return window.isDeletedSince('datasets', key, time);
    }

    /* ====================================================================
       公開API
       ==================================================================== */

    window.DATASET_REPOSITORY = {

        /**
         * 全Datasetを取得する（複製した配列。STATE.datasets自体は変更されない）。
         * 配列はコピーして返すが、Datasetオブジェクト自体は同一参照のまま返す
         * （浅いコピー）。
         *
         * 浅いコピーを選んだ理由：既存の activeDatasets() 自体が
         * Object.values(map) で新しい配列を作るのみで、個々のDatasetオブジェクト
         * はSTATE.datasets内と同一参照のまま扱っている（正規化が必要な場合のみ
         * normalizeDatasetForDisplayが新しいオブジェクトを作る）。この既存動作に
         * 合わせ、DatasetRepositoryでも配列レベルの浅いコピーのみとした。
         * Datasetオブジェクト自体のdeep cloneは既存利用箇所（例えば呼び出し元が
         * 参照だけ保持して後でSTATE側の変更を追跡する処理があるかもしれない）
         * との整合性が未調査のため、今回は追加していない。
         */
        getAll() {
            if (!window.STATE || !Array.isArray(window.STATE.datasets)) return [];
            return window.STATE.datasets.slice();
        },

        /**
         * 複合キー (ym, type, source) でDatasetを検索する。
         * app.js upsertDataset() のfindIndex述語と同一の比較ロジックを使用。
         * tombstoneは適用しない（upsertDataset自体が非適用のため、既存の
         * 挙動に合わせた）。
         */
        findByKey(ym, type, source) {
            const list = this.getAll();
            for (let i = 0; i < list.length; i++) {
                if (_matchesKey(list[i], ym, type, source)) return list[i];
            }
            return null;
        },

        /**
         * 現在有効なDataset一覧を返す（ym単位で最優先の1件のみ）。
         * app.js activeDatasets()（1192-1212行）と同じロジック：
         *   1. Tombstone適用（除外判定のみ、STATE書き換えなし）
         *   2. ym毎に datasetPriority が最大のものを採用
         *      （同点の場合は importedAt が新しい方を採用）
         *   3. ym昇順にソート
         *   4. normalizeDatasetForDisplay を適用（千円→円換算）
         */
        getActive() {
            if (!window.STATE || !Array.isArray(window.STATE.datasets)) return [];

            const deletedState = (window.STATE && window.STATE.deleted) || {};
            const source = window.STATE.datasets.filter(d => !_isTombstoned(d, deletedState));

            const map = {};
            for (const d of source) {
                if (!d || !d.ym) continue;
                const current = map[d.ym];
                if (!current) {
                    map[d.ym] = d;
                    continue;
                }
                const curPriority = _priorityOf(current);
                const newPriority = _priorityOf(d);
                if (newPriority > curPriority) {
                    map[d.ym] = d;
                } else if (newPriority === curPriority && String(d.importedAt || '') > String(current.importedAt || '')) {
                    map[d.ym] = d;
                }
            }
            return Object.values(map)
                .sort((a, b) => a.ym.localeCompare(b.ym))
                .map(_normalizeForDisplay);
        },

        /**
         * Datasetの優先順位を返す（confirmed=30 > daily=20 > history=10 > その他=0）。
         * app.js datasetPriority() と同一ロジック。
         */
        priorityOf(dataset) {
            return _priorityOf(dataset);
        },

        /**
         * Datasetを追加・更新する。
         * TODO(V3): 未実装（Phase3-3-3では読み取り系のみ実装）
         */
        upsert(dataset) {
            // TODO(V3): 未実装
        },

        /**
         * 条件に一致するDatasetを削除する。
         * TODO(V3): 未実装（Phase3-3-3では読み取り系のみ実装）
         */
        remove(predicate) {
            // TODO(V3): 未実装
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: { _makeKey, _generateId, _priorityOf, _matchesKey, _sourceKindOf, _isStoredAsKyen, _normalizeForDisplay, _isTombstoned }
    };

})();
