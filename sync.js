/* ════════ §9 CLOUD（Supabase — 取込時のみ自動実行） ═══════════ */
window.CLOUD = {
  _sb: null,
  _LSKEY: 'mgmt5_cloud_cfg',
  _busy: false,

  _cfg() {
    try { const s = localStorage.getItem(this._LSKEY); if (s) return JSON.parse(s); } catch(e) {}
    return { url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_KEY, bucket: CONFIG.SUPABASE_BUCKET };
  },
  _saveCfg(url, key, bucket) { try { localStorage.setItem(this._LSKEY, JSON.stringify({ url, key, bucket })); } catch(e) {} this._sb = null; },
  async _client() {
    if (this._sb) return this._sb;
    try {
      await ASSETS.supabase();
      if (!window.supabase) return null;
      const cfg = this._cfg();
      if (!cfg.url || !cfg.key) return null;
      this._sb = window.supabase.createClient(cfg.url, cfg.key);
      return this._sb;
    } catch(e) { return null; }
  },
  _bucket() { return this._cfg().bucket || CONFIG.SUPABASE_BUCKET; },
  _manifestKey() { return `${CENTER.id}/manifest.json`; },
  _datasetKey(ym, type='confirmed') { return `${CENTER.id}/skdl/${ym}_${type || 'confirmed'}.json`; },
  _capacityKey() { return `${CENTER.id}/capacity/master.json`; },
  _fieldKey() { return `${CENTER.id}/field/data.json`; },
  _workerMonthKey(ym) { return `${CENTER.id}/field/worker/${ym}.json`; },
  _productMonthKey(ym) { return `${CENTER.id}/field/product/${ym}.json`; },
  _fullStateKey() { return `${CENTER.id}/full_state.json`; },
  _planKey() { return `${CENTER.id}/plan/data.json`; },
  _memosKey() { return `${CENTER.id}/memos/data.json`; },
  _libraryKey() { return `${CENTER.id}/library/data.json`; },
  _libraryFileKey(fileName, fy='unknown') {
    // Supabase Storage の key はURLパスとして扱われるため、表示名と保存名を分離する。
    // 日本語・括弧・空白などは使わず、英数字だけの保存名にする。元のファイル名は fileName として台帳に残す。
    const extRaw = String(fileName || '').split('.').pop() || 'bin';
    const ext = String(extRaw).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeFy = String(fy || 'unknown').replace(/[^0-9a-zA-Z_-]/g, '_');
    return `${CENTER.id}/library_files/${safeFy}/${uid}.${ext}`;
  },
  _legacyKey() { return `${CENTER.id}/data_v5.json`; },
  _makeManifest() {
    const workerCsv = Array.isArray(STATE.workerCsvData) ? STATE.workerCsvData : [];
    const productCsv = Array.isArray(STATE.productAddressData) ? STATE.productAddressData : [];
    return {
      version: 31,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      datasets: STATE.datasets.filter(d => d.source !== 'history').map(d => ({
        ym:d.ym,
        type:d.type || 'confirmed',
        source:d.source || 'csv',
        importedAt:d.importedAt || null,
        totalIncome:d.totalIncome || 0,
        totalExpense:d.totalExpense || 0,
        profit:d.profit || 0
      })),
      workerCsvData: workerCsv.map(d => ({
        ym:d.ym,
        source:d.source || 'worker_csv',
        importedAt:d.importedAt || d.updatedAt || d.savedAt || null,
        rowCount:d.rowCount || 0,
        workerCount:d.workerCount || 0
      })),
      productAddressData: productCsv.map(d => ({
        ym:d.ym,
        source:d.source || 'product_address_csv',
        importedAt:d.importedAt || d.updatedAt || d.savedAt || null,
        uniqueCount:d.uniqueCount || 0,
        detailRows:d.detailRows || 0,
        rawRows:d.rawRows || 0,
        amount:d.amount || 0
      })),
      hasCapacity: !!STATE.capacity,
      hasFieldData: !!(STATE.fieldData && STATE.fieldData.length),
      hasPlanData: !!(STATE.planData && Object.keys(STATE.planData).length),
      planDataUpdatedAt: latestPlanUpdatedAt(),
      hasMemos: !!(STATE.memos && Object.keys(STATE.memos).length),
      hasLibrary: !!(STATE.library && STATE.library.length),
      hasReportKnowledge: !!(STATE.reportKnowledge && ((STATE.reportKnowledge.references||[]).length || Object.keys(STATE.reportKnowledge.policies||{}).length)),
      deleted: STATE.deleted || {},
    };
  },
  _makeFullState() {
    // full_state は起動・復元用の軽量台帳だけにする。
    // CSV本体（収支・作業者・商品住所）は月単位JSONへ分割保存し、ここへ入れない。
    // ここへ大きい配列を入れると Supabase Storage の object size 上限で同期失敗する。
    sanitizePersonalDataState(STATE);
    return {
      version: 31,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      fiscalYear: STATE.fiscalYear || null,
      capacity: STATE.capacity || null,
      planData: STATE.planData || {},
      memos: STATE.memos || {},
      library: STATE.library || [],
      reportKnowledge: STATE.reportKnowledge || { policies:{}, references:[] },
      deleted: STATE.deleted || {},
    };
  },

  _applyFullState(full) {
    if (!full || typeof full !== 'object') return false;
    if (full.center && full.center !== CENTER.id) return false;
    if (Array.isArray(full.datasets)) STATE.datasets = full.datasets;
    if (Array.isArray(full.fieldData)) STATE.fieldData = full.fieldData;
    if (Array.isArray(full.areaData)) STATE.areaData = full.areaData;
    if ('capacity' in full) STATE.capacity = full.capacity || null;
    if (full.planData) STATE.planData = normalizePlanData(full.planData);
    if (full.fiscalYear) STATE.fiscalYear = full.fiscalYear;
    if (full.memos && typeof full.memos === 'object') STATE.memos = full.memos;
    if (Array.isArray(full.library)) STATE.library = full.library;
    if (full.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(full.reportKnowledge);
    STATE.deleted = mergeDeletedStates(STATE.deleted, full.deleted || {});
    sanitizePersonalDataState(STATE);
    applyDeletionTombstonesToState(STATE);
    if (typeof AUTO_SYNC !== 'undefined') {
      AUTO_SYNC.withoutSync(() => STORE.save());
    } else {
      STORE.save();
    }
    return true;
  },
  _isSizeError(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('maximum allowed size') || msg.includes('payload too large') || msg.includes('413') || (msg.includes('object') && msg.includes('size'));
  },
  _chunkKey(key, idx) {
    return `${key}.chunks/${String(idx).padStart(4,'0')}.part`;
  },
  async _uploadBlob(key, blob, contentType='application/octet-stream') {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const { error } = await sb.storage.from(this._bucket()).upload(key, blob, { upsert:true, contentType });
    if (error) throw error;
    return { ok:true };
  },
  async _uploadJSON(key, value) {
    value = sanitizedCloneForExport(value);
    const json = JSON.stringify(value);
    const blob = new Blob([json], { type:'application/json' });

    try {
      await this._uploadBlob(key, blob, 'application/json');
      return { ok:true, chunked:false };
    } catch(error) {
      if (!this._isSizeError(error)) throw error;
    }

    // Supabase bucketのobject size上限を超える場合は、小さいテキスト片に分割して保存する。
    // 元のkeyには「分割台帳」だけを置くため、既存の downloadJSON 呼び出しはそのまま使える。
    const chunkSize = 24 * 1024;
    const chunks = [];
    for (let i=0; i<json.length; i += chunkSize) chunks.push(json.slice(i, i + chunkSize));

    for (let i=0; i<chunks.length; i++) {
      await this._uploadBlob(this._chunkKey(key, i), new Blob([chunks[i]], { type:'text/plain' }), 'text/plain');
    }

    const pointer = {
      __chunked: true,
      version: 1,
      center: CENTER.id,
      key,
      chunks: chunks.length,
      chunkSize,
      savedAt: new Date().toISOString(),
      bytes: json.length
    };
    await this._uploadBlob(key, new Blob([JSON.stringify(pointer)], { type:'application/json' }), 'application/json');
    return { ok:true, chunked:true, chunks:chunks.length };
  },
  async _downloadJSON(key) {
    const sb = await this._client();
    if (!sb) return null;
    const { data, error } = await sb.storage.from(this._bucket()).download(key);
    if (error) return null;
    const text = await data.text();
    const first = JSON.parse(text);
    if (first && first.__chunked && Number(first.chunks) > 0) {
      let joined = '';
      for (let i=0; i<Number(first.chunks); i++) {
        const part = await sb.storage.from(this._bucket()).download(this._chunkKey(key, i));
        if (part.error || !part.data) throw new Error(`分割データの取得に失敗しました: ${key} #${i+1}`);
        joined += await part.data.text();
      }
      return JSON.parse(joined);
    }
    return first;
  },
  async uploadFile(key, file) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const { error } = await sb.storage.from(this._bucket()).upload(key, file, {
      upsert:true,
      contentType: file.type || 'application/octet-stream'
    });
    if (error) throw error;
    return { ok:true, key };
  },
  async deleteFile(key) {
    const sb = await this._client();
    if (!sb || !key) return { ok:false, error:'Supabase未設定またはキーなし' };
    const { error } = await sb.storage.from(this._bucket()).remove([key]);
    if (error) return { ok:false, error:error.message };
    return { ok:true };
  },
  async createSignedUrl(key) {
    const sb = await this._client();
    if (!sb || !key) return null;
    const { data, error } = await sb.storage.from(this._bucket()).createSignedUrl(key, 60 * 10);
    if (error) return null;
    return data?.signedUrl || null;
  },
  async pushMonth(ym) {
    if (!ym) return { ok:false, error:'対象月なし' };
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      const targets = STATE.datasets.filter(d => d.ym === ym && d.source !== 'history');
      const workers = (STATE.workerCsvData || []).filter(d => d && d.ym === ym);
      const products = (STATE.productAddressData || []).filter(d => d && d.ym === ym);
      if (!targets.length && !workers.length && !products.length) return { ok:false, error:'対象月データなし' };
      for (const ds of targets) await this._uploadJSON(this._datasetKey(ym, ds.type || 'confirmed'), ds);
      for (const w of workers) await this._uploadJSON(this._workerMonthKey(ym), w);
      for (const pr of products) await this._uploadJSON(this._productMonthKey(ym), pr);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      await this._uploadJSON(this._fullStateKey(), this._makeFullState());
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
    finally { this._busy = false; }
  },
  async pushCapacity() {
    if (!STATE.capacity) return { ok:false, error:'キャパデータなし' };
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      await this._uploadJSON(this._capacityKey(), STATE.capacity);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      await this._uploadJSON(this._fullStateKey(), this._makeFullState());
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
    finally { this._busy = false; }
  },
  async pushAll() {
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      for (const ds of STATE.datasets.filter(d => d.source !== 'history')) await this._uploadJSON(this._datasetKey(ds.ym, ds.type || 'confirmed'), ds);
      for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) await this._uploadJSON(this._workerMonthKey(w.ym), w);
      for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) await this._uploadJSON(this._productMonthKey(pr.ym), pr);
      if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
      await this._uploadJSON(this._planKey(), STATE.planData || {});
      if (STATE.memos && Object.keys(STATE.memos).length) await this._uploadJSON(this._memosKey(), STATE.memos);
      if (STATE.library && STATE.library.length) await this._uploadJSON(this._libraryKey(), STATE.library);
      // 旧形式data_v5.json / 旧field/data.json は大きいデータ・個人情報混入リスクがあるため削除する。
      try {
        const sb = await this._client();
        if (sb) await sb.storage.from(this._bucket()).remove([this._legacyKey(), this._fieldKey()]);
      } catch(e) {}
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      await this._uploadJSON(this._fullStateKey(), this._makeFullState());
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
    finally { this._busy = false; }
  },
  async push() { return this.pushAll(); },
  _validWorkerMonthRecord(rec, meta={}) {
    if (!rec || typeof rec !== 'object' || !rec.ym) return false;
    const hasRows = Number(rec.rowCount || rec.lineRowCount || 0) > 0;
    const hasWorkers = rec.workers && typeof rec.workers === 'object' && Object.keys(rec.workers).length > 0;
    const metaRows = Number(meta.rowCount || meta.lineRowCount || 0);
    if (metaRows && !hasRows && !hasWorkers) return false;
    return hasRows || hasWorkers;
  },
  _validProductMonthRecord(rec, meta={}) {
    if (!rec || typeof rec !== 'object' || !rec.ym) return false;
    if (!Array.isArray(rec.tickets) || !rec.tickets.length) return false;
    const metaUnique = Number(meta.uniqueCount || 0);
    if (metaUnique && rec.tickets.length < Math.max(1, Math.floor(metaUnique * 0.5))) return false;
    return true;
  },
  async pullManifestAndMissing() {
    const manifest = await this._downloadJSON(this._manifestKey());
    if (!manifest) return { ok:false, error:'manifestなし' };
    if (manifest.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, manifest.deleted);
    let changed = 0;

    if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
    if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];

    // ── 並列ダウンロード: 必要なファイルを洗い出して一斉取得 ──
    const tasks = []; // { type, key, meta, promise }

    // datasets（月次収支）
    const datasetMetas = Array.isArray(manifest.datasets) ? manifest.datasets : [];
    for (const meta of datasetMetas) {
      if (!meta.ym) continue;
      const metaType = meta.type || 'confirmed';
      if (isDeletedSince('datasets', dataDeleteKey(meta.ym, metaType), meta.importedAt || meta.updatedAt || '')) continue;
      const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
      if (!local || String(meta.importedAt||'') > String(local.importedAt||'')) {
        tasks.push({ type:'dataset', meta, promise: this._downloadJSON(this._datasetKey(meta.ym, metaType)) });
      }
    }

    // workerCsvData（作業者）
    const workerMetas = Array.isArray(manifest.workerCsvData) ? manifest.workerCsvData : [];
    for (const meta of workerMetas) {
      if (!meta.ym || deletedAt('workerMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
      const local = STATE.workerCsvData.find(d => d.ym === meta.ym);
      if (!local || !this._validWorkerMonthRecord(local, meta) || String(meta.importedAt||'') > String(local.importedAt || local.updatedAt || local.savedAt || '')) {
        tasks.push({ type:'worker', meta, promise: this._downloadJSON(this._workerMonthKey(meta.ym)) });
      }
    }

    // productAddressData（商品住所）
    const productMetas = Array.isArray(manifest.productAddressData) ? manifest.productAddressData : [];
    for (const meta of productMetas) {
      if (!meta.ym || deletedAt('productMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
      const local = STATE.productAddressData.find(d => d.ym === meta.ym);
      if (!local || !this._validProductMonthRecord(local, meta) || String(meta.importedAt||'') > String(local.importedAt || local.updatedAt || local.savedAt || '')) {
        tasks.push({ type:'product', meta, promise: this._downloadJSON(this._productMonthKey(meta.ym)) });
      }
    }

    // capacity / planData / memos / library（単発ファイル）
    const singleTasks = {};
    if (manifest.hasCapacity && !STATE.capacity)
      singleTasks.capacity = this._downloadJSON(this._capacityKey());
    if (manifest.hasPlanData)
      singleTasks.plan    = this._downloadJSON(this._planKey());
    if (manifest.hasMemos)
      singleTasks.memos   = this._downloadJSON(this._memosKey());
    if (manifest.hasLibrary)
      singleTasks.library = this._downloadJSON(this._libraryKey());

    // ── 全ファイルを同時並列で待つ ──
    const allPromises = [
      ...tasks.map(t => t.promise),
      ...Object.values(singleTasks),
    ];
    const allResults = await Promise.allSettled(allPromises);

    // tasks の結果を適用
    const taskResults = allResults.slice(0, tasks.length);
    for (let i = 0; i < tasks.length; i++) {
      if (taskResults[i].status !== 'fulfilled') continue;
      const data = taskResults[i].value;
      const { type, meta } = tasks[i];
      if (type === 'dataset') {
        if (data && data.ym) { upsertDataset(data); changed++; }
      } else if (type === 'worker') {
        if (data && data.ym && this._validWorkerMonthRecord(data, meta)) {
          STATE.workerCsvData = STATE.workerCsvData.filter(d => d.ym !== data.ym);
          STATE.workerCsvData.push(data);
          changed++;
        }
      } else if (type === 'product') {
        if (data && data.ym && this._validProductMonthRecord(data, meta)) {
          STATE.productAddressData = STATE.productAddressData.filter(d => d.ym !== data.ym);
          STATE.productAddressData.push(data);
          changed++;
        }
      }
    }

    // 単発ファイルの結果を適用
    const singleKeys = Object.keys(singleTasks);
    const singleResults = allResults.slice(tasks.length);
    for (let i = 0; i < singleKeys.length; i++) {
      if (singleResults[i].status !== 'fulfilled') continue;
      const data = singleResults[i].value;
      const key  = singleKeys[i];
      if (key === 'capacity' && data) { STATE.capacity = data; changed++; }
      else if (key === 'plan' && data && typeof data === 'object') {
        STATE.planData = mergePlanDataByUpdatedAt(STATE.planData, data);
        applyDeletionTombstonesToState(STATE);
        changed++;
      }
      else if (key === 'memos' && data && typeof data === 'object') { STATE.memos = data; changed++; }
      else if (key === 'library' && Array.isArray(data)) { STATE.library = data; changed++; }
    }

    applyDeletionTombstonesToState(STATE);
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    if (changed) STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true, changed };
  },
  async pullLegacy() {
    const j = await this._downloadJSON(this._legacyKey());
    if (!j) return { ok:false, error:'旧形式データなし' };
    if (j.datasets)  STATE.datasets  = j.datasets;
    if (j.fieldData) STATE.fieldData = j.fieldData;
    if (j.capacity)  STATE.capacity  = j.capacity;
    if (j.planData)  STATE.planData  = normalizePlanData(j.planData);
    if (j.memos)     STATE.memos     = j.memos;
    if (j.library)   STATE.library   = j.library;
    if (j.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, j.deleted);
    applyDeletionTombstonesToState(STATE);
    STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true };
  },
  async pullFullState() {
    try {
      const full = await this._downloadJSON(this._fullStateKey());
      if (!full) return { ok:false, error:'full_stateなし' };
      const ok = this._applyFullState(full);
      if (!ok) return { ok:false, error:'full_state適用失敗' };
      UI.updateCloudBadge('ok');
      return { ok:true, changed:true, source:'full_state' };
    } catch(e) {
      return { ok:false, error:e.message };
    }
  },
  async pull() {
    try {
      let changed = false;
      let gotAny = false;

      // full_state と manifest を並列取得して合計待ち時間を短縮
      const [full, r] = await Promise.all([
        this.pullFullState(),
        this.pullManifestAndMissing(),
      ]);

      if (full && full.ok) { changed = true; gotAny = true; }
      if (r && r.ok) { changed = changed || !!r.changed; gotAny = true; }

      if (gotAny) {
        STORE.save();
        UI.updateCloudBadge('ok');
        return { ok:true, changed, source:'full_state+manifest' };
      }

      return await this.pullLegacy();
    }
    catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
  },
  async syncSmart() {
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      const cloudFull = await this._downloadJSON(this._fullStateKey());
      const localFull = this._makeFullState();

      // 先に full_state をマージ
      const mergedBase = cloudFull && typeof cloudFull === 'object'
        ? mergeFullState(localFull, cloudFull)
        : localFull;

      // 削除済みマーカーを先に統合し、削除を優先してから適用する
      mergedBase.deleted = mergeDeletedStates(localFull.deleted || {}, cloudFull?.deleted || {});
      applyDeletionTombstonesToState(mergedBase);
      this._applyFullState(mergedBase);
      this._busy = false;
      const manifestResult = await this.pullManifestAndMissing();
      this._busy = true;

      // manifest取得後の最新STATEを full_state として再保存
      const finalFull = this._makeFullState();
      await this._uploadJSON(this._fullStateKey(), finalFull);

      await this._uploadJSON(this._planKey(), STATE.planData || {});
      for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) await this._uploadJSON(this._workerMonthKey(w.ym), w);
      for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) await this._uploadJSON(this._productMonthKey(pr.ym), pr);
      if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
      try { const sb = await this._client(); if (sb) await sb.storage.from(this._bucket()).remove([this._legacyKey(), this._fieldKey()]); } catch(e) {}
      await this._uploadJSON(this._manifestKey(), this._makeManifest());

      UI.updateCloudBadge('ok');
      return { ok:true, changed:true, source:'smart+manifest', manifestChanged: !!(manifestResult && manifestResult.changed) };
    } catch(e) {
      UI.updateCloudBadge('error');
      return { ok:false, error:e.message };
    } finally {
      this._busy = false;
    }
  },
  async purgePersonalData() {
    // ローカル状態をサニタイズし、Supabase上のfull_state/field/data/manifestを安全データで上書きする。
    // 旧形式data_v5.jsonは削除する。
    try {
      sanitizePersonalDataState(STATE);
      STORE.save();
      const sb = await this._client();
      if (!sb) return { ok:false, error:'Supabase未設定' };
      for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) await this._uploadJSON(this._workerMonthKey(w.ym), w);
      for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) await this._uploadJSON(this._productMonthKey(pr.ym), pr);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      await this._uploadJSON(this._fullStateKey(), this._makeFullState());
      try { await sb.storage.from(this._bucket()).remove([this._legacyKey(), this._fieldKey()]); } catch(e) {}
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) {
      UI.updateCloudBadge('error');
      return { ok:false, error:e.message };
    }
  },

  async saveConfig() {
    const urlEl=document.getElementById('sb-url'), keyEl=document.getElementById('sb-key'), bucketEl=document.getElementById('sb-bucket'), msgEl=document.getElementById('cloud-test-msg');
    const url=urlEl?.value?.trim()||CONFIG.SUPABASE_URL;
    const key=keyEl?.value?.trim()||CONFIG.SUPABASE_KEY;
    const bucket=bucketEl?.value?.trim()||CONFIG.SUPABASE_BUCKET;
    const finalKey = key.includes('...') ? this._cfg().key : key;
    this._saveCfg(url, finalKey, bucket);
    if (msgEl) msgEl.textContent='接続テスト中...';
    const r=await this.pushAll();
    if (msgEl) msgEl.textContent = r.ok ? '✅ 接続OK・同期完了' : '❌ '+(r.error||'接続失敗');
    UI.toast(r.ok ? '☁ クラウド接続OK・同期しました' : 'エラー: '+(r.error||''), r.ok?'ok':'error');
  },
  async syncNow() {
    const msgEl=document.getElementById('cloud-test-msg');
    if (msgEl) msgEl.textContent='クラウドと双方向同期中...';
    UI.toast('クラウドと双方向同期中...');
    const r = await this.syncSmart();
    if (msgEl) msgEl.textContent = r.ok ? '✅ 双方向同期完了' : '❌ '+(r.error||'同期失敗');
    if (r.ok) {
      NAV.refresh();
      UI.updateTopbar(STATE.view || 'dashboard');
      UI.toast('クラウドと双方向同期しました');
    } else {
      UI.toast('同期失敗: '+(r.error||'不明'), 'error');
    }
  },
  renderForm() {
    const cfg=this._cfg();
    const urlEl=document.getElementById('sb-url'), keyEl=document.getElementById('sb-key'), bucketEl=document.getElementById('sb-bucket');
    if (urlEl) { urlEl.value=cfg.url||''; urlEl.readOnly=false; }
    if (keyEl) { keyEl.value=cfg.key ? cfg.key.slice(0,40)+'...' : ''; keyEl.readOnly=false; }
    if (bucketEl) { bucketEl.value=cfg.bucket||CONFIG.SUPABASE_BUCKET; }
    UI.updateCloudBadge(cfg.url && cfg.key ? 'configured' : 'none');
  }
};



