/**
 * config.template.js
 * このファイルはGitで管理するテンプレートです。
 *
 * セットアップ手順:
 *   1. このファイルを config.local.js という名前でコピーする
 *   2. コピーしたファイルに Supabase の接続情報を記入する
 *   3. config.local.js は .gitignore で除外済みのため、コミットされません
 *
 * cp config.template.js config.local.js
 */
window.SUPABASE_CONFIG = {
  url:    '',  // 例: https://xxxxxxxxxxxxxx.supabase.co
  key:    '',  // Supabase > Project Settings > API > anon public キー
  bucket: 'center-data',
};
