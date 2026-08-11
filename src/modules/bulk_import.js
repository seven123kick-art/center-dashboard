/*
==============================================================================
Module
    BulkImport

責務
    一括CSV取込（複数ファイルの選択・年月/種別判定・分類）
    ファイル種別ごとの振り分け処理（収支PL/作業者/商品住所）
    取込中のCLOUD.pushMonth抑制、AUTO_SYNC一時停止・再開
    取込結果（成功/失敗/スキップ件数）の集計と進捗表示
    取込完了後のCloud一括保存・保存確認

依存
    STATE
    CONFIG
    CSV
    STORE
    IMPORT
    CLOUD（公開API：pushAll, pushMonth, downloadJSON, datasetKey,
           workerMonthKey, productMonthKey）
    AUTO_SYNC（公開API：suppress, resume, cancelPending）
    NAV
    UI
    processDataset / upsertDataset / fiscalYearFromYM /
    supersedeDailyWithConfirmed / dataDeleteKey / clearDataDeleted /
    ymLabel / esc（いずれもapp.js側の既存グローバル関数）
    renderImport（app.js側、取込完了後の再描画のため呼び出すのみ）
    window.FIELD_WORKER_IMPORT2 / window.FIELD_PRODUCT_IMPORT2（現場側モジュール）
    document

公開API
    window.BULK_IMPORT
    （center.htmlのondrop/onchangeから BULK_IMPORT.handleFiles() として
      直接呼ばれる。従来からオブジェクト経由での呼び出しのため、
      bare関数の互換ラッパーは不要）

互換API
    なし（呼び出し元は当初からすべて window.BULK_IMPORT.handleFiles() の
    形式で呼んでおり、分離前後で呼び出し方法は変わらない）

更新日
    2026-07-25

TODO(V3)
    Dataset生成ロジック（_importPLGroup内のprocessDataset/upsertDataset呼出）を
    Dataset分離時に見直す
==============================================================================
*/
'use strict';

