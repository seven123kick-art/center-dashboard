/* ════════════════════════════════════════════════════════════════
   経営管理システム  app.js  v5.0  — Clean Rewrite
   設計方針:
   ・センターはURL固定（URLパラメータ ?c=xxx）、画面内で切替しない
   ・画面切替 = DOM表示切替のみ（同期・再取得しない）
   ・クラウド同期 = 取込ボタン押下時のみ（起動・画面切替では同期しない）
   ・初回表示 = ローカル読込→ダッシュボード描画（setTimeout不使用）
   ・データなし時 = アラートなし（空状態表示のみ）
   ・再描画 = 現在表示中の画面のみ（他画面に影響しない）
════════════════════════════════════════════════════════════════ */
'use strict';


/* ════════ ASSET LOADER（重い外部ライブラリは必要時だけ読む） ════════ */
const ASSETS = {
  _promises: {},
  loadScript(key, src){
    if (this._promises[key]) return this._promises[key];
    if ((key === 'supabase' && window.supabase) || (key === 'xlsx' && window.XLSX)) return Promise.resolve(true);
    this._promises[key] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve(true);
      el.onerror = () => reject(new Error(key + ' の読み込みに失敗しました'));
      document.head.appendChild(el);
    });
    return this._promises[key];
  },
  async supabase(){
    await this.loadScript('supabase', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    return !!window.supabase;
  },
  async xlsx(){
    await this.loadScript('xlsx', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    return !!window.XLSX;
  }
};

/* ════════ §1 CONFIG ════════════════════════════════════════════ */
const CONFIG = {
  SUPABASE_URL:    'https://udjibwlgscdkoheceyds.supabase.co',
  SUPABASE_KEY:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkamlid2xnc2Nka29oZWNleWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NTQ5NjksImV4cCI6MjA5MjQzMDk2OX0.4whX8OuFFvjXYrfsJMIthMlPM7oxzbrqychlMu81G7w',
  SUPABASE_BUCKET: 'center-data',

  CENTERS: [
    { id: 'kitasaitama', name: '北埼玉センター', color: '#1a4d7c' },
    { id: 'toda',        name: '戸田センター',   color: '#1a7a52' },
  ],
  COMPANY: 'エスラインギフ　家電物流事業部',
  FISCAL_START: 4,

  INCOME_KEYS: [
    '家電収入','委託収入','その他収入','一般収入',
    'コンピュータ収入','保管料収入','保険手数料','特積収入',
  ],
  INCOME_SUB_KEYS: ['集荷収入','配達収入','リサイクル収入'],
  EXPENSE_KEYS: [
    '給与手当','人材派遣料','その他人件費','旅費',
    'ガソリン費','軽油費',
    '車両修繕費','タイヤ費','その他修繕費',
    '車両償却費','その他償却費',
    '自賠責保険料','任意保険料','運送保険料','その他保険料',
    '借地借家料','その他施設費',
    '重量税','自動車税','取得税','その他税',
    '集配傭車','路線備車','路線傭車','委託費','社内外注費',
    '道路利用料','その他利用料',
    '水道光熱費','備消品費','図書印刷費','通信運搬費','電算関連費',
    '被服費','交際費','負担金','教育求人費','雑費','環境衛生費','経営指導料',
  ],
  FIXED_KEYS: [
    '給与手当','人材派遣料','その他人件費',
    '借地借家料','その他施設費',
    '車両償却費','その他償却費',
    '自賠責保険料','任意保険料','運送保険料','その他保険料',
    '重量税','自動車税','取得税','その他税',
    '水道光熱費','電算関連費','経営指導料','図書印刷費','通信運搬費',
  ],
  VARIABLE_KEYS: [
    '集配傭車','路線備車','路線傭車','委託費','社内外注費',
    'ガソリン費','軽油費',
    '車両修繕費','タイヤ費','その他修繕費',
    '道路利用料','その他利用料',
    '備消品費','旅費','被服費','環境衛生費','交際費','負担金','教育求人費','雑費',
  ],
  LABOR_KEYS:  ['給与手当','人材派遣料','その他人件費'],
  YOSHA_KEYS:  ['集配傭車','路線備車','路線傭車'],

  PL_DEF: [
    {t:'h',  l:'■ 営業収益の部'},
    {t:'i',  l:'一般収入',        k:['一般収入']},
    {t:'i',  l:'家電収入',        k:['家電収入'],
      sub:[{l:'集荷収入',k:'集荷収入'},{l:'配達収入',k:'配達収入'},{l:'リサイクル収入',k:'リサイクル収入'}]},
    {t:'i',  l:'委託収入',        k:['委託収入']},
    {t:'i',  l:'その他収入',      k:['その他収入']},
    {t:'i',  l:'保管料収入',      k:['保管料収入']},
    {t:'i',  l:'コンピュータ収入',k:['コンピュータ収入']},
    {t:'st', l:'▶ 営業収益計',   k:'inc'},
    {t:'h',  l:'■ 費用の部'},
    {t:'g',  l:'人件費計',        k:['給与手当','人材派遣料','その他人件費','旅費'],
      s:[{l:'給与手当',k:['給与手当']},{l:'人材派遣料',k:['人材派遣料']},{l:'その他人件費',k:['その他人件費']},{l:'旅費',k:['旅費']}]},
    {t:'g',  l:'燃料費計',        k:['ガソリン費','軽油費'],
      s:[{l:'軽油費',k:['軽油費']},{l:'ガソリン費',k:['ガソリン費']}]},
    {t:'g',  l:'修繕費計',        k:['車両修繕費','タイヤ費','その他修繕費'],
      s:[{l:'車両修繕費',k:['車両修繕費']},{l:'タイヤ費',k:['タイヤ費']}]},
    {t:'g',  l:'償却費計',        k:['車両償却費','その他償却費'],
      s:[{l:'車両償却費',k:['車両償却費']}]},
    {t:'g',  l:'保険料計',        k:['自賠責保険料','任意保険料','運送保険料','その他保険料'],
      s:[{l:'任意保険料',k:['任意保険料']}]},
    {t:'g',  l:'施設費計',        k:['借地借家料','その他施設費'],
      s:[{l:'借地借家料',k:['借地借家料']},{l:'その他施設費',k:['その他施設費']}]},
    {t:'g',  l:'租税公課計',      k:['重量税','自動車税','取得税','その他税'], s:[]},
    {t:'g',  l:'備車費計',        k:['集配傭車','路線備車','路線傭車','委託費','社内外注費'],
      s:[{l:'集配傭車',k:['集配傭車']},{l:'路線傭車',k:['路線備車','路線傭車']},{l:'委託費',k:['委託費']}]},
    {t:'g',  l:'道路費計',        k:['道路利用料','その他利用料'], s:[]},
    {t:'g',  l:'営業費計',        k:['水道光熱費','備消品費','図書印刷費','通信運搬費','電算関連費'],
      s:[{l:'水道光熱費',k:['水道光熱費']}]},
    {t:'g',  l:'その他費用計',    k:['被服費','交際費','負担金','教育求人費','雑費','環境衛生費','経営指導料'], s:[]},
    {t:'tot',l:'▶ 売上原価合計'},
    {t:'prf',l:'◆ センター利益（粗利）'},
  ],

  PLAN_MONTH_COLS: {
    '04':2,'05':3,'06':4,'07':5,'08':6,'09':7,
    '10':9,'11':10,'12':11,'01':12,'02':13,'03':14,
  },

  TARGETS: {
    pseudoLaborRate: 80,
    safetyMarginWarn: 10,
    safetyMarginOk:   20,
    variableRateMax:  80,
  },

  COLORS: ['#1a4d7c','#e05b4d','#1a7a52','#b45309','#2563eb','#7c3aed','#0891b2','#be185d','#65a30d','#d97706'],
  VIEW_TITLES: {
    dashboard:'ダッシュボード', pl:'月次収支表', trend:'売上推移',
    shipper:'荷主分析', indicators:'経営指標', annual:'年次サマリー',
    alerts:'アラート', memo:'メモ・コメント', report:'会議報告書',
    library:'過去資料', field:'作業者・エリア分析', capacity:'キャパ分析', import:'データ取込',
  },
};

/* ════════ §2 CENTER（URLから確定・不変） ════════════════════════ */
const CENTER = (() => {
  const p = new URLSearchParams(location.search);
  const id = (p.get('c') || p.get('center') || 'kitasaitama').toLowerCase();
  return CONFIG.CENTERS.find(c => c.id === id) || CONFIG.CENTERS[0];
})();

/* ════════ §3 STATE（ランタイム状態） ═══════════════════════════ */
const STATE = {
  datasets:  [],    // [{ym,type,rows,totalIncome,totalExpense,profit,...}]
  fieldData: [],    // [{ym,areas:{name:{count,shippers:{}}}}]
  capacity:  null,  // {areas:{name:{max}},updatedAt}
  planData:  null,  // 計画データ
  memos:     {},    // {ym: {text,savedAt}}
  library:   [],    // 過去資料
  view:      'dashboard',
  selYM:     null,  // 現在選択中のYM
  shipperMode: 'group',
  _charts:   {},    // {id: ChartInstance}
};

/* ════════ §4 STORE（localStorage、センター別） ════════════════ */
const STORE = {
  _p: `mgmt5_${CENTER.id}_`,

  _s(k, v) { try { localStorage.setItem(this._p+k, JSON.stringify(v)); } catch(e){} },
  _g(k)    { try { const v=localStorage.getItem(this._p+k); return v?JSON.parse(v):null; } catch(e){ return null; } },

  load() {
    STATE.datasets  = this._g('datasets')  || [];
    STATE.fieldData = this._g('fieldData') || [];
    STATE.capacity  = this._g('capacity')  || null;
    STATE.planData  = this._g('planData')  || null;
    STATE.memos     = this._g('memos')     || {};
    STATE.library   = this._g('library')   || [];
  },

  save() {
    this._s('datasets',  STATE.datasets);
    this._s('fieldData', STATE.fieldData);
    this._s('capacity',  STATE.capacity);
    this._s('planData',  STATE.planData);
    this._s('memos',     STATE.memos);
    this._s('library',   STATE.library);
  },

  exportJSON() {
    const blob = new Blob([JSON.stringify({
      center:CENTER.id, exportedAt:new Date().toISOString(),
      datasets:STATE.datasets, fieldData:STATE.fieldData,
      capacity:STATE.capacity, memos:STATE.memos, library:STATE.library,
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
      if (d.fieldData) STATE.fieldData = d.fieldData;
      if (d.capacity)  STATE.capacity  = d.capacity;
      if (d.memos)     STATE.memos     = d.memos;
      if (d.library)   STATE.library   = d.library;
      this.save();
      NAV.refresh();
      UI.toast('バックアップを復元しました');
    } catch(e) { UI.toast('読込エラー: '+e.message, 'error'); }
  },

  storageInfo() {
    let size = 0;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(this._p)) size += (localStorage.getItem(k)||'').length * 2;
    }
    return { bytes: size, kb: (size/1024).toFixed(1) };
  },
};

/* ════════ §5 CSV ════════════════════════════════════════════════ */
const CSV = {
  async read(file) {
    const buf = await file.arrayBuffer();
    for (const enc of ['shift_jis','shift-jis','windows-31j','utf-8']) {
      try { return new TextDecoder(enc,{fatal:true}).decode(buf); } catch(e){}
    }
    return new TextDecoder('utf-8',{fatal:false}).decode(buf);
  },

  parseLine(line) {
    const res=[]; let cur=''; let q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}
      else if(c===','&&!q){res.push(cur.trim());cur='';}
      else cur+=c;
    }
    res.push(cur.trim());
    return res;
  },

  toRows(text) {
    return text.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
      .split('\n').filter(l=>l.trim()).map(l=>this.parseLine(l));
  },

  // SKDL形式CSVを解析
  // monthCol: PLAN_MONTH_COLS[mm] 値。nullなら先頭数値列を採用
  parseSKDL(text, monthCol) {
    const rows = this.toRows(text);
    const ALL = new Set([...CONFIG.INCOME_KEYS,...CONFIG.EXPENSE_KEYS,...CONFIG.INCOME_SUB_KEYS]);
    const result = {};
    let found = 0;

    for (const row of rows) {
      if (!row[0]) continue;
      const label = row[0].replace(/[\s　\u3000]/g,'');
      if (!ALL.has(label)) continue;

      let val = null;
      // 指定列が有効なら優先
      if (monthCol != null && row[monthCol] !== undefined) {
        const v = parseFloat((row[monthCol]||'').replace(/,/g,'').replace(/[^\d.\-]/g,''));
        if (!isNaN(v)) val = v;
      }
      // フォールバック：最初の数値列
      if (val === null) {
        for (let i=1; i<row.length; i++) {
          const v = parseFloat((row[i]||'').replace(/,/g,'').replace(/[^\d.\-]/g,''));
          if (!isNaN(v)) { val = v; break; }
        }
      }
      if (val !== null) { result[label] = (result[label]||0) + val; found++; }
    }
    return found > 0 ? result : null;
  },

  // 計画データ（貼り付けテキスト）解析
  parsePlan(text) {
    const rows = this.toRows(text.replace(/\t/g,','));
    const plan = {};
    for (const row of rows) {
      if (!row[0]) continue;
      const label = row[0].replace(/[\s　]/g,'');
      // 全12列分（月ごと）を抽出
      const vals = {};
      for (const [mm, col] of Object.entries(CONFIG.PLAN_MONTH_COLS)) {
        const v = parseFloat((row[col]||'').replace(/,/g,''));
        if (!isNaN(v)) vals[mm] = v;
      }
      if (Object.keys(vals).length > 0) plan[label] = vals;
    }
    return Object.keys(plan).length > 0 ? plan : null;
  },
};

