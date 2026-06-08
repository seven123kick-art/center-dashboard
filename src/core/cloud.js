/* ════════ §9 CLOUD（Supabase — 取込時のみ自動実行） ═══════════ */
var CLOUD = window.CLOUD = {
  _sb: null,
  _LSKEY: 'mgmt5_cloud_cfg',
  _busy: false,

  _cfg() {
    const def = { url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_KEY, bucket: CONFIG.SUPABASE_BUCKET };
    try {
      const s = localStorage.getItem(this._LSKEY);
      if (s) {
        const saved = JSON.parse(s);
        // プロジェクト移行後に古いURLがlocalStorageへ残ると、旧Supabaseへ接続してしまう。
        // center.html/config.local.js のURLを正とし、URLが違う保存済み設定は無視する。
        if (def.url && saved.url && saved.url !== def.url) return def;
        return { ...def, ...saved };
      }
    } catch(e) {}
    return def;
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
  _clientId() {
    try {
      let id = localStorage.getItem('mgmt5_client_id');
      if (!id) {
        id = 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        localStorage.setItem('mgmt5_client_id', id);
      }
      return id;
    } catch(e) {
      return 'client_' + Date.now();
    }
  },
  _dbStateKey(key) {
    return `storage:${String(key || '').replace(/^\/+/, '')}`;
  },
  _dbChunkKey(stateKey, idx) {
    return `${stateKey}::chunk::${String(idx).padStart(4,'0')}`;
  },
  async _dbUpsertState(stateKey, payload) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const row = {
      center_key: CENTER.id,
      state_key: stateKey,
      payload,
      client_id: this._clientId(),
      updated_at: new Date().toISOString()
    };
    const { error } = await sb
      .from('center_realtime_state')
      .upsert(row, { onConflict:'center_key,state_key' });
    if (error) throw error;
    return { ok:true };
  },
  async _dbGetState(stateKey) {
    const sb = await this._client();
    if (!sb) return null;
    const { data, error } = await sb
      .from('center_realtime_state')
      .select('payload,updated_at')
      .eq('center_key', CENTER.id)
      .eq('state_key', stateKey)
      .maybeSingle();
    if (error || !data) return null;
    return data.payload;
  },
  async _dbDeleteStates(stateKeys) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const keys = (Array.isArray(stateKeys) ? stateKeys : [stateKeys]).filter(Boolean);
    if (!keys.length) return { ok:true };
    const { error } = await sb
      .from('center_realtime_state')
      .delete()
      .eq('center_key', CENTER.id)
      .in('state_key', keys);
    if (error) return { ok:false, error:error.message };
    return { ok:true };
  },
  async _dbDeletePrefix(prefix) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const { error } = await sb
      .from('center_realtime_state')
      .delete()
      .eq('center_key', CENTER.id)
      .like('state_key', `${prefix}%`);
    if (error) return { ok:false, error:error.message };
    return { ok:true };
  },
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
    // 正本は Supabase DB(center_realtime_state)。Storage bucketは元ファイル/添付用途に限定する。
    // key は従来のStorageパスをそのまま state_key 化するため、既存呼び出し側は変更しない。
    value = sanitizedCloneForExport(value);
    const stateKey = this._dbStateKey(key);
    const json = JSON.stringify(value);

    // jsonb 1行へ巨大CSVを入れない。大きいものはDB上で分割保存する。
    // pointer行 + chunk行構成にすることで、商品住所CSVが増えてもlocalStorage/単一payloadの上限に依存しない。
    const chunkThreshold = 280 * 1024;
    if (json.length <= chunkThreshold) {
      // 以前に分割保存されていた可能性があるため、旧chunkを掃除してから本体を保存する。
      await this._dbDeletePrefix(this._dbChunkKey(stateKey, 0).replace(/0000$/, ''));
      await this._dbUpsertState(stateKey, value);
      return { ok:true, db:true, chunked:false };
    }

    const chunkSize = 240 * 1024;
    const chunks = [];
    for (let i=0; i<json.length; i += chunkSize) chunks.push(json.slice(i, i + chunkSize));

    await this._dbDeletePrefix(this._dbChunkKey(stateKey, 0).replace(/0000$/, ''));
    for (let i=0; i<chunks.length; i++) {
      await this._dbUpsertState(this._dbChunkKey(stateKey, i), { text: chunks[i] });
    }

    const pointer = {
      __db_chunked: true,
      version: 1,
      center: CENTER.id,
      key,
      stateKey,
      chunks: chunks.length,
      chunkSize,
      savedAt: new Date().toISOString(),
      bytes: json.length
    };
    await this._dbUpsertState(stateKey, pointer);
    return { ok:true, db:true, chunked:true, chunks:chunks.length };
  },
  async _downloadJSON(key) {
    const stateKey = this._dbStateKey(key);
    const first = await this._dbGetState(stateKey);
    if (!first) return null;

    if (first && first.__db_chunked && Number(first.chunks) > 0) {
      let joined = '';
      for (let i=0; i<Number(first.chunks); i++) {
        const part = await this._dbGetState(this._dbChunkKey(stateKey, i));
        if (!part || typeof part.text !== 'string') throw new Error(`分割データの取得に失敗しました: ${key} #${i+1}`);
        joined += part.text;
      }
      return JSON.parse(joined);
    }

    // 旧Storage分割ポインタがDBに入っていた場合の互換
    if (first && first.__chunked && Number(first.chunks) > 0) {
      let joined = '';
      for (let i=0; i<Number(first.chunks); i++) {
        const part = await this._dbGetState(this._dbChunkKey(stateKey, i));
        if (!part || typeof part.text !== 'string') throw new Error(`分割データの取得に失敗しました: ${key} #${i+1}`);
        joined += part.text;
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
    if (!key) return { ok:false, error:'キーなし' };

    // JSON系データはDB保存。state本体と分割chunkを削除する。
    const stateKey = this._dbStateKey(key);
    await this._dbDeletePrefix(this._dbChunkKey(stateKey, 0).replace(/0000$/, ''));
    const dbResult = await this._dbDeleteStates([stateKey]);

    // 添付ファイルなどStorageに置くものは従来通り削除も試す。失敗してもDB削除済ならOK扱い。
    try {
      const sb = await this._client();
      if (sb) await sb.storage.from(this._bucket()).remove([key]);
    } catch(e) {}
    return dbResult && dbResult.ok ? { ok:true } : dbResult;
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

    const datasetMetas = Array.isArray(manifest.datasets) ? manifest.datasets : [];
    for (const meta of datasetMetas) {
      if (!meta.ym) continue;
      const metaType = meta.type || 'confirmed';
      if (isDeletedSince('datasets', dataDeleteKey(meta.ym, metaType), meta.importedAt || meta.updatedAt || '')) continue;
      const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
      if (!local || String(meta.importedAt||'') > String(local.importedAt||'')) {
        const ds = await this._downloadJSON(this._datasetKey(meta.ym, metaType));
        if (ds && ds.ym) { upsertDataset(ds); changed++; }
      }
    }

    if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
    if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];

    const workerMetas = Array.isArray(manifest.workerCsvData) ? manifest.workerCsvData : [];
    for (const meta of workerMetas) {
      if (!meta.ym || deletedAt('workerMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
      const local = STATE.workerCsvData.find(d => d.ym === meta.ym);
      if (!local || !this._validWorkerMonthRecord(local, meta) || String(meta.importedAt||'') > String(local.importedAt || local.updatedAt || local.savedAt || '')) {
        const rec = await this._downloadJSON(this._workerMonthKey(meta.ym));
        if (rec && rec.ym && this._validWorkerMonthRecord(rec, meta)) {
          STATE.workerCsvData = STATE.workerCsvData.filter(d => d.ym !== rec.ym);
          STATE.workerCsvData.push(rec);
          changed++;
        }
      }
    }

    const productMetas = Array.isArray(manifest.productAddressData) ? manifest.productAddressData : [];
    for (const meta of productMetas) {
      if (!meta.ym || deletedAt('productMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
      const local = STATE.productAddressData.find(d => d.ym === meta.ym);
      if (!local || !this._validProductMonthRecord(local, meta) || String(meta.importedAt||'') > String(local.importedAt || local.updatedAt || local.savedAt || '')) {
        const rec = await this._downloadJSON(this._productMonthKey(meta.ym));
        if (rec && rec.ym && this._validProductMonthRecord(rec, meta)) {
          STATE.productAddressData = STATE.productAddressData.filter(d => d.ym !== rec.ym);
          STATE.productAddressData.push(rec);
          changed++;
        }
      }
    }

    if (manifest.hasCapacity && !STATE.capacity) {
      const cap = await this._downloadJSON(this._capacityKey());
      if (cap) { STATE.capacity = cap; changed++; }
    }

    // 旧field/data.jsonは大容量化・個人情報混入防止のため原則使わない。
    // 既存クラウドからの復元互換は full_state/manifest 側に寄せる。

    if (manifest.hasPlanData) {
      const cloudPlan = await this._downloadJSON(this._planKey());
      if (cloudPlan && typeof cloudPlan === 'object') {
        STATE.planData = mergePlanDataByUpdatedAt(STATE.planData, cloudPlan);
        applyDeletionTombstonesToState(STATE);
        changed++;
      }
    }

    if (manifest.hasMemos) {
      const memos = await this._downloadJSON(this._memosKey());
      if (memos && typeof memos === 'object') { STATE.memos = memos; changed++; }
    }

    if (manifest.hasLibrary) {
      const library = await this._downloadJSON(this._libraryKey());
      if (Array.isArray(library)) { STATE.library = library; changed++; }
    }

    applyDeletionTombstonesToState(STATE);
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    if (changed) STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true, changed };
  },
  async pullFieldDataForFiscalYear(fy) {
    // 現場分析用の遅延読込。
    // 起動時には作業者CSV・商品住所CSVを読まず、現場分析画面を開いた時だけ対象年度分を取得する。
    try {
      const fiscalYear = String(fy || STATE.fiscalYear || getDefaultFiscalYear());
      const months = (typeof monthsOfFiscalYear === 'function') ? monthsOfFiscalYear(fiscalYear) : [];
      const monthSet = new Set(months);
      const manifest = await this._downloadJSON(this._manifestKey());
      if (!manifest) return { ok:false, error:'manifestなし' };
      if (manifest.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, manifest.deleted);

      if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
      if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];

      let changed = 0;

      const workerMetas = (Array.isArray(manifest.workerCsvData) ? manifest.workerCsvData : [])
        .filter(meta => meta && meta.ym && monthSet.has(meta.ym));
      for (const meta of workerMetas) {
        if (deletedAt('workerMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
        const local = STATE.workerCsvData.find(d => d && d.ym === meta.ym);
        const localAt = String(local?.importedAt || local?.updatedAt || local?.savedAt || '');
        const cloudAt = String(meta.importedAt || meta.updatedAt || meta.savedAt || '');
        if (!local || !this._validWorkerMonthRecord(local, meta) || cloudAt > localAt) {
          const rec = await this._downloadJSON(this._workerMonthKey(meta.ym));
          if (rec && rec.ym && this._validWorkerMonthRecord(rec, meta)) {
            STATE.workerCsvData = STATE.workerCsvData.filter(d => d && d.ym !== rec.ym);
            STATE.workerCsvData.push(rec);
            changed++;
          }
        }
      }

      const productMetas = (Array.isArray(manifest.productAddressData) ? manifest.productAddressData : [])
        .filter(meta => meta && meta.ym && monthSet.has(meta.ym));
      for (const meta of productMetas) {
        if (deletedAt('productMonths', meta.ym) || deletedAt('fieldMonths', meta.ym)) continue;
        const local = STATE.productAddressData.find(d => d && d.ym === meta.ym);
        const localAt = String(local?.importedAt || local?.updatedAt || local?.savedAt || '');
        const cloudAt = String(meta.importedAt || meta.updatedAt || meta.savedAt || '');
        if (!local || !this._validProductMonthRecord(local, meta) || cloudAt > localAt) {
          const rec = await this._downloadJSON(this._productMonthKey(meta.ym));
          if (rec && rec.ym && this._validProductMonthRecord(rec, meta)) {
            STATE.productAddressData = STATE.productAddressData.filter(d => d && d.ym !== rec.ym);
            STATE.productAddressData.push(rec);
            changed++;
          }
        }
      }

      applyDeletionTombstonesToState(STATE);
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
      if (changed) STORE.save();
      UI.updateCloudBadge('ok');
      return { ok:true, changed, source:'field_lazy', fiscalYear, workerMonths:workerMetas.length, productMonths:productMetas.length };
    } catch(e) {
      UI.updateCloudBadge('error');
      return { ok:false, error:e.message };
    }
  },
  async pullLegacy() {
    // 旧DB一括保存(center_realtime_state/shared_bundle)からの復元互換。
    // 以前の構成ではStorageではなくこの1行に一部データが入っていたため、移行元として読む。
    let j = null;
    try {
      const shared = await this._dbGetState('shared_bundle');
      if (shared) j = shared.state || shared.bundle || shared.data || shared;
    } catch(e) {}
    if (!j) j = await this._downloadJSON(this._legacyKey());
    if (!j) return { ok:false, error:'旧形式データなし' };
    if (j.datasets)  STATE.datasets  = j.datasets;
    if (j.workerCsvData) STATE.workerCsvData = j.workerCsvData;
    if (j.productAddressData) STATE.productAddressData = j.productAddressData;
    if (j.fieldData) STATE.fieldData = j.fieldData;
    if (j.areaData) STATE.areaData = j.areaData;
    if (j.capacity)  STATE.capacity  = j.capacity;
    if (j.planData)  STATE.planData  = normalizePlanData(j.planData);
    if (j.memos)     STATE.memos     = j.memos;
    if (j.library)   STATE.library   = j.library;
    if (j.reportKnowledge) STATE.reportKnowledge = normalizeReportKnowledge(j.reportKnowledge);
    if (j.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, j.deleted);
    applyDeletionTombstonesToState(STATE);
    STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true, source:'legacy_shared_bundle' };
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
  async pullInitialForBoot(preferredView='dashboard') {
    // 起動専用の軽量読込。
    // 重要：full_state.json と現場明細・商品住所・資料は起動時に読まない。
    // ダッシュボードで必要な「選択年度の収支月別JSON + 計画 + キャパ」だけを取得する。
    try {
      let changed = 0;

      const manifest = await this._downloadJSON(this._manifestKey());
      if (!manifest) {
        // manifest が無い古い環境だけ互換取得へ逃がす。
        // 通常運用ではここに入らない。
        return await this.pullLegacy();
      }

      if (manifest.deleted) STATE.deleted = mergeDeletedStates(STATE.deleted, manifest.deleted);

      const metas = Array.isArray(manifest.datasets) ? manifest.datasets.filter(m => m && m.ym) : [];
      const localLatest = latestRealDS && latestRealDS();
      const sorted = metas.slice().sort((a,b) => String(a.ym).localeCompare(String(b.ym)));
      const latestYm = sorted.length ? sorted[sorted.length - 1].ym : (localLatest && localLatest.ym ? localLatest.ym : null);

      // 起動時に必要なのは「表示年度の12ヶ月」。
      // 最新月だけ読むと、月選択で他月が未登録扱いになり、年度推移も壊れて見える。
      const fySet = new Set();
      if (STATE.fiscalYear) fySet.add(String(STATE.fiscalYear));
      if (latestYm) fySet.add(String(fiscalYearFromYM(latestYm)));
      if (!fySet.size) fySet.add(String(getDefaultFiscalYear()));

      const targetYms = new Set();
      for (const fy of fySet) {
        if (typeof monthsOfFiscalYear === 'function') {
          monthsOfFiscalYear(fy).forEach(ym => targetYms.add(ym));
        }
      }

      const targetMetas = metas.filter(m => targetYms.has(m.ym));
      const jobs = targetMetas.map(async (meta) => {
        const metaType = meta.type || 'confirmed';
        if (isDeletedSince('datasets', dataDeleteKey(meta.ym, metaType), meta.importedAt || meta.updatedAt || '')) return 0;
        const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
        if (local && String(meta.importedAt||'') <= String(local.importedAt||'')) return 0;
        const ds = await this._downloadJSON(this._datasetKey(meta.ym, metaType));
        if (ds && ds.ym) { upsertDataset(ds); return 1; }
        return 0;
      });
      const results = await Promise.allSettled(jobs);
      for (const r of results) if (r.status === 'fulfilled') changed += Number(r.value || 0);

      if (manifest.hasPlanData) {
        const cloudPlan = await this._downloadJSON(this._planKey());
        if (cloudPlan && typeof cloudPlan === 'object') {
          STATE.planData = mergePlanDataByUpdatedAt(STATE.planData, cloudPlan);
          changed++;
        }
      }

      if (manifest.hasCapacity && !STATE.capacity) {
        const cap = await this._downloadJSON(this._capacityKey());
        if (cap) { STATE.capacity = cap; changed++; }
      }

      applyDeletionTombstonesToState(STATE);
      sanitizePersonalDataState(STATE);
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
      if (changed) STORE.save();
      UI.updateCloudBadge('ok');
      return { ok:true, changed:!!changed, source:'boot_fiscal_year_skdl_only' };
    } catch(e) {
      UI.updateCloudBadge('error');
      return { ok:false, error:e.message };
    }
  },
  async pull() {
    try {
      let changed = false;
      let gotAny = false;

      const full = await this.pullFullState();
      if (full && full.ok) {
        changed = true;
        gotAny = true;
      }

      // full_state が古い場合に備え、必ず manifest / skdl 月別データも確認する。
      // これにより、別PCで入れた確定CSVが full_state 未反映でも取得できる。
      const r = await this.pullManifestAndMissing();
      if (r && r.ok) {
        changed = changed || !!r.changed;
        gotAny = true;
      }

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
