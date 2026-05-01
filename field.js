/* =====================================================================
   経営管理システム field.js
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

  // STOREへ新しい現場CSV専用データを保存対象として追加
  const originalStoreLoad = STORE.load.bind(STORE);
  const originalStoreSave = STORE.save.bind(STORE);
  STORE.load = function(){
    originalStoreLoad();
    STATE.workerCsvData = this._g('workerCsvData') || [];
    STATE.productAddressData = this._g('productAddressData') || [];
    ensureState();
  };
  STORE.save = function(){
    ensureState();
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
      return ok;
    };
  }

  function setupYmSelects(){
    ensureState();
    const years = new Set();
    const now = new Date();
    for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) years.add(String(y));
    safeArray(STATE.datasets).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.workerCsvData).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.productAddressData).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
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

  function parseWorkerCsvRows(rows, fileName){
    if (!rows.length) return { rowCount:0, workerCount:0, workers:{} };
    const header = rows[0] || [];
    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));
    const workerIdx = headerIndex(header, ['作業者名','作業者','担当者','社員名','氏名'], 0);
    const amountIdx = headerIndex(header, ['金額','売上','合計'], -1);
    const workIdx = headerIndex(header, ['作業内容','内容','科目'], -1);
    const workers = {};
    body.forEach(r => {
      const name = clean(r[workerIdx]) || '未設定';
      if (!workers[name]) workers[name] = { name, rows:0, amount:0, works:{} };
      workers[name].rows += 1;
      if (amountIdx >= 0) workers[name].amount += yen(r[amountIdx]);
      if (workIdx >= 0) {
        const w = clean(r[workIdx]) || '未設定';
        workers[name].works[w] = (workers[name].works[w] || 0) + 1;
      }
    });
    return { rowCount: body.length, workerCount: Object.keys(workers).length, workers, sourceFileName:fileName };
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

  function parseProductAddressRows(rows, fileName){
    if (!rows.length) return { rawRows:0, detailRows:0, uniqueCount:0, tickets:[], multiAddressSlipCount:0, multiZipSlipCount:0 };

    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));

    // 商品・住所CSVは列位置を固定する。
    // I列：エスライン原票番号、L列：郵便番号、N列：住所、P列：商品、R列：作業内容、U列：金額
    // 重要：I列原票番号が重複する前提。
    // 件数・商品・サイズ・エリアは、I列原票番号ごとに1件だけ採用する。
    // R列作業内容とU列金額だけは、重複行を原票番号へ紐づけて集計する。
    const idxSlip    = 8;   // I列 エスライン原票番号
    const idxZip     = 11;  // L列 郵便番号
    const idxAddress = 13;  // N列 住所
    const idxProduct = 15;  // P列 商品
    const idxWork    = 17;  // R列 作業内容
    const idxAmount  = 20;  // U列 金額

    const slipMap = new Map();
    let detailRows = 0;

    function normalizeZip(v){
      return clean(v).replace(/[〒\s　\-]/g, '').replace(/[^0-9]/g, '');
    }

    for (let rowIndex = 0; rowIndex < body.length; rowIndex++) {
      const row = body[rowIndex];
      const slip = clean(row[idxSlip]);
      if (!slip) continue;
      detailRows++;

      const zip = normalizeZip(row[idxZip]);
      const address = clean(row[idxAddress]);
      const product = clean(row[idxProduct]);
      const work = clean(row[idxWork]) || '未設定';
      const amount = yen(row[idxAmount]);

      if (!slipMap.has(slip)) {
        // 原票番号の初回出現行を代表行にする。
        // 以降の同一原票行は、件数・商品・サイズ・住所判定には使わない。
        slipMap.set(slip, {
          slip,
          firstRowOrder: rowIndex,
          representativeRow: row,
          zip,
          address,
          product,
          amount: 0,
          works: {},
          workDetails: [],
          rowCount: 0,
          seenZips: new Set(zip ? [zip] : []),
          seenAddresses: new Set(address ? [address] : [])
        });
      }

      const g = slipMap.get(slip);
      g.rowCount++;

      // 代表行のL/N/Pが空だった場合だけ、後続行の値で補完する。
      // 値が入った後は上書きしない。
      if (!g.zip && zip) g.zip = zip;
      if (!g.address && address) g.address = address;
      if (!g.product && product) g.product = product;
      if (zip) g.seenZips.add(zip);
      if (address) g.seenAddresses.add(address);

      // R列作業内容・U列金額だけは原票に紐づけて集計する。
      g.amount += amount;
      g.works[work] = (g.works[work] || 0) + amount;
      g.workDetails.push({ work, amount });
    }

    const tickets = [...slipMap.values()].map(g => {
      const area = areaFromAddress(g.address);
      return {
        slip: g.slip,
        zip: g.zip,
        address: g.address,
        product: g.product,
        category: productCategory(g.product),
        sizeBucket: sizeBucketFromProduct(g.product),
        pref: area.pref,
        city: area.city,
        area: area.area,
        amount: yen(g.amount),
        works: g.works,
        workDetails: g.workDetails,
        rowCount: g.rowCount,
        hasMultipleZip: g.seenZips.size > 1,
        hasMultipleAddress: g.seenAddresses.size > 1,
        firstRow: g.representativeRow
      };
    });

    return {
      sourceFileName: fileName,
      rawRows: body.length,
      detailRows,
      uniqueCount: tickets.length,
      duplicateExcluded: Math.max(0, detailRows - tickets.length),
      addressCount: tickets.filter(t => t.address).length,
      zipCount: tickets.filter(t => t.zip).length,
      productCategoryCount: new Set(tickets.map(t => t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t => Object.keys(t.works || {}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      multiAddressSlipCount: tickets.filter(t => t.hasMultipleAddress).length,
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
    let combined = { rowCount:0, workerCount:0, workers:{}, files:[] };
    for (const file of Array.from(files || [])) {
      const text = await readCsvFile(file);
      const parsed = parseWorkerCsvRows(csvRowsFromText(text), file.name);
      combined.rowCount += parsed.rowCount;
      combined.files.push(file.name);
      Object.values(parsed.workers || {}).forEach(w => {
        if (!combined.workers[w.name]) combined.workers[w.name] = { name:w.name, rows:0, amount:0, works:{} };
        combined.workers[w.name].rows += w.rows;
        combined.workers[w.name].amount += w.amount;
        Object.entries(w.works || {}).forEach(([k,v]) => combined.workers[w.name].works[k] = (combined.workers[w.name].works[k] || 0) + v);
      });
    }
    combined.workerCount = Object.keys(combined.workers).length;
    upsertByYm('workerCsvData', { ym, source:'worker_csv', importedAt:new Date().toISOString(), ...combined });
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} 作業者別CSVを入替完了：${combined.rowCount.toLocaleString()}行 / 作業者${combined.workerCount.toLocaleString()}名`);
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
      addressCount: tickets.filter(t=>t.address).length,
      zipCount: tickets.filter(t=>t.zip).length,
      productCategoryCount: new Set(tickets.map(t=>t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t=>Object.keys(t.works||{}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      tickets
    };
    upsertByYm('productAddressData', record);
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
    return STATE.selYM || safeArray(STATE.productAddressData).at(-1)?.ym || safeArray(STATE.workerCsvData).at(-1)?.ym || latestDS()?.ym || '';
  }
  function setupFieldCommonSelectors(){
    ensureState();
    const view = document.getElementById('view-field');
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
      const tabs = view.querySelector('.field-tabs');
      view.insertBefore(box, tabs || view.firstChild);
    }
    const fySel = document.getElementById('field-common-fy-select');
    const mSel = document.getElementById('field-common-month-select');
    if (!fySel || !mSel) return;
    const yset = new Set([getDefaultFiscalYear()]);
    safeArray(STATE.datasets).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.workerCsvData).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.productAddressData).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    const years = [...yset].sort((a,b)=>Number(b)-Number(a));
    const keepFY = fySel.value || fiscalFromYM2(STATE.selYM || safeArray(STATE.productAddressData).at(-1)?.ym || safeArray(STATE.workerCsvData).at(-1)?.ym || latestDS()?.ym || `${new Date().getFullYear()}04`);
    fySel.innerHTML = years.map(y=>`<option value="${y}">${y}年度</option>`).join('');
    fySel.value = years.includes(keepFY) ? keepFY : years[0];
    function fillMonths(){
      const fy = fySel.value;
      const current = mSel.value || STATE.selYM;
      mSel.innerHTML = MONTHS.map(mm => {
        const ym = ymFromFiscalMonth(fy, mm);
        const hasW = safeArray(STATE.workerCsvData).some(d=>d.ym===ym);
        const hasP = safeArray(STATE.productAddressData).some(d=>d.ym===ym);
        const label = `${ymText(ym)}${hasW||hasP ? `（${hasW?'作業者':''}${hasW&&hasP?'・':''}${hasP?'商品住所':''}あり）` : '（未登録）'}`;
        return `<option value="${ym}">${label}</option>`;
      }).join('');
      if ([...mSel.options].some(o=>o.value===current)) mSel.value = current;
      else {
        const latest = [...mSel.options].reverse().find(o => /あり/.test(o.textContent));
        mSel.value = latest ? latest.value : ymFromFiscalMonth(fy, '04');
      }
      STATE.fiscalYear = fy;
      STATE.selYM = mSel.value;
    }
    fySel.onchange = () => { fillMonths(); refreshFieldAll(false); };
    mSel.onchange = () => { STATE.selYM = mSel.value; refreshFieldAll(false); };
    fillMonths();
  }

  function productRecord(ym){ return safeArray(STATE.productAddressData).find(d=>d.ym===ym); }
  function workerRecord(ym){ return safeArray(STATE.workerCsvData).find(d=>d.ym===ym); }

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

  function renderDataList(){
    ensureState();
    const list = document.getElementById('field-data-list2') || document.getElementById('field-data-list');
    const badge = document.getElementById('field-import-badge');
    const yms = [...new Set([...safeArray(STATE.workerCsvData).map(d=>d.ym), ...safeArray(STATE.productAddressData).map(d=>d.ym)])].filter(Boolean).sort();
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${w ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','worker')">作業者削除</button>` : ''}
          ${p ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','product')">商品住所削除</button>` : ''}
          <button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','all')">月削除</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderMonthlyCheck(){
    const oldFn = window.renderMonthlyCheckTable;
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
          note = [note, w ? `作業者 ${w.rowCount.toLocaleString()}行 / ${w.workerCount.toLocaleString()}名` : '', p ? `商品住所 原票${p.uniqueCount.toLocaleString()}件 / 明細${p.detailRows.toLocaleString()}行 / 重複除外${p.duplicateExcluded.toLocaleString()}行` : ''].filter(Boolean).join(' / ');
        }
        return { ...base, workerLabel:w?'登録済':'未登録', workerKind:w?'ok':'danger', productLabel:p?'登録済':'未登録', productKind:p?'ok':'danger', judge, kind, note };
      });
      const need = rows.filter(r => r.kind !== 'ok').length;
      const summary = typeof storageBadge === 'function' ? storageBadge(`確認 ${need}ヶ月`, need ? 'warn' : 'ok') : '';
      const badge = (label,kind) => typeof storageBadge === 'function' ? storageBadge(label,kind) : label;
      return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${Number(fy)+1}年3月（年度順）</div></div><div>${summary}</div></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
        ${rows.map(s=>`<tr><td><strong>${ymText(s.ym)}</strong></td><td>${badge(s.csvLabel,s.csvKind)}</td><td>${badge(s.histLabel,s.histKind)}</td><td>${badge(s.planLabel,s.planKind)}</td><td>${badge(s.workerLabel,s.workerKind)}</td><td>${badge(s.productLabel,s.productKind)}</td><td>${badge(s.judge,s.kind)}</td><td style="min-width:260px;color:var(--text2)">${esc2(s.note)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    };
  }

  function refreshFieldAll(rebuildSelectors=true){
    ensureState();
    if (rebuildSelectors) setupFieldCommonSelectors();
    setupYmSelects();
    FIELD_UI.updatePeriodBadge();
    renderWorker();
    renderContent();
    renderProduct();
    renderMap();
    renderDataList();
    const topBadge = document.getElementById('field-period-badge');
    if (topBadge) {
      const ym = getSelectedFieldYM();
      const w = workerRecord(ym), p = productRecord(ym);
      topBadge.textContent = `${ymText(ym)} ${w||p?'読込済':'未登録'}`;
    }
  }

  function deleteMonthType(ym, type){
    ensureState();
    if (type === 'worker' || type === 'all') STATE.workerCsvData = safeArray(STATE.workerCsvData).filter(d => d.ym !== ym);
    if (type === 'product' || type === 'all') STATE.productAddressData = safeArray(STATE.productAddressData).filter(d => d.ym !== ym);
    // 旧混在データも同じ年月は消して復活を防止
    STATE.fieldData = safeArray(STATE.fieldData).filter(d => d.ym !== ym);
    STATE.areaData = safeArray(STATE.areaData).filter(d => d.ym !== ym);
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} の${type==='all'?'現場明細':type==='worker'?'作業者CSV':'商品住所CSV'}を削除しました`, 'warn');
  }
  window.FIELD_CSV_REBUILD = { refresh:refreshFieldAll, deleteMonthType, importWorker, importProduct };
  window.renderFieldDataList2 = renderDataList;
  if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = function(){
    if (!confirm('現場明細データ（作業者CSV・商品住所CSV）を全月削除しますか？')) return;
    ensureState();
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    STATE.areaData = [];
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
  FIELD_UI.switchTab = function(el){ oldSwitch(el); refreshFieldAll(false); };

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
