/*
==============================================================================
Module
    Loader

責務
    外部スクリプトの読込
    画面モジュールの初期化
    ドロップゾーン初期化
    計画データ取込ボタンの登録

依存
    PLAN
    document
    window

公開API
    window.LOADER

互換API
    window.setupDropZone
    window.setupPlanImport
    window.loadExternalScriptOnce
    window.loadScreenModules

更新日
    2026-07-25

TODO(V3)
    互換API削除
==============================================================================
*/
'use strict';

(function () {
    if (window.__LOADER_MODULE_LOADED__) {
        console.warn('[Loader] already loaded.');
        return;
    }
    window.__LOADER_MODULE_LOADED__ = true;

/* ════════ §28 アップロードゾーン設定 ══════════════════════════ */
function setupDropZone(zoneId, inputId, handler) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.onclick = () => input.click();
  input.onchange = () => { if(input.files.length) handler(input.files); input.value=''; };

  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files.length) handler(e.dataTransfer.files);
  };
}


/* ════════ §29-A AUTO SYNC は core/auto_sync.js へ分離 ════════ */

/* ════════ §29 計画データ取込 ══════════════════════════════════ */
function setupPlanImport() {
  const btn = document.getElementById('plan-import-btn');
  if (btn) btn.onclick = () => PLAN.importFromPaste();
}

/* ════════ §30-A SCREEN MODULE LOADER ════════════════════════════════ */
function loadExternalScriptOnce(id, src) {
  if (document.getElementById(id)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.defer = true;
    el.onload = () => resolve(true);
    el.onerror = () => reject(new Error(src + ' の読み込みに失敗しました'));
    document.head.appendChild(el);
  });
}

async function loadScreenModules() {
  await loadExternalScriptOnce('module-shipper', 'src/modules/shipper.js');
}

  // 正式API：責務単位オブジェクト
  window.LOADER = {
    setupDropZone,
    setupPlanImport,
    loadExternalScriptOnce,
    loadScreenModules
  };

  // 互換API（app.js §18 BOOTからのbare関数呼び出し維持のため）
  // TODO(V3)
  // app.js移行完了後に削除予定
  window.setupDropZone = function (zoneId, inputId, handler) {
    return window.LOADER.setupDropZone(zoneId, inputId, handler);
  };
  window.setupPlanImport = function () {
    return window.LOADER.setupPlanImport();
  };
  window.loadExternalScriptOnce = function (id, src) {
    return window.LOADER.loadExternalScriptOnce(id, src);
  };
  window.loadScreenModules = function () {
    return window.LOADER.loadScreenModules();
  };
})();
