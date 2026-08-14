/* =====================================================================
   経営管理システム export_service.js
   2026-08-14
   Version6 Phase10-C1：共通出力基盤（Excel / 印刷）
   ・分析画面から渡された構造化データ（title/center/period/columns/
     rows/summary/filename等）を受け取り、Excel生成・ファイル名生成・
     印刷用のUI操作を行う共通サービス。
   ・分析値そのものは一切計算しない。各画面（例：budget_actual.js）
     が画面表示用に既に計算した値を、そのまま構造化データとして
     受け取って出力するだけ。予実差・前年比等の再計算はしない。
   ・XLSX生成にはSheetJS Community Edition（xlsx、Apache-2.0）を
     使用する。assets/libs/xlsx.full.min.js としてローカル配置済み。
     既存docx.iife.js（report_ui.js）と同じ「必要時に動的<script>
     タグで遅延読込する」方式を採用し、外部CDNには依存しない。
   ・Cloud同期・Repository・SyncCoordinator・STATE構造・Dataset構造・
     planData構造への副作用は一切ない。ローカル生成・ダウンロード
     のみを行う。
===================================================================== */
'use strict';

(function () {
  if (window.__EXPORT_SERVICE_MODULE_LOADED_20260814__) return;
  window.__EXPORT_SERVICE_MODULE_LOADED_20260814__ = true;

  const XLSX_LIB_PATH = 'assets/libs/xlsx.full.min.js';

  /* ---------- XLSXライブラリの遅延読込（docx.iife.jsと同一パターン） ---------- */
  function ensureXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (document.getElementById('xlsx-lib-script')) {
        // 既に読込中の場合は完了を待つ（複数回呼ばれても二重読込しない）
        const existing = document.getElementById('xlsx-lib-script');
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('XLSXライブラリの読込に失敗しました')));
        return;
      }
      const s = document.createElement('script');
      s.id = 'xlsx-lib-script';
      s.src = XLSX_LIB_PATH;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(XLSX_LIB_PATH + ' の読み込みに失敗。ファイルがサーバーに存在するか確認してください。'));
      document.head.appendChild(s);
    });
  }

  /* ---------- ファイル名の安全化 ----------
     OSで使用できない文字（Windows禁則文字含む）を除去する。
     日本語自体は許容する。 */
  function sanitizeFilenamePart(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .trim();
  }

  function buildFilename(parts, ext) {
    const name = parts.filter(Boolean).map(sanitizeFilenamePart).join('_');
    return `${name}.${ext}`;
  }

  /* ---------- ダウンロード実行（既存STORE.exportJSON()と同一パターン） ---------- */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ---------- Excelセル値の安全化 ----------
     null/undefined/'—'（画面表示上の欠損記号）はセルを空欄にする。
     数値はそのまま数値型として渡す。0はfalsyだが欠損ではないため、
     厳密に null/undefined/'—' のみ空欄化し、0 は 0 のまま出力する。 */
  function safeCell(v) {
    if (v === null || v === undefined || v === '—') return null;
    return v;
  }

  /* ---------- 構造化データ → XLSX ----------
     data = {
       title, center, period, filters, filename,
       sheets: [
         { name, summary: [{label, columns:[...]}], // 任意
           columns: ['項目','予算','実績',...],
           rows: [[val, val, ...], ...] }
       ]
     }
     summary/columns/rowsの値はすべてsafeCell()を通して出力する。
     分析値の計算・再計算はここでは一切行わない。 */
  async function toExcel(data) {
    await ensureXLSX();
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    const now = new Date();
    const generatedAt = now.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    (data.sheets || []).forEach(sheet => {
      const aoa = [];
      aoa.push([data.title || '']);
      const infoLine = [
        data.center ? `センター：${data.center}` : null,
        data.period ? `対象：${data.period}` : null,
      ].filter(Boolean).join('　');
      if (infoLine) aoa.push([infoLine]);
      aoa.push([`出力日時：${generatedAt}`]);
      aoa.push([]);

      if (Array.isArray(sheet.summary) && sheet.summary.length) {
        sheet.summary.forEach(block => {
          if (block.label) aoa.push([block.label]);
          if (Array.isArray(block.columns)) aoa.push(block.columns.map(safeCell));
          (block.rows || []).forEach(row => aoa.push(row.map(safeCell)));
          aoa.push([]);
        });
      }

      if (Array.isArray(sheet.columns)) aoa.push(sheet.columns.map(safeCell));
      (sheet.rows || []).forEach(row => aoa.push(row.map(safeCell)));

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const sheetName = sanitizeFilenamePart(sheet.name || 'Sheet1').slice(0, 31) || 'Sheet1';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const filename = data.filename || buildFilename([data.center, data.title, data.period], 'xlsx');
    downloadBlob(blob, filename);
  }

  /* ---------- 印刷 / PDF保存 ----------
     ブラウザ標準のwindow.print()を使う。PDF専用ライブラリは使わない。
     印刷対象領域を一時的に印刷用クラスでマークし、印刷用ヘッダー
     （タイトル・センター・対象期間・出力日時）を差し込んだ上で
     window.print()を呼ぶ。印刷完了後は元の状態に戻す。 */
  function toPrint(data) {
    const now = new Date();
    const generatedAt = now.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    let headerEl = document.getElementById('export-print-header');
    if (!headerEl) {
      headerEl = document.createElement('div');
      headerEl.id = 'export-print-header';
      headerEl.className = 'export-print-header-only';
      document.body.insertBefore(headerEl, document.body.firstChild);
    }
    const infoLine = [
      data.center ? `センター：${data.center}` : null,
      data.period ? `対象：${data.period}` : null,
    ].filter(Boolean).join('　');
    headerEl.innerHTML = `
      <div class="export-print-title">${escapeHtml(data.title || '')}</div>
      <div class="export-print-meta">${escapeHtml(infoLine)}</div>
      <div class="export-print-meta">出力日時：${escapeHtml(generatedAt)}</div>
    `;

    window.print();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.EXPORT_SERVICE = { toExcel, toPrint, buildFilename, ensureXLSX };
})();
