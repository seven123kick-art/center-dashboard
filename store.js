/* ════════ STORE（軽量設定キャッシュのみ / データ本体はSupabase DB） ════════════════ */
var STORE = window.STORE = {
  _p: `mgmt5_${CENTER.id}_`,

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

  /*
    重要方針：
    - CSV本体（datasets / workerCsvData / productAddressData / fieldData / areaData）はlocalStorageへ保存しない。
    - 正本は Supabase DB(center_realtime_state) の月別・種類別データ。
    - localStorageは画面設定・削除マーカー・軽量インデックスだけ。
  */
  _purgeLargeKeys() {
    [
      'datasets',
      'workerCsvData',
      'productAddressData',
      'fieldData',
      'areaData',
      'field_worker_index',
      'field_product_index'
    ].forEach(k => this._rm(k));

    // 旧分割保存キーの掃除。センター別prefix配下だけを対象にする。
    try {
      const removeKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (!key.startsWith(this._p)) continue;
        const short = key.slice(this._p.length);
        if (
          /^field_worker_\d{6}$/.test(short) ||
          /^field_product_\d{6}$/.test(short) ||
          /^fieldData/.test(short) ||
          /^areaData/.test(short)
        ) {
          removeKeys.push(key);
        }
      }
      removeKeys.forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  },

  _datasetIndex() {
    return (Array.isArray(STATE.datasets) ? STATE.datasets : []).map(d => ({
      ym: d.ym,
      type: d.type || 'confirmed',
      source: d.source || 'csv',
      importedAt: d.importedAt || d.updatedAt || d.savedAt || null,
      totalIncome: Number(d.totalIncome || 0),
      totalExpense: Number(d.totalExpense || 0),
      profit: Number(d.profit || 0)
    })).filter(d => d.ym);
  },

  _fieldIndex(kind, records) {
    const list = Array.isArray(records) ? records : [];
    const seen = new Set();
    return list.filter(r => r && r.ym && !seen.has(r.ym) && seen.add(r.ym)).map(rec => {
      const base = {
        ym: rec.ym,
        source: rec.source || (kind === 'worker' ? 'worker_csv' : 'product_address_csv'),
        importedAt: rec.importedAt || rec.updatedAt || rec.savedAt || null
      };
      if (kind === 'worker') {
        base.rowCount = Number(rec.rowCount || 0);
        base.workerCount = Number(rec.workerCount || 0);
      } else {
        base.uniqueCount = Number(rec.uniqueCount || (Array.isArray(rec.tickets) ? rec.tickets.length : 0) || 0);
        base.detailRows = Number(rec.detailRows || 0);
        base.rawRows = Number(rec.rawRows || 0);
        base.amount = Number(rec.amount || 0);
      }
      return base;
    }).sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  },

  load() {
    // データ本体はDBからCLOUDが読む。ここで旧localStorage本体を読まない。
    this._purgeLargeKeys();
    STATE.datasets = [];
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    STATE.areaData = [];

    STATE.capacity = this._g('capacity') || null;
    STATE.planData = normalizePlanData(this._g('planData'));
    STATE.memos = this._g('memos') || {};
    STATE.library = this._g('library') || [];
    STATE.reportKnowledge = normalizeReportKnowledge(this._g('reportKnowledge') || STATE.reportKnowledge);
    STATE.deleted = normalizeDeletedState(this._g('deleted') || STATE.deleted);

    sanitizePersonalDataState(STATE);
    applyDeletionTombstonesToState(STATE);
  },

  save() {
    sanitizePersonalDataState(STATE);
    this._purgeLargeKeys();

    // 軽量インデックスだけ保存。画面上の「何件あるか」確認用で、本体復元には使わない。
    this._s('dataset_index', this._datasetIndex());
    this._s('worker_index', this._fieldIndex('worker', STATE.workerCsvData || []));
    this._s('product_index', this._fieldIndex('product', STATE.productAddressData || []));

    // 小さく、設定として使うものだけlocalStorageへ残す。
    this._s('capacity', STATE.capacity);
    this._s('planData', STATE.planData);
    this._s('memos', STATE.memos);
    this._s('library', STATE.library);
    this._s('reportKnowledge', STATE.reportKnowledge);
    this._s('deleted', STATE.deleted);
  },

  exportJSON() {
    sanitizePersonalDataState(STATE);
    const blob = new Blob([JSON.stringify({
      center: CENTER.id,
      exportedAt: new Date().toISOString(),
      datasets: STATE.datasets,
      workerCsvData: STATE.workerCsvData || [],
      productAddressData: STATE.productAddressData || [],
      fieldData: STATE.fieldData,
      areaData: STATE.areaData,
      capacity: STATE.capacity,
      planData: STATE.planData,
      memos: STATE.memos,
      library: STATE.library,
      reportKnowledge: STATE.reportKnowledge,
      deleted: STATE.deleted,
    }, null, 2)], { type:'application/json' });
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
      if (d.datasets) STATE.datasets = d.datasets;
      if (d.workerCsvData) STATE.workerCsvData = d.workerCsvData;
      if (d.productAddressData) STATE.productAddressData = d.productAddressData;
      if (d.fieldData) STATE.fieldData = d.fieldData;
      if (d.areaData) STATE.areaData = d.areaData;
      if (d.capacity) STATE.capacity = d.capacity;
      if (d.planData) STATE.planData = normalizePlanData(d.planData);
      if (d.memos) STATE.memos = d.memos;
      if (d.library) STATE.library = d.library;
      if (d.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(d.reportKnowledge);
      if (d.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, d.deleted);
      sanitizePersonalDataState(STATE);
      applyDeletionTombstonesToState(STATE);
      this.save();
      if (typeof CLOUD !== 'undefined' && CLOUD && typeof CLOUD.pushAll === 'function') {
        try { await CLOUD.pushAll(); } catch(e) { console.warn('[STORE] restore cloud save failed', e); }
      }
      NAV.refresh();
      UI.toast('バックアップを復元しました');
    } catch(e) {
      UI.toast('読込エラー: ' + e.message, 'error');
    }
  },

  storageInfo() {
    this._purgeLargeKeys();
    const keys = [
      'dataset_index','worker_index','product_index',
      'capacity','planData','memos','library','reportKnowledge','deleted'
    ];
    let size = 0;
    keys.forEach(k => {
      try { size += (localStorage.getItem(this._p + k) || '').length * 2; } catch(e) {}
    });
    return { bytes:size, kb:(size / 1024).toFixed(1) };
  },
};
