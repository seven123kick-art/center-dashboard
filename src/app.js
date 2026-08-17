'use strict';

// =====================================
// Version2 Application Entry Point
// =====================================
//
// Responsibility
// 1. Application bootstrap
// 2. Global application state
// 3. Module initialization
// 4. Event registration
// 5. Shared orchestration only
//
// Detailed revision history has been moved to CHANGELOG.txt.
// =====================================

'use strict';

/* 開発用PERFログ制御：通常は非表示。URLに ?debug=1 / ?perf=1、または localStorage.mgmt_debug=1 で表示 */
window.__mgmtPerfLog = window.__mgmtPerfLog || function(){
  try {
    const params = new URLSearchParams(window.location.search || '');
    const enabled = params.get('debug') === '1' || params.get('perf') === '1' || localStorage.getItem('mgmt_debug') === '1' || localStorage.getItem('mgmt_perf') === '1';
    if (enabled) console.log.apply(console, arguments);
  } catch(e) {}
};



/* ════════════════════════════════════════════════════════════════
   01. Bootstrap / Asset Loading
   外部ライブラリの遅延読込（Supabase・XLSX等、実際に使う画面でのみ取得）
   ════════════════════════════════════════════════════════════════ */
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
  },};

/* ════════════════════════════════════════════════════════════════
   02. Configuration / Constants
   会社設定・センター一覧・勘定科目キー等、アプリ全体で共有する定数
   ════════════════════════════════════════════════════════════════ */
/* ════════ §1 CONFIG ════════════════════════════════════════════ */
const CONFIG = {
  SUPABASE_URL:    (window.SUPABASE_CONFIG||{}).url    || '',
  SUPABASE_KEY:    (window.SUPABASE_CONFIG||{}).key    || '',
  SUPABASE_BUCKET: (window.SUPABASE_CONFIG||{}).bucket || 'center-data',

  CENTERS: [
    { id: 'kitasaitama', name: '北埼玉センター', color: '#1a4d7c' },
    { id: 'toda',        name: '戸田センター',   color: '#1a7a52' },
  ],
  COMPANY: 'エスラインギフ　家電物流事業部',
  FISCAL_START: 4,

  INCOME_KEYS: [
    '特積収入','一般収入','家電収入','その他収入','その他収入（産廃）','その他収入（産廃',
    '保管料収入','加工収入','委託収入','保険手数料','車両修繕収入',
    'コンピュータ収入','不動産賃貸収入','バス収入','売電収入','賃貸収入'
  ],
  INCOME_SUB_KEYS: [
    '集荷収入','配達収入','中継収入','リサイクル収入','工事収入'
  ],
  EXPENSE_KEYS: [
    '給与手当','人材派遣料','その他人件費','運行旅費',
    'ガソリン費','軽油費','ガス費','油脂費',
    '車両修繕費','タイヤ費','その他修繕費',
    'リース原価計','車両償却費','その他償却費',
    '自賠責保険料','運送保険料','任意保険料','その他保険料',
    '借地借家料','その他施設費',
    '重量税','自動車税','取得税','その他税',
    '事故費計',
    '路線傭車','路線備車','集配傭車','委託費','社内外注費',
    '中継料計',
    '道路利用料','その他利用料',
    '水道光熱費','備消品費','図書印刷費','通信運搬費','電算関連費',
    '旅費','被服費','会議費','交際費','宣伝広告費','諸手数料','負担金','寄付金',
    '教育求人費','環境衛生費','経営指導料','雑費','業務委託収入','貸倒損失'
  ],
  FIXED_KEYS: [
    '給与手当','人材派遣料','その他人件費',
    '借地借家料','その他施設費',
    '車両償却費','その他償却費',
    '自賠責保険料','運送保険料','任意保険料','その他保険料',
    '重量税','自動車税','取得税','その他税',
    '水道光熱費','電算関連費','経営指導料','図書印刷費','通信運搬費'
  ],
  VARIABLE_KEYS: [
    '路線傭車','路線備車','集配傭車','委託費','社内外注費',
    'ガソリン費','軽油費','ガス費','油脂費',
    '車両修繕費','タイヤ費','その他修繕費',
    '道路利用料','その他利用料',
    '備消品費','旅費','運行旅費','被服費','会議費','交際費','宣伝広告費','諸手数料',
    '負担金','寄付金','教育求人費','環境衛生費','雑費','貸倒損失'
  ],
  LABOR_KEYS:  ['給与手当','人材派遣料','その他人件費'],
  YOSHA_KEYS:  ['路線傭車','路線備車','集配傭車','委託費','社内外注費'],

  PL_DEF: [
    {
      id:'revenue',
      label:'営業収益',
      type:'group',
      keys:['特積収入','一般収入','家電収入','その他収入','その他収入（産廃）','その他収入（産廃','保管料収入','加工収入','委託収入','保険手数料','車両修繕収入','コンピュータ収入','不動産賃貸収入','バス収入','売電収入','賃貸収入'],
      children:[
        {label:'特積収入', keys:['特積収入']},
        {label:'一般収入', keys:['一般収入']},
        {label:'家電収入', keys:['家電収入']},
        {label:'その他収入（産廃）', keys:['その他収入（産廃）','その他収入（産廃','その他収入']},
        {label:'保管料収入', keys:['保管料収入']},
        {label:'加工収入', keys:['加工収入']},
        {label:'委託収入', keys:['委託収入']},
        {label:'保険手数料', keys:['保険手数料']},
        {label:'車両修繕収入', keys:['車両修繕収入']},
        {label:'コンピュータ収入', keys:['コンピュータ収入']},
        {label:'不動産賃貸収入', keys:['不動産賃貸収入']},
        {label:'バス収入', keys:['バス収入']},
        {label:'売電収入', keys:['売電収入']},
        {label:'賃貸収入', keys:['賃貸収入']}
      ]
    },
    {
      id:'labor',
      label:'人件費',
      type:'group',
      keys:['給与手当','人材派遣料','その他人件費','運行旅費'],
      children:[
        {label:'給与手当', keys:['給与手当']},
        {label:'人材派遣料', keys:['人材派遣料']},
        {label:'その他人件費', keys:['その他人件費']},
        {label:'運行旅費', keys:['運行旅費']}
      ]
    },
    {
      id:'fuel',
      label:'燃料費',
      type:'group',
      keys:['ガソリン費','軽油費','ガス費','油脂費'],
      children:[
        {label:'ガソリン費', keys:['ガソリン費']},
        {label:'軽油費', keys:['軽油費']},
        {label:'ガス費', keys:['ガス費']},
        {label:'油脂費', keys:['油脂費']}
      ]
    },
    {
      id:'repair',
      label:'修繕費',
      type:'group',
      keys:['車両修繕費','タイヤ費','その他修繕費'],
      children:[
        {label:'車両修繕費', keys:['車両修繕費']},
        {label:'タイヤ費', keys:['タイヤ費']},
        {label:'その他修繕費', keys:['その他修繕費']}
      ]
    },
    {
      id:'lease',
      label:'リース原価',
      type:'group',
      keys:['リース原価計'],
      children:[
        {label:'リース原価計', keys:['リース原価計']}
      ]
    },
    {
      id:'depreciation',
      label:'減価償却費',
      type:'group',
      keys:['車両償却費','その他償却費'],
      children:[
        {label:'車両償却費', keys:['車両償却費']},
        {label:'その他償却費', keys:['その他償却費']}
      ]
    },
    {
      id:'insurance',
      label:'保険料',
      type:'group',
      keys:['自賠責保険料','運送保険料','任意保険料','その他保険料'],
      children:[
        {label:'自賠責保険料', keys:['自賠責保険料']},
        {label:'運送保険料', keys:['運送保険料']},
        {label:'任意保険料', keys:['任意保険料']},
        {label:'その他保険料', keys:['その他保険料']}
      ]
    },
    {
      id:'facility',
      label:'施設費',
      type:'group',
      keys:['借地借家料','その他施設費'],
      children:[
        {label:'借地借家料', keys:['借地借家料']},
        {label:'その他施設費', keys:['その他施設費']}
      ]
    },
    {
      id:'tax',
      label:'租税公課',
      type:'group',
      keys:['重量税','自動車税','取得税','その他税'],
      children:[
        {label:'重量税', keys:['重量税']},
        {label:'自動車税', keys:['自動車税']},
        {label:'取得税', keys:['取得税']},
        {label:'その他税', keys:['その他税']}
      ]
    },
    {
      id:'accident',
      label:'事故費',
      type:'group',
      keys:['事故費計'],
      children:[
        {label:'事故費計', keys:['事故費計']}
      ]
    },
    {
      id:'yosha',
      label:'傭車費',
      type:'group',
      keys:['路線傭車','路線備車','集配傭車','委託費','社内外注費'],
      children:[
        {label:'路線傭車', keys:['路線傭車','路線備車']},
        {label:'集配傭車', keys:['集配傭車']},
        {label:'委託費', keys:['委託費']},
        {label:'社内外注費', keys:['社内外注費']}
      ]
    },
    {
      id:'relay',
      label:'中継料',
      type:'group',
      keys:['中継料計'],
      children:[
        {label:'中継料計', keys:['中継料計']}
      ]
    },
    {
      id:'road',
      label:'道路費',
      type:'group',
      keys:['道路利用料','その他利用料'],
      children:[
        {label:'道路利用料', keys:['道路利用料']},
        {label:'その他利用料', keys:['その他利用料']}
      ]
    },
    {
      id:'sales_cost',
      label:'営業費',
      type:'group',
      keys:['水道光熱費','備消品費','図書印刷費','通信運搬費','電算関連費'],
      children:[
        {label:'水道光熱費', keys:['水道光熱費']},
        {label:'備消品費', keys:['備消品費']},
        {label:'図書印刷費', keys:['図書印刷費']},
        {label:'通信運搬費', keys:['通信運搬費']},
        {label:'電算関連費', keys:['電算関連費']}
      ]
    },
    {
      id:'other_cost',
      label:'その他費用',
      type:'group',
      keys:['旅費','被服費','会議費','交際費','宣伝広告費','諸手数料','負担金','寄付金','教育求人費','環境衛生費','経営指導料','雑費','業務委託収入','貸倒損失'],
      children:[
        {label:'旅費', keys:['旅費']},
        {label:'被服費', keys:['被服費']},
        {label:'会議費', keys:['会議費']},
        {label:'交際費', keys:['交際費']},
        {label:'宣伝広告費', keys:['宣伝広告費']},
        {label:'諸手数料', keys:['諸手数料']},
        {label:'負担金', keys:['負担金']},
        {label:'寄付金', keys:['寄付金']},
        {label:'教育求人費', keys:['教育求人費']},
        {label:'環境衛生費', keys:['環境衛生費']},
        {label:'経営指導料', keys:['経営指導料']},
        {label:'雑費', keys:['雑費']},
        {label:'業務委託収入', keys:['業務委託収入']},
        {label:'貸倒損失', keys:['貸倒損失']}
      ]
    },
    { id:'cost_total', label:'売上原価', type:'total-cost' },
    { id:'gross_profit', label:'粗利益', type:'gross-profit' }
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

  COLORS: ['#79B99A','#E58FA9','#9B8AD3','#E5C65D','#79B9D0','#D89B6C','#75BDB4','#C58DB8','#A6C27D','#E3A076'],
  VIEW_TITLES: {
    dashboard:'ホーム', pl:'月次収支表', 'profit-structure':'経営分析', 'landing-forecast':'着地予測', trend:'売上推移',
    shipper:'荷主分析', indicators:'経営指標', annual:'年次サマリー',
    alerts:'アラート', memo:'メモ・コメント', report:'会議報告書',
    library:'過去資料', field:'作業者・エリア分析',
    'field-worker':'作業者分析', 'route-analysis':'配送分析', 'field-content':'作業内容分析', 'field-product':'商品カテゴリ分析', 'field-area':'エリア分析',
    capacity:'キャパ分析', 'data-verification':'データ確認', import:'補助取込・設定', 'csv-import':'データ取込', 'worker-master':'マスタ管理',
    kamoku:'収支科目 詳細分析', report:'会議報告書', 'budget-actual':'予実差異分析',
  },
};

/* ════════ §2 CENTER（URLから確定・不変） ════════════════════════ */
const CENTER = (() => {
  const p = new URLSearchParams(location.search);
  const id = (p.get('c') || p.get('center') || 'kitasaitama').toLowerCase();
  return CONFIG.CENTERS.find(c => c.id === id) || CONFIG.CENTERS[0];
})();
window.CENTER = CENTER; // CENTERはconst宣言のためwindowへ自動的に紐付かない。
                        // field_worker.js等がwindow.CENTERを参照する箇所が
                        // 正しく動作するために必要な、参照渡しの別名付け
                        // （window.STATE修正と同一パターン）。

/* ════════════════════════════════════════════════════════════════
   03. Global State
   アプリ全体で共有するランタイム状態、および状態保存前の
   個人情報サニタイズ・削除済みデータの復活防止ロジック
   ════════════════════════════════════════════════════════════════ */
/* ════════ §3 STATE（ランタイム状態） ═══════════════════════════ */
const STATE = {
  datasets:  [],    // [{ym,type,rows,totalIncome,totalExpense,profit,...}]
  workerCsvData: [], // 現場明細CSV（作業者CSV）月単位データ
  productAddressData: [], // 現場明細CSV（商品住所CSV）月単位データ
  routeData: [], // 配達持出PDFから抽出した便情報 [{ym,routes:[{date,headNumber,worker,slips}]}]
  companyMaster: [], // 会社マスタ [{companyCode,companyName,operationType,active}]
  workerMaster: [], // 作業者マスタ [{workerCode,workerName,companyCode,analysisTarget,validFrom,validTo}]
  dailyRecords: [], // 日別実績CSV（着地予測用） [{date,ym,revenue,labor,yosha,other,profit}]
  fieldData: [],    // [{ym,areas:{name:{count,shippers:{}}}}]
  areaData:  [],    // 旧データ互換用（現在は旧帳票関連では使用しない）
  capacity:  null,  // {areas:{name:{max}},updatedAt}
  planData:  {},    // 年度別計画データ { "2026": { rows, importedAt, itemCount } }
  fiscalYear: null, // 現在操作中の年度
  memos:     {},    // {ym: {text,savedAt}}
  library:   [],    // 過去資料
  reportKnowledge: { policies:{}, references:[] }, // 会議報告書用：年度半期方針・参考資料メモ
  deleted: { datasets:{}, planFiscalYears:{}, historyFiscalYears:{}, historyMonths:{}, workerMonths:{}, productMonths:{}, fieldMonths:{} }, // 削除済み復活防止用
  view:      'dashboard',
  selYM:     null,  // 現在選択中のYM
  shipperMode: 'group',
  _charts:   {},    // {id: ChartInstance}
};
window.STATE = STATE; // STATEはconst宣言のためwindowへ自動的に紐付かない。
                      // Repository層（window.STATEを参照する設計）および
                      // field_core.js/field_area.js/field_content.js/
                      // field_product.js（同様にwindow.STATEを参照）が
                      // 正しく動作するために必要な、参照渡しの別名付け。
                      // オブジェクトのコピーではなく、STATEとwindow.STATEは
                      // 常に同一のオブジェクトを指す。



/* ════════ 個人情報サニタイズ（顧客情報を保存しない） ════════════════
   方針：顧客氏名・住所全文（番地/建物含む）・電話番号・CSV生行(raw/row/firstRow/representativeRow等)は保存しない。
   分析に必要な郵便番号・都道府県・市区町村/区・荷主区分・商品/作業/金額だけを保持する。
*/
function sanitizeProductTicketForStorage(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const safe = {};
  const copy = (from, to=from) => {
    if (t[from] !== undefined && t[from] !== null && t[from] !== '') safe[to] = t[from];
  };

  ['slip','slipNo','ticketNo','invoiceNo','date','deliveryDate','workDate','ym','zip','zipcode','postalCode','pref','city','ward','area','areaUnit','product','productName','category','sizeBucket','amount','salesAmount','totalAmount','value','price','rowCount','hasMultipleZip','hasMultipleAddress','shipperCode','clientCode','customerCode','shipperName','shipper','clientName','customerName','shipperGroup'].forEach(k => copy(k));

  // 互換名を安全項目へ寄せる
  if (!safe.slip) safe.slip = t['原票番号'] || t['エスライン原票番号'] || '';
  if (!safe.zip) safe.zip = t['郵便番号'] || t['お届け先郵便番号'] || t['届け先郵便番号'] || '';
  if (!safe.shipperCode) safe.shipperCode = t['荷主コード'] || t['荷主基本コード'] || t['荷主ＣＤ'] || t['荷主CD'] || '';
  if (!safe.shipperName) safe.shipperName = t['荷主名'] || t['荷主名称'] || t['契約名'] || t['契約名称'] || '';

  if (t.works && typeof t.works === 'object' && !Array.isArray(t.works)) safe.works = { ...t.works };
  if (Array.isArray(t.workDetails)) {
    safe.workDetails = t.workDetails.map(d => ({
      work: d && typeof d === 'object' ? (d.work || d.label || d.name || '') : '',
      amount: d && typeof d === 'object' ? (Number(d.amount || d.value || 0) || 0) : 0
    })).filter(d => d.work || d.amount);
  }

  // 住所全文・氏名・電話・生行は意図的にコピーしない
  delete safe.address; delete safe.addr; delete safe.destinationAddress;
  delete safe.name; delete safe.customerNamePersonal; delete safe.phone; delete safe.tel;
  delete safe.raw; delete safe.row; delete safe.rows; delete safe.firstRow; delete safe.representativeRow; delete safe.rawRows;
  return safe;
}

function sanitizeProductRecordForStorage(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return rec;
  const out = { ...rec };
  out.tickets = Array.isArray(rec.tickets) ? rec.tickets.map(sanitizeProductTicketForStorage).filter(Boolean) : [];
  delete out.rows; delete out.data; delete out.rawRows; delete out.items;
  // 住所そのものを数えた情報は不要。市区町村/郵便番号件数だけ残す。
  out.addressCount = 0;
  out.uniqueCount = out.tickets.length || out.uniqueCount || 0;
  out.zipCount = out.tickets.filter(t => t.zip || t.zipcode || t.postalCode).length;
  return out;
}

function sanitizePersonalDataState(state = STATE) {
  if (!state || typeof state !== 'object') return state;
  if (Array.isArray(state.productAddressData)) {
    state.productAddressData = state.productAddressData.map(sanitizeProductRecordForStorage);
  }
  if (Array.isArray(state.fieldData)) {
    state.fieldData = state.fieldData.map(r => {
      if (r && typeof r === 'object' && Array.isArray(r.tickets)) return sanitizeProductRecordForStorage(r);
      return r;
    });
  }
  if (Array.isArray(state.areaData)) {
    state.areaData = state.areaData.map(r => {
      if (r && typeof r === 'object' && Array.isArray(r.tickets)) return sanitizeProductRecordForStorage(r);
      return r;
    });
  }
  return state;
}

function sanitizedCloneForExport(obj) {
  try {
    const cloned = JSON.parse(JSON.stringify(obj || {}));
    return sanitizePersonalDataState(cloned);
  } catch(e) {
    return obj;
  }
}


/* ════════ 削除済み復活防止（クラウド再取得対策） ════════════════
   ローカルで削除した後に Supabase の古い full_state / plan / field / skdl から戻らないよう、
   「削除済みマーカー」を保持して、同期・マージ時に必ず削除を優先する。
*/
function normalizeDeletedState(raw) {
  const base = { datasets:{}, planFiscalYears:{}, historyFiscalYears:{}, historyMonths:{}, workerMonths:{}, productMonths:{}, fieldMonths:{} };
  if (!raw || typeof raw !== 'object') return base;
  Object.keys(base).forEach(k => {
    if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) base[k] = { ...raw[k] };
  });
  return base;
}
function ensureDeletedState() {
  STATE.deleted = normalizeDeletedState(STATE.deleted);
  return STATE.deleted;
}
function dataDeleteKey(ym, type='confirmed') {
  return `${String(ym || '')}_${String(type || 'confirmed')}`;
}
function markDataDeleted(kind, key) {
  const d = ensureDeletedState();
  if (!d[kind]) d[kind] = {};
  d[kind][String(key)] = new Date().toISOString();
  return d[kind][String(key)];
}
function clearDataDeleted(kind, key) {
  const d = ensureDeletedState();
  if (d[kind]) delete d[kind][String(key)];
}
function mergeDeletedStates(a, b) {
  const out = normalizeDeletedState(a);
  const bb = normalizeDeletedState(b);
  Object.keys(out).forEach(kind => {
    out[kind] = { ...(out[kind] || {}) };
    Object.entries(bb[kind] || {}).forEach(([key, ts]) => {
      if (!out[kind][key] || String(ts || '') > String(out[kind][key] || '')) out[kind][key] = ts;
    });
  });
  return out;
}
function deletedAt(kind, key) {
  const d = ensureDeletedState();
  return d[kind] ? d[kind][String(key)] : null;
}
function isDeletedSince(kind, key, itemTime) {
  const del = deletedAt(kind, key);
  if (!del) return false;
  if (!itemTime) return true;
  return String(del) >= String(itemTime);
}
function applyDeletionTombstonesToState(target = STATE) {
  const d = normalizeDeletedState(target.deleted || STATE.deleted);

  if (Array.isArray(target.datasets)) {
    target.datasets = target.datasets.filter(ds => {
      if (!ds || !ds.ym) return false;
      const source = ds.source || 'csv';
      const time = ds.importedAt || ds.updatedAt || ds.savedAt || '';
      if (source === 'history') {
        const fy = String(ds.fiscalYear || fiscalYearFromYM(ds.ym));
        if (d.historyFiscalYears[fy]) return false;
        if (d.historyMonths[ds.ym]) return false;
      } else {
        const key = dataDeleteKey(ds.ym, ds.type || 'confirmed');
        if (isDeletedSince('datasets', key, time)) return false;
      }
      return true;
    });
  }

  if (target.planData && typeof target.planData === 'object') {
    Object.keys(d.planFiscalYears || {}).forEach(fy => { if (target.planData) delete target.planData[fy]; });
  }

  if (Array.isArray(target.workerCsvData)) {
    target.workerCsvData = target.workerCsvData.filter(r => r && r.ym && !d.workerMonths[r.ym] && !d.fieldMonths[r.ym]);
  }
  if (Array.isArray(target.productAddressData)) {
    target.productAddressData = target.productAddressData.filter(r => r && r.ym && !d.productMonths[r.ym] && !d.fieldMonths[r.ym]);
  }
  if (Array.isArray(target.fieldData)) {
    target.fieldData = target.fieldData.filter(r => r && r.ym && !d.fieldMonths[r.ym] && !d.workerMonths[r.ym] && !d.productMonths[r.ym]);
  }
  if (Array.isArray(target.areaData)) {
    target.areaData = target.areaData.filter(r => r && r.ym && !d.fieldMonths[r.ym] && !d.workerMonths[r.ym] && !d.productMonths[r.ym]);
  }

  target.deleted = d;
  return target;
}
window.markDataDeleted = markDataDeleted;
window.clearDataDeleted = clearDataDeleted;
window.applyDeletionTombstonesToState = applyDeletionTombstonesToState;

