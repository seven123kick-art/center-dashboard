# GitHub投入手順

1. 既存リポジトリ内の旧JS/CSSファイルを削除します。
2. このZIPの中身をリポジトリ直下へ展開します。
3. `center.html` が `config/config.local.js` を読み込みます。
4. GitHub Pagesで公開後、以下を確認します。

- `index.html` からセンター選択できる
- `center.html?c=kitasaitama` が開く
- `center.html?c=toda` が開く
- ダッシュボード、データ管理、現場分析、エリア分析、会議報告書が開く

## 注意

`service_role` や `sb_secret` 絶対に入れないでください。
フロントで使うのは Supabase の publishable key / anon public key のみです。