/* ════════ §29-A AUTO SYNC（保存・更新時に自動クラウド同期） ════════
   運用方針：
   ・ページを開いた時は CLOUD.pull() でクラウド → ローカルを反映する
   ・CSV取込・削除・補完・計画更新などで STORE.save() が走ったら、自動でクラウドへ保存する
   ・自動保存では syncSmart（双方向同期）を使わない。保存のたびに pull すると重くなり、古いクラウド/ローカルとの再マージで復活事故が起きるため。
   ・自動保存は pushAll（ローカル → クラウド）のみ。削除済みマーカーも full_state/manifest に必ず入る。
*/
window.AUTO_SYNC = {
  _timer: null,
  _installed: false,
  _suppress: false,
  _running: false,
  _pending: false,
  _lastError: '',
  delayMs: 1800,

  install() {
    if (this._installed) return;
    // STORE.save() 全呼び出しで自動同期を予約すると、画面描画・設定保存・補正保存まで
    // full_state 同期対象になり重くなるため、同期予約はCSV取込・削除・計画保存・参考資料保存など
    // 明示的に CLOUD.pushXXX() / AUTO_SYNC.queue() を呼ぶ処理に限定する。
    this._installed = true;
  },

  queue(reason='auto') {
    if (this._suppress) return;
    if (typeof CLOUD === 'undefined' || !CLOUD || typeof CLOUD.pushAll !== 'function') return;

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(reason), this.delayMs);
  },

  async flush(reason='auto') {
    if (this._suppress) return { ok:false, error:'suppress中' };
    if (this._running) {
      this._pending = true;
      return { ok:false, error:'同期中のため再予約' };
    }
    if (typeof CLOUD === 'undefined' || !CLOUD || typeof CLOUD.pushAll !== 'function') return { ok:false, error:'CLOUD未設定' };

    this._running = true;
    this._pending = false;
    this._lastError = '';

    try {
      UI.updateCloudBadge && UI.updateCloudBadge('configured');
      const r = await CLOUD.pushAll();
      if (r && r.ok) {
        UI.updateSaveStatus && UI.updateSaveStatus();
        UI.updateCloudBadge && UI.updateCloudBadge('ok');
        return r;
      }
      this._lastError = r?.error || '自動同期失敗';
      UI.updateCloudBadge && UI.updateCloudBadge('error');
      return r || { ok:false, error:this._lastError };
    } catch(e) {
      this._lastError = e?.message || String(e);
      UI.updateCloudBadge && UI.updateCloudBadge('error');
      return { ok:false, error:this._lastError };
    } finally {
      this._running = false;
      if (this._pending && !this._suppress) {
        this._pending = false;
        this.queue('pending');
      }
    }
  },

  withoutSync(fn) {
    this._suppress = true;
    try {
      return fn();
    } finally {
      this._suppress = false;
    }
  },

  async withoutSyncAsync(fn) {
    this._suppress = true;
    try {
      return await fn();
    } finally {
      this._suppress = false;
    }
  }
};