/* ════════════════════════════════════════════════════════════════
   04. Storage / Persistence（core/store.js に分離済み）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §4 STORE は core/store.js へ分離 ════════ */

/* ════════════════════════════════════════════════════════════════
   05. CSV Import Pipeline
   CSV解析 → データセット変換 → 取込UI → 年月選択モーダル
   （§5 CSV / §6 PROCESS / §7 IMPORT / §8 MODAL）
   ════════════════════════════════════════════════════════════════ */
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
  // CSVの金額は「円」で取り込む。計上日・コード・荷主コードなどを金額として拾わない。
  parseSKDL(text, monthCol) {
    const rows = this.toRows(text);
    const ALL = new Set([...CONFIG.INCOME_KEYS,...CONFIG.EXPENSE_KEYS,...CONFIG.INCOME_SUB_KEYS]);
    const result = {};
    let found = 0;

    if (!rows.length) return null;

    // ヘッダーがあるCSVなら「収支科目名」「金額」を優先して読む
    const header = rows[0].map(v => String(v || '').replace(/[\s　\u3000]/g,''));
    const labelCol = header.findIndex(v => v === '収支科目名' || v === '経費計上先収支科目名');
    const amountCol = header.findIndex(v => v === '金額');

    function toNumber(v) {
      const s = String(v ?? '').replace(/,/g,'').replace(/[円千]/g,'').replace(/[^\d.\-]/g,'');
      if (!s || s === '-' || s === '.') return null;
      const num = parseFloat(s);
      return isNaN(num) ? null : num;
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.length) continue;

      let label = null;
      let labelIndex = -1;

      // 1) ヘッダー位置で科目名を読む
      if (labelCol >= 0) {
        const v = String(row[labelCol] || '').replace(/[\s　\u3000]/g,'');
        if (ALL.has(v)) {
          label = v;
          labelIndex = labelCol;
        }
      }

      // 2) ヘッダーがない場合は、行内から科目名を探す
      if (!label) {
        for (let i = 0; i < row.length; i++) {
          const v = String(row[i] || '').replace(/[\s　\u3000]/g,'');
          if (ALL.has(v)) {
            label = v;
            labelIndex = i;
            break;
          }
        }
      }

      if (!label) continue;

      let val = null;

      // 3) ヘッダー位置の「金額」を最優先
      if (amountCol >= 0) {
        val = toNumber(row[amountCol]);
      }

      // 4) 計画表のような月列指定がある場合だけ、指定列を使う
      if (val === null && monthCol != null && row[monthCol] !== undefined) {
        val = toNumber(row[monthCol]);
      }

      // 5) 最後の保険：科目名より右側の数値だけを見る
      //    日付・会社コード・科目コードなど、科目名より左の数字は金額として使わない
      if (val === null) {
        for (let i = labelIndex + 1; i < row.length; i++) {
          const num = toNumber(row[i]);
          if (num !== null) {
            val = num;
            break;
          }
        }
      }

      if (val !== null) {
        result[label] = (result[label] || 0) + val;
        found++;
      }
    }

    return found > 0 ? result : null;
  },

  // SKDL0001から便単位の傭車支払明細を抽出する。
  // 顧客情報は保持せず、ヘッド番号・計上日・科目・金額・傭車コードのみ保存する。
  parseRoutePayments(text) {
    const rows = this.toRows(text);
    if (!rows.length) return [];
    const header = rows[0].map(v => String(v || '').replace(/[\s　\u3000]/g,''));
    const idx = name => header.findIndex(v => v === name);
    const cDate=idx('計上日'), cCode=idx('収支科目コード'), cName=idx('収支科目名'), cAmount=idx('金額');
    const cHead=idx('ヘッド番号'), cYosha=idx('傭車コード'), cPartner=idx('取引先');
    if (cHead < 0 || cAmount < 0) return [];
    const out=[];
    for (let i=1;i<rows.length;i++) {
      const r=rows[i];
      const head=String(r[cHead] || '').replace(/\D/g,'');
      if (!head) continue;
      const code=String(r[cCode] || '').replace(/\D/g,'');
      const name=String(r[cName] || '').trim();
      if (!(code === '120901' || code === '120902' || /路線傭車|集配傭車/.test(name))) continue;
      const amount=Number(String(r[cAmount] || '').replace(/,/g,'').replace(/[^\d.-]/g,'')) || 0;
      const rawDate=String(r[cDate] || '').replace(/\D/g,'');
      const date=rawDate.length >= 8 ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : '';
      out.push({ headNumber:head, date, accountCode:code, accountName:name, amount, yoshaCode:String(r[cYosha] || '').trim(), partner:String(r[cPartner] || '').trim() });
    }
    return out;
  },

  // 計画データ（貼り付けテキスト）解析
  // 前提：科目名 + 年間合計 + 4月〜9月 + 上期計 + 10月〜3月 + 下期計
  // 単位：千円。保存時に円変換しない。
  // 重要：数値内カンマ（17,356）を列区切りとして扱わないため、CSVではなくタブ区切りとして読む。
  parsePlan(text) {
    const plan = {};

    function splitPlanLine(line) {
      const clean = String(line || '').replace(/\r/g, '').trim();
      if (!clean) return [];

      // Excel貼付は原則タブ区切り。数値内のカンマは絶対に区切りにしない。
      if (clean.includes('\t')) {
        return clean.split('\t').map(v => String(v || '').trim());
      }

      // 保険：タブが消えた場合のみ、連続スペースで分割する。
      // 単一スペースで分割すると科目名が壊れる可能性があるため使わない。
      return clean.split(/\s{2,}/).map(v => String(v || '').trim());
    }

    function toNum(v) {
      const s = String(v ?? '')
        .replace(/,/g,'')
        .replace(/[千円]/g,'')
        .replace(/[^\d.\-]/g,'');
      if (!s || s === '-' || s === '.') return null;
      const num = parseFloat(s);
      return isNaN(num) ? null : num;
    }

    const rows = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(splitPlanLine)
      .filter(row => row.length >= 2 && String(row[0] || '').trim());

    for (const row of rows) {
      const label = normalizePlanLabel(row[0]);
      if (!label) continue;

      const vals = {};
      for (const mm of ['04','05','06','07','08','09','10','11','12','01','02','03']) {
        const col = planMonthCol(mm);
        const v = toNum(row[col]);
        if (v != null) vals[mm] = v;
      }

      if (Object.keys(vals).length > 0) {
        // 同じ科目名が複数回出る場合がある（例：その他収入）。
        // 後ろにある営業外収入側のゼロ行で、先に出た営業収益側の値を上書きしない。
        if (plan[label]) {
          const oldVals = plan[label];
          const oldTotal = Object.values(oldVals).reduce((a,b)=>a+n(b),0);
          const newTotal = Object.values(vals).reduce((a,b)=>a+n(b),0);
          if (oldTotal === 0 && newTotal !== 0) {
            plan[label] = vals;
          } else if (oldTotal !== 0 && newTotal !== 0) {
            // 両方に値がある場合は、原則として先に出た行を優先する。
          }
        } else {
          plan[label] = vals;
        }
      }
    }
    return Object.keys(plan).length > 0 ? plan : null;
  },

  /* ════════ Hook API（Version4 Phase5-3：受け皿のみ、既存parseSKDL()等は無変更）
     Version3のNAV.onAfterGo / CLOUD.onAfterApplyFullStateと同じ設計思想。
     今回はまだ誰もこのHookへ登録しない。既存のモンキーパッチ
     （shipper.js / field_core.jsによるCSV.parseSKDLの書き換え）も
     今回は削除しない。 ════════ */
  _afterParseHooks: [],
  onAfterParse(fn) {
    if (typeof fn === 'function') this._afterParseHooks.push(fn);
  },
};

/* ════════ §6 PROCESS（CSV生データ→データセット） ══════════════ */
function n(v) { return typeof v==='number' ? v : (parseFloat(v)||0); }

