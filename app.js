/* 計画データTSV読取修正版 v11 2026-04-28
   ・計画貼付データをCSVではなくタブ区切りで解析
   ・17,356 のカンマを列分割しない
   ・計画データは千円保持のまま
*/
/* 計画親項目集計修正版 v10 2026-04-28
   ・計画の親項目は子科目合計を優先
   ・同名科目のゼロ行上書きを防止
*/
/* 単位修正＋重複確認版 2026-04-28
   ・CSV=円、計画/収支補完=千円保持
   ・収支補完は表示時だけ円換算して既存グラフ/KPIに合わせる
   ・重複・異常データ確認表を追加
*/
/* ダッシュボード年度・月選択追加版 2026-04-28
   ・ダッシュボードに対象年度/対象月プルダウンを追加
   ・CSV確定/CSV速報/収支補完の表示ラベルを分離
   ・初期表示は最新月
   ・年度順（4月→翌年3月）で月を管理
   ・今回の対象はダッシュボードのみ
*/
/* 計画データ横持ち形式・科目マッピング修正版 v9 2026-04-28
   ・計画データは『科目名＋年度合計＋4月〜9月＋上期計＋10月〜3月＋下期計』形式を前提
   ・システム側の科目名を計画データ側へ寄せる
   ・月次収支表の計画/差異/達成率を千円基準で整合
*/
/* 速報・確定両保持版 2026-04-27
   ・同一年月で速報値と確定値を別々に保持
   ・ダッシュボード/分析は確定優先、確定がなければ速報
   ・入替/削除は年月＋区分単位
*/
/* 完全復旧版＋取込区分手動選択 2026-04-27\n   ・取込履歴を詳細表示\n   ・同月取込は確認して入替\n   ・履歴から入替/削除可能\n\n/* 金額単位修正版 2026-04-27\n   CSV=円、計画=千円→内部は円で統一\n════════════════════════════════════════════════════════════════\n\n/* データ保管場所対応表 安定版 2026-04-28
   ・対応表を読込済みデータ欄の先頭に直接表示
   ・計画/収支補完は千円単位のまま保持
   ・CSVは円単位のまま保持
   ・年度単位で完全入替

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
  },};

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

  COLORS: ['#1a4d7c','#e05b4d','#1a7a52','#b45309','#2563eb','#7c3aed','#0891b2','#be185d','#65a30d','#d97706'],
  VIEW_TITLES: {
    dashboard:'ダッシュボード', pl:'月次収支表', trend:'売上推移',
    shipper:'荷主分析', indicators:'経営指標', annual:'年次サマリー',
    alerts:'アラート', memo:'メモ・コメント', report:'会議報告書',
    library:'過去資料', field:'作業者・エリア分析',
    'field-worker':'作業者分析', 'field-content':'作業内容分析', 'field-product':'商品カテゴリ分析', 'field-area':'エリア分析',
    capacity:'キャパ分析', import:'データ取込',
    kamoku:'収支科目 詳細分析',
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

/* ════════ §4 STORE（storage.jsへ分割） ════════════════ */

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
  },};

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


/* ════════ §6.5 取込ガード（重複・月違い・センター違い警告） ══════════════ */
const DATA_IMPORT_GUARD = {
  fileSig(file) {
    if (!file) return '';
    return [file.name || '', file.size || 0, file.lastModified || 0].join('|');
  },
  fileNames(files) { return Array.from(files || []).map(f => f?.name || '').filter(Boolean); },
  extractYMFromName(name) {
    const str = String(name || '');
    let m = str.match(/(20\d{2})[-_年\/]?\s*(0?[1-9]|1[0-2])(?:月)?/);
    if (m) return `${m[1]}${String(m[2]).padStart(2,'0')}`;
    m = str.match(/(0?[1-9]|1[0-2])月/);
    if (m) {
      const y = String(document.getElementById('modal-year')?.value || new Date().getFullYear());
      return `${y}${String(m[1]).padStart(2,'0')}`;
    }
    return '';
  },
  centerNameWarning(names) {
    const current = String(CENTER?.name || '').replace(/センター$/,'');
    const centers = ['戸田','北埼玉','南埼玉','船橋','練馬','群馬','さいたま','東松山','静岡','東北','三河'];
    const hits = [];
    names.forEach(name => {
      centers.forEach(c => {
        if (c !== current && String(name).includes(c)) hits.push(`${name}：${c}`);
      });
    });
    return [...new Set(hits)];
  },
  buildWarnings({ kind, ym, type, files, existingRecord }) {
    const names = this.fileNames(files);
    const warnings = [];
    const kindLabel = kind || 'CSV';
    if (!ym || !/^20\d{4}$/.test(String(ym))) warnings.push('取込年月が正しく選択されていません。');
    if (names.length > 1 && kind === '収支CSV') warnings.push('収支CSVが複数選択されています。同じ年月・同じ区分では最後のファイルで上書きされる可能性があります。');
    names.forEach(name => {
      const fileYM = this.extractYMFromName(name);
      if (fileYM && ym && fileYM !== ym) warnings.push(`ファイル名の年月（${ymLabel(fileYM)}）と選択年月（${ymLabel(ym)}）が違う可能性があります：${name}`);
    });
    this.centerNameWarning(names).forEach(x => warnings.push(`ファイル名に別センター名らしき文字があります：${x}`));
    if (existingRecord) {
      warnings.push(`${ymLabel(ym)}の${kindLabel}${type ? `（${type === 'daily' ? '速報' : '確定'}）` : ''}は既に登録済みです。続行すると入替になります。`);
      const oldNames = [existingRecord.fileName, ...(existingRecord.files || [])].filter(Boolean);
      const sameName = names.find(n => oldNames.includes(n));
      if (sameName) warnings.push(`同じファイル名が既に取り込まれています：${sameName}`);
    }
    return [...new Set(warnings)];
  },
  confirm(opts) {
    const warnings = this.buildWarnings(opts || {});
    if (!warnings.length) return true;
    const title = `${opts.kind || 'CSV'}取込前の確認`;
    return confirm(`${title}

${warnings.map((w,i)=>`${i+1}. ${w}`).join('\n')}

このまま取込を続行しますか？`);
  }
};
window.DATA_IMPORT_GUARD = DATA_IMPORT_GUARD;