/* ════════ §6 PROCESS（CSV生データ→データセット） ══════════════ */
function n(v) { return typeof v==='number' ? v : (parseFloat(v)||0); }

function processDataset(ym, type, rows) {
  const totalIncome  = CONFIG.INCOME_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const totalExpense = CONFIG.EXPENSE_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const profit = totalIncome - totalExpense;

  const laborCost = [...CONFIG.LABOR_KEYS,...CONFIG.YOSHA_KEYS].reduce((s,k)=>s+n(rows[k]),0);
  const fixedCost = CONFIG.FIXED_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const varCost   = CONFIG.VARIABLE_KEYS.reduce((s,k)=>s+n(rows[k]),0);

  const pseudoLaborRate = totalIncome > 0 ? laborCost/totalIncome*100 : 0;
  const variableRate    = totalIncome > 0 ? varCost/totalIncome*100   : 0;
  const fixedRate       = totalIncome > 0 ? fixedCost/totalIncome*100 : 0;
  const profitRate      = totalIncome > 0 ? profit/totalIncome*100    : 0;

  return { ym, type, rows, totalIncome, totalExpense, profit,
    pseudoLaborRate, variableRate, fixedRate, profitRate,
    laborCost, fixedCost, varCost, importedAt: new Date().toISOString() };
}

function upsertDataset(ds) {
  const idx = STATE.datasets.findIndex(d=>d.ym===ds.ym);
  if (idx>=0) {
    if (STATE.datasets[idx].type==='confirmed' && ds.type==='daily') return; // 確定値を優先
    STATE.datasets[idx] = ds;
  } else {
    STATE.datasets.push(ds);
  }
  STATE.datasets.sort((a,b)=>a.ym.localeCompare(b.ym));
}

/* ════════ §7 IMPORT ════════════════════════════════════════════ */
const IMPORT = {
  _pending: [],

  handleFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const csv  = arr.filter(f=>/\.csv$/i.test(f.name));
    const xlsx = arr.filter(f=>/\.(xlsx|xls)$/i.test(f.name));
    const pdf  = arr.filter(f=>/\.pdf$/i.test(f.name));
    if (csv.length)  { this._pending = csv; MODAL.openYM(csv); return; }
    if (xlsx.length) { this.importCapacityExcel(xlsx[0]).catch(e=>UI.toast(e.message,'error')); return; }
    if (pdf.length)  { UI.toast('PDF取込は現在実装中です。CSVに変換してください。','warn'); return; }
    UI.toast('対応形式：CSV（収支）・XLSX（キャパ）','warn');
  },

  async processCSV(files, ym) {
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    let imported = 0;
    for (const f of files) {
      try {
        const text = await CSV.read(f);
        const rows = CSV.parseSKDL(text, monthCol);
        if (!rows) { UI.toast(`${f.name}: データ行が見つかりません`,'warn'); continue; }
        const type = /0001|日報/i.test(f.name) ? 'daily' : 'confirmed';
        upsertDataset(processDataset(ym, type, rows));
        imported++;
      } catch(e) { UI.toast(`${f.name}: ${e.message}`,'error'); }
    }
    if (imported > 0) {
      STORE.save();
      CLOUD.pushMonth(ym).catch(()=>{}); // 取込月だけ自動同期
      NAV.refresh();
      UI.toast(`${imported}件取込完了（${ymLabel(ym)}）`);
      UI.updateSaveStatus();
    }
  },

  async importCapacityExcel(file) {
    try {
      await ASSETS.xlsx();
      if (!window.XLSX) { UI.toast('SheetJSが読み込まれていません','error'); return; }
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf,{type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = window.XLSX.utils.sheet_to_json(ws,{header:1});
      const areas = {};
      for (const row of data) {
        if (!row[0]) continue;
        const name = String(row[0]).trim();
        const max  = parseInt(String(row[1]||0).replace(/,/g,''));
        if (name && max > 0) areas[name] = { max };
      }
      if (!Object.keys(areas).length) { UI.toast('地区データが見つかりません（A列:地区名 B列:最大件数）','warn'); return; }
      STATE.capacity = { areas, updatedAt: new Date().toISOString() };
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      NAV.refresh();
      UI.toast(`キャパ取込完了: ${Object.keys(areas).length}地区`);
    } catch(e) { UI.toast('Excel読込エラー: '+e.message,'error'); }
  },

  deleteDataset(ym) {
    if (!confirm(`${ymLabel(ym)}のデータを削除しますか？`)) return;
    STATE.datasets = STATE.datasets.filter(d=>d.ym!==ym);
    STORE.save();
    NAV.refresh();
    UI.toast(`${ymLabel(ym)}を削除しました`);
  },

  clearAll() {
    if (!confirm('全データを削除します。よろしいですか？')) return;
    STATE.datasets = []; STATE.fieldData = []; STATE.capacity = null;
    STORE.save();
    NAV.refresh();
    UI.toast('全データを削除しました');
  },
};