function processDataset(ym, type, rows) {
  const totalIncome  = CONFIG.INCOME_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const totalExpense = CONFIG.EXPENSE_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const profit = totalIncome - totalExpense;

  // みなし人件費率：委託取引を分子・分母の双方から除外する。
  // 分子 = 人件費 + 傭車費（委託費を除く）
  // 分母 = 営業収益 - 委託収入
  const employeeLaborCost = CONFIG.LABOR_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const subcontractTransportCost = CONFIG.YOSHA_KEYS
    .filter(k => k !== '委託費')
    .reduce((s,k)=>s+n(rows[k]),0);
  const excludedConsignmentExpense = n(rows['委託費']);
  const excludedConsignmentIncome = n(rows['委託収入']);
  const laborCost = employeeLaborCost + subcontractTransportCost;
  const pseudoLaborIncome = Math.max(0, totalIncome - excludedConsignmentIncome);
  const fixedCost = CONFIG.FIXED_KEYS.reduce((s,k)=>s+n(rows[k]),0);
  const varCost   = CONFIG.VARIABLE_KEYS.reduce((s,k)=>s+n(rows[k]),0);

  const pseudoLaborRate = pseudoLaborIncome > 0 ? laborCost/pseudoLaborIncome*100 : 0;
  const variableRate    = totalIncome > 0 ? varCost/totalIncome*100   : 0;
  const fixedRate       = totalIncome > 0 ? fixedCost/totalIncome*100 : 0;
  const profitRate      = totalIncome > 0 ? profit/totalIncome*100    : 0;

  return { ym, type, rows, totalIncome, totalExpense, profit,
    pseudoLaborRate, variableRate, fixedRate, profitRate,
    laborCost, employeeLaborCost, subcontractTransportCost, pseudoLaborIncome, excludedConsignmentExpense, excludedConsignmentIncome, fixedCost, varCost, importedAt: new Date().toISOString() };
}

/* ════════ Hook API（Version4 Phase5-3：受け皿のみ、既存processDataset()は無変更）
   Version3のNAV.onAfterGo / CLOUD.onAfterApplyFullStateと同じ設計思想。
   今回はまだ誰もこのHookへ登録しない。既存のモンキーパッチ
   （shipper.js / field_core.jsによるprocessDatasetの書き換え）も
   今回は削除しない。window.DATASETは今回新設する名前空間であり、
   既存のwindow.DATASET_REPOSITORY（Repository層）とは別物である。 ════════ */
window.DATASET = {
  _afterProcessHooks: [],
  onAfterProcess(fn) {
    if (typeof fn === 'function') this._afterProcessHooks.push(fn);
  },
};

function upsertDataset(ds) {
  // 同じ年月でも「速報値」と「確定値」は別データとして保持する
  // ただし同じ年月＋同じ区分は入替（上書き）する
  const type = ds.type || 'confirmed';
  ds.type = type;

  const sourceKey = ds.source === 'history' ? 'history' : 'csv';
  const idx = STATE.datasets.findIndex(d => d.ym === ds.ym && (d.type || 'confirmed') === type && ((d.source === 'history' ? 'history' : 'csv') === sourceKey));
  if (idx >= 0) {
    STATE.datasets[idx] = ds;
  } else {
    STATE.datasets.push(ds);
  }

  STATE.datasets.sort((a,b) => {
    const y = a.ym.localeCompare(b.ym);
    if (y !== 0) return y;
    // 同じ月は速報→確定の順で並べる
    const at = (a.type || 'confirmed') === 'daily' ? 0 : 1;
    const bt = (b.type || 'confirmed') === 'daily' ? 0 : 1;
    return at - bt;
  });
}

// 確定CSVが入った月は、速報（daily）を残さず削除する。
// 「確定が優先」ではなく「確定が入った時点で速報自体を消す」という運用要望に合わせる。
async function supersedeDailyWithConfirmed(ym, opt={}) {
  const daily = STATE.datasets.find(d => d.ym === ym && (d.type || 'confirmed') === 'daily' && d.source !== 'history');
  if (!daily) return false;
  if (typeof markDataDeleted === 'function') markDataDeleted('datasets', dataDeleteKey(ym, 'daily'));
  STATE.datasets = STATE.datasets.filter(d => !(d.ym === ym && (d.type || 'confirmed') === 'daily' && d.source !== 'history'));
  if (opt.deferCloudDelete) {
    // 一括取込中だけの動作：STATE側の変更（tombstone記録＋datasets配列からの
    // 除外）はここで即座に行うが、Cloudへの不可逆な削除（IDB_CACHE.remove／
    // CLOUD_REPOSITORY.deleteFile）は呼出元（bulk_import.js）が全グループの
    // 成功を確認するまで実行しない。新しい削除方式は作らず、既存のCloud削除
    // 呼出しを後から同じ形で呼び出せるよう、実行のタイミングだけを分離した。
    return { deferred: true, ym };
  }
  await finalizeSupersedeDailyCloudDelete(ym);
  return true;
}
window.supersedeDailyWithConfirmed = supersedeDailyWithConfirmed;

async function finalizeSupersedeDailyCloudDelete(ym, opt={}) {
  const errors = [];
  try { if (window.IDB_CACHE?.remove) await IDB_CACHE.remove('dataset', `${ym}_daily`); } catch(e) { errors.push(e); }
  try { if (window.CLOUD?.deleteFile) await CLOUD_REPOSITORY.deleteFile(CLOUD.datasetKey(ym, 'daily')); } catch(e) { errors.push(e); }
  // opt.throwOnErrorは一括取込側だけが使用する。個別通常取込
  // （supersedeDailyWithConfirmedのデフォルト呼出）はoptを渡さないため、
  // 従来通りエラーを握りつぶすだけの挙動を維持する。
  if (opt.throwOnError && errors.length) {
    throw new Error(errors.map(e => e.message || String(e)).join('; '));
  }
  return { ok: errors.length === 0, errors };
}
window.finalizeSupersedeDailyCloudDelete = finalizeSupersedeDailyCloudDelete;

/* ════════ §7 IMPORT ════════════════════════════════════════════ */
const IMPORT = {
  _pending: [],
  _replaceYM: null,
  _replaceType: null,

  handleFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const MSG='upload-msg', ZONE='upload-zone';
    window.IMPORT_FEEDBACK?.notifyReceived(MSG, ZONE, arr.length===1?arr[0].name:`${arr.length}件のファイル`);

    const csv  = arr.filter(f=>/\.csv$/i.test(f.name));
    const xlsx = arr.filter(f=>/\.(xlsx|xls)$/i.test(f.name));
    // この取込欄はCSV（収支）とXLSX（キャパ）の両方を正式に受け付ける複合入口。
    // どちらの拡張子にも該当しないファイルが1件でも含まれていれば、
    // 正常なファイルだけを抽出して続行せず、全体を中止する。
    const invalidExt = arr.filter(f=>!/\.(csv|xlsx|xls)$/i.test(f.name));
    if (invalidExt.length) {
      window.IMPORT_FEEDBACK?.notifyError(MSG, ZONE, `この取込欄ではCSVまたはExcel（xls/xlsx）ファイルのみ使用できます。登録は行っていません。不正ファイル：${invalidExt.map(f=>f.name).join('、')}`);
      return;
    }
    // CSV（収支）とXLSX（キャパ）は同時に取り込めない。どちらも単独では
    // 正しい形式だが、混在した場合はどちらを優先すべきか一意に決まらず、
    // 従来はCSV側が優先されXLSX側が黙って無視されていたため、明示的に拒否する。
    if (csv.length && xlsx.length) {
      window.IMPORT_FEEDBACK?.notifyError(MSG, ZONE, `CSVとExcelを同時に取り込むことはできません。種類ごとに分けて取り込んでください。登録は行っていません。`);
      return;
    }

    // 入替モード：年月選択モーダルを出さず、指定済みYMへ直接差替
    if (csv.length && this._replaceYM) {
      const ym = this._replaceYM;
      const type = this._replaceType || 'confirmed';
      this._replaceYM = null;
      this._replaceType = null;
      // 入替時は元の区分を維持する
      document.querySelectorAll('input[name="manual-import-type"]').forEach(r => { r.checked = (r.value === type); });
      this.processCSV(csv, ym, { replace:true }).catch(e=>{ UI.toast(e.message,'error'); window.IMPORT_FEEDBACK?.notifyError(MSG, ZONE, e.message); });
      return;
    }

    if (csv.length)  { this._pending = csv; MODAL.openYM(csv); return; }
    if (xlsx.length) { this.importCapacityExcel(xlsx[0]).catch(e=>{ UI.toast(e.message,'error'); window.IMPORT_FEEDBACK?.notifyError(MSG, ZONE, e.message); }); return; }
    UI.toast('対応形式：CSV（収支・現場明細）・XLSX（キャパ）','warn');
  },

  async processCSV(files, ym, opt={}) {
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    const selectedType = document.querySelector('input[name="manual-import-type"]:checked')?.value;
    const importType = selectedType === 'daily' ? 'daily' : 'confirmed';
    const existing = STATE.datasets.find(d => d.ym === ym && (d.type || 'confirmed') === importType && d.source !== 'history');

    if (existing && !opt.replace) {
      const label = `${ymLabel(ym)}（${importType==='confirmed'?'確定':'日報'} / ${existing.fileName || 'ファイル名なし'}）`;
      const ok = confirm(`${label} は既に登録されています。\n\n新しいCSVで入れ替えますか？`);
      if (!ok) {
        UI.toast('取込を中止しました', 'warn');
        return;
      }
    }

    let imported = 0;
    const strictFailures = [];
    const normalizedAccountingRecords = [];
    const normalizedAccountingFiles = [];
    for (const f of files) {
      try {
        const text = await CSV.read(f);
        const rows = CSV.parseSKDL(text, monthCol);
        if (!rows) {
          if (opt.strict) { strictFailures.push(`${f.name}: データ行が見つかりません`); continue; }
          UI.toast(`${f.name}: データ行が見つかりません`,'warn'); continue;
        }
        const type = importType;
        const ds = processDataset(ym, type, rows);
        ds.routePayments = CSV.parseRoutePayments(text);
        ds.source = 'csv';
        ds.fileName = f.name;
        ds.fiscalYear = fiscalYearFromYM(ym);
        ds.unit = '円';
        ds.replacedAt = existing ? new Date().toISOString() : null;
        // 新Data CatalogのPL_ACTUALはSKDL0002/0003のみ。現行UIのdailyはSKDL0001（日報）なので正規化対象にしない。
        if(type==='confirmed' && window.ACCOUNTING_IMPORT_BRIDGE?.normalizeCsvText){
          try{ normalizedAccountingRecords.push(...ACCOUNTING_IMPORT_BRIDGE.normalizeCsvText(text,{period:ym,document_state:'CONFIRMED',file_name:f.name})); normalizedAccountingFiles.push(f.name); }
          catch(e){ console.warn('[D3-8] PL_ACTUAL normalize skipped',f.name,e); }
        }

        // 差替時は同じ年月＋同じ区分だけ削除してから入れる（速報と確定は両方保持）
        STATE.datasets = STATE.datasets.filter(d => !(d.ym === ym && (d.type || 'confirmed') === type && d.source !== 'history'));
        upsertDataset(ds);
        imported++;
      } catch(e) {
        if (opt.strict) { strictFailures.push(`${f.name}: ${e.message}`); continue; }
        UI.toast(`${f.name}: ${e.message}`,'error');
      }
    }

    /* ---------- bulk_import.js専用のstrictモード（今回追加） ----------
       通常の個別取込（opt.strict省略時）は、1ファイルの失敗を警告表示
       するだけで処理を続け、imported>0であれば「一部成功」として
       扱う従来の挙動を完全に維持している（このifブロック自体、
       strict時にしか実行されない）。
       strict時は、1ファイルでも失敗があれば、あるいはimported件数が
       選択ファイル数と一致しなければ、この関数はSTATEへの変更を
       行った可能性があっても例外を投げる。呼出元（bulk_import.js）
       は、この例外をcatchしてPhase2ロールバック（STATEスナップショット
       復元）を実行するため、「一部成功をそのまま成功として扱う」
       ことはない。 */
    if (opt.strict && (strictFailures.length || imported === 0 || imported !== files.length)) {
      throw new Error(strictFailures.length ? strictFailures.join('; ') : `${ymLabel(ym)}：登録可能なデータが1件もありませんでした`);
    }

    if (imported > 0) {
      Repository.Storage.save();
      if(importType==='confirmed' && normalizedAccountingRecords.length && window.ACCOUNTING_IMPORT_BRIDGE?.persistRecords){
        try{ const nr=await ACCOUNTING_IMPORT_BRIDGE.persistRecords(normalizedAccountingRecords,{period:ym,document_state:'CONFIRMED',source_file_names:normalizedAccountingFiles}); if(!nr?.ok) console.warn('[D3-8] PL_ACTUAL normalized save not confirmed',nr); }
        catch(e){ console.warn('[D3-8] PL_ACTUAL normalized save failed',e); }
      }
      // 確定CSVが入った月は速報を残さず削除する
      if (importType === 'confirmed') {
        try { await supersedeDailyWithConfirmed(ym, opt.strict ? { deferCloudDelete: true } : {}); Repository.Storage.save(); } catch(e) { console.warn('[D4-16] confirmed supersede cleanup failed', ym, e); if(!opt.strict) UI.toast(`${ymLabel(ym)}：確定データは保存しましたが、旧速報データの整理に失敗しました`,'warn'); }
      }
      // 単体取込では従来通り取込月だけ同期する。
      // 一括取込では opt.awaitCloud === false を指定し、ループ後に pushAll() を1回だけ実行する。
      if (opt.awaitCloud === true) {
        if (CLOUD?.pushMonth) {
          const r = await SYNC_COORDINATOR.syncMonth(ym);
          if (!r || !r.ok) throw new Error(r?.error || 'クラウド保存に失敗しました');
        }
      } else if (opt.awaitCloud !== false) {
        SYNC_COORDINATOR.syncMonth(ym).then(r=>{ if(!r?.ok) throw new Error(r?.error||'クラウド保存に失敗しました'); }).catch(e=>{ console.warn('[D4-16] month background sync failed',ym,e); UI.toast(`${ymLabel(ym)}：ローカル取込は完了しましたが、クラウド保存に失敗しました`,'warn'); }); // 取込月だけ自動同期
      }
      if (!opt.strict) {
        NAV.refresh();
        UI.toast(`${imported}件取込完了（${ymLabel(ym)}）`);
        UI.updateSaveStatus();
      }
    }
    return imported;
  },

  async importCapacityExcel(file) {
    try {
      await ASSETS.xlsx();
      if (!window.XLSX) { UI.toast('SheetJSが読み込まれていません','error'); return; }

      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf,{type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = window.XLSX.utils.sheet_to_json(ws,{header:1, defval:''});

      function normAreaName(v){
        return String(v || '')
          .normalize('NFKC')
          .replace(/\s+/g,'')
          .replace(/_n/g,'_')
          .replace(/＿n/g,'_')
          .replace(/北\/板橋/g,'北/板')
          .trim();
      }
      function n(v){
        const x = Number(String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[^\d.-]/g,''));
        return Number.isFinite(x) ? x : 0;
      }
      function isHeader(row){
        const s = row.map(x=>String(x||'')).join('|');
        return /地区.*名称|時間.*区分|平日|土日/.test(s);
      }

      const areas = {};
      let rowCount = 0;

      for (const row of data) {
        if (!row || !row.some(c=>String(c||'').trim())) continue;
        if (isHeader(row)) continue;

        // 標準フォーマット：B列=地区名称1、F列=時間区分、G列=平日、H列=土日
        let area = normAreaName(row[1]);
        let time = String(row[5] || '').normalize('NFKC').trim() || 'ALL';
        let weekday = n(row[6]);
        let weekend = n(row[7]);

        // 旧簡易フォーマット：A列=地区、B列=平日/最大、C列=土日
        if ((!area || (!weekday && !weekend)) && row[0]) {
          const a0 = normAreaName(row[0]);
          const w0 = n(row[1]);
          const e0 = n(row[2]);
          if (a0 && (w0 || e0)) {
            area = a0;
            time = String(row[3] || 'ALL').normalize('NFKC').trim() || 'ALL';
            weekday = w0;
            weekend = e0 || w0;
          }
        }

        if (!area || (!weekday && !weekend)) continue;
        if (!areas[area]) areas[area] = { weekday:0, weekend:0, rows:[], max:0 };
        areas[area].weekday += weekday;
        areas[area].weekend += (weekend || weekday);
        areas[area].max += Math.max(weekday, weekend || weekday);
        areas[area].rows.push({ time, weekday, weekend:weekend || weekday });
        rowCount++;
      }

      if (!Object.keys(areas).length) {
        UI.toast('地区データが見つかりません（想定：B列=地区、F列=時間、G列=平日、H列=土日）','warn');
        return;
      }

      STATE.capacity = STATE.capacity || {};
      STATE.capacity.areas = areas;
      STATE.capacity.updatedAt = new Date().toISOString();
      STATE.capacity.sourceFile = file.name;
      STATE.capacity.rowCount = rowCount;
      STATE.capacity.mapping = STATE.capacity.mapping || CAPACITY_UI.defaultMapping();
      STATE.capacity.calendar = STATE.capacity.calendar || {};

      Repository.Storage.save();
      SYNC_COORDINATOR.syncCapacity().then(r=>{ if(!r?.ok) throw new Error(r?.error||'クラウド保存に失敗しました'); }).catch(e=>{ console.warn('[D4-16] capacity background sync failed',e); UI.toast('キャパはローカル保存済みですが、クラウド保存に失敗しました','warn'); });
      NAV.refresh();
      UI.toast(`キャパ取込完了: ${Object.keys(areas).length}地区 / ${rowCount}行`);
      if (window.CAPACITY_UI?.render) CAPACITY_UI.render();
    } catch(e) {
      console.error(e);
      UI.toast('Excel読込エラー: '+e.message,'error');
    }
  },

  async deleteDataset(ym, type) {
    type = type || 'confirmed';
    const ds = STATE.datasets.find(d=>d.ym===ym && (d.type || 'confirmed') === type && d.source !== 'history');
    const typeLabel = type === 'daily' ? '日報' : '確定';
    const detail = ds ? `
区分：${typeLabel}
${ds.fileName || 'ファイル名なし'}
収入 ${fmtK(ds.totalIncome)}千円` : '';
    if (!ds) { UI.toast(`${ymLabel(ym)}の${typeLabel}CSVは未登録です`, 'warn'); return; }
    if (!confirm(`${ymLabel(ym)}の${typeLabel}CSVを削除しますか？${detail}

※収支補完・計画データは削除しません。`)) return;
    markDataDeleted('datasets', dataDeleteKey(ym, type));
    STATE.datasets = STATE.datasets.filter(d=>!(d.ym===ym && (d.type || 'confirmed') === type && d.source !== 'history'));
    applyDeletionTombstonesToState(STATE);
    Repository.Storage.save();
    try {
      if (window.IDB_CACHE?.remove) await IDB_CACHE.remove('dataset', `${ym}_${type}`);
    } catch(e) {}
    try {
      if (CLOUD?.deleteFile) await CLOUD_REPOSITORY.deleteFile(CLOUD.datasetKey(ym, type));
      if (CLOUD?.pushAll) await SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true });
    } catch(e) {
      UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました: ' + e.message, 'warn');
    }
    NAV.refresh();
    UI.toast(`${ymLabel(ym)}の${typeLabel}CSVを削除しました`);
  },

  replaceDataset(ym, type) {
    type = type || 'confirmed';
    const ds = STATE.datasets.find(d=>d.ym===ym && (d.type || 'confirmed') === type && d.source !== 'history');
    if (!ds) { UI.toast('入替対象CSVが見つかりません','warn'); return; }

    const typeLabel = type === 'daily' ? '日報' : '確定';
    const ok = confirm(
      `${ymLabel(ym)}の${typeLabel}データを新しいCSVで入れ替えます。\n\n` +
      `現在：${ds.fileName || 'ファイル名なし'}\n` +
      `収入：${fmtK(ds.totalIncome)}千円\n\n` +
      `続行する場合は、次にCSVを選択してください。`
    );
    if (!ok) return;

    this._replaceYM = ym;
    this._replaceType = type;
    const input = document.getElementById('file-input');
    if (input) {
      input.value = '';
      input.click();
    } else {
      UI.toast('ファイル選択欄が見つかりません','error');
    }
  },

  clearAll() {
    if (!confirm('全データを削除します。よろしいですか？')) return;
    STATE.datasets = []; STATE.workerCsvData = []; STATE.productAddressData = []; STATE.fieldData = []; STATE.capacity = null;
    Repository.Storage.save();
    NAV.refresh();
    UI.toast('全データを削除しました');
  },
};

