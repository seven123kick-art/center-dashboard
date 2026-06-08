# 経営管理システム ファイル構造

## 目的

GitHub Pages にそのまま配置できるよう、ルート直下に散らばっていた JS / CSS / ライブラリ / 郵便番号データを整理した構成です。

## 配置

```text
center-dashboard/
├─ index.html
├─ center.html
├─ kitasaitama.html
├─ toda.html
│
├─ assets/
│  ├─ css/
│  │  └─ app.css
│  ├─ libs/
│  │  └─ docx.iife.js
│  └─ data/
│     ├─ jp_zip_loader.js
│     └─ zip_parts/
│        └─ jp_zip_00.js ... jp_zip_97.js
│
├─ config/
│  ├─ config.template.js
│  └─ config.local.js
│
├─ src/
│  ├─ app.js
│  ├─ core/
│  │  ├─ store.js
│  │  ├─ cloud.js
│  │  └─ auto_sync.js
│  ├─ modules/
│  │  ├─ dashboard.js
│  │  ├─ pl.js
│  │  ├─ trend.js
│  │  ├─ shipper.js
│  │  ├─ kamoku.js
│  │  ├─ report.js
│  │  ├─ capacity.js
│  │  └─ ai_gen.js
│  └─ field/
│     ├─ field_core.js
│     ├─ field_worker.js
│     ├─ field_content.js
│     ├─ field_task.js
│     ├─ field_product.js
│     ├─ field_area.js
│     └─ field_capacity.js
│
└─ docs/
   ├─ README_OLD.md
   └─ PROJECT_STRUCTURE_OLD.md
```

## 読込順

`center.html` の末尾で以下の順番で読み込みます。

1. `src/app.js`
2. `src/core/store.js`
3. `src/core/cloud.js`
4. `src/core/auto_sync.js`
5. `src/modules/*.js`
6. `src/field/*.js`
7. `assets/data/jp_zip_loader.js`
8. `src/field/field_area.js`

## 注意

- GitHub側で旧ファイルを削除してから、このZIPの中身をルートへ配置してください。
- 旧ルート直下の `app.js`, `app.css`, `dashboard.js`, `field_*.js`, `zip_parts/` などは不要です。
- `center.html` 内に現在のSupabase publishable key設定が残っています。
- `service_role` や `sb_secret` は含めていません。