/* ════════ §8 MODAL（年月選択） ═════════════════════════════════ */
const MODAL = {
  openYM(files) {
    const el = document.getElementById('modal-ym') || document.getElementById('ym-modal');
    if (!el) return;
    const fl = document.getElementById('modal-file-list');
    if (fl) fl.innerHTML = files.map(f=>`<div class="modal-file-item">📄 ${esc(f.name)}</div>`).join('');
    const yr = document.getElementById('modal-year');
    const now = new Date();
    if (yr) {
      yr.innerHTML = '';
      for (let y=now.getFullYear()+1; y>=2020; y--)
        yr.innerHTML += `<option value="${y}" ${y===now.getFullYear()?'selected':''}>${y}</option>`;
    }
    const mo = document.getElementById('modal-month');
    if (mo) {
      for (const opt of mo.options)
        opt.selected = (parseInt(opt.value)===now.getMonth()+1);
    }
    el.style.display = 'flex';
  },

  cancel() {
    const el = document.getElementById('modal-ym') || document.getElementById('ym-modal');
    if (el) el.style.display = 'none';
    IMPORT._pending = [];
  },

  async confirm() {
    const el = document.getElementById('modal-ym') || document.getElementById('ym-modal');
    if (el) el.style.display = 'none';
    const yr = document.getElementById('modal-year').value;
    const mo = document.getElementById('modal-month').value.padStart(2,'0');
    const files = IMPORT._pending; IMPORT._pending = [];
    await IMPORT.processCSV(files, yr+mo);
  },
};

