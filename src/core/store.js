/* ════════ §4 STORE（localStorage、センター別） ════════════════ */
var STORE = window.STORE = {
  _p: `mgmt5_${CENTER.id}_`,

  _s(k, v) { try { localStorage.setItem(this._p+k, JSON.stringify(v)); return true; } catch(e){ console.warn('[STORE] localStorage save failed', k, e); return false; } },
  _g(k)    { try { const v=localStorage.getItem(this._p+k); return v?JSON.parse(v):null; } catch(e){ return null; } },
  _rm(k) { try { localStorage.removeItem(this._p+k); } catch(e){} },
  _fieldIndexKey(kind) { return `field_${kind}_index`; },
  _fieldMonthKey(kind, ym) { return `field_${kind}_${ym}`; },
  _fieldMeta(kind, rec) {
    if (!rec || !rec.ym) return null;
    const base = {
      ym: rec.ym,
      source: rec.source || (kind === 'worker' ? 'worker_csv' : 'product_address_csv'),
      importedAt: rec.importedAt || rec.updatedAt || rec.savedAt || null
    };
    if (kind === 'worker') {
      base.rowCount = rec.rowCount || 0;
      base.workerCount = rec.workerCount || 0;
    } else {
      base.uniqueCount = rec.uniqueCount || (Array.isArray(rec.tickets) ? rec.tickets.length : 0);
      base.detailRows = rec.detailRows || 0;
      base.amount = rec.amount || 0;
    }
    return base;
  },
  _loadFieldSplit(kind, legacyKey) {
    const index = this._g(this._fieldIndexKey(kind));
    const out = [];
    if (Array.isArray(index) && index.length) {
      index.forEach(meta => {
        const ym = meta && meta.ym;
        if (!ym) return;
        const rec = this._g(this._fieldMonthKey(kind, ym));
        if (rec && rec.ym) out.push(rec);
      });
      if (out.length) return out.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    }
    const legacy = this._g(legacyKey);
    return Array.isArray(legacy) ? legacy : [];
  },
  _saveFieldSplit(kind, records) {
    const list = Array.isArray(records) ? records.filter(r => r && r.ym) : [];
    const index = [];
    const seen = new Set();
    list.forEach(rec => {
      if (!rec || !rec.ym || seen.has(rec.ym)) return;
      seen.add(rec.ym);
      const meta = this._fieldMeta(kind, rec);
      if (meta) index.push(meta);
    });
    const sortedIndex = index.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

    // 完成形方針：現場明細CSV本体はSupabase DBを正本にする。
    // localStorageへ大容量CSVを保存すると、ブラウザ容量超過でセンター切替後に0件化するため、
    // ローカルには軽量な月別インデックスだけを残す。
    const okIndex = this._s(this._fieldIndexKey(kind), sortedIndex);
    this._s(kind === 'worker' ? 'workerCsvData' : 'productAddressData', sortedIndex);
    return okIndex;
  },

  load() {
    STATE.datasets  = this._g('datasets')  || [];
    STATE.workerCsvData = this._loadFieldSplit('worker', 'workerCsvData');
    STATE.productAddressData = this._loadFieldSplit('product', 'productAddressData');
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
    this._saveFieldSplit('worker', STATE.workerCsvData || []);
    this._saveFieldSplit('product', STATE.productAddressData || []);
    this._s('fieldData', STATE.fieldData);
    this._s('areaData',  STATE.areaData);
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
      NAV.refresh();
      UI.toast('バックアップを復元しました');
    } catch(e) { UI.toast('読込エラー: '+e.message, 'error'); }
  },

  storageInfo() {
    // localStorage全探索は行わず、現在のSTORE管理キーだけを見る。
    // データ本体はSupabase DB正本のため、ここはキャッシュ/設定容量の目安として扱う。
    const keys = [
      'datasets','field_worker_index','field_product_index','workerCsvData','productAddressData',
      'fieldData','areaData','capacity','planData','memos','library','reportKnowledge','deleted'
    ];
    let size = 0;
    keys.forEach(k => { try { size += (localStorage.getItem(this._p + k) || '').length * 2; } catch(e){} });
    return { bytes: size, kb: (size/1024).toFixed(1) };
  },
};
