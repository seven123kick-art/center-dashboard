# 経営管理システム ファイル構造整理（Phase34）

## 方針

- `app.js` は画面共通・CSV解析・基本集計・画面遷移を担当。
- `core/` は保存・クラウド・同期など基盤処理を担当。
- 既存の分析モジュールは現時点ではルート配置を維持し、次段階で `views/` 配下へ移動する。
- localStorage は設定・軽量キャッシュ中心、正式保存は Supabase DB の `center_realtime_state` を使用する。

## 今回分離したファイル

| ファイル | 役割 |
|---|---|
| `core/store.js` | ローカル設定・バックアップ・軽量キャッシュ管理 |
| `core/cloud.js` | Supabase DB保存・取得・旧shared_bundle互換 |
| `core/auto_sync.js` | 保存後の自動同期予約・同期抑制 |
| `app.js` | 共通処理、CSV解析、画面遷移、主要UI |

## 次段階で移動候補

| 現在 | 将来 |
|---|---|
| `dashboard.js` | `views/dashboard.js` |
| `pl.js` | `views/pl.js` |
| `trend.js` | `views/trend.js` |
| `shipper.js` | `views/shipper.js` |
| `kamoku.js` | `views/kamoku.js` |
| `field_*.js` | `views/field/*.js` |
| `docx.iife.js` | `libs/docx.iife.js` |
| `zip_parts/` | `assets/zip_parts/` |

## 注意

現段階では読み込み順の安全性を優先し、分析モジュールのパス移動は行っていない。
`center.html` では `app.js` の直後に `core/store.js`、`core/cloud.js`、`core/auto_sync.js` を読み込む。
