# 経営管理システム v4.0

エスラインギフ 家電物流事業部 センター別経営管理ダッシュボード

---

## セットアップ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/your-org/center-dashboard.git
cd center-dashboard
```

### 2. Supabase 接続設定（初回のみ）

**`config.local.js` は `.gitignore` で除外されているため、各自のPCで作成する必要があります。**

```bash
# テンプレートをコピーして作成
cp config.template.js config.local.js
```

作成した `config.local.js` を開き、Supabase の接続情報を記入します：

```js
window.SUPABASE_CONFIG = {
  url:    'https://xxxxxxxxxxxxxx.supabase.co',  // Project URL
  key:    'eyJhbG...',                           // anon public キー
  bucket: 'center-data',
};
```

Supabase の接続情報は **Project Settings → API** で確認できます。

> ⚠️ `config.local.js` は絶対に Git にコミットしないでください。  
> `.gitignore` で除外済みですが、`git add -f` などで強制追加しないよう注意してください。

### 3. ブラウザで開く

```
index.html  → センター選択画面
center.html?c=kitasaitama  → 北埼玉センター
center.html?c=toda         → 戸田センター
```

---

## ストレージについて

| 方式 | 用途 | 容量 |
|------|------|------|
| IndexedDB（Dexie.js） | CSVデータ・分析結果・メモ等のローカル保存 | ほぼ無制限（数GBまで） |
| Supabase Storage | センター間・PC間のクラウド同期 | Supabaseプランに依存 |

旧バージョン（localStorage）のデータがある場合は、起動時に自動でIndexedDBへ移行されます。

---

## ファイル構成

```
center-dashboard/
├── index.html          # センター選択画面
├── center.html         # メイン画面（全センター共通）
├── toda.html           # 戸田センターへのリダイレクト
├── kitasaitama.html    # 北埼玉センターへのリダイレクト
│
├── app.js              # メインロジック（6,000行超）
├── dashboard.js        # ダッシュボード描画
├── pl.js               # 月次収支表
├── trend.js            # 売上推移
├── shipper.js          # 荷主分析
├── field_*.js          # 現場分析モジュール
│
├── app.css             # スタイル
│
├── config.template.js  # ★ Supabase設定テンプレート（Gitで管理）
├── config.local.js     # ★ Supabase設定（.gitignore除外・各自で作成）
│
├── jp_zip_loader.js    # 郵便番号マスタ 遅延ローダー
└── zip_parts/          # 郵便番号マスタ 分割ファイル（98個）
```

---

## 開発ルール

### コミット禁止ファイル
- `config.local.js` — Supabaseキーを含む。**絶対にコミットしない。**

### データ更新フロー
1. CSVをインポート → IndexedDBに保存 → 自動でSupabaseへ同期
2. 別PCで開くと → Supabaseから最新データを取得 → IndexedDBに反映

### バックアップ
- サイドバー下部の「↓ 書出」ボタン → JSONファイルとしてエクスポート
- 「↑ 復元」ボタン → JSONから復元

---

## GitHub Pages での公開

1. GitHub リポジトリの Settings → Pages → Source を `main` ブランチに設定
2. `config.local.js` は含まれないため、GitHub Pages では Supabase同期が無効になります
3. 社内共有はローカルファイルとして配布するか、サーバーに置いてください

---

## 更新履歴

| バージョン | 内容 |
|-----------|------|
| v4.1 | ストレージをIndexedDB（Dexie.js）に移行。Supabaseキーを config.local.js に外出し。 |
| v4.0 | センター別データ分離、クラウド同期、会議報告書AI生成 |
