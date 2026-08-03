/*
==============================================================================
Module
    StorageRepository

責務
    localStorage / IndexedDB への永続化アクセスを将来的に一元化するための
    受け皿。現行の core/store.js（STORE）および app.js内 IDB_CACHE の
    役割を、Version3で「Storage」という1つの責務としてまとめる際の
    置き換え先となる。

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。
    STORE.save() / STORE.load() / IDB_CACHE.* は本ファイル作成後も
    一切変更せず、そのまま既存の場所に残っている。

    【Version5 Phase1で実装済み】
    save()/load()/getCached()/setCached()の4メソッドを、既存の
    STORE.save()/STORE.load()/IDB_CACHE.get()/IDB_CACHE.set()を
    そのまま呼ぶだけの薄い委譲ラッパーとして実装した。
    既存ロジックの再実装・複製は一切行っていない。
    今回もどこからも呼ばれていない（未接続のまま）。

依存
    現時点ではなし。
    将来的な移行時は STORE（core/store.js）・IDB_CACHE（app.js）を
    参照する想定。

公開API（将来使用予定。現時点では未呼び出し）
    window.STORAGE_REPOSITORY

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V3)
    - STORE.save()/load() を本Repository経由に置き換える
    - IDB_CACHE（現在app.js内、field_core.js/store.js/cloud.jsが直接依存）を
      本Repositoryの内部実装として吸収し、正式な公開APIとして再整理する
    - localStorageとIndexedDBの二重保存の実態（Phase4-4調査で「要確認」と
      した点）を明確にした上で、本Repositoryが「どちらに何を保存するか」
      の判断を一元的に持つようにする
==============================================================================
*/
'use strict';

(function () {
    if (window.__STORAGE_REPOSITORY_MODULE_LOADED__) {
        console.warn('[StorageRepository] already loaded.');
        return;
    }
    window.__STORAGE_REPOSITORY_MODULE_LOADED__ = true;

    /* ====================================================================
       内部ヘルパー（private）
       ==================================================================== */

    /**
     * localStorageキーの命名規則を一元管理するためのプレースホルダー。
     * 現行の STORE._p（core/store.js内、キー接頭辞）に相当する。
     * TODO(V3): 実装時はSTORE._pの値と完全一致させ、既存データとの
     * 互換性を保つこと。
     */
    function _localStorageKeyPrefix() {
        // TODO(V3): 未実装。STORE._p を参照する形にする。
        return '';
    }

    /**
     * IndexedDBのDB名・store名を一元管理するためのプレースホルダー。
     * TODO(V3): 実装時は既存のIDB_CACHE内部実装（app.js §13）の定義と
     * 完全一致させること。
     */
    function _indexedDbConfig() {
        // TODO(V3): 未実装
        return { dbName: null, storeName: null };
    }

    /* ====================================================================
       公開API（将来使用予定）
       現時点ではいずれも「未接続」の状態で定義のみ行う。
       localStorage/IndexedDBへは一切アクセスしない（今回のルール厳守）。
       ==================================================================== */

    window.STORAGE_REPOSITORY = {

        /**
         * STATE全体（または指定領域）をlocalStorageへ保存する。
         * 現行の STORE.save()（core/store.js）に相当する将来の置き換え先。
         * Version5 Phase1：既存のSTORE.save()をそのまま呼ぶだけの薄い
         * 委譲ラッパー。46箇所の既存呼び出し元・STORE.save()自体のロジックは
         * 一切変更していない。今回はどこからも呼ばれていない（未接続）。
         */
        save() {
            if (typeof window.STORE === 'undefined' || typeof STORE.save !== 'function') {
                throw new Error('[StorageRepository] STORE.save is required but not available. Check script load order.');
            }
            return STORE.save();
        },

        /**
         * localStorageからSTATEを復元する。
         * 現行の STORE.load()（core/store.js）に相当する将来の置き換え先。
         * Version5 Phase1：既存のSTORE.load()をそのまま呼ぶだけの薄い
         * 委譲ラッパー。
         */
        load() {
            if (typeof window.STORE === 'undefined' || typeof STORE.load !== 'function') {
                throw new Error('[StorageRepository] STORE.load is required but not available. Check script load order.');
            }
            return STORE.load();
        },

        /**
         * IndexedDBキャッシュから指定キーの値を取得する。
         * 現行の IDB_CACHE.get()（app.js）に相当する将来の置き換え先。
         * Version5 Phase1：既存のIDB_CACHE.get()をそのまま呼ぶだけの
         * 薄い委譲ラッパー。
         */
        async getCached(kind, key) {
            if (typeof window.IDB_CACHE === 'undefined' || typeof IDB_CACHE.get !== 'function') {
                throw new Error('[StorageRepository] IDB_CACHE.get is required but not available. Check script load order.');
            }
            return IDB_CACHE.get(kind, key);
        },

        /**
         * IndexedDBキャッシュへ書き込む。
         * 現行の IDB_CACHE.set()（app.js）に相当する将来の置き換え先。
         * Version5 Phase1：既存のIDB_CACHE.set()をそのまま呼ぶだけの
         * 薄い委譲ラッパー。
         */
        async setCached(kind, key, value) {
            if (typeof window.IDB_CACHE === 'undefined' || typeof IDB_CACHE.set !== 'function') {
                throw new Error('[StorageRepository] IDB_CACHE.set is required but not available. Check script load order.');
            }
            return IDB_CACHE.set(kind, key, value);
        },

        /**
         * 内部ヘルパーを外部からのテスト等で使えるように限定公開する。
         */
        _internal: { _localStorageKeyPrefix, _indexedDbConfig }
    };

})();
