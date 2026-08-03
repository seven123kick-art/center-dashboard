/*
==============================================================================
Module
    StorageRepository

責務
    localStorage / IndexedDB への永続化アクセスを将来的に一元化するための
    受け皿。現行の core/store.js（STORE）および app.js内 IDB_CACHE の
    役割を、Version3で「Storage」という1つの責務としてまとめる際の
    置き換え先となる。

    現時点では load() が既存画面へ接続済み（Version5 Phase2-B、下記参照）。
    save() / getCached() / setCached()は引き続き未接続（既存画面からは
    呼ばれない）。STORE.save() / STORE.load() / IDB_CACHE.* は本ファイル
    作成後も一切変更せず、そのまま既存の場所に残っている。

    【Version5 Phase1で実装済み】
    save()/load()/getCached()/setCached()の4メソッドを、既存の
    STORE.save()/STORE.load()/IDB_CACHE.get()/IDB_CACHE.set()を
    そのまま呼ぶだけの薄い委譲ラッパーとして実装した。
    既存ロジックの再実装・複製は一切行っていない。
    今回もどこからも呼ばれていない（未接続のまま）。

    【Version5 Phase2でload()を検証・正式窓口として確定】
    STORE.load()の呼び出し元（BOOT処理、restoreAll()の2箇所）・
    副作用（STATE 15プロパティへの書き込み、sanitizePersonalDataState・
    applyDeletionTombstonesToStateの呼び出し）を調査した上で、
    StorageRepository.load()がSTORE.load()と完全に同一のSTATE結果を
    生成することをNode.js比較で確認した（詳細はCHANGELOG参照）。
    load()のコード自体はPhase1から1文字も変更していない
    （既にSTORE.load()への直接委譲であり、変更の必要がなかったため）。

    【Version5 Phase2-Bでload()を実利用へ接続】
    app.js側の実呼び出し2箇所（BOOT処理、restoreAll()）を
    STORE.load()からRepository.Storage.load()へ置き換えた。
    これによりapp.jsからSTORE.load()を直接呼ぶ箇所は0件になり、
    StorageRepository.load()内部からの委譲呼び出し1件のみが残っている。

依存
    load()：STORE（core/store.js）への薄い委譲依存あり（実利用中）。
    save() / getCached() / setCached()：STORE（core/store.js）・
    IDB_CACHE（app.js）への薄い委譲を実装済みだが、呼び出し元は
    まだ接続していない。

公開API
    window.STORAGE_REPOSITORY
    （load()はRepository.Storage.load()として実利用中。
    save()/getCached()/setCached()は実装済みだが未接続）

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V5)
    - STORE.save() を本Repository経由に置き換える（load()はPhase2-Bで
      完了済み。save()は46箇所という多数の呼び出し元があるため、
      別フェーズで慎重に進める）
    - IDB_CACHE（現在app.js内、field_core.js/store.js/cloud.jsが直接依存）を
      本Repositoryの内部実装として吸収し、正式な公開APIとして再整理する
    - localStorage・IndexedDB・Supabaseの役割分担はPhase4-0調査で
      既に確定済み：localStorage＝軽量索引・小規模設定値、
      IndexedDB＝Dataset等本体の表示用キャッシュ、
      Supabase＝業務データ（Dataset等）の正本。
      ただしCloud接続設定・クライアントID・デバッグフラグ等の
      端末固有設定はlocalStorageそのものが正本であり、Supabase側には
      保存されない（Phase4-0で確認済み、混同しないよう注意）
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