(function () {
    if (window.__BULK_IMPORT_MODULE_LOADED__) {
        console.warn('[BulkImport] already loaded.');
        return;
    }
    window.__BULK_IMPORT_MODULE_LOADED__ = true;

window.BULK_IMPORT = {
  _ymFromName(name) {
    const s = String(name || '');
    let m = s.match(/(20\d{2})[\-_\.\/年\s]*([01]?\d)月?/);
    if (m) {
      const mm = String(Number(m[2])).padStart(2,'0');
      if (Number(mm) >= 1 && Number(mm) <= 12) return `${m[1]}${mm}`;
    }
    m = s.match(/(20\d{2})([01]\d)/);
    if (m) {
      const mm = m[2];
      if (Number(mm) >= 1 && Number(mm) <= 12) return `${m[1]}${mm}`;
    }
    return '';
  },

  _classify(name, sample) {
    const fileName = String(name || '');
    const t = String(sample || '');

    // 収支CSVはファイル名判定を最優先する。
    // SKDL本文には「商品」などの文字が含まれるため、本文判定より先にSKDLを確定させる。
    if (/skdl0001/i.test(fileName) || /日報|速報/.test(fileName)) return { kind:'pl', type:'daily' };
    if (/skdl0003/i.test(fileName) || /確定/.test(fileName)) return { kind:'pl', type:'confirmed' };
    if (/skdl/i.test(fileName)) return { kind:'pl', type:'confirmed' };

    if (/作業者|作業員|worker|driver/i.test(fileName) || /作業者|作業員|担当者|配送担当/.test(t)) return { kind:'worker' };
    if (/商品|住所|product|address/i.test(fileName) || /エスライン原票番号|お届け先郵便番号|郵便番号|商品名|商品/.test(t)) return { kind:'product' };
    return { kind:'unknown' };
  },

  _setImportType(type='confirmed') {
    const value = type === 'daily' ? 'daily' : 'confirmed';
    const radio = document.querySelector(`input[name="manual-import-type"][value="${value}"]`);
    if (radio) radio.checked = true;
  },

  _msg(text, type='info') {
    const el = document.getElementById('bulk-import-msg');
    if (!el) return;
    const color = type === 'error' ? '#991b1b' : type === 'ok' ? '#065f46' : type === 'warn' ? '#92400e' : '#334155';
    const bg = type === 'error' ? '#fee2e2' : type === 'ok' ? '#dcfce7' : type === 'warn' ? '#fef3c7' : '#f8fafc';
    el.innerHTML = `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:${bg};color:${color};font-weight:700;white-space:pre-wrap">${esc(text)}</div>`;
  },

  async _verifyCloudSaved(kind, ym, type='confirmed') {
    if (!CLOUD || !CLOUD.downloadJSON) return true;
    let key = '';
    if (kind === 'pl') key = CLOUD.datasetKey(ym, type || 'confirmed');
    else if (kind === 'worker') key = CLOUD.workerMonthKey(ym);
    else if (kind === 'product') key = CLOUD.productMonthKey(ym);
    if (!key) return true;
    const rec = await CLOUD.downloadJSON(key);
    if (!rec || !rec.ym) throw new Error('クラウド保存後の再読込確認に失敗しました');
    return true;
  },

  async _importPLGroup(g) {
    const type = g.type || 'confirmed';
    const ym = g.ym;
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    let imported = 0;

    for (const f of g.files) {
      const text = await CSV.read(f);
      const rows = CSV.parseSKDL(text, monthCol);
      if (!rows) throw new Error(`${f.name}: SKDLの科目/金額を読み取れません`);

      const ds = processDataset(ym, type, rows);
      ds.routePayments = CSV.parseRoutePayments(text);
      ds.source = 'csv';
      ds.fileName = f.name;
      ds.fiscalYear = fiscalYearFromYM(ym);
      ds.unit = '円';
      ds.importedAt = new Date().toISOString();
      ds.replacedAt = new Date().toISOString();

      if (typeof clearDataDeleted === 'function') clearDataDeleted('datasets', dataDeleteKey(ym, type));
      STATE.datasets = (STATE.datasets || []).filter(d => !(d.ym === ym && (d.type || 'confirmed') === type && d.source !== 'history'));
      upsertDataset(ds);
      imported++;
    }

    if (!imported) throw new Error(`${ymLabel(ym)}の収支CSVを1件も取り込めませんでした`);

    // 確定CSVが入った月は速報を残さず削除する
    if (type === 'confirmed') {
      try { await supersedeDailyWithConfirmed(ym); } catch(e) {}
    }

    Repository.Storage.save();

    // 一括取込では月ごとの pushMonth を行わない。
    // _busy 競合を避けるため、handleFiles の全ループ完了後に pushAll() を1回だけ実行する。
    AUTO_SYNC?.cancelPending();

    return imported;
  },

  async handleFiles(files) {
    const arr = Array.from(files || []).filter(f => /\.csv$/i.test(f.name));
    if (!arr.length) {
      this._msg('CSVファイルがありません', 'warn');
      return;
    }

    this._msg(`${arr.length}件のCSVを確認中です…\n完了表示が出るまでセンター切替しないでください。`);

    const groups = new Map();
    const skipped = [];

    for (const f of arr) {
      let sample = '';
      try { sample = (await f.text()).slice(0, 4000); } catch(e) {}
      const ym = this._ymFromName(f.name);
      const c = this._classify(f.name, sample);

      if (!ym) {
        skipped.push(`${f.name}：年月をファイル名から判定できません`);
        continue;
      }
      if (c.kind === 'unknown') {
        skipped.push(`${f.name}：CSV種別を判定できません`);
        continue;
      }

      const key = `${c.kind}:${c.type || ''}:${ym}`;
      if (!groups.has(key)) groups.set(key, { kind:c.kind, type:c.type || '', ym, files:[] });
      groups.get(key).files.push(f);
    }

    let done = 0;
    const logs = [];
    const importedRevenueYms = [];

    // 一括取込中は月別 pushMonth を止め、全ファイル処理後に pushAll() を1回だけ実行する。
    // これにより CLOUD._busy の競合で一部月だけDB未保存になる事故を防ぐ。
    // また AUTO_SYNC のタイマー発火による pushAll 競合も抑制する。
    const originalPushMonth = CLOUD?.pushMonth ? CLOUD.pushMonth.bind(CLOUD) : null;
    if (CLOUD && originalPushMonth) {
      CLOUD.pushMonth = async () => ({ ok:true, bulkSuppressed:true });
    }
    if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC) {
      AUTO_SYNC.suppress();
    }

    try {
      for (const g of groups.values()) {
        try {
          if (g.kind === 'pl') {
            this._setImportType?.(g.type || 'confirmed');
            let count = 0;
            if (IMPORT?.processCSV) {
              const before = (STATE.datasets || []).filter(d => d && d.ym === g.ym && (d.type || 'confirmed') === (g.type || 'confirmed') && d.source !== 'history').length;
              await IMPORT.processCSV(g.files, g.ym, { replace:true, awaitCloud:false });
              const after = (STATE.datasets || []).filter(d => d && d.ym === g.ym && (d.type || 'confirmed') === (g.type || 'confirmed') && d.source !== 'history').length;
              count = Math.max(g.files.length, after - before, 1);
            } else {
              count = await this._importPLGroup(g);
            }
            done += count;
            importedRevenueYms.push(g.ym);
            logs.push(`OK ${ymLabel(g.ym)} pl/${g.type || 'confirmed'}：${count}件`);
          } else if (g.kind === 'worker') {
            if (!window.FIELD_WORKER_IMPORT2?.handleFilesForYM) throw new Error('作業者CSV一括取込処理が未読込です');
            await FIELD_WORKER_IMPORT2.handleFilesForYM(g.files, g.ym);
            done += g.files.length;
            logs.push(`OK ${ymLabel(g.ym)} worker：${g.files.length}件`);
          } else if (g.kind === 'product') {
            if (!window.FIELD_PRODUCT_IMPORT2?.handleFilesForYM) throw new Error('商品住所CSV一括取込処理が未読込です');
            await FIELD_PRODUCT_IMPORT2.handleFilesForYM(g.files, g.ym);
            done += g.files.length;
            logs.push(`OK ${ymLabel(g.ym)} product：${g.files.length}件`);
          }
        } catch(e) {
          logs.push(`NG ${ymLabel(g.ym)} ${g.kind}${g.type ? '/' + g.type : ''}：${e.message}`);
        }

        this._msg([`一括取込処理中：${done}件完了`, ...logs].join('\n'), 'info');
      }
    } finally {
      if (CLOUD && originalPushMonth) CLOUD.pushMonth = originalPushMonth;
    }

    if (importedRevenueYms.length) {
      importedRevenueYms.sort();
      const latest = importedRevenueYms[importedRevenueYms.length - 1];
      STATE.fiscalYear = fiscalYearFromYM(latest);
      STATE.selYM = latest;
    }

    Repository.Storage.save();
    AUTO_SYNC?.cancelPending();
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();

    let cloudSummary = '';
    try {
      this._msg([`一括取込完了：${done}件`, ...logs, '', 'クラウドへ一括保存中…'].join('\n'), 'info');
      if (!CLOUD?.pushAll) throw new Error('CLOUD.pushAll が未読込です');
      const r = await SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true });
      if (!r || !r.ok) throw new Error(r?.error || 'クラウド一括保存に失敗しました');

      // 保存後にDBから再取得できるかを確認する。確認失敗時はOK扱いにしない。
      for (const g of groups.values()) {
        if (g.kind === 'pl') await this._verifyCloudSaved('pl', g.ym, g.type || 'confirmed');
        else if (g.kind === 'worker') await this._verifyCloudSaved('worker', g.ym);
        else if (g.kind === 'product') await this._verifyCloudSaved('product', g.ym);
      }
      cloudSummary = '\nクラウド一括保存: OK';
    } catch(e) {
      cloudSummary = `\nクラウド一括保存: NG（${e.message}）\nセンター切替後にデータが消える可能性があります。保存経路監査を実行してください。`;
    } finally {
      if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC) {
        AUTO_SYNC.resume();
      }
    }

    NAV.refresh();
    renderImport();
    UI.updateTopbar(STATE.view || 'import');
    UI.updateSaveStatus();

    const summary = [
      `一括取込完了：${done}件`,
      ...logs,
      ...(skipped.length ? ['', '判定できずスキップ：', ...skipped] : [])
    ].join('\n') + cloudSummary;

    const hasNg = logs.some(x => x.startsWith('NG')) || cloudSummary.includes('NG');
    this._msg(summary, hasNg ? 'error' : (skipped.length ? 'warn' : 'ok'));
  }
};
})();
