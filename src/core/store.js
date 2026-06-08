/* ════════ §4 STORE（localStorageは軽量設定・索引のみ。データ本体はSupabase DB） ════════════════ */
var STORE = window.STORE = {
  _p: `mgmt5_${CENTER.id}_`,

  _BIG_KEYS: [
    'datasets',
    'workerCsvData',
    'productAddressData',
    'fieldData',
    'areaData'
  ],

  _s(k, v) {
    try {
      localStorage.setItem(this._p + k, JSON.stringify(v));
      return true;
    } catch(e) {
      console.warn('[STORE] localStorage save failed', k, e);
      return false;
    }
  },

  _g(k) {
    try {
      const v = localStorage.getItem(this._p + k);
      return v ? JSON.parse(v) : null;
    } catch(e) {
      return null;
    }
  },

  _rm(k) {
    try { localStorage.removeItem(this._p + k); } catch(e) {}
  },

  _cleanupLargeLocalData() {
    // 完成形方針：CSV本体・集計本体はSupabase DBを正本にする。
    // 古いlocalStorage本体が残ると、センター切替時に古い空/壊れたデータで上書きされるため必ず削除する。
    this._BIG_KEYS.forEach(k => this._rm(k));
  },

  _datasetMeta(ds) {
    if (!ds || !ds.ym) return null;
    return {
      ym: ds.ym,
      type: ds.type || 'confirmed',
      source: ds.source || 'csv',
      fiscalYear: ds.fiscalYear || (typeof fiscalYearFromYM === 'function' ? fiscalYearFromYM(ds.ym) : null),
      importedAt: ds.importedAt || ds.updatedAt || ds.savedAt || null,
      totalIncome: Number(ds.totalIncome || 0),
      totalExpense: Number(ds.totalExpense || 0),
      profit: Number(ds.profit || 0)
    };
  },

  _fieldMeta(kind, rec) {
    if (!rec || !rec.ym) return null;
    const base = {
      ym: rec.ym,
      source: rec.source || (kind === 'worker' ? 'worker_csv' : 'product_address_csv'),
      importedAt: rec.importedAt || rec.updatedAt || rec.savedAt || null
    };
    if (kind === 'worker') {
      base.rowCount = Number(rec.rowCount || rec.lineRowCount || 0);
      base.workerCount = Number(rec.workerCount || 0);
    } else {
      base.uniqueCount = Number(rec.uniqueCount || (Array.isArray(rec.tickets) ? rec.tickets.length : 0));
      base.detailRows = Number(rec.detailRows || 0);
      base.rawRows = Number(rec.rawRows || 0);
      base.amount = Number(rec.amount || 0);
    }
    return base;
  },

  _saveDatasetIndex() {
    const index = (Array.isArray(STATE.datasets) ? STATE.datasets : [])
      .filter(d => d && d.ym && d.source !== 'history')
      .map(d => this._datasetMeta(d))
      .filter(Boolean)
      .sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.type).localeCompare(String(b.type)));
    return this._s('dataset_index', index);
  },

  _saveFieldIndex(kind, records) {
    const index = (Array.isArray(records) ? records : [])
      .filter(r => r && r.ym)
      .map(r => this._fieldMeta(kind, r))
      .filter(Boolean)
      .sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    return this._s(`field_${kind}_index`, index);
  },

  load() {
    // データ本体はlocalStorageから復元しない。
    // 起動後にCLOUD.pullInitialForBoot / 画面別遅延読込でDBから復元する。
    this._cleanupLargeLocalData();
    STATE.datasets = [];
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    STATE.areaData = [];

    STATE.capacity  = this._g('capacity')  || null;
    STATE.planData  = normalizePlanData(this._g('planData'));
    STATE.memos     = this._g('memos')     || {};
    STATE.library   = this._g('library')   || [];
    STATE.reportKnowledge = normalizeReportKnowledge(this._g('reportKnowledge') || STATE.reportKnowledge);
    STATE.deleted = normalizeDeletedState(this._g('deleted') || STATE.deleted);
    sanitizePersonalDataState(STATE);
    applyDeletionTombstonesToState(STATE);
  },

  save() {
    sanitizePersonalDataState(STATE);

    // 先に旧巨大キーを削除。ここが残るとQuotaExceededErrorとセンター切替後の0件化が再発する。
    this._cleanupLargeLocalData();

    // localStorageには軽量インデックスだけ保存する。
    this._saveDatasetIndex();
    this._saveFieldIndex('worker', STATE.workerCsvData || []);
    this._saveFieldIndex('product', STATE.productAddressData || []);

    this._s('capacity',  STATE.capacity);
    this._s('planData',  STATE.planData);
    this._s('memos',     STATE.memos);
    this._s('library',   STATE.library);
    this._s('reportKnowledge', STATE.reportKnowledge);
    this._s('deleted', STATE.deleted);
  },

  exportJSON() {
    sanitizePersonalDataState(STATE);
    const blob = new Blob([JSON.stringify({
      center:CENTER.id, exportedAt:new Date().toISOString(),
      datasets:STATE.datasets, workerCsvData:STATE.workerCsvData || [], productAddressData:STATE.productAddressData || [], fieldData:STATE.fieldData, areaData:STATE.areaData,
      capacity:STATE.capacity, planData:STATE.planData, memos:STATE.memos, library:STATE.library, reportKnowledge:STATE.reportKnowledge, deleted:STATE.deleted,
    },null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${CENTER.id}_backup_${dt()}.json`;
    a.click();
  },

  async restoreJSON(file) {
    try {
      const d = JSON.parse(await file.text());
      if (d.center && d.center !== CENTER.id &&
          !confirm(`別センター(${d.center})のデータです。読み込みますか？`)) return;
      if (d.datasets)  STATE.datasets  = d.datasets;
      if (d.workerCsvData) STATE.workerCsvData = d.workerCsvData;
      if (d.productAddressData) STATE.productAddressData = d.productAddressData;
      if (d.fieldData) STATE.fieldData = d.fieldData;
      if (d.areaData)  STATE.areaData  = d.areaData;
      if (d.capacity)  STATE.capacity  = d.capacity;
      if (d.planData) STATE.planData = normalizePlanData(d.planData);
      if (d.memos)     STATE.memos     = d.memos;
      if (d.library)   STATE.library   = d.library;
      if (d.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(d.reportKnowledge);
      if (d.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, d.deleted);
      sanitizePersonalDataState(STATE);
      applyDeletionTombstonesToState(STATE);
      this.save();
      if (CLOUD?.pushAll) await CLOUD.pushAll().catch(()=>{});
      NAV.refresh();
      UI.toast('バックアップを復元しました');
    } catch(e) { UI.toast('読込エラー: '+e.message, 'error'); }
  },

  storageInfo() {
    const keys = [
      'dataset_index','field_worker_index','field_product_index',
      'capacity','planData','memos','library','reportKnowledge','deleted'
    ];
    let size = 0;
    keys.forEach(k => { try { size += (localStorage.getItem(this._p + k) || '').length * 2; } catch(e){} });
    return { bytes: size, kb: (size/1024).toFixed(1) };
  },
};
