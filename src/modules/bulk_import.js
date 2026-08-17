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

  async _importPLGroup(g, opt={}) {
    const type = g.type || 'confirmed';
    const ym = g.ym;
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    let imported = 0;
    const normalizedAccountingRecords=[];
    const normalizedAccountingFiles=[];

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
      // bulkのdailyは現行SKDL0001（日報）。新PL_ACTUALのPRELIMINARY(SKDL0002)とは別物なので保存しない。
      if(type==='confirmed' && window.ACCOUNTING_IMPORT_BRIDGE?.normalizeCsvText){
        normalizedAccountingRecords.push(...ACCOUNTING_IMPORT_BRIDGE.normalizeCsvText(text,{period:ym,document_state:'CONFIRMED',file_name:f.name}));
        normalizedAccountingFiles.push(f.name);
      }

      if (typeof clearDataDeleted === 'function') clearDataDeleted('datasets', dataDeleteKey(ym, type));
      STATE.datasets = (STATE.datasets || []).filter(d => !(d.ym === ym && (d.type || 'confirmed') === type && d.source !== 'history'));
      upsertDataset(ds);
      imported++;
    }

    if (!imported) throw new Error(`${ymLabel(ym)}の収支CSVを1件も取り込めませんでした`);

    // 確定CSVが入った月は速報を残さず削除する
    if (type === 'confirmed') {
      try { await supersedeDailyWithConfirmed(ym, opt.deferCloudDelete ? { deferCloudDelete: true } : {}); } catch(e) {}
    }

    Repository.Storage.save();
    if(type==='confirmed' && normalizedAccountingRecords.length && window.ACCOUNTING_IMPORT_BRIDGE?.persistRecords){
      const nr=await ACCOUNTING_IMPORT_BRIDGE.persistRecords(normalizedAccountingRecords,{period:ym,document_state:'CONFIRMED',source_file_names:normalizedAccountingFiles});
      if(!nr?.ok) throw new Error(`PL_ACTUAL正規化SOURCE保存に失敗しました: ${nr?.error||'UNKNOWN'}`);
    }

    // 一括取込では月ごとの pushMonth を行わない。
    // _busy 競合を避けるため、handleFiles の全ループ完了後に pushAll() を1回だけ実行する。
    AUTO_SYNC?.cancelPending();

    return imported;
  },

  async handleFiles(files) {
    const all = Array.from(files || []);
    if (!all.length) return;
    window.IMPORT_FEEDBACK?.notifyReceived('bulk-import-msg', null, all.length===1?all[0].name:`${all.length}件のファイル`);

    // ステージA：拡張子（all-or-nothing）
    const invalidExt = all.filter(f => !/\.csv$/i.test(f.name));
    if (invalidExt.length) {
      this._msg(`この取込欄ではCSVファイルのみ使用できます。登録は行っていません。不正ファイル：${invalidExt.map(f=>f.name).join('、')}`, 'error');
      return;
    }
    const arr = all;

    this._msg(`${arr.length}件のCSVを検証中です…\n完了表示が出るまでセンター切替しないでください。`, 'info');

    /* ===== Phase 1：全ファイル事前検証（STATE/Storage/Cloudへは一切書き込まない） =====
       年月判定・CSV種別判定・各形式のvalidation（既存のparseSKDL/
       assertNotForeignCsv/assertOwnCsvSignature/parseWorkerCsvRows/
       parseProductAddressRowsをそのまま呼び出すだけで、これら自体は
       変更していない）を、全ファイルについて完了させてから初めて
       Phase 2（登録）へ進む。「種別不明・年月不明なファイルは
       スキップして続行する」という従来の挙動は、安全性を優先する
       今回の要件により廃止し、1件でも問題があれば一括取込全体を
       中止する。 */
    const groups = new Map();
    const problems = [];

    for (const f of arr) {
      let sample = '';
      try { sample = (await f.text()).slice(0, 4000); } catch(e) { problems.push(`${f.name}：ファイルを読み込めません（${e.message}）`); continue; }
      const ym = this._ymFromName(f.name);
      if (!ym) { problems.push(`${f.name}：年月をファイル名から判定できません`); continue; }
      const c = this._classify(f.name, sample);
      if (c.kind === 'unknown') { problems.push(`${f.name}：CSV種別を判定できません`); continue; }

      const key = `${c.kind}:${c.type || ''}:${ym}`;
      if (!groups.has(key)) groups.set(key, { kind:c.kind, type:c.type || '', ym, files:[] });
      groups.get(key).files.push(f);
    }

    if (problems.length) {
      this._msg(`一括取込を中止しました。登録は行っていません。\n${problems.join('\n')}`, 'error');
      return;
    }

    // 種別・年月が判定できたグループごとに、既存のparser/validationを
    // 「検証だけ」実行する（成功しても何も登録しない）。
    for (const g of groups.values()) {
      try {
        if (g.kind === 'pl') {
          const mm = g.ym.slice(4,6);
          const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
          for (const f of g.files) {
            const text = await CSV.read(f);
            const rows = CSV.parseSKDL(text, monthCol);
            if (!rows) throw new Error(`${f.name}: SKDLの科目/金額を読み取れません`);
          }
        } else if (g.kind === 'worker') {
          if (!window.FIELD_WORKER_IMPORT2?.validateOnly) throw new Error('作業者CSV検証処理が未読込です');
          await FIELD_WORKER_IMPORT2.validateOnly(g.files);
        } else if (g.kind === 'product') {
          if (!window.FIELD_PRODUCT_IMPORT2?.validateOnly) throw new Error('商品住所CSV検証処理が未読込です');
          await FIELD_PRODUCT_IMPORT2.validateOnly(g.files);
        }
      } catch(e) {
        problems.push(`${ymLabel(g.ym)} ${g.kind}${g.type ? '/' + g.type : ''}：${e.message}`);
      }
    }

    if (problems.length) {
      this._msg(`一括取込を中止しました。登録は行っていません。\n${problems.join('\n')}`, 'error');
      return;
    }

    /* ===== Phase 2：全ファイルの事前検証に合格した場合のみ、
       既存の登録処理をそのまま実行する（ロジック自体は無変更） ===== */
    this._msg(`${arr.length}件のCSVの検証が完了しました。登録処理を開始します…`, 'info');

    /* Phase 2直前のSTATEスナップショット（今回追加）。
       一括取込で変更され得るのは STATE.datasets（pl） /
       STATE.workerCsvData（worker） / STATE.productAddressData
       （product） / STATE.deleted（clearDataDeleted経由、pl/worker/
       product共通） / STATE.fiscalYear・STATE.selYM（pl成功時に末尾で
       設定）の5系統であることを、upsertDataset/upsertByYm/
       clearDataDeletedの実装から確認した上でスナップショット対象に
       限定した。STATEオブジェクトそのものの参照は変更せず、各
       プロパティの値だけを退避・復元する。配列は新しい配列（浅い
       コピー）として退避すれば、upsertDataset/upsertByYmが既存要素を
       書き換えず「フィルタ＋新規オブジェクトのpush」で配列を作り直す
       実装のため、復元時に正しく元の状態へ戻る。STATE.deletedは
       {kind:{key:timestampの文字列}}という単純なJSON互換構造のため、
       JSONによる深いコピーで安全に退避できる。 */
    const stateSnapshot = {
      datasets: [...(STATE.datasets || [])],
      workerCsvData: [...(STATE.workerCsvData || [])],
      productAddressData: [...(STATE.productAddressData || [])],
      deleted: STATE.deleted ? JSON.parse(JSON.stringify(STATE.deleted)) : STATE.deleted,
      fiscalYear: STATE.fiscalYear,
      selYM: STATE.selYM,
    };

    let done = 0;
    const logs = [];
    const importedRevenueYms = [];
    let bulkFailed = false;
    let bulkFailMessage = '';

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

    const pendingSupersedeDailyYms = [];

    try {
      for (const g of groups.values()) {
        try {
          if (g.kind === 'pl') {
            this._setImportType?.(g.type || 'confirmed');
            let count = 0;
            if (IMPORT?.processCSV) {
              const hadDaily = (STATE.datasets || []).some(d => d && d.ym === g.ym && (d.type || 'confirmed') === 'daily' && d.source !== 'history');
              count = await IMPORT.processCSV(g.files, g.ym, { replace:true, awaitCloud:false, strict:true });
              // strict:trueのprocessCSVは、1ファイルでも失敗した場合・
              // 登録件数が選択ファイル数と一致しない場合は必ず例外を投げるため、
              // ここに到達した時点でg.files.length件が確実に登録されている。
              // 従来のMath.max(g.files.length, after-before, 1)という
              // 「成功件数の捏造」は行わず、processCSVの実際の戻り値を使う。
              if ((g.type || 'confirmed') === 'confirmed' && hadDaily) {
                // 確定CSVにより速報データが置き換えられた月は、Cloud側への
                // 不可逆な削除（IDB_CACHE.remove／CLOUD_REPOSITORY.deleteFile）を
                // 全グループ成功後まで延期する（processCSV側でdeferCloudDelete
                // が既に適用されているため、ここではまだCloud削除は実行されていない）。
                pendingSupersedeDailyYms.push(g.ym);
              }
            } else {
              const hadDaily = (STATE.datasets || []).some(d => d && d.ym === g.ym && (d.type || 'confirmed') === 'daily' && d.source !== 'history');
              count = await this._importPLGroup(g, { deferCloudDelete: true });
              if ((g.type || 'confirmed') === 'confirmed' && hadDaily) {
                pendingSupersedeDailyYms.push(g.ym);
              }
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
          // 「catchしてNGログだけ残し次のgroupへ進む」挙動は廃止する。
          // 1グループでも登録処理で例外が発生した場合は、即座にループを
          // 中断し、以降のグループの登録処理には一切進まない。
          logs.push(`NG ${ymLabel(g.ym)} ${g.kind}${g.type ? '/' + g.type : ''}：${e.message}`);
          bulkFailed = true;
          bulkFailMessage = e.message;
          break;
        }

        this._msg([`一括取込処理中：${done}件完了`, ...logs].join('\n'), 'info');
      }
    } finally {
      if (CLOUD && originalPushMonth) CLOUD.pushMonth = originalPushMonth;
    }

    if (bulkFailed) {
      // ロールバック：STATEオブジェクトそのものの参照は変更せず、
      // 今回の一括取込で変更され得た各プロパティだけをスナップショットへ戻す。
      STATE.datasets = stateSnapshot.datasets;
      STATE.workerCsvData = stateSnapshot.workerCsvData;
      STATE.productAddressData = stateSnapshot.productAddressData;
      STATE.deleted = stateSnapshot.deleted;
      STATE.fiscalYear = stateSnapshot.fiscalYear;
      STATE.selYM = stateSnapshot.selYM;
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();

      // ロールバック後の状態をローカルに保存する（Cloudへは一切送らない）。
      Repository.Storage.save();
      if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC) {
        AUTO_SYNC.resume();
      }

      NAV.refresh();
      renderImport();
      UI.updateTopbar(STATE.view || 'import');
      UI.updateSaveStatus();

      this._msg(`一括取込に失敗したため、今回の登録内容はすべて取り消しました。\n原因：${bulkFailMessage}\n${logs.join('\n')}`, 'error');
      return;
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

      /* ---------- 旧速報Cloud削除の確定（今回、順序を修正） ----------
         新しい確定データのCloud保存・再取得検証が成功した後に初めて、
         置き換えられた旧速報データのCloudファイルを削除する。
         datasetKey(ym,'daily')とdatasetKey(ym,'confirmed')は
         「${CENTER.id}/skdl/${ym}_daily.json」「${ym}_confirmed.json」
         という別ファイルパスであることをCLOUD._datasetKeyの実装で
         確認済みのため、この削除が新しい確定データを巻き込むことは
         ない。Cloud保存・検証が失敗した場合（この位置に到達しない
         場合）は、旧速報Cloudファイルへは一切触れない。
         finalizeSupersedeDailyCloudDeleteにthrowOnError:trueを渡し、
         削除失敗を検知してクラウド一括保存結果へ反映する
         （個別通常取込側のデフォルト呼出は従来通り握りつぶすだけで、
         今回変更していない）。 */
      const deleteFailures = [];
      for (const ym of pendingSupersedeDailyYms) {
        try {
          await finalizeSupersedeDailyCloudDelete(ym, { throwOnError: true });
        } catch(e) {
          deleteFailures.push(`${ym}: ${e.message}`);
        }
      }

      cloudSummary = '\nクラウド一括保存: OK';
      if (deleteFailures.length) {
        cloudSummary += `\n旧速報データのクラウド削除に一部失敗しました（データ自体は正しく登録されています）：${deleteFailures.join('、')}`;
      }
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
      ...logs
    ].join('\n') + cloudSummary;

    const hasNg = logs.some(x => x.startsWith('NG')) || cloudSummary.includes('NG');
    this._msg(summary, hasNg ? 'error' : 'ok');
  }
};
})();
