/* ════════ §4 STORE（localStorage、センター別） ════════════════ */
window.STORE = {
  _p: `mgmt5_${CENTER.id}_`,
  _keys: ['datasets','fieldData','areaData','capacity','planData','memos','library','reportKnowledge','deleted','workerCsvData','productAddressData'],
  _backupIndexKey: `mgmt5_${CENTER.id}_backup_index`,
  _backupDataPrefix: `mgmt5_${CENTER.id}_backup_`,
  _backupLimit: 3,

  _s(k, v) { try { localStorage.setItem(this._p+k, JSON.stringify(v)); } catch(e){} },
  _g(k)    { try { const v=localStorage.getItem(this._p+k); return v?JSON.parse(v):null; } catch(e){ return null; } },

  load() {
    STATE.datasets  = this._g('datasets')  || [];
    STATE.fieldData = this._g('fieldData') || [];
    STATE.areaData  = this._g('areaData')  || [];
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
    this._s('datasets',  STATE.datasets);
    this._s('fieldData', STATE.fieldData);
    this._s('areaData',  STATE.areaData);
    this._s('capacity',  STATE.capacity);
    this._s('planData',  STATE.planData);
    this._s('memos',     STATE.memos);
    this._s('library',   STATE.library);
    this._s('reportKnowledge', STATE.reportKnowledge);
    this._s('deleted', STATE.deleted);
  },

  _exportPayload() {
    sanitizePersonalDataState(STATE);
    return {
      center:CENTER.id,
      exportedAt:new Date().toISOString(),
      datasets:STATE.datasets,
      fieldData:STATE.fieldData,
      areaData:STATE.areaData,
      capacity:STATE.capacity,
      planData:STATE.planData,
      memos:STATE.memos,
      library:STATE.library,
      reportKnowledge:STATE.reportKnowledge,
      deleted:STATE.deleted,
      workerCsvData:STATE.workerCsvData || [],
      productAddressData:STATE.productAddressData || []
    };
  },

  _backupIndex() {
    try { return JSON.parse(localStorage.getItem(this._backupIndexKey) || '[]'); } catch(e) { return []; }
  },

  _saveBackupIndex(rows) {
    try { localStorage.setItem(this._backupIndexKey, JSON.stringify(rows || [])); } catch(e) {}
  },

  _backupBytes(id) {
    try { return (localStorage.getItem(this._backupDataPrefix + id) || '').length * 2; } catch(e) { return 0; }
  },

  createLocalBackup(reason='手動作成') {
    const payload = this._exportPayload();
    const json = JSON.stringify(payload);
    const id = `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    try {
      localStorage.setItem(this._backupDataPrefix + id, json);
      let rows = this._backupIndex().filter(r => r && r.id);
      rows.unshift({
        id,
        savedAt: payload.exportedAt,
        reason,
        bytes: json.length * 2,
        datasets: Array.isArray(payload.datasets) ? payload.datasets.length : 0,
        workers: Array.isArray(payload.workerCsvData) ? payload.workerCsvData.length : 0,
        products: Array.isArray(payload.productAddressData) ? payload.productAddressData.length : 0
      });
      while (rows.length > this._backupLimit) {
        const old = rows.pop();
        try { localStorage.removeItem(this._backupDataPrefix + old.id); } catch(e) {}
      }
      this._saveBackupIndex(rows);
      return { ok:true, id, bytes: json.length * 2 };
    } catch(e) {
      try { localStorage.removeItem(this._backupDataPrefix + id); } catch(_) {}
      return { ok:false, error:e.message || String(e) };
    }
  },

  listLocalBackups() {
    return this._backupIndex().map(r => ({ ...r, bytes: r.bytes || this._backupBytes(r.id) }));
  },

  deleteLocalBackup(id) {
    if (!id) return { ok:false, error:'IDなし' };
    try { localStorage.removeItem(this._backupDataPrefix + id); } catch(e) {}
    this._saveBackupIndex(this._backupIndex().filter(r => r.id !== id));
    return { ok:true };
  },

  restoreLocalBackup(id) {
    if (!id) return { ok:false, error:'IDなし' };
    try {
      const text = localStorage.getItem(this._backupDataPrefix + id);
      if (!text) return { ok:false, error:'バックアップが見つかりません' };
      const d = JSON.parse(text);
      if (d.center && d.center !== CENTER.id) return { ok:false, error:`別センター(${d.center})のバックアップです` };
      if (d.datasets)  STATE.datasets  = d.datasets;
      if (d.fieldData) STATE.fieldData = d.fieldData;
      if (d.areaData)  STATE.areaData  = d.areaData;
      if (d.capacity)  STATE.capacity  = d.capacity;
      if (d.planData) STATE.planData = normalizePlanData(d.planData);
      if (d.memos)     STATE.memos     = d.memos;
      if (d.library)   STATE.library   = d.library;
      if (d.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(d.reportKnowledge);
      if (d.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, d.deleted);
      if (Array.isArray(d.workerCsvData)) STATE.workerCsvData = d.workerCsvData;
      if (Array.isArray(d.productAddressData)) STATE.productAddressData = d.productAddressData;
      sanitizePersonalDataState(STATE);
      applyDeletionTombstonesToState(STATE);
      this.save();
      return { ok:true };
    } catch(e) { return { ok:false, error:e.message || String(e) }; }
  },

  exportJSON() {
    const blob = new Blob([JSON.stringify(this._exportPayload(), null, 2)], {type:'application/json'});
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
      if (d.fieldData) STATE.fieldData = d.fieldData;
      if (d.areaData)  STATE.areaData  = d.areaData;
      if (d.capacity)  STATE.capacity  = d.capacity;
      if (d.planData) STATE.planData = normalizePlanData(d.planData);
      if (d.memos)     STATE.memos     = d.memos;
      if (d.library)   STATE.library   = d.library;
      if (d.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(d.reportKnowledge);
      if (d.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, d.deleted);
      if (Array.isArray(d.workerCsvData)) STATE.workerCsvData = d.workerCsvData;
      if (Array.isArray(d.productAddressData)) STATE.productAddressData = d.productAddressData;
      sanitizePersonalDataState(STATE);
      applyDeletionTombstonesToState(STATE);
      this.save();
      NAV.refresh();
      UI.toast('バックアップを復元しました');
    } catch(e) { UI.toast('読込エラー: '+e.message, 'error'); }
  },

  storageInfo() {
    // localStorage全探索は行わない。STOREが管理する既知キーだけを集計する。
    let size = 0;
    for (const key of this._keys) {
      try { size += (localStorage.getItem(this._p + key) || '').length * 2; } catch(e) {}
    }
    const backupBytes = this.listLocalBackups().reduce((sum,b)=>sum + (Number(b.bytes)||0), 0);
    return { bytes: size, kb: (size/1024).toFixed(1), backupBytes, backupKb: (backupBytes/1024).toFixed(1), totalBytes:size+backupBytes, totalKb: ((size+backupBytes)/1024).toFixed(1) };
  },

  managedKeys() {
    return this._keys.map(key => this._p + key);
  },
};