/* ════════ §8 MODAL（年月選択） ═════════════════════════════════ */
const MODAL = {
  openYM(files) {
    const el = document.getElementById('modal-ym') || document.getElementById('ym-modal');
    if (!el) return;

    // 取込ポップを画面中央へ固定
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '9999';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.background = 'rgba(15,23,42,0.38)';

    const fl = document.getElementById('modal-file-list');
    if (fl) fl.innerHTML = files.map(f=>`<div class="modal-file-item">📄 ${esc(f.name)}</div>`).join('');

    // 速報値／確定値の手動選択欄を追加（自動判定なし）
    let typeBox = document.getElementById('manual-import-type-box');
    if (!typeBox) {
      typeBox = document.createElement('div');
      typeBox.id = 'manual-import-type-box';
      typeBox.style.cssText = 'margin:10px 0 8px;padding:10px;border:1px solid var(--border2);border-radius:8px;background:#f8fafc;font-size:12px';
      typeBox.innerHTML = `
        <div style="font-weight:800;margin-bottom:7px;color:var(--text)">取込区分</div>
        <label style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;cursor:pointer">
          <input type="radio" name="manual-import-type" value="confirmed" checked> 確定値
        </label>
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer">
          <input type="radio" name="manual-import-type" value="daily"> 速報値
        </label>
      `;
      if (fl && fl.parentNode) fl.parentNode.insertBefore(typeBox, fl.nextSibling);
    } else {
      const confirmed = typeBox.querySelector('input[value="confirmed"]');
      if (confirmed) confirmed.checked = true;
    }

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

/* ════════════════════════════════════════════════════════════════
   06. Cloud Sync（core/cloud.js に分離済み）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §9 CLOUD は core/cloud.js へ分離 ════════ */

/* ════════════════════════════════════════════════════════════════
   07. Utility / Dataset Selection
   表示整形（src/core/format.js に分離済み）、および
   データセット選定・計画データのクラウドマージロジック
   ════════════════════════════════════════════════════════════════ */
/* ════════ §10 フォーマットヘルパー（fmt/fmtK/pct/esc等）は src/core/format.js へ分離 ════════ */
/* ════════ §10B データセット選定・計画データヘルパー ═══════════ */
// TODO(V2):
// この節（データセット選定・クラウドマージ処理）はクラウド同期と
// 密結合しているため、分離する場合は core/cloud.js との依存関係を
// 十分に検証してから実施すること。単純な切り出しは危険。
function datasetStoredAsKyen(ds) {
  if (!ds) return false;
  return ds.source === 'history' || String(ds.unit || '').includes('千円');
}
function normalizeDatasetForDisplay(ds) {
  // 画面・グラフ・PLは従来どおり「内部=円」を前提に計算しているため、
  // 収支補完（元単位=千円）だけ表示用に円換算したコピーを返す。
  // STATE本体は変更しない。保存データは千円のまま保持する。
  if (!datasetStoredAsKyen(ds)) return ds;
  const out = { ...ds, _displayNormalizedFromKyen: true };
  ['totalIncome','totalExpense','profit','laborCost','fixedCost','varCost'].forEach(k => {
    if (out[k] != null && !isNaN(out[k])) out[k] = n(out[k]) * 1000;
  });
  if (ds.rows && typeof ds.rows === 'object') {
    out.rows = {};
    Object.keys(ds.rows).forEach(k => { out.rows[k] = n(ds.rows[k]) * 1000; });
  }
  return out;
}
function datasetSourceKind(ds) {
  let existingResult;
  if (!ds) existingResult = 'none';
  else if (ds.source === 'history') existingResult = 'history';
  else if (ds.type === 'daily') existingResult = 'daily';
  else if (ds.source === 'csv' || !ds.source) existingResult = 'confirmed';
  else existingResult = ds.type || ds.source || 'confirmed';

  // ==== Version3移行確認用の一時的な安全装置（Phase3-3-9） ====
  // Repository移行完了後に削除予定。
  // DatasetRepositoryの内部ヘルパー _sourceKindOf（_internal経由で
  // 参照可能、Phase3-3-3で公開済み）が利用可能な場合のみ比較し、
  // 文字列として完全一致した場合だけRepository側の値を採用する。
  if (window.Repository && window.Repository.Dataset && window.Repository.Dataset._internal && typeof window.Repository.Dataset._internal._sourceKindOf === 'function') {
    try {
      const repoResult = window.Repository.Dataset._internal._sourceKindOf(ds);
      if (existingResult === repoResult) {
        return repoResult;
      }
      console.warn(
        '[Repository比較] datasetSourceKind() で既存処理とRepositoryの結果に差異があります。既存処理の結果を採用します。',
        { dataset: ds, existing: existingResult, repository: repoResult }
      );
    } catch (e) {
      console.warn('[Repository比較] datasetSourceKind() の比較中にエラーが発生しました。既存処理の結果を採用します。', e);
    }
  }
  // ==== ここまで（比較処理はRepository移行完了後に削除予定） ====

  return existingResult;
}
function datasetKindLabel(ds) {
  const kind = datasetSourceKind(ds);
  if (kind === 'history') return '補完';
  if (kind === 'daily') return '日報';
  if (kind === 'confirmed') return '確定';
  return '不明';
}
function datasetPriority(ds) {
  // 同じ年月では、正式CSV確定 > CSV速報 > 収支補完 の順で表示・分析に使う。
  // 補完はCSV未登録月を埋めるための参考値であり、確定とは表示しない。
  const kind = datasetSourceKind(ds);
  let existingResult;
  if (kind === 'confirmed') existingResult = 30;
  else if (kind === 'daily') existingResult = 20;
  else if (kind === 'history') existingResult = 10;
  else existingResult = 0;

  // ==== Version3移行確認用の一時的な安全装置（Phase3-3-8） ====
  // Repository移行完了後に削除予定。
  // Repository.Dataset.priorityOf() が利用可能な場合のみ比較し、
  // 数値として完全一致した場合だけRepository側の値を採用する。
  if (window.Repository && window.Repository.Dataset && typeof window.Repository.Dataset.priorityOf === 'function') {
    try {
      const repoResult = window.Repository.Dataset.priorityOf(ds);
      if (Object.is(existingResult, repoResult)) {
        return repoResult;
      }
      console.warn(
        '[Repository比較] datasetPriority() で既存処理とRepositoryの結果に差異があります。既存処理の結果を採用します。',
        { dataset: ds, existing: existingResult, repository: repoResult }
      );
    } catch (e) {
      console.warn('[Repository比較] datasetPriority() の比較中にエラーが発生しました。既存処理の結果を採用します。', e);
    }
  }
  // ==== ここまで（比較処理はRepository移行完了後に削除予定） ====

  return existingResult;
}
function activeDatasets() {
  // ==== Phase4-2: Mutation / Pure Calculation 責務分離 ====
  // ① Mutation：削除済みマーカーの適用（STATE.datasetsを実際に書き換える）。
  //    既存ロジックは1文字も変更していない。
  applyDeletionTombstonesToState(STATE);

  // ② Pure Calculation：ym毎の優先順位判定・ソート・表示正規化。
  //    Repository.Dataset.getActive() が既にPureな実装として完成・
  //    比較検証済み（Phase3-3-3〜3-3-7）のため、同じロジックを
  //    ここで重複実装しない。Repositoryへ完全に委譲する。
  //
  //    正しいscript読込順（center.htmlでRepository関連ファイルが
  //    src/app.jsより前に接続済み）であれば、window.Repository.Dataset
  //    は必ず存在する。存在しない場合は設定・読込順の不備であるため、
  //    CONFIG_UTILS（Phase3-3-4）と同じ方針で明示的に例外を投げる。
  if (!window.Repository || !window.Repository.Dataset || typeof window.Repository.Dataset.getActive !== 'function') {
    throw new Error('[activeDatasets] Repository.Dataset.getActive is required but not available. Check script load order (Repository must be connected before this function is called).');
  }
  return window.Repository.Dataset.getActive();
}
function activeDatasetByYM(ym) {
  return activeDatasets().find(d => d.ym === ym) || null;
}
function isRealCsvDataset(ds) {
  return !!ds && datasetSourceKind(ds) !== 'history';
}
function activeRealCsvDatasets() {
  return activeDatasets().filter(isRealCsvDataset);
}
function activeRealCsvDatasetByYM(ym) {
  return activeRealCsvDatasets().find(d => d.ym === ym) || null;
}

function dashboardAvailableFiscalYears() {
  // ダッシュボードは「実CSV」を基準にする。
  // 収支補完だけで年度末まで一周表示される誤表示を防ぐ。
  const set = new Set();
  for (const d of activeRealCsvDatasets()) {
    if (d && d.ym) set.add(fiscalYearFromYM(d.ym));
  }
  const latest = latestRealDS();
  if (latest && latest.ym) set.add(fiscalYearFromYM(latest.ym));
  set.add(getDefaultFiscalYear());
  return [...set].sort((a,b)=>parseInt(b,10)-parseInt(a,10));
}
function dashboardSelectedFiscalYear() {
  if (STATE.fiscalYear) return String(STATE.fiscalYear);
  const latest = latestRealDS();
  return latest && latest.ym ? fiscalYearFromYM(latest.ym) : getDefaultFiscalYear();
}
function dashboardSelectedYM() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const validMonths = months.filter(ym => activeRealCsvDatasetByYM(ym));
  if (STATE.selYM && months.includes(STATE.selYM) && activeRealCsvDatasetByYM(STATE.selYM)) return STATE.selYM;
  const latestInFY = validMonths.length ? validMonths[validMonths.length - 1] : null;
  if (latestInFY) {
    STATE.selYM = latestInFY;
    return latestInFY;
  }

  if (STATE.fiscalYear) {
    STATE.selYM = null;
    return null;
  }

  const latest = latestRealDS();
  if (latest && latest.ym) {
    STATE.fiscalYear = fiscalYearFromYM(latest.ym);
    STATE.selYM = latest.ym;
    return latest.ym;
  }
  return null;
}
function selectedDashboardDS() {
  const ym = dashboardSelectedYM();
  if (ym) return activeRealCsvDatasetByYM(ym);
  // ダッシュボードでは収支補完だけの月を初期表示しない。
  if (STATE.fiscalYear) return null;
  return latestRealDS();
}


function dashboardDatasetsForSelectedFiscalYear() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  // ダッシュボードの推移グラフは実CSVのみ。収支補完だけで12ヶ月分を表示しない。
  return months.map(ym => activeRealCsvDatasetByYM(ym)).filter(Boolean);
}

function datasetsForSelectedFiscalYear() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  return months.map(ym => activeDatasetByYM(ym)).filter(Boolean);
}

function latestDatasetInSelectedFiscalYear() {
  const list = datasetsForSelectedFiscalYear();
  return list.length ? list[list.length - 1] : null;
}

function selectedDatasetInSelectedFiscalYear() {
  const ym = dashboardSelectedYM();
  return ym ? activeDatasetByYM(ym) : latestDatasetInSelectedFiscalYear();
}

