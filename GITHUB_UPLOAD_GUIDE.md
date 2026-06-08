# GitHub投入手順

1. GitHub上で旧ファイルを削除します。
   - 旧 `app.js`
   - 旧 `app.css`
   - 旧 `dashboard.js`, `pl.js`, `trend.js`, `shipper.js`, `kamoku.js`
   - 旧 `field_*.js`
   - 旧 `jp_zip_loader.js`
   - 旧 `zip_parts/`
   - 旧 `core/` がある場合

2. このZIPを展開し、中身をリポジトリのルートへアップロードします。

3. GitHub Pages反映後、以下を確認します。
   - `center.html?c=kitasaitama`
   - `center.html?c=toda`
   - ダッシュボード
   - データ取込
   - 現場分析
   - エリア分析
   - 会議報告書

4. もし画面が真っ白になる場合は、DevTools Consoleで404になっているファイルパスを確認してください。
