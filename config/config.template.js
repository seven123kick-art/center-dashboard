/**
 * config.template.js  —  Gitで管理するテンプレート。
 *
 * セットアップ:
 *   cp config.template.js config.local.js
 *   → config.local.js に Supabase の接続情報を記入
 *
 * config.local.js は .gitignore 除外済み。各自のPCで作成してください。
 */
window.SUPABASE_CONFIG = {
  url:    '',  // https://xxxxxx.supabase.co
  key:    '',  // Project Settings > API > anon public
  bucket: 'center-data',
};