function fieldDataForSelectedFiscalYear() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  return (STATE.fieldData || []).filter(d => d && months.includes(d.ym));
}

function selectedFieldDataInSelectedFiscalYear() {
  const ym = dashboardSelectedYM();
  const list = fieldDataForSelectedFiscalYear();
  return list.find(d => d.ym === ym) || (list.length ? list[list.length - 1] : null);
}


/* 共通：年度・月プルダウン表示ルール
   - 年度は全画面で同じ候補を使う（収支/現場/計画/キャパ/現在年度）
   - 月は年度順（4月→翌年3月）で12ヶ月を必ず表示
   - 未登録月は「（未登録）」と表示し、月単位画面では選択不可にする
   - 年度変更時は、その年度で登録済みの最新月へ寄せる
*/
const PERIOD_UI = {
  fiscalYears(kind='all') {
    const set = new Set();
    if (STATE.fiscalYear) set.add(String(STATE.fiscalYear));
    set.add(String(getDefaultFiscalYear()));

    const addYM = ym => { if (ym) set.add(String(fiscalYearFromYM(ym))); };
    (activeRealCsvDatasets?.() || []).forEach(d => addYM(d?.ym));
    (activeDatasets?.() || []).forEach(d => addYM(d?.ym));
    (STATE.workerCsvData || []).forEach(d => addYM(d?.ym));
    (STATE.productAddressData || []).forEach(d => addYM(d?.ym));
    Object.keys(STATE.planData || {}).forEach(fy => /^\d{4}$/.test(String(fy)) && set.add(String(fy)));
    Object.keys(STATE.capacityRegionsByFY || {}).forEach(fy => /^\d{4}$/.test(String(fy)) && set.add(String(fy)));
    Object.keys(STATE.capacityCalendarsByFY || {}).forEach(fy => /^\d{4}$/.test(String(fy)) && set.add(String(fy)));

    return [...set].sort((a,b)=>parseInt(b,10)-parseInt(a,10));
  },
  hasData(ym, kind='revenue') {
    if (!ym) return false;
    if (kind === 'revenue') return !!activeRealCsvDatasetByYM(ym);
    if (kind === 'field') {
      return (STATE.workerCsvData || []).some(d => d?.ym === ym) || (STATE.productAddressData || []).some(d => d?.ym === ym);
    }
    return !!activeDatasetByYM(ym);
  },
  monthLabel(ym, kind='revenue') {
    const base = ymLabel(ym);
    if (kind === 'field') return `${base}${this.hasData(ym, kind) ? '（現場明細あり）' : '（未登録）'}`;
    const ds = kind === 'revenue' ? activeRealCsvDatasetByYM(ym) : activeDatasetByYM(ym);
    return ds ? `${base}（${datasetKindLabel(ds)}）` : `${base}（未登録）`;
  },
  latestYMInFY(fy, kind='revenue') {
    const months = monthsOfFiscalYear(fy);
    const list = months.filter(ym => this.hasData(ym, kind));
    return list.length ? list[list.length - 1] : null;
  },
  render(container, opt={}) {
    if (!container) return;
    const kind = opt.kind || 'revenue';
    const useMonth = opt.useMonth !== false;
    const viewKey = opt.viewKey || 'common';
    const title = opt.title || '表示対象';
    const subtitle = opt.subtitle || (useMonth ? '年度順：4月 → 翌年3月 / 年度・月を共通管理' : '年度順：4月 → 翌年3月 / 年度内推移を表示');
    const years = this.fiscalYears(kind);
    const fy = String(STATE.fiscalYear || dashboardSelectedFiscalYear() || years[0] || getDefaultFiscalYear());
    const safeFY = years.includes(fy) ? fy : (years[0] || fy);
    const selectedYM = STATE.selYM && monthsOfFiscalYear(safeFY).includes(STATE.selYM) ? STATE.selYM : (this.latestYMInFY(safeFY, kind) || '');
    const months = monthsOfFiscalYear(safeFY);
    const fyId = `${viewKey}-fy-select`;
    const ymId = `${viewKey}-ym-select`;
    const isBootSyncing = !!(window.APP_BOOT_STATE && APP_BOOT_STATE.cloudSyncPending);
    const hasAnyMonthData = months.some(ym => this.hasData(ym, kind));
    const showLoadingMonth = useMonth && isBootSyncing && !hasAnyMonthData;
    const monthHtml = showLoadingMonth
      ? '<option value="">読込中...</option>'
      : months.map(ym => {
          const has = this.hasData(ym, kind);
          const selected = ym === selectedYM ? 'selected' : '';
          const disabled = has ? '' : 'disabled';
          return `<option value="${esc(ym)}" ${selected} ${disabled}>${esc(this.monthLabel(ym, kind))}</option>`;
        }).join('');

    container.className = container.className || 'period-selector-wrap';
    container.innerHTML = `
      <div class="period-selector-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
        <div>
          <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">${esc(title)}</div>
          <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">${esc(subtitle)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
            <select id="${fyId}" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:120px">
              ${years.map(y=>`<option value="${esc(y)}" ${String(y)===String(safeFY)?'selected':''}>${esc(y)}年度</option>`).join('')}
            </select>
          </label>
          ${useMonth ? `<label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
            <select id="${ymId}" ${showLoadingMonth ? 'disabled' : ''} style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:210px">
              ${monthHtml || '<option value="">データなし</option>'}
            </select>
          </label>` : ''}
        </div>
      </div>`;

    const fySel = document.getElementById(fyId);
    const ymSel = document.getElementById(ymId);
    if (fySel) fySel.onchange = () => {
      STATE.fiscalYear = String(fySel.value);
      STATE.selYM = this.latestYMInFY(STATE.fiscalYear, kind) || null;
      if (typeof opt.onChange === 'function') opt.onChange({ fiscalYear: STATE.fiscalYear, ym: STATE.selYM, changed: 'fy' });
    };
    if (ymSel) ymSel.onchange = () => {
      if (ymSel.value) STATE.selYM = ymSel.value;
      STATE.fiscalYear = fiscalYearFromYM(STATE.selYM);
      if (typeof opt.onChange === 'function') opt.onChange({ fiscalYear: STATE.fiscalYear, ym: STATE.selYM, changed: 'ym' });
    };
  }
};
window.PERIOD_UI = PERIOD_UI;

function renderCommonPeriodSelector(viewKey, opt={}) {
  const view = document.getElementById('view-' + viewKey);
  if (!view || !window.PERIOD_UI) return;
  const yearOnlyViews = new Set(['trend','indicators','annual']);
  const useMonth = opt.useMonth !== false && !yearOnlyViews.has(viewKey);
  const kind = opt.kind || (viewKey === 'field' ? 'field' : 'all');
  let box = document.getElementById(`${viewKey}-period-selector`);
  if (!box) {
    box = document.createElement('div');
    box.id = `${viewKey}-period-selector`;
    view.prepend(box);
  }
  PERIOD_UI.render(box, {
    viewKey,
    kind,
    useMonth,
    subtitle: useMonth ? '年度順：4月 → 翌年3月 / 年度・月を共通管理' : '年度順：4月 → 翌年3月 / 年度内推移を表示',
    onChange: () => NAV.refresh()
  });
}
function latestDS() {
  const list = activeDatasets();
  return list.length ? list[list.length-1] : null;
}
function latestRealDS() {
  const list = activeRealCsvDatasets();
  return list.length ? list[list.length-1] : null;
}
function prevDS(ym) {
  const list = activeDatasets();
  const i = list.findIndex(d=>d.ym===ym);
  return i>0 ? list[i-1] : null;
}
function sameMonthLastYear(ym) {
  if (!ym) return null;
  const py = String(parseInt(ym.slice(0,4))-1)+ym.slice(4);
  return activeDatasetByYM(py);
}

function getDefaultFiscalYear() {
  // Phase3-3-4：年度計算ロジックは src/core/format.js の CONFIG_UTILS へ一元化。
  // ここはCONFIG_UTILSを呼ぶだけの互換ラッパー（既存の全呼び出し元との
  // 互換性維持のため、bare関数名 getDefaultFiscalYear() は維持する）。
  return CONFIG_UTILS.getDefaultFiscalYear();
}
function fiscalYearFromYM(ym) {
  // Phase3-3-4：年度計算ロジックは src/core/format.js の CONFIG_UTILS へ一元化。
  // ここはCONFIG_UTILSを呼ぶだけの互換ラッパー（既存の全呼び出し元との
  // 互換性維持のため、bare関数名 fiscalYearFromYM() は維持する）。
  return CONFIG_UTILS.fiscalYearFromYM(ym);
}
function monthsOfFiscalYear(fy) {
  const y = parseInt(fy,10);
  return ['04','05','06','07','08','09','10','11','12'].map(mm=>String(y)+mm)
    .concat(['01','02','03'].map(mm=>String(y+1)+mm));
}
function getSelectedFiscalYear(selectId='plan-year-sel') {
  const el = document.getElementById(selectId);
  const v = el && el.value ? String(el.value) : (STATE.fiscalYear || getDefaultFiscalYear());
  STATE.fiscalYear = v;
  return v;
}
function normalizePlanData(raw) {
  if (!raw) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const keys = Object.keys(raw);
  if (!keys.length) return {};
  const fiscalKeys = keys.filter(k=>/^\d{4}$/.test(k));
  if (fiscalKeys.length) {
    const out = {};
    for (const fy of fiscalKeys) {
      const v = raw[fy];
      if (v && v.rows) out[fy] = v;
      else if (v && typeof v === 'object') out[fy] = { rows:v, importedAt:null, itemCount:Object.keys(v).length };
    }
    return out;
  }
  // 旧形式（年度なし）を現在年度へ退避。必要なら取込画面で正しい年度へ再取込する。
  const fy = getDefaultFiscalYear();
  return { [fy]: { rows: raw, importedAt: null, itemCount: keys.length, migratedFromLegacy: true } };
}
function getPlanPackForFiscalYear(fy) {
  if (!STATE.planData || typeof STATE.planData !== 'object') STATE.planData = {};
  const pack = STATE.planData[String(fy)];
  if (!pack) return null;
  return pack.rows ? pack : { rows: pack, importedAt:null, itemCount:Object.keys(pack).length };
}
function getPlanRowsForFiscalYear(fy) {
  const pack = getPlanPackForFiscalYear(fy);
  if (!pack) return null;
  const rows = pack.rows;
  if (rows && typeof rows === 'object') {
    try { Object.defineProperty(rows, '__monthStatus', { value:Object.assign({}, pack.monthStatus||pack.sourceMeta?.month_status||{}), configurable:true, enumerable:false }); } catch(_e) {}
  }
  return rows;
}
function isPlanMonthAvailable(planRows, mm) {
  if (!planRows || !mm) return false;
  const status=planRows.__monthStatus?.[String(mm).padStart(2,'0')];
  return status !== 'NOT_PLANNED_YET' && status !== 'UNKNOWN';
}


function latestPlanUpdatedAt() {
  if (!STATE.planData || typeof STATE.planData !== 'object') return null;
  let latest = null;
  Object.values(STATE.planData).forEach(pack => {
    const t = pack && (pack.importedAt || pack.updatedAt || pack.savedAt);
    if (t && (!latest || String(t) > String(latest))) latest = t;
  });
  return latest;
}

function mergePlanDataByUpdatedAt(localRaw, cloudRaw) {
  const local = normalizePlanData(localRaw);
  const cloud = normalizePlanData(cloudRaw);
  const out = { ...local };
  Object.keys(cloud).forEach(fy => {
    const c = cloud[fy];
    const l = out[fy];
    const ct = c && (c.importedAt || c.updatedAt || c.savedAt || '');
    const lt = l && (l.importedAt || l.updatedAt || l.savedAt || '');
    if (!l || String(ct) >= String(lt)) out[fy] = c;
  });
  return out;
}

function mergeFullState(localFull, cloudFull) {
  const local = localFull || {};
  const cloud = cloudFull || {};
  const deleted = mergeDeletedStates(local.deleted || {}, cloud.deleted || {});
  // full_state は軽量台帳専用。CSV本体（datasets / workerCsvData / productAddressData）は
  // 月単位JSONを manifest から取得するため、ここで空配列を作ってSTATEを上書きしない。
  const merged = {
    version: 31,
    center: CENTER.id,
    savedAt: new Date().toISOString(),
    capacity: cloud.capacity || local.capacity || null,
    planData: mergePlanDataByUpdatedAt(local.planData || {}, cloud.planData || {}),
    fiscalYear: local.fiscalYear || cloud.fiscalYear || null,
    memos: { ...(local.memos || {}), ...(cloud.memos || {}) },
    library: (cloud.library && cloud.library.length) ? cloud.library : (local.library || []),
    reportKnowledge: mergeReportKnowledge(local.reportKnowledge || {}, cloud.reportKnowledge || {}),
    routeData: (cloud.routeData && cloud.routeData.length) ? cloud.routeData : (local.routeData || []),
    dailyRecords: (cloud.dailyRecords && cloud.dailyRecords.length) ? cloud.dailyRecords : (local.dailyRecords || []),
    companyMaster: (cloud.companyMaster && cloud.companyMaster.length) ? cloud.companyMaster : (local.companyMaster || []),
    workerMaster: (cloud.workerMaster && cloud.workerMaster.length) ? cloud.workerMaster : (local.workerMaster || []),
    deleted,
  };
  return applyDeletionTombstonesToState(merged);
}



/* 計画データ科目マッピング
   元データ側の科目名を優先し、画面表示側の名称をここで吸収する。
   計画データの単位は千円。比較時だけ円へ換算する。 */
const PLAN_LABEL_ALIASES = {
  '営業収益計': ['営業収益計','営業収益'],
  '営業収益の部': ['営業収益計','営業収益'],
  '売上原価合計': ['売上原価','売上原価合計'],
  'センター利益（粗利）': ['粗利益','営業利益','経常利益'],
  '粗利益': ['粗利益','営業利益','経常利益'],

  '家電収入': ['家電収入'],
  '一般収入': ['一般収入'],
  '委託収入': ['委託収入'],
  'その他収入': ['その他収入'],
  '保管料収入': ['保管料収入'],
  'コンピュータ収入': ['コンピュータ収入'],

  '人件費計': ['人件費計','人件費'],
  '燃料費計': ['燃料費計','燃料費'],
  '修繕費計': ['修繕費計'],
  '償却費計': ['償却費計','減価償却費計'],
  '保険料計': ['保険料計'],
  '施設費計': ['施設費計','施設計'],
  '租税公課計': ['租税公課計'],
  '備車費計': ['備車費計','傭車費計','傭車費'],
  '道路費計': ['道路費計','道路計'],
  '営業費計': ['営業費計'],
  'その他費用計': ['その他費用計','その他経費'],

  '給与手当': ['給与手当'],
  '人材派遣料': ['人材派遣料'],
  'その他人件費': ['その他人件費'],
  '旅費': ['旅費','運行旅費'],
  '軽油費': ['軽油費'],
  'ガソリン費': ['ガソリン費'],
  '車両修繕費': ['車両修繕費'],
  'タイヤ費': ['タイヤ費'],
  'その他修繕費': ['その他修繕費'],
  '車両償却費': ['車両償却費'],
  'その他償却費': ['その他償却費'],
  '自賠責保険料': ['自賠責保険料'],
  '任意保険料': ['任意保険料'],
  '運送保険料': ['運送保険料'],
  'その他保険料': ['その他保険料'],
  '借地借家料': ['借地借家料'],
  'その他施設費': ['その他施設費'],
  '重量税': ['重量税'],
  '自動車税': ['自動車税'],
  '取得税': ['取得税'],
  'その他税': ['その他税'],
  '集配傭車': ['集配傭車'],
  '路線傭車': ['路線傭車'],
  '路線備車': ['路線備車'],
  '委託費': ['委託費'],
  '社内外注費': ['社内外注費'],
  '道路利用料': ['道路利用料'],
  'その他利用料': ['その他利用料'],
  '水道光熱費': ['水道光熱費'],
  '備消品費': ['備消品費'],
  '図書印刷費': ['図書印刷費'],
  '通信運搬費': ['通信運搬費'],
  '電算関連費': ['電算関連費'],
  '被服費': ['被服費'],
  '交際費': ['交際費'],
  '負担金': ['負担金'],
  '教育求人費': ['教育求人費'],
  '雑費': ['雑費'],
  '環境衛生費': ['環境衛生費'],
  '経営指導料': ['経営指導料'],
};

