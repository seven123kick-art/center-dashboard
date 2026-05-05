/* =====================================================================
   経営管理システム field_core.js
   2026-05-01
   ・app.jsから現場分析（作業者・商品住所・エリア）を安全分割
   ・CSV読込基礎 / STATE / STORE / CLOUD / 共通関数はapp.js側を使用
===================================================================== */
'use strict';

(function(){
  if (window.__FIELD_MODULE_LOADED_20260501__) return;
  window.__FIELD_MODULE_LOADED_20260501__ = true;

/* ════════ §22 FIELD_UI（スタブ） ══════════════════════════════ */
FIELD_UI = window.FIELD_UI = {
  switchTab(el) {
    document.querySelectorAll('.field-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.field-pane').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    const pane = document.getElementById('fpane-'+el.dataset.ftab);
    if (pane) pane.classList.add('active');
  },
  renderMap()       {},
  updatePeriodBadge() {
    const badge = document.getElementById('field-period-badge');
    const selected = selectedFieldDataInSelectedFiscalYear();
    if (badge) badge.textContent = selected
      ? `${ymLabel(selected.ym)} 読込済`
      : 'データ未読込';
  },
  renderDataList() {
    renderCommonPeriodSelector('field');
    const list = document.getElementById('field-data-list');
    if (!list) return;
    const rows = fieldDataForSelectedFiscalYear();
    list.innerHTML = rows.length
      ? rows.map(d=>`<div class="data-item">${ymLabel(d.ym)}</div>`).join('')
      : '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">選択年度の現場明細データがありません</div>';
  },
};



// 現場データリスト更新（グローバル関数として呼ばれる）
function renderFieldDataList2() {
  const list = document.getElementById('field-data-list2');
  if (!list) return;
  const badge = document.getElementById('field-import-badge');
  if (STATE.fieldData.length) {
    if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }
    list.innerHTML = STATE.fieldData.map(d=>{
      const areaLabel = '';
      return `
      <div class="data-item">
        <span>${ymLabel(d.ym)}${areaLabel}</span>
        <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${d.ym}')" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`;
    }).join('');
    const rowEl = document.getElementById('field-delete-all-row');
    if (rowEl) rowEl.style.display = 'flex';
  } else {
    if (badge) { badge.textContent='未読込'; badge.className='badge badge-warn'; }
    list.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>';
    const rowEl = document.getElementById('field-delete-all-row');
    if (rowEl) rowEl.style.display = 'none';
  }
}

// IMPORT.deleteFieldData 追加
IMPORT.deleteFieldData = function(ym) {
  STATE.fieldData = STATE.fieldData.filter(d=>d.ym!==ym);
  STORE.save();
  renderFieldDataList2();
  UI.toast('現場データを削除しました');
};



/* =====================================================================
   現場明細 CSV完全再構築版 2026-04-29
   方針:
   - 旧帳票関連は使わない
   - 作業者CSVと商品・住所CSVを完全分離
   - 商品・住所CSVは I列(エスライン原票番号)でユニーク化
   - L列(郵便番号)を住所/市区町村集計に使用
   - P列(商品)はユニーク原票だけ判定
   - R列(作業内容)とU列(金額)だけ原票番号に紐付けて合算
   - 同じ年月を再取込した場合は追記せず完全置換
   - 削除は年月＋種別単位で完全削除
===================================================================== */
(function(){
  'use strict';

  const FIELD_REBUILD_VERSION = 'field-csv-rebuild-20260429';
  const MONTHS = ['04','05','06','07','08','09','10','11','12','01','02','03'];

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function yen(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    if (!s || s === '-' || s === '.') return 0;
    const num = Number(s);
    return Number.isFinite(num) ? num : 0;
  }
  function clean(v){ return String(v ?? '').replace(/[\u0000-\u001f]/g,'').trim(); }
  function esc2(s){
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function ymFromFiscalMonth(fy, mm){
    fy = String(fy || getDefaultFiscalYear()).replace(/年度/g,'');
    mm = String(mm || '04').padStart(2,'0');
    const year = ['01','02','03'].includes(mm) ? Number(fy) + 1 : Number(fy);
    return `${year}${mm}`;
  }
  function fiscalFromYM2(ym){ return fiscalYearFromYM ? fiscalYearFromYM(ym) : (Number(String(ym).slice(4,6)) <= 3 ? String(Number(String(ym).slice(0,4))-1) : String(ym).slice(0,4)); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }
  function msg(text, type='ok'){
    const el = document.getElementById('field-import-msg2') || document.getElementById('field-upload-msg') || document.getElementById('session-msg');
    if (el) {
      const color = type === 'error' ? '#b91c1c' : type === 'warn' ? '#92400e' : '#065f46';
      const bg = type === 'error' ? '#fee2e2' : type === 'warn' ? '#fef3c7' : '#dcfce7';
      el.innerHTML = `<div style="padding:8px 10px;border-radius:8px;background:${bg};color:${color};font-weight:700;margin:6px 0">${esc2(text)}</div>`;
    }
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(text, type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'ok');
  }

  function ensureState(){
    if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
    if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];
    // 旧混在データは参照しない。念のため配列は残すが現場CSV判定には使わない。
    if (!Array.isArray(STATE.fieldData)) STATE.fieldData = [];
    if (!Array.isArray(STATE.areaData)) STATE.areaData = [];
  }


  /* 現場CSVデータ取得を一元化
     目的：画面ごとの独自 localStorage 探索で、年度が出ない・別センター混入・削除済み復活が起きないようにする。
     優先順位：STATE → STORE直読 → localStorage full_state。削除済みマーカーは必ず反映する。
  */
  function fieldAccessDeleted(kind, ym){
    try {
      const d = (typeof ensureDeletedState === 'function') ? ensureDeletedState() : (STATE.deleted || {});
      if (!ym) return false;
      if (kind === 'worker') return !!(d.workerMonths && d.workerMonths[ym]) || !!(d.fieldMonths && d.fieldMonths[ym]);
      if (kind === 'product') return !!(d.productMonths && d.productMonths[ym]) || !!(d.fieldMonths && d.fieldMonths[ym]);
      return false;
    } catch(e) { return false; }
  }

  function fieldAccessClone(v){
    try { return JSON.parse(JSON.stringify(v || [])); } catch(e) { return Array.isArray(v) ? v.slice() : []; }
  }

  function fieldAccessYm(x){
    return String((x && (x.ym || x.YM || x.month || x.targetYM)) || '').replace(/[^0-9]/g,'').slice(0,6);
  }

  function fieldAccessUnique(list, kind){
    const map = new Map();
    safeArray(list).forEach((r, idx) => {
      if (!r || typeof r !== 'object') return;
      const ym = fieldAccessYm(r);
      if (!ym || fieldAccessDeleted(kind, ym)) return;
      const importedAt = String(r.importedAt || r.updatedAt || r.savedAt || '');
      const sig = `${ym}_${r.source || ''}_${r.uniqueCount || r.rowCount || ''}`;
      const old = map.get(sig);
      if (!old || importedAt >= String(old.importedAt || old.updatedAt || old.savedAt || '')) map.set(sig, { ...r, ym });
    });
    return [...map.values()].sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }

  // 画面表示のたびに localStorage 全探索を行うと、作業者分析・作業内容分析が極端に重くなる。
  // 現場CSVは STORE.load() で STATE.workerCsvData / STATE.productAddressData に読み込み済みのため、
  // ここではSTATEだけを参照する。必要時の復元・同期は STORE.load / CLOUD.pull 側で行う。
  let __fieldAccessCache = { workerSig:'', productSig:'', worker:null, product:null };
  function fieldAccessSignature(list){
    return safeArray(list).map(r => `${r && r.ym || ''}:${r && (r.importedAt || r.updatedAt || r.savedAt || '')}:${r && (r.rowCount || r.uniqueCount || r.workerCount || '')}`).join('|');
  }
  window.FIELD_DATA_ACCESS = {
    getWorkerRecords(){
      const sig = fieldAccessSignature(STATE.workerCsvData);
      if (__fieldAccessCache.worker && __fieldAccessCache.workerSig === sig) return __fieldAccessCache.worker;
      const records = fieldAccessUnique(fieldAccessClone(safeArray(STATE.workerCsvData)), 'worker');
      __fieldAccessCache.workerSig = sig;
      __fieldAccessCache.worker = records;
      return records;
    },
    getProductRecords(){
      const sig = fieldAccessSignature(STATE.productAddressData);
      if (__fieldAccessCache.product && __fieldAccessCache.productSig === sig) return __fieldAccessCache.product;
      const records = fieldAccessUnique(fieldAccessClone(safeArray(STATE.productAddressData)), 'product');
      __fieldAccessCache.productSig = sig;
      __fieldAccessCache.product = records;
      return records;
    },
    getAllYms(){
      return [...new Set([
        ...this.getWorkerRecords().map(d=>d.ym),
        ...this.getProductRecords().map(d=>d.ym)
      ].filter(Boolean))].sort();
    },
    invalidate(){
      __fieldAccessCache = { workerSig:'', productSig:'', worker:null, product:null };
    },
    syncStateFromStorage(){
      // 旧名互換。localStorage全探索はしない。
      this.invalidate();
      return { worker:this.getWorkerRecords(), product:this.getProductRecords() };
    }
  };

  // STOREへ新しい現場CSV専用データを保存対象として追加
  const originalStoreLoad = STORE.load.bind(STORE);
  const originalStoreSave = STORE.save.bind(STORE);
  STORE.load = function(){
    originalStoreLoad();
    STATE.workerCsvData = this._g('workerCsvData') || [];
    STATE.productAddressData = this._g('productAddressData') || [];
    ensureState();
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    if (typeof sanitizePersonalDataState === 'function') sanitizePersonalDataState(STATE);
  };
  STORE.save = function(){
    ensureState();
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    if (typeof sanitizePersonalDataState === 'function') sanitizePersonalDataState(STATE);
    originalStoreSave();
    this._s('workerCsvData', STATE.workerCsvData);
    this._s('productAddressData', STATE.productAddressData);
  };

  // クラウド full_state へ現場CSV専用データを追加
  if (typeof CLOUD !== 'undefined') {
    const oldMakeFull = CLOUD._makeFullState ? CLOUD._makeFullState.bind(CLOUD) : null;
    CLOUD._makeFullState = function(){
      const base = oldMakeFull ? oldMakeFull() : { version: 1, center: CENTER.id, savedAt: new Date().toISOString() };
      ensureState();
      if (typeof sanitizePersonalDataState === 'function') sanitizePersonalDataState(STATE);
      if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
      base.workerCsvData = STATE.workerCsvData;
      base.productAddressData = STATE.productAddressData;
      base.version = Math.max(Number(base.version || 1), 30);
      return base;
    };
    const oldApplyFull = CLOUD._applyFullState ? CLOUD._applyFullState.bind(CLOUD) : null;
    CLOUD._applyFullState = function(full){
      const ok = oldApplyFull ? oldApplyFull(full) : true;
      if (full && Array.isArray(full.workerCsvData)) STATE.workerCsvData = full.workerCsvData;
      if (full && Array.isArray(full.productAddressData)) STATE.productAddressData = full.productAddressData;
      ensureState();
      if (typeof sanitizePersonalDataState === 'function') sanitizePersonalDataState(STATE);
      if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
      return ok;
    };
  }

  function setupYmSelects(){
    ensureState();
    const years = new Set();
    const now = new Date();
    for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) years.add(String(y));
    safeArray(STATE.datasets).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    (window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData)).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    (window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData)).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    const sortedYears = [...years].sort((a,b)=>Number(b)-Number(a));

    function fillPair(fyId, mId, noteId){
      const fySel = document.getElementById(fyId);
      const mSel = document.getElementById(mId);
      const note = document.getElementById(noteId);
      if (!fySel || !mSel) return;
      const keepFY = fySel.value || localStorage.getItem(`${STORE._p}${fyId}`) || fiscalFromYM2(STATE.selYM || latestDS()?.ym || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`);
      const keepM = mSel.value || localStorage.getItem(`${STORE._p}${mId}`) || String((STATE.selYM || latestDS()?.ym || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`).slice(4,6));
      fySel.innerHTML = sortedYears.map(y => `<option value="${y}">${y}年度</option>`).join('');
      mSel.innerHTML = MONTHS.map(mm => `<option value="${mm}">${Number(mm)}月</option>`).join('');
      fySel.value = sortedYears.includes(String(keepFY)) ? String(keepFY) : sortedYears[0];
      mSel.value = MONTHS.includes(String(keepM).padStart(2,'0')) ? String(keepM).padStart(2,'0') : '04';
      const update = () => {
        localStorage.setItem(`${STORE._p}${fyId}`, fySel.value);
        localStorage.setItem(`${STORE._p}${mId}`, mSel.value);
        if (note) note.textContent = `${ymText(ymFromFiscalMonth(fySel.value, mSel.value))} として保存します。CSV内の日付は参考情報として保持します。`;
      };
      fySel.onchange = update;
      mSel.onchange = update;
      update();
    }
    fillPair('field-worker-fy-select', 'field-worker-month-select', 'field-worker-ym-note');
    fillPair('field-product-fy-select', 'field-product-month-select', 'field-product-ym-note');
  }

  function selectedWorkerYM(){ return ymFromFiscalMonth(document.getElementById('field-worker-fy-select')?.value, document.getElementById('field-worker-month-select')?.value); }
  function selectedProductYM(){ return ymFromFiscalMonth(document.getElementById('field-product-fy-select')?.value, document.getElementById('field-product-month-select')?.value); }

  function csvRowsFromText(text){ return CSV && CSV.toRows ? CSV.toRows(text) : []; }
  async function readCsvFile(file){ return CSV && CSV.read ? CSV.read(file) : await file.text(); }

  function headerIndex(header, names, fallback){
    const normalized = header.map(h => clean(h).replace(/[\s　]/g,''));
    for (const name of names) {
      const i = normalized.findIndex(h => h === name || h.includes(name));
      if (i >= 0) return i;
    }
    return fallback;
  }

  function normalizeWorkDate(v){
    const raw = clean(v);
    if (!raw) return '';
    // A列は日付のみ想定。時刻は無い前提だが、念のため空白以降は切る。
    const head = raw.split(/\s+/)[0];
    const m1 = head.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
    if (m1) return `${m1[1]}-${String(m1[2]).padStart(2,'0')}-${String(m1[3]).padStart(2,'0')}`;
    const m2 = head.match(/^(\d{8})$/);
    if (m2) return `${m2[1].slice(0,4)}-${m2[1].slice(4,6)}-${m2[1].slice(6,8)}`;
    return head;
  }

  function normalizeSlipNo(v){
    const raw = clean(v).replace(/\.0$/,'');
    if (!raw) return '';
    // 原票番号は数値化されるCSVもあるため、数字だけなら先頭0差を吸収する。
    if (/^\d+$/.test(raw)) return raw.replace(/^0+/, '') || '0';
    return raw;
  }

  function normalizeWorkLabel(v){
    return clean(v).replace(/[\s　]/g,'');
  }
  function isKansenWorkerLabel(label){
    const s = normalizeWorkLabel(label);
    return /幹線|幹線料|中継|中継料/.test(s);
  }
  function isSizeWorkerLabel(label){
    const s = normalizeWorkLabel(label);
    return /サイズ|大型|中型|小型/.test(s);
  }
  function isExcludedWorkerAmountLabel(label){
    const s = normalizeWorkLabel(label);
    // 作業者分析の金額は、車両・作業者の実態収支を見るため、幹線料系だけを除外する。
    // サイズ配送料は売上対象として残す。件数は原票番号ユニークで残し、作業内訳は「幹線料系を除いた明細行」で表示する。
    return /幹線|幹線料|中継|中継料/.test(s);
  }

  function parseWorkerCsvRows(rows, fileName){
    if (!rows.length) return { rowCount:0, lineRowCount:0, workerCount:0, workers:{}, uniqueSlipCount:0 };
    const header = rows[0] || [];
    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));

    const dateIdx = headerIndex(header, ['日付','作業日','配送日','配達完了日','計上日'], 0);
    const workerIdx = headerIndex(header, ['作業者名','作業者','担当者','社員名','氏名'], 0);
    const amountIdx = headerIndex(header, ['金額','売上','合計'], -1);
    const workIdx = headerIndex(header, ['作業内容','内容','科目'], -1);
    const billingIdx = headerIndex(header, ['付帯区分','請求区分','売上区分','区分'], 12); // M列：請求／直収
    const slipIdx = headerIndex(header, ['エスライン原票番号','原票番号','伝票番号','配送番号','荷主伝票番号'], -1);

    const workers = {};
    const allWorkDays = new Set();
    const allSlips = new Set();
    const globalChartWorks = {};
    const globalDirectWorks = {};
    let includedAmountTotal = 0;
    let salesAmountTotal = 0;
    let directAmountTotal = 0;
    let excludedAmountTotal = 0;
    let excludedLineRows = 0;

    body.forEach((r, i) => {
      const name = clean(r[workerIdx]) || '未設定';
      const workDate = normalizeWorkDate(r[dateIdx]);
      const slipRaw = slipIdx >= 0 ? normalizeSlipNo(r[slipIdx]) : '';
      const slipKey = slipRaw || `__row_${i}`;
      const workLabel = workIdx >= 0 ? (clean(r[workIdx]) || '未設定') : '未設定';
      const amountVal = amountIdx >= 0 ? yen(r[amountIdx]) : 0;
      const billingType = billingIdx >= 0 ? clean(r[billingIdx]) : '';
      const isDirectSales = /直収/.test(billingType);
      const amountExcluded = isExcludedWorkerAmountLabel(workLabel);
      const lineExcludedForChart = isKansenWorkerLabel(workLabel);

      if (!workers[name]) {
        workers[name] = {
          name,
          rows:0,                    // 作業者別の原票番号ユニーク件数
          lineRows:0,                // 明細行数
          amount:0,                  // 幹線料系を除外した金額
          includedAmount:0,
          salesAmount:0,             // M列=請求
          directAmount:0,            // M列=直収
          excludedAmount:0,
          excludedLineRows:0,
          works:{},                  // 全作業内容（明細行ベース）
          chartWorks:{},             // グラフ用：請求かつ幹線料系を除外した作業内容
          directWorks:{},            // グラフ用：直収かつ幹線料系を除外した作業内容
          includedWorks:{},          // 金額対象の作業内容
          excludedWorks:{},          // 金額除外対象の作業内容
          workDays:[],
          slips:{},                  // 原票番号 -> { slip,date,amount,includedAmount,excludedAmount,works,chartWorks }
          slipColumnMissing: slipIdx < 0
        };
      }

      const worker = workers[name];
      worker.lineRows += 1;

      if (!worker.slips[slipKey]) {
        worker.slips[slipKey] = { slip:slipKey, date:workDate, amount:0, includedAmount:0, salesAmount:0, directAmount:0, excludedAmount:0, works:{}, chartWorks:{}, directWorks:{} };
        worker.rows += 1;
      }
      const slipObj = worker.slips[slipKey];

      slipObj.works[workLabel] = (slipObj.works[workLabel] || 0) + 1;
      worker.works[workLabel] = (worker.works[workLabel] || 0) + 1;

      if (lineExcludedForChart) {
        worker.excludedLineRows += 1;
        excludedLineRows += 1;
      } else {
        if (isDirectSales) {
          slipObj.directWorks[workLabel] = (slipObj.directWorks[workLabel] || 0) + 1;
          worker.directWorks[workLabel] = (worker.directWorks[workLabel] || 0) + 1;
          globalDirectWorks[workLabel] = (globalDirectWorks[workLabel] || 0) + 1;
        } else {
          slipObj.chartWorks[workLabel] = (slipObj.chartWorks[workLabel] || 0) + 1;
          worker.chartWorks[workLabel] = (worker.chartWorks[workLabel] || 0) + 1;
          globalChartWorks[workLabel] = (globalChartWorks[workLabel] || 0) + 1;
        }
      }

      // 金額は明細行の金額をそのまま使う。ただし、幹線料系は集計前に完全除外する。サイズ配送料は対象に残す。
      if (amountExcluded) {
        worker.excludedAmount += amountVal;
        slipObj.excludedAmount += amountVal;
        worker.excludedWorks[workLabel] = (worker.excludedWorks[workLabel] || 0) + 1;
        excludedAmountTotal += amountVal;
      } else {
        worker.amount += amountVal;
        worker.includedAmount += amountVal;
        slipObj.amount += amountVal;
        slipObj.includedAmount += amountVal;
        if (isDirectSales) {
          worker.directAmount += amountVal;
          slipObj.directAmount += amountVal;
          directAmountTotal += amountVal;
        } else {
          worker.salesAmount += amountVal;
          slipObj.salesAmount += amountVal;
          salesAmountTotal += amountVal;
        }
        worker.includedWorks[workLabel] = (worker.includedWorks[workLabel] || 0) + 1;
        includedAmountTotal += amountVal;
      }

      if (workDate) {
        if (!worker.workDays.includes(workDate)) worker.workDays.push(workDate);
        allWorkDays.add(workDate);
      }
      if (slipRaw) allSlips.add(slipRaw);
    });

    Object.values(workers).forEach(w => {
      w.workDays = Array.from(new Set(w.workDays || [])).sort();
      w.workDayCount = w.workDays.length;
      w.avgPerWorkDay = w.workDayCount > 0 ? w.rows / w.workDayCount : 0;
      w.slipCount = w.rows;
      w.slipList = Object.keys(w.slips || {}).filter(k => !k.startsWith('__row_'));
    });

    const totalSlipCount = Object.values(workers).reduce((sum, w) => sum + (Number(w.rows) || 0), 0);

    return {
      rowCount: totalSlipCount,
      lineRowCount: body.length,
      uniqueSlipCount: allSlips.size,
      workerCount: Object.keys(workers).length,
      workers,
      sourceFileName:fileName,
      dateColumnIndex: dateIdx,
      workerColumnIndex: workerIdx,
      billingColumnIndex: billingIdx,
      slipColumnIndex: slipIdx,
      countRule: slipIdx >= 0 ? '作業者別に原票番号をユニーク化' : '原票番号列未検出のため行数で代替',
      amountRule: '作業者CSV金額から、幹線料系だけを集計前に除外（サイズ配送料は対象）',
      chartRule: '作業内容グラフは幹線料系を除外し、サイズ系とその他に分割',
      includedAmount: includedAmountTotal,
      salesAmount: salesAmountTotal,
      directAmount: directAmountTotal,
      excludedAmount: excludedAmountTotal,
      excludedLineRows,
      chartWorks: globalChartWorks,
      directWorks: globalDirectWorks,
      workDays: Array.from(allWorkDays).sort(),
      workDayCount: allWorkDays.size,
      avgPerWorkDay: allWorkDays.size > 0 ? totalSlipCount / allWorkDays.size : 0
    };
  }

  function productCategory(product){
    const p = clean(product);
    if (!p) return '未設定';
    if (/冷蔵|冷凍庫/.test(p)) return '冷蔵庫';
    if (/洗濯|乾燥/.test(p)) return '洗濯機';
    if (/テレビ|TV|ＴＶ/.test(p)) return 'テレビ';
    if (/エアコン|空調/.test(p)) return 'エアコン';
    if (/レンジ|オーブン/.test(p)) return 'レンジ';
    if (/炊飯/.test(p)) return '炊飯器';
    return 'その他';
  }
  function sizeBucketFromProduct(product){
    const p = clean(product);
    if (/冷蔵庫.*100.*199|１００～１９９|100～199/.test(p)) return '冷蔵庫100-199L';
    if (/冷蔵庫.*200.*299|２００～２９９|200～299/.test(p)) return '冷蔵庫200-299L';
    if (/冷蔵庫.*300|３００|300/.test(p)) return '冷蔵庫300L以上';
    if (/洗濯機.*5|５ｋｇ|5kg/i.test(p)) return '洗濯機5kg前後';
    if (/洗濯/.test(p)) return '洗濯機';
    return productCategory(p);
  }
  function areaFromAddress(address){
    const t = clean(address).replace(/\s+/g,'');
    if (!t) return { pref:'未設定', city:'未設定', area:'未設定' };
    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '未設定';
    const rest = prefMatch ? t.slice(pref.length) : t;
    let city = rest;
    const wardCity = rest.match(/^(.+?市.+?区)/);
    const muni = rest.match(/^(.+?[市区町村])/);
    if (wardCity) city = wardCity[1];
    else if (muni) city = muni[1];
    else city = rest.slice(0, 12) || '未設定';
    return { pref, city, area: pref === '未設定' ? city : pref + city };
  }



  function normalizeZip(v){
    return clean(v).replace(/[〒\s　\-]/g, '').replace(/[^0-9]/g, '');
  }

  function sanitizeAreaFromZipOrAddress(zip, address){
    const z = normalizeZip(zip);
    let a = null;
    if (z && window.JP_ZIP_LOADER && typeof JP_ZIP_LOADER.get === 'function') {
      const hit = JP_ZIP_LOADER.get(z);
      if (Array.isArray(hit)) a = { pref: clean(hit[0]) || '未設定', city: clean(hit[1]) || '未設定' };
      else if (hit && typeof hit === 'object') a = { pref: clean(hit.pref || hit.prefecture || hit[0]) || '未設定', city: clean(hit.city || hit.municipality || hit.addr1 || hit[1]) || '未設定' };
    }
    if (!a || !a.city || a.city === '未設定') a = areaFromAddress(address);
    return a || { pref:'未設定', city:'未設定', area:'未設定' };
  }

  function safeProductTicket(g){
    const area = sanitizeAreaFromZipOrAddress(g.zip, g.address);
    const pref = area.pref || '未設定';
    const city = area.city || '未設定';
    const areaUnit = pref === '未設定' ? city : pref + city;
    return {
      slip: g.slip,
      date: g.date || '',
      zip: g.zip,
      pref,
      city,
      area: areaUnit,
      areaUnit,
      product: g.product,
      category: productCategory(g.product),
      sizeBucket: sizeBucketFromProduct(g.product),
      amount: yen(g.amount),
      works: g.works,
      workDetails: g.workDetails,
      rowCount: g.rowCount,
      hasMultipleZip: g.seenZips.size > 1,
      hasMultipleAreaUnit: g.seenAreaUnits.size > 1,
      shipperCode: g.shipperCode || '',
      shipperName: g.shipperName || ''
    };
  }

  function parseProductAddressRows(rows, fileName){
    if (!rows.length) return { rawRows:0, detailRows:0, uniqueCount:0, tickets:[], multiAddressSlipCount:0, multiZipSlipCount:0 };

    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));

    // 商品・住所CSVは列位置を固定する。
    // 個人情報保護：顧客氏名・住所全文（番地/建物含む）・電話番号・CSV生行は保存しない。
    // I列：エスライン原票番号、L列：郵便番号、N列：住所（取込時に市区町村/区へ変換後破棄）、P列：商品、R列：作業内容、U列：金額、Y列：荷主基本コード、AA列：荷主名
    // 重要：I列原票番号が重複する前提。
    // 件数・商品・サイズ・エリアは、I列原票番号ごとに1件だけ採用する。
    // R列作業内容とU列金額だけは、重複行を原票番号へ紐づけて集計する。
    const idxDate    = 0;   // A列 日付（ある場合のみ）
    const idxSlip    = 8;   // I列 エスライン原票番号
    const idxZip     = 11;  // L列 郵便番号
    const idxAddress = 13;  // N列 住所（保存しない）
    const idxProduct = 15;  // P列 商品
    const idxWork    = 17;  // R列 作業内容
    const idxAmount  = 20;  // U列 金額
    const idxShipperCode = 24; // Y列 荷主基本コード
    const idxShipperName = 26; // AA列 荷主名

    const slipMap = new Map();
    let detailRows = 0;
    for (let rowIndex = 0; rowIndex < body.length; rowIndex++) {
      const row = body[rowIndex];
      const slip = clean(row[idxSlip]);
      if (!slip) continue;
      detailRows++;

      const date = clean(row[idxDate]);
      const zip = normalizeZip(row[idxZip]);
      const address = clean(row[idxAddress]);
      const product = clean(row[idxProduct]);
      const work = clean(row[idxWork]) || '未設定';
      const amount = yen(row[idxAmount]);
      const shipperCode = clean(row[idxShipperCode]);
      const shipperName = clean(row[idxShipperName]);
      const area0 = sanitizeAreaFromZipOrAddress(zip, address);
      const areaUnit0 = (area0.pref && area0.pref !== '未設定') ? area0.pref + area0.city : area0.city;

      if (!slipMap.has(slip)) {
        // 原票番号の初回出現行を代表行にする。
        // 以降の同一原票行は、件数・商品・サイズ・住所判定には使わない。
        slipMap.set(slip, {
          slip,
          firstRowOrder: rowIndex,
          date,
          zip,
          address, // 一時利用のみ。保存前に市区町村/区へ変換して破棄する。
          product,
          amount: 0,
          works: {},
          workDetails: [],
          rowCount: 0,
          seenZips: new Set(zip ? [zip] : []),
          seenAreaUnits: new Set(areaUnit0 ? [areaUnit0] : []),
          shipperCode,
          shipperName
        });
      }

      const g = slipMap.get(slip);
      g.rowCount++;

      // 代表行のL/N/Pが空だった場合だけ、後続行の値で補完する。
      // 値が入った後は上書きしない。
      if (!g.date && date) g.date = date;
      if (!g.zip && zip) g.zip = zip;
      if (!g.address && address) g.address = address; // 一時利用のみ
      if (!g.product && product) g.product = product;
      if (!g.shipperCode && shipperCode) g.shipperCode = shipperCode;
      if (!g.shipperName && shipperName) g.shipperName = shipperName;
      if (zip) g.seenZips.add(zip);
      if (areaUnit0) g.seenAreaUnits.add(areaUnit0);

      // R列作業内容・U列金額だけは原票に紐づけて集計する。
      g.amount += amount;
      g.works[work] = (g.works[work] || 0) + amount;
      g.workDetails.push({ work, amount });
    }

    const tickets = [...slipMap.values()].map(g => safeProductTicket(g));

    return {
      sourceFileName: fileName,
      rawRows: body.length,
      detailRows,
      uniqueCount: tickets.length,
      duplicateExcluded: Math.max(0, detailRows - tickets.length),
      addressCount: 0,
      zipCount: tickets.filter(t => t.zip).length,
      productCategoryCount: new Set(tickets.map(t => t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t => Object.keys(t.works || {}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      multiAddressSlipCount: tickets.filter(t => t.hasMultipleAreaUnit).length,
      multiZipSlipCount: tickets.filter(t => t.hasMultipleZip).length,
      tickets
    };
  }

  function upsertByYm(listName, record){
    ensureState();
    STATE[listName] = safeArray(STATE[listName]).filter(d => d.ym !== record.ym);
    STATE[listName].push(record);
    STATE[listName].sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }

  async function importWorker(files){
    ensureState(); setupYmSelects();
    const ym = selectedWorkerYM();
    let combined = {
      rowCount:0,
      lineRowCount:0,
      uniqueSlipCount:0,
      workerCount:0,
      workers:{},
      workDays:[],
      files:[],
      countRule:'作業者別に原票番号をユニーク化',
      amountRule:'作業者CSV金額から、幹線料系だけを集計前に除外（サイズ配送料は対象）',
      chartRule:'作業内容グラフは幹線料系を除外し、サイズ系とその他に分割',
      includedAmount:0,
      salesAmount:0,
      directAmount:0,
      excludedAmount:0,
      excludedLineRows:0,
      chartWorks:{},
      directWorks:{}
    };
    const allDays = new Set();
    const allSlips = new Set();

    for (const file of Array.from(files || [])) {
      const text = await readCsvFile(file);
      const parsed = parseWorkerCsvRows(csvRowsFromText(text), file.name);
      combined.lineRowCount += parsed.lineRowCount || 0;
      combined.includedAmount += Number(parsed.includedAmount || 0);
      combined.salesAmount += Number(parsed.salesAmount || 0);
      combined.directAmount += Number(parsed.directAmount || 0);
      combined.excludedAmount += Number(parsed.excludedAmount || 0);
      combined.excludedLineRows += Number(parsed.excludedLineRows || 0);
      combined.files.push(file.name);
      (parsed.workDays || []).forEach(d => allDays.add(d));
      Object.entries(parsed.chartWorks || {}).forEach(([k,v]) => combined.chartWorks[k] = (combined.chartWorks[k] || 0) + Number(v || 0));
      Object.entries(parsed.directWorks || {}).forEach(([k,v]) => combined.directWorks[k] = (combined.directWorks[k] || 0) + Number(v || 0));

      Object.values(parsed.workers || {}).forEach(w => {
        if (!combined.workers[w.name]) {
          combined.workers[w.name] = {
            name:w.name,
            rows:0,
            lineRows:0,
            amount:0,
            includedAmount:0,
            salesAmount:0,
            directAmount:0,
            excludedAmount:0,
            excludedLineRows:0,
            works:{},
            chartWorks:{},
            directWorks:{},
            includedWorks:{},
            excludedWorks:{},
            workDays:[],
            slips:{},
            slipList:[]
          };
        }
        const cw = combined.workers[w.name];
        cw.lineRows += Number(w.lineRows || 0);
        cw.excludedLineRows += Number(w.excludedLineRows || 0);
        (w.workDays || []).forEach(d => { if (!cw.workDays.includes(d)) cw.workDays.push(d); });
        Object.entries(w.works || {}).forEach(([k,v]) => cw.works[k] = (cw.works[k] || 0) + Number(v || 0));
        Object.entries(w.chartWorks || {}).forEach(([k,v]) => cw.chartWorks[k] = (cw.chartWorks[k] || 0) + Number(v || 0));
        Object.entries(w.directWorks || {}).forEach(([k,v]) => cw.directWorks[k] = (cw.directWorks[k] || 0) + Number(v || 0));
        Object.entries(w.includedWorks || {}).forEach(([k,v]) => cw.includedWorks[k] = (cw.includedWorks[k] || 0) + Number(v || 0));
        Object.entries(w.excludedWorks || {}).forEach(([k,v]) => cw.excludedWorks[k] = (cw.excludedWorks[k] || 0) + Number(v || 0));

        Object.entries(w.slips || {}).forEach(([slip, obj]) => {
          if (!cw.slips[slip]) {
            cw.slips[slip] = { slip, date:obj.date || '', amount:0, includedAmount:0, salesAmount:0, directAmount:0, excludedAmount:0, works:{}, chartWorks:{}, directWorks:{} };
            cw.rows += 1;
          }
          cw.slips[slip].amount += Number(obj.amount || 0);
          cw.slips[slip].includedAmount += Number(obj.includedAmount || obj.amount || 0);
          cw.slips[slip].salesAmount += Number(obj.salesAmount || 0);
          cw.slips[slip].directAmount += Number(obj.directAmount || 0);
          cw.slips[slip].excludedAmount += Number(obj.excludedAmount || 0);
          Object.entries(obj.works || {}).forEach(([k,v]) => cw.slips[slip].works[k] = (cw.slips[slip].works[k] || 0) + Number(v || 0));
          Object.entries(obj.chartWorks || {}).forEach(([k,v]) => cw.slips[slip].chartWorks[k] = (cw.slips[slip].chartWorks[k] || 0) + Number(v || 0));
          Object.entries(obj.directWorks || {}).forEach(([k,v]) => cw.slips[slip].directWorks[k] = (cw.slips[slip].directWorks[k] || 0) + Number(v || 0));
          if (slip && !String(slip).startsWith('__row_')) allSlips.add(slip);
        });
      });
    }

    Object.values(combined.workers).forEach(w => {
      w.workDays = Array.from(new Set(w.workDays || [])).sort();
      w.workDayCount = w.workDays.length;
      w.slipList = Object.keys(w.slips || {}).filter(k => !k.startsWith('__row_'));
      w.rows = Object.keys(w.slips || {}).length;
      w.amount = Object.values(w.slips || {}).reduce((s,x)=>s+Number(x.amount||0),0);
      w.includedAmount = Object.values(w.slips || {}).reduce((s,x)=>s+Number(x.includedAmount||x.amount||0),0);
      w.salesAmount = Object.values(w.slips || {}).reduce((s,x)=>s+Number(x.salesAmount||0),0);
      w.directAmount = Object.values(w.slips || {}).reduce((s,x)=>s+Number(x.directAmount||0),0);
      w.excludedAmount = Object.values(w.slips || {}).reduce((s,x)=>s+Number(x.excludedAmount||0),0);
      w.avgPerWorkDay = w.workDayCount > 0 ? w.rows / w.workDayCount : 0;
    });
    combined.rowCount = Object.values(combined.workers).reduce((s,w)=>s+Number(w.rows||0),0);
    combined.uniqueSlipCount = allSlips.size;
    combined.workerCount = Object.keys(combined.workers).length;
    combined.workDays = Array.from(allDays).sort();
    combined.workDayCount = combined.workDays.length;
    combined.avgPerWorkDay = combined.workDayCount > 0 ? combined.rowCount / combined.workDayCount : 0;
    combined.amountMode = '単一CSV：幹線料系除外後';

    if (typeof clearDataDeleted === 'function') { clearDataDeleted('workerMonths', ym); clearDataDeleted('fieldMonths', ym); }
    upsertByYm('workerCsvData', { ym, source:'worker_csv', importedAt:new Date().toISOString(), ...combined });
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} 作業者別CSVを入替完了：配送${combined.rowCount.toLocaleString()}件 / 作業者${combined.workerCount.toLocaleString()}名 / 金額${Math.round(combined.includedAmount/1000).toLocaleString()}千円（除外${Math.round(combined.excludedAmount/1000).toLocaleString()}千円）`);
  }

  async function importProduct(files){
    ensureState(); setupYmSelects();
    const ym = selectedProductYM();
    let allTickets = [];
    let rawRows = 0, detailRows = 0, filesUsed = [];
    for (const file of Array.from(files || [])) {
      const text = await readCsvFile(file);
      const parsed = parseProductAddressRows(csvRowsFromText(text), file.name);
      rawRows += parsed.rawRows;
      detailRows += parsed.detailRows;
      filesUsed.push(file.name);
      allTickets.push(...parsed.tickets);
    }
    // 複数ファイル選択時も原票番号で再ユニーク化
    const ticketMap = new Map();
    allTickets.forEach(t => {
      if (!t.slip) return;
      if (!ticketMap.has(t.slip)) ticketMap.set(t.slip, { ...t, works:{...t.works}, workDetails:[...(t.workDetails||[])] });
      else {
        const base = ticketMap.get(t.slip);
        base.amount += yen(t.amount);
        Object.entries(t.works || {}).forEach(([k,v]) => base.works[k] = (base.works[k] || 0) + yen(v));
        base.workDetails.push(...(t.workDetails || []));
      }
    });
    const tickets = [...ticketMap.values()];
    const record = {
      ym,
      source:'product_address_csv',
      importedAt:new Date().toISOString(),
      files: filesUsed,
      rawRows,
      detailRows,
      uniqueCount: tickets.length,
      duplicateExcluded: Math.max(0, detailRows - tickets.length),
      addressCount: 0,
      zipCount: tickets.filter(t=>t.zip).length,
      productCategoryCount: new Set(tickets.map(t=>t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t=>Object.keys(t.works||{}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      tickets
    };
    if (typeof clearDataDeleted === 'function') { clearDataDeleted('productMonths', ym); clearDataDeleted('fieldMonths', ym); }
    upsertByYm('productAddressData', record);
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} 商品・住所CSVを入替完了：原票${record.uniqueCount.toLocaleString()}件 / 明細${record.detailRows.toLocaleString()}行 / 重複除外${record.duplicateExcluded.toLocaleString()}行`);
  }

  window.FIELD_WORKER_IMPORT2 = {
    handleFiles(files){ importWorker(files).catch(e => msg('作業者CSV取込エラー：' + e.message, 'error')); },
    handleDrop(e){ e.preventDefault(); importWorker(e.dataTransfer.files).catch(err => msg('作業者CSV取込エラー：' + err.message, 'error')); }
  };
  window.FIELD_PRODUCT_IMPORT2 = {
    handleFiles(files){ importProduct(files).catch(e => msg('商品・住所CSV取込エラー：' + e.message, 'error')); },
    handleDrop(e){ e.preventDefault(); importProduct(e.dataTransfer.files).catch(err => msg('商品・住所CSV取込エラー：' + err.message, 'error')); }
  };

  function getSelectedFieldYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel?.value) return sel.value;
    const accessProducts = window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData);
    const accessWorkers = window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData);
    return STATE.selYM || accessProducts.at(-1)?.ym || accessWorkers.at(-1)?.ym || latestDS()?.ym || '';
  }
  function setupFieldCommonSelectors(){
    ensureState();
    const view = document.querySelector('#view-field-worker.view.active, #view-field-content.view.active, #view-field-product.view.active, #view-field-area.view.active, #view-field.view.active')
      || document.getElementById('view-field-worker')
      || document.getElementById('view-field-content')
      || document.getElementById('view-field-product')
      || document.getElementById('view-field-area')
      || document.getElementById('view-field');
    if (!view) return;
    let box = document.getElementById('field-common-selector-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'field-common-selector-box';
      box.className = 'card';
      box.style.cssText = 'margin-bottom:14px';
      box.innerHTML = `
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><div style="font-size:15px;font-weight:900">表示対象</div><div style="font-size:12px;color:var(--text3);margin-top:4px">年度順：4月 → 翌年3月 / 年度・月を共通管理</div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label style="font-size:12px;font-weight:800">対象年度</label><select id="field-common-fy-select" style="font-size:13px;font-weight:800;min-width:120px"></select>
            <label style="font-size:12px;font-weight:800">対象月</label><select id="field-common-month-select" style="font-size:13px;font-weight:800;min-width:190px"></select>
          </div>
        </div>`;
      view.insertBefore(box, view.firstChild);
    } else if (box.parentElement !== view) {
      view.insertBefore(box, view.firstChild);
    }
    const fySel = document.getElementById('field-common-fy-select');
    const mSel = document.getElementById('field-common-month-select');
    if (!fySel || !mSel) return;
    const yset = new Set([getDefaultFiscalYear()]);
    safeArray(STATE.datasets).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    (window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData)).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    (window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData)).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    const years = [...yset].sort((a,b)=>Number(b)-Number(a));
    const accessProducts = window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData);
    const accessWorkers = window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData);
    const keepFY = fySel.value || fiscalFromYM2(STATE.selYM || accessProducts.at(-1)?.ym || accessWorkers.at(-1)?.ym || latestDS()?.ym || `${new Date().getFullYear()}04`);
    fySel.innerHTML = years.map(y=>`<option value="${y}">${y}年度</option>`).join('');
    fySel.value = years.includes(keepFY) ? keepFY : years[0];
    function fillMonths(){
      const fy = fySel.value;
      const current = mSel.value || STATE.selYM;
      mSel.innerHTML = MONTHS.map(mm => {
        const ym = ymFromFiscalMonth(fy, mm);
        const hasW = (window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData)).some(d=>d.ym===ym);
        const hasP = (window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData)).some(d=>d.ym===ym);
        const label = ymText(ym);
        return `<option value="${ym}">${label}</option>`;
      }).join('');
      if ([...mSel.options].some(o=>o.value===current)) mSel.value = current;
      else {
        const latest = [...mSel.options].reverse().find(o => (window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData)).some(d=>d.ym===o.value) || (window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData)).some(d=>d.ym===o.value));
        mSel.value = latest ? latest.value : ymFromFiscalMonth(fy, '04');
      }
      STATE.fiscalYear = fy;
      STATE.selYM = mSel.value;
    }
    fySel.onchange = () => { fillMonths(); refreshFieldAll(false); };
    mSel.onchange = () => { STATE.selYM = mSel.value; refreshFieldAll(false); };
    fillMonths();
  }

  function productRecord(ym){ return (window.FIELD_DATA_ACCESS?.getProductRecords() || safeArray(STATE.productAddressData)).find(d=>d.ym===ym); }
  function workerRecord(ym){ return (window.FIELD_DATA_ACCESS?.getWorkerRecords() || safeArray(STATE.workerCsvData)).find(d=>d.ym===ym); }

  function renderBars(container, rows, valueKey='count'){
    if (!container) return;
    if (!rows.length) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">データを読み込んでください</div>'; return; }
    const max = Math.max(...rows.map(r=>Number(r[valueKey]||0)), 1);
    container.innerHTML = rows.map((r,i)=>{
      const val = Number(r[valueKey]||0);
      const pct = Math.max(2, Math.round(val/max*100));
      const sub = valueKey === 'amount' ? `${Math.round(val/1000).toLocaleString()}千円` : `${val.toLocaleString()}件`;
      return `<div class="field-area-row">
        <div class="field-area-label" title="${esc2(r.label)}">${i+1}. ${esc2(r.label)}</div>
        <div class="field-area-track"><div class="field-area-fill" style="width:${pct}%"></div></div>
        <div class="field-area-value">${sub}</div>
      </div>`;
    }).join('');
  }

  function renderMap(){
    const box = document.getElementById('field-map');
    const no = document.getElementById('map-no-data');
    if (!box) return;
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    if (!rec || !safeArray(rec.tickets).length) {
      box.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text3)">商品・住所CSVを読み込んでください</div>';
      if (no) no.style.display = 'none';
      return;
    }
    const mode = document.getElementById('field-area-view-mode')?.value || 'overall';
    const sortMode = document.getElementById('field-area-sort-mode')?.value || 'count';
    const metric = document.getElementById('map-metric-sel')?.value || 'count';
    const map = new Map();
    for (const t of rec.tickets) {
      const key = t.area || '未設定';
      if (!map.has(key)) map.set(key, { label:key, pref:t.pref||'未設定', city:t.city||key, count:0, amount:0 });
      const row = map.get(key);
      row.count += 1;
      row.amount += yen(t.amount);
    }
    let rows = [...map.values()];
    const sortFn = sortMode === 'amount' ? (a,b)=>b.amount-a.amount : sortMode === 'name' ? (a,b)=>a.label.localeCompare(b.label,'ja') : (a,b)=>b.count-a.count;
    rows.sort(sortFn);

    const summary = `<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2)">
      <strong>${ymText(ym)} / 商品・住所CSV / I列原票番号ユニーク件数で集計</strong>
      <span style="margin-left:14px">原票 ${rec.uniqueCount.toLocaleString()}件</span>
      <span style="margin-left:14px">金額 ${Math.round(rec.amount/1000).toLocaleString()}千円</span>
      <span style="margin-left:14px">重複除外 ${rec.duplicateExcluded.toLocaleString()}行</span>
    </div>`;

    if (mode !== 'pref') {
      box.innerHTML = summary + `<div style="padding:14px 16px">${barsHtml(rows, metric)}</div>`;
      return;
    }
    const prefMap = new Map();
    rows.forEach(r => {
      if (!prefMap.has(r.pref)) prefMap.set(r.pref, { pref:r.pref, count:0, amount:0, children:[] });
      const p = prefMap.get(r.pref); p.count += r.count; p.amount += r.amount; p.children.push(r);
    });
    const prefs = [...prefMap.values()].sort(sortFn);
    box.innerHTML = summary + `<div style="padding:14px 16px">` + prefs.map((p,idx)=>`
      <details ${idx<3?'open':''} style="border:1px solid var(--border);border-radius:12px;background:#fff;margin-bottom:10px;overflow:hidden">
        <summary style="cursor:pointer;padding:12px 14px;background:#f8fafc;font-weight:900;display:flex;justify-content:space-between;align-items:center">
          <span>＋ ${esc2(p.pref)} <span style="font-size:11px;color:var(--text3);font-weight:700">${p.children.length}地区</span></span>
          <span>${metric==='amount' ? Math.round(p.amount/1000).toLocaleString()+'千円' : p.count.toLocaleString()+'件'}</span>
        </summary>
        <div style="padding:10px 14px">${barsHtml(p.children.sort(sortFn), metric)}</div>
      </details>`).join('') + `</div>`;
  }
  function barsHtml(rows, metric){
    const key = metric === 'amount' ? 'amount' : 'count';
    if (!rows.length) return '<div style="padding:20px;color:var(--text3)">データなし</div>';
    const max = Math.max(...rows.map(r=>Number(r[key]||0)), 1);
    return rows.map((r,i)=>{
      const val = Number(r[key] || 0);
      const w = Math.max(2, Math.round(val/max*100));
      const amount = Math.round((r.amount||0)/1000).toLocaleString();
      return `<div class="field-area-row">
        <div class="field-area-label" title="${esc2(r.label)}">${i+1}. ${esc2(r.label)}</div>
        <div class="field-area-track"><div class="field-area-fill" style="width:${w}%"></div></div>
        <div class="field-area-value">${r.count.toLocaleString()}件 <span class="field-area-sub">/ ${amount}千円</span></div>
      </div>`;
    }).join('');
  }

  function renderWorker(){
    const ym = getSelectedFieldYM();
    const rec = workerRecord(ym);
    const kpi = document.getElementById('f-kpi-worker');
    const bars = document.getElementById('f-worker-bars');
    const tbody = document.getElementById('f-worker-tbody');
    if (!rec) {
      if (kpi) kpi.innerHTML = '<div class="card" style="grid-column:1/-1;padding:20px;color:var(--text3)">作業者別CSVを読み込んでください</div>';
      if (bars) bars.innerHTML = '<div style="padding:30px;color:var(--text3)">データなし</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">データなし</td></tr>';
      return;
    }
    const rows = Object.values(rec.workers||{}).map(w=>({ label:w.name, count:w.rows, amount:w.amount, works:w.works })).sort((a,b)=>b.count-a.count);
    if (kpi) kpi.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">対象月</div><div class="kpi-value">${ymText(ym)}</div></div>
      <div class="kpi-card"><div class="kpi-label">明細行</div><div class="kpi-value">${rec.rowCount.toLocaleString()}</div></div>
      <div class="kpi-card"><div class="kpi-label">作業者</div><div class="kpi-value">${rec.workerCount.toLocaleString()}</div></div>
      <div class="kpi-card"><div class="kpi-label">金額</div><div class="kpi-value">${Math.round(rows.reduce((s,r)=>s+r.amount,0)/1000).toLocaleString()}千円</div></div>`;
    renderBars(bars, rows.slice(0,20), 'count');
    if (tbody) tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">-</td><td class="r">${r.count?Math.round(r.amount/r.count).toLocaleString():0}</td><td class="r">-</td><td class="r">-</td><td class="r">-</td></tr>`).join('');
  }

  function renderContent(){
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    const tbody = document.getElementById('f-content-tbody');
    if (!tbody) return;
    if (!rec) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">商品・住所CSVを読み込んでください</td></tr>'; return; }
    const map = new Map();
    rec.tickets.forEach(t => Object.entries(t.works || {}).forEach(([work,amount]) => {
      if (!map.has(work)) map.set(work, { label:work, count:0, amount:0 });
      const r = map.get(work); r.count += 1; r.amount += yen(amount);
    }));
    const rows = [...map.values()].sort((a,b)=>b.amount-a.amount);
    const total = rows.reduce((s,r)=>s+r.amount,0) || 1;
    tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">${(r.amount/total*100).toFixed(1)}%</td></tr>`).join('');
  }
  function renderProduct(){
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    const tbody = document.getElementById('f-product-tbody');
    if (!tbody) return;
    if (!rec) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:24px">商品・住所CSVを読み込んでください</td></tr>'; return; }
    const map = new Map();
    rec.tickets.forEach(t => {
      const k = t.category || '未設定';
      if (!map.has(k)) map.set(k, { label:k, count:0, amount:0 });
      const r = map.get(k); r.count += 1; r.amount += yen(t.amount);
    });
    const rows = [...map.values()].sort((a,b)=>b.count-a.count);
    const total = rows.reduce((s,r)=>s+r.count,0) || 1;
    tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">${(r.count/total*100).toFixed(1)}%</td></tr>`).join('');
  }

  function monthDeleteOptionsHtml(ym, actions, mode){
    const usable = (actions || []).filter(a => a && a.value && a.label);
    if (!usable.length) return '<span style="color:var(--text3);font-size:11px;white-space:nowrap">削除対象なし</span>';
    const compact = mode === 'compact';
    const selectWidth = compact ? '132px' : '158px';
    return `<div class="field-month-op-wrap" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;max-width:100%">
      <select class="field-month-op-select" data-month-op-ym="${esc2(ym)}" style="width:${selectWidth};max-width:100%;padding:5px 28px 5px 9px;border:1px solid var(--border2);border-radius:999px;background:#fff;font-size:11px;font-weight:900;color:var(--text);white-space:nowrap;box-shadow:0 1px 3px rgba(15,23,42,.06)">
        <option value="">削除対象を選択</option>
        ${usable.map(a=>`<option value="${esc2(a.value)}">${esc2(a.label)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-danger" onclick="FIELD_MONTH_OPS.runFromSelect(this)" style="font-size:11px;padding:5px 10px;border-radius:999px;white-space:nowrap;line-height:1.2">削除</button>
    </div>`;
  }

  window.FIELD_MONTH_OPS = window.FIELD_MONTH_OPS || {};
  window.FIELD_MONTH_OPS.run = function(ym, action){
    if (!ym || !action) return;
    if (action === 'csv_confirmed') return DATA_STORAGE_TABLE?.deleteCsvMonth ? DATA_STORAGE_TABLE.deleteCsvMonth(ym, 'confirmed') : null;
    if (action === 'csv_daily') return DATA_STORAGE_TABLE?.deleteCsvMonth ? DATA_STORAGE_TABLE.deleteCsvMonth(ym, 'daily') : null;
    if (action === 'history') return DATA_STORAGE_TABLE?.deleteHistoryMonth ? DATA_STORAGE_TABLE.deleteHistoryMonth(ym) : null;
    if (action === 'worker') return FIELD_CSV_REBUILD?.deleteMonthType ? FIELD_CSV_REBUILD.deleteMonthType(ym, 'worker') : null;
    if (action === 'product') return FIELD_CSV_REBUILD?.deleteMonthType ? FIELD_CSV_REBUILD.deleteMonthType(ym, 'product') : null;
    if (action === 'field_all') return FIELD_CSV_REBUILD?.deleteMonthType ? FIELD_CSV_REBUILD.deleteMonthType(ym, 'all') : null;
  };
  window.FIELD_MONTH_OPS.runFromSelect = function(btn){
    const wrap = btn && btn.closest ? btn.closest('.field-month-op-wrap') : null;
    const sel = wrap ? wrap.querySelector('.field-month-op-select') : null;
    const ym = sel ? sel.dataset.monthOpYm : '';
    const action = sel ? sel.value : '';
    if (!action) {
      if (window.UI?.toast) UI.toast('削除対象を選択してください', 'warn');
      return;
    }
    const result = window.FIELD_MONTH_OPS.run(ym, action);
    if (sel) sel.value = '';
    return result;
  };

  function renderDataList(){
    ensureState();
    const list = document.getElementById('field-data-list2') || document.getElementById('field-data-list');
    const badge = document.getElementById('field-import-badge');
    const yms = window.FIELD_DATA_ACCESS?.getAllYms ? FIELD_DATA_ACCESS.getAllYms() : [...new Set([...safeArray(STATE.workerCsvData).map(d=>d.ym), ...safeArray(STATE.productAddressData).map(d=>d.ym)])].filter(Boolean).sort();
    if (badge) { badge.textContent = yms.length ? '読込済' : '未読込'; badge.className = yms.length ? 'badge badge-ok' : 'badge badge-warn'; }
    const delAll = document.getElementById('field-delete-all-row'); if (delAll) delAll.style.display = yms.length ? 'flex' : 'none';
    if (!list) return;
    if (!yms.length) { list.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>'; return; }
    list.innerHTML = yms.map(ym => {
      const w = workerRecord(ym);
      const p = productRecord(ym);
      return `<div style="padding:12px 16px;border-bottom:1px solid #eef2f7;display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div style="font-weight:900;font-size:14px;margin-bottom:6px">${ymText(ym)}</div>
          <div style="font-size:12px;line-height:1.7;color:var(--text2)">
            ${p ? `✅ 商品・住所CSV 原票${p.uniqueCount.toLocaleString()}件 / 明細${p.detailRows.toLocaleString()}行 / 重複除外${p.duplicateExcluded.toLocaleString()}行` : '⬜ 商品・住所CSV 未登録'}<br>
            ${w ? `✅ 作業者別CSV ${w.rowCount.toLocaleString()}行 / 作業者${w.workerCount.toLocaleString()}名` : '⬜ 作業者別CSV 未登録'}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end;align-items:center;white-space:nowrap">
          ${monthDeleteOptionsHtml(ym, [
            w ? { value:'worker', label:'作業者CSV削除' } : null,
            p ? { value:'product', label:'商品住所CSV削除' } : null,
            (w || p) ? { value:'field_all', label:'現場CSV月削除' } : null
          ], 'compact')}
        </div>
      </div>`;
    }).join('');
  }

  function renderMonthlyCheck(){
    window.renderMonthlyCheckTable = function(){
      const fy = typeof storageFiscalYear === 'function' ? storageFiscalYear() : (STATE.fiscalYear || getDefaultFiscalYear());
      const months = typeof storageFiscalMonths === 'function' ? storageFiscalMonths(fy) : MONTHS.map(mm=>ymFromFiscalMonth(fy,mm));
      const rows = months.map(ym => {
        const base = typeof storageMonthState === 'function' ? storageMonthState(fy, ym) : { ym, csvLabel:'未登録', csvKind:'danger', histLabel:'なし', histKind:'warn', planLabel:'未登録', planKind:'warn', judge:'漏れ', kind:'danger', note:'CSV未登録' };
        const w = workerRecord(ym);
        const p = productRecord(ym);
        let judge = base.judge, kind = base.kind, note = base.note || '';
        if (base.csvLabel === '未登録' && base.histLabel === 'なし') { judge = '漏れ'; kind = 'danger'; }
        if (p || w) {
          note = [
            note,
            w ? `作業者 ${Number(w.rowCount||0).toLocaleString()}行 / ${Number(w.workerCount||0).toLocaleString()}名` : '',
            p ? `商品住所 原票${Number(p.uniqueCount||0).toLocaleString()}件 / 明細${Number(p.detailRows||0).toLocaleString()}行 / 重複除外${Number(p.duplicateExcluded||0).toLocaleString()}行` : ''
          ].filter(Boolean).join(' / ');
        }
        const hasConfirmed = safeArray(STATE.datasets).some(d => d && d.ym === ym && d.source !== 'history' && (d.type || 'confirmed') === 'confirmed');
        const hasDaily = safeArray(STATE.datasets).some(d => d && d.ym === ym && d.source !== 'history' && d.type === 'daily');
        const hasHistory = safeArray(STATE.datasets).some(d => d && d.ym === ym && d.source === 'history');
        const ops = monthDeleteOptionsHtml(ym, [
          hasConfirmed ? { value:'csv_confirmed', label:'確定CSV削除' } : null,
          hasDaily ? { value:'csv_daily', label:'速報CSV削除' } : null,
          hasHistory ? { value:'history', label:'補完削除' } : null,
          w ? { value:'worker', label:'作業者CSV削除' } : null,
          p ? { value:'product', label:'商品住所CSV削除' } : null,
          (w || p) ? { value:'field_all', label:'現場CSV月削除' } : null
        ]);
        return { ...base, workerLabel:w?'登録済':'未登録', workerKind:w?'ok':'danger', productLabel:p?'登録済':'未登録', productKind:p?'ok':'danger', judge, kind, note, ops };
      });
      const need = rows.filter(r => r.kind !== 'ok').length;
      const summary = typeof storageBadge === 'function' ? storageBadge(`確認 ${need}ヶ月`, need ? 'warn' : 'ok') : '';
      const badge = (label,kind) => typeof storageBadge === 'function' ? storageBadge(label,kind) : label;
      return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${Number(fy)+1}年3月（年度順）/ CSVは月単位で個別削除できます</div></div><div>${summary}</div></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th style="white-space:nowrap">月</th><th style="white-space:nowrap">収支CSV</th><th style="white-space:nowrap">収支補完</th><th style="white-space:nowrap">計画</th><th style="white-space:nowrap">作業者CSV</th><th style="white-space:nowrap">商品住所CSV</th><th style="white-space:nowrap">判定</th><th>確認内容</th><th style="white-space:nowrap">月別操作</th></tr></thead><tbody>
        ${rows.map(s=>`<tr><td><strong>${ymText(s.ym)}</strong></td><td>${badge(s.csvLabel,s.csvKind)}</td><td>${badge(s.histLabel,s.histKind)}</td><td>${badge(s.planLabel,s.planKind)}</td><td>${badge(s.workerLabel,s.workerKind)}</td><td>${badge(s.productLabel,s.productKind)}</td><td>${badge(s.judge,s.kind)}</td><td style="min-width:260px;color:var(--text2)">${esc2(s.note)}</td><td style="min-width:150px;white-space:nowrap;text-align:left"><div style="display:flex;gap:6px;flex-wrap:nowrap;align-items:center;white-space:nowrap">${s.ops}</div></td></tr>`).join('')}
        </tbody></table></div></div>`;
    };
  }

  function refreshFieldAll(rebuildSelectors=true){
    ensureState();
    setupFieldCommonSelectors();
    setupYmSelects();
    FIELD_UI.updatePeriodBadge();
    const isWorkerViewActive = (document.getElementById('view-field-worker')?.classList.contains('active')) || STATE.view === 'field-worker';
    const isProductViewActive = (document.getElementById('view-field-product')?.classList.contains('active')) || STATE.view === 'field-product';
    const isAreaViewActive = (document.getElementById('view-field-area')?.classList.contains('active')) || STATE.view === 'field-area';

    if (isWorkerViewActive && window.FIELD_WORKER_UI && typeof window.FIELD_WORKER_UI.render === 'function') {
      window.FIELD_WORKER_UI.render();
    } else {
      renderWorker();
    }

    renderContent();

    // 商品カテゴリ分析・エリア分析は専用モジュールが画面全体を描画する。
    // ここで旧コア描画を常に走らせると、専用UIが「データなし」に戻るため、
    // 対象画面が開いている時は専用モジュールを優先する。
    if (isProductViewActive && window.FIELD_PRODUCT_UI) {
      if (typeof window.FIELD_PRODUCT_UI.refresh === 'function') window.FIELD_PRODUCT_UI.refresh();
      else if (typeof window.FIELD_PRODUCT_UI.render === 'function') window.FIELD_PRODUCT_UI.render();
    } else {
      renderProduct();
    }

    if (isAreaViewActive && window.FIELD_AREA_UI && typeof window.FIELD_AREA_UI.render === 'function') {
      window.FIELD_AREA_UI.render();
    } else {
      renderMap();
    }

    renderDataList();
    const topBadge = document.getElementById('field-period-badge');
    if (topBadge) {
      const ym = getSelectedFieldYM();
      const w = workerRecord(ym), p = productRecord(ym);
      topBadge.textContent = `${ymText(ym)} ${w||p?'読込済':'未登録'}`;
    }
  }

  async function deleteMonthType(ym, type){
    ensureState();
    const w = workerRecord(ym);
    const p = productRecord(ym);
    if (type === 'worker' && !w) { msg(`${ymText(ym)} の作業者CSVは未登録です`, 'warn'); return; }
    if (type === 'product' && !p) { msg(`${ymText(ym)} の商品住所CSVは未登録です`, 'warn'); return; }
    if (type === 'all' && !w && !p) { msg(`${ymText(ym)} の現場CSVは未登録です`, 'warn'); return; }
    const label = type==='all' ? '現場CSV（作業者・商品住所）' : type==='worker' ? '作業者CSV' : '商品住所CSV';
    if (!confirm(`${ymText(ym)} の${label}を削除しますか？\n収支CSV・収支補完・計画データは削除しません。`)) return;

    if (type === 'worker' || type === 'all') {
      if (typeof markDataDeleted === 'function') markDataDeleted('workerMonths', ym);
      STATE.workerCsvData = safeArray(STATE.workerCsvData).filter(d => d.ym !== ym);
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    }
    if (type === 'product' || type === 'all') {
      if (typeof markDataDeleted === 'function') markDataDeleted('productMonths', ym);
      STATE.productAddressData = safeArray(STATE.productAddressData).filter(d => d.ym !== ym);
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    }
    if (type === 'all' && typeof markDataDeleted === 'function') markDataDeleted('fieldMonths', ym);
    // 旧混在データも同じ年月は消して復活を防止
    STATE.fieldData = safeArray(STATE.fieldData).filter(d => d.ym !== ym);
    STATE.areaData = safeArray(STATE.areaData).filter(d => d.ym !== ym);
    if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
    STORE.save();
    try {
      if (CLOUD?.pushAll) await CLOUD.pushAll();
    } catch(e) {
      msg(`${ymText(ym)} の${label}はローカル削除済みですが、クラウド同期に失敗しました`, 'warn');
    }
    refreshFieldAll();
    msg(`${ymText(ym)} の${label}を削除しました`, 'warn');
  }

  /* 確定CSV 原票番号別売上マップ作成
     - 作業者CSVは先に入るため、まず速報表示
     - 確定CSV取込後は、作業者CSVの原票番号と一致した分だけ確定売上へ切替
     - 確定CSV側に存在しない原票番号は確定売上に含めない（一致率で表示） */
  (function setupConfirmedSlipSalesPatch(){
    if (window.__FIELD_CONFIRMED_SLIP_SALES_PATCH_20260501__) return;
    window.__FIELD_CONFIRMED_SLIP_SALES_PATCH_20260501__ = true;

    function detectConfirmedColumns(rows){
      const header = rows && rows.length ? rows[0] : [];
      return {
        accountName: headerIndex(header, ['収支科目名','経費計上先収支科目名','科目名'], 10), // K列
        amount:      headerIndex(header, ['金額','売上金額','請求金額','合計金額'], 13),       // N列
        slipNo:      headerIndex(header, ['原票番号','エスライン原票番号','伝票番号','配送番号'], 23), // X列
        shipperCode: headerIndex(header, ['荷主基本コード','荷主コード','荷主ＣＤ','荷主CD'], 24), // Y列
        shipperName: headerIndex(header, ['荷主名','荷主名称'], 26) // AA列
      };
    }

    function buildConfirmedSlipSalesFromRows(rows){
      rows = safeArray(rows);
      if (!rows.length) return { map:{}, count:0, income:0, columns:null };
      const c = detectConfirmedColumns(rows);
      const map = {};
      const body = rows.length > 1 ? rows.slice(1) : rows;
      body.forEach((row)=>{
        if (!Array.isArray(row)) return;
        const account = clean(row[c.accountName]);
        if (!account || !account.includes('収入')) return;
        const slip = normalizeSlipNo(row[c.slipNo]);
        if (!slip) return;
        const amount = yen(row[c.amount]);
        if (!map[slip]) {
          map[slip] = { slip, income:0, rows:0, shipperCode:clean(row[c.shipperCode]), shipperName:clean(row[c.shipperName]) };
        }
        map[slip].income += amount;
        map[slip].rows += 1;
      });
      const values = Object.values(map);
      return {
        map,
        count: values.length,
        income: values.reduce((s,x)=>s+Number(x.income||0),0),
        columns:c,
        rule:'確定CSVの収入行のみ／X列原票番号別にN列金額を合算'
      };
    }

    const oldParseSKDL = CSV.parseSKDL.bind(CSV);
    CSV.parseSKDL = function(text, monthCol){
      const result = oldParseSKDL(text, monthCol);
      if (!result) return result;
      try {
        const rows = this.toRows(text);
        const built = buildConfirmedSlipSalesFromRows(rows);
        result._confirmedSlipSales = built.map;
        result._confirmedSlipSalesCount = built.count;
        result._confirmedSlipSalesIncome = built.income;
        result._confirmedSlipSalesColumns = built.columns;
        result._confirmedSlipSalesRule = built.rule;
      } catch(e) {
        result._confirmedSlipSales = {};
        result._confirmedSlipSalesError = e.message;
      }
      return result;
    };

    const oldProcessDataset = processDataset;
    processDataset = function(ym, type, rows){
      const ds = oldProcessDataset(ym, type, rows);
      if (rows && rows._confirmedSlipSales) {
        ds.confirmedSlipSales = rows._confirmedSlipSales;
        ds.confirmedSlipSalesCount = rows._confirmedSlipSalesCount || 0;
        ds.confirmedSlipSalesIncome = rows._confirmedSlipSalesIncome || 0;
        ds.confirmedSlipSalesColumns = rows._confirmedSlipSalesColumns || null;
        ds.confirmedSlipSalesRule = rows._confirmedSlipSalesRule || '';
        ds.confirmedSlipSalesError = rows._confirmedSlipSalesError || '';
      }
      return ds;
    };
  })();

  window.setupFieldCommonSelectors = setupFieldCommonSelectors;
  window.FIELD_CSV_REBUILD = { refresh:refreshFieldAll, deleteMonthType, importWorker, importProduct, renderWorker, renderContent, renderProduct, renderMap, renderDataList };
  window.renderFieldDataList2 = renderDataList;
  if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = function(){
    if (!confirm('現場明細データ（作業者CSV・商品住所CSV）を全月削除しますか？')) return;
    ensureState();
    const months = new Set([...(STATE.workerCsvData||[]).map(d=>d.ym), ...(STATE.productAddressData||[]).map(d=>d.ym), ...(STATE.fieldData||[]).map(d=>d.ym), ...(STATE.areaData||[]).map(d=>d.ym)].filter(Boolean));
    if (typeof markDataDeleted === 'function') months.forEach(ym => markDataDeleted('fieldMonths', ym));
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    STATE.areaData = [];
    if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg('現場明細データを全削除しました', 'warn');
  };

  // FIELD_UIをCSV専用に上書き
  FIELD_UI.renderMap = renderMap;
  FIELD_UI.renderDataList = function(){ refreshFieldAll(); };
  FIELD_UI.updatePeriodBadge = function(){
    const badge = document.getElementById('field-period-badge');
    if (!badge) return;
    const ym = getSelectedFieldYM();
    badge.textContent = `${ymText(ym)} ${(workerRecord(ym)||productRecord(ym)) ? '読込済' : '未登録'}`;
  };
  const oldSwitch = FIELD_UI.switchTab.bind(FIELD_UI);
  FIELD_UI.switchTab = function(el){ oldSwitch(el); refreshFieldAll(true); };

  renderMonthlyCheck();

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      ensureState();
      setupYmSelects();
      setupFieldCommonSelectors();
      refreshFieldAll(false);
    }, 200);
  });
})();


  window.FIELD_UI = FIELD_UI;
})();
