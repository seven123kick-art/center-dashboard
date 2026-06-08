# 経営管理システム ファイル構成

## ルート
- `index.html`：センター選択
- `center.html`：メイン画面
- `kitasaitama.html` / `toda.html`：センター固定起動

## config
- `config/config.local.js`：Supabase接続設定（GitHub Pages運用では publishable key のみ記載）
- `config/config.template.js`：設定テンプレート

## assets
- `assets/css/app.css`：共通CSS
- `assets/libs/docx.iife.js`：Word出力ライブラリ（動的読込）
- `assets/data/jp_zip_loader.js` / `assets/data/zip_parts/`：郵便番号マスタ

## src/core
- `store.js`：状態保存・復元
- `cloud.js`：Supabase接続・DB保存/読込
- `auto_sync.js`：自動同期制御

## src/modules
- `dashboard.js`：ダッシュボード補助
- `pl.js`：月次収支
- `trend.js`：推移
- `shipper.js`：荷主分析
- `kamoku.js`：科目分析

※ `capacity` と `report` は現時点では `src/app.js` 内に残しています。次フェーズで単独分離予定です。

## src/field
- `field_core.js`：現場分析共通
- `field_worker.js`：作業者分析
- `field_content.js`：作業内容分析
- `field_task.js`：タスク/作業分類
- `field_product.js`：商品カテゴリ分析
- `field_area.js`：エリア分析
- `field_capacity.js`：互換スタブ