function normalizePlanLabel(label) {
  return String(label || '')
    .replace(/[\s　\u3000]/g,'')
    .replace(/[()（）]/g,'')
    .replace(/％/g,'%')
    .trim();
}

function planMonthCol(mm) {
  // 計画貼付データは 0:科目名 1:年間合計 2:4月 ... 7:9月 8:上期計 9:10月 ... 14:3月 15:下期計
  const map = { '04':2,'05':3,'06':4,'07':5,'08':6,'09':7,'10':9,'11':10,'12':11,'01':12,'02':13,'03':14 };
  return map[String(mm).padStart(2,'0')];
}

function readPlanValueByLabel(planRows, label, mm) {
  if (!planRows || !label || !mm) return null;
  const colKey = String(mm).padStart(2,'0');
  const candidates = [label, ...(PLAN_LABEL_ALIASES[label] || [])].map(normalizePlanLabel);

  for (const key of candidates) {
    if (planRows[key] && planRows[key][colKey] != null) return n(planRows[key][colKey]);
  }

  // 最後の保険：表示名が少し違っても、正規化後に一致すれば拾う
  const normalizedEntries = Object.entries(planRows);
  for (const [storedLabel, vals] of normalizedEntries) {
    if (!vals || vals[colKey] == null) continue;
    const sLabel = normalizePlanLabel(storedLabel);
    if (candidates.includes(sLabel)) return n(vals[colKey]);
  }

  return null;
}

function sumPlanValues(planRows, labels, mm) {
  let sum = 0;
  let found = false;
  for (const label of labels || []) {
    const v = readPlanValueByLabel(planRows, label, mm);
    if (v != null) { sum += v; found = true; }
  }
  return found ? sum : null;
}

function getPlanValueK(planRows, label, mm, fallbackLabels) {
  if (!isPlanMonthAvailable(planRows, mm)) return null;
  // v10方針：親項目は、可能な限り画面側の子科目合計を優先する。
  // 理由：元データには「営業収益」「営業収益計」「人件費」「人件費計」など親行が複数あり、
  //      さらに同名行もあるため、親を直接拾うとズレることがある。
  let v = null;

  if (fallbackLabels && fallbackLabels.length) {
    v = sumPlanValues(planRows, fallbackLabels, mm);
    if (v != null) return v;
  }

  v = readPlanValueByLabel(planRows, label, mm);
  if (v != null) return v;

  return null;
}
function formatImportedAt(iso) {
  if (!iso) return '取込日時なし';
  try { return new Date(iso).toLocaleString('ja-JP'); } catch(e) { return String(iso); }
}
function updateFiscalInputState(kind) {
  const isPlan = kind === 'plan';
  const selId = isPlan ? 'plan-year-sel' : 'tsv-year-sel-history';
  const areaId = isPlan ? 'plan-paste-area' : 'tsv-paste-area-history';
  const msgId = isPlan ? 'plan-import-msg' : 'tsv-import-msg-history';
  const fy = getSelectedFiscalYear(selId);
  const area = document.getElementById(areaId);
  const msg = document.getElementById(msgId);
  if (area) area.value = '';
  if (msg) msg.textContent = `${fy}年度に切替：貼付欄をクリアしました`;
  renderImport();
  UI.toast(`${fy}年度に切替えました。貼付欄をクリアしました`, 'warn');
}
function initFiscalYearSelects() {
  const now = new Date();
  const defaultFY = getDefaultFiscalYear();
  // STORE.load() で復元された STATE.fiscalYear を優先する。
  // なければ今年度をデフォルトにする。
  const currentFY = STATE.fiscalYear || defaultFY;
  ['library-fy','library-bulk-fy','report-fy','plan-year-sel','tsv-year-sel-history'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.innerHTML = '';
    for (let y=now.getFullYear()+1; y>=2020; y--) {
      el.innerHTML += `<option value="${y}">${y}年度</option>`;
    }
    el.value = [...el.options].some(o=>o.value===currentFY) ? currentFY : defaultFY;
  });
  // STATE.fiscalYear は STORE.load() 済みの値を維持する（上書きしない）。
  // plan-year-sel の値で上書きすると localStorageに保存された過去年度が
  // デフォルト年度（今年度）で上書きされ、pullInitialForBoot が
  // 誤った年度のデータしか取得しない原因になる。
  if (!STATE.fiscalYear) STATE.fiscalYear = defaultFY;
  const planSel = document.getElementById('plan-year-sel');
  if (planSel) planSel.onchange = () => updateFiscalInputState('plan');
  const histSel = document.getElementById('tsv-year-sel-history');
  if (histSel) histSel.onchange = () => updateFiscalInputState('history');
}

/* ════════════════════════════════════════════════════════════════
   08. Chart Management / Screen Rendering（一部は分離済みスタブ）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §11 CHART_MGR ════════════════════════════════════════ */
/* ════════ §12 RENDER — Dashboard は src/modules/dashboard.js に完全移行済みのため削除 ════════ */
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

/* ════════ §14 RENDER — Trend（分割後スタブ） ══════════════════════════════════ */
function renderTrend() {
  if (window.renderTrend && window.renderTrend !== renderTrend) {
    return window.renderTrend();
  }
  const notice = document.getElementById('trend-notice');
  if (notice) notice.innerHTML = '<div class="msg msg-info">売上推移モジュール（trend.js）を読み込んでください。</div>';
}

/* ════════ §15 RENDER — Shipper（分割後スタブ） ════════════════════════════════ */
function renderShipper() {
  if (window.SHIPPER_MODULE && typeof window.SHIPPER_MODULE.render === 'function') {
    return window.SHIPPER_MODULE.render();
  }
  const view = document.getElementById('view-shipper');
  if (view) {
    let noticeEl = document.getElementById('shipper-notice');
    if (!noticeEl) {
      noticeEl = document.createElement('div');
      noticeEl.id = 'shipper-notice';
      view.prepend(noticeEl);
    }
    noticeEl.innerHTML = '<div class="msg msg-info" style="margin-bottom:14px">荷主分析モジュールを読み込み中です。</div>';
  }
}

/* ════════════════════════════════════════════════════════════════
   09. Screen Rendering — Indicators / Annual / Alerts
   ════════════════════════════════════════════════════════════════ */
/* ════════ §16-18 RENDER — Indicators / Annual / Alerts は src/modules/indicators.js へ分離 ════════ */

/* ════════════════════════════════════════════════════════════════
   10. Capacity / Data Storage Location / Bulk Import（一部分離済み）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §19 RENDER — Capacity は src/modules/capacity.js へ分離 ════════ */

/* ════════ §20A データ保管場所対応表ヘルパー・保存経路監査 は src/modules/storage_audit.js へ分離 ════════ */