/* ════════ §7 IMPORT ════════════════════════════════════════════ */
const IMPORT = {
  _pending: [],
  _replaceYM: null,
  _replaceType: null,

  handleFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const csv  = arr.filter(f=>/\.csv$/i.test(f.name));
    // 入替モード：年月選択モーダルを出さず、指定済みYMへ直接差替
    if (csv.length && this._replaceYM) {
      const ym = this._replaceYM;
      const type = this._replaceType || 'confirmed';
      this._replaceYM = null;
      this._replaceType = null;
      // 入替時は元の区分を維持する
      document.querySelectorAll('input[name="manual-import-type"]').forEach(r => { r.checked = (r.value === type); });
      this.processCSV(csv, ym, { replace:true }).catch(e=>UI.toast(e.message,'error'));
      return;
    }

    if (csv.length)  { this._pending = csv; MODAL.openYM(csv); return; }
    UI.toast('対応形式：CSV（収支・現場明細）','warn');
  },

  async processCSV(files, ym, opt={}) {
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    const selectedType = document.querySelector('input[name="manual-import-type"]:checked')?.value;
    const importType = selectedType === 'daily' ? 'daily' : 'confirmed';
    const existing = STATE.datasets.find(d => d.ym === ym && (d.type || 'confirmed') === importType && d.source !== 'history');

    if (!opt.replace) {
      const ok = DATA_IMPORT_GUARD.confirm({
        kind:'収支CSV',
        ym,
        type: importType,
        files,
        existingRecord: existing
      });
      if (!ok) {
        UI.toast('取込を中止しました', 'warn');
        return;
      }
    }

    let imported = 0;
    const importErrors = [];
    for (const f of files) {
      try {
        const text = await CSV.read(f);
        const rows = CSV.parseSKDL(text, monthCol);
        if (!rows) {
          importErrors.push(`${f.name}: データ行が見つかりません`);
          UI.toast(`${f.name}: データ行が見つかりません`,'warn', { title:'取込確認' });
          continue;
        }
        const type = importType;
        const ds = processDataset(ym, type, rows);
        ds.source = 'csv';
        ds.fileName = f.name;
        ds.fileSig = DATA_IMPORT_GUARD.fileSig(f);
        ds.fiscalYear = fiscalYearFromYM(ym);
        ds.unit = '円';
        ds.replacedAt = existing ? new Date().toISOString() : null;

        // 差替時は同じ年月＋同じ区分だけ削除してから入れる（速報と確定は両方保持）
        STATE.datasets = STATE.datasets.filter(d => !(d.ym === ym && (d.type || 'confirmed') === type && d.source !== 'history'));
        upsertDataset(ds);
        imported++;
      } catch(e) {
        const msg = errorMessage(e);
        importErrors.push(`${f.name}: ${msg}`);
        UI.toast(`${f.name} の取込に失敗しました`, 'error', { title:'CSV取込エラー', detail: msg });
      }
    }
    if (importErrors.length) {
      console.warn('CSV import errors', importErrors);
      UI.toast(`${importErrors.length}件の取込エラーがあります`, 'warn', { title:'取込結果確認', detail: importErrors.slice(0,5).join('\n') + (importErrors.length > 5 ? '\n...' : '') });
    }
    if (imported > 0) {
      STORE.save();
      CLOUD.pushMonth(ym).catch(e=>UI.toast('CSVは保存しましたが、クラウド同期に失敗しました', 'warn', { title:'同期確認', detail:errorMessage(e) })); // 取込月だけ自動同期
      NAV.refresh();
      UI.toast(`${imported}件取込完了（${ymLabel(ym)}）`, 'ok', { title:'CSV取込完了' });
      UI.updateSaveStatus();
    }
  },

  async deleteDataset(ym, type) {
    type = type || 'confirmed';
    const ds = STATE.datasets.find(d=>d.ym===ym && (d.type || 'confirmed') === type && d.source !== 'history');
    const typeLabel = type === 'daily' ? '速報' : '確定';
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
    STORE.save();
    try {
      if (CLOUD?.deleteFile) await CLOUD.deleteFile(CLOUD._datasetKey(ym, type));
      if (CLOUD?.pushAll) await CLOUD.pushAll();
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

    const typeLabel = type === 'daily' ? '速報' : '確定';
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

/* ════════ §9 CLOUD（sync.jsへ分割） ════════════════ */

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
function safeLocalGet(key) { try { return localStorage.getItem(key); } catch(e) { return ''; } }
function safeLocalSet(key, value) { try { localStorage.setItem(key, String(value)); } catch(e) {} }
function safeLocalRemove(key) { try { localStorage.removeItem(key); } catch(e) {} }
function errorMessage(e) { return (e && (e.message || e.error_description || e.details)) ? String(e.message || e.error_description || e.details) : String(e || '不明なエラー'); }

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
  if (!ds) return 'none';
  if (ds.source === 'history') return 'history';
  if (ds.type === 'daily') return 'daily';
  if (ds.source === 'csv' || !ds.source) return 'confirmed';
  return ds.type || ds.source || 'confirmed';
}
function datasetKindLabel(ds) {
  const kind = datasetSourceKind(ds);
  if (kind === 'history') return '補完';
  if (kind === 'daily') return '速報';
  if (kind === 'confirmed') return '確定';
  return '不明';
}
function datasetPriority(ds) {
  // 同じ年月では、正式CSV確定 > CSV速報 > 収支補完 の順で表示・分析に使う。
  // 補完はCSV未登録月を埋めるための参考値であり、確定とは表示しない。
  const kind = datasetSourceKind(ds);
  if (kind === 'confirmed') return 30;
  if (kind === 'daily') return 20;
  if (kind === 'history') return 10;
  return 0;
}
function activeDatasets() {
  // 表示・分析用：同じ年月に複数データがある場合は、CSV確定 > CSV速報 > 収支補完 の順で優先する
  // 削除済みマーカーは、画面描画のたびに必ず適用する。
  applyDeletionTombstonesToState(STATE);
  const map = {};
  for (const d of STATE.datasets || []) {
    if (!d || !d.ym) continue;
    const current = map[d.ym];
    if (!current) {
      map[d.ym] = d;
      continue;
    }
    const curPriority = datasetPriority(current);
    const newPriority = datasetPriority(d);
    if (newPriority > curPriority) {
      map[d.ym] = d;
    } else if (newPriority === curPriority && String(d.importedAt || '') > String(current.importedAt || '')) {
      map[d.ym] = d;
    }
  }
  return Object.values(map).sort((a,b)=>a.ym.localeCompare(b.ym)).map(normalizeDatasetForDisplay);
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


function selectedYMForImport() {
  // 取込時の年月は画面で選択している年度・月を最優先にする。
  return dashboardSelectedYM() || STATE.selYM || latestDS()?.ym || null;
}

function selectedFiscalYearForImport() {
  return dashboardSelectedFiscalYear() || STATE.fiscalYear || getDefaultFiscalYear();
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

function renderCommonPeriodSelector(viewKey, opt={}) {
  const view = document.getElementById('view-' + viewKey);
  if (!view) return;

  // 年度推移・年度指標系は「対象年度」だけに統一する。
  // 月を選んでも年度内の先月まで表示されるように見える誤解を防ぐため。
  const yearOnlyViews = new Set(['trend','indicators','annual']);
  const useMonth = opt.useMonth !== false && !yearOnlyViews.has(viewKey);
  const boxId = `${viewKey}-period-selector`;
  let box = document.getElementById(boxId);
  if (!box) {
    box = document.createElement('div');
    box.id = boxId;
    view.prepend(box);
  }

  const years = dashboardAvailableFiscalYears();
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const selectedYM = dashboardSelectedYM();

  const monthOptions = months.map(ym => {
    const ds = activeDatasetByYM(ym);
    const fds = (STATE.fieldData || []).find(d => d.ym === ym);
    const hasData = viewKey === 'field' ? !!fds : !!ds;
    const label = viewKey === 'field'
      ? (fds ? `${ymLabel(ym)}（現場明細あり）` : `${ymLabel(ym)}（未登録）`)
      : (ds ? `${ymLabel(ym)}（${datasetKindLabel(ds)}）` : `${ymLabel(ym)}（未登録）`);
    return `<option value="${ym}" ${ym===selectedYM?'selected':''} ${hasData?'':'disabled'}>${label}</option>`;
  }).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
      <div>
        <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">表示対象</div>
        <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / ${useMonth?'年度・月を共通管理':'年度内推移を表示'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
          <select id="${viewKey}-fy-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800">
            ${years.map(y=>`<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('')}
          </select>
        </label>
        ${useMonth ? `
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
          <select id="${viewKey}-ym-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:190px">
            ${monthOptions || '<option value="">データなし</option>'}
          </select>
        </label>` : ''}
      </div>
    </div>`;

  const fySel = document.getElementById(`${viewKey}-fy-select`);
  const ymSel = document.getElementById(`${viewKey}-ym-select`);

  if (fySel) fySel.onchange = () => {
    STATE.fiscalYear = fySel.value;
    const monthsInFY = monthsOfFiscalYear(STATE.fiscalYear);
    const list = viewKey === 'field'
      ? monthsInFY.filter(ym => (STATE.fieldData || []).some(d => d.ym === ym))
      : monthsInFY.filter(ym => activeDatasetByYM(ym));
    STATE.selYM = list.length ? list[list.length - 1] : null;
    NAV.refresh();
  };

  if (ymSel) ymSel.onchange = () => {
    if (ymSel.value) STATE.selYM = ymSel.value;
    NAV.refresh();
  };
}
function renderDashboardSelector() {
  const area = document.getElementById('kpi-area');
  if (!area || !area.parentNode) return;

  let box = document.getElementById('dashboard-period-selector');
  if (!box) {
    box = document.createElement('div');
    box.id = 'dashboard-period-selector';
    area.parentNode.insertBefore(box, area);
  }

  const years = dashboardAvailableFiscalYears();
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const selectedYM = dashboardSelectedYM();
  const monthOptions = months.map(ym => {
    const ds = activeRealCsvDatasetByYM(ym);
    const label = ds ? `${ymLabel(ym)}（${datasetKindLabel(ds)}）` : `${ymLabel(ym)}（未登録）`;
    return `<option value="${ym}" ${ym===selectedYM?'selected':''} ${ds?'':'disabled'}>${label}</option>`;
  }).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
      <div>
        <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">表示対象</div>
        <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / ダッシュボードのみ切替</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
          <select id="dashboard-fy-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800">
            ${years.map(y=>`<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
          <select id="dashboard-ym-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:190px">
            ${monthOptions || '<option value="">データなし</option>'}
          </select>
        </label>
      </div>
    </div>`;

  const fySel = document.getElementById('dashboard-fy-select');
  const ymSel = document.getElementById('dashboard-ym-select');
  if (fySel) fySel.onchange = () => {
    STATE.fiscalYear = fySel.value;
    const list = monthsOfFiscalYear(STATE.fiscalYear).filter(ym => activeRealCsvDatasetByYM(ym));
    STATE.selYM = list.length ? list[list.length - 1] : null;
    renderDashboard();
    UI.updateTopbar('dashboard');
  };
  if (ymSel) ymSel.onchange = () => {
    if (ymSel.value) STATE.selYM = ymSel.value;
    renderDashboard();
    UI.updateTopbar('dashboard');
  };
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
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return String(m >= CONFIG.FISCAL_START ? y : y - 1);
}
function fiscalYearFromYM(ym) {
  if (!ym || String(ym).length < 6) return getDefaultFiscalYear();
  const y = parseInt(String(ym).slice(0,4),10);
  const m = parseInt(String(ym).slice(4,6),10);
  return String(m >= CONFIG.FISCAL_START ? y : y - 1);
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
  return pack ? pack.rows : null;
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

function mergeDatasetsByImportedAt(localList, cloudList) {
  const map = {};
  [...(localList || []), ...(cloudList || [])].forEach(d => {
    if (!d || !d.ym) return;
    const key = `${d.ym}_${d.type || 'confirmed'}`;
    const old = map[key];
    if (!old || String(d.importedAt || d.updatedAt || '') >= String(old.importedAt || old.updatedAt || '')) {
      map[key] = d;
    }
  });
  return Object.values(map).sort((a,b) => {
    const ym = String(a.ym || '').localeCompare(String(b.ym || ''));
    if (ym !== 0) return ym;
    return String(a.type || '').localeCompare(String(b.type || ''));
  });
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
  ['library-fy','library-bulk-fy','report-fy','plan-year-sel','tsv-year-sel-history'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const current = el.value || defaultFY;
    el.innerHTML = '';
    for (let y=now.getFullYear()+1; y>=2020; y--) {
      el.innerHTML += `<option value="${y}">${y}年度</option>`;
    }
    el.value = [...el.options].some(o=>o.value===current) ? current : defaultFY;
  });
  STATE.fiscalYear = document.getElementById('plan-year-sel')?.value || defaultFY;
  const planSel = document.getElementById('plan-year-sel');
  if (planSel) planSel.onchange = () => updateFiscalInputState('plan');
  const histSel = document.getElementById('tsv-year-sel-history');
  if (histSel) histSel.onchange = () => updateFiscalInputState('history');
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


/* ════════ §11.5 ANALYTICS_UI（分析画面 共通UI部品） ════════════════════════ */
const ANALYTICS_UI = {
  noData(message, extraStyle='') {
    return `<div style="grid-column:1/-1;${extraStyle}" class="msg msg-info">${esc(message || 'データがありません')}</div>`;
  },
  kpiCard({label, value, unit='', accent='accent-navy', valueClass='', sub='', pill='', pillClass='flat'}) {
    const unitHtml = unit ? `<span style="font-size:13px;font-weight:400">${esc(unit)}</span>` : '';
    const subHtml = sub ? `<span class="kpi-sub">${sub}</span>` : '';
    const pillHtml = pill ? `<span class="pill ${esc(pillClass)}">${pill}</span>` : '';
    const footer = (subHtml || pillHtml) ? `<div class="kpi-sub-row">${subHtml}${pillHtml}</div>` : '';
    return `
      <div class="kpi-card ${esc(accent)}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value ${esc(valueClass)}">${value}${unitHtml}</div>
        ${footer}
      </div>`;
  },
  kpiGrid(cards, cols=4, extraStyle='') {
    const cls = cols === 3 ? 'kpi-row kpi-row-3' : 'kpi-row';
    return `<div class="${cls}" style="${extraStyle}">${cards.join('')}</div>`;
  },
  card(title, body, opts={}) {
    const style = opts.style || '';
    const subtitle = opts.subtitle ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${opts.subtitle}</div>` : '';
    return `<div class="card" style="${style}"><div class="card-header"><div><span class="card-title">${title}</span>${subtitle}</div></div><div class="card-body">${body}</div></div>`;
  },
  progressRows(items, {maxValue=null, denominator=null, empty='データがありません'}={}) {
    const rows = (items || []).filter(item => item && n(item.value) > 0);
    if (!rows.length) return `<div style="padding:10px;font-size:12px;color:var(--text3)">${esc(empty)}</div>`;
    const max = maxValue || Math.max(...rows.map(item => n(item.value)), 1);
    const den = denominator || rows.reduce((sum, item) => sum + n(item.value), 0) || 1;
    return `<div style="display:grid;gap:7px">${rows.map((item, i) => {
      const value = n(item.value);
      const width = (value / max * 100).toFixed(1);
      const rate = den > 0 ? (value / den * 100) : 0;
      return `
        <div style="display:grid;grid-template-columns:120px 1fr 96px;gap:8px;align-items:center">
          <div style="font-size:12px;font-weight:700;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.label)}">${esc(item.label)}</div>
          <div style="height:14px;background:#e5e7eb;border-radius:999px;overflow:hidden">
            <div style="height:100%;width:${width}%;background:${CONFIG.COLORS[i%CONFIG.COLORS.length]};border-radius:999px"></div>
          </div>
          <div style="font-size:12px;font-weight:800;text-align:right;white-space:nowrap">${fmtK(value)}千 <span style="color:var(--text3);font-weight:700">${rate.toFixed(1)}%</span></div>
        </div>`;
    }).join('')}</div>`;
  },
  basicMoneyTrendOptions(yTitle='千円') {
    return {
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{position:'top'}, tooltip:{mode:'index'}},
      scales:{y:{title:{display:true,text:yTitle},grid:{color:'#f0f0f0'}}}
    };
  }
};

/* ════════ §12 RENDER — Dashboard ══════════════════════════════ */
function renderDashboard() {
  const area = document.getElementById('kpi-area');
  if (!area) return;
  renderDashboardSelector();
  const ds = selectedDashboardDS();

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

  area.innerHTML = ANALYTICS_UI.kpiGrid([
    ANALYTICS_UI.kpiCard({
      label:'営業収益（当月）',
      value:fmtK(ds.totalIncome),
      unit:'千円',
      accent:'accent-navy',
      valueClass:'navy',
      sub:`${ymLabel(ds.ym)}（${datasetKindLabel(ds)}）`,
      pill: prevDs ? `${ratio(ds.totalIncome,prevDs.totalIncome)} 前月比` : '',
      pillClass: prevDs ? (ds.totalIncome>=prevDs.totalIncome?'up':'down') : 'flat'
    }),
    ANALYTICS_UI.kpiCard({
      label:'費用合計（当月）',
      value:fmtK(ds.totalExpense),
      unit:'千円',
      accent:'accent-red',
      valueClass:'red',
      sub:`利益率目標：${CONFIG.TARGETS.pseudoLaborRate}%以下（人件費率）`
    }),
    ANALYTICS_UI.kpiCard({
      label:'センター利益（粗利）',
      value:fmtK(ds.profit),
      unit:'千円',
      accent:profitAccent,
      valueClass:profitClass,
      pill:`${pct(ds.profitRate)} 利益率`,
      pillClass:ds.profit>=0?'up':'down'
    }),
    ANALYTICS_UI.kpiCard({
      label:'みなし人件費率',
      value:pct(ds.pseudoLaborRate),
      accent:'accent-amber',
      valueClass:ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? 'green' : 'red',
      sub:`目標：${CONFIG.TARGETS.pseudoLaborRate}%以内`,
      pill:ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? '✓ 達成' : '⚠ 超過',
      pillClass:ds.pseudoLaborRate <= CONFIG.TARGETS.pseudoLaborRate ? 'up' : 'down'
    })
  ]);

  // メインチャート（月次収支推移）
  const dashboardTrendList = dashboardDatasetsForSelectedFiscalYear();
  const labels = dashboardTrendList.map(d=>ymLabel(d.ym));
  const inc  = dashboardTrendList.map(d=>d.totalIncome/1000);
  const exp  = dashboardTrendList.map(d=>d.totalExpense/1000);
  const prof = dashboardTrendList.map(d=>d.profit/1000);

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

  // 費用内訳（当月）
  // 確定CSV/速報CSV/収支補完に保存されている ds.rows をそのまま使用する。
  // 画面は既存カード内に「上位費用＋構成比」を整理表示するだけにし、不要な円グラフは出さない。
  const expArea = document.getElementById('exp-bars-area');
  if (expArea && ds && ds.rows) {
    if (STATE._charts && STATE._charts['c-exp-donut']) {
      try { STATE._charts['c-exp-donut'].destroy(); } catch(e) {}
      delete STATE._charts['c-exp-donut'];
    }

    const expenseGroups = (CONFIG.PL_DEF || [])
      .filter(def => def && def.type === 'group' && def.id !== 'revenue')
      .map(def => {
        const value = (def.keys || []).reduce((sum, key) => sum + n(ds.rows[key]), 0);
        return { label: def.label || def.id || '未設定', value };
      })
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);

    if (!expenseGroups.length) {
      expArea.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">費用内訳データがありません</div>';
    } else {
      const top = expenseGroups.slice(0, 8);
      const otherValue = expenseGroups.slice(8).reduce((sum, item) => sum + item.value, 0);
      const rows = otherValue > 0 ? [...top, { label:'その他', value: otherValue }] : top;
      const maxValue = Math.max(...rows.map(item => item.value), 1);
      const denominator = ds.totalExpense || rows.reduce((sum, item) => sum + item.value, 0) || 1;
      const totalRowsValue = rows.reduce((sum, item) => sum + item.value, 0);

      expArea.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;font-size:11px;color:var(--text3)">
          <span>データ元：${datasetKindLabel(ds)}CSV / ${ymLabel(ds.ym)}</span>
          <span>費用合計 ${fmtK(ds.totalExpense)}千円</span>
        </div>
        <div style="display:grid;gap:7px">
          ${rows.map((item, i) => {
            const width = (item.value / maxValue * 100).toFixed(1);
            const rate = denominator > 0 ? (item.value / denominator * 100) : 0;
            return `
              <div style="display:grid;grid-template-columns:120px 1fr 96px;gap:8px;align-items:center">
                <div style="font-size:12px;font-weight:700;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.label)}">${esc(item.label)}</div>
                <div style="height:14px;background:#e5e7eb;border-radius:999px;overflow:hidden">
                  <div style="height:100%;width:${width}%;background:${CONFIG.COLORS[(i+1)%CONFIG.COLORS.length]};border-radius:999px"></div>
                </div>
                <div style="font-size:12px;font-weight:800;text-align:right;white-space:nowrap">${fmtK(item.value)}千 <span style="color:var(--text3);font-weight:700">${rate.toFixed(1)}%</span></div>
              </div>`;
          }).join('')}
        </div>
        ${Math.abs(totalRowsValue - denominator) > 1 ? `<div style="margin-top:8px;font-size:11px;color:var(--text3)">※ 表示内訳 ${fmtK(totalRowsValue)}千円 / 費用合計 ${fmtK(denominator)}千円</div>` : ''}
      `;
    }
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

/* ════════ §16 RENDER — Indicators ════════════════════════════ */
function renderIndicators() {
  const view = document.getElementById('view-indicators');
  if (!view) return;

  const fyList = datasetsForSelectedFiscalYear();
  const ds = latestDatasetInSelectedFiscalYear();

  if (!ds || !fyList.length) {
    view.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
    renderCommonPeriodSelector('indicators', {useMonth:false});
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
    ${ANALYTICS_UI.kpiGrid([
      ANALYTICS_UI.kpiCard({
        label:`みなし人件費率（${ymLabel(ds.ym)}）`,
        value:pct(ds.pseudoLaborRate),
        accent:laborOk?'accent-green':'accent-red',
        valueClass:laborOk?'green':'red',
        pill:`${laborOk?'✓ 達成':'⚠ 超過'} 目標${T.pseudoLaborRate}%`,
        pillClass:laborOk?'up':'down'
      }),
      ANALYTICS_UI.kpiCard({
        label:`変動費率（${ymLabel(ds.ym)}）`,
        value:pct(ds.variableRate),
        accent:varOk?'accent-green':'accent-amber',
        valueClass:varOk?'green':'amber',
        pill:`${varOk?'✓ 正常':'⚠ 高め'} 目標${T.variableRateMax}%以内`,
        pillClass:varOk?'up':'flat'
      }),
      ANALYTICS_UI.kpiCard({
        label:'利益率（安全余裕率）',
        value:pct(smRate),
        accent:smOk?'accent-green':smWarn?'accent-amber':'accent-red',
        valueClass:smOk?'green':smWarn?'':'red',
        pill:smOk?'✓ 安全':smWarn?'△ 要注意':'⚠ 危険',
        pillClass:smOk?'up':smWarn?'flat':'down'
      })
    ], 3, 'margin-bottom:16px')}

    <div class="grid2" style="margin-bottom:14px">
      ${ANALYTICS_UI.card('固定費 / 変動費　構成（年度最新月）', `
        ${gauge(ds.fixedRate, 50, 65, '%', true)}
        ${gauge(ds.variableRate, T.variableRateMax, 90, '%', true)}
        <div style="font-size:12px;color:var(--text2);line-height:1.8">
          固定費：${fmtK(ds.fixedCost)}千円 / 変動費：${fmtK(ds.varCost)}千円
        </div>`)}
      ${ANALYTICS_UI.card('損益分岐点　簡易判定（年度最新月）', `
        <div style="font-size:12px;color:var(--text2);line-height:1.9">
          営業収益：${fmtK(ds.totalIncome)}千円<br>
          費用合計：${fmtK(ds.totalExpense)}千円<br>
          粗利益：${fmtK(ds.profit)}千円<br>
          利益率：${pct(ds.profitRate)}
        </div>`)}
    </div>

    ${ANALYTICS_UI.card('各指標　月次推移（選択年度内）', '<div class="chart-wrap" style="height:220px"><canvas id="c-ind-trend"></canvas></div>', {style:'margin-bottom:14px'})}`;

  renderCommonPeriodSelector('indicators', {useMonth:false});

  CHART_MGR.make('c-ind-trend', {
    type:'line',
    data:{
      labels: fyList.map(d=>ymLabel(d.ym)),
      datasets:[
        {label:'みなし人件費率(%)',data:fyList.map(d=>+d.pseudoLaborRate.toFixed(1)),borderColor:'#1a4d7c',fill:false,tension:.3,pointRadius:3},
        {label:'変動費率(%)',      data:fyList.map(d=>+d.variableRate.toFixed(1)),   borderColor:'#e05b4d',fill:false,tension:.3,pointRadius:3},
        {label:'利益率(%)',        data:fyList.map(d=>+d.profitRate.toFixed(1)),      borderColor:'#16a34a',fill:false,tension:.3,pointRadius:3},
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

  renderCommonPeriodSelector('annual', {useMonth:false});

  const fy = dashboardSelectedFiscalYear();
  const list = datasetsForSelectedFiscalYear();

  const annualCanvas = document.getElementById('c-annual-trend');
  function showAnnualNoDataMessage(show) {
    const msgId = 'annual-chart-empty-message';
    const oldMsg = document.getElementById(msgId);
    if (oldMsg) oldMsg.remove();
    if (!annualCanvas) return;
    if (show) {
      if (STATE._charts && STATE._charts['c-annual-trend']) {
        try { STATE._charts['c-annual-trend'].destroy(); } catch(e) {}
        delete STATE._charts['c-annual-trend'];
      }
      annualCanvas.style.display = 'none';
      const msg = document.createElement('div');
      msg.id = msgId;
      msg.style.cssText = 'min-height:240px;display:flex;align-items:center;justify-content:center;color:var(--text3);font-weight:700';
      msg.textContent = `${fy}年度のデータがありません`;
      annualCanvas.parentElement.appendChild(msg);
    } else {
      annualCanvas.style.display = '';
    }
  }

  if (!list.length) {
    if (kpi) kpi.innerHTML = `<div style="grid-column:1/-1" class="msg msg-info">${fy}年度のデータがありません</div>`;
    showAnnualNoDataMessage(true);
    tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:var(--text3);text-align:center">${fy}年度のデータがありません</td></tr>`;
    return;
  }

  showAnnualNoDataMessage(false);

  const inc = list.reduce((s,d)=>s+d.totalIncome,0);
  const exp = list.reduce((s,d)=>s+d.totalExpense,0);
  const prf = list.reduce((s,d)=>s+d.profit,0);

  if (kpi) {
    kpi.innerHTML = ANALYTICS_UI.kpiGrid([
      ANALYTICS_UI.kpiCard({
        label:`年度累計収入（${fy}年度）`,
        value:fmtK(inc),
        unit:'千円',
        accent:'accent-navy',
        valueClass:'navy',
        sub:`${list.length}ヶ月分`
      }),
      ANALYTICS_UI.kpiCard({
        label:'年度累計費用',
        value:fmtK(exp),
        unit:'千円',
        accent:'accent-red',
        valueClass:'red'
      }),
      ANALYTICS_UI.kpiCard({
        label:'年度累計利益',
        value:fmtK(prf),
        unit:'千円',
        accent:prf>=0?'accent-green':'accent-red',
        valueClass:prf>=0?'green':'red',
        pill:`${pct(prf/inc*100)} 利益率`,
        pillClass:prf>=0?'up':'down'
      })
    ], 3);
  }

  CHART_MGR.make('c-annual-trend', {
    type:'bar',
    data:{labels:list.map(d=>ymLabel(d.ym)), datasets:[
      {label:'収入',data:list.map(d=>d.totalIncome/1000),backgroundColor:'rgba(26,77,124,.7)'},
      {label:'費用',data:list.map(d=>d.totalExpense/1000),backgroundColor:'rgba(224,91,77,.7)'},
      {label:'利益',data:list.map(d=>d.profit/1000),type:'line',borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',fill:false,tension:.3},
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{title:{display:true,text:'千円'}}}}
  });

  tbody.innerHTML = [...list].reverse().map(d=>`
    <tr>
      <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
      <td class="r">${fmtK(d.totalIncome)}</td>
      <td class="r">${fmtK(d.totalExpense)}</td>
      <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
      <td class="r">${pct(d.profitRate)}</td>
      <td class="r">—</td>
      <td class="r">${ratio(d.totalIncome, prevDS(d.ym)?.totalIncome)}</td>
      <td class="r">${ratio(d.totalIncome, sameMonthLastYear(d.ym)?.totalIncome)}</td>
    </tr>`).join('');
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
  const last3 = activeDatasets().slice(-3);
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

/* ════════ §19 RENDER — Capacity（capacity.jsへ分割） ═══════════════════ */

function storageFiscalYear() {
  const ids = ['data-health-fy-select', 'monthly-check-fy-select', 'storage-fy-select', 'data-quality-fy-select', 'import-history-fy-select', 'plan-year-sel'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.value) return String(el.value);
  }
  return STATE.fiscalYear || getDefaultFiscalYear();
}
function storageFiscalMonths(fy) { return monthsOfFiscalYear(String(fy)); }
function storageRowsForFY(fy) {
  const months = storageFiscalMonths(fy);
  return (STATE.datasets || []).filter(d => months.includes(d.ym));
}
function storageFiscalYearOptionsHtml(selectedFY) {
  const selected = String(selectedFY || storageFiscalYear());
  const years = new Set([selected, getDefaultFiscalYear()]);
  (STATE.datasets || []).forEach(d => {
    const y = d?.fiscalYear || (d?.ym ? fiscalYearFromYM(d.ym) : '');
    if (/^\d{4}$/.test(String(y))) years.add(String(y));
  });
  (STATE.workerCsvData || []).forEach(d => d?.ym && years.add(fiscalYearFromYM(d.ym)));
  (STATE.productAddressData || []).forEach(d => d?.ym && years.add(fiscalYearFromYM(d.ym)));
  if (STATE.planData && typeof STATE.planData === 'object') {
    Object.keys(STATE.planData).forEach(y => /^\d{4}$/.test(y) && years.add(y));
  }
  return [...years].sort().reverse().map(y => `<option value="${y}" ${String(y)===selected?'selected':''}>${y}年度</option>`).join('');
}
function storageIsHistory(ds) { return ds && ds.source === 'history'; }
function storageAmountK(ds, key) {
  if (!ds) return 0;
  // CSVは円、収支補完は千円。表示は千円で統一。
  if (storageIsHistory(ds) || String(ds.unit || '').includes('千円')) return n(ds[key]);
  return n(ds[key]) / 1000;
}
function storageLatestAt(rows) { return rows.map(r=>r.importedAt).filter(Boolean).sort().pop() || ''; }
function storagePlanPack(fy) { return getPlanPackForFiscalYear(String(fy)); }
function storagePlanRows(fy) { const p = storagePlanPack(fy); return p ? p.rows : null; }
function storagePlanAllTotal(plan) {
  if (!plan) return 0;
  let total = 0;
  Object.values(plan).forEach(row => {
    if (!row || typeof row !== 'object') return;
    Object.values(row).forEach(v => total += n(v));
  });
  return total;
}
function storageBadge(text, kind) {
  const bg = kind === 'ok' ? '#d1fae5' : kind === 'warn' ? '#fef3c7' : '#fee2e2';
  const fg = kind === 'ok' ? '#065f46' : kind === 'warn' ? '#92400e' : '#991b1b';
  return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${fg};font-weight:900;font-size:11px;white-space:nowrap">${text}</span>`;
}
function storageWarnings(fy) {
  const warnings = [];
  const rows = storageRowsForFY(fy);
  const keyCount = {};
  rows.forEach(d => {
    const key = `${d.ym}_${d.type || 'confirmed'}_${d.source || 'csv'}`;
    keyCount[key] = (keyCount[key] || 0) + 1;
  });
  if (Object.values(keyCount).some(c => c > 1)) warnings.push('同じ年月・区分・種別のデータが二重に残っている可能性があります。');
  const converted = rows.filter(d => storageIsHistory(d) && String(d.unit || '').includes('変換'));
  if (converted.length) warnings.push(`収支補完に古い「千円→円変換」表記のデータが ${converted.length}件 残っています。再取込を推奨します。`);
  const plan = storagePlanRows(fy);
  if (plan && Object.keys(plan).length && storagePlanAllTotal(plan) === 0) warnings.push('計画データは登録済みですが、数値合計が0です。貼付範囲を確認してください。');
  return warnings;
}

function storageMonthState(fy, ym) {
  const rows = (STATE.datasets || []).filter(d => d && d.ym === ym);
  const csvRows = rows.filter(d => !storageIsHistory(d));
  const histRows = rows.filter(d => storageIsHistory(d));
  const confirmed = csvRows.filter(d => (d.type || 'confirmed') === 'confirmed');
  const daily = csvRows.filter(d => d.type === 'daily');
  const converted = histRows.filter(d => String(d.unit || '').includes('変換'));
  const dupMap = {};
  rows.forEach(d => {
    const key = `${d.ym}_${d.type || 'confirmed'}_${d.source || 'csv'}`;
    dupMap[key] = (dupMap[key] || 0) + 1;
  });
  const duplicated = Object.values(dupMap).some(c => c > 1);
  const plan = storagePlanRows(fy);

  let judge = '漏れ';
  let kind = 'danger';
  let note = '';
  if (converted.length || duplicated) {
    judge = '異常';
    kind = 'danger';
    note = converted.length ? '旧変換データあり' : '二重データ疑い';
  } else if (confirmed.length) {
    judge = 'OK';
    kind = 'ok';
    note = daily.length ? '速報も保持・表示は確定優先' : '確定あり';
  } else if (daily.length) {
    judge = '注意';
    kind = 'warn';
    note = '速報のみ・確定待ち';
  } else if (histRows.length) {
    judge = '補完のみ';
    kind = 'warn';
    note = 'CSV未登録';
  } else {
    note = 'CSV・補完なし';
  }

  const csvLabel = confirmed.length && daily.length ? '確定＋速報' : confirmed.length ? '確定' : daily.length ? '速報のみ' : '未登録';
  const csvKind = confirmed.length ? 'ok' : daily.length ? 'warn' : 'danger';
  const histLabel = histRows.length ? 'あり' : 'なし';
  const histKind = histRows.length ? (converted.length ? 'danger' : 'ok') : 'warn';
  const planLabel = plan ? '登録済' : '未登録';
  const planKind = plan ? 'ok' : 'warn';

  return { ym, confirmed, daily, histRows, converted, duplicated, csvLabel, csvKind, histLabel, histKind, planLabel, planKind, judge, kind, note };
}
function renderMonthlyCheckTable() {
  const fy = storageFiscalYear();
  const months = storageFiscalMonths(fy);
  const states = months.map(ym => storageMonthState(fy, ym));
  const missingCount = states.filter(s => s.judge === '漏れ').length;
  const dailyOnlyCount = states.filter(s => s.judge === '注意').length;
  const abnormalCount = states.filter(s => s.judge === '異常').length;
  const histOnlyCount = states.filter(s => s.judge === '補完のみ').length;

  const summary = abnormalCount
    ? storageBadge(`異常 ${abnormalCount}件`, 'danger')
    : missingCount
      ? storageBadge(`漏れ ${missingCount}ヶ月`, 'danger')
      : dailyOnlyCount || histOnlyCount
        ? storageBadge(`確認 ${dailyOnlyCount + histOnlyCount}ヶ月`, 'warn')
        : storageBadge('12ヶ月 OK', 'ok');

  return `
    <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
      <summary style="cursor:pointer;padding:12px 14px;list-style:none;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--text2);font-weight:800">対象年度</span>
          <select id="monthly-check-fy-select" onclick="event.stopPropagation()" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${storageFiscalYearOptionsHtml(fy)}</select>
          ${summary}
          <span style="font-size:11px;color:var(--text3)">▼</span>
        </div>
      </summary>
      <div style="padding:0 10px 10px">
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
          ${states.map(s=>`
            <tr>
              <td><strong>${ymLabel(s.ym)}</strong></td>
              <td>${storageBadge(s.csvLabel, s.csvKind)}</td>
              <td>${storageBadge(s.histLabel, s.histKind)}</td>
              <td>${storageBadge(s.planLabel, s.planKind)}</td>
              <td>${storageBadge(s.judge, s.kind)}</td>
              <td style="min-width:220px;color:var(--text2)">${esc(s.note)}</td>
            </tr>
          `).join('')}
        </tbody></table></div>
      </div>
    </details>`;
}


function storageDataQualityRows(fy) {
  const months = storageFiscalMonths(fy);
  const rows = (STATE.datasets || []).filter(d => d && months.includes(d.ym));
  const out = [];

  const groups = {};
  rows.forEach(d => {
    const source = storageIsHistory(d) ? '収支補完' : '収支CSV';
    const type = d.type === 'daily' ? '速報' : '確定';
    const key = `${d.ym}_${source}_${type}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  Object.values(groups).forEach(list => {
    if (list.length > 1) {
      const d = list[0];
      out.push({level:'異常', ym:d.ym, item: storageIsHistory(d) ? '収支補完' : '収支CSV', detail:`同じ年月・同じ区分が ${list.length}件あります`, action:'不要な重複データを削除または年度再取込で整理'});
    }
  });

  rows.forEach(d => {
    const source = storageIsHistory(d) ? '収支補完' : '収支CSV';
    const unit = String(d.unit || '');
    const fyActual = String(d.fiscalYear || fiscalYearFromYM(d.ym));
    const incomeK = storageAmountK(d, 'totalIncome');
    const expenseK = storageAmountK(d, 'totalExpense');

    if (unit.includes('変換')) {
      out.push({level:'異常', ym:d.ym, item:source, detail:`単位表記が「${unit}」です`, action:'旧変換版データのため、該当年度の収支補完を削除して再取込'});
    }
    if (!storageIsHistory(d) && unit && unit !== '円') {
      out.push({level:'確認', ym:d.ym, item:source, detail:`CSVの元単位が「${unit}」になっています`, action:'SKDL CSVは円単位。取込元または過去データを確認'});
    }
    if (storageIsHistory(d) && unit && !unit.includes('千円')) {
      out.push({level:'確認', ym:d.ym, item:source, detail:`収支補完の元単位が「${unit}」になっています`, action:'収支補完は千円単位。再取込を推奨'});
    }
    if (fyActual !== String(fy)) {
      out.push({level:'異常', ym:d.ym, item:source, detail:`年度情報が ${fyActual}年度 になっています`, action:`${ymLabel(d.ym)}は${fiscalYearFromYM(d.ym)}年度扱い。年度ズレを確認`});
    }
    if ((incomeK > 0 && incomeK < 100) || (expenseK > 0 && expenseK < 100)) {
      out.push({level:'確認', ym:d.ym, item:source, detail:`金額が小さすぎる可能性があります（収入 ${fmt(incomeK)}千円 / 費用 ${fmt(expenseK)}千円）`, action:'千円データをさらに÷1000していないか確認'});
    }
  });

  return out.sort((a,b)=>a.ym.localeCompare(b.ym) || a.item.localeCompare(b.item,'ja'));
}
function renderDataQualityCheckTable() {
  const fy = storageFiscalYear();
  const rows = storageDataQualityRows(fy);
  const summary = rows.length ? storageBadge(`確認 ${rows.length}件`, 'danger') : storageBadge('異常なし', 'ok');
  return `
    <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
      <summary style="cursor:pointer;padding:12px 14px;list-style:none;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:900;font-size:14px">重複・異常データ確認</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">同じ年月＋同じ区分の重複、単位ズレ、年度ズレ、極端に小さい金額を確認</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-size:11px;color:var(--text2);font-weight:800">対象年度</span>
          <select id="data-quality-fy-select" onclick="event.stopPropagation()" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${storageFiscalYearOptionsHtml(fy)}</select>
          ${summary}<span style="font-size:11px;color:var(--text3)">▼</span>
        </div>
      </summary>
      <div style="padding:0 12px 12px">
        ${rows.length ? `
          <div class="scroll-x"><table class="tbl"><thead><tr><th>区分</th><th>月</th><th>データ</th><th>確認内容</th><th>対応</th></tr></thead><tbody>
            ${rows.map(r=>`<tr>
              <td>${storageBadge(r.level, r.level === '異常' ? 'danger' : 'warn')}</td>
              <td><strong>${ymLabel(r.ym)}</strong></td>
              <td>${esc(r.item)}</td>
              <td style="min-width:280px;color:var(--text2)">${esc(r.detail)}</td>
              <td style="min-width:280px;color:var(--text2)">${esc(r.action)}</td>
            </tr>`).join('')}
          </tbody></table></div>` : `
          <div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:10px;font-size:12px">この年度では、同一月・同一区分の重複や単位異常は見つかりません。</div>`}
      </div>
    </details>`;
}


function healthProductRecord(ym) {
  const records = window.FIELD_DATA_ACCESS?.getProductRecords ? FIELD_DATA_ACCESS.getProductRecords() : (STATE.productAddressData || []);
  return (records || []).find(d => d && d.ym === ym) || null;
}
function healthWorkerRecord(ym) {
  const records = window.FIELD_DATA_ACCESS?.getWorkerRecords ? FIELD_DATA_ACCESS.getWorkerRecords() : (STATE.workerCsvData || []);
  return (records || []).find(d => d && d.ym === ym) || null;
}
function healthProductStats(rec) {
  const tickets = Array.isArray(rec?.tickets) ? rec.tickets : [];
  const hasAmount = (t) => {
    const direct = n(t?.amount || t?.salesAmount || t?.totalAmount || t?.value || t?.price);
    if (direct > 0) return true;
    if (t?.works && typeof t.works === 'object') {
      return Object.values(t.works).some(v => n(v) > 0);
    }
    if (Array.isArray(t?.workDetails)) {
      return t.workDetails.some(d => n(d?.amount || d?.value) > 0);
    }
    return false;
  };
  const hasAddressUnit = (t) => {
    return !!String(t?.zip || t?.zipcode || t?.postalCode || t?.pref || t?.city || t?.ward || t?.area || t?.areaUnit || '').trim();
  };
  const total = tickets.length || n(rec?.uniqueCount);
  const amountMissing = tickets.length ? tickets.filter(t => !hasAmount(t)).length : 0;
  const addressMissing = tickets.length ? tickets.filter(t => !hasAddressUnit(t)).length : Math.max(0, n(rec?.uniqueCount) - n(rec?.zipCount));
  const amount = tickets.length ? tickets.reduce((sum,t)=>sum + n(t.amount || t.salesAmount || t.totalAmount || t.value || t.price),0) : n(rec?.amount);
  return { total, amountMissing, addressMissing, amount };
}
function healthNormalizeUnit(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (window.CAPACITY_UI?.normalizeCapacityUnit) {
    try { return CAPACITY_UI.normalizeCapacityUnit(raw); } catch(e) {}
  }
  return raw.replace(/[\s　]/g,'').replace(/さいたま市(.+区)$/,'さいたま市$1');
}
function healthCapacityStats(productRec) {
  const groups = STATE.capacity?.capacityGroups || [];
  const validGroups = groups.filter(g => Array.isArray(g.units) && g.units.length);
  const unitSet = new Set();
  validGroups.forEach(g => (g.units || []).forEach(u => {
    const normalized = healthNormalizeUnit(u);
    if (normalized) unitSet.add(normalized);
  }));
  const tickets = Array.isArray(productRec?.tickets) ? productRec.tickets : [];
  let unmatched = 0;
  tickets.forEach(t => {
    const candidates = [t.areaUnit, t.area, t.city && t.ward ? `${t.city}${t.ward}` : '', t.city, t.ward].map(healthNormalizeUnit).filter(Boolean);
    if (candidates.length && !candidates.some(c => unitSet.has(c))) unmatched += 1;
  });
  const hasValid = typeof CAPACITY_UI !== 'undefined' && CAPACITY_UI?.hasValidCapacityGroups
    ? !!CAPACITY_UI.hasValidCapacityGroups()
    : validGroups.some(g => Object.values(g.capacity || {}).some(v => n(v?.weekday) > 0 || n(v?.weekend) > 0));
  return { groupCount: validGroups.length, hasValid, unmatched };
}
function dataHealthMonthState(fy, ym) {
  const monthState = storageMonthState(fy, ym);
  const worker = healthWorkerRecord(ym);
  const product = healthProductRecord(ym);
  const productStats = healthProductStats(product);
  const capStats = healthCapacityStats(product);
  const csvOk = monthState.confirmed.length > 0 || monthState.daily.length > 0 || monthState.histRows.length > 0;
  const planOk = !!storagePlanRows(fy);
  const workerOk = !!worker;
  const productOk = !!product;
  const capOk = capStats.hasValid;
  const problems = [];
  if (!csvOk) problems.push('収支未登録');
  if (!planOk) problems.push('計画未登録');
  if (!workerOk) problems.push('作業者CSV未登録');
  if (!productOk) problems.push('商品住所CSV未登録');
  if (productOk && productStats.amountMissing > 0) problems.push(`金額欠落 ${productStats.amountMissing}件`);
  if (productOk && productStats.addressMissing > 0) problems.push(`住所/地区欠落 ${productStats.addressMissing}件`);
  if (!capOk) problems.push('キャパ未設定');
  if (productOk && capOk && capStats.unmatched > 0) problems.push(`キャパ未分類 ${capStats.unmatched}件`);
  let judge = 'OK';
  let kind = 'ok';
  if (problems.some(x => /未登録|未設定|欠落|未分類/.test(x))) { judge = '確認'; kind = 'warn'; }
  if (!csvOk || !productOk || !capOk) { judge = '要対応'; kind = 'danger'; }
  return { ym, csvOk, planOk, workerOk, productOk, capOk, productStats, capStats, problems, judge, kind };
}
function renderDataHealthDashboard() {
  const fy = storageFiscalYear();
  const months = storageFiscalMonths(fy);
  const states = months.map(ym => dataHealthMonthState(fy, ym));
  const csvCount = states.filter(s => s.csvOk).length;
  const workerCount = states.filter(s => s.workerOk).length;
  const productCount = states.filter(s => s.productOk).length;
  const amountMissing = states.reduce((sum,s)=>sum + s.productStats.amountMissing, 0);
  const addressMissing = states.reduce((sum,s)=>sum + s.productStats.addressMissing, 0);
  const capUnmatched = states.reduce((sum,s)=>sum + s.capStats.unmatched, 0);
  const capStats = healthCapacityStats(null);
  const dangerCount = states.filter(s => s.kind === 'danger').length;
  const warnCount = states.filter(s => s.kind === 'warn').length;
  const headerBadge = dangerCount ? storageBadge(`要対応 ${dangerCount}ヶ月`, 'danger') : warnCount ? storageBadge(`確認 ${warnCount}ヶ月`, 'warn') : storageBadge('AI生成前チェック OK', 'ok');
  const mini = (label, value, sub, kind) => `
    <div style="border:1px solid var(--border);border-radius:14px;background:#fff;padding:12px 14px;min-width:150px">
      <div style="font-size:11px;color:var(--text2);font-weight:900;margin-bottom:4px">${esc(label)}</div>
      <div style="font-size:22px;font-weight:900;color:${kind==='danger'?'#991b1b':kind==='warn'?'#92400e':'var(--text)'}">${esc(value)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(sub)}</div>
    </div>`;
  return `
    <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:16px;background:#f8fafc;overflow:hidden">
      <summary style="cursor:pointer;padding:14px;list-style:none;background:#f8fafc;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:900;font-size:15px;color:var(--text)">データ正常性チェック</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">AI会議報告書・キャパ分析に進む前に、月別の登録漏れと欠落を確認します。</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-size:11px;color:var(--text2);font-weight:800">対象年度</span>
          <select id="data-health-fy-select" onclick="event.stopPropagation()" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${storageFiscalYearOptionsHtml(fy)}</select>
          ${headerBadge}
          <span style="font-size:11px;color:var(--text3)">▼</span>
        </div>
      </summary>
      <div style="padding:0 14px 14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
        ${mini('収支データ', `${csvCount}/12`, 'CSVまたは補完', csvCount===12?'ok':'warn')}
        ${mini('作業者CSV', `${workerCount}/12`, '現場明細', workerCount===12?'ok':'warn')}
        ${mini('商品住所CSV', `${productCount}/12`, '商品・住所・金額', productCount===12?'ok':'warn')}
        ${mini('金額欠落', `${amountMissing}件`, '商品住所CSV内', amountMissing?'danger':'ok')}
        ${mini('住所/地区欠落', `${addressMissing}件`, '郵便番号・市区町村', addressMissing?'warn':'ok')}
        ${mini('キャパ区分', `${capStats.groupCount}区分`, capStats.hasValid?'登録済':'未設定', capStats.hasValid?'ok':'danger')}
      </div>
      <details style="border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
        <summary style="cursor:pointer;padding:11px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff">
          <span style="font-size:13px;font-weight:900;color:var(--text)">月別チェック表</span>
          <span style="font-size:11px;color:var(--text3)">長い表はここで開閉できます ▼</span>
        </summary>
        <div style="padding:0 10px 10px">
          <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支</th><th>作業者</th><th>商品住所</th><th>計画</th><th>キャパ</th><th>金額欠落</th><th>住所/地区欠落</th><th>キャパ未分類</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
            ${states.map(s=>`
              <tr>
                <td><strong>${ymLabel(s.ym)}</strong></td>
                <td>${storageBadge(s.csvOk?'OK':'未登録', s.csvOk?'ok':'danger')}</td>
                <td>${storageBadge(s.workerOk?'OK':'未登録', s.workerOk?'ok':'warn')}</td>
                <td>${storageBadge(s.productOk?'OK':'未登録', s.productOk?'ok':'danger')}</td>
                <td>${storageBadge(s.planOk?'OK':'未登録', s.planOk?'ok':'warn')}</td>
                <td>${storageBadge(s.capOk?'OK':'未設定', s.capOk?'ok':'danger')}</td>
                <td style="text-align:right;font-weight:800">${fmt(s.productStats.amountMissing)}</td>
                <td style="text-align:right;font-weight:800">${fmt(s.productStats.addressMissing)}</td>
                <td style="text-align:right;font-weight:800">${fmt(s.capStats.unmatched)}</td>
                <td>${storageBadge(s.judge, s.kind)}</td>
                <td style="min-width:260px;color:var(--text2)">${s.problems.length ? esc(s.problems.join(' / ')) : '登録状況に大きな問題はありません'}</td>
              </tr>`).join('')}
          </tbody></table></div>
        </div>
      </details>
      ${capUnmatched ? `<div style="margin-top:10px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:10px;padding:9px 10px;font-size:12px;line-height:1.6">キャパ未分類が ${fmt(capUnmatched)}件あります。商品・住所CSVに存在する市区町村が、荷主キャパ区分に入っていない可能性があります。</div>` : ''}
      </div>
    </details>`;
}

function renderStorageMapTable() {
  const fy = storageFiscalYear();
  const rows = storageRowsForFY(fy);
  const csvRows = rows.filter(d => !storageIsHistory(d));
  const histRows = rows.filter(d => storageIsHistory(d));
  const plan = storagePlanRows(fy);
  const planPack = storagePlanPack(fy);
  const monthsConfirmed = new Set(csvRows.filter(d => (d.type || 'confirmed') === 'confirmed').map(d=>d.ym)).size;
  const monthsDaily = new Set(csvRows.filter(d => d.type === 'daily').map(d=>d.ym)).size;
  const histMonths = new Set(histRows.map(d=>d.ym)).size;
  const workerRows = (STATE.workerCsvData || []).filter(d => d && storageFiscalMonths(fy).includes(d.ym));
  const productRows = (STATE.productAddressData || []).filter(d => d && storageFiscalMonths(fy).includes(d.ym));
  const warnings = storageWarnings(fy);

  const yearOptions = storageFiscalYearOptionsHtml(fy);

  const tableRows = [
    ['収支実績CSV', `${fy}年度`, (monthsConfirmed||monthsDaily)?storageBadge('登録済','ok'):storageBadge('未登録','warn'), `確定 ${monthsConfirmed}ヶ月 / 速報 ${monthsDaily}ヶ月`, '円', formatImportedAt(storageLatestAt(csvRows)), 'SKDL0001/0003。速報と確定は両方保持。表示は確定優先。', '月別チェック表から月単位で削除'],
    ['計画データ', `${fy}年度`, plan?storageBadge('登録済','ok'):storageBadge('未登録','warn'), plan?`${Object.keys(plan).length}科目 / 合計 ${fmt(storagePlanAllTotal(plan))}千円`:'0科目', '千円', formatImportedAt(planPack?.importedAt), '年度単位で完全独立。取込時は年度丸ごと入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deletePlan('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['収支補完', `${fy}年度`, histMonths?storageBadge('登録済','ok'):storageBadge('未登録','warn'), histMonths?`${histMonths}ヶ月 / 収入 ${fmt(histRows.reduce((s,d)=>s+storageAmountK(d,'totalIncome'),0))}千円`:'0ヶ月', '千円', formatImportedAt(storageLatestAt(histRows)), 'SKKS月次収支照会の貼付。年度単位で完全入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteHistory('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['作業者CSV', `${fy}年度`, workerRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), workerRows.length?`${workerRows.length}ヶ月 / ${fmt(workerRows.reduce((s,d)=>s+n(d.rowCount),0))}行`:'0ヶ月', '件数', formatImportedAt(storageLatestAt(workerRows)), '作業者分析・作業内容分析の元データ。月単位で個別削除できます。', '月別チェック表から月単位で削除'],
    ['商品住所CSV', `${fy}年度`, productRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), productRows.length?`${productRows.length}ヶ月 / 原票${fmt(productRows.reduce((s,d)=>s+n(d.uniqueCount),0))}件`:'0ヶ月', '件数/円', formatImportedAt(storageLatestAt(productRows)), '商品カテゴリ・エリア・キャパ・荷主判定の元データ。顧客氏名・番地は保存しません。', '月別チェック表から月単位で削除'],
  ];

  return `
    <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
      <summary style="cursor:pointer;padding:12px 14px;list-style:none;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:900;font-size:14px">データ保管場所 対応表</div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap">
          <span style="color:var(--text2)">対象年度</span>
          <select id="storage-fy-select" onclick="event.stopPropagation()" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${yearOptions}</select>
          <span style="font-size:11px;color:var(--text3)">▼</span>
        </div>
      </summary>
      <div style="padding:0 12px 12px">
      ${warnings.length ? `<div style="border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.7"><strong>確認が必要なデータがあります</strong><br>${warnings.map(w=>'・'+esc(w)).join('<br>')}</div>` : `<div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px">この年度の保管状況に大きな異常は見つかりません。</div>`}
      <details style="border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
        <summary style="cursor:pointer;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8fafc">
          <span style="font-size:13px;font-weight:900;color:var(--text)">保管区分別の登録状況</span>
          <span style="font-size:11px;color:var(--text3)">開閉できます ▼</span>
        </summary>
        <div style="padding:10px 10px 12px">
          <div class="scroll-x"><table class="tbl"><thead><tr><th>保管区分</th><th>対象</th><th>登録状況</th><th>件数/月数</th><th>元単位</th><th>最終更新</th><th>説明</th><th>操作</th></tr></thead><tbody>
            ${tableRows.map(r=>`<tr><td><strong>${esc(r[0])}</strong></td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td style="min-width:260px;color:var(--text2)">${esc(r[6])}</td><td>${r[7]}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
      </details>
      </div>
    </details>`;
}

function renderCloudInventoryCard() {
  const summary = window.CLOUD?._lastInventory || null;
  const cloudBody = summary ? CLOUD.renderInventorySummary(summary) : `
    <div style="border:1px dashed var(--border2);background:#fff;border-radius:12px;padding:12px;font-size:12px;color:var(--text2);line-height:1.7">
      まだ確認していません。右上の「確認」を押すと、Supabase の manifest.json を読み取り、クラウド保存済みの件数を表示します。
    </div>`;
  const checkedAt = summary?.fetchedAt ? new Date(summary.fetchedAt).toLocaleString('ja-JP') : '未確認';
  const savedAt = summary?.savedAt ? new Date(summary.savedAt).toLocaleString('ja-JP') : '未確認';
  const statusBadge = summary
    ? storageBadge('確認済', 'ok')
    : storageBadge('未確認', 'warn');
  return `
    <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:16px;background:#f8fafc;overflow:hidden;box-shadow:0 8px 22px rgba(15,23,42,.06)">
      <div style="padding:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-weight:900;font-size:14px">☁ クラウド保存状況確認</div>
            ${statusBadge}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.6">
            Supabase の manifest.json を基準に、クラウド側へ保存済みのデータ件数を確認します。<br>
            最終保存：${esc(savedAt)} ／ 確認日時：${esc(checkedAt)}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="CLOUD.refreshInventoryPanel()" style="font-size:12px">確認</button>
          <button class="btn" onclick="CLOUD.syncNow()" style="font-size:12px">今すぐ同期</button>
        </div>
      </div>
      <div style="padding:0 14px 10px">
        <div id="sync-live-status"></div>
      </div>
      <div id="cloud-inventory-body" style="padding:0 14px 14px">
        ${cloudBody}
      </div>
    </div>`;
}

function renderBackupAndSyncPanel() {
  const info = STORE.storageInfo();
  const backups = STORE.listLocalBackups ? STORE.listLocalBackups() : [];
  const backupRows = backups.length ? backups.map(b => `
    <tr>
      <td><strong>${new Date(b.savedAt).toLocaleString('ja-JP')}</strong><br><span style="font-size:10px;color:var(--text3)">${esc(b.reason || '')}</span></td>
      <td>${((Number(b.bytes)||0)/1024).toFixed(1)} KB</td>
      <td>収支 ${n(b.datasets)} / 作業者 ${n(b.workers)} / 商品 ${n(b.products)}</td>
      <td style="white-space:nowrap">
        <button class="btn" onclick="DATA_STORAGE_TABLE.restoreLocalBackup('${esc(b.id)}')" style="font-size:11px;padding:3px 8px">復元</button>
        <button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteLocalBackup('${esc(b.id)}')" style="font-size:11px;padding:3px 8px">削除</button>
      </td>
    </tr>`).join('') : `
    <tr><td colspan="4" style="color:var(--text3);font-size:12px;padding:12px">まだローカル世代バックアップはありません。</td></tr>`;

  const capacityKind = info.totalBytes > 4.5 * 1024 * 1024 ? 'danger' : info.totalBytes > 3.5 * 1024 * 1024 ? 'warn' : 'ok';
  const capacityBadge = storageBadge(`合計 ${info.totalKb} KB`, capacityKind);
  return `
    <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:16px;background:#f8fafc;overflow:hidden">
      <summary style="cursor:pointer;padding:14px;list-style:none;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:900;font-size:14px">バックアップ・同期状態</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">ローカル容量と世代バックアップを確認</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${capacityBadge}
          <span style="font-size:11px;color:var(--text3)">▼</span>
        </div>
      </summary>
      <div style="padding:12px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px">
          <div style="border:1px solid var(--border);border-radius:14px;background:#fff;padding:12px">
            <div style="font-size:11px;color:var(--text2);font-weight:900">通常データ容量</div>
            <div style="font-size:22px;font-weight:900;margin-top:2px">${info.kb} KB</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">STORE管理キーのみ集計</div>
          </div>
          <div style="border:1px solid var(--border);border-radius:14px;background:#fff;padding:12px">
            <div style="font-size:11px;color:var(--text2);font-weight:900">世代バックアップ容量</div>
            <div style="font-size:22px;font-weight:900;margin-top:2px">${info.backupKb} KB</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">最大3世代まで保持</div>
          </div>
          <div style="border:1px solid var(--border);border-radius:14px;background:#fff;padding:12px">
            <div style="font-size:11px;color:var(--text2);font-weight:900">同期方式</div>
            <div style="font-size:14px;font-weight:900;margin-top:6px">月単位分割＋軽量台帳</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">full_state は軽量化済み</div>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-primary" onclick="DATA_STORAGE_TABLE.createLocalBackup()" style="font-size:12px">ローカル世代バックアップ作成</button>
        </div>
        <div>
          <div style="font-size:12px;font-weight:900;margin-bottom:6px">ローカル世代バックアップ</div>
          <div class="scroll-x"><table class="tbl"><thead><tr><th>作成日時</th><th>容量</th><th>内容</th><th>操作</th></tr></thead><tbody>${backupRows}</tbody></table></div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.7">
            ※ 世代バックアップはブラウザ内保存です。PC故障・ブラウザ削除には備えられないため、重要時は左下の「書出」も併用してください。<br>
            ※ 復元はローカル状態を戻します。必要に応じて復元後に「今すぐ同期」を実行してください。
          </div>
        </div>
      </div>
    </details>`;
}

window.DATA_STORAGE_TABLE = {
  changeFY(fy){ STATE.fiscalYear = String(fy); renderImport(); },

  createLocalBackup(){
    const r = STORE.createLocalBackup ? STORE.createLocalBackup('データ管理画面から作成') : { ok:false, error:'バックアップ機能なし' };
    if (r.ok) UI.toast('ローカル世代バックアップを作成しました');
    else UI.toast('バックアップ作成に失敗しました: ' + (r.error || '不明'), 'error');
    renderImport();
  },

  restoreLocalBackup(id){
    if (!confirm('この世代バックアップでローカルデータを復元しますか？\n現在のローカル状態は上書きされます。')) return;
    const r = STORE.restoreLocalBackup ? STORE.restoreLocalBackup(id) : { ok:false, error:'復元機能なし' };
    if (r.ok) {
      UI.toast('ローカル世代バックアップを復元しました');
      NAV.refresh();
    } else {
      UI.toast('復元に失敗しました: ' + (r.error || '不明'), 'error');
    }
  },

  deleteLocalBackup(id){
    if (!confirm('この世代バックアップを削除しますか？')) return;
    const r = STORE.deleteLocalBackup ? STORE.deleteLocalBackup(id) : { ok:false, error:'削除機能なし' };
    if (r.ok) UI.toast('ローカル世代バックアップを削除しました');
    else UI.toast('削除に失敗しました: ' + (r.error || '不明'), 'error');
    renderImport();
  },

  async _syncAfterDelete(label){
    STORE.save();
    try {
      if (CLOUD?.pushAll) await CLOUD.pushAll();
    } catch(e) {
      UI.toast(`${label}はローカル削除済みですが、クラウド同期に失敗しました: ${e.message}`, 'warn');
    }
    NAV.refresh();
  },

  async deletePlan(fy){
    if (!STATE.planData || !STATE.planData[fy]) { UI.toast(`${fy}年度の計画データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の計画データを削除しますか？
他年度は削除しません。`)) return;
    markDataDeleted('planFiscalYears', fy);
    delete STATE.planData[fy];
    applyDeletionTombstonesToState(STATE);
    try { if (CLOUD?.deleteFile) await CLOUD.deleteFile(CLOUD._planKey()); } catch(e) {}
    await this._syncAfterDelete(`${fy}年度の計画データ`);
    UI.toast(`${fy}年度の計画データを削除しました`);
  },

  async deleteHistory(fy){
    const rows = (STATE.datasets || []).filter(d => storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (!rows.length) { UI.toast(`${fy}年度の収支補完データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の収支補完データ ${rows.length}件を削除しますか？
通常CSV・計画データは削除しません。`)) return;
    markDataDeleted('historyFiscalYears', fy);
    STATE.datasets = (STATE.datasets || []).filter(d => !(storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));
    applyDeletionTombstonesToState(STATE);
    await this._syncAfterDelete(`${fy}年度の収支補完データ`);
    UI.toast(`${fy}年度の収支補完データを削除しました`);
  },

  async deleteHistoryMonth(ym){
    const rows = (STATE.datasets || []).filter(d => storageIsHistory(d) && d.ym === ym);
    if (!rows.length) { UI.toast(`${ymLabel(ym)}の収支補完は未登録です`,'warn'); return; }
    if (!confirm(`${ymLabel(ym)}の収支補完データを削除しますか？
通常CSV・計画データは削除しません。`)) return;
    markDataDeleted('historyMonths', ym);
    STATE.datasets = (STATE.datasets || []).filter(d => !(storageIsHistory(d) && d.ym === ym));
    applyDeletionTombstonesToState(STATE);
    await this._syncAfterDelete(`${ymLabel(ym)}の収支補完データ`);
    UI.toast(`${ymLabel(ym)}の収支補完データを削除しました`);
  },

  async deleteCsvMonth(ym, type){
    const rows = (STATE.datasets || []).filter(d => d.ym === ym && d.source !== 'history' && (!type || (d.type || 'confirmed') === type));
    if (!rows.length) { UI.toast(`${ymLabel(ym)}の収支CSVは未登録です`, 'warn'); return; }
    const label = type === 'daily' ? '速報CSV' : type === 'confirmed' ? '確定CSV' : '収支CSV';
    if (!confirm(`${ymLabel(ym)}の${label} ${rows.length}件を削除しますか？
収支補完・計画データは削除しません。`)) return;
    rows.forEach(d => markDataDeleted('datasets', dataDeleteKey(d.ym, d.type || 'confirmed')));
    STATE.datasets = (STATE.datasets || []).filter(d => !(d.ym === ym && d.source !== 'history' && (!type || (d.type || 'confirmed') === type)));
    applyDeletionTombstonesToState(STATE);
    try {
      for (const d of rows) {
        if (CLOUD?.deleteFile) await CLOUD.deleteFile(CLOUD._datasetKey(d.ym, d.type || 'confirmed'));
      }
    } catch(e) {}
    await this._syncAfterDelete(`${ymLabel(ym)}の${label}`);
    UI.toast(`${ymLabel(ym)}の${label}を削除しました`);
  }
};

window.IMPORT_PAGE_TOGGLE = {
  setAll(open) {
    document.querySelectorAll('#view-import details').forEach(el => { el.open = !!open; });
  }
};

/* ════════ §20 RENDER — Import ═════════════════════════════════ */
function renderImport() {
  const listEl = document.getElementById('data-list');
  if (listEl) {
    const cloudInventoryHtml = renderCloudInventoryCard();
    const backupSyncHtml = renderBackupAndSyncPanel();
    const healthHtml = renderDataHealthDashboard();
    const storageHtml = renderStorageMapTable();
    const monthlyHtml = renderMonthlyCheckTable();
    const qualityHtml = renderDataQualityCheckTable();
    const historyFY = storageFiscalYear();
    const statusMap = {};
    (STATE.datasets || []).filter(d => String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(historyFY)).forEach(d => {
      const fy = d.fiscalYear || fiscalYearFromYM(d.ym);
      if (!statusMap[fy]) statusMap[fy] = { confirmed:new Set(), daily:new Set(), history:new Set() };
      if (d.source === 'history') statusMap[fy].history.add(d.ym);
      else if (d.type === 'daily') statusMap[fy].daily.add(d.ym);
      else statusMap[fy].confirmed.add(d.ym);
    });
    const statusHtml = Object.keys(statusMap).sort().reverse().map(fy => `
      <div style="padding:10px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;font-size:12px">
        <strong>${fy}年度の登録状況</strong>
        <span style="margin-left:10px;color:var(--text2)">確定 ${statusMap[fy].confirmed.size}ヶ月 / 速報 ${statusMap[fy].daily.size}ヶ月 / 補完 ${statusMap[fy].history.size}ヶ月</span>
      </div>
    `).join('');

    const sorted = [...(STATE.datasets || [])]
      .filter(d => String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(historyFY))
      .sort((a,b)=>a.ym.localeCompare(b.ym) || ((a.type||'confirmed')==='confirmed'?-1:1));
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
        <summary style="cursor:pointer;padding:12px 14px;list-style:none;background:#f8fafc;color:var(--text);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:900">詳細履歴を表示</span>
          <span style="display:flex;align-items:center;gap:8px;font-size:12px">
            <span style="color:var(--text2);font-weight:800">対象年度</span>
            <select id="import-history-fy-select" onclick="event.stopPropagation()" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${storageFiscalYearOptionsHtml(historyFY)}</select>
            <span style="font-size:11px;color:var(--text3)">▼</span>
          </span>
        </summary>
        <div style="padding:10px 12px">
          ${statusHtml || '<div style="padding:10px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;font-size:12px;color:var(--text3)">年度別登録状況はまだありません</div>'}
          ${detailHtml}
        </div>
      </details>`;

    listEl.innerHTML = cloudInventoryHtml + backupSyncHtml + healthHtml + storageHtml + monthlyHtml + qualityHtml + historyHtml;
    UI.updateSyncPanelStatus();
  }

  const storageEl = document.getElementById('storage-info');
  if (storageEl) {
    const info = STORE.storageInfo();
    storageEl.innerHTML = `使用容量: <strong>${info.totalKb} KB</strong>（通常 ${info.kb} KB / 世代 ${info.backupKb} KB・センター: ${CENTER.name}）`;
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


/* ════════ §23 REPORT / PAST_LIBRARY（report.jsへ分離） ═════════════════════ */

/* ════════ §25 NAV ══════════════════════════════════════════════ */
const NAV = {
  // メイン画面切替（同期なし、再描画のみ）
  go(el) {
    const view = (el && el.dataset) ? el.dataset.view : (typeof el==='string' ? el : 'dashboard');
    if (!view) return;
    STATE.view = view;
    try { sessionStorage.setItem('lastView', view); } catch(e) {}

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
      case 'field-worker':  if (window.FIELD_WORKER_UI?.render) FIELD_WORKER_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); break;
      case 'field-content': if (window.FIELD_CONTENT_UI?.render) FIELD_CONTENT_UI.render(); else if (window.FIELD_TASK_UI?.render) FIELD_TASK_UI.render(); else if (window.FIELD_CSV_REBUILD?.renderContent) FIELD_CSV_REBUILD.renderContent(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); break;
      case 'field-product': if (window.FIELD_PRODUCT_UI?.render) FIELD_PRODUCT_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); break;
      case 'field-area':    if (window.FIELD_AREA_UI?.render) FIELD_AREA_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); break;
      case 'report':     REPORT_UI.refresh(); break;
      case 'kamoku':     if (window.KAMOKU_UI?.render) KAMOKU_UI.render(); break;
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
      const ds = (view === 'dashboard' || view === 'pl') ? selectedDashboardDS() : latestDS();
      const prefix = (view === 'dashboard' || view === 'pl') ? '表示データ' : '最終データ';
      const label = ds ? `（${datasetKindLabel(ds)}）` : '';
      sub.textContent = ds ? `${prefix}: ${ymLabel(ds.ym)}${label} / ${CENTER.name}` : `データなし — ${CENTER.name}`;
    }
    // センター名を全要素に反映
    document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
    document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent=CENTER.name+'データ取込');
  },

  updateSaveStatus() {
    const label = document.getElementById('autosave-label');
    const dot   = document.getElementById('autosave-dot');
    const syncStatus = safeLocalGet('center:lastSyncStatus') || 'idle';
    const lastSyncAt = safeLocalGet('center:lastSyncAt') || '';
    const lastSaveAt = safeLocalGet('center:lastLocalSaveAt') || '';
    const count = STATE.datasets.length;
    const timeLabel = lastSyncAt
      ? new Date(lastSyncAt).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : (lastSaveAt ? '未同期あり' : '未同期');
    if (label) {
      if (syncStatus === 'syncing') label.textContent = `クラウド同期中... (${count}件)`;
      else if (syncStatus === 'error') label.textContent = `クラウド同期エラー / 最終成功 ${timeLabel}`;
      else label.textContent = `クラウド同期 ${timeLabel} (${count}件)`;
    }
    if (dot) {
      dot.style.background = syncStatus === 'syncing' ? '#f59e0b' : syncStatus === 'error' ? '#dc2626' : (STATE.datasets.length ? '#16a34a' : '#607d9a');
      dot.style.boxShadow = syncStatus === 'syncing' ? '0 0 0 4px rgba(245,158,11,.18)' : '';
    }
  },

  setSyncStatus(status, message) {
    safeLocalSet('center:lastSyncStatus', status || 'idle');
    if (status === 'ok') safeLocalSet('center:lastSyncAt', new Date().toISOString());
    if (message) safeLocalSet('center:lastSyncMessage', message);
    this.updateSaveStatus();
    this.updateSyncPanelStatus();
  },

  updateSyncPanelStatus() {
    const el = document.getElementById('sync-live-status');
    if (!el) return;
    const status = safeLocalGet('center:lastSyncStatus') || 'idle';
    const at = safeLocalGet('center:lastSyncAt') || '';
    const msg = safeLocalGet('center:lastSyncMessage') || '';
    const label = status === 'syncing' ? '同期中' : status === 'error' ? '同期エラー' : at ? '同期済み' : '未同期';
    const color = status === 'syncing' ? '#92400e' : status === 'error' ? '#991b1b' : at ? '#166534' : '#475569';
    const bg = status === 'syncing' ? '#fffbeb' : status === 'error' ? '#fef2f2' : at ? '#f0fdf4' : '#f8fafc';
    el.style.cssText = `border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:${bg};color:${color};font-size:12px;line-height:1.6`;
    el.innerHTML = `<strong>${label}</strong>${at ? ` ／ 最終同期 ${esc(new Date(at).toLocaleString('ja-JP'))}` : ''}${msg ? `<br>${esc(msg)}` : ''}`;
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
  toast(msg, type='ok', opt={}) {
    const stackId = 'toast-stack';
    let stack = document.getElementById(stackId);
    if (!stack) {
      stack = document.createElement('div');
      stack.id = stackId;
      stack.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none';
      document.body.appendChild(stack);
    }
    const palette = {
      error:['#991b1b','#fef2f2','#fecaca','✕'],
      warn:['#92400e','#fffbeb','#fcd34d','!'],
      info:['#1e3a8a','#eff6ff','#bfdbfe','i'],
      ok:['#14532d','#f0fdf4','#bbf7d0','✓']
    };
    const p = palette[type] || palette.ok;
    const el = document.createElement('div');
    el.style.cssText = `pointer-events:auto;min-width:260px;max-width:420px;border:1px solid ${p[2]};background:${p[1]};color:${p[0]};
      border-radius:12px;padding:11px 12px;box-shadow:0 12px 32px rgba(15,23,42,.18);font-size:12px;line-height:1.55;
      font-family:inherit;white-space:normal;animation:fadeIn .16s ease-out`;
    const title = opt.title || (type==='error'?'エラー':type==='warn'?'確認':type==='info'?'お知らせ':'完了');
    const detail = opt.detail ? `<div style="margin-top:5px;color:${p[0]};opacity:.86;white-space:pre-wrap">${esc(opt.detail)}</div>` : '';
    el.innerHTML = `
      <div style="display:flex;gap:9px;align-items:flex-start">
        <div style="width:20px;height:20px;border-radius:999px;background:${p[0]};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex:0 0 auto">${p[3]}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:900;margin-bottom:2px">${esc(title)}</div>
          <div style="white-space:pre-wrap">${esc(msg)}</div>
          ${detail}
        </div>
        <button type="button" aria-label="閉じる" style="border:0;background:transparent;color:${p[0]};font-weight:900;cursor:pointer;font-size:15px;line-height:1">×</button>
      </div>`;
    el.querySelector('button')?.addEventListener('click', () => el.remove());
    stack.appendChild(el);
    const ms = opt.duration || (type==='error' ? 8000 : type==='warn' ? 5500 : 3500);
    setTimeout(()=>el.remove(), ms);
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
  debug() {
    console.log('STATE', STATE);
    console.log('STORE managed keys', STORE._p, typeof STORE.managedKeys === 'function' ? STORE.managedKeys() : []);
    UI.toast('コンソールにSTATEをダンプしました');
  },
  restoreAll() { STORE.load(); return STATE.datasets.length; },
};
const CLOUD_DEBUG = { run() { CLOUD.saveConfig(); } };
const PUBLISH = { go() { UI.toast('GitHub Pages での公開はHTMLファイルを直接アップロードしてください'); } };
const EVENTS = { handleFiles(files) { IMPORT.handleFiles(files); } };

function installStoreTelemetry() {
  if (!window.STORE || STORE.__telemetryInstalled || typeof STORE.save !== 'function') return;
  STORE.__telemetryInstalled = true;
  const originalSave = STORE.save.bind(STORE);
  STORE.save = function(...args) {
    const result = originalSave(...args);
    safeLocalSet('center:lastLocalSaveAt', new Date().toISOString());
    UI.updateSaveStatus();
    return result;
  };
}

function installCloudTelemetry() {
  if (!window.CLOUD || CLOUD.__telemetryInstalled) return;
  CLOUD.__telemetryInstalled = true;
  const targets = [
    ['pushAll', 'クラウド全体同期'],
    ['pushMonth', '月次データ同期'],
    ['syncSmart', 'クラウド同期'],
    ['syncNow', '手動同期'],
    ['pull', 'クラウド読込'],
    ['refreshInventoryPanel', 'クラウド保存状況確認']
  ];
  targets.forEach(([name, label]) => {
    if (typeof CLOUD[name] !== 'function' || CLOUD[name].__wrapped) return;
    const original = CLOUD[name].bind(CLOUD);
    const wrapped = async function(...args) {
      const isInventory = name === 'refreshInventoryPanel';
      const isPull = name === 'pull';
      UI.setSyncStatus('syncing', `${label}を実行中...`);
      try {
        const result = await original(...args);
        UI.setSyncStatus('ok', `${label}が完了しました`);
        if (name === 'syncNow') UI.toast('クラウド同期が完了しました', 'ok', { title:'同期完了' });
        if (isInventory) UI.toast('クラウド保存状況を確認しました', 'ok', { title:'確認完了' });
        return result;
      } catch(e) {
        const msg = errorMessage(e);
        UI.setSyncStatus('error', `${label}に失敗しました：${msg}`);
        if (!isPull) UI.toast(`${label}に失敗しました`, 'error', { title:'クラウドエラー', detail: msg });
        throw e;
      }
    };
    wrapped.__wrapped = true;
    CLOUD[name] = wrapped;
  });
}

// 計画データ取込（PLAN）
const PLAN = {
  importFromPaste() {
    const fy = getSelectedFiscalYear('plan-year-sel');
    const text = document.getElementById('plan-paste-area')?.value||'';
    const msg  = document.getElementById('plan-import-msg');
    if (!text.trim()) {
      UI.toast('貼付欄が空です','warn');
      if (msg) msg.textContent = '貼付欄が空です';
      return;
    }
    const plan = CSV.parsePlan(text);
    if (!plan) {
      UI.toast('計画データを解析できませんでした。タブ区切りでペーストしてください。','warn');
      if (msg) msg.textContent = '解析失敗';
      return;
    }
    if (STATE.planData[fy]) {
      const ok = confirm(`${fy}年度の計画データは既に登録されています。\n\n今回の貼付データで、${fy}年度の計画データをすべて入れ替えますか？\n\n※差分追加ではありません。既存の${fy}年度計画を削除してから登録します。`);
      if (!ok) return;
      delete STATE.planData[fy];
    }
    clearDataDeleted('planFiscalYears', fy);
    STATE.planData[fy] = {
      rows: plan,
      fiscalYear: fy,
      importedAt: new Date().toISOString(),
      itemCount: Object.keys(plan).length,
      unit:'千円',
      mode:'full_replace'
    };
    STORE.save();
    const area = document.getElementById('plan-paste-area');
    if (area) area.value = '';
    const count = Object.keys(plan).length;
    if (msg) msg.textContent = `${fy}年度 完全入替完了: ${count}科目`;
    renderImport();
    NAV.refresh();
    CLOUD.syncSmart().then(r => {
      if (r && r.ok) UI.toast(`${fy}年度 計画データを完全入替し、クラウド同期しました（${count}科目）`);
      else UI.toast(`${fy}年度 計画データは保存しましたが、クラウド同期に失敗しました`, 'warn');
    }).catch(() => UI.toast(`${fy}年度 計画データは保存しましたが、クラウド同期に失敗しました`, 'warn'));
  },
  clear() {
    const fy = getSelectedFiscalYear('plan-year-sel');
    if (!STATE.planData[fy]) { UI.toast(`${fy}年度の計画データは未登録です`, 'warn'); return; }
    if (!confirm(`${fy}年度の計画データを削除しますか？\n他年度は削除しません。`)) return;
    markDataDeleted('planFiscalYears', fy);
    delete STATE.planData[fy];
    applyDeletionTombstonesToState(STATE);
    STORE.save();
    const msg = document.getElementById('plan-import-msg');
    if (msg) msg.textContent = `${fy}年度の計画データを削除しました`;
    renderImport();
    NAV.refresh();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました', 'warn'));
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
    STORE.save();
    NAV.refresh();
    if (msg) msg.textContent = `${fy}年度 完全入替完了: ${imported}ヶ月`;
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>UI.toast('収支補完は保存しましたが、クラウド同期に失敗しました', 'warn'));
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
    STORE.save();
    const deleted = before - STATE.datasets.length;
    renderImport();
    NAV.refresh();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>UI.toast('ローカル削除は完了しましたが、クラウド同期に失敗しました', 'warn'));
    UI.toast(`${fy}年度 収支補完 ${deleted}件を削除しました`);
  }
};

// 現場データ取込2（インポート画面の2つ目のゾーン）

// 現場データリスト更新・削除処理は field.js に分割

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


/* ════════ §29-A AUTO_SYNC（sync.jsへ分割） ════════════════ */

/* ════════ §29 計画データ取込 ══════════════════════════════════ */
function setupPlanImport() {
  const btn = document.getElementById('plan-import-btn');
  if (btn) btn.onclick = () => PLAN.importFromPaste();
}

/* ════════ §30-A SCREEN MODULE LOADER ════════════════════════════════ */
function loadExternalScriptOnce(id, src) {
  if (document.getElementById(id)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.defer = true;
    el.onload = () => resolve(true);
    el.onerror = () => reject(new Error(src + ' の読み込みに失敗しました'));
    document.head.appendChild(el);
  });
}

async function loadScreenModules() {
  await loadExternalScriptOnce('module-shipper', 'shipper.js');
  await loadExternalScriptOnce('module-kamoku', 'kamoku.js');
}

/* ════════ §30 BOOT ═════════════════════════════════════════════ */
function setupFieldImportYMControls(){}
document.addEventListener('DOMContentLoaded', async () => {
  // 0. 画面別モジュール読込（shipper.jsはHTMLで読込済みのためスキップ）
  // ※ loadScreenModules()は削除済み。shipper.jsはcenter.html末尾で読み込んでいる。

  // 1. ローカルストレージから読込
  installStoreTelemetry();
  STORE.load();
  // 削除済みマーカー適用後の状態をローカルへ即保存し、リロード直後の古い補完・計画復活を防ぐ
  STORE.save();

  // 1.5 保存・取込・更新時の自動同期を有効化
  AUTO_SYNC.install();
  installCloudTelemetry();
  UI.updateSaveStatus();

  // 2. センター情報を画面に反映
  document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
  document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent=CENTER.name+'データ取込');

  // 3. ドロップゾーン設定
  setupDropZone('upload-zone', 'file-input', f=>IMPORT.handleFiles(f));
  setupDropZone('field-upload-zone', 'field-file-input', f=>{
    if (window.FIELD_WORKER_IMPORT2 && FIELD_WORKER_IMPORT2.handleFiles) FIELD_WORKER_IMPORT2.handleFiles(f);
    else IMPORT.handleFiles(f);
  });
  setupDropZone('field-upload-zone2', 'field-file-input2', f=>{
    if (window.FIELD_PRODUCT_IMPORT2 && FIELD_PRODUCT_IMPORT2.handleFiles) FIELD_PRODUCT_IMPORT2.handleFiles(f);
    else IMPORT.handleFiles(f);
  });

  // 4. ファイル復元用
  const loadInput = document.getElementById('session-load-input');
  if (loadInput) loadInput.onchange = () => { STORE.restoreJSON(loadInput.files[0]); loadInput.value=''; };

  // 5. キャパ月選択
  CAPACITY_UI.populateYMSel();

  // 6. 計画取込
  setupPlanImport();

  // 7. 年度Select全初期化・年度変更ガード
  initFiscalYearSelects();
  setupFieldImportYMControls();

  // 8. オーバーレイにセンター名を表示
  const _overlayName = document.getElementById('overlay-center-name');
  if (_overlayName) _overlayName.textContent = CENTER.name;

  // 9. クラウド設定フォームとバッジを初期化
  CLOUD.renderForm();
  window.addEventListener('offline', () => {
    UI.setSyncStatus('error', 'ネットワークがオフラインです。保存はローカルに残りますが、クラウド同期は復旧後に確認してください。');
    UI.toast('ネットワークがオフラインになりました', 'warn', { title:'接続確認' });
  });
  window.addEventListener('online', () => {
    UI.toast('ネットワークが復旧しました。必要に応じて「今すぐ同期」を押してください', 'info', { title:'接続復旧' });
    UI.updateSaveStatus();
  });

  // 10. Supabase同期 → 完了後にオーバーレイをフェードアウトして画面表示
  const _lastView = (() => { try { return sessionStorage.getItem('lastView') || 'dashboard'; } catch(e){ return 'dashboard'; } })();
  const _overlayStatus = document.getElementById('overlay-status');

  function _hideOverlay() {
    const ov = document.getElementById('app-loading-overlay');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 420);
  }

  // ローカルキャッシュがあれば即表示してからバックグラウンド同期
  const _hasLocal = STATE.datasets && STATE.datasets.length > 0;
  if (_hasLocal) {
    // キャッシュあり: 先にページを描画してオーバーレイを外す（体感ゼロ秒）
    NAV.go(_lastView);
    UI.updateSaveStatus();
    UI.updateTopbar(_lastView);
    _hideOverlay();
    // バックグラウンドでSupabase同期（画面表示後に静かに更新）
    AUTO_SYNC.withoutSyncAsync(async () => CLOUD.pull())
      .then(r => {
        if (r && r.ok && r.changed) {
          NAV.refresh();
          UI.updateTopbar(STATE.view || _lastView);
          UI.updateSaveStatus();
          UI.toast('クラウドの最新データを反映しました');
        }
      })
      .catch(() => {});
  } else {
    // キャッシュなし（初回・新PC）: Supabase同期が完了するまでオーバーレイを表示
    if (_overlayStatus) _overlayStatus.textContent = 'Supabaseからデータを取得中...';
    AUTO_SYNC.withoutSyncAsync(async () => CLOUD.pull())
      .then(r => {
        NAV.go(_lastView);
        UI.updateSaveStatus();
        UI.updateTopbar(_lastView);
        _hideOverlay();
        if (r && r.ok && r.changed) {
          setTimeout(() => UI.toast('クラウドの最新データを読み込みました'), 500);
        }
      })
      .catch(() => {
        // 同期失敗でもオーバーレイは外す
        NAV.go(_lastView);
        UI.updateSaveStatus();
        UI.updateTopbar(_lastView);
        _hideOverlay();
        UI.toast('クラウド接続に失敗しました（オフライン？）', 'warn');
      });
  }
});
