/*
==============================================================================
Module
    Repository (Registry)

責務
    DATASET_REPOSITORY / STORAGE_REPOSITORY / CLOUD_REPOSITORY /
    SYNC_COORDINATOR という4つの個別グローバルを、
    window.Repository という単一の名前空間へ集約して公開する窓口。

    Version3完成形では、利用側は下記のみを使う設計とする：
      Repository.Dataset
      Repository.Storage
      Repository.Cloud
      Repository.Sync

    今後Repositoryが増えても、windowへ直接追加せず、必ずこの
    window.Repository 名前空間の下へ追加すること。

    現時点ではまだ何もリンクしていない（既存画面からは一切呼ばれない）。
    dataset_repository.js / storage_repository.js / cloud_repository.js /
    sync_coordinator.js の中身は本ファイル作成にあたり一切変更していない。

依存
    window.DATASET_REPOSITORY（src/core/repository/dataset_repository.js）
    window.STORAGE_REPOSITORY（src/core/repository/storage_repository.js）
    window.CLOUD_REPOSITORY（src/core/repository/cloud_repository.js）
    window.SYNC_COORDINATOR（src/core/repository/sync_coordinator.js）

    ※ getter経由で参照するため、本ファイルが上記4ファイルより先に
    読み込まれた場合でも、後から読み込まれた実体を正しく参照できる
    （読込順に依存しない設計）。

公開API
    window.Repository = { Dataset, Storage, Cloud, Sync }

互換API
    window.DATASET_REPOSITORY
    window.STORAGE_REPOSITORY
    window.CLOUD_REPOSITORY
    window.SYNC_COORDINATOR
    （いずれも削除せず、Registry導入後も両方の参照方法を許可する。
    開発期間中の互換性維持が目的。Version3完成時に、利用側が全て
    Repository.Dataset 形式に統一された段階で、これら4つの個別
    グローバルは削除候補となる）

更新日
    2026-07-25

TODO(V3)
    - 利用側のコードが全て Repository.Dataset 等の形式に移行し終えたら、
      互換API（4つの個別window変数）を削除する
    - Repositoryが新たに増えた場合（例：ConfigRepository等）、
      本ファイルへ Repository.Config のようにgetterを追加する

==============================================================================
   ■ Repository間 依存ルール（設計方針。本ファイルはこのルールを
     強制するものではなく、ドキュメントとして明記するもの）
==============================================================================
   DatasetRepository ・ StorageRepository ・ CloudRepository は、
   互いを直接呼び出してはならない。
     ✕ DatasetRepository → StorageRepository
     ✕ CloudRepository   → DatasetRepository
     ✕ StorageRepository → CloudRepository
   3者間の調整（同期処理等）は、必ず SyncCoordinator（Repository.Sync）
   のみが仲介する。Repository間の相互参照を知っているのは
   SyncCoordinatorだけ、という設計を維持すること。
==============================================================================
*/
'use strict';

(function () {
    if (window.__REPOSITORY_REGISTRY_MODULE_LOADED__) {
        console.warn('[Repository Registry] already loaded.');
        return;
    }
    window.__REPOSITORY_REGISTRY_MODULE_LOADED__ = true;

    // getterで参照することで、本ファイルの読み込みタイミングに関わらず
    // 常にその時点でのwindow.DATASET_REPOSITORY等の実体を返す。
    // （オブジェクトリテラルで一度だけ代入すると、読込順によっては
    //   undefinedを固定してしまうため、意図的にgetterを採用した）
    window.Repository = {
        get Dataset() { return window.DATASET_REPOSITORY; },
        get Storage() { return window.STORAGE_REPOSITORY; },
        get Cloud() { return window.CLOUD_REPOSITORY; },
        get Sync() { return window.SYNC_COORDINATOR; }
    };

})();
