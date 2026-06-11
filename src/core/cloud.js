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
        // center.html/config.local.js のURL・keyを正とし、不一致の保存済み設定は無視する。
        // （keyローテーション時に古いkeyがlocalStorageへ残り続ける事故を防ぐ）
        if (def.url && saved.url && saved.url !== def.url) return def;
        if (def.key && saved.key && saved.key !== def.key) return def;
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
  // 世代付きchunkキー。書込途中の中断でも旧世代を壊さないために使う。
  _dbChunkKeyGen(stateKey, gen, idx) {
    return `${stateKey}::chunk::${gen}::${String(idx).padStart(4,'0')}`;
  },
  // SQLのLIKEでは「_」は任意1文字、「%」はワイルドカード。
  // state_key には 202604_confirmed のように「_」が含まれるため、必ずエスケープしてから使う。
  _likeEscape(s) {
    return String(s || '').replace(/([\\%_])/g, '\\$1');
  },
  // 差分push用の軽量ハッシュ（FNV-1a + 長さ）。内容が前回pushと同じならアップロードを省略する。
  _hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ':' + s.length;
  },
  _pushedHashes: null,
  _hashLSKey() { return `mgmt5_${CENTER.id}_push_hashes`; },
  _loadPushedHashes() {
    if (this._pushedHashes) return this._pushedHashes;
    try { this._pushedHashes = JSON.parse(localStorage.getItem(this._hashLSKey()) || '{}') || {}; }
    catch(e) { this._pushedHashes = {}; }
    return this._pushedHashes;
  },
  _rememberPushed(stateKey, hash) {
    const m = this._loadPushedHashes();
    m[stateKey] = hash;
    try { localStorage.setItem(this._hashLSKey(), JSON.stringify(m)); } catch(e) {}
  },
  _forgetPushed(stateKey) {
    const m = this._loadPushedHashes();
    delete m[stateKey];
    try { localStorage.setItem(this._hashLSKey(), JSON.stringify(m)); } catch(e) {}
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

    // maybeSingle() は重複行やPostgREST側の状態によって読込全体を落とすことがある。
    // DBを正本にするため、同じ center_key/state_key が複数あっても最新1件を採用する。
    const { data, error } = await sb
      .from('center_realtime_state')
      .select('payload,updated_at')
      .eq('center_key', CENTER.id)
      .eq('state_key', stateKey)
      .order('updated_at', { ascending:false })
      .limit(1);

    if (error) throw error;
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (!row) return null;
    return row.payload;
  },
  async loadState(centerKey = CENTER.id) {
    // DevTools確認用。CLOUD.loadState('toda') / CLOUD.loadState('kitasaitama') でDB上の保存行を確認できる。
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定またはクライアント作成失敗' };
    const { data, error } = await sb
      .from('center_realtime_state')
      .select('center_key,state_key,updated_at,payload')
      .eq('center_key', centerKey)
      .order('updated_at', { ascending:false })
      .limit(50);
    if (error) return { ok:false, error:error.message, details:error };
    return { ok:true, centerKey, count:Array.isArray(data) ? data.length : 0, rows:data || [] };
  },
  async testDb(centerKey = CENTER.id) {
    // 画面の保存経路監査・DevTools用の軽量接続テスト。
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定またはクライアント作成失敗' };
    const { data, error } = await sb
      .from('center_realtime_state')
      .select('center_key,state_key,updated_at')
      .eq('center_key', centerKey)
      .order('updated_at', { ascending:false })
      .limit(20);
    if (error) return { ok:false, error:error.message, details:error };
    return { ok:true, centerKey, count:Array.isArray(data) ? data.length : 0, rows:data || [] };
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
      .like('state_key', `${this._likeEscape(prefix)}%`);
    if (error) return { ok:false, error:error.message };
    return { ok:true };
  },
  // 指定stateKeyのchunk行を削除する。keepGen を渡した場合、その世代のchunkだけ残す。
  // keepGen=null なら旧形式（世代なし）chunkも含めて全chunkを削除する。
  async _dbDeleteChunksExceptGen(stateKey, keepGen) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const prefix = `${stateKey}::chunk::`;
    let q = sb
      .from('center_realtime_state')
      .delete()
      .eq('center_key', CENTER.id)
      .like('state_key', `${this._likeEscape(prefix)}%`);
    if (keepGen) q = q.not('state_key', 'like', `${this._likeEscape(prefix + keepGen + '::')}%`);
    const { error } = await q;
    if (error) return { ok:false, error:error.message };
    return { ok:true };
  },
  async _dbListStates(prefix = '', options = {}) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const withPayload = !!options.withPayload;
    let q = sb
      .from('center_realtime_state')
      .select(withPayload ? 'state_key,updated_at,payload' : 'state_key,updated_at')
      .eq('center_key', CENTER.id)
      .order('state_key', { ascending:true })
      .limit(10000);
    if (prefix) q = q.like('state_key', `${this._likeEscape(prefix)}%`);
    const { data, error } = await q;
    if (error) return { ok:false, error:error.message, details:error };
    return { ok:true, rows:Array.isArray(data) ? data : [] };
  },
  _metaFromDbRows(rows = []) {
    const manifest = {
      version: 32,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      datasets: [],
      workerCsvData: [],
      productAddressData: [],
      hasPlanData: false,
      hasCapacity: false,
      hasMemos: false,
      hasLibrary: false,
      deleted: STATE.deleted || {}
    };
    const dsSeen = new Set();
    const workerSeen = new Set();
    const productSeen = new Set();
    rows.forEach(row => {
      const key = String(row?.state_key || '');
      const payload = row?.payload || {};
      const updatedAt = row?.updated_at || payload?.importedAt || payload?.savedAt || null;
      let m = key.match(new RegExp(`^storage:${CENTER.id}/skdl/(\\d{6})_(daily|confirmed)\\.json$`));
      if (m) {
        const id = `${m[1]}_${m[2]}`;
        if (!dsSeen.has(id)) {
          dsSeen.add(id);
          manifest.datasets.push({
            ym:m[1],
            type:m[2],
            source:payload.source || 'csv',
            importedAt:payload.importedAt || payload.updatedAt || payload.savedAt || updatedAt,
            totalIncome:payload.totalIncome || 0,
            totalExpense:payload.totalExpense || 0,
            profit:payload.profit || 0
          });
        }
        return;
      }
      m = key.match(new RegExp(`^storage:${CENTER.id}/field/worker/(\\d{6})\\.json$`));
      if (m && !workerSeen.has(m[1])) {
        workerSeen.add(m[1]);
        manifest.workerCsvData.push({
          ym:m[1],
          source:payload.source || 'worker_csv',
          importedAt:payload.importedAt || payload.updatedAt || payload.savedAt || updatedAt,
          rowCount:payload.rowCount || payload.lineRowCount || 0,
          workerCount:payload.workerCount || 0
        });
        return;
      }
      m = key.match(new RegExp(`^storage:${CENTER.id}/field/product/(\\d{6})\\.json$`));
      if (m && !productSeen.has(m[1])) {
        productSeen.add(m[1]);
        manifest.productAddressData.push({
          ym:m[1],
          source:payload.source || 'product_address_csv',
          importedAt:payload.importedAt || payload.updatedAt || payload.savedAt || updatedAt,
          uniqueCount:payload.uniqueCount || (Array.isArray(payload.tickets) ? payload.tickets.length : 0),
          detailRows:payload.detailRows || 0,
          rawRows:payload.rawRows || 0,
          amount:payload.amount || 0
        });
        return;
      }
      if (key === this._dbStateKey(this._planKey())) manifest.hasPlanData = true;
      if (key === this._dbStateKey(this._capacityKey())) manifest.hasCapacity = true;
      if (key === this._dbStateKey(this._memosKey())) manifest.hasMemos = true;
      if (key === this._dbStateKey(this._libraryKey())) manifest.hasLibrary = true;
    });
    manifest.datasets.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.type).localeCompare(String(b.type)));
    manifest.workerCsvData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    manifest.productAddressData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    return manifest;
  },
  async _loadManifestOrBuildFromDb() {
    // manifestは補助台帳。ここが500/破損/重複で読めなくても、
    // center_realtime_state の月別キーから台帳を再構成して起動を継続する。
    let manifest = null;
    try {
      manifest = await this._downloadJSON(this._manifestKey());
    } catch(e) {
      console.warn('[CLOUD] manifest read skipped:', e?.message || e);
      manifest = null;
    }

    // manifestだけに頼らず、DB本体の月別キーから台帳を再構成する。
    // 商品住所CSVは分割chunkが多くなりやすく、全prefix取得ではskdl行が漏れることがあるため、
    // 種類別prefixを個別に確認する。
    const prefixes = [
      `storage:${CENTER.id}/skdl/`,
      `storage:${CENTER.id}/field/worker/`,
      `storage:${CENTER.id}/field/product/`,
      `storage:${CENTER.id}/plan/`,
      `storage:${CENTER.id}/capacity/`,
      `storage:${CENTER.id}/memos/`,
      `storage:${CENTER.id}/library/`
    ];

    const rows = [];
    let listFailures = 0;
    for (const prefix of prefixes) {
      try {
        // 起動・センター切替時は payload を読まない。
        // 商品住所CSVの分割chunkが多い状態で payload まで一覧取得すると、PostgRESTが500を返すことがある。
        // ここでは state_key/updated_at だけで台帳を再構成し、実データは必要な月だけ _downloadJSON で取得する。
        const listed = await this._dbListStates(prefix, { withPayload:false });
        if (listed && listed.ok && Array.isArray(listed.rows)) {
          rows.push(...listed.rows);
        } else {
          listFailures++;
          console.warn('[CLOUD] state一覧取得失敗:', prefix, listed?.error || '不明');
        }
      } catch(e) {
        listFailures++;
        console.warn('[CLOUD] state一覧取得例外:', prefix, e?.message || e);
      }
    }

    // 一覧取得が全滅し、保存済みmanifestも無い場合は「データなし」と誤判定しない。
    // null を返して上位（pullInitialForBoot等）の通信異常系へ流す。
    if (listFailures >= prefixes.length && !rows.length && !manifest) {
      console.warn('[CLOUD] 台帳再構成不可（全prefix取得失敗）。クラウド接続を確認してください。');
      return null;
    }

    if (rows.length) {
      const derived = this._metaFromDbRows(rows);
      if (!manifest || typeof manifest !== 'object') manifest = derived;
      else {
        const mergeBy = (a = [], b = [], keyFn) => {
          const map = new Map();
          a.forEach(x => { if (x) map.set(keyFn(x), x); });
          b.forEach(x => { if (x) map.set(keyFn(x), { ...(map.get(keyFn(x)) || {}), ...x }); });
          return [...map.values()];
        };
        manifest.datasets = mergeBy(manifest.datasets || [], derived.datasets || [], x => `${x.ym}_${x.type || 'confirmed'}`);
        manifest.workerCsvData = mergeBy(manifest.workerCsvData || [], derived.workerCsvData || [], x => x.ym);
        manifest.productAddressData = mergeBy(manifest.productAddressData || [], derived.productAddressData || [], x => x.ym);
        manifest.hasPlanData = !!(manifest.hasPlanData || derived.hasPlanData);
        manifest.hasCapacity = !!(manifest.hasCapacity || derived.hasCapacity);
        manifest.hasMemos = !!(manifest.hasMemos || derived.hasMemos);
        manifest.hasLibrary = !!(manifest.hasLibrary || derived.hasLibrary);
        manifest.deleted = mergeDeletedStates(manifest.deleted || {}, derived.deleted || {});
      }
      // 起動・読込時にはmanifestを書き戻さない。保存時のpushAll/pushMonthで更新する。
    }
    return manifest;
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
      version: 33,
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
  _cacheKindForKey(key) {
    const k = String(key || '');
    const ds = k.match(new RegExp(`^${CENTER.id}/skdl/(\\d{6})_([^/]+)\\.json$`));
    if (ds) return { kind:'dataset', id:`${ds[1]}_${ds[2] || 'confirmed'}` };
    const worker = k.match(new RegExp(`^${CENTER.id}/field/worker/(\\d{6})\\.json$`));
    if (worker) return { kind:'worker', id:worker[1] };
    const product = k.match(new RegExp(`^${CENTER.id}/field/product/(\\d{6})\\.json$`));
    if (product) return { kind:'product', id:product[1] };
    return null;
  },
  async _uploadBlob(key, blob, contentType='application/octet-stream') {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const { error } = await sb.storage.from(this._bucket()).upload(key, blob, { upsert:true, contentType });
    if (error) throw error;
    return { ok:true };
  },
  async _uploadJSON(key, value, options = {}) {
    // 正本は Supabase DB(center_realtime_state)。Storage bucketは元ファイル/添付用途に限定する。
    // key は従来のStorageパスをそのまま state_key 化するため、既存呼び出し側は変更しない。
    value = sanitizedCloneForExport(value);
    const stateKey = this._dbStateKey(key);
    const json = JSON.stringify(value);
    const hash = this._hashStr(json);

    // 差分push：前回push成功時と内容が同じならアップロードしない。
    // 自動同期(pushAll onlyChanged)で全データ再アップロードが走るのを防ぎ、
    // 書込中の隙間に他PCが読込んで壊れる確率と通信量を大幅に下げる。
    if (options.skipIfUnchanged && this._loadPushedHashes()[stateKey] === hash) {
      return { ok:true, db:true, skipped:true };
    }

    // jsonb 1行へ巨大CSVを入れない。大きいものはDB上で分割保存する。
    const chunkThreshold = 280 * 1024;
    if (json.length <= chunkThreshold) {
      // 重要：先に本体行を確定させてから旧chunkを掃除する。
      // （旧実装は「削除→書込」の順で、途中失敗時にpointerが宙に浮きデータ消失に見えた）
      await this._dbUpsertState(stateKey, value);
      try { await this._dbDeleteChunksExceptGen(stateKey, null); } catch(e) {
        console.warn('[CLOUD] 旧chunk掃除失敗（本体保存は完了済み）:', key, e?.message || e);
      }
      this._rememberPushed(stateKey, hash);
      return { ok:true, db:true, chunked:false };
    }

    // ════ アトミックな世代切替方式 ════
    // 1. 新しい世代IDでchunkを全て書き込む（既存pointer・旧世代chunkには触れない）
    // 2. 全chunk書込成功後に、pointerを新世代へ一括切替（この1回のupsertが切替点）
    // 3. 最後に旧世代chunkを掃除（ここで失敗してもデータは壊れない）
    // 途中で失敗・中断しても、pointerは常に「完全な世代」を指し続ける。
    const chunkSize = 240 * 1024;
    const chunks = [];
    for (let i=0; i<json.length; i += chunkSize) chunks.push(json.slice(i, i + chunkSize));

    const gen = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    for (let i=0; i<chunks.length; i++) {
      await this._dbUpsertState(this._dbChunkKeyGen(stateKey, gen, i), { text: chunks[i] });
    }

    const pointer = {
      __db_chunked: true,
      version: 2,
      gen,
      center: CENTER.id,
      key,
      stateKey,
      chunks: chunks.length,
      chunkSize,
      savedAt: new Date().toISOString(),
      bytes: json.length
    };
    await this._dbUpsertState(stateKey, pointer);

    try { await this._dbDeleteChunksExceptGen(stateKey, gen); } catch(e) {
      console.warn('[CLOUD] 旧世代chunk掃除失敗（保存自体は完了済み）:', key, e?.message || e);
    }
    this._rememberPushed(stateKey, hash);
    return { ok:true, db:true, chunked:true, chunks:chunks.length, gen };
  },
  async _downloadJSON(key) {
    const cacheKind = this._cacheKindForKey ? this._cacheKindForKey(key) : null;
    const cacheFallback = cacheKind && window.IDB_CACHE ? await IDB_CACHE.get(cacheKind.kind, cacheKind.id) : null;

    const stateKey = this._dbStateKey(key);
    const first = await this._dbGetState(stateKey);
    if (!first) return cacheFallback || null;

    let value = first;
    if (first && first.__db_chunked && Number(first.chunks) > 0) {
      // version:2（世代付き）と version:1（世代なし）の両対応
      const useGen = !!first.gen;
      let joined = '';
      for (let i=0; i<Number(first.chunks); i++) {
        const ck = useGen ? this._dbChunkKeyGen(stateKey, first.gen, i) : this._dbChunkKey(stateKey, i);
        const part = await this._dbGetState(ck);
        if (!part || typeof part.text !== 'string') {
          if (cacheFallback) return cacheFallback;
          throw new Error(`分割データの取得に失敗しました: ${key} #${i+1}`);
        }
        joined += part.text;
      }
      value = JSON.parse(joined);
    }

    // 旧Storage分割ポインタがDBに入っていた場合の互換
    if (value && value.__chunked && Number(value.chunks) > 0) {
      let joined = '';
      for (let i=0; i<Number(value.chunks); i++) {
        const part = await this._dbGetState(this._dbChunkKey(stateKey, i));
        if (!part || typeof part.text !== 'string') {
          if (cacheFallback) return cacheFallback;
          throw new Error(`分割データの取得に失敗しました: ${key} #${i+1}`);
        }
        joined += part.text;
      }
      value = JSON.parse(joined);
    }

    if (cacheKind && window.IDB_CACHE && value) IDB_CACHE.set(cacheKind.kind, cacheKind.id, value);
    return value;
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

    // JSON系データはDB保存。state本体と分割chunk（世代付き含む）を削除する。
    const stateKey = this._dbStateKey(key);
    try { await this._dbDeleteChunksExceptGen(stateKey, null); } catch(e) {}
    const dbResult = await this._dbDeleteStates([stateKey]);
    this._forgetPushed(stateKey);

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
  async pushAll(options = {}) {
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    // onlyChanged:true（自動同期用）の場合、前回pushから内容が変わったキーだけアップロードする。
    // 手動の「全同期」ボタン等からは options なしで呼ばれ、従来通り全件アップロードする。
    const onlyChanged = !!options.onlyChanged;
    const up = (key, value) => this._uploadJSON(key, value, { skipIfUnchanged: onlyChanged });
    try {
      for (const ds of STATE.datasets.filter(d => d.source !== 'history')) await up(this._datasetKey(ds.ym, ds.type || 'confirmed'), ds);
      for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) await up(this._workerMonthKey(w.ym), w);
      for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) await up(this._productMonthKey(pr.ym), pr);
      if (STATE.capacity) await up(this._capacityKey(), STATE.capacity);
      await up(this._planKey(), STATE.planData || {});
      if (STATE.memos && Object.keys(STATE.memos).length) await up(this._memosKey(), STATE.memos);
      if (STATE.library && STATE.library.length) await up(this._libraryKey(), STATE.library);
      // 旧形式data_v5.json / 旧field/data.json は大きいデータ・個人情報混入リスクがあるため削除する。
      // （自動同期では毎回走らせず、手動全同期時のみ）
      if (!onlyChanged) {
        try {
          const sb = await this._client();
          if (sb) await sb.storage.from(this._bucket()).remove([this._legacyKey(), this._fieldKey()]);
        } catch(e) {}
      }
      // manifest / full_state は軽量かつ savedAt を含むため、常にアップロードする。
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
    const manifest = await this._loadManifestOrBuildFromDb();
    if (!manifest) return { ok:false, error:'manifestなし' };
    // manifest.deleted は古い削除フラグ汚染の原因になるためマージしない。
    let changed = 0;

    const datasetMetas = Array.isArray(manifest.datasets) ? manifest.datasets : [];
    for (const meta of datasetMetas) {
      if (!meta.ym) continue;
      const metaType = meta.type || 'confirmed';
      const delKey = dataDeleteKey(meta.ym, metaType);
      if (isDeletedSince('datasets', delKey, meta.importedAt || meta.updatedAt || '')) {
        if (typeof clearDataDeleted === 'function') clearDataDeleted('datasets', delKey);
      }
      if (isDeletedSince('datasets', delKey, meta.importedAt || meta.updatedAt || '')) continue;
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
    const perfStart = performance.now();
    // 現場分析用の遅延読込。
    // 起動時には作業者CSV・商品住所CSVを読まず、現場分析画面を開いた時だけ対象年度分を取得する。
    try {
      const fiscalYear = String(fy || STATE.fiscalYear || getDefaultFiscalYear());
      const months = (typeof monthsOfFiscalYear === 'function') ? monthsOfFiscalYear(fiscalYear) : [];
      const monthSet = new Set(months);
      const manifest = await this._loadManifestOrBuildFromDb();
      if (!manifest) return { ok:false, error:'manifestなし' };
      // manifest.deleted は古い削除フラグ汚染の原因になるためマージしない。

      if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
      if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];

      let changed = 0;
      let workerDownloaded = 0;
      let productDownloaded = 0;

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
            workerDownloaded++;
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
            productDownloaded++;
          }
        }
      }

      applyDeletionTombstonesToState(STATE);
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
      if (changed) STORE.save();
      UI.updateCloudBadge('ok');
      console.log(`[PERF] field-cloud:${fiscalYear}:done ms=${Math.round(performance.now()-perfStart)} workerMonths=${workerMetas.length} productMonths=${productMetas.length} workerDownloaded=${workerDownloaded} productDownloaded=${productDownloaded} changed=${changed}`);
      return { ok:true, changed, source:'field_lazy', fiscalYear, workerMonths:workerMetas.length, productMonths:productMetas.length, workerDownloaded, productDownloaded };
    } catch(e) {
      UI.updateCloudBadge('error');
      console.log(`[PERF] field-cloud:${fy || STATE.fiscalYear || ''}:error ms=${Math.round(performance.now()-perfStart)} error=${e?.message || e}`);
      return { ok:false, error:e.message };
    }
  },
  _extractLegacyBundle(shared) {
    if (!shared || typeof shared !== 'object') return null;
    const candidates = [shared.state, shared.bundle, shared.data, shared.payload, shared];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      if (Array.isArray(c.datasets) || Array.isArray(c.workerCsvData) || Array.isArray(c.productAddressData) || c.planData || c.capacity) return c;
    }
    return null;
  },
  _applyLegacyBundle(j) {
    if (!j || typeof j !== 'object') return false;
    let applied = false;
    if (Array.isArray(j.datasets)) { STATE.datasets = j.datasets; applied = true; }
    if (Array.isArray(j.workerCsvData)) { STATE.workerCsvData = j.workerCsvData; applied = true; }
    if (Array.isArray(j.productAddressData)) { STATE.productAddressData = j.productAddressData; applied = true; }
    if (Array.isArray(j.fieldData)) { STATE.fieldData = j.fieldData; applied = true; }
    if (Array.isArray(j.areaData)) { STATE.areaData = j.areaData; applied = true; }
    if ('capacity' in j) { STATE.capacity = j.capacity || null; applied = true; }
    if (j.planData) { STATE.planData = normalizePlanData(j.planData); applied = true; }
    if (j.memos && typeof j.memos === 'object') { STATE.memos = j.memos; applied = true; }
    if (Array.isArray(j.library)) { STATE.library = j.library; applied = true; }
    if (j.reportKnowledge) { STATE.reportKnowledge = normalizeReportKnowledge(j.reportKnowledge); applied = true; }
    if (j.deleted) { STATE.deleted = mergeDeletedStates(STATE.deleted, j.deleted); applied = true; }
    applyDeletionTombstonesToState(STATE);
    sanitizePersonalDataState(STATE);
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    return applied;
  },
  async migrateLegacySharedBundle() {
    // 旧DB一括保存(center_realtime_state/shared_bundle)を、現在の月別・種類別キーへ展開する。
    // Storageは使わず、center_realtime_state の state_key=storage:... 形式へ保存する。
    const shared = await this._dbGetState('shared_bundle');
    const j = this._extractLegacyBundle(shared);
    if (!j) return { ok:false, error:'shared_bundleに移行可能なデータがありません' };

    this._applyLegacyBundle(j);

    let datasets = 0, workers = 0, products = 0;
    for (const ds of (STATE.datasets || []).filter(d => d && d.ym && d.source !== 'history')) {
      await this._uploadJSON(this._datasetKey(ds.ym, ds.type || 'confirmed'), ds);
      datasets++;
    }
    for (const w of (STATE.workerCsvData || []).filter(d => d && d.ym)) {
      await this._uploadJSON(this._workerMonthKey(w.ym), w);
      workers++;
    }
    for (const pr of (STATE.productAddressData || []).filter(d => d && d.ym)) {
      await this._uploadJSON(this._productMonthKey(pr.ym), pr);
      products++;
    }
    if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
    if (STATE.planData && Object.keys(STATE.planData).length) await this._uploadJSON(this._planKey(), STATE.planData);
    if (STATE.memos && Object.keys(STATE.memos).length) await this._uploadJSON(this._memosKey(), STATE.memos);
    if (STATE.library && STATE.library.length) await this._uploadJSON(this._libraryKey(), STATE.library);
    await this._uploadJSON(this._manifestKey(), this._makeManifest());
    await this._uploadJSON(this._fullStateKey(), this._makeFullState());
    STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true, migrated:true, source:'legacy_shared_bundle_migrated', datasets, workers, products };
  },
  async pullLegacy(options={}) {
    // 旧DB一括保存(center_realtime_state/shared_bundle)からの復元互換。
    // manifest が無い古い環境では、ここから復元し、必要に応じて新形式へ自動移行する。
    const migrate = options.migrate !== false;
    let j = null;
    try {
      const shared = await this._dbGetState('shared_bundle');
      j = this._extractLegacyBundle(shared);
    } catch(e) {}
    if (!j) j = await this._downloadJSON(this._legacyKey());
    if (!j) return { ok:false, error:'旧形式データなし' };

    const applied = this._applyLegacyBundle(j);
    if (!applied) return { ok:false, error:'旧形式データに適用可能な内容がありません' };

    STORE.save();

    let migrated = false;
    let migrationError = null;
    if (migrate) {
      try {
        const r = await this.migrateLegacySharedBundle();
        migrated = !!(r && r.ok);
        migrationError = r && !r.ok ? r.error : null;
      } catch(e) {
        migrationError = e.message;
      }
    }

    UI.updateCloudBadge('ok');
    return { ok:true, changed:true, source:'legacy_shared_bundle', migrated, migrationError };
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

      const manifest = await this._loadManifestOrBuildFromDb();
      if (!manifest) {
        // 新形式DB行もmanifestも無い場合のみ旧形式へ逃がす。
        const legacy = await this.pullLegacy();
        if (legacy && legacy.ok) return legacy;
        UI.updateCloudBadge('ok');
        return { ok:true, changed:false, source:'no_cloud_data', noData:true, note:legacy?.error || 'クラウドに対象センターのデータがありません' };
      }

      // manifest.deleted は古い削除フラグ汚染の原因になるためマージしない。

      const metas = Array.isArray(manifest.datasets) ? manifest.datasets.filter(m => m && m.ym) : [];
      const localLatest = latestRealDS && latestRealDS();
      const sorted = metas.slice().sort((a,b) => String(a.ym).localeCompare(String(b.ym)));
      const latestYm = sorted.length ? sorted[sorted.length - 1].ym : (localLatest && localLatest.ym ? localLatest.ym : null);

      // 起動時に必要なのは「DBに存在する全データの年度」。
      // latestYm のみで fySet を作ると、latestYm が翌年度（例:202604=FY2026）の場合に
      // 前年度（FY2025）のデータが targetYms から除外される。
      // DB上の全ymから fiscalYear を列挙して網羅する。
      const fySet = new Set();
      if (STATE.fiscalYear) fySet.add(String(STATE.fiscalYear));
      for (const m of metas) {
        if (m.ym && typeof fiscalYearFromYM === 'function') fySet.add(String(fiscalYearFromYM(m.ym)));
      }
      if (!fySet.size) fySet.add(String(getDefaultFiscalYear()));

      const targetYms = new Set();
      for (const fy of fySet) {
        if (typeof monthsOfFiscalYear === 'function') {
          monthsOfFiscalYear(fy).forEach(ym => targetYms.add(ym));
        }
      }

      const targetMetas = metas.filter(m => targetYms.has(m.ym));

      // DB上に実データがある月は、古い削除フラグを自動クリアする。
      for (const meta of targetMetas) {
        const metaType = meta.type || 'confirmed';
        const delKey = dataDeleteKey(meta.ym, metaType);
        if (isDeletedSince('datasets', delKey, meta.importedAt || meta.updatedAt || '')) {
          if (typeof clearDataDeleted === 'function') clearDataDeleted('datasets', delKey);
        }
      }

      // 並列実行（Promise.allSettled）は廃止。
      // 1ヶ月分のデータが複数chunkに分割されているため、年度分を並列取得すると
      // Supabase側で一部リクエストが落ち、STATE.datasetsへ戻らないことがある。
      // 直列実行にして、1ヶ月ずつ確実に復元する。
      for (const meta of targetMetas) {
        try {
          const metaType = meta.type || 'confirmed';
          if (isDeletedSince('datasets', dataDeleteKey(meta.ym, metaType), meta.importedAt || meta.updatedAt || '')) continue;
          const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
          if (local && String(meta.importedAt||'') <= String(local.importedAt||'')) continue;
          const ds = await this._downloadJSON(this._datasetKey(meta.ym, metaType));
          if (ds && ds.ym) { upsertDataset(ds); changed++; }
        } catch(e) {
          console.warn('[pullInitialForBoot] 月別データ取得失敗:', meta.ym, e?.message || e);
        }
      }

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
      console.log(`[PERF] field-cloud:${fy || STATE.fiscalYear || ''}:error ms=${Math.round(performance.now()-perfStart)} error=${e?.message || e}`);
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

      const legacy = await this.pullLegacy();
      if (legacy && legacy.ok) return legacy;
      UI.updateCloudBadge('ok');
      return { ok:true, changed:false, source:'no_cloud_data', noData:true, note:legacy?.error || 'クラウドに対象センターのデータがありません' };
    }
    catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
  },
  async syncSmart() {
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    // 旧実装は途中で _busy を一時解除しており、その隙間に AUTO_SYNC.flush が
    // 割り込んで pushAll と交差する再入の穴があった。
    // _busy は最後まで保持し、処理中の STORE.save による自動同期予約は suppress する。
    const run = async () => {
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
      const manifestResult = await this.pullManifestAndMissing();

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
    };
    try {
      if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC && AUTO_SYNC.withoutSyncAsync) {
        return await AUTO_SYNC.withoutSyncAsync(run);
      }
      return await run();
    } catch(e) {
      UI.updateCloudBadge('error');
      console.log(`[PERF] field-cloud:${fy || STATE.fiscalYear || ''}:error ms=${Math.round(performance.now()-perfStart)} error=${e?.message || e}`);
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
      console.log(`[PERF] field-cloud:${fy || STATE.fiscalYear || ''}:error ms=${Math.round(performance.now()-perfStart)} error=${e?.message || e}`);
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