/* ════════ §9 CLOUD（Supabase — 取込時のみ自動実行） ═══════════ */
const CLOUD = {
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
  _datasetKey(ym) { return `${CENTER.id}/skdl/${ym}.json`; },
  _capacityKey() { return `${CENTER.id}/capacity/master.json`; },
  _fieldKey() { return `${CENTER.id}/field/data.json`; },
  _legacyKey() { return `${CENTER.id}/data_v5.json`; },
  _makeManifest() {
    return {
      version: 6,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      datasets: STATE.datasets.map(d => ({ ym:d.ym, type:d.type, importedAt:d.importedAt || null, totalIncome:d.totalIncome || 0, totalExpense:d.totalExpense || 0, profit:d.profit || 0 })),
      hasCapacity: !!STATE.capacity,
      hasFieldData: !!(STATE.fieldData && STATE.fieldData.length),
    };
  },
  async _uploadJSON(key, value) {
    const sb = await this._client();
    if (!sb) return { ok:false, error:'Supabase未設定' };
    const blob = new Blob([JSON.stringify(value)], { type:'application/json' });
    const { error } = await sb.storage.from(this._bucket()).upload(key, blob, { upsert:true, contentType:'application/json' });
    if (error) throw error;
    return { ok:true };
  },
  async _downloadJSON(key) {
    const sb = await this._client();
    if (!sb) return null;
    const { data, error } = await sb.storage.from(this._bucket()).download(key);
    if (error) return null;
    return JSON.parse(await data.text());
  },
  async pushMonth(ym) {
    if (!ym) return { ok:false, error:'対象月なし' };
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      const ds = STATE.datasets.find(d => d.ym === ym);
      if (!ds) return { ok:false, error:'対象月データなし' };
      await this._uploadJSON(this._datasetKey(ym), ds);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
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
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
    finally { this._busy = false; }
  },
  async pushAll() {
    if (this._busy) return { ok:false, error:'同期処理中' };
    this._busy = true;
    try {
      for (const ds of STATE.datasets) await this._uploadJSON(this._datasetKey(ds.ym), ds);
      if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
      if (STATE.fieldData && STATE.fieldData.length) await this._uploadJSON(this._fieldKey(), STATE.fieldData);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      UI.updateCloudBadge('ok');
      return { ok:true };
    } catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
    finally { this._busy = false; }
  },
  async push() { return this.pushAll(); },
  async pullManifestAndMissing() {
    const manifest = await this._downloadJSON(this._manifestKey());
    if (!manifest || !Array.isArray(manifest.datasets)) return { ok:false, error:'manifestなし' };
    let changed = 0;
    for (const meta of manifest.datasets) {
      if (!meta.ym) continue;
      const local = STATE.datasets.find(d => d.ym === meta.ym);
      if (!local || String(meta.importedAt||'') > String(local.importedAt||'')) {
        const ds = await this._downloadJSON(this._datasetKey(meta.ym));
        if (ds && ds.ym) { upsertDataset(ds); changed++; }
      }
    }
    if (manifest.hasCapacity && !STATE.capacity) {
      const cap = await this._downloadJSON(this._capacityKey());
      if (cap) { STATE.capacity = cap; changed++; }
    }
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
    STORE.save();
    UI.updateCloudBadge('ok');
    return { ok:true };
  },
  async pull() {
    try { const r = await this.pullManifestAndMissing(); if (r.ok) return r; return await this.pullLegacy(); }
    catch(e) { UI.updateCloudBadge('error'); return { ok:false, error:e.message }; }
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
    if (msgEl) msgEl.textContent='クラウドから取得中...';
    UI.toast('クラウドから取得中...');
    const r=await this.pull();
    if (msgEl) msgEl.textContent = r.ok ? '✅ 取得完了' : '❌ '+(r.error||'');
    if (r.ok) { NAV.refresh(); UI.toast('クラウドからデータを取得しました'); }
    else UI.toast('取得失敗: '+(r.error||'不明'), 'error');
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

/* ════════ §10 フォーマットヘルパー ════════════════════════════ */
function fmt(v,d=0) {
  if (v==null||isNaN(v)) return '—';
  return new Intl.NumberFormat('ja-JP',{maximumFractionDigits:d,minimumFractionDigits:d}).format(Math.round(v));
}
function fmtK(v,d=0) { // 千円単位
  if (v==null||isNaN(v)) return '—';
  return fmt(v/1000,d);
}
function pct(v,d=1) { return (v==null||isNaN(v)||!isFinite(v)) ? '—' : fmt(v,d)+'%'; }
function diff(a,b) { if(!a||!b) return '—'; const d=a-b; return (d>=0?'+':'')+fmtK(d); }
function ratio(a,b) { if(!a||!b) return '—'; return pct((a/b-1)*100); }
function ymLabel(ym) { return ym ? `${ym.slice(0,4)}年${parseInt(ym.slice(4,6))}月` : '—'; }
function dt() { return new Date().toISOString().slice(0,10); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function latestDS() { return STATE.datasets.length ? STATE.datasets[STATE.datasets.length-1] : null; }
function prevDS(ym) { const i=STATE.datasets.findIndex(d=>d.ym===ym); return i>0?STATE.datasets[i-1]:null; }
function sameMonthLastYear(ym) {
  if (!ym) return null;
  const py = String(parseInt(ym.slice(0,4))-1)+ym.slice(4);
  return STATE.datasets.find(d=>d.ym===py)||null;
}

/* ════════ §11 CHART_MGR ════════════════════════════════════════ */
const CHART_MGR = {
  make(id, cfg) {
    if (STATE._charts[id]) { try{STATE._charts[id].destroy();}catch(e){} delete STATE._charts[id]; }
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return null;
    try { STATE._charts[id] = new Chart(canvas.getContext('2d'), cfg); return STATE._charts[id]; }
    catch(e){ return null; }
  },
  destroyAll() {
    Object.values(STATE._charts).forEach(c=>{try{c.destroy();}catch(e){}});
    STATE._charts = {};
  },
};

/* ════════ §12 RENDER — Dashboard ══════════════════════════════ */
function renderDashboard() {
  const ds = latestDS();
  const area = document.getElementById('kpi-area');
  if (!area) return;

  if (!ds) {
    area.innerHTML = `<div style="grid-column:1/-1" class="msg msg-info">データがありません。左メニューの「データ取込」からCSVを読み込んでください。</div>`;
    ['exp-bars-area','shipper-bars-area'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.innerHTML='<div style="padding:10px;font-size:12px;color:var(--text3)">データなし</div>';
    });
    CHART_MGR.destroyAll();
    return;
  }

  // KPI Cards
  const profitClass = ds.profit >= 0 ? 'green' : 'red';
  const profitAccent = ds.profit >= 0 ? 'accent-green' : 'accent-red';
  const prevDs = prevDS(ds.ym);

  area.innerHTML = `
    <div class="kpi-card accent-navy">
      <div class="kpi-label">営業収益（当月）</div>
      <div class="kpi-value navy">${fmtK(ds.totalIncome)}<span style="font-size:13px;font-weight:400">千円</span></div>
      <div class="kpi-sub-row">
        <span class="kpi-sub">${ymLabel(ds.ym)}</span>
        ${prevDs ? `<span class="pill ${ds.totalIncome>=prevDs.totalIncome?'up':'down'}">${ratio(ds.totalIncome,prevDs.totalIncome)} 前月比</span>` : ''}
      </div>
    </div>
    <div class="kpi-card accent-red">
      <div class="kpi-label">費用合計（当月）</div>
      <div class="kpi-value red">${fmtK(ds.totalExpense)}<span style="font-size:13px;font-weight:400">千円</span></div>
      <div class="kpi-sub-row">
        <span class="kpi-sub">利益率目標：${CONFIG.TARGETS.pseudoLaborRate}%以下（人件費率）</span>
      </div>
    </div>
    <div class="kpi-card ${profitAccent}">
      <div class="kpi-label">センター利益（粗利）</div>
      <div class="kpi-value ${profitClass}">${fmtK(ds.profit)}<span style="font-size:13px;font-weight:400">千円</span></div>
      <div class="kpi-sub-row">
        <span class="pill ${ds.profit>=0?'up':'down'}">${pct(ds.profitRate)} 利益率</span>
      </div>
    </div>
    <div class="kpi-card accent-amber">
      <div class="kpi-label">みなし人件費率</div>
      <div class="kpi-value ${ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? 'green' : 'red'}">${pct(ds.pseudoLaborRate)}</div>
      <div class="kpi-sub-row">
        <span class="kpi-sub">目標：${CONFIG.TARGETS.pseudoLaborRate}%以内</span>
        <span class="pill ${ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? 'up' : 'down'}">${ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? '✓ 達成' : '⚠ 超過'}</span>
      </div>
    </div>`;

  // メインチャート（月次収支推移）
  const labels = STATE.datasets.map(d=>ymLabel(d.ym));
  const inc  = STATE.datasets.map(d=>d.totalIncome/1000);
  const exp  = STATE.datasets.map(d=>d.totalExpense/1000);
  const prof = STATE.datasets.map(d=>d.profit/1000);

  CHART_MGR.make('c-main-trend', {
    type:'bar',
    data: {
      labels,
      datasets:[
        {label:'収入',data:inc,backgroundColor:'rgba(26,77,124,.7)',order:2},
        {label:'費用',data:exp,backgroundColor:'rgba(224,91,77,.7)',order:2},
        {label:'利益',data:prof,type:'line',borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',
          pointRadius:3,tension:.3,fill:false,order:1,yAxisID:'y2'},
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{mode:'index'}},
      scales:{
        y:{title:{display:true,text:'千円'},grid:{color:'#f0f0f0'}},
        y2:{position:'right',title:{display:true,text:'利益（千円）'},grid:{display:false}},
      }
    }
  });

  // 収入構成（当月）ドーナツ
  const incItems = CONFIG.INCOME_KEYS.filter(k=>n(ds.rows[k])>0);
  CHART_MGR.make('c-inc-donut', {
    type:'doughnut',
    data:{
      labels: incItems,
      datasets:[{data:incItems.map(k=>n(ds.rows[k])/1000), backgroundColor:CONFIG.COLORS, borderWidth:1}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}
  });
  const leg = document.getElementById('inc-donut-legend');
  if (leg) leg.innerHTML = incItems.map((k,i)=>`
    <div class="legend-item"><div class="legend-dot" style="background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div>${esc(k)}</div>`).join('');

  // 費用内訳ミニバー
  const expArea = document.getElementById('exp-bars-area');
  if (expArea && ds) {
    const groups = CONFIG.PL_DEF.filter(d=>d.t==='g').map(d=>{
      const v = (d.k||[]).reduce((s,k)=>s+n(ds.rows[k]),0);
      return {l:d.l, v};
    }).filter(g=>g.v>0).sort((a,b)=>b.v-a.v).slice(0,8);
    const maxV = Math.max(...groups.map(g=>g.v),1);
    expArea.innerHTML = groups.map((g,i)=>`
      <div class="mbar-row">
        <div class="mbar-label" title="${esc(g.l)}">${esc(g.l)}</div>
        <div class="mbar-track"><div class="mbar-fill" style="width:${(g.v/maxV*100).toFixed(1)}%;background:${CONFIG.COLORS[(i+1)%CONFIG.COLORS.length]}"></div></div>
        <div class="mbar-val">${fmtK(g.v)}千</div>
      </div>`).join('');
  }

  // 荷主バー（shippers存在時のみ）
  const shipArea = document.getElementById('shipper-bars-area');
  if (shipArea) {
    if (ds.shippers && Object.keys(ds.shippers).length) {
      const items = Object.entries(ds.shippers).sort((a,b)=>b[1].income-a[1].income).slice(0,8);
      const maxV = Math.max(...items.map(x=>x[1].income),1);
      shipArea.innerHTML = items.map(([name,d],i)=>`
        <div class="mbar-row">
          <div class="mbar-label" title="${esc(name)}">${esc(name)}</div>
          <div class="mbar-track"><div class="mbar-fill" style="width:${(d.income/maxV*100).toFixed(1)}%;background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div></div>
          <div class="mbar-val">${fmtK(d.income)}千</div>
        </div>`).join('');
    } else {
      shipArea.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">荷主データは別途CSV取込が必要です</div>';
    }
  }
}

/* ════════ §13 RENDER — P&L ════════════════════════════════════ */
function renderPL() {
  const notice = document.getElementById('pl-notice');
  const tbody  = document.getElementById('pl-tbody');
  if (!tbody) return;

  const ds = latestDS();
  if (!ds) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">データがありません</div>';
    tbody.innerHTML = '';
    return;
  }
  if (notice) notice.innerHTML = '';

  const prev = prevDS(ds.ym);
  const py   = sameMonthLastYear(ds.ym);
  const plan = STATE.planData;
  const mm   = ds.ym.slice(4,6);

  function getVal(ds, keys) {
    if (!ds) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.reduce((s,k)=>s+n(ds.rows?.[k]??ds.rows?.[k]??0),0);
  }
  function getPlan(label) {
    if (!plan) return null;
    const v = plan[label]?.[mm];
    return v != null ? v : null;
  }

  const rows = [];
  for (const def of CONFIG.PL_DEF) {
    if (def.t==='h') {
      rows.push(`<tr class="row-h"><td colspan="12">${esc(def.l)}</td></tr>`);
      continue;
    }
    if (def.t==='st') { // 収益計
      const v = ds.totalIncome; const pv=plan?getPlan('営業収益計'):null;
      rows.push(makeRow(def.l, v, null, pv, prev?prev.totalIncome:null, py?py.totalIncome:null, true));
      continue;
    }
    if (def.t==='tot') { // 費用合計
      const v = ds.totalExpense;
      rows.push(makeRow(def.l, v, ds.totalIncome, null, prev?prev.totalExpense:null, py?py.totalExpense:null, true));
      continue;
    }
    if (def.t==='prf') { // 利益
      const v = ds.profit;
      rows.push(`<tr class="${v>=0?'row-profit':'row-loss'}">
        <td><strong>${esc(def.l)}</strong></td>
        <td class="r"><strong>${fmtK(v)}</strong></td>
        <td class="r">${pct(ds.profitRate)}</td>
        <td class="r" colspan="3">—</td>
        <td class="r vs-col">${prev?fmtK(prev.profit):'—'}</td>
        <td class="r vs-col">${diff(v,prev?.profit)}</td>
        <td class="r vs-col">${ratio(v,prev?.profit)}</td>
        <td class="r vs-col">${py?fmtK(py.profit):'—'}</td>
        <td class="r vs-col">${diff(v,py?.profit)}</td>
        <td class="r vs-col">${ratio(v,py?.profit)}</td>
      </tr>`);
      continue;
    }
    if (def.t==='i') { // 収入行
      const v = getVal(ds,def.k);
      rows.push(makeRow(def.l, v, ds.totalIncome, getPlan(def.l), getVal(prev,def.k), getVal(py,def.k), false));
      if (def.sub) {
        for (const sub of def.sub) {
          const sv = n(ds.rows?.[sub.k]);
          if (sv) rows.push(`<tr class="row-indent"><td>${esc(sub.l)}</td><td class="r">${fmtK(sv)}</td><td colspan="10"></td></tr>`);
        }
      }
      continue;
    }
    if (def.t==='g') { // 費用グループ
      const v = getVal(ds,def.k);
      rows.push(`<tr class="row-sub">`+
        `<td><strong>${esc(def.l)}</strong></td>`+
        `<td class="r"><strong>${fmtK(v)}</strong></td>`+
        `<td class="r">${ds.totalIncome>0?pct(v/ds.totalIncome*100):'—'}</td>`+
        `<td class="r">${plan&&getPlan(def.l)?fmtK(getPlan(def.l)):'—'}</td>`+
        `<td class="r">${plan&&getPlan(def.l)?diff(v,getPlan(def.l)*1000):'—'}</td>`+
        `<td class="r">${plan&&getPlan(def.l)?ratio(v,getPlan(def.l)*1000):'—'}</td>`+
        `<td class="r vs-col">${prev?fmtK(getVal(prev,def.k)):'—'}</td>`+
        `<td class="r vs-col">${diff(v,getVal(prev,def.k))}</td>`+
        `<td class="r vs-col">${ratio(v,getVal(prev,def.k))}</td>`+
        `<td class="r vs-col">${py?fmtK(getVal(py,def.k)):'—'}</td>`+
        `<td class="r vs-col">${diff(v,getVal(py,def.k))}</td>`+
        `<td class="r vs-col">${ratio(v,getVal(py,def.k))}</td>`+
        `</tr>`);
      for (const sub of (def.s||[])) {
        const sv = getVal(ds,sub.k);
        if (n(sv)) rows.push(`<tr class="row-indent"><td>${esc(sub.l)}</td><td class="r">${fmtK(sv)}</td><td colspan="10"></td></tr>`);
      }
    }
  }
  tbody.innerHTML = rows.join('');

  // サブタイトル
  const title = document.getElementById('pl-card-title');
  if (title) title.textContent = `月次収支表（${ymLabel(ds.ym)}）`;
}

function makeRow(label, v, base, planV, prevV, pyV, bold) {
  const vk = v/1000; const b = bold ? 'font-weight:700' : '';
  const rat = base && base>0 ? pct(v/base*100) : '—';
  const planK = planV!=null ? planV : null; // 計画は千円単位で保存
  return `<tr>
    <td style="${b}">${esc(label)}</td>
    <td class="r" style="${b}">${fmtK(v)}</td>
    <td class="r">${rat}</td>
    <td class="r" style="background:#fff9e6">${planK!=null?fmt(planK):'—'}</td>
    <td class="r ${planK!=null?(v/1000>=planK?'cell-up':'cell-down'):''}">${planK!=null?diff(v/1000,planK):'—'}</td>
    <td class="r">${planK!=null?ratio(v/1000,planK):'—'}</td>
    <td class="r vs-col">${prevV!=null?fmtK(prevV):'—'}</td>
    <td class="r vs-col ${prevV!=null?(v>=prevV?'cell-up':'cell-down'):''}">${diff(v,prevV)}</td>
    <td class="r vs-col">${ratio(v,prevV)}</td>
    <td class="r vs-col">${pyV!=null?fmtK(pyV):'—'}</td>
    <td class="r vs-col ${pyV!=null?(v>=pyV?'cell-up':'cell-down'):''}">${diff(v,pyV)}</td>
    <td class="r vs-col">${ratio(v,pyV)}</td>
  </tr>`;
}

/* ════════ §14 RENDER — Trend ══════════════════════════════════ */
function renderTrend() {
  const notice = document.getElementById('trend-notice');
  if (!STATE.datasets.length) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">データがありません</div>';
    return;
  }
  if (notice) notice.innerHTML = '';
  const labels = STATE.datasets.map(d=>ymLabel(d.ym));
  const inc = STATE.datasets.map(d=>d.totalIncome/1000);
  const exp = STATE.datasets.map(d=>d.totalExpense/1000);
  const prf = STATE.datasets.map(d=>d.profit/1000);

  CHART_MGR.make('c-trend-main', {
    type:'bar', data:{labels,
      datasets:[
        {label:'収入（千円）',data:inc,backgroundColor:'rgba(26,77,124,.7)',order:2},
        {label:'費用（千円）',data:exp,backgroundColor:'rgba(224,91,77,.7)',order:2},
        {label:'利益（千円）',data:prf,type:'line',borderColor:'#16a34a',
          backgroundColor:'rgba(22,163,74,.1)',fill:false,tension:.3,pointRadius:4,order:1},
      ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top'},tooltip:{mode:'index'}},
      scales:{y:{title:{display:true,text:'千円'},grid:{color:'#f0f0f0'}}}}
  });

  // 月次表
  const tbody = document.getElementById('trend-tbody');
  if (tbody) {
    const rows = [...STATE.datasets].reverse().map((d,i,arr)=>{
      const prev = i<arr.length-1 ? arr[i+1] : null;
      return `<tr>
        <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
        <td class="r">${fmtK(d.totalIncome)}</td><td class="r">${fmtK(d.totalExpense)}</td>
        <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
        <td class="r">${pct(d.profitRate)}</td>
        <td class="r">—</td>
        <td class="r">${ratio(d.totalIncome,prev?.totalIncome)}</td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');
  }
}

/* ════════ §15 RENDER — Shipper ════════════════════════════════ */
function renderShipper() {
  const ds = latestDS();
  const chartEl = document.getElementById('c-shipper-bar');
  const hasShippers = ds && ds.shippers && Object.keys(ds.shippers).length > 0;

  // シンプル：荷主データが別途ない場合の案内
  const noticeId = 'shipper-notice';
  let noticeEl = document.getElementById(noticeId);
  if (!noticeEl) {
    const view = document.getElementById('view-shipper');
    if (view) { noticeEl=document.createElement('div'); noticeEl.id=noticeId; view.prepend(noticeEl); }
  }
  if (!hasShippers && noticeEl) {
    noticeEl.innerHTML = '<div class="msg msg-info" style="margin-bottom:14px">荷主別データがありません。荷主コード付きCSVを取り込むと荷主分析が表示されます。</div>';
    return;
  }
  if (noticeEl) noticeEl.innerHTML = '';
  if (!ds) return;

  const items = Object.entries(ds.shippers||{}).sort((a,b)=>b[1].income-a[1].income);
  CHART_MGR.make('c-shipper-bar', {
    type:'bar',
    data:{labels:items.map(x=>x[0]), datasets:[{
      label:'売上（千円）',
      data:items.map(x=>x[1].income/1000),
      backgroundColor: items.map((_,i)=>CONFIG.COLORS[i%CONFIG.COLORS.length]),
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{title:{display:true,text:'千円'}}}}
  });
}

/* ════════ §16 RENDER — Indicators ════════════════════════════ */
function renderIndicators() {
  const view = document.getElementById('view-indicators');
  if (!view) return;
  const ds = latestDS();
  if (!ds) {
    view.innerHTML = '<div class="msg msg-info">データがありません</div>';
    return;
  }

  const T = CONFIG.TARGETS;
  const laborOk   = ds.pseudoLaborRate <= T.pseudoLaborRate;
  const varOk     = ds.variableRate    <= T.variableRateMax;
  const smRate    = ds.totalIncome > 0 ? (ds.profit / ds.totalIncome * 100) : 0;
  const smOk      = smRate >= T.safetyMarginOk;
  const smWarn    = smRate >= T.safetyMarginWarn;

  function gauge(val, target, low, unit='%', reverse=false) {
    const ok = reverse ? val<=target : val>=target;
    const warn = reverse ? val<=low : val>=low;
    const color = ok ? '#16a34a' : warn ? '#d97706' : '#dc2626';
    return `<div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:13px;font-weight:700;color:${color}">${pct(val)}</span>
        <span style="font-size:11px;color:var(--text3)">目標: ${target}${unit}${reverse?'以内':'以上'}</span>
      </div>
      <div style="height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden">
        <div style="width:${Math.min(100,Math.abs(val)).toFixed(1)}%;height:100%;background:${color};border-radius:999px;transition:width .5s"></div>
      </div>
    </div>`;
  }

  view.innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:16px">
      <div class="kpi-card ${laborOk?'accent-green':'accent-red'}">
        <div class="kpi-label">みなし人件費率</div>
        <div class="kpi-value ${laborOk?'green':'red'}">${pct(ds.pseudoLaborRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${laborOk?'up':'down'}">${laborOk?'✓ 達成':'⚠ 超過'} 目標${T.pseudoLaborRate}%</span></div>
      </div>
      <div class="kpi-card ${varOk?'accent-green':'accent-amber'}">
        <div class="kpi-label">変動費率</div>
        <div class="kpi-value ${varOk?'green':'amber'}">${pct(ds.variableRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${varOk?'up':'flat'}">${varOk?'✓ 正常':'⚠ 高め'} 目標${T.variableRateMax}%以内</span></div>
      </div>
      <div class="kpi-card ${smOk?'accent-green':smWarn?'accent-amber':'accent-red'}">
        <div class="kpi-label">利益率（安全余裕率）</div>
        <div class="kpi-value ${smOk?'green':smWarn?'':'red'}">${pct(smRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${smOk?'up':smWarn?'flat':'down'}">${smOk?'✓ 安全':smWarn?'△ 要注意':'⚠ 危険'}</span></div>
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-header"><span class="card-title">固定費　内訳</span></div>
        <div class="card-body">
          <table class="tbl"><thead><tr><th>科目</th><th class="r">金額（千円）</th><th class="r">費用比</th></tr></thead>
          <tbody>${CONFIG.FIXED_KEYS.map(k=>{
            const v=n(ds.rows[k]); if(!v) return '';
            return `<tr><td>${esc(k)}</td><td class="r">${fmtK(v)}</td><td class="r">${pct(v/ds.totalExpense*100)}</td></tr>`;
          }).join('')}</tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">変動費　内訳</span></div>
        <div class="card-body">
          <table class="tbl"><thead><tr><th>科目</th><th class="r">金額（千円）</th><th class="r">費用比</th></tr></thead>
          <tbody>${CONFIG.VARIABLE_KEYS.map(k=>{
            const v=n(ds.rows[k]); if(!v) return '';
            return `<tr><td>${esc(k)}</td><td class="r">${fmtK(v)}</td><td class="r">${pct(v/ds.totalExpense*100)}</td></tr>`;
          }).join('')}</tbody></table>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-header"><span class="card-title">各指標　月次推移</span></div>
      <div class="card-body"><div class="chart-wrap" style="height:220px"><canvas id="c-ind-trend"></canvas></div></div>
    </div>`;

  CHART_MGR.make('c-ind-trend', {
    type:'line',
    data:{
      labels: STATE.datasets.map(d=>ymLabel(d.ym)),
      datasets:[
        {label:'みなし人件費率(%)',data:STATE.datasets.map(d=>+d.pseudoLaborRate.toFixed(1)),borderColor:'#1a4d7c',fill:false,tension:.3,pointRadius:3},
        {label:'変動費率(%)',      data:STATE.datasets.map(d=>+d.variableRate.toFixed(1)),   borderColor:'#e05b4d',fill:false,tension:.3,pointRadius:3},
        {label:'利益率(%)',        data:STATE.datasets.map(d=>+d.profitRate.toFixed(1)),      borderColor:'#16a34a',fill:false,tension:.3,pointRadius:3},
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top'}},
      scales:{y:{title:{display:true,text:'%'},grid:{color:'#f0f0f0'}}}}
  });
}

/* ════════ §17 RENDER — Annual ═════════════════════════════════ */
function renderAnnual() {
  const kpi  = document.getElementById('annual-kpi');
  const tbody = document.getElementById('annual-tbody');
  if (!tbody) return;

  if (!STATE.datasets.length) {
    if (kpi) kpi.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="8" style="padding:16px;color:var(--text3);text-align:center">データがありません</td></tr>';
    return;
  }

  // 年度ごとに集計（4月始まり）
  function getFY(ym) {
    const y=parseInt(ym.slice(0,4)), m=parseInt(ym.slice(4,6));
    return m >= CONFIG.FISCAL_START ? y : y-1;
  }
  const fyMap = {};
  for (const ds of STATE.datasets) {
    const fy = getFY(ds.ym);
    if (!fyMap[fy]) fyMap[fy] = {fy, datasets:[], inc:0, exp:0, prf:0};
    fyMap[fy].datasets.push(ds);
    fyMap[fy].inc += ds.totalIncome;
    fyMap[fy].exp += ds.totalExpense;
    fyMap[fy].prf += ds.profit;
  }
  const fys = Object.values(fyMap).sort((a,b)=>b.fy-a.fy);

  if (kpi) {
    const cur = fys[0];
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">年度累計収入（${cur.fy}年度）</div>
        <div class="kpi-value navy">${fmtK(cur.inc)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub">${cur.datasets.length}ヶ月分</div></div>
      <div class="kpi-card accent-red"><div class="kpi-label">年度累計費用</div>
        <div class="kpi-value red">${fmtK(cur.exp)}<span style="font-size:13px;font-weight:400">千円</span></div></div>
      <div class="kpi-card ${cur.prf>=0?'accent-green':'accent-red'}"><div class="kpi-label">年度累計利益</div>
        <div class="kpi-value ${cur.prf>=0?'green':'red'}">${fmtK(cur.prf)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub-row"><span class="pill ${cur.prf>=0?'up':'down'}">${pct(cur.prf/cur.inc*100)} 利益率</span></div></div>`;
  }

  const rows = [...STATE.datasets].reverse().map(ds=>{
    const prev = prevDS(ds.ym);
    const py   = sameMonthLastYear(ds.ym);
    return `<tr>
      <td>${ymLabel(ds.ym)}${ds.type==='daily'?' <span class="badge badge-warn" style="font-size:9px">速</span>':''}</td>
      <td class="r">${fmtK(ds.totalIncome)}</td>
      <td class="r">${fmtK(ds.totalExpense)}</td>
      <td class="r ${ds.profit>=0?'cell-up':'cell-down'}">${fmtK(ds.profit)}</td>
      <td class="r">${pct(ds.profitRate)}</td>
      <td class="r">—</td>
      <td class="r">${ratio(ds.totalIncome,prev?.totalIncome)}</td>
      <td class="r">${ratio(ds.totalIncome,py?.totalIncome)}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');

  // 年度別チャート
  CHART_MGR.make('c-annual-trend', {
    type:'bar',
    data:{
      labels: STATE.datasets.map(d=>ymLabel(d.ym)),
      datasets:[
        {label:'収入', data:STATE.datasets.map(d=>d.totalIncome/1000), backgroundColor:'rgba(26,77,124,.7)'},
        {label:'費用', data:STATE.datasets.map(d=>d.totalExpense/1000),backgroundColor:'rgba(224,91,77,.7)'},
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top'}},
      scales:{y:{title:{display:true,text:'千円'}}}}
  });
}

/* ════════ §18 RENDER — Alerts ═════════════════════════════════ */
function renderAlerts() {
  const box = document.getElementById('alerts-container');
  if (!box) return;
  if (!STATE.datasets.length) {
    box.innerHTML = '<div class="msg msg-info">データがありません</div>';
    const badge = document.getElementById('alert-badge');
    if (badge) badge.style.display='none';
    return;
  }

  const ds = latestDS();
  const T = CONFIG.TARGETS;
  const alerts = [];

  if (ds.pseudoLaborRate > T.pseudoLaborRate)
    alerts.push({level:'warn', title:`みなし人件費率 超過`, msg:`${pct(ds.pseudoLaborRate)}（目標: ${T.pseudoLaborRate}%以内）— ${ymLabel(ds.ym)}`});
  if (ds.variableRate > T.variableRateMax)
    alerts.push({level:'warn', title:`変動費率 高め`, msg:`${pct(ds.variableRate)}（目安: ${T.variableRateMax}%以内）— ${ymLabel(ds.ym)}`});
  if (ds.profit < 0)
    alerts.push({level:'ng', title:`赤字`, msg:`${fmtK(ds.profit)}千円（${ymLabel(ds.ym)}）`});
  else if (ds.profitRate < T.safetyMarginWarn)
    alerts.push({level:'warn', title:`利益率 低水準`, msg:`${pct(ds.profitRate)}（要注意ライン: ${T.safetyMarginWarn}%）`});

  // 連続前月比低下チェック
  const last3 = STATE.datasets.slice(-3);
  if (last3.length===3 && last3[0].totalIncome>last3[1].totalIncome && last3[1].totalIncome>last3[2].totalIncome)
    /* skip - already reversed above */;
  if (last3.length===3 && last3[2].totalIncome<last3[1].totalIncome && last3[1].totalIncome<last3[0].totalIncome)
    alerts.push({level:'warn', title:'収入3ヶ月連続減少', msg:`${ymLabel(last3[0].ym)}〜${ymLabel(last3[2].ym)}`});

  const badge = document.getElementById('alert-badge');
  if (badge) { badge.textContent=alerts.length; badge.style.display=alerts.length?'inline':'none'; }

  if (!alerts.length) {
    box.innerHTML = '<div class="msg msg-ok">現在、アラートはありません。すべての指標が正常範囲内です。</div>';
    return;
  }
  box.innerHTML = alerts.map(a=>`
    <div class="msg msg-${a.level}" style="margin-bottom:10px">
      <strong>${esc(a.title)}</strong><br>${esc(a.msg)}
    </div>`).join('');
}

/* ════════ §19 RENDER — Capacity ═══════════════════════════════ */
const CAPACITY_UI = {
  render() {
    const view = document.getElementById('view-capacity');
    if (!view || !view.classList.contains('active')) return;
    const kpi    = document.getElementById('capacity-kpi');
    const tbody  = document.getElementById('capacity-area-tbody');
    const msgEl  = document.getElementById('capacity-msg');
    if (!tbody) return;

    const cap = STATE.capacity;
    if (!cap || !cap.areas || !Object.keys(cap.areas).length) {
      if (msgEl) msgEl.textContent = 'キャパExcelが未登録です';
      tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;color:var(--text3);text-align:center">キャパExcelを取込んでください</td></tr>';
      if (kpi) kpi.innerHTML = '';
      return;
    }

    const days = parseInt(document.getElementById('capacity-days')?.value||'26');
    const areas = cap.areas;

    // 配送エリアデータ（fieldDataから）
    const fd = STATE.fieldData;
    const latestFd = fd.length ? fd[fd.length-1] : null;

    let overCount=0, warnCount=0, okCount=0, totalCap=0, totalActual=0;
    const rows = Object.entries(areas).map(([name,{max}])=>{
      const monthly = latestFd?.areas?.[name]?.count ?? null;
      const daily = monthly!=null ? monthly/days : null;
      const rate  = daily!=null && max>0 ? daily/max*100 : null;
      totalCap += max;
      if (monthly!=null) totalActual += monthly/days;

      let status = '—'; let statusClass = '';
      if (rate!=null) {
        if (rate>=100) { status='超過'; statusClass='over'; overCount++; }
        else if (rate>=80) { status='余裕少'; statusClass='full'; warnCount++; }
        else { status='余裕あり'; statusClass='ok'; okCount++; }
      }

      return `<tr class="capacity-area-row" onclick="CAPACITY_UI.showShippers('${esc(name)}')">
        <td>${esc(name)}</td>
        <td class="r">${monthly!=null?fmt(monthly):'—'}</td>
        <td class="r">${daily!=null?daily.toFixed(1):'—'}</td>
        <td class="r">${fmt(max)}</td>
        <td class="r ${rate!=null&&rate>=100?'cell-down':rate!=null&&rate>=80?'':'cell-up'}">${daily!=null?fmtM(daily-max):'—'}</td>
        <td class="r">${rate!=null?pct(rate):'—'}</td>
        <td><span class="capacity-status ${statusClass}">${status}</span></td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');

    if (msgEl) msgEl.textContent = cap.updatedAt ? `最終更新: ${cap.updatedAt.slice(0,10)}` : '';

    // KPI
    if (kpi) kpi.innerHTML = `
      <div class="kpi-card accent-red"><div class="kpi-label">超過地区</div><div class="kpi-value red">${overCount}</div></div>
      <div class="kpi-card accent-amber"><div class="kpi-label">余裕少地区</div><div class="kpi-value">${warnCount}</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">余裕あり地区</div><div class="kpi-value green">${okCount}</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">合計キャパ/日</div><div class="kpi-value navy">${fmt(totalCap)}</div></div>`;
  },

  showShippers(areaName) {
    const tbody = document.getElementById('capacity-shipper-tbody');
    const title = document.getElementById('capacity-detail-title');
    if (!tbody) return;
    const fd = STATE.fieldData.length ? STATE.fieldData[STATE.fieldData.length-1] : null;
    const shippers = fd?.areas?.[areaName]?.shippers;
    if (title) title.textContent = ` — ${areaName}`;
    if (!shippers || !Object.keys(shippers).length) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:16px;color:var(--text3);text-align:center">荷主別データなし</td></tr>';
      return;
    }
    const total = Object.values(shippers).reduce((s,c)=>s+c,0);
    tbody.innerHTML = Object.entries(shippers).sort((a,b)=>b[1]-a[1]).map(([name,cnt])=>
      `<tr><td>${esc(name)}</td><td class="r">${fmt(cnt)}</td><td class="r">${pct(cnt/total*100)}</td></tr>`
    ).join('');
  },

  saveSettings() {}, // settings are read on-demand

  async importCapacityExcel(file) { await IMPORT.importCapacityExcel(file); this.render(); },

  async importAreaPdf(files) {
    UI.toast('PDF解析は実装中です。CSVで代用してください。','warn');
  },

  clearMaster() {
    if (!confirm('キャパマスタを削除しますか？')) return;
    STATE.capacity = null;
    STORE.save();
    this.render();
  },

  populateYMSel() {
    const sel = document.getElementById('capacity-ym');
    if (!sel) return;
    sel.innerHTML = STATE.fieldData.length
      ? STATE.fieldData.map(d=>`<option value="${d.ym}">${ymLabel(d.ym)}</option>`).join('')
      : '<option value="">データなし</option>';
  },
};

/* ════════ §20 RENDER — Import ═════════════════════════════════ */
function renderImport() {
  const listEl = document.getElementById('data-list');
  if (listEl) {
    if (!STATE.datasets.length) {
      listEl.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだデータがありません</div>';
    } else {
      listEl.innerHTML = STATE.datasets.map(ds=>`
        <div class="data-item">
          <span class="badge ${ds.type==='confirmed'?'badge-ok':'badge-warn'}">${ds.type==='confirmed'?'確定':'速報'}</span>
          <span style="flex:1">${ymLabel(ds.ym)}</span>
          <span style="font-size:11px;color:var(--text3);margin-right:8px">収入 ${fmtK(ds.totalIncome)}千</span>
          <button class="btn btn-danger" onclick="IMPORT.deleteDataset('${ds.ym}')" style="font-size:11px;padding:2px 8px">削除</button>
        </div>`).join('');
    }
  }

  // ストレージ情報
  const storageEl = document.getElementById('storage-info');
  if (storageEl) {
    const info = STORE.storageInfo();
    storageEl.innerHTML = `使用容量: <strong>${info.kb} KB</strong>（センター: ${CENTER.name}）`;
  }

  // クラウド設定フォームを更新（URL/Key/バッジ）
  CLOUD.renderForm();

  // センター情報
  const descEl = document.getElementById('import-target-desc');
  if (descEl) descEl.textContent = `取込先: ${CENTER.name}（${CENTER.id}）`;

  // 計画バッジ
  const planBadge = document.getElementById('plan-badge');
  if (planBadge) {
    planBadge.textContent = STATE.planData ? '登録済' : '未登録';
    planBadge.className = STATE.planData ? 'badge badge-ok' : 'badge badge-warn';
  }
}

/* ════════ §21 MEMO ════════════════════════════════════════════ */
const MEMO = {
  save() {
    const sel  = document.getElementById('memo-ym-sel');
    const text = document.getElementById('memo-textarea');
    const saved = document.getElementById('memo-saved-at');
    if (!sel||!text) return;
    const ym = sel.value;
    if (!ym) return;
    STATE.memos[ym] = { text: text.value, savedAt: new Date().toISOString() };
    STORE.save();
    if (saved) saved.textContent = '保存済み: '+new Date().toLocaleString('ja-JP');
    this.renderList();
  },
  renderList() {
    const list = document.getElementById('memo-list');
    if (!list) return;
    const entries = Object.entries(STATE.memos).filter(([,m])=>m.text).sort((a,b)=>b[0].localeCompare(a[0]));
    if (!entries.length) { list.innerHTML='<div style="padding:12px 16px;font-size:12px;color:var(--text3)">メモなし</div>'; return; }
    list.innerHTML = entries.map(([ym,m])=>`
      <div class="data-item" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="font-weight:700;font-size:12px">${ymLabel(ym)}</div>
        <div style="font-size:12px;color:var(--text2);white-space:pre-wrap">${esc(m.text)}</div>
      </div>`).join('');
  },
};

function renderMemo() {
  const sel = document.getElementById('memo-ym-sel');
  const text = document.getElementById('memo-textarea');
  if (!sel) return;
  const yms = STATE.datasets.map(d=>d.ym);
  sel.innerHTML = yms.length
    ? yms.map(ym=>`<option value="${ym}">${ymLabel(ym)}</option>`).join('')
    : '<option value="">データなし</option>';
  if (text && sel.value) text.value = STATE.memos[sel.value]?.text||'';
  sel.onchange = ()=>{ if(text) text.value = STATE.memos[sel.value]?.text||''; };
  MEMO.renderList();
}

/* ════════ §22 FIELD_UI（スタブ） ══════════════════════════════ */
const FIELD_UI = {
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
    if (badge) badge.textContent = STATE.fieldData.length
      ? `${ymLabel(STATE.fieldData[STATE.fieldData.length-1].ym)} 読込済`
      : 'データ未読込';
  },
  renderDataList() {
    const list = document.getElementById('field-data-list');
    if (!list) return;
    list.innerHTML = STATE.fieldData.length
      ? STATE.fieldData.map(d=>`<div class="data-item">${ymLabel(d.ym)}</div>`).join('')
      : '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだデータがありません</div>';
  },
};

/* ════════ §23 REPORT_UI（スタブ） ═════════════════════════════ */
const REPORT_UI = {
  refresh() {},
  generatePrompt() {
    const ds = latestDS();
    const out = document.getElementById('report-prompt-output');
    if (!out) return;
    if (!ds) { out.value='データがありません。先にCSVを取込んでください。'; return; }
    const note = document.getElementById('report-current-note')?.value||'';
    out.value = `## ${CENTER.name} ${ymLabel(ds.ym)} 月次報告書 作成依頼

### 基本データ（${ymLabel(ds.ym)}）
- 営業収益: ${fmtK(ds.totalIncome)}千円
- 費用合計: ${fmtK(ds.totalExpense)}千円
- センター利益: ${fmtK(ds.profit)}千円
- 利益率: ${pct(ds.profitRate)}
- みなし人件費率: ${pct(ds.pseudoLaborRate)}（目標: ${CONFIG.TARGETS.pseudoLaborRate}%以内）
- 変動費率: ${pct(ds.variableRate)}

### 当月の状況（担当者入力）
${note||'（入力なし）'}

---
上記のデータを元に、A4 1枚の月次報告書を作成してください。
構成: 1.月次実績概要 / 2.前月比・計画比分析 / 3.重点課題と対策 / 4.来月の方針
`;
    UI.toast('プロンプトを生成しました。コピーしてAIに貼り付けてください。');
  },
  copyPrompt() {
    const out = document.getElementById('report-prompt-output');
    if (!out?.value) { UI.toast('先に「AI用プロンプト作成」ボタンを押してください','warn'); return; }
    navigator.clipboard.writeText(out.value).then(()=>UI.toast('クリップボードにコピーしました'));
  },
};

/* ════════ §24 PAST_LIBRARY（スタブ） ══════════════════════════ */
const PAST_LIBRARY = {
  handleBulkFiles(files) { UI.toast('一括取込: '+Array.from(files).length+'件（メモを入力して登録してください）'); },
  saveBulkSelected() { UI.toast('一括登録完了'); },
  clearBulk() {},
  handleFile(file) { if(file) document.getElementById('library-file-status').textContent = '選択: '+file.name; },
  save() {
    const title = document.getElementById('library-title')?.value;
    const cat   = document.getElementById('library-category')?.value;
    const memo  = document.getElementById('library-memo')?.value;
    const content = document.getElementById('library-content')?.value;
    if (!title) { UI.toast('資料名を入力してください','warn'); return; }
    STATE.library.push({ id:Date.now(), title, category:cat, memo, content, savedAt:new Date().toISOString() });
    STORE.save();
    this.renderList();
    UI.toast('過去資料を保存しました');
    this.clearForm();
  },
  clearForm() {
    ['library-title','library-memo','library-content'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
  },
  renderList() {
    const list = document.getElementById('library-list');
    const filter = document.getElementById('library-filter-category')?.value||'';
    if (!list) return;
    const items = STATE.library.filter(i=>!filter||i.category===filter);
    if (!items.length) { list.innerHTML='<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだ過去資料がありません</div>'; return; }
    list.innerHTML = items.map(i=>`
      <div class="data-item">
        <span class="badge badge-info">${esc(i.category||'—')}</span>
        <span style="flex:1">${esc(i.title)}</span>
        <span style="font-size:10px;color:var(--text3)">${(i.savedAt||'').slice(0,10)}</span>
        <button class="btn btn-danger" onclick="PAST_LIBRARY.delete(${i.id})" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`).join('');
  },
  delete(id) { STATE.library=STATE.library.filter(i=>i.id!==id); STORE.save(); this.renderList(); },
  exportJSON() { STORE.exportJSON(); },
  clearAll() { if(confirm('全過去資料を削除しますか？')){ STATE.library=[]; STORE.save(); this.renderList(); } },
};

/* ════════ §25 NAV ══════════════════════════════════════════════ */
const NAV = {
  // メイン画面切替（同期なし、再描画のみ）
  go(el) {
    const view = (el && el.dataset) ? el.dataset.view : (typeof el==='string' ? el : 'dashboard');
    if (!view) return;
    STATE.view = view;

    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

    const viewEl = document.getElementById('view-'+view);
    if (viewEl) viewEl.classList.add('active');

    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    UI.updateTopbar(view);
    this._render(view);
  },

  // 現在の画面だけ再描画（データ更新後に呼ぶ）
  refresh() {
    this._render(STATE.view);
    UI.updateTopbar(STATE.view);
    UI.updateSaveStatus();
  },

  _render(view) {
    switch(view) {
      case 'dashboard':  renderDashboard();   break;
      case 'pl':         renderPL();           break;
      case 'trend':      renderTrend();        break;
      case 'shipper':    renderShipper();      break;
      case 'indicators': renderIndicators();   break;
      case 'annual':     renderAnnual();       break;
      case 'alerts':     renderAlerts();       break;
      case 'memo':       renderMemo();         break;
      case 'capacity':   CAPACITY_UI.render(); CAPACITY_UI.populateYMSel(); break;
      case 'import':     renderImport();       break;
      case 'library':    PAST_LIBRARY.renderList(); break;
      case 'field':      FIELD_UI.renderDataList(); FIELD_UI.updatePeriodBadge(); break;
      // report: フォームそのままで描画不要
    }
  },
};

/* ════════ §26 UI（ヘルパー） ══════════════════════════════════ */
const UI = {
  updateTopbar(view) {
    const title = document.getElementById('page-title');
    const sub   = document.getElementById('page-sub');
    if (title) title.textContent = CONFIG.VIEW_TITLES[view] || view;
    if (sub) {
      const ds = latestDS();
      sub.textContent = ds ? `最終データ: ${ymLabel(ds.ym)} / ${CENTER.name}` : `データなし — ${CENTER.name}`;
    }
    // センター名を全要素に反映
    document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
    document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent=CENTER.name+'データ取込');
  },

  updateSaveStatus() {
    const label = document.getElementById('autosave-label');
    const dot   = document.getElementById('autosave-dot');
    if (label) label.textContent = `ローカル保存済 (${STATE.datasets.length}件)`;
    if (dot)   dot.style.background = STATE.datasets.length ? '#4d9fea' : '#607d9a';
  },

  updateCloudBadge(status) {
    const label = document.getElementById('cloud-label');
    const dot   = document.getElementById('cloud-dot');
    const badge = document.getElementById('cloud-status-badge');
    if (status==='ok') {
      if (label) label.textContent = 'クラウド: 同期済';
      if (dot)   dot.style.background = '#16a34a';
      if (badge) { badge.textContent='接続OK'; badge.className='badge badge-ok'; }
    } else if (status==='error') {
      if (label) label.textContent = 'クラウド: エラー';
      if (dot)   dot.style.background = '#dc2626';
      if (badge) { badge.textContent='エラー'; badge.className='badge badge-warn'; }
    } else if (status==='configured') {
      if (label) label.textContent = 'クラウド: 設定済';
      if (dot)   dot.style.background = '#4d9fea';
      if (badge) { badge.textContent='設定済（未同期）'; badge.className='badge badge-info'; }
    } else {
      if (label) label.textContent = 'クラウド: 未設定';
      if (dot)   dot.style.background = '#607d9a';
      if (badge) { badge.textContent='未設定'; badge.className='badge badge-warn'; }
    }
  },

  switchShipperMode(mode) {
    STATE.shipperMode = mode;
    ['group','detail'].forEach(m=>{
      const btn=document.getElementById('shipper-tab-'+m);
      if (btn) {
        btn.style.background = m===mode?'#1a4d7c':'var(--surface)';
        btn.style.color = m===mode?'#fff':'var(--text2)';
      }
    });
    renderShipper();
  },

  renderMemo() { renderMemo(); },

  // トースト通知
  toast(msg, type='ok') {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;
      padding:10px 16px;border-radius:8px;font-size:12px;font-family:inherit;
      box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:320px;animation:fadeIn .2s;
      background:${type==='error'?'#dc2626':type==='warn'?'#d97706':'#1a4d7c'};color:#fff`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), type==='error'?5000:3000);
  },
};

/* ════════ §27 互換スタブ ══════════════════════════════════════ */
// 旧コードからの参照に対応（center.html の onclick など）
const DB = {
  exportJSON()   { STORE.exportJSON(); },
  importJSON(f)  { STORE.restoreJSON(f); },
  showStorageInfo() { renderImport(); NAV.go('import'); },
};
const DATA_RESET = {
  clearFieldAll() {
    if (!confirm('現場データを全件削除しますか？')) return;
    STATE.fieldData = [];
    STORE.save();
    UI.toast('現場データを削除しました');
  },
};
const SIMPLE_STORE = {
  debug() { console.log('STATE', STATE); console.log('STORE keys', STORE._p, Object.keys(localStorage).filter(k=>k.startsWith(STORE._p))); UI.toast('コンソールにSTATEをダンプしました'); },
  restoreAll() { STORE.load(); return STATE.datasets.length; },
};
const CLOUD_DEBUG = { run() { CLOUD.saveConfig(); } };
const PUBLISH = { go() { UI.toast('GitHub Pages での公開はHTMLファイルを直接アップロードしてください'); } };
const EVENTS = { handleFiles(files) { IMPORT.handleFiles(files); } };

// 計画データ取込（PLAN）
const PLAN = {
  importFromPaste() {
    const text = document.getElementById('plan-paste-area')?.value||'';
    const plan = CSV.parsePlan(text);
    const msg  = document.getElementById('plan-import-msg');
    if (!plan) {
      UI.toast('計画データを解析できませんでした。タブ区切りでペーストしてください。','warn');
      if (msg) msg.textContent = '解析失敗';
      return;
    }
    STATE.planData = plan;
    STORE.save();
    const count = Object.keys(plan).length;
    if (msg) msg.textContent = `取込完了: ${count}科目`;
    const badge = document.getElementById('plan-badge');
    if (badge) { badge.textContent='登録済'; badge.className='badge badge-ok'; }
    UI.toast(`計画データ取込完了（${count}科目）`);
  },
  clear() {
    if (!confirm('計画データを削除しますか？')) return;
    STATE.planData = null;
    STORE.save();
    const msg = document.getElementById('plan-import-msg');
    if (msg) msg.textContent = '';
    const badge = document.getElementById('plan-badge');
    if (badge) { badge.textContent='未登録'; badge.className='badge badge-warn'; }
    UI.toast('計画データを削除しました');
  },
};

// TSVペースト取込（過去実績補完）
const TSV_IMPORT = {
  doImportHistory() {
    const text = document.getElementById('tsv-paste-area-history')?.value||'';
    const yrSel = document.getElementById('tsv-year-sel-history');
    const fy = yrSel?.value || new Date().getFullYear().toString();
    const msg = document.getElementById('tsv-import-msg-history');
    // TSV → CSV変換して月ごとに処理
    const rows = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
      .filter(l=>l.trim()).map(l=>l.split(/\t/));
    if (!rows.length) { UI.toast('データが空です','warn'); return; }
    const months = ['04','05','06','07','08','09','10','11','12','01','02','03'];
    let imported = 0;
    for (let mi=0; mi<months.length; mi++) {
      const mm = months[mi];
      const colIdx = CONFIG.PLAN_MONTH_COLS[mm];
      const dsRows = {};
      for (const row of rows) {
        const label = (row[0]||'').replace(/[\s　]/g,'');
        const ALL = new Set([...CONFIG.INCOME_KEYS,...CONFIG.EXPENSE_KEYS]);
        if (!ALL.has(label)) continue;
        const v = parseFloat((row[colIdx]||'').replace(/,/g,''));
        if (!isNaN(v) && v!==0) dsRows[label] = v;
      }
      if (Object.keys(dsRows).length > 0) {
        const year = parseInt(mm)>=4 ? fy : String(parseInt(fy)+1);
        const ym = year+mm;
        upsertDataset(processDataset(ym,'confirmed',dsRows));
        imported++;
      }
    }
    STORE.save();
    NAV.refresh();
    if (msg) msg.textContent = `取込完了: ${imported}ヶ月`;
    UI.toast(`過去実績 ${imported}ヶ月を取込みました`);
  },
  doClearHistory() {
    if (!confirm('過去実績補完データを全削除しますか？')) return;
    STATE.datasets = [];
    STORE.save();
    NAV.refresh();
    UI.toast('削除しました');
  },
};

// 現場データ取込2（インポート画面の2つ目のゾーン）
const FIELD_IMPORT2 = {
  handleFiles(files) { IMPORT.handleFiles(files); },
  handleDrop(e) { e.preventDefault(); if(e.dataTransfer.files.length) IMPORT.handleFiles(e.dataTransfer.files); },
};

// 現場データリスト更新（グローバル関数として呼ばれる）
function renderFieldDataList2() {
  const list = document.getElementById('field-data-list2');
  if (!list) return;
  const badge = document.getElementById('field-import-badge');
  if (STATE.fieldData.length) {
    if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }
    list.innerHTML = STATE.fieldData.map(d=>`
      <div class="data-item">
        <span>${ymLabel(d.ym)}</span>
        <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${d.ym}')" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`).join('');
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

/* ════════ §28 アップロードゾーン設定 ══════════════════════════ */
function setupDropZone(zoneId, inputId, handler) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.onclick = () => input.click();
  input.onchange = () => { if(input.files.length) handler(input.files); input.value=''; };

  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files.length) handler(e.dataTransfer.files);
  };
}

/* ════════ §29 計画データ取込 ══════════════════════════════════ */
function setupPlanImport() {
  const pasteEl = document.getElementById('plan-paste-area');
  const btn     = document.getElementById('plan-import-btn');
  if (!btn) return;
  btn.onclick = () => {
    const text = pasteEl?.value||'';
    const plan = CSV.parsePlan(text);
    if (!plan) { UI.toast('計画データが解析できませんでした','warn'); return; }
    STATE.planData = plan;
    STORE.save();
    UI.toast('計画データを取込みました');
    renderImport();
  };
}

/* ════════ §30 BOOT ═════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // 1. ローカルストレージから読込（同期処理のみ）
  STORE.load();

  // 2. センター情報を画面に反映
  document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
  document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent=CENTER.name+'データ取込');

  // 3. ドロップゾーン設定
  setupDropZone('upload-zone', 'file-input', f=>IMPORT.handleFiles(f));
  setupDropZone('field-upload-zone', 'field-file-input', f=>IMPORT.handleFiles(f));

  // 4. ファイル復元用
  const loadInput = document.getElementById('session-load-input');
  if (loadInput) loadInput.onchange = () => { STORE.restoreJSON(loadInput.files[0]); loadInput.value=''; };

  // 5. キャパ月選択
  CAPACITY_UI.populateYMSel();

  // 6. 計画取込
  setupPlanImport();

  // 7. 年度Select全初期化
  const now = new Date();
  ['library-fy','library-bulk-fy','report-fy','plan-year-sel','tsv-year-sel-history'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    for (let y=now.getFullYear()+1; y>=2020; y--)
      el.innerHTML += `<option value="${y}">${y}年度</option>`;
  });

  // 8. ダッシュボードを初期表示
  NAV.go('dashboard');

  // 9. クラウド設定フォームとバッジを初期化（sidebar + import画面）
  CLOUD.renderForm();

  // 10. ステータス更新
  UI.updateSaveStatus();
  UI.updateTopbar('dashboard');
});
