/**
 * config.local.js
 * GitHub Pages から Supabase へ接続する公開用設定。
 * service_role / sb_secret は絶対に入れない。
 */
window.SUPABASE_CONFIG = {
  url:    "https://oeeouxbwqsjbirluzyqh.supabase.co",
  key:    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lZW91eGJ3cXNqYmlybHV6eXFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NjQ4MzYsImV4cCI6MjA5MjQ0MDgzNn0.VsULt25QpQLSrRaieNm549KUix_EOt9jR7jJ1BOzAog",
  bucket: "center-data",
};
