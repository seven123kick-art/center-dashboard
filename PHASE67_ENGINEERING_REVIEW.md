# Phase67 エンジニアリングレビュー

## 結論
現在の課題は、個別機能ではなく「データ正本・キャッシュ・表示状態」の境界が曖昧なことです。
今回の修正では、Supabaseを正本、IndexedDBをPC内高速キャッシュ、localStorageを軽量設定のみに寄せました。

## 実施した修正
- localStorageへ大容量CSV本体を保存しないよう変更
- IndexedDBキャッシュを追加
- 起動時にIndexedDBキャッシュを先読み
- Supabase読込を正本として維持
- fiscalYear復元値を初期化処理で上書きしないよう修正
- pullInitialForBootの年度判定を全manifest月から構築
- 月別データ取得を並列から直列へ変更
- 古いmanifest.deletedを起動時にマージしない方針へ変更
- 起動セーフティタイマーを45秒へ延長し、読込中の空表示を減らす

## 今後の改善方針
- app.jsを分割し、state / cloud / import / view に責務分離
- エリア分析の集計結果キャッシュを追加
- 画面共通のLoading/Empty/Error状態コンポーネントを作成
- 旧shared_bundle・旧localStorage互換処理を段階削除