/* ════════ §20.5 BULK_IMPORT は src/modules/bulk_import.js へ分離（互換ラッパー不要：呼び出し元はすべて window.BULK_IMPORT.handleFiles() 形式のため） ════════ */
function renderImport() {
  const listEl = document.getElementById('data-list');
  if (listEl) {
    const storageHtml = renderStorageMapTable();
    const monthlyHtml = renderMonthlyCheckTable();
    const qualityHtml = renderDataQualityCheckTable();
    const statusMap = {};
    (STATE.datasets || []).forEach(d => {
      const fy = d.fiscalYear || fiscalYearFromYM(d.ym);
      if (!statusMap[fy]) statusMap[fy] = { confirmed:new Set(), daily:new Set() };
      if (d.type === 'daily') statusMap[fy].daily.add(d.ym);
      else statusMap[fy].confirmed.add(d.ym);
    });
    const statusHtml = Object.keys(statusMap).sort().reverse().map(fy => `
      <div style="padding:10px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;font-size:12px">
        <strong>${fy}年度の登録状況</strong>
        <span style="margin-left:10px;color:var(--text2)">確定 ${statusMap[fy].confirmed.size}ヶ月 / 日報 ${statusMap[fy].daily.size}ヶ月</span>
      </div>
    `).join('');

    const sorted = [...(STATE.datasets || [])].sort((a,b)=>a.ym.localeCompare(b.ym) || ((a.type||'confirmed')==='confirmed'?-1:1));
    const detailHtml = sorted.length ? sorted.map(ds=>{
      const fy = ds.fiscalYear || fiscalYearFromYM(ds.ym);
      const sourceLabel = ds.source === 'history' ? '収支補完' : (ds.fileName ? esc(ds.fileName) : 'ファイル名なし');
      const typeLabel = ds.type === 'confirmed' ? '確定' : '速報';
      const unitLabel = ds.unit || (ds.source === 'history' ? '千円' : '円');
      const incK = storageAmountK(ds,'totalIncome');
      const expK = storageAmountK(ds,'totalExpense');
      return `
      <div class="data-item" style="align-items:flex-start;gap:10px">
        <span class="badge ${ds.type==='confirmed'?'badge-ok':'badge-warn'}">${typeLabel}</span>
        <span style="flex:1;line-height:1.65">
          <strong>${ymLabel(ds.ym)}</strong>
          <span style="margin-left:8px;font-size:11px;color:var(--text2)">${fy}年度</span>
          <span style="margin-left:8px;font-size:10px;color:var(--text3)">単位：${unitLabel}</span><br>
          <span style="font-size:11px;color:var(--text3)">ファイル：${sourceLabel}</span><br>
          <span style="font-size:11px;color:var(--text3)">取込日時：${formatImportedAt(ds.importedAt)}</span>
        </span>
        <span style="font-size:11px;color:var(--text3);margin-right:8px;white-space:nowrap;text-align:right">
          収入 ${fmt(incK)}千円<br>
          費用 ${fmt(expK)}千円
        </span>
        ${ds.source === 'history' ? '' : `<button class="btn" onclick="IMPORT.replaceDataset('${ds.ym}','${ds.type || 'confirmed'}')" style="font-size:11px;padding:2px 8px">入替</button>`}
        ${ds.source === 'history'
          ? `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteHistoryMonth('${ds.ym}')" style="font-size:11px;padding:2px 8px">補完削除</button>`
          : `<button class="btn btn-danger" onclick="IMPORT.deleteDataset('${ds.ym}','${ds.type || 'confirmed'}')" style="font-size:11px;padding:2px 8px">削除</button>`}
      </div>`;
    }).join('') : '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだ詳細履歴はありません</div>';

    const historyHtml = `
      <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
        <summary style="cursor:pointer;padding:12px 14px;font-weight:900;background:#f8fafc;color:var(--text)">詳細履歴を表示</summary>
        <div style="padding:10px 12px">
          ${statusHtml || '<div style="padding:10px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;font-size:12px;color:var(--text3)">年度別登録状況はまだありません</div>'}
          ${detailHtml}
        </div>
      </details>`;

    const auditHtml = renderStorageRouteAuditPanel();
    listEl.innerHTML = storageHtml + auditHtml + monthlyHtml + qualityHtml + historyHtml;
  }

  if (window.LANDING_FORECAST_UI?.renderImportPanel) LANDING_FORECAST_UI.renderImportPanel();

  const storageEl = document.getElementById('storage-info');
  if (storageEl) {
    const info = STORE.storageInfo();
    storageEl.innerHTML = `使用容量: <strong>${info.kb} KB</strong>（センター: ${CENTER.name}）`;
  }

  CLOUD.renderForm();

  const descEl = document.getElementById('import-target-desc');
  if (descEl) descEl.textContent = `取込先: ${CENTER.name}（${CENTER.id}）`;

  const planBadge = document.getElementById('plan-badge');
  if (planBadge) {
    const fy = getSelectedFiscalYear('plan-year-sel');
    const pack = getPlanPackForFiscalYear(fy);
    planBadge.textContent = pack ? `${fy}年度 登録済` : `${fy}年度 未登録`;
    planBadge.className = pack ? 'badge badge-ok' : 'badge badge-warn';
  }
}

/* ════════════════════════════════════════════════════════════════
   11. Memo / Field UI（一部分離済みスタブ）
   ════════════════════════════════════════════════════════════════ */
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
    Repository.Storage.save();
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
  const yms = activeDatasets().map(d=>d.ym);
  sel.innerHTML = yms.length
    ? yms.map(ym=>`<option value="${ym}">${ymLabel(ym)}</option>`).join('')
    : '<option value="">データなし</option>';
  if (text && sel.value) text.value = STATE.memos[sel.value]?.text||'';
  sel.onchange = ()=>{ if(text) text.value = STATE.memos[sel.value]?.text||''; };
  MEMO.renderList();
}

/* ════════ §22 FIELD_UI（分割後スタブ） ══════════════════════════════ */
var FIELD_UI = window.FIELD_UI || {
  switchTab(el) {
    document.querySelectorAll('.field-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.field-pane').forEach(p=>p.classList.remove('active'));
    if (el) el.classList.add('active');
    const pane = el ? document.getElementById('fpane-'+el.dataset.ftab) : null;
    if (pane) pane.classList.add('active');
  },
  renderMap() {},
  updatePeriodBadge() {
    const badge = document.getElementById('field-period-badge');
    if (badge) badge.textContent = 'field.js未読込';
  },
  renderDataList() {
    const list = document.getElementById('field-data-list') || document.getElementById('field-data-list2');
    if (list) list.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">field.jsを読み込んでください</div>';
  },
};


function normalizeReportKnowledge(raw) {
  const base = { policies:{}, references:[] };
  if (!raw || typeof raw !== 'object') return base;
  const policies = raw.policies && typeof raw.policies === 'object' ? raw.policies : {};
  const references = Array.isArray(raw.references) ? raw.references : [];
  return {
    policies,
    references: references.map(r => ({
      id: r.id || Date.now() + Math.random(),
      fiscalYear: String(r.fiscalYear || getDefaultFiscalYear()),
      half: r.half || '上期',
      ym: r.ym || '',
      scope: r.scope || (r.ym ? 'month' : 'half'),
      title: r.title || '無題',
      category: r.category || 'その他',
      priority: r.priority || '中',
      content: r.content || '',
      savedAt: r.savedAt || new Date().toISOString()
    }))
  };
}

function mergeReportKnowledge(localRaw, cloudRaw) {
  const local = normalizeReportKnowledge(localRaw);
  const cloud = normalizeReportKnowledge(cloudRaw);
  const policies = { ...local.policies };
  Object.entries(cloud.policies || {}).forEach(([key, val]) => {
    const old = policies[key];
    const nt = val && (val.savedAt || val.updatedAt || '');
    const ot = old && (old.savedAt || old.updatedAt || '');
    if (!old || String(nt) >= String(ot)) policies[key] = val;
  });
  const refMap = new Map();
  [...(local.references || []), ...(cloud.references || [])].forEach(r => {
    if (!r) return;
    const id = String(r.id || `${r.fiscalYear}_${r.half}_${r.ym}_${r.title}`);
    const old = refMap.get(id);
    if (!old || String(r.savedAt || '') >= String(old.savedAt || '')) refMap.set(id, r);
  });
  return { policies, references:[...refMap.values()].sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))) };
}

function reportHalfFromYM(ym) {
  const mm = Number(String(ym || '').slice(4,6));
  return (mm >= 4 && mm <= 9) ? '上期' : '下期';
}

/* ════════════════════════════════════════════════════════════════
   12. Report / Past Library（分離済みスタブ）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §23 REPORT_UI は src/modules/report_ui.js へ分離 ════════ */
/* ════════ §24 PAST_LIBRARY は src/modules/past_library.js へ分離 ════════ */

/* 現場分析データの遅延読込
   起動時は現場CSVを読まず、現場分析画面を開いた時だけ対象年度分を取得する。 */
const FIELD_CLOUD_LOAD = { promises:{}, done:{}, bound:{} };
function fieldCloudSnapshot(){
  const w = Array.isArray(STATE.workerCsvData) ? STATE.workerCsvData : [];
  const p = Array.isArray(STATE.productAddressData) ? STATE.productAddressData : [];
  const pack = arr => arr.map(x => `${x?.ym || ''}:${Array.isArray(x?.rows) ? x.rows.length : Array.isArray(x?.tickets) ? x.tickets.length : 0}`).sort().join('|');
  return `${w.length}/${p.length}::${pack(w)}::${pack(p)}`;
}
function fieldLocalYmsForLoad() {
  return [
    ...(Array.isArray(STATE.workerCsvData) ? STATE.workerCsvData.map(d=>d?.ym) : []),
    ...(Array.isArray(STATE.productAddressData) ? STATE.productAddressData.map(d=>d?.ym) : [])
  ].filter(Boolean).sort();
}
function currentFieldFiscalYearForLoad() {
  const fieldYms = fieldLocalYmsForLoad();
  const selectedMonth = document.getElementById('field-common-month-select')?.value || STATE.selYM || '';
  if (selectedMonth && fieldYms.includes(selectedMonth)) return String(fiscalYearFromYM(selectedMonth));

  const sel = document.getElementById('field-common-fy-select')?.value;
  if (sel) {
    const months = new Set((typeof monthsOfFiscalYear === 'function') ? monthsOfFiscalYear(sel) : []);
    if (fieldYms.some(ym => months.has(ym))) return String(sel);
  }

  // 対象年度に現場データが無い場合は、空の年度ではなく最新の現場データ年度を優先する。
  // これにより IndexedDB 復元済みのデータをクラウド待ちせず先表示できる。
  if (fieldYms.length) return String(fiscalYearFromYM(fieldYms[fieldYms.length - 1]));

  if (STATE.fiscalYear) return String(STATE.fiscalYear);
  const ds = selectedDashboardDS?.() || latestRealDS?.() || latestDS?.();
  return String(ds?.ym ? fiscalYearFromYM(ds.ym) : getDefaultFiscalYear());
}
function renderFieldCloudNotice(view, text='現場分析データをクラウドから読み込み中...') {
  const viewEl = document.getElementById('view-' + view);
  if (!viewEl) return;
  let box = viewEl.querySelector('#field-cloud-lazy-loader');
  if (!box) {
    box = document.createElement('div');
    box.id = 'field-cloud-lazy-loader';
    box.className = 'card';
    box.style.cssText = 'margin-bottom:14px;border-left:4px solid #2563eb';
    viewEl.insertBefore(box, viewEl.firstChild);
  }
  box.innerHTML = `<div class="card-body" style="display:flex;align-items:center;gap:10px;color:var(--text2);font-weight:800"><span class="spinner" style="width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;display:inline-block;animation:spin 1s linear infinite"></span>${esc(text)}</div>`;
}
function removeFieldCloudNotice(view) {
  document.getElementById('view-' + view)?.querySelector('#field-cloud-lazy-loader')?.remove();
}
function renderFieldViewAfterCloud(view, renderFn) {
  const viewStart = performance.now();
  const fy = currentFieldFiscalYearForLoad();
  const key = `${CENTER.id}:${fy}`;
  const localMonths = new Set([
    ...(Array.isArray(STATE.workerCsvData) ? STATE.workerCsvData.map(d=>d?.ym) : []),
    ...(Array.isArray(STATE.productAddressData) ? STATE.productAddressData.map(d=>d?.ym) : [])
  ].filter(Boolean));
  const fyMonths = new Set((typeof monthsOfFiscalYear === 'function') ? monthsOfFiscalYear(fy) : []);
  const hasLocalForFY = [...localMonths].some(ym => fyMonths.has(ym));

  if (!CLOUD.pullFieldDataForFiscalYear || FIELD_CLOUD_LOAD.done[key]) {
    renderFn();
    window.__mgmtPerfLog(`[PERF] field-view:${view}:render-local-done ms=${Math.round(performance.now()-viewStart)} fy=${fy} localMonths=${localMonths.size}`);
    return;
  }

  const beforeSnapshot = fieldCloudSnapshot();

  // ローカルに対象年度の現場データがある場合は先に表示し、裏で差分だけ取得する。
  // ローカルが空の場合は、空表示を出さないように読み込み表示を挟む。
  if (hasLocalForFY) {
    renderFn();
    window.__mgmtPerfLog(`[PERF] field-view:${view}:render-from-idb ms=${Math.round(performance.now()-viewStart)} fy=${fy} localMonths=${localMonths.size}`);
  } else {
    renderFieldCloudNotice(view);
  }

  if (!FIELD_CLOUD_LOAD.promises[key]) {
    FIELD_CLOUD_LOAD.promises[key] = AUTO_SYNC.withoutSyncAsync(async () => SYNC_COORDINATOR.syncFieldFiscalYear(fy))
      .then(r => {
        FIELD_CLOUD_LOAD.done[key] = true;
        return r;
      })
      .catch(e => ({ ok:false, error:e?.message || String(e) }))
      .finally(() => { delete FIELD_CLOUD_LOAD.promises[key]; });
  }

  const waitKey = `${view}:${key}`;
  if (FIELD_CLOUD_LOAD.bound[waitKey]) return;
  FIELD_CLOUD_LOAD.bound[waitKey] = true;

  FIELD_CLOUD_LOAD.promises[key].then(r => {
    delete FIELD_CLOUD_LOAD.bound[waitKey];
    if (STATE.view !== view) return;
    removeFieldCloudNotice(view);
    if (r && !r.ok) UI.toast('現場分析データの取得に失敗しました: ' + (r.error || '不明'), 'warn');
    const afterSnapshot = fieldCloudSnapshot();
    if (!hasLocalForFY || beforeSnapshot !== afterSnapshot) {
      const renderStart = performance.now();
      renderFn();
      window.__mgmtPerfLog(`[PERF] field-view:${view}:render-after-cloud ms=${Math.round(performance.now()-renderStart)} fy=${fy} localMonths=${localMonths.size}`);
    } else {
      window.__mgmtPerfLog(`[PERF] field-cloud:${fy} no-change skip render`);
    }
    window.__mgmtPerfLog(`[PERF] field-view:${view}:end ms=${Math.round(performance.now()-viewStart)} fy=${fy} localBefore=${hasLocalForFY ? 1 : 0}`);
    UI.updateTopbar(view);
    UI.updateSaveStatus();
  });
}


/* ════════════════════════════════════════════════════════════════
   13. Field Cloud Loading / IndexedDB Cache
   現場分析データの遅延読込制御、および Supabase正本のPC内高速キャッシュ
   ════════════════════════════════════════════════════════════════ */
// TODO(V2):
// IDB_CACHE は src/field/field_core.js・src/core/store.js・
// src/core/cloud.js からも参照される共有インフラのため、
// 将来的には core/idb_cache.js 等への分離を検討する。
/* ════════ 起動状態（Readiness Gate / 確認済み表示Snapshot） ════════════ */
window.APP_BOOT_STATE = window.APP_BOOT_STATE || {
  cloudSyncPending: false,
  initialRendered: false,
  renderedFromCache: false,
  lastCloudSyncAt: null,
  displayVerified: false,
  displaySnapshotAt: null
};

/* ════════ IndexedDB 高速キャッシュ（Supabase正本・PC内即時表示用） ════════════ */
const IDB_CACHE = window.IDB_CACHE = {
  _db: null,
  _timer: null,
  _dbName: 'mgmt5_center_cache_v2',
  _storeName: 'items',

  async _open() {
    if (this._db) return this._db;
    if (!('indexedDB' in window)) return null;
    this._db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this._storeName)) db.createObjectStore(this._storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._db;
  },

  _key(kind, id) { return `${CENTER.id}:${kind}:${id}`; },
  _indexKey(kind) { return `${CENTER.id}:__index:${kind}`; },

  async get(kind, id) {
    try {
      const db = await this._open();
      if (!db) return null;
      return await new Promise(resolve => {
        const tx = db.transaction(this._storeName, 'readonly');
        const req = tx.objectStore(this._storeName).get(this._key(kind, id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch(e) {
      console.warn('[IDB_CACHE] get failed', kind, id, e?.message || e);
      return null;
    }
  },

  async _readIndex(kind) {
    try {
      const db = await this._open();
      if (!db) return [];
      return await new Promise(resolve => {
        const tx = db.transaction(this._storeName, 'readonly');
        const req = tx.objectStore(this._storeName).get(this._indexKey(kind));
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result.filter(Boolean) : []);
        req.onerror = () => resolve([]);
      });
    } catch(e) { return []; }
  },

  async _scanIds(kind) {
    try {
      const db = await this._open();
      if (!db) return [];
      const prefix = `${CENTER.id}:${kind}:`;
      return await new Promise(resolve => {
        const ids = [];
        const tx = db.transaction(this._storeName, 'readonly');
        const req = tx.objectStore(this._storeName).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(ids);
          const key = String(cursor.key || '');
          if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
          cursor.continue();
        };
        req.onerror = () => resolve(ids);
      });
    } catch(e) { return []; }
  },

  async ids(kind) {
    const known = await this._readIndex(kind);
    const scanned = await this._scanIds(kind);
    return [...new Set([...known, ...scanned])].filter(Boolean).sort();
  },

  async set(kind, id, value) {
    try {
      const db = await this._open();
      if (!db) return false;
      const cleanId = String(id || '');
      if (!cleanId) return false;
      const currentIndex = await this._readIndex(kind);
      const nextIndex = currentIndex.includes(cleanId) ? currentIndex : [...currentIndex, cleanId].sort();
      await new Promise(resolve => {
        const tx = db.transaction(this._storeName, 'readwrite');
        const store = tx.objectStore(this._storeName);
        store.put(value, this._key(kind, cleanId));
        store.put(nextIndex, this._indexKey(kind));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      return true;
    } catch(e) {
      console.warn('[IDB_CACHE] set failed', kind, id, e?.message || e);
      return false;
    }
  },

  async remove(kind, id) {
    try {
      const db = await this._open();
      if (!db) return false;
      const cleanId = String(id || '');
      if (!cleanId) return false;
      const currentIndex = await this._readIndex(kind);
      const nextIndex = currentIndex.filter(x => x !== cleanId);
      await new Promise(resolve => {
        const tx = db.transaction(this._storeName, 'readwrite');
        const store = tx.objectStore(this._storeName);
        store.delete(this._key(kind, cleanId));
        store.put(nextIndex, this._indexKey(kind));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      return true;
    } catch(e) {
      console.warn('[IDB_CACHE] remove failed', kind, id, e?.message || e);
      return false;
    }
  },

  async _eachIndex(kind, localStorageKey, buildId, apply) {
    const ids = new Set();
    const index = (window.STORE && STORE._g) ? (STORE._g(localStorageKey) || []) : [];
    for (const meta of index) {
      const id = buildId(meta);
      if (id) ids.add(String(id));
    }
    for (const id of await this.ids(kind)) ids.add(String(id));

    let applied = 0;
    for (const id of ids) {
      const rec = await this.get(kind, id);
      if (rec) { apply(rec); applied++; }
    }
    return applied;
  },

  async hydrateState() {
    try {
      const t0 = performance.now();
      let datasets = 0;
      datasets = await this._eachIndex('dataset', 'dataset_index', m => m?.ym ? `${m.ym}_${m.type || 'confirmed'}` : null, rec => {
        if (rec && rec.ym) upsertDataset(rec);
      });

      const workers = [];
      const workerCount = await this._eachIndex('worker', 'field_worker_index', m => m?.ym || null, rec => {
        if (rec && rec.ym) workers.push(rec);
      });
      if (workers.length) STATE.workerCsvData = workers.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

      const products = [];
      const productCount = await this._eachIndex('product', 'field_product_index', m => m?.ym || null, rec => {
        if (rec && rec.ym) products.push(rec);
      });
      if (products.length) STATE.productAddressData = products.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

      const routes = [];
      const routeCount = await this._eachIndex('route', 'route_index', m => m?.ym || null, rec => {
        if (rec && rec.ym) routes.push(rec);
      });
      if (routes.length) STATE.routeData = routes.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

      // 重要：IndexedDBキャッシュは削除操作時にパージされない場合があるため、
      // 復元直後に必ず削除済みトゥームストーンを再適用する。
      // これをしないと「削除→リロード」で古いキャッシュから復活してしまう。
      if (typeof applyDeletionTombstonesToState === 'function') applyDeletionTombstonesToState(STATE);

      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
      window.__mgmtPerfLog(`[PERF] idb-hydrate ms=${Math.round(performance.now()-t0)} datasets=${datasets} workers=${workerCount} products=${productCount} routes=${routeCount}`);
      return { ok:true, datasets, workers:workerCount, products:productCount, routes:routeCount };
    } catch(e) {
      console.warn('[IDB_CACHE] hydrate failed', e?.message || e);
      return { ok:false, error:e?.message || String(e) };
    }
  },

  persistStateSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.persistState(), 300);
  },

  async persistState() {
    try {
      for (const ds of (STATE.datasets || [])) {
        if (ds && ds.ym) await this.set('dataset', `${ds.ym}_${ds.type || 'confirmed'}`, ds);
      }
      for (const rec of (STATE.workerCsvData || [])) {
        if (rec && rec.ym) await this.set('worker', rec.ym, rec);
      }
      for (const rec of (STATE.productAddressData || [])) {
        if (rec && rec.ym) await this.set('product', rec.ym, rec);
      }
      for (const rec of (STATE.routeData || [])) {
        if (rec && rec.ym) await this.set('route', rec.ym, rec);
      }
      return { ok:true };
    } catch(e) {
      console.warn('[IDB_CACHE] persist failed', e?.message || e);
      return { ok:false, error:e?.message || String(e) };
    }
  }
};

/* ════════════════════════════════════════════════════════════════
   14. Navigation
   ════════════════════════════════════════════════════════════════ */
/* ════════ §25 NAV ══════════════════════════════════════════════ */
/* ════════ §25 NAV / NAVGROUP / DELIVERY_NAV / DATA_MANAGEMENT_NAV は src/modules/navigation.js へ分離（互換ラッパー不要：既存呼び出しはすべてオブジェクト経由のため） ════════ */

/* ════════════════════════════════════════════════════════════════
   15. UI Helpers
   ════════════════════════════════════════════════════════════════ */
/* ════════ §26 UI（ヘルパー） は src/ui/ui_helpers.js へ分離 ════════ */

/* ════════════════════════════════════════════════════════════════
   16. Legacy Compatibility Stubs
   center.html の古いonclick参照等との互換維持用（現役・削除不可）
   ════════════════════════════════════════════════════════════════ */
/* ════════ §27 互換スタブ ══════════════════════════════════════ */
// 旧コードからの参照に対応（center.html の onclick など）
const DB = {
  exportJSON()   { STORE.exportJSON(); },
  importJSON(f)  { STORE.restoreJSON(f); },
  showStorageInfo() { renderImport(); NAV.go('import'); },
};
const DATA_RESET = {
  async clearFieldAll() {
    if (!confirm('作業者別CSV・商品住所CSVを全月削除しますか？\n収支CSV・収支補完・計画データは削除しません。')) return;
    const yms = new Set([
      ...(STATE.workerCsvData || []).map(d=>d?.ym),
      ...(STATE.productAddressData || []).map(d=>d?.ym)
    ].filter(Boolean));
    yms.forEach(ym => {
      if (typeof markDataDeleted === 'function') {
        markDataDeleted('workerMonths', ym);
        markDataDeleted('productMonths', ym);
        markDataDeleted('fieldMonths', ym);
      }
    });
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
    Repository.Storage.save();
    try {
      if (CLOUD?.pushAll) await SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true });
    } catch(e) {
      UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました: ' + e.message, 'warn');
    }
    if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh();
    NAV.refresh();
    UI.toast('作業者別CSV・商品住所CSVを全月削除しました');
  },
};
const SIMPLE_STORE = {
  debug() { console.log('STATE', STATE); console.log('STORE keys', STORE._p, Object.keys(localStorage).filter(k=>k.startsWith(STORE._p))); UI.toast('コンソールにSTATEをダンプしました'); },
  restoreAll() { Repository.Storage.load(); return STATE.datasets.length; },
};
const CLOUD_DEBUG = { run() { CLOUD.saveConfig(); } };
const PUBLISH = { go() { UI.toast('GitHub Pages での公開はHTMLファイルを直接アップロードしてください'); } };

// 計画データ取込（PLAN）
const PLAN = {
  async importParsed(plan, fy, sourceMeta={}) {
    fy = String(fy || getSelectedFiscalYear('plan-year-sel'));
    if (!plan || typeof plan !== 'object' || !Object.keys(plan).length) { UI.toast('計画データを解析できませんでした','warn'); return false; }
    if (STATE.planData[fy]) {
      const src = sourceMeta.source_type === 'SKFL0001_PDF' ? 'SKFL0001 PDF' : '今回のデータ';
      const ok = confirm(`${fy}年度の計画データは既に登録されています。\n\n${src}で、${fy}年度の計画データをすべて入れ替えますか？\n\n※差分追加ではありません。既存の${fy}年度計画を削除してから登録します。`);
      if (!ok) return false;
      delete STATE.planData[fy];
    }
    clearDataDeleted('planFiscalYears', fy);
    STATE.planData[fy] = { rows: plan, fiscalYear: fy, importedAt: new Date().toISOString(), itemCount: Object.keys(plan).length, unit:'千円', mode:'full_replace', monthStatus: Object.assign({}, sourceMeta?.month_status||{}), coverage: sourceMeta?.coverage||'UNKNOWN', sourceMeta: Object.assign({}, sourceMeta||{}) };
    Repository.Storage.save();
    const count = Object.keys(plan).length;
    renderImport(); NAV.refresh();
    try { const r=await SYNC_COORDINATOR.syncSmart(); if(r&&r.ok) UI.toast(`${fy}年度 計画データを完全入替し、クラウド同期しました（${count}科目）`); else UI.toast(`${fy}年度 計画データは保存しましたが、クラウド同期に失敗しました`,'warn'); }
    catch(_e){ UI.toast(`${fy}年度 計画データは保存しましたが、クラウド同期に失敗しました`,'warn'); }
    return true;
  },
  async importFromPaste() {
    const fy = getSelectedFiscalYear('plan-year-sel');
    const text = document.getElementById('plan-paste-area')?.value||'';
    const msg  = document.getElementById('plan-import-msg');
    if (!text.trim()) { UI.toast('貼付欄が空です','warn'); if (msg) msg.textContent = '貼付欄が空です'; return; }
    const plan = CSV.parsePlan(text);
    if (!plan) { UI.toast('計画データを解析できませんでした。タブ区切りでペーストしてください。','warn'); if (msg) msg.textContent = '解析失敗'; return; }
    const ok=await this.importParsed(plan,fy,{source_type:'PASTE_TEXT'});
    if(ok!==false){ const area=document.getElementById('plan-paste-area'); if(area)area.value=''; if(msg)msg.textContent=`${fy}年度 完全入替完了: ${Object.keys(plan).length}科目`; }
  },
  clear() {
    const fy = getSelectedFiscalYear('plan-year-sel');
    if (!STATE.planData[fy]) { UI.toast(`${fy}年度の計画データは未登録です`, 'warn'); return; }
    if (!confirm(`${fy}年度の計画データを削除しますか？\n他年度は削除しません。`)) return;
    markDataDeleted('planFiscalYears', fy);
    delete STATE.planData[fy];
    applyDeletionTombstonesToState(STATE);
    Repository.Storage.save();
    const msg = document.getElementById('plan-import-msg');
    if (msg) msg.textContent = `${fy}年度の計画データを削除しました`;
    renderImport();
    NAV.refresh();
    if (CLOUD?.pushAll) SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true }).catch(()=>UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました', 'warn'));
    UI.toast(`${fy}年度の計画データを削除しました`);
  },
};

// TSVペースト取込（過去実績補完）
const TSV_IMPORT = {
  doImportHistory() {
    const text = document.getElementById('tsv-paste-area-history')?.value||'';
    const fy = getSelectedFiscalYear('tsv-year-sel-history');
    const msg = document.getElementById('tsv-import-msg-history');
    if (!text.trim()) { UI.toast('貼付欄が空です','warn'); if (msg) msg.textContent='貼付欄が空です'; return; }

    const existing = STATE.datasets.filter(d => d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (existing.length) {
      const ok = confirm(`${fy}年度の収支補完データは既に${existing.length}件登録されています。\n\n今回の貼付データで、${fy}年度の収支補完データをすべて入れ替えますか？\n\n※差分追加ではありません。既存の${fy}年度補完データを削除してから登録します。\n※通常CSVの速報・確定データは削除しません。`);
      if (!ok) return;
    }

    const rows = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
      .filter(l=>l.trim()).map(l=>l.split(/\t/));
    if (!rows.length) { UI.toast('データが空です','warn'); return; }

    // 年度の収支補完のみ全削除。通常CSVは残す。
    clearDataDeleted('historyFiscalYears', fy);
    monthsOfFiscalYear(fy).forEach(ym => clearDataDeleted('historyMonths', ym));
    STATE.datasets = STATE.datasets.filter(d => !(d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));

    const months = ['04','05','06','07','08','09','10','11','12','01','02','03'];
    let imported = 0;
    for (let mi=0; mi<months.length; mi++) {
      const mm = months[mi];
      const colIdx = planMonthCol(mm);
      const dsRows = {};
      for (const row of rows) {
        const label = (row[0]||'').replace(/[\s　]/g,'');
        const ALL = new Set([...CONFIG.INCOME_KEYS,...CONFIG.EXPENSE_KEYS, ...CONFIG.INCOME_SUB_KEYS]);
        if (!ALL.has(label)) continue;
        const v = parseFloat((row[colIdx]||'').replace(/,/g,''));
        // 収支補完は元データが「千円」単位のため、変換せず千円のまま保持する
        if (!isNaN(v) && v!==0) dsRows[label] = v;
      }
      if (Object.keys(dsRows).length > 0) {
        const year = parseInt(mm)>=4 ? fy : String(parseInt(fy)+1);
        const ym = year+mm;
        const ds = processDataset(ym,'confirmed',dsRows);
        ds.source = 'history';
        ds.fileName = '収支補完';
        ds.fiscalYear = fy;
        ds.unit = '千円';
        ds.importedAt = new Date().toISOString();
        upsertDataset(ds);
        imported++;
      }
    }
    Repository.Storage.save();
    NAV.refresh();
    if (msg) msg.textContent = `${fy}年度 完全入替完了: ${imported}ヶ月`;
    if (CLOUD?.pushAll) SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true }).catch(()=>UI.toast('収支補完は保存しましたが、クラウド同期に失敗しました', 'warn'));
    UI.toast(`${fy}年度 収支補完 ${imported}ヶ月を完全入替しました`);
  },
  doClearHistory() {
    const fy = getSelectedFiscalYear('tsv-year-sel-history');
    const rows = STATE.datasets.filter(d => d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (!rows.length) { UI.toast(`${fy}年度の収支補完データは未登録です`, 'warn'); return; }
    if (!confirm(`${fy}年度の収支補完データ ${rows.length}件を削除しますか？\n※通常CSVで取り込んだデータは削除しません。`)) return;
    const before = STATE.datasets.length;
    markDataDeleted('historyFiscalYears', fy);
    STATE.datasets = STATE.datasets.filter(d => !(d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));
    applyDeletionTombstonesToState(STATE);
    Repository.Storage.save();
    const deleted = before - STATE.datasets.length;
    renderImport();
    NAV.refresh();
    if (CLOUD?.pushAll) SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true }).catch(()=>UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました', 'warn'));
    UI.toast(`${fy}年度 収支補完 ${deleted}件を削除しました`);
  }
};

// 現場データ取込2（インポート画面の2つ目のゾーン）

// 現場データリスト更新・削除処理は field.js に分割

/* ════════════════════════════════════════════════════════════════
   17. Upload Zone / Plan Import / Screen Module Loader
   ════════════════════════════════════════════════════════════════ */
/* ════════ §28-30A アップロードゾーン設定・計画データ取込・画面別モジュール読込 は src/core/loader.js へ分離 ════════ */

/* ════════════════════════════════════════════════════════════════
   18. Application Boot
   全体を繋ぐ起動処理。ここは分離せず1箇所にまとめておくことを推奨。
   ════════════════════════════════════════════════════════════════ */
/* ════════ §30 BOOT ═════════════════════════════════════════════ */
function setupFieldImportYMControls(){}
document.addEventListener('DOMContentLoaded', async () => {
  window.STARTUP_PROFILER?.start?.();
  window.STARTUP_PROFILER?.mark?.('DOMContentLoaded');
  let _bootRendered = false;

  function _hideOverlay() {
    const ov = document.getElementById('app-loading-overlay');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 400);
  }

  function _bootRender(view) {
    if (_bootRendered) return;
    _bootRendered = true;
    NAV.go(view);
    UI.updateTopbar(view);
    UI.updateSaveStatus();
    _hideOverlay();
  }

  try {
    STARTUP_READINESS?.setProgress(1, '起動準備中です', '画面機能とローカル設定を準備しています。');

    // 0. 画面別モジュール読込
    await window.STARTUP_PROFILER?.measure?.('画面モジュール読込', () => loadScreenModules()) ?? await loadScreenModules();

    // 1. ローカル設定・キャッシュは復元するが、起動Gate通過前には画面へ描画しない。
    window.STARTUP_PROFILER?.begin?.('ローカルStorage復元');
    Repository.Storage.load();
    window.STARTUP_PROFILER?.end?.('ローカルStorage復元');
    if (window.APP_BOOT_STATE) APP_BOOT_STATE.cloudSyncPending = true;

    // D4-11: 通常起動で必須の「Cloud Manifest確認」と「IndexedDB復元」は独立処理。
    // 先にManifest取得を開始し、IndexedDB復元と並列で進める。
    // 数字の描画は従来どおり両方の検証完了後なのでReadiness Gateは弱めない。
    window.STARTUP_PROFILER?.wrapCloudRepository?.();
    const _bootManifestPromise = (window.CLOUD_REPOSITORY?.fetchManifestWithDbFallback)
      ? Promise.resolve().then(() => CLOUD_REPOSITORY.fetchManifestWithDbFallback())
      : null;

    if (window.IDB_CACHE?.hydrateState) await window.STARTUP_PROFILER?.measure?.('IndexedDB復元', () => IDB_CACHE.hydrateState()) ?? await IDB_CACHE.hydrateState();
    if (window.APP_BOOT_STATE) {
      APP_BOOT_STATE.renderedFromCache = false;
      APP_BOOT_STATE.displayVerified = false;
    }

    AUTO_SYNC.install();
    document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
    document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent='補助取込・設定');

    setupDropZone('upload-zone', 'file-input', f=>IMPORT.handleFiles(f));
    setupDropZone('field-upload-zone', 'field-file-input', f=>{
      if (window.FIELD_WORKER_IMPORT2 && FIELD_WORKER_IMPORT2.handleFiles) FIELD_WORKER_IMPORT2.handleFiles(f);
      else IMPORT.handleFiles(f);
    });
    setupDropZone('field-upload-zone2', 'field-file-input2', f=>{
      if (window.FIELD_PRODUCT_IMPORT2 && FIELD_PRODUCT_IMPORT2.handleFiles) FIELD_PRODUCT_IMPORT2.handleFiles(f);
      else IMPORT.handleFiles(f);
    });

    const loadInput = document.getElementById('session-load-input');
    if (loadInput) loadInput.onchange = () => { STORE.restoreJSON(loadInput.files[0]); loadInput.value=''; };
    CAPACITY_UI.populateYMSel();
    setupPlanImport();
    initFiscalYearSelects();
    setupFieldImportYMControls();

    const _lastView = (() => {
      try {
        const v = sessionStorage.getItem('lastView') || 'dashboard';
        return document.getElementById('view-' + v) ? v : 'dashboard';
      } catch(e){ return 'dashboard'; }
    })();

    CLOUD.renderForm();
    UI.updateSaveStatus();

    // 2. 主要Cloudデータを確認。ここが完了するまで数値画面は一切表示しない。
    STARTUP_READINESS?.setProgress(2, '最新データを確認しています', 'クラウドのCURRENTデータと主要状態を確認しています。');
    let pullResult = await window.STARTUP_PROFILER?.measure?.('Startup同期合計', () => STARTUP_READINESS.withTimeout(
      () => AUTO_SYNC.withoutSyncAsync(async () => SYNC_COORDINATOR.syncBoot(_lastView, { manifestPromise:_bootManifestPromise })),
      45000
    )) ?? await STARTUP_READINESS.withTimeout(
      () => AUTO_SYNC.withoutSyncAsync(async () => SYNC_COORDINATOR.syncBoot(_lastView, { manifestPromise:_bootManifestPromise })),
      45000
    );

    if (window.APP_BOOT_STATE) {
      APP_BOOT_STATE.cloudSyncPending = false;
      if (pullResult?.ok) APP_BOOT_STATE.lastCloudSyncAt = pullResult.verifiedAt || new Date().toISOString();
    }

    // 3. 失敗・不足・タイムアウト時はキャッシュ数値を見せず、状況を明示して停止する。
    if (!pullResult || !pullResult.ok || pullResult.readiness !== 'READY') {
      UI.updateCloudBadge?.('error');
      STARTUP_READINESS.showFailure(pullResult || {stage:'BOOT',readiness:'LOAD_FAILED',error:'起動結果を確認できませんでした'});
      return;
    }

    STARTUP_READINESS?.setProgress(3, '表示データを確定しています', '取得したデータを反映し、表示スナップショットを固定しています。');
    if (window.IDB_CACHE?.persistStateSoon) IDB_CACHE.persistStateSoon();

    // Gate通過後に初めて画面を描画する。以後この表示は起動時Snapshotとして扱う。
    STARTUP_READINESS.markVerified(pullResult.verifiedAt || new Date().toISOString());
    STARTUP_READINESS?.setProgress(4, '準備ができました', '確認済みデータで画面を表示します。');
    window.STARTUP_PROFILER?.begin?.('初回画面描画');
    _bootRender(_lastView);
    window.STARTUP_PROFILER?.end?.('初回画面描画');
    window.STARTUP_PROFILER?.finish?.({ pullResult, view:_lastView });

  } catch(e) {
    console.error('[BOOT] 起動処理エラー:', e);
    if (window.APP_BOOT_STATE) APP_BOOT_STATE.cloudSyncPending = false;
    UI.updateCloudBadge?.('error');
    STARTUP_READINESS?.showFailure({stage:'BOOT',readiness:'LOAD_FAILED',error:e?.message || String(e)});
  }
});
