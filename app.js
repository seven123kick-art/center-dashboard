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
    kamoku:'収支科目 詳細分析', report:'会議報告書',
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

/* ════════ §4 STORE（localStorage、センター別） ════════════════ */
const STORE = {
  _p: `mgmt5_${CENTER.id}_`,

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

  exportJSON() {
    sanitizePersonalDataState(STATE);
    const blob = new Blob([JSON.stringify({
      center:CENTER.id, exportedAt:new Date().toISOString(),
      datasets:STATE.datasets, fieldData:STATE.fieldData, areaData:STATE.areaData,
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

/* ════════ §7 IMPORT ════════════════════════════════════════════ */
const IMPORT = {
  _pending: [],
  _replaceYM: null,
  _replaceType: null,

  handleFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const csv  = arr.filter(f=>/\.csv$/i.test(f.name));
    const xlsx = arr.filter(f=>/\.(xlsx|xls)$/i.test(f.name));

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
    if (xlsx.length) { this.importCapacityExcel(xlsx[0]).catch(e=>UI.toast(e.message,'error')); return; }
    UI.toast('対応形式：CSV（収支・現場明細）・XLSX（キャパ）','warn');
  },

  async processCSV(files, ym, opt={}) {
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    const selectedType = document.querySelector('input[name="manual-import-type"]:checked')?.value;
    const importType = selectedType === 'daily' ? 'daily' : 'confirmed';
    const existing = STATE.datasets.find(d => d.ym === ym && (d.type || 'confirmed') === importType && d.source !== 'history');

    if (existing && !opt.replace) {
      const label = `${ymLabel(ym)}（${importType==='confirmed'?'確定':'速報'} / ${existing.fileName || 'ファイル名なし'}）`;
      const ok = confirm(`${label} は既に登録されています。\n\n新しいCSVで入れ替えますか？`);
      if (!ok) {
        UI.toast('取込を中止しました', 'warn');
        return;
      }
    }

    let imported = 0;
    for (const f of files) {
      try {
        const text = await CSV.read(f);
        const rows = CSV.parseSKDL(text, monthCol);
        if (!rows) { UI.toast(`${f.name}: データ行が見つかりません`,'warn'); continue; }
        const type = importType;
        const ds = processDataset(ym, type, rows);
        ds.source = 'csv';
        ds.fileName = f.name;
        ds.fiscalYear = fiscalYearFromYM(ym);
        ds.unit = '円';
        ds.replacedAt = existing ? new Date().toISOString() : null;

        // 差替時は同じ年月＋同じ区分だけ削除してから入れる（速報と確定は両方保持）
        STATE.datasets = STATE.datasets.filter(d => !(d.ym === ym && (d.type || 'confirmed') === type && d.source !== 'history'));
        upsertDataset(ds);
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

      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
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

  area.innerHTML = `
    <div class="kpi-card accent-navy">
      <div class="kpi-label">営業収益（当月）</div>
      <div class="kpi-value navy">${fmtK(ds.totalIncome)}<span style="font-size:13px;font-weight:400">千円</span></div>
      <div class="kpi-sub-row">
        <span class="kpi-sub">${ymLabel(ds.ym)}（${datasetKindLabel(ds)}）</span>
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
    <div class="kpi-row kpi-row-3" style="margin-bottom:16px">
      <div class="kpi-card ${laborOk?'accent-green':'accent-red'}">
        <div class="kpi-label">みなし人件費率（${ymLabel(ds.ym)}）</div>
        <div class="kpi-value ${laborOk?'green':'red'}">${pct(ds.pseudoLaborRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${laborOk?'up':'down'}">${laborOk?'✓ 達成':'⚠ 超過'} 目標${T.pseudoLaborRate}%</span></div>
      </div>
      <div class="kpi-card ${varOk?'accent-green':'accent-amber'}">
        <div class="kpi-label">変動費率（${ymLabel(ds.ym)}）</div>
        <div class="kpi-value ${varOk?'green':'amber'}">${pct(ds.variableRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${varOk?'up':'flat'}">${varOk?'✓ 正常':'⚠ 高め'} 目標${T.variableRateMax}%以内</span></div>
      </div>
      <div class="kpi-card ${smOk?'accent-green':smWarn?'accent-amber':'accent-red'}">
        <div class="kpi-label">利益率（安全余裕率）</div>
        <div class="kpi-value ${smOk?'green':smWarn?'':'red'}">${pct(smRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${smOk?'up':smWarn?'flat':'down'}">${smOk?'✓ 安全':smWarn?'△ 要注意':'⚠ 危険'}</span></div>
      </div>
    </div>

    <div class="grid2" style="margin-bottom:14px">
      <div class="card"><div class="card-header"><span class="card-title">固定費 / 変動費　構成（年度最新月）</span></div>
        <div class="card-body">
          ${gauge(ds.fixedRate, 50, 65, '%', true)}
          ${gauge(ds.variableRate, T.variableRateMax, 90, '%', true)}
          <div style="font-size:12px;color:var(--text2);line-height:1.8">
            固定費：${fmtK(ds.fixedCost)}千円 / 変動費：${fmtK(ds.varCost)}千円
          </div>
        </div></div>
      <div class="card"><div class="card-header"><span class="card-title">損益分岐点　簡易判定（年度最新月）</span></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text2);line-height:1.9">
            営業収益：${fmtK(ds.totalIncome)}千円<br>
            費用合計：${fmtK(ds.totalExpense)}千円<br>
            粗利益：${fmtK(ds.profit)}千円<br>
            利益率：${pct(ds.profitRate)}
          </div>
        </div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><span class="card-title">各指標　月次推移（選択年度内）</span></div>
      <div class="card-body"><div class="chart-wrap" style="height:220px"><canvas id="c-ind-trend"></canvas></div></div>
    </div>`;

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
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">年度累計収入（${fy}年度）</div>
        <div class="kpi-value navy">${fmtK(inc)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub">${list.length}ヶ月分</div></div>
      <div class="kpi-card accent-red"><div class="kpi-label">年度累計費用</div>
        <div class="kpi-value red">${fmtK(exp)}<span style="font-size:13px;font-weight:400">千円</span></div></div>
      <div class="kpi-card ${prf>=0?'accent-green':'accent-red'}"><div class="kpi-label">年度累計利益</div>
        <div class="kpi-value ${prf>=0?'green':'red'}">${fmtK(prf)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub-row"><span class="pill ${prf>=0?'up':'down'}">${pct(prf/inc*100)} 利益率</span></div></div>`;
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

/* ════════ §19 RENDER — Capacity（完全安定版） ═══════════════════ */
const CAPACITY_UI = {
  _tab:'monthly',
  _lastRows:[],
  _lastDailyRows:[],

  defaultMapping() {
    return [
      { pattern:'埼玉県さいたま市|さいたま市', area:'埼玉_さいたま', priority:30 },
      { pattern:'東京都板橋区|東京都北区', area:'東京_北/板', priority:30 },
      { pattern:'東京都豊島区|東京都文京区|東京都練馬区', area:'東京_豊島/文京', priority:30 },
      { pattern:'埼玉県戸田市|埼玉県蕨市|埼玉県川口市', area:'埼玉_蕨/戸田', priority:30 },
      { pattern:'埼玉県志木市|埼玉県朝霞市|埼玉県和光市|埼玉県新座市', area:'埼玉_志木朝霞', priority:30 },
      { pattern:'東京都足立区|東京都荒川区|東京都台東区|東京都墨田区|東京都江東区|東京都葛飾区|東京都江戸川区', area:'東京_東部', priority:20 },
      { pattern:'東京都', area:'東京_その他', priority:5 },
      { pattern:'埼玉県', area:'埼玉_その他', priority:5 },
      { pattern:'千葉県|神奈川県|群馬県|栃木県|茨城県', area:'その他', priority:1 }
    ];
  },

  ensureState() {
    STATE.capacity = STATE.capacity || {};
    STATE.capacity.areas = {}; // 旧Excelキャパは使用しない
    STATE.capacity.mapping = []; // 旧地区マッピングは使用しない
    STATE.capacity.calendar = STATE.capacity.calendar || {};
    STATE.capacity.shipperGroups = Array.isArray(STATE.capacity.shipperGroups) && STATE.capacity.shipperGroups.length ? STATE.capacity.shipperGroups : this.defaultShipperGroups();
    STATE.capacity.shipperAreaCaps = {}; // 旧地区別荷主キャパは使用しない
    STATE.capacity.capacityGroups = Array.isArray(STATE.capacity.capacityGroups) ? STATE.capacity.capacityGroups : [];
    this._capRegionFilter = this._capRegionFilter || 'saitama_all';
  },

  defaultShipperGroups() {
    return [
      { key:'kojima_bic', label:'コジマ＋ビック', patterns:'コジマ|ビック|ビックカメラ|BIC|KOJIMA', codePrefixes:'', active:true, sort:10 },
      { key:'denkichi', label:'でんきち', patterns:'でんきち|デンキチ', codePrefixes:'', active:true, sort:20 },
      { key:'edion', label:'エディオン', patterns:'エディオン|EDION', codePrefixes:'', active:true, sort:30 },
      { key:'other', label:'その他', patterns:'', codePrefixes:'', active:false, sort:99 }
    ];
  },

  migrateShipperCaps() {
    const cap = STATE.capacity || {};
    cap.shipperAreaCaps = cap.shipperAreaCaps || {};
    // 旧「荷主別1本キャパ」は、地区別キャパへは自動展開しない。二重計上防止のため参照だけ残す。
    (cap.shipperGroups || this.defaultShipperGroups()).forEach(g=>{
      cap.shipperAreaCaps[g.key] = cap.shipperAreaCaps[g.key] || {};
    });
  },

  normArea(v) {
    return String(v || '')
      .normalize('NFKC')
      .replace(/\s+/g,'')
      .replace(/_n/g,'_')
      .replace(/＿n/g,'_')
      .replace(/北\/板橋/g,'北/板')
      .trim();
  },

  n(v) {
    const x = Number(String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[^\d.-]/g,''));
    return Number.isFinite(x) ? x : 0;
  },

  getYM() {
    return document.getElementById('capacity-ym')?.value ||
      (STATE.selYM || '') ||
      ((STATE.productAddressData || []).at(-1)?.ym) ||
      ((STATE.fieldData || []).at(-1)?.ym) ||
      (latestDS()?.ym) || '';
  },

  getDays() {
    // 週7稼働前提：月キャパは日別カレンダーを1日ずつ積み上げるため、手入力の稼働日数は使わない
    const ym = this.getYM();
    return this.daysInYM(ym) || 0;
  },

  getBaseMode() {
    return 'calendar';
  },

  ymDate(ym, d) {
    return `${String(ym).slice(0,4)}-${String(ym).slice(4,6)}-${String(d).padStart(2,'0')}`;
  },

  daysInYM(ym) {
    const y = Number(String(ym).slice(0,4));
    const m = Number(String(ym).slice(4,6));
    return new Date(y, m, 0).getDate();
  },

  dow(dateStr) {
    return new Date(dateStr + 'T00:00:00').getDay();
  },

  isWeekend(dateStr) {
    const d = this.dow(dateStr);
    return d === 0 || d === 6;
  },

  dateLabel(dateStr) {
    const d = this.dow(dateStr);
    return `${Number(dateStr.slice(5,7))}/${Number(dateStr.slice(8,10))}（${['日','月','火','水','木','金','土'][d]}）`;
  },

  parseDate(v, ym) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    }
    const raw = String(v ?? '').normalize('NFKC').trim();
    if (!raw) return '';

    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(dt.getTime())) {
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
      }
    }

    const nums = raw.replace(/[^0-9]/g,'');
    if (nums.length >= 8) return `${nums.slice(0,4)}-${nums.slice(4,6)}-${nums.slice(6,8)}`;
    if (nums.length >= 1 && nums.length <= 2 && ym) {
      const d = Number(nums);
      if (d >= 1 && d <= 31) return this.ymDate(ym, d);
    }
    return '';
  },

  ticketDate(t, ym) {
    const d = this.parseDate(t.date || t.deliveryDate || t.workDate || t['日付'] || t['作業日'] || t['配達完了日'], ym);
    if (d) return d;
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      const d2 = this.parseDate(row[0], ym);
      if (d2) return d2;
    }
    return '';
  },

  normalizeZip(v) {
    if (window.JP_ZIP_LOADER?.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  },

  cityFromAddress(address) {
    const t = String(address || '').normalize('NFKC').replace(/\s+/g,'').trim();
    if (!t) return '未設定';

    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = pref ? t.slice(pref.length) : t;

    // さいたま市は同じ市内でも区ごとにキャパが違うため、区が住所に含まれる場合は最優先で区まで保持する。
    // 例：埼玉県さいたま市大宮区、さいたま大宮区、さいたま市桜区 など。
    const saitamaWardMatch = rest.match(/さいたま(?:市)?(西区|北区|大宮区|見沼区|中央区|桜区|浦和区|南区|緑区|岩槻区)/);
    if (saitamaWardMatch) return '埼玉県さいたま市' + saitamaWardMatch[1];

    // エリア分析側と同じ考え方：郵便番号が取れない場合でも、町域・番地ではなく行政区・市で止める。
    const known = [
      'さいたま市西区','さいたま市北区','さいたま市大宮区','さいたま市見沼区','さいたま市中央区',
      'さいたま市桜区','さいたま市浦和区','さいたま市南区','さいたま市緑区','さいたま市岩槻区',
      '蕨市','戸田市','川口市','朝霞市','和光市','志木市','新座市','富士見市','ふじみ野市',
      '川越市','所沢市','狭山市','上尾市','桶川市','北本市','鴻巣市','入間市','草加市','越谷市',
      '熊谷市','本庄市','深谷市','秩父市','行田市','加須市','羽生市','久喜市','蓮田市','幸手市','白岡市',
      '板橋区','北区','豊島区','練馬区','文京区','足立区','荒川区','台東区','江東区','大田区',
      '世田谷区','新宿区','港区','墨田区','品川区','目黒区','中野区','杉並区','渋谷区','中央区','千代田区'
    ];
    for (const name of known) {
      if (rest.startsWith(name)) return pref + name;
    }

    // 「蕨中央5-」「戸田美女木」など、市名の「市」が落ちた住所を補正する。
    const saitamaFallbacks = [
      ['蕨','蕨市'],['戸田','戸田市'],['川口','川口市'],['朝霞','朝霞市'],['和光','和光市'],['志木','志木市'],['新座','新座市'],
      ['富士見','富士見市'],['ふじみ野','ふじみ野市'],['上尾','上尾市'],['桶川','桶川市'],['北本','北本市'],['鴻巣','鴻巣市'],
      ['熊谷','熊谷市'],['深谷','深谷市'],['本庄','本庄市'],['秩父','秩父市']
    ];
    if (!pref || pref === '埼玉県') {
      for (const [head, city] of saitamaFallbacks) {
        if (rest.startsWith(head)) return '埼玉県' + city;
      }
    }

    const tokyoFallbacks = [
      ['板橋','板橋区'],['北','北区'],['豊島','豊島区'],['練馬','練馬区'],['文京','文京区'],['足立','足立区'],['荒川','荒川区'],
      ['台東','台東区'],['江東','江東区'],['大田','大田区'],['世田谷','世田谷区'],['新宿','新宿区'],['港','港区'],['墨田','墨田区'],
      ['品川','品川区'],['目黒','目黒区'],['中野','中野区'],['杉並','杉並区'],['渋谷','渋谷区'],['中央','中央区'],['千代田','千代田区']
    ];
    if (pref === '東京都') {
      for (const [head, ward] of tokyoFallbacks) {
        if (rest.startsWith(head)) return '東京都' + ward;
      }
    }

    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return pref + wardCity[1];
    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return pref + muni[1];
    return '未設定';
  },

  cityFromZip(zip) {
    const z = this.normalizeZip(zip);
    if (!z) return '';
    let hit = null;
    if (window.JP_ZIP_LOADER?.get) hit = JP_ZIP_LOADER.get(z);
    else if (window.JP_ZIP_MASTER) hit = JP_ZIP_MASTER[z];
    if (!hit) return '';
    if (Array.isArray(hit)) return String(hit[0]||'') + String(hit[1]||'');
    if (typeof hit === 'object') return String(hit.pref || hit.prefecture || hit[0] || '') + String(hit.city || hit.municipality || hit.addr1 || hit[1] || '');
    return this.cityFromAddress(String(hit));
  },

  ticketCity(t) {
    // エリア分析と同じく、過去に生成された t.area / t.city は粗い値が残ることがあるため最優先しない。
    // ただし、さいたま市は郵便番号マスタが未ロード／粗い値の場合に「さいたま市」止まりになるため、
    // 住所に区が入っている場合は住所側を優先し、区単位を維持する。
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    const isCoarseSaitama = (v) => /^埼玉県さいたま市?$/.test(String(v || '').normalize('NFKC').replace(/\s+/g,''));

    const addr = t.address || t.addr || t.destinationAddress ||
      t['住所'] || t['届け先住所'] || t['配送先住所'] || t['お届け先住所'] ||
      (Array.isArray(row) ? row[13] : '');
    const addrCity = this.normalizeCapacityUnit(this.cityFromAddress(addr));
    if (addrCity && addrCity !== '未設定' && !isCoarseSaitama(addrCity)) return addrCity;

    const zip = this.normalizeZip(
      t.zip || t.zipcode || t.postCode || t.postalCode ||
      t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] ||
      (Array.isArray(row) ? row[11] : '')
    );
    const zipCity = this.normalizeCapacityUnit(this.cityFromZip(zip));
    if (zipCity && zipCity !== '未設定' && !isCoarseSaitama(zipCity)) return zipCity;

    if (t.pref && t.city && t.ward) {
      const prefCityWard = this.normalizeCapacityUnit(String(t.pref) + String(t.city) + String(t.ward));
      if (prefCityWard && prefCityWard !== '未設定' && !isCoarseSaitama(prefCityWard)) return prefCityWard;
    }
    if (t.pref && t.city) {
      const prefCity = this.normalizeCapacityUnit(String(t.pref) + String(t.city));
      if (prefCity && prefCity !== '未設定' && !isCoarseSaitama(prefCity)) return prefCity;
    }

    const oldCity = this.normalizeCapacityUnit(t.city || t.area || '');
    if (oldCity && oldCity !== '未設定' && !isCoarseSaitama(oldCity)) return oldCity;

    // どうしても区が取れない場合だけ粗いさいたま市を返す。
    // 荷主キャパ設定側では区単位を優先するため、通常は郵便番号マスタ読込後に区へ分解される。
    if (addrCity && addrCity !== '未設定') return addrCity;
    if (zipCity && zipCity !== '未設定') return zipCity;
    if (oldCity && oldCity !== '未設定') return oldCity;

    return '未設定';
  },

  ticketSlip(t, idx) {
    return String(t.slip || t.slipNo || t.ticketNo || t.invoiceNo || t['原票番号'] || t['エスライン原票番号'] || '').trim() || `no_${idx}`;
  },

  confirmedShipperInfoBySlip(slip, ym) {
    const key = String(slip || '').trim();
    if (!key) return null;
    const list = (STATE.datasets || []).filter(d=>!ym || d.ym === ym);
    for (const ds of list) {
      const map = ds && ds.confirmedSlipSales;
      if (!map || typeof map !== 'object') continue;
      const hit = map[key] || map[key.replace(/^0+/, '')];
      if (!hit) continue;
      const name = String(hit.shipperName || hit.clientName || hit.name || '').trim();
      const code = String(hit.shipperCode || hit.clientCode || hit.code || '').trim();
      if (name || code) return { name, code };
    }
    return null;
  },

  confirmedShipperBySlip(slip, ym) {
    const info = this.confirmedShipperInfoBySlip(slip, ym);
    return info?.name || '';
  },

  ticketShipperCode(t, slip='', ym='') {
    const direct = String(t.shipperCode || t.clientCode || t.customerCode || t['荷主コード'] || t['荷主基本コード'] || t['荷主ＣＤ'] || t['荷主CD'] || '').trim();
    if (direct) return direct;
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      // 確定CSV標準：Y列=荷主基本コード。商品・住所CSV側に同等列がある場合も拾う。
      const candidates = [row[24], row[25], row[23]];
      for (const v of candidates) {
        const code = String(v || '').normalize('NFKC').replace(/[^0-9A-Za-z]/g,'').trim();
        if (code && /^\d{2,}/.test(code)) return code;
      }
    }
    return this.confirmedShipperInfoBySlip(slip || this.ticketSlip(t,0), ym)?.code || '';
  },

  ticketShipperName(t, slip='', ym='') {
    const direct = String(t.shipperName || t.shipper || t.clientName || t.customerName || t['荷主名'] || t['荷主名称'] || t['契約名'] || t['契約名称'] || '').trim();
    if (direct) return direct;

    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      // 確定CSVの標準位置：AA列=荷主名、AB列=契約名。商品・住所CSV側に同等列がある場合も拾う。
      const candidates = [row[26], row[27], row[25]];
      for (const v of candidates) {
        const name = String(v || '').normalize('NFKC').trim();
        if (name && !/^0+$/.test(name) && !/^\d{4,}$/.test(name)) return name;
      }
    }

    return this.confirmedShipperInfoBySlip(slip || this.ticketSlip(t, 0), ym)?.name || '未設定';
  },

  normalizeShipperGroup(name='', code='') {
    this.ensureState();
    const n = String(name || '').normalize('NFKC').toUpperCase();
    const c = String(code || '').normalize('NFKC').replace(/[^0-9A-Z]/g,'').toUpperCase();
    const groups = (STATE.capacity.shipperGroups || this.defaultShipperGroups()).slice().sort((a,b)=>this.n(a.sort)-this.n(b.sort));
    for (const g of groups) {
      if (g.key === 'other') continue;
      const codes = String(g.codePrefixes || '').split('|').map(x=>x.trim().toUpperCase()).filter(Boolean);
      if (c && codes.some(prefix=>c.startsWith(prefix))) return g.label || g.key;
      const pats = String(g.patterns || '').normalize('NFKC').toUpperCase().split('|').map(x=>x.trim()).filter(Boolean);
      if (pats.some(p=>n.includes(p))) return g.label || g.key;
    }
    return 'その他';
  },

  shipperGroupKeyByLabel(label) {
    this.ensureState();
    const g = (STATE.capacity.shipperGroups || []).find(x=>String(x.label) === String(label) || String(x.key) === String(label));
    return g?.key || 'other';
  },

  shipperGroupByKey(key) {
    this.ensureState();
    return (STATE.capacity.shipperGroups || []).find(x=>x.key === key) || { key:'other', label:'その他', active:false };
  },

  ticketShipper(t, slip='', ym='') {
    const name = this.ticketShipperName(t, slip, ym);
    const code = this.ticketShipperCode(t, slip, ym);
    return this.normalizeShipperGroup(name, code);
  },

  mappedArea(city) {
    const c = String(city || '').normalize('NFKC').trim();
    const rules = (STATE.capacity?.mapping || this.defaultMapping()).slice().sort((a,b)=>this.n(b.priority)-this.n(a.priority));
    for (const r of rules) {
      const parts = String(r.pattern || '').normalize('NFKC').split('|').map(x=>x.trim()).filter(Boolean);
      if (parts.some(p=>c.includes(p))) return this.normArea(r.area || '未分類');
    }
    return '未分類';
  },

  selectedProductRecord() {
    const ym = this.getYM();
    const list = STATE.productAddressData || [];
    return list.find(r=>r.ym === ym) || list.at(-1) || null;
  },

  buildActual() {
    const rec = this.selectedProductRecord();
    if (!rec || !Array.isArray(rec.tickets) || !rec.tickets.length) {
      return { ym:this.getYM(), source:'未取得', rawCount:0, tickets:[], byArea:new Map(), byDateArea:new Map(), unmatched:new Map(), hasDate:false };
    }
    const ym = rec.ym || this.getYM();
    const uniq = new Map();
    let hasDate = false;

    rec.tickets.forEach((t, idx)=>{
      const slip = this.ticketSlip(t, idx);
      const dt = this.ticketDate(t, ym);
      if (dt) hasDate = true;
      const date = dt || '';
      const city = this.ticketCity(t);
      const capGroup = this.capacityGroupForUnit(city);
      const area = capGroup ? (capGroup.name || '未設定区分') : '未区分';
      const shipperName = this.ticketShipperName(t, slip, ym);
      const shipperCode = this.ticketShipperCode(t, slip, ym);
      const shipper = this.normalizeShipperGroup(shipperName, shipperCode);
      const key = `${date || 'monthly'}__${slip}`;
      if (!uniq.has(key)) uniq.set(key, { slip, date, city, area, shipper, shipperName, shipperCode });
    });

    const tickets = [...uniq.values()];
    const byArea = new Map();
    const byDateArea = new Map();
    const unmatched = new Map();

    tickets.forEach(t=>{
      if (!byArea.has(t.area)) byArea.set(t.area,{ area:t.area, count:0, shippers:{}, cities:{} });
      const a = byArea.get(t.area);
      a.count++;
      a.shippers[t.shipper] = (a.shippers[t.shipper] || 0) + 1;
      a.cities[t.city] = (a.cities[t.city] || 0) + 1;

      if (t.area === '未分類') {
        const key = t.city || '未設定';
        unmatched.set(key, (unmatched.get(key) || 0) + 1);
      }

      if (hasDate && t.date) {
        const dk = `${t.date}__${t.area}`;
        if (!byDateArea.has(dk)) byDateArea.set(dk,{ date:t.date, area:t.area, count:0, cities:{}, shippers:{} });
        const d = byDateArea.get(dk);
        d.count++;
        d.cities[t.city] = (d.cities[t.city] || 0) + 1;
        d.shippers[t.shipper] = (d.shippers[t.shipper] || 0) + 1;
      }
    });

    // 日付がない月次CSVの場合は、月件数÷カレンダー日数で日別推定として展開する。
    if (!hasDate) {
      const days = this.daysInYM(ym);
      byArea.forEach(a=>{
        const avg = a.count / days;
        for (let d=1; d<=days; d++) {
          const date = this.ymDate(ym,d);
          byDateArea.set(`${date}__${a.area}`, { date, area:a.area, count:avg, cities:a.cities, shippers:a.shippers || {}, estimated:true });
        }
      });
    }

    return { ym, source:rec.files?.join(', ') || rec.source || 'productAddressData', rawCount:rec.rawRows || rec.detailRows || rec.tickets.length, tickets, byArea, byDateArea, unmatched, hasDate };
  },

  dayType(dateStr) {
    return STATE.capacity?.calendar?.[dateStr]?.type || 'normal';
  },

  dayAdj(dateStr) {
    return this.n(STATE.capacity?.calendar?.[dateStr]?.adjust || 0);
  },

  activeShipperGroups() {
    this.ensureState();
    return (STATE.capacity.shipperGroups || this.defaultShipperGroups())
      .filter(g=>g.active !== false && g.key !== 'other')
      .sort((a,b)=>this.n(a.sort)-this.n(b.sort));
  },

  hasValidCapacityGroups() {
    this.ensureState();
    return (STATE.capacity?.capacityGroups || []).some(g => {
      if (!Array.isArray(g.units) || !g.units.length) return false;
      return this.activeShipperGroups().some(sg =>
        this.n(g.capacity?.[sg.key]?.weekday) > 0 || this.n(g.capacity?.[sg.key]?.weekend) > 0
      );
    });
  },

  capacityGroupForUnit(unit) {
    this.ensureState();
    const normalized = this.normalizeCapacityUnit(unit);
    if (!normalized) return null;
    return (STATE.capacity.capacityGroups || []).find(g =>
      Array.isArray(g.units) && g.units.some(u => this.normalizeCapacityUnit(u) === normalized)
    ) || null;
  },

  getShipperAreaCap(groupKey, area, field) {
    const row = STATE.capacity?.shipperAreaCaps?.[groupKey]?.[area] || {};
    return this.n(row[field] ?? 0);
  },

  hasAnyShipperAreaCap(area='') {
    this.ensureState();
    const groups = STATE.capacity?.capacityGroups || [];
    if (!groups.length) return false;
    return groups.some(g => {
      if (!Array.isArray(g.units) || !g.units.length) return false;
      if (area && String(g.name || '') !== String(area)) return false;
      return this.capacityGroupDailyCap(g, this.ymDate(this.getYM() || '202601', 1)) > 0;
    });
  },

  baseDailyCap(dateStr, area) {
    // 新方式：通常キャパは、荷主キャパ区分の合算のみ。
    // 旧Excelキャパ・旧地区キャパ・旧shipperAreaCapsは参照しない。
    return this.areaGroupCapSum(dateStr, area);
  },

  dailyCap(dateStr, area) {
    return Math.max(0, this.baseDailyCap(dateStr, area) + this.dayAdj(dateStr));
  },

  shipperDailyCap(dateStr, area, groupLabelOrKey) {
    const key = this.shipperGroupKeyByLabel(groupLabelOrKey);
    return this.areaGroupCapSum(dateStr, area, key);
  },

  monthlyCap(ym, area) {
    let total = 0;
    const last = this.daysInYM(ym);
    for (let d=1; d<=last; d++) {
      total += this.dailyCap(this.ymDate(ym,d), area);
    }
    return total;
  },

  shipperMonthlyCap(ym, area, groupLabelOrKey) {
    let total = 0;
    const last = this.daysInYM(ym);
    for (let d=1; d<=last; d++) total += this.shipperDailyCap(this.ymDate(ym,d), area, groupLabelOrKey);
    return total;
  },

  capTargetCount(shippers) {
    if (!shippers || !this.hasValidCapacityGroups()) return null;
    const activeLabels = new Set(this.activeShipperGroups().map(g=>g.label));
    return Object.entries(shippers).reduce((sum,[name,count])=>activeLabels.has(name) ? sum + this.n(count) : sum, 0);
  },

  judge(used, cap) {
    const rate = cap > 0 ? used / cap * 100 : 0;
    if (cap <= 0) return { rate:0, status:'未設定', cls:'unset' };
    if (rate >= 150) return { rate, status:'崩壊', cls:'collapse' };
    if (rate >= 120) return { rate, status:'逼迫', cls:'over' };
    if (rate >= 100) return { rate, status:'注意', cls:'full' };
    if (rate >= 80) return { rate, status:'適正', cls:'good' };
    return { rate, status:'余裕あり', cls:'ok' };
  },

  areaRows() {
    const actual = this.buildActual();
    if (!this.hasValidCapacityGroups()) return [];
    const groupNames = (STATE.capacity?.capacityGroups || [])
      .filter(g => Array.isArray(g.units) && g.units.length)
      .map(g => g.name)
      .filter(Boolean);
    const all = [...new Set(groupNames)];
    return all.map(area=>{
      const a = actual.byArea.get(area) || { area, count:0, shippers:{}, cities:{} };
      const cap = this.monthlyCap(actual.ym, area);
      const one = this.baseDailyCap(this.ymDate(actual.ym,1), area);
      const targetCount = this.capTargetCount(a.shippers);
      const used = targetCount === null ? a.count : targetCount;
      const j = this.judge(used, cap);
      return { ...a, used, cap, oneDay:one, rate:j.rate, status:j.status, cls:j.cls };
    }).sort((a,b)=> b.rate-a.rate || b.count-a.count || String(a.area).localeCompare(String(b.area),'ja'));
  },

  dailyRows() {
    const actual = this.buildActual();
    const risk = { collapse:5, over:4, full:3, good:2, ok:1, unset:0 };
    return [...actual.byDateArea.values()].map(r=>{
      const cap = this.dailyCap(r.date, r.area);
      const targetCount = this.capTargetCount(r.shippers);
      const used = targetCount === null ? r.count : targetCount;
      const j = this.judge(used, cap);
      const diff = this.n(used) - this.n(cap);
      return { ...r, used, cap, diff, rate:j.rate, status:j.status, cls:j.cls };
    }).sort((a,b)=>(risk[b.cls]||0)-(risk[a.cls]||0) || this.n(b.diff)-this.n(a.diff) || b.rate-a.rate || String(a.date).localeCompare(String(b.date)));
  },

  ensureZipMasterForCapacity() {
    const rec = this.selectedProductRecord();
    if (!rec || !Array.isArray(rec.tickets) || !rec.tickets.length) return true;
    if (!window.JP_ZIP_LOADER || typeof JP_ZIP_LOADER.loadForZips !== 'function') return true;

    const zips = rec.tickets.map((t) => {
      const row = t.representativeRow || t.firstRow || t.row || t.raw;
      return this.normalizeZip(
        t.zip || t.zipcode || t.postCode || t.postalCode ||
        t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] ||
        (Array.isArray(row) ? row[11] : '')
      );
    }).filter(Boolean);

    if (!zips.length) return true;
    const prefixes = [...new Set(zips.map(z => String(z).slice(0, 2)))];
    const loaded = new Set(typeof JP_ZIP_LOADER.loadedPrefixes === 'function' ? JP_ZIP_LOADER.loadedPrefixes() : []);
    const missing = prefixes.filter(p => !(window.JP_ZIP_PARTS && window.JP_ZIP_PARTS[p]) && !loaded.has(p));
    if (!missing.length) return true;

    const key = missing.sort().join('|');
    if (this._zipLoadingKey === key) return false;
    this._zipLoadingKey = key;

    JP_ZIP_LOADER.loadForZips(zips).then(() => {
      this._zipLoadingKey = '';
      this.render();
    }).catch((e) => {
      console.warn('郵便番号マスタ読込失敗', e);
      this._zipLoadingKey = '';
      // 読み込めない場合でも、住所文字列の補正で表示できる範囲を描画する。
      this._zipLoadFailedKey = key;
      this.render();
    });

    return false;
  },

  render() {
    const view = document.getElementById('view-capacity');
    if (!view || !view.classList.contains('active')) return;
    this.ensureState();
    this.ensureStyle();

    if (!this.ensureZipMasterForCapacity()) {
      view.innerHTML = `<div class="capx"><div class="capx-card capx-empty">郵便番号マスタを読み込み中です。完了後に自動で再表示します。</div></div>`;
      return;
    }

    const actual = this.buildActual();
    const rows = this.areaRows();
    const daily = this.dailyRows(); window.__CAPACITY_LAST_DAILY_ROWS = daily;
    this._lastRows = rows;
    this._lastDailyRows = daily;

    if (!['monthly','daily','integrated','shipperCap','weekday','calendar'].includes(this._tab)) this._tab = 'monthly';
    view.innerHTML = this.layout(actual, rows, daily);
    this.bind();
  },

  layout(actual, rows, daily) {
    const hasCap = this.hasValidCapacityGroups();
    const totalActual = actual.tickets?.length || 0;
    const totalUsed = hasCap ? rows.reduce((s,r)=>s+this.n(r.used ?? r.count),0) : 0;
    const totalCap = hasCap ? rows.reduce((s,r)=>s+this.n(r.cap),0) : 0;
    const j = hasCap ? this.judge(totalUsed,totalCap) : { rate:0, status:'未設定', cls:'unset' };

    const dailyRows = Array.isArray(daily) ? daily : [];
    const overList = hasCap ? dailyRows.filter(r => r && this.n(r.cap) > 0 && this.n(r.rate) >= 100) : [];
    const overDays = overList.length;
    const weekendOver = overList.filter(r => [0,6].includes(this.dow(r.date))).length;
    const weekendShare = overDays ? Math.round(weekendOver / overDays * 100) : 0;
    const weekdayShare = overDays ? 100 - weekendShare : 0;
    const worstOver = overList.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || this.n(b.rate)-this.n(a.rate))[0] || null;

    const yms = [...new Set((STATE.productAddressData || []).map(r=>r.ym).filter(Boolean))].sort().reverse();
    const curYM = actual.ym || this.getYM();

    return `
      <div class="capx">
        <div class="capx-card capx-control">
          <div class="capx-headline">
            <div>
              <h2>キャパ分析</h2>
              <p>商品・住所CSVをもとに、区分作成と荷主別キャパ手入力で使用率・日別超過を確認します。</p>
            </div>
            <div class="capx-cond">
              <label>対象月
                <select id="capacity-ym">
                  ${(yms.length?yms:[curYM]).map(ym=>`<option value="${esc(ym)}" ${ym===curYM?'selected':''}>${esc(ymLabel(ym))}</option>`).join('')}
                </select>
              </label>
              <label>表示基準
                <select id="capacity-base" disabled>
                  <option value="calendar" selected>区分キャパ日別積み上げ</option>
                </select>
              </label>
            </div>
          </div>
          <div class="capx-actions">
            <button class="btn btn-primary" onclick="document.getElementById('capacity-csv-input').click()">商品・住所CSV取込</button>
            <input type="file" id="capacity-csv-input" accept=".csv" multiple style="display:none" onchange="CAPACITY_UI.importAreaCsv(this.files)">
            <button class="btn" onclick="CAPACITY_UI.render()">再集計</button>
            <button class="btn btn-danger" onclick="CAPACITY_UI.clearMaster()">キャパ区分を初期化</button>
            <span id="capacity-msg">${hasCap ? `キャパ区分登録済：${STATE.capacity.capacityGroups.length}区分` : '荷主キャパ区分が未作成です'}</span>
          </div>
          <div class="capx-note">旧Excelキャパ・旧地区マスタは使用しません。先に「荷主キャパ」で区／市を選択して区分を作成すると、月別・日別・曜日・カレンダーへ自動反映します。</div>
        </div>

        <div class="capx-kpis">
          <div class="capx-kpi blue"><span>実績件数</span><b>${fmt(totalActual)}</b><em>原票</em></div>
          <div class="capx-kpi green"><span>月キャパ</span><b>${hasCap ? fmt(totalCap) : '—'}</b><em>${hasCap?'区分合算':'未設定'}</em></div>
          <div class="capx-kpi ${j.cls}"><span>月使用率</span><b>${hasCap ? pct(j.rate) : '—'}</b><em>${esc(j.status)}</em></div>
          <div class="capx-kpi amber"><span>日別超過（区分×日）</span><b>${hasCap ? fmt(overDays) : '—'}</b><em>${hasCap ? `土日 ${fmt(weekendShare)}% / 平日 ${fmt(weekdayShare)}% / 最大 ${worstOver ? esc(worstOver.area) + ' +' + fmt(this.n(worstOver.diff)) + '件（' + pct(worstOver.rate) + '）' : '—'}` : '区分作成後に表示'}</em></div>
        </div>

        <div class="capx-tabs">
          ${[
            ['monthly','月別使用状況'],['daily','日別超過'],['integrated','連動分析'],['shipperCap','荷主キャパ'],['weekday','曜日分析'],['calendar','カレンダー']
          ].map(([k,l])=>`<button type="button" class="${this._tab===k?'active':''}" data-capx-tab="${k}">${l}</button>`).join('')}
        </div>

        ${this._tab==='monthly'?this.monthlyHtml(rows):''}
        ${this._tab==='daily'?this.dailyHtml(daily, actual):''}
        ${this._tab==='integrated'?this.integratedHtml(daily, actual):''}
        ${this._tab==='shipperCap'?this.shipperCapacityHtml(actual):''}
        ${this._tab==='weekday'?this.weekdayHtml(daily, actual):''}
        ${this._tab==='calendar'?this.calendarHtml(daily, actual):''}
      </div>`;
  },

  monthlyHtml(rows) {
    if (!this.hasValidCapacityGroups()) {
      return `<div class="capx-card capx-empty">
        <h3>荷主キャパ区分を作成してください</h3>
        <p class="capx-note2">現在は旧Excelキャパ・旧地区マスタを使わない設計です。先に「荷主キャパ」タブで、区／市を選択して区分を作成し、コジマ＋ビック・でんきち・エディオンのキャパを入力してください。</p>
        <button class="btn btn-primary" type="button" data-capx-tab="shipperCap">荷主キャパを作成する</button>
      </div>`;
    }
    return `<div class="capx-grid">
      <div class="capx-card">
        <h3>区分別 月キャパ使用状況</h3>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>区分</th><th class="r">実績</th><th class="r">判定対象</th><th class="r">日キャパ</th><th class="r">月キャパ</th><th class="r">使用率</th><th>状態</th></tr></thead><tbody>
          ${rows.map((r,i)=>`<tr><td><button class="capx-link" data-capx-detail="${i}">${esc(r.area)}</button></td><td class="r"><b>${fmt(r.count)}</b></td><td class="r">${fmt(r.used ?? r.count)}</td><td class="r">${fmt(r.oneDay)}</td><td class="r"><b>${fmt(r.cap)}</b></td><td class="r">${r.cap > 0 ? pct(r.rate) : "-"}</td><td><span class="capacity-status ${esc(r.cls)}">${esc(r.status)}</span></td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="capx-card"><h3>区分内訳</h3><div id="capacity-detail-box" class="capx-empty">区分をクリックしてください</div></div>
    </div>`;
  },

  needCapacityGroupHtml() {
    return `<div class="capx-card capx-empty">
      <h3>荷主キャパ区分が未作成です</h3>
      <p class="capx-note2">旧地区キャパは参照しません。「荷主キャパ」タブで区／市を選び、区分名と荷主別キャパを入力してください。</p>
      <button class="btn btn-primary" type="button" data-capx-tab="shipperCap">荷主キャパを作成する</button>
    </div>`;
  },

  dailyHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    this._lastDailyRows = rows;
    const over = rows.filter(r=>r.cap > 0 && r.rate >= 100);
    const weekendOver = over.filter(r=>[0,6].includes(this.dow(r.date))).length;
    const weekendShare = over.length ? Math.round(weekendOver / over.length * 100) : 0;
    const weekdayShare = over.length ? 100 - weekendShare : 0;
    const worst = over.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || b.rate-a.rate)[0] || null;

    setTimeout(()=>this.showDailyCause(0), 0);

    return `<div class="capx-grid">
      <div class="capx-card">
        <div class="capx-section-head">
          <div>
            <h3>日別超過（原因確認）</h3>
            <p class="capx-note2">行をクリックすると、右側に原因内訳を表示します。</p>
          </div>
          <div class="capx-cal-summary">
            <span class="danger">超過 ${fmt(over.length)}件</span>
            <span class="full">土日 ${fmt(weekendShare)}%</span>
            <span class="good">平日 ${fmt(weekdayShare)}%</span>
            <span>${worst ? `最大 ${esc(worst.area)} ${worst.diff > 0 ? '+' : ''}${fmt(worst.diff)}件 / ${pct(worst.rate)}` : '最大 —'}</span>
          </div>
        </div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>日付</th><th>地区</th><th class="r">実績</th><th class="r">日キャパ</th><th class="r">差分</th><th class="r">使用率</th><th>状態</th><th>主な市区町村</th></tr></thead><tbody>
          ${rows.map((r,i)=>`<tr class="capx-risk-${esc(r.cls)} capx-click-row ${i===0?'selected':''}" data-capx-daily-row="${i}"><td>${esc(this.dateLabel(r.date))}${r.estimated?' ※推定':''}</td><td>${esc(r.area)}</td><td class="r"><b>${fmt(r.count)}</b></td><td class="r">${fmt(r.cap)}</td><td class="r"><b class="capx-diff ${this.n(r.count)-this.n(r.cap)>0?'plus':'minus'}">${this.n(r.count)-this.n(r.cap)>0?'+':''}${fmt(this.n(r.count)-this.n(r.cap))}</b></td><td class="r">${r.cap > 0 ? pct(r.rate) : "-"}</td><td><span class="capacity-status ${esc(r.cls)}">${esc(r.status)}</span></td><td>${esc(Object.entries(r.cities||{}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>`${c} ${fmt(n)}件`).join(' / ') || '—')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="capx-card">
        <h3>原因ドリルダウン</h3>
        <div id="capacity-daily-cause-box" class="capx-empty">左の行をクリックしてください</div>
      </div>
    </div>`;
  },


  concentrationLabel(name, count, total) {
    if (!name || !total) return '';
    const share = count / total * 100;
    if (share >= 50) return `${name}に${pct(share)}が集中しています`;
    if (share >= 30) return `${name}が${pct(share)}を占めています`;
    return `${name}が最多です（${pct(share)}）`;
  },

  integratedHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    const over = rows.filter(r=>r.cap > 0 && this.n(r.diff) > 0);
    const overCount = over.reduce((s,r)=>s+this.n(r.count),0);
    const overDiff = over.reduce((s,r)=>s+Math.max(0,this.n(r.diff)),0);
    const overCap = over.reduce((s,r)=>s+this.n(r.cap),0);

    const areaMap = new Map();
    const shipperMap = new Map();
    const cityMap = new Map();
    over.forEach(r=>{
      const area = r.area || '未設定';
      const areaObj = areaMap.get(area) || { name:area, count:0, diff:0, days:0, maxRate:0 };
      areaObj.count += this.n(r.count);
      areaObj.diff += Math.max(0,this.n(r.diff));
      areaObj.days += 1;
      areaObj.maxRate = Math.max(areaObj.maxRate, this.n(r.rate));
      areaMap.set(area, areaObj);

      Object.entries(r.shippers || {}).forEach(([name,n])=>{
        const x = shipperMap.get(name) || { name, count:0 };
        x.count += this.n(n);
        shipperMap.set(name, x);
      });
      Object.entries(r.cities || {}).forEach(([name,n])=>{
        const x = cityMap.get(name) || { name, count:0 };
        x.count += this.n(n);
        cityMap.set(name, x);
      });
    });

    const topAreas = [...areaMap.values()].sort((a,b)=>b.diff-a.diff || b.count-a.count).slice(0,8);
    const topShippers = [...shipperMap.values()].sort((a,b)=>b.count-a.count).slice(0,8);
    const topCities = [...cityMap.values()].sort((a,b)=>b.count-a.count).slice(0,8);
    const worst = over.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || b.rate-a.rate)[0] || null;
    const topArea = topAreas[0];
    const topShipper = topShippers[0];
    const topCity = topCities[0];

    const comments = [];
    if (worst) comments.push(`${this.dateLabel(worst.date)}の${worst.area}が最大超過（${worst.diff>0?'+':''}${fmt(worst.diff)}件 / ${pct(worst.rate)}）です。`);
    if (topArea) comments.push(`超過差分は${topArea.name}が最も大きく、合計${fmt(topArea.diff)}件分を押し上げています。`);
    if (topCity) comments.push(`市区町村では${this.concentrationLabel(topCity.name, topCity.count, overCount)}。`);
    if (topShipper) comments.push(`荷主では${this.concentrationLabel(topShipper.name, topShipper.count, overCount)}。`);
    if (!comments.length) comments.push('対象月に日別キャパ超過はありません。現状は大きな偏りを確認する段階です。');

    const bar = (value, total)=>{
      const w = total > 0 ? Math.max(4, Math.min(100, value/total*100)) : 0;
      return `<div class="capx-mini-bar"><span style="width:${w}%"></span></div>`;
    };

    return `<div class="capx-grid">
      <div class="capx-card">
        <div class="capx-section-head">
          <div>
            <h3>連動分析（キャパ × エリア × 荷主）</h3>
            <p class="capx-note2">超過している日だけを対象に、場所と荷主の偏りをまとめて確認します。</p>
          </div>
          <div class="capx-cal-summary">
            <span class="danger">超過差分 ${fmt(overDiff)}件</span>
            <span>超過件数 ${fmt(overCount)}件</span>
            <span>超過対象 ${fmt(over.length)}行</span>
          </div>
        </div>
        <div class="capx-kpis" style="grid-template-columns:repeat(3,minmax(160px,1fr));margin-bottom:14px">
          <div class="capx-kpi over"><span>最大超過</span><b>${worst ? `${worst.diff>0?'+':''}${fmt(worst.diff)}件` : '—'}</b><em>${worst ? `${this.dateLabel(worst.date)} / ${esc(worst.area)}` : '超過なし'}</em></div>
          <div class="capx-kpi amber"><span>エリア最大要因</span><b>${topCity ? esc(topCity.name) : '—'}</b><em>${topCity ? `${fmt(topCity.count)}件 / ${pct(topCity.count / (overCount||1) * 100)}` : '内訳なし'}</em></div>
          <div class="capx-kpi good"><span>荷主最大要因</span><b>${topShipper ? esc(topShipper.name) : '—'}</b><em>${topShipper ? `${fmt(topShipper.count)}件 / ${pct(topShipper.count / (overCount||1) * 100)}` : '内訳なし'}</em></div>
        </div>
        <div class="capx-action-box">
          <h5>読み取りコメント</h5>
          ${comments.map(c=>`<div class="capx-action-item">・${esc(c)}</div>`).join('')}
        </div>
      </div>
      <div class="capx-card">
        <h3>超過日の上位要因</h3>
        ${topAreas.length ? `<h5 class="capx-mini-title">地区別 超過差分</h5>${topAreas.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>+${fmt(x.diff)}件</em>${bar(x.diff, topAreas[0].diff)}</div>`).join('')}` : `<div class="capx-empty">超過地区なし</div>`}
        ${topCities.length ? `<h5 class="capx-mini-title">市区町村別 件数</h5>${topCities.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>${fmt(x.count)}件</em>${bar(x.count, topCities[0].count)}</div>`).join('')}` : ''}
        ${topShippers.length ? `<h5 class="capx-mini-title">荷主別 件数</h5>${topShippers.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>${fmt(x.count)}件</em>${bar(x.count, topShippers[0].count)}</div>`).join('')}` : ''}
      </div>
    </div>`;
  },

  weekdayHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    const names = ['日','月','火','水','木','金','土'];
    const map = new Map();

    rows.forEach(r=>{
      const w = this.dow(r.date);
      if (!map.has(w)) map.set(w, { w, count:0, cap:0, over:0, items:[] });
      const x = map.get(w);
      x.count += this.n(r.count);
      x.cap += this.n(r.cap);
      if (r.cap > 0 && r.rate >= 100) x.over += 1;
      x.items.push(r);
    });

    const list = Array.from({length:7},(_,w)=>{
      const x = map.get(w) || { w, count:0, cap:0, over:0, items:[] };
      const j = this.judge(x.count, x.cap);
      const worst = x.items.slice().sort((a,b)=>b.rate-a.rate)[0];
      return { ...x, rate:j.rate, status:j.status, cls:j.cls, worst };
    });

    return `<div class="capx-card">
      <div class="capx-section-head">
        <div>
          <h3>曜日分析</h3>
          <p class="capx-note2">曜日ごとの偏りを見ます。土日だけ逼迫しているか、平日に寄っているかを確認します。</p>
        </div>
      </div>
      <div class="capx-weekday-grid">
        ${list.map(x=>`
          <div class="capx-weekday-card ${esc(x.cls)}">
            <div class="capx-weekday-top">
              <b>${names[x.w]}曜日</b>
              <span class="capacity-status ${esc(x.cls)}">${esc(x.status)}</span>
            </div>
            <div class="capx-weekday-main">
              <strong>${x.cap > 0 ? pct(x.rate) : '-'}</strong>
              <span>${fmt(x.count)}件 / ${fmt(x.cap)}件</span>
            </div>
            <div class="capx-weekday-sub">
              <span>超過 ${fmt(x.over)}件</span>
              <span>${x.worst ? `最大 ${esc(x.worst.area)} ${x.worst.cap > 0 ? pct(x.worst.rate) : '-'}` : '最大 —'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  },



  saitamaRegionMap() {
    return {
      saitama_saitama: ['さいたま市'],
      saitama_nanbu: ['川口市','蕨市','戸田市'],
      saitama_nanseibu: ['朝霞市','志木市','和光市','新座市','富士見市','ふじみ野市','三芳町'],
      saitama_tobu: ['春日部市','草加市','越谷市','八潮市','三郷市','吉川市','松伏町'],
      saitama_kenou: ['鴻巣市','上尾市','桶川市','北本市','伊奈町'],
      saitama_kawagoe_hiki: ['川越市','東松山市','坂戸市','鶴ヶ島市','日高市','毛呂山町','越生町','滑川町','嵐山町','小川町','川島町','吉見町','鳩山町','ときがわ町','東秩父村'],
      saitama_seibu: ['所沢市','飯能市','狭山市','入間市'],
      saitama_tone: ['行田市','加須市','羽生市','久喜市','蓮田市','幸手市','白岡市','宮代町','杉戸町'],
      saitama_hokubu: ['熊谷市','本庄市','深谷市','美里町','神川町','上里町','寄居町'],
      saitama_chichibu: ['秩父市','横瀬町','皆野町','長瀞町','小鹿野町']
    };
  },

  tokyoRegionMap() {
    return {
      tokyo_toshin: ['千代田区','中央区','港区'],
      tokyo_fukutoshin: ['新宿区','文京区','渋谷区','豊島区'],
      tokyo_joto: ['台東区','墨田区','江東区','荒川区','足立区','葛飾区','江戸川区'],
      tokyo_jonan: ['品川区','目黒区','大田区','世田谷区'],
      tokyo_josai: ['中野区','杉並区','練馬区'],
      tokyo_johoku: ['北区','板橋区']
    };
  },

  saitamaWardNames() {
    return ['西区','北区','大宮区','見沼区','中央区','桜区','浦和区','南区','緑区','岩槻区'];
  },

  tokyoWardNames() {
    return ['千代田区','中央区','港区','新宿区','文京区','台東区','墨田区','江東区','品川区','目黒区','大田区','世田谷区','渋谷区','中野区','杉並区','豊島区','北区','荒川区','板橋区','練馬区','足立区','葛飾区','江戸川区'];
  },

  saitamaMunicipalityNames() {
    const names = new Set();
    Object.values(this.saitamaRegionMap()).flat().forEach(x=>names.add(x));
    this.saitamaWardNames().forEach(w=>names.add('さいたま市' + w));
    return [...names];
  },

  tokyoMunicipalityNames() {
    return [
      ...this.tokyoWardNames(),
      '八王子市','立川市','武蔵野市','三鷹市','青梅市','府中市','昭島市','調布市','町田市','小金井市','小平市','日野市','東村山市','国分寺市','国立市','福生市','狛江市','東大和市','清瀬市','東久留米市','武蔵村山市','多摩市','稲城市','羽村市','あきる野市','西東京市','瑞穂町','日の出町','檜原村','奥多摩町'
    ];
  },

  normalizeCapacityUnit(value) {
    const raw = String(value ?? '').normalize('NFKC').replace(/\s+/g,'').trim();
    if (!raw || raw === '未設定') return '';

    const stripPref = (x) => String(x || '').replace(/^埼玉県/, '').replace(/^東京都/, '');
    const withPref = (pref, name) => pref + String(name || '').replace(new RegExp('^' + pref), '');

    // 郵便番号だけの場合は、郵便番号マスタから取得した行政単位を1回だけ正規化する。
    // ※自分自身を無条件に呼ばない。Maximum call stack size exceeded 防止。
    const zip = this.normalizeZip(raw);
    if (/^\d{7}$/.test(zip) && raw.replace(/[^0-9]/g,'').length === 7) {
      const byZip = this.cityFromZip(zip);
      if (byZip && byZip !== raw) {
        const z = String(byZip).normalize('NFKC').replace(/\s+/g,'').trim();
        if (z.includes('埼玉県') || z.includes('東京都')) {
          const c = this.cityFromAddress(z);
          return c && c !== '未設定' ? c : z;
        }
        value = z;
      }
    }

    let v = String(value ?? raw).normalize('NFKC').replace(/\s+/g,'').trim();
    if (!v || v === '未設定') return '';

    // 県名つきは行政単位まで切る。cityFromAddress が同じ値を返しても再帰しない。
    if (v.includes('東京都') || v.includes('埼玉県')) {
      const c = this.cityFromAddress(v);
      return c && c !== '未設定' ? c : v;
    }

    // さいたま市の区は、東京都の「北区」などと衝突しやすいため最優先で補完する。
    if (v.includes('さいたま市')) {
      const ward = this.saitamaWardNames().find(w => v.includes(w));
      return '埼玉県さいたま市' + (ward || '');
    }
    const saitamaWard = this.saitamaWardNames().find(w => v === w || v.endsWith(w));
    if (saitamaWard && !v.includes('東京都')) return '埼玉県さいたま市' + saitamaWard;

    // 東京都23区。
    const tokyoWard = this.tokyoWardNames().find(w => v === w || v.includes(w));
    if (tokyoWard) return '東京都' + tokyoWard;

    // 埼玉県内市町村。
    const saitamaMuni = this.saitamaMunicipalityNames().find(m => v === m || v.includes(m));
    if (saitamaMuni) return withPref('埼玉県', saitamaMuni);

    // 東京都多摩等。
    const tokyoMuni = this.tokyoMunicipalityNames().find(m => v === m || v.includes(m));
    if (tokyoMuni) return withPref('東京都', tokyoMuni);

    // エリア分析で対応済みだった住所崩れへの補正。
    // 例：蕨中央5-、戸田美女木、さいたま大宮区 などを町域ではなく市・区へ丸める。
    const cleaned = v.replace(/^[0-9〒-]+/, '');
    const repaired = this.cityFromAddress(cleaned);
    if (repaired && repaired !== '未設定' && repaired !== cleaned && repaired !== v) {
      // ここも再帰しない。戻り値を行政単位としてそのまま返す。
      return repaired;
    }

    if (/^さいたま/.test(cleaned)) {
      const ward = this.saitamaWardNames().find(w => cleaned.includes(w));
      return '埼玉県さいたま市' + (ward || '');
    }
    if (/^蕨/.test(cleaned)) return '埼玉県蕨市';
    if (/^戸田/.test(cleaned)) return '埼玉県戸田市';
    if (/^川口/.test(cleaned)) return '埼玉県川口市';
    if (/^朝霞/.test(cleaned)) return '埼玉県朝霞市';
    if (/^和光/.test(cleaned)) return '埼玉県和光市';
    if (/^志木/.test(cleaned)) return '埼玉県志木市';
    if (/^新座/.test(cleaned)) return '埼玉県新座市';

    return v;
  },

  regionFilterOptions() {
    return [
      { key:'saitama_all', label:'埼玉県 全域' },
      { key:'saitama_saitama', label:'埼玉県 さいたま地域' },
      { key:'saitama_nanbu', label:'埼玉県 南部地域' },
      { key:'saitama_nanseibu', label:'埼玉県 南西部地域' },
      { key:'saitama_tobu', label:'埼玉県 東部地域' },
      { key:'saitama_kenou', label:'埼玉県 県央地域' },
      { key:'saitama_kawagoe_hiki', label:'埼玉県 川越比企地域' },
      { key:'saitama_seibu', label:'埼玉県 西部地域' },
      { key:'saitama_tone', label:'埼玉県 利根地域' },
      { key:'saitama_hokubu', label:'埼玉県 北部地域' },
      { key:'saitama_chichibu', label:'埼玉県 秩父地域' },
      { key:'tokyo_all', label:'東京都 全域' },
      { key:'tokyo_23', label:'東京都 23区 全域' },
      { key:'tokyo_toshin', label:'東京都 都心部' },
      { key:'tokyo_fukutoshin', label:'東京都 副都心部' },
      { key:'tokyo_joto', label:'東京都 城東' },
      { key:'tokyo_jonan', label:'東京都 城南' },
      { key:'tokyo_josai', label:'東京都 城西' },
      { key:'tokyo_johoku', label:'東京都 城北' },
      { key:'tokyo_tama', label:'東京都 多摩' },
      { key:'all_tokyo_saitama', label:'東京・埼玉 すべて' }
    ];
  },

  unitShortName(unit) {
    const u = this.normalizeCapacityUnit(unit) || String(unit || '');
    return String(u || '')
      .replace(/^東京都/, '')
      .replace(/^埼玉県/, '')
      .trim() || '未設定';
  },

  isTokyo23Unit(unit) {
    const u = this.normalizeCapacityUnit(unit);
    return /^東京都.+区$/.test(u);
  },

  unitMatchesRegion(unit, regionKey) {
    const u = this.normalizeCapacityUnit(unit);
    if (!u || u === '未設定') return false;
    if (regionKey === 'all_tokyo_saitama') return u.includes('埼玉県') || u.includes('東京都');
    if (regionKey === 'saitama_all') return u.includes('埼玉県');
    if (regionKey === 'tokyo_all') return u.includes('東京都');
    if (regionKey === 'tokyo_23') return this.isTokyo23Unit(u);
    if (regionKey === 'tokyo_tama') return u.includes('東京都') && !this.isTokyo23Unit(u);

    const saitamaMap = this.saitamaRegionMap();
    if (saitamaMap[regionKey]) return u.includes('埼玉県') && saitamaMap[regionKey].some(name => u.includes(name));

    const tokyoMap = this.tokyoRegionMap();
    if (tokyoMap[regionKey]) return u.includes('東京都') && tokyoMap[regionKey].some(name => u.includes(name));

    return true;
  },

  availableCapacityUnits(actual) {
    const map = new Map();
    (actual?.tickets || []).forEach(t => {
      const unit = this.normalizeCapacityUnit(this.ticketCity(t));
      if (!unit || unit === '未設定') return;
      if (!(unit.includes('埼玉県') || unit.includes('東京都'))) return;
      const area = this.mappedArea(unit);
      const old = map.get(unit) || { unit, label:this.unitShortName(unit), area, count:0, shippers:{} };
      old.count += 1;
      old.shippers[t.shipper || 'その他'] = (old.shippers[t.shipper || 'その他'] || 0) + 1;
      map.set(unit, old);
    });
    const values = [...map.values()];
    const hasSaitamaWard = values.some(x => /^埼玉県さいたま市(西区|北区|大宮区|見沼区|中央区|桜区|浦和区|南区|緑区|岩槻区)$/.test(x.unit));
    return values
      .filter(x => !(hasSaitamaWard && /^埼玉県さいたま市?$/.test(x.unit)))
      .sort((a,b)=>{
        const pa = a.unit.includes('埼玉県') ? 0 : 1;
        const pb = b.unit.includes('埼玉県') ? 0 : 1;
        return pa - pb || String(a.unit).localeCompare(String(b.unit), 'ja');
      });
  },

  capacityGroupDailyCap(group, dateStr, shipperKey='') {
    const holidayLike = this.isWeekend(dateStr) || this.dayType(dateStr) === 'holiday';
    const field = holidayLike ? 'weekend' : 'weekday';
    const caps = group?.capacity || {};
    if (shipperKey) return this.n(caps?.[shipperKey]?.[field] ?? 0);
    return this.activeShipperGroups().reduce((s,g)=>s + this.n(caps?.[g.key]?.[field] ?? 0), 0);
  },

  capacityGroupsForArea(area) {
    this.ensureState();
    return (STATE.capacity.capacityGroups || []).filter(g => String(g.name || '') === String(area || ''));
  },

  areaGroupCapSum(dateStr, area, shipperKey='') {
    const groups = this.capacityGroupsForArea(area);
    if (!groups.length) return 0;
    return groups.reduce((s,g)=>s + this.capacityGroupDailyCap(g, dateStr, shipperKey), 0);
  },

  areaUnitBreakdownForRow(row) {
    const result = new Map();
    const area = row?.area || '';
    (this.buildActual().tickets || []).forEach(t => {
      if (t.area !== area) return;
      if (row?.date && t.date && t.date !== row.date) return;
      const unit = this.normalizeCapacityUnit(this.ticketCity(t));
      const key = unit || '未設定';
      const x = result.get(key) || { unit:key, label:this.unitShortName(key), count:0, shippers:{} };
      x.count += 1;
      x.shippers[t.shipper || 'その他'] = (x.shippers[t.shipper || 'その他'] || 0) + 1;
      result.set(key, x);
    });
    return [...result.values()].sort((a,b)=>b.count-a.count);
  },

  shipperCapacityHtml(actual) {
    this.ensureState();

    const tickets = actual.tickets || [];
    const groups = this.activeShipperGroups();
    const allUnits = this.availableCapacityUnits(actual);
    const regionOptions = this.regionFilterOptions();
    const regionKey = this._capRegionFilter || 'saitama_all';
    const filteredUnits = allUnits.filter(u => this.unitMatchesRegion(u.unit, regionKey));
    const savedGroups = STATE.capacity.capacityGroups || [];
    const ym = actual.ym || this.getYM();

    const groupSummary = groups.map(g=>{
      const count = tickets.filter(t=>t.shipper === g.label).length;
      let weekday = 0, weekend = 0;
      savedGroups.forEach(cg=>{
        weekday += this.n(cg.capacity?.[g.key]?.weekday);
        weekend += this.n(cg.capacity?.[g.key]?.weekend);
      });
      return { ...g, count, weekday, weekend };
    });

    const unitCards = filteredUnits.length ? filteredUnits.map(u=>`
      <label class="capx-unit-card">
        <input type="checkbox" value="${esc(u.unit)}" data-capx-new-group-unit>
        <span>
          <b>${esc(u.label)}</b>
          <em>${esc(u.area)} / ${fmt(u.count)}件</em>
        </span>
      </label>
    `).join('') : `<div class="capx-empty small">対象エリアの区・市がありません。商品・住所CSVまたは郵便番号データを確認してください。</div>`;

    return `<div class="capx-card">
      <div class="capx-section-head">
        <div>
          <h3>荷主キャパ設定（区分作成）</h3>
          <p class="capx-note2">埼玉・東京の区／市を複数選択して、現場の配車単位に合わせたキャパ区分を作成します。通常キャパは作成した区分の荷主キャパ合算です。</p>
        </div>
        <div class="capx-cal-summary">
          <span>対象 ${esc(ymLabel(ym))}</span>
          <span>区・市 ${fmt(allUnits.length)}</span>
          <span>区分 ${fmt(savedGroups.length)}</span>
        </div>
      </div>

      <div class="capx-shipper-summary">
        ${groupSummary.map(g=>`<div class="capx-mini-card"><span>${esc(g.label)}</span><b>${fmt(g.count)}件</b><em>平日合計 ${fmt(g.weekday)} / 土日合計 ${fmt(g.weekend)}</em></div>`).join('')}
      </div>

      <div class="capx-capgroup-layout">
        <div class="capx-capgroup-form">
          <h4>区分を追加</h4>
          <label class="capx-form-label">対象エリア
            <select id="capx-region-filter">
              ${regionOptions.map(o=>`<option value="${esc(o.key)}" ${o.key===regionKey?'selected':''}>${esc(o.label)}</option>`).join('')}
            </select>
          </label>
          <label class="capx-form-label">区分名
            <input id="capx-new-group-name" placeholder="例：さいたまA / 大宮・桜">
          </label>
          <div class="capx-unit-list">
            ${unitCards}
          </div>
          <div class="capx-group-cap-inputs">
            ${groups.map(g=>`
              <div class="capx-group-cap-row">
                <b>${esc(g.label)}</b>
                <label>平日<input type="number" min="0" step="1" value="0" data-capx-new-cap="${esc(g.key)}" data-capx-new-cap-field="weekday"></label>
                <label>土日<input type="number" min="0" step="1" value="0" data-capx-new-cap="${esc(g.key)}" data-capx-new-cap-field="weekend"></label>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-primary" id="capx-add-cap-group" type="button">選択した区・市で区分を追加</button>
          <div class="capx-note">例：さいたまA＝大宮区・桜区、さいたまB＝西区・北区。秩父方面や東京23区も同じ画面で作成できます。</div>
        </div>

        <div class="capx-capgroup-list">
          <h4>作成済み区分</h4>
          ${savedGroups.length ? savedGroups.map((cg,idx)=>{
            const unitText = (cg.units || []).map(u=>this.unitShortName(u)).join('・') || '対象なし';
            const areaText = [...new Set((cg.units || []).map(u=>this.mappedArea(this.normalizeCapacityUnit(u))))].join(' / ') || '未分類';
            return `<div class="capx-capgroup-card" data-capx-capgroup-id="${esc(cg.id)}">
              <div class="capx-capgroup-title">
                <div>
                  <input value="${esc(cg.name || '')}" data-capx-capgroup-field="name">
                  <em>${esc(areaText)}</em>
                </div>
                <button class="btn btn-danger" type="button" data-capx-capgroup-delete="${esc(cg.id)}">削除</button>
              </div>
              <div class="capx-capgroup-units">${esc(unitText)}</div>
              <div class="capx-group-cap-inputs compact">
                ${groups.map(g=>`
                  <div class="capx-group-cap-row">
                    <b>${esc(g.label)}</b>
                    <label>平日<input type="number" min="0" step="1" value="${esc(this.n(cg.capacity?.[g.key]?.weekday))}" data-capx-capgroup-cap="${esc(g.key)}" data-capx-cap-field="weekday"></label>
                    <label>土日<input type="number" min="0" step="1" value="${esc(this.n(cg.capacity?.[g.key]?.weekend))}" data-capx-capgroup-cap="${esc(g.key)}" data-capx-cap-field="weekend"></label>
                  </div>
                `).join('')}
              </div>
            </div>`;
          }).join('') : `<div class="capx-empty small">まだ区分がありません。左側で区・市を選んで作成してください。</div>`}
        </div>
      </div>

      <details class="capx-details"><summary>荷主判定ルールを確認・修正する</summary>
        <p class="capx-note2">荷主名または荷主コードの前方一致で区分します。コードが分かる場合は「コード接頭辞」に入力すると名称ブレより強く判定できます。</p>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>区分名</th><th>名称キーワード（|区切り）</th><th>コード接頭辞（|区切り）</th><th class="r">判定</th></tr></thead><tbody>
          ${(STATE.capacity.shipperGroups || this.defaultShipperGroups()).map(g=>`<tr data-capx-group-key="${esc(g.key)}">
            <td><input value="${esc(g.label)}" data-capx-group-field="label" style="width:150px"></td>
            <td><input value="${esc(g.patterns || '')}" data-capx-group-field="patterns" style="width:320px"></td>
            <td><input value="${esc(g.codePrefixes || '')}" data-capx-group-field="codePrefixes" style="width:220px"></td>
            <td class="r"><label class="capx-check"><input type="checkbox" ${g.active !== false ? 'checked' : ''} data-capx-group-field="active">対象</label></td>
          </tr>`).join('')}
        </tbody></table></div>
      </details>
    </div>`;
  },

  calendarHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    const ym = actual.ym || this.getYM();
    const days = this.daysInYM(ym);
    if (!ym || !days) return `<div class="capx-card capx-empty">対象月を選択してください。</div>`;
    const byDate = new Map();
    rows.forEach(r=>{
      const x = byDate.get(r.date) || { date:r.date, count:0, cap:0, diff:0, rows:[], cls:'unset' };
      x.count += this.n(r.count); x.cap += this.n(r.cap); x.diff += Math.max(0,this.n(r.diff)); x.rows.push(r);
      const j = this.judge(x.count, x.cap); x.rate = j.rate; x.status = j.status; x.cls = j.cls;
      byDate.set(r.date, x);
    });
    const firstDow = this.dow(this.ymDate(ym,1));
    const cells = [];
    for (let i=0;i<firstDow;i++) cells.push(`<div class="capx-day-simple blank"></div>`);
    for (let d=1; d<=days; d++) {
      const date = this.ymDate(ym,d);
      const x = byDate.get(date) || { date, count:0, cap:0, diff:0, cls:'empty', rows:[] };
      cells.push(`<button type="button" class="capx-day-simple ${this.isWeekend(date)?'weekend':''} ${x.cls}" data-capx-cal-detail="${esc(date)}">
        <span class="day-no">${d}</span>
        <strong>${x.count ? fmt(x.count) : '—'}</strong>
        <em>${x.cap ? `${fmt(x.cap)}件 / ${pct(x.rate||0)}` : 'キャパ未設定'}</em>
        ${x.diff>0 ? `<i>+${fmt(x.diff)}</i>` : ''}
      </button>`);
    }
    const over = [...byDate.values()].filter(x=>x.diff>0).length;
    return `<div class="capx-card capx-calendar-card">
      <div class="capx-cal-head"><div><h3>カレンダー</h3><p class="capx-note2">日別の実績・キャパ・超過をカレンダー形式で確認します。</p></div><div class="capx-cal-summary"><span class="danger">超過日 ${fmt(over)}日</span><span>${esc(ymLabel(ym))}</span></div></div>
      <div class="capx-calendar-layout"><div class="capx-calendar-simple">${['日','月','火','水','木','金','土'].map(w=>`<div class="capx-week">${w}</div>`).join('')}${cells.join('')}</div><div id="capx-calendar-detail" class="capx-cal-detail"><div class="capx-empty small">日付をクリックしてください</div></div></div>
    </div>`;
  },

  calendarDetailHtml(date, rows) {
    const list = rows.filter(r=>r.date === date);
    const total = list.reduce((s,r)=>s+this.n(r.count),0);
    const cap = list.reduce((s,r)=>s+this.n(r.cap),0);
    const diff = total - cap;
    return `<div class="capx-cal-detail-inner">
      <div class="capx-cal-detail-title"><div><b>${esc(this.dateLabel(date))}</b><span>実績 ${fmt(total)}件 / キャパ ${fmt(cap)}件 / 差分 ${diff>0?'+':''}${fmt(diff)}件</span></div></div>
      <div class="capx-cal-edit">
        <label>日別補正種別<select data-capx-cal-date="${esc(date)}" data-capx-cal-field="type"><option value="normal" ${this.dayType(date)==='normal'?'selected':''}>通常</option><option value="holiday" ${this.dayType(date)==='holiday'?'selected':''}>休日扱い</option><option value="special" ${this.dayType(date)==='special'?'selected':''}>特殊日</option></select></label>
        <label>日別補正件数<input type="number" value="${esc(this.dayAdj(date))}" data-capx-cal-date="${esc(date)}" data-capx-cal-field="adjust"></label>
      </div>
      <div class="capx-cal-area-list">${list.length ? list.map(r=>`<div class="capx-cal-area-row ${esc(r.cls)}"><span>${esc(r.area)}</span><b>${fmt(r.count)}</b><em>${fmt(r.cap)}</em><strong>${this.n(r.diff)>0?'+':''}${fmt(r.diff)}</strong></div>`).join('') : '<div class="capx-empty small">実績なし</div>'}</div>
    </div>`;
  },

  mappingHtml(actual) {
    const rows = (STATE.capacity.mapping || []).slice().sort((a,b)=>this.n(b.priority)-this.n(a.priority));
    return `<div class="capx-card"><div class="capx-section-head"><div><h3>地区マッピング</h3><p class="capx-note2">住所・市区町村をどのキャパ地区に割り当てるかを設定します。</p></div><button class="btn" id="capacity-add-map">行追加</button></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>優先</th><th>検索語（|区切り）</th><th>割当地区</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr data-capx-map-index="${i}"><td><input type="number" value="${esc(r.priority)}" data-capx-map-field="priority" style="width:80px"></td><td><input value="${esc(r.pattern)}" data-capx-map-field="pattern" style="width:100%"></td><td><input value="${esc(r.area)}" data-capx-map-field="area" style="width:180px"></td><td><button class="btn btn-danger" data-capx-map-delete="${i}">削除</button></td></tr>`).join('')}</tbody></table></div>
    </div>`;
  },

  masterHtml() {
    this.ensureState();
    const ym = this.getYM();
    const groups = this.activeShipperGroups();
    const savedGroups = STATE.capacity.capacityGroups || [];
    const areaMap = new Map();

    savedGroups.forEach(cg=>{
      const areas = [...new Set((cg.units || []).map(u=>this.mappedArea(this.normalizeCapacityUnit(u))))];
      areas.forEach(area=>{
        const row = areaMap.get(area) || { area, groups:[], weekday:0, weekend:0, shipper:{} };
        row.groups.push(cg);
        groups.forEach(g=>{
          row.shipper[g.key] = row.shipper[g.key] || { weekday:0, weekend:0 };
          row.shipper[g.key].weekday += this.n(cg.capacity?.[g.key]?.weekday);
          row.shipper[g.key].weekend += this.n(cg.capacity?.[g.key]?.weekend);
          row.weekday += this.n(cg.capacity?.[g.key]?.weekday);
          row.weekend += this.n(cg.capacity?.[g.key]?.weekend);
        });
        areaMap.set(area,row);
      });
    });

    const rows = [...areaMap.values()].sort((a,b)=>String(a.area).localeCompare(String(b.area),'ja'));

    return `<div class="capx-card"><div class="capx-section-head"><div><h3>通常キャパ</h3><p class="capx-note2">通常キャパは、荷主キャパ区分の合算で自動計算します。この画面は確認用です。修正は「荷主キャパ」タブで行ってください。</p></div><button class="btn" data-capx-tab="shipperCap">荷主キャパを修正</button></div>
      ${rows.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>地区</th><th>構成区分</th>${groups.map(g=>`<th class="r">${esc(g.label)}</th>`).join('')}<th class="r">平日合計</th><th class="r">土日合計</th><th class="r">月キャパ</th></tr></thead><tbody>${rows.map(r=>{
        const monthCap = this.monthlyCap(ym, r.area);
        return `<tr><td><b>${esc(r.area)}</b></td><td>${esc(r.groups.map(g=>g.name).join(' / '))}</td>${groups.map(g=>`<td class="r">${fmt(r.shipper[g.key]?.weekday || 0)} / ${fmt(r.shipper[g.key]?.weekend || 0)}</td>`).join('')}<td class="r"><b>${fmt(r.weekday)}</b></td><td class="r"><b>${fmt(r.weekend)}</b></td><td class="r"><b>${fmt(monthCap)}</b></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="capx-empty">荷主キャパ区分が未作成です。「荷主キャパ」タブで区分を作成してください。</div>`}
    </div>`;
  },

  unmatchedHtml(actual) {
    const rows = [...(actual.unmatched || new Map()).entries()].sort((a,b)=>b[1]-a[1]);
    return `<div class="capx-card"><h3>未分類</h3><p class="capx-note2">地区マッピングに当たらなかった市区町村です。必要に応じて地区マッピングへ追加してください。</p>
      ${rows.length ? `<div class="capx-cause-list">${rows.map(([c,n],i)=>`<div class="capx-cause-row"><b>${i+1}</b><span>${esc(c)}</span><em>${fmt(n)}件</em></div>`).join('')}</div>` : '<div class="capx-empty">未分類はありません。</div>'}
    </div>`;
  },

  dailyCauseHtml(row) {
    if (!row) return `<div class="capx-empty">対象データがありません</div>`;
    const diff = this.n(row.count) - this.n(row.cap);
    const cities = Object.entries(row.cities || {}).sort((a,b)=>b[1]-a[1]);
    const shippers = Object.entries(row.shippers || {}).sort((a,b)=>b[1]-a[1]);
    const topCity = cities[0];
    const topShipper = shippers[0];
    const cityShare = topCity ? topCity[1] / (this.n(row.count) || 1) * 100 : 0;
    const shipperShare = topShipper ? topShipper[1] / (this.n(row.count) || 1) * 100 : 0;
    const shipperCapRows = shippers.map(([name,n])=>{
      const cap = this.shipperDailyCap(row.date, row.area, name);
      const diff = this.n(n) - cap;
      const j = this.judge(this.n(n), cap);
      return { name, count:this.n(n), cap, diff, ...j };
    });
    const insight = diff > 0
      ? `${esc(row.area)}で日キャパを${diff > 0 ? '+' : ''}${fmt(diff)}件超過しています。${topCity ? `市区町村は${esc(topCity[0])}が最多（${pct(cityShare)}）です。` : ''}${topShipper ? ` 荷主は${esc(topShipper[0])}が最多（${pct(shipperShare)}）です。` : ''}`
      : `日キャパ内に収まっています。内訳確認用の表示です。`;

    return `<div class="capx-cause-inner">
      <div class="capx-cause-title">
        <h4>${esc(this.dateLabel(row.date))} / ${esc(row.area)}</h4>
        <p>${row.estimated ? '※月間件数をカレンダー日数で割った推定値です。' : '実日付データをもとにした集計です。'}</p>
      </div>
      <div class="capx-city-hint">${insight}</div>
      <div class="capx-cause-kpis">
        <div><span>実績</span><b>${fmt(row.count)}件</b></div>
        <div><span>日キャパ</span><b>${fmt(row.cap)}件</b></div>
        <div class="${diff > 0 ? 'danger' : 'ok'}"><span>差分</span><b>${diff > 0 ? '+' : ''}${fmt(diff)}件</b></div>
        <div><span>超過倍率</span><b>${row.cap > 0 ? (this.n(row.count)/this.n(row.cap)).toFixed(1) + '倍' : '-'}</b></div>
      </div>
      <h5>市区町村別 原因内訳</h5>
      <div class="capx-cause-list">
        ${cities.length ? cities.map(([c,n],i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(c)}</span>
            <em>${fmt(n)}件</em>
          </div>
        `).join('') : '<div class="capx-empty">市区町村内訳なし</div>'}
      </div>
      <h5>荷主別 原因内訳</h5>
      <div class="capx-cause-list">
        ${shipperCapRows.length ? shipperCapRows.map((x,i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(x.name)}</span>
            <em>${fmt(x.count)}件${x.cap>0 ? ` / 枠${fmt(x.cap)}件 / ${x.diff>0?'+':''}${fmt(x.diff)}件` : ' / 判定なし'}</em>
          </div>
        `).join('') : '<div class="capx-empty">荷主内訳なし</div>'}
      </div>
    </div>`;
  },

  showDailyCause(idx) {
    const row = this._lastDailyRows[Number(idx)];
    const box = document.getElementById('capacity-daily-cause-box');
    if (!box || !row) return;
    document.querySelectorAll('[data-capx-daily-row]').forEach(tr=>tr.classList.remove('selected'));
    const tr = document.querySelector(`[data-capx-daily-row="${Number(idx)}"]`);
    if (tr) tr.classList.add('selected');
    box.innerHTML = this.dailyCauseHtml(row);
  },

  bindCalendarDetailInputs() {
    document.querySelectorAll('#capx-calendar-detail [data-capx-cal-date]').forEach(inp=>inp.addEventListener('change',()=>{
      const date = inp.dataset.capxCalDate, field = inp.dataset.capxCalField;
      STATE.capacity.calendar = STATE.capacity.calendar || {};
      STATE.capacity.calendar[date] = STATE.capacity.calendar[date] || {};
      STATE.capacity.calendar[date][field] = inp.type === 'number' ? this.n(inp.value) : inp.value;
      STORE.save();
      this.render();
    }));
  },

  bind() {
    const ym = document.getElementById('capacity-ym');
    if (ym) ym.addEventListener('change', ()=>this.render());
    const days = document.getElementById('capacity-days');
    if (days) days.addEventListener('change', ()=>this.render());
    const base = document.getElementById('capacity-base');
    if (base) base.addEventListener('change', ()=>this.render());

    document.querySelectorAll('[data-capx-tab]').forEach(btn=>btn.addEventListener('click',()=>{ this._tab=btn.dataset.capxTab; this.render(); }));
    document.querySelectorAll('[data-capx-detail]').forEach(btn=>btn.addEventListener('click',()=>this.showCities(Number(btn.dataset.capxDetail))));
    document.querySelectorAll('[data-capx-daily-row]').forEach(row=>row.addEventListener('click',()=>this.showDailyCause(Number(row.dataset.capxDailyRow))));
    document.querySelectorAll('[data-capx-cal-detail]').forEach(btn=>btn.addEventListener('click',()=>{
      const box = document.getElementById('capx-calendar-detail');
      if (!box) return;
      box.innerHTML = this.calendarDetailHtml(btn.dataset.capxCalDetail, this._lastDailyRows || []);
      this.bindCalendarDetailInputs();
    }));
    document.querySelectorAll('[data-capx-cal-date]').forEach(inp=>inp.addEventListener('change',()=>{
      const date = inp.dataset.capxCalDate, field = inp.dataset.capxCalField;
      STATE.capacity.calendar = STATE.capacity.calendar || {};
      STATE.capacity.calendar[date] = STATE.capacity.calendar[date] || {};
      STATE.capacity.calendar[date][field] = inp.type === 'number' ? this.n(inp.value) : inp.value;
      STORE.save();
      this.render();
    }));
    document.querySelectorAll('[data-capx-group-field]').forEach(inp=>inp.addEventListener('change',()=>{
      const tr = inp.closest('[data-capx-group-key]');
      const key = tr?.dataset.capxGroupKey;
      const g = (STATE.capacity.shipperGroups || []).find(x=>x.key === key);
      if (!g) return;
      const field = inp.dataset.capxGroupField;
      g[field] = inp.type === 'checkbox' ? inp.checked : inp.value;
      STORE.save();
      this.render();
    }));
    const regionFilter = document.getElementById('capx-region-filter');
    if (regionFilter) regionFilter.addEventListener('change',()=>{
      this._capRegionFilter = regionFilter.value || 'saitama_all';
      this.render();
    });

    const addCapGroup = document.getElementById('capx-add-cap-group');
    if (addCapGroup) addCapGroup.addEventListener('click',()=>{
      const name = String(document.getElementById('capx-new-group-name')?.value || '').trim();
      const units = [...document.querySelectorAll('[data-capx-new-group-unit]:checked')].map(x=>x.value).filter(Boolean);
      if (!name) { UI.toast('区分名を入力してください','warn'); return; }
      if (!units.length) { UI.toast('対象の区・市を選択してください','warn'); return; }

      const capacity = {};
      this.activeShipperGroups().forEach(g=>{
        capacity[g.key] = { weekday:0, weekend:0 };
      });
      document.querySelectorAll('[data-capx-new-cap]').forEach(inp=>{
        const key = inp.dataset.capxNewCap;
        const field = inp.dataset.capxNewCapField;
        capacity[key] = capacity[key] || { weekday:0, weekend:0 };
        capacity[key][field] = this.n(inp.value);
      });

      STATE.capacity.capacityGroups = STATE.capacity.capacityGroups || [];
      STATE.capacity.capacityGroups.push({
        id: 'cg_' + Date.now() + '_' + Math.random().toString(16).slice(2),
        name,
        units,
        capacity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      UI.toast('キャパ区分を追加しました');
      this.render();
    });

    document.querySelectorAll('[data-capx-capgroup-delete]').forEach(btn=>btn.addEventListener('click',()=>{
      const id = btn.dataset.capxCapgroupDelete;
      if (!confirm('このキャパ区分を削除しますか？')) return;
      STATE.capacity.capacityGroups = (STATE.capacity.capacityGroups || []).filter(g=>g.id !== id);
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

    document.querySelectorAll('[data-capx-capgroup-field]').forEach(inp=>inp.addEventListener('change',()=>{
      const card = inp.closest('[data-capx-capgroup-id]');
      const id = card?.dataset.capxCapgroupId;
      const cg = (STATE.capacity.capacityGroups || []).find(g=>g.id === id);
      if (!cg) return;
      cg[inp.dataset.capxCapgroupField] = inp.value;
      cg.updatedAt = new Date().toISOString();
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

    document.querySelectorAll('[data-capx-capgroup-cap]').forEach(inp=>inp.addEventListener('change',()=>{
      const card = inp.closest('[data-capx-capgroup-id]');
      const id = card?.dataset.capxCapgroupId;
      const cg = (STATE.capacity.capacityGroups || []).find(g=>g.id === id);
      if (!cg) return;
      const key = inp.dataset.capxCapgroupCap;
      const field = inp.dataset.capxCapField;
      cg.capacity = cg.capacity || {};
      cg.capacity[key] = cg.capacity[key] || { weekday:0, weekend:0 };
      cg.capacity[key][field] = this.n(inp.value);
      cg.updatedAt = new Date().toISOString();
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

  },

  updateMaster(inp) {
    const tr = inp.closest('[data-area]');
    const old = tr.dataset.area;
    const field = inp.dataset.capxMasterField;
    const row = STATE.capacity.areas[old] || {weekday:0,weekend:0,rows:[]};
    if (field === 'area') {
      const name = this.normArea(inp.value);
      if (name && name !== old) {
        delete STATE.capacity.areas[old];
        STATE.capacity.areas[name] = row;
      }
    } else {
      row[field] = this.n(inp.value);
      STATE.capacity.areas[old] = row;
    }
    STORE.save();
    this.render();
  },

  showCities(idx) {
    const row = this._lastRows[idx];
    const box = document.getElementById('capacity-detail-box');
    if (!box || !row) return;
    const cities = Object.entries(row.cities || {}).sort((a,b)=>b[1]-a[1]);
    box.innerHTML = cities.length ? cities.map(([c,n],i)=>`<div class="capx-city"><b>${i+1}</b><span>${esc(c)}</span><em>${fmt(n)}件</em></div>`).join('') : '<div class="capx-empty">該当なし</div>';
  },

  saveSettings() {},

  async importCapacityExcel(file) {
    if (!file) return;
    await IMPORT.importCapacityExcel(file);
    this.render();
  },

  importAreaCsv(files) {
    if (!files || !files.length) return;
    if (window.FIELD_PRODUCT_IMPORT2?.handleFiles) FIELD_PRODUCT_IMPORT2.handleFiles(files);
    else if (window.FIELD_WORKER_IMPORT2?.handleFiles) FIELD_WORKER_IMPORT2.handleFiles(files);
    UI.toast('CSVを取り込みました。完了後に再集計してください。','info');
  },

  clearMaster() {
    if (!confirm('作成済みの荷主キャパ区分を初期化しますか？\n※商品・住所CSV、荷主判定ルール、カレンダー補正は残します。')) return;
    this.ensureState();
    STATE.capacity.capacityGroups = [];
    STATE.capacity.areas = {};
    STATE.capacity.sourceFile = '';
    STATE.capacity.rowCount = 0;
    STORE.save();
    this.render();
  },

  populateYMSel() {},

  ensureStyle() {
    if (document.getElementById('capacity-ui-fixed-style')) return;
    const st = document.createElement('style');
    st.id = 'capacity-ui-fixed-style';
    st.textContent = `
      .capx{display:grid;gap:14px}.capx-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.05);padding:18px}.capx-control{border-top:3px solid var(--navy)}.capx-headline{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.capx h2{margin:0;font-size:22px;font-weight:900}.capx h3{margin:0 0 12px;font-size:16px;font-weight:900}.capx p{margin:4px 0 0;color:var(--text2);font-size:12px;font-weight:700}.capx-cond{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.capx-cond label{font-size:11px;color:var(--text2);font-weight:800}.capx-cond select,.capx-cond input{display:block;margin-top:4px;min-width:160px}.capx-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.capx-note,.capx-note2{font-size:11px;color:var(--text3);line-height:1.7;margin-top:8px}.capx-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}.capx-kpi{position:relative;background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px 18px;box-shadow:0 10px 22px rgba(15,23,42,.05);overflow:hidden}.capx-kpi:before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:#2563eb}.capx-kpi.green:before{background:#059669}.capx-kpi.over:before{background:#dc2626}.capx-kpi.full:before{background:#f97316}.capx-kpi.good:before{background:#2563eb}.capx-kpi.unset:before{background:#94a3b8}.capx-kpi.amber:before{background:#f97316}.capx-kpi span{display:block;color:var(--text2);font-size:12px;font-weight:900;margin-bottom:6px}.capx-kpi b{font-size:28px;font-weight:900;color:var(--text)}.capx-kpi em{display:block;font-style:normal;color:var(--text2);font-size:12px;font-weight:800;margin-top:4px}.capx-tabs{display:flex;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid var(--border);border-radius:16px;padding:12px}.capx-tabs button{border:1px solid var(--border2);background:#fff;border-radius:999px;padding:10px 16px;font-weight:900;cursor:pointer}.capx-tabs button.active{background:#2563eb;color:#fff;border-color:#2563eb}.capx-grid{display:grid;grid-template-columns:minmax(620px,1.4fr) minmax(320px,.8fr);gap:14px}.capx-link{border:0;background:transparent;color:#1d4ed8;font-weight:900;cursor:pointer}.capx-risk-over td{background:#fff7f7}.capx-risk-full td{background:#fffaf0}.capx-risk-good td{background:#eff6ff}.capx-risk-unset td{background:#f8fafc}.capx-empty{text-align:center;color:var(--text3);font-weight:800;padding:22px}.capx-calendar{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:14px}.capx-week{text-align:center;font-size:12px;font-weight:900;background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px}.capx-week.sun{color:#b91c1c}.capx-week.sat{color:#1d4ed8}.capx-day{min-height:140px;background:#fff;border:1px solid var(--border);border-radius:14px;padding:9px;display:grid;gap:7px}.capx-day.weekend{background:#eff6ff}.capx-day.ok{background:#ecfdf5}.capx-day.good{background:#eff6ff}.capx-day.full{background:#fff7ed}.capx-day.over{background:#fef2f2}.capx-day.unset{background:#f8fafc}.capx-day.blank{background:transparent;border:0}.capx-daytop{display:flex;justify-content:space-between;gap:8px}.capx-daytop b{font-size:18px}.capx-daytop span{font-size:11px;font-weight:800;color:var(--text2)}.capx-city{display:grid;grid-template-columns:32px 1fr 80px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:8px 10px;margin-bottom:7px}.capx-city b{color:#1d4ed8}.capx-city span{font-weight:900}.capx-city em{font-style:normal;text-align:right;font-weight:900}.capacity-status{display:inline-flex;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900}.capacity-status.ok{background:#dcfce7;color:#166534}.capacity-status.good{background:#dbeafe;color:#1e40af}.capacity-status.full{background:#ffedd5;color:#9a3412}.capacity-status.over{background:#fee2e2;color:#991b1b}.capacity-status.unset{background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1}
      .capx-calendar-card{padding:18px!important}
      .capx-cal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
      .capx-cal-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .capx-cal-summary span{display:inline-flex;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;border:1px solid var(--border)}
      .capx-cal-summary .danger{background:#fee2e2;color:#991b1b;border-color:#fecaca}.capx-cal-summary .full{background:#fff7ed;color:#9a3412;border-color:#fed7aa}
      .capx-calendar-layout{display:grid;grid-template-columns:minmax(620px,1.3fr) minmax(320px,.7fr);gap:14px;align-items:start}
      .capx-calendar-simple{display:grid;grid-template-columns:repeat(7,minmax(88px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:16px;border:1px solid var(--border)}
      .capx-day-simple{min-height:92px;border:1px solid var(--border);border-radius:14px;background:#fff;display:grid;grid-template-rows:auto 1fr auto;gap:3px;padding:10px;text-align:left;cursor:pointer;position:relative;box-shadow:0 8px 18px rgba(15,23,42,.04)}
      .capx-day-simple:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(15,23,42,.08)}
      .capx-day-simple .day-no{font-size:18px;font-weight:900;color:#0f172a}.capx-day-simple strong{font-size:18px;font-weight:900;align-self:center}.capx-day-simple em{font-size:11px;font-style:normal;font-weight:900;color:#64748b}.capx-day-simple i{position:absolute;right:8px;top:8px;border-radius:999px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:10px;font-style:normal;font-weight:900;padding:2px 6px}
      .capx-day-simple.empty{background:#fff;color:#94a3b8}.capx-day-simple.weekend{background:#f8fafc}.capx-day-simple.ok{background:#eff6ff;border-color:#bfdbfe}.capx-day-simple.full{background:#fff7ed;border-color:#fed7aa}.capx-day-simple.over{background:#fef2f2;border-color:#fecaca}.capx-day-simple.blank{visibility:hidden;box-shadow:none;border:0;background:transparent;cursor:default}
      .capx-cal-detail{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.05);min-height:260px;overflow:hidden}
      .capx-empty.small{padding:28px 18px;font-size:13px}.capx-cal-detail-inner{display:grid;gap:14px;padding:16px}.capx-cal-detail-title{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding-bottom:10px}.capx-cal-detail-title b{display:block;font-size:18px;font-weight:900}.capx-cal-detail-title span{display:block;font-size:12px;color:var(--text2);font-weight:800;margin-top:3px}
      .capx-cal-edit{display:grid;gap:10px}.capx-cal-edit label{display:grid;gap:5px;font-size:12px;font-weight:900;color:var(--text2)}.capx-cal-edit select,.capx-cal-edit input{width:100%;min-width:0}
      .capx-cal-area-list{display:grid;gap:8px}.capx-cal-area-row{display:grid;grid-template-columns:1fr 70px 70px 70px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:9px 10px;background:#fff}.capx-cal-area-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.capx-cal-area-row b,.capx-cal-area-row em,.capx-cal-area-row strong{text-align:right;font-style:normal;font-weight:900}.capx-cal-area-row.over{background:#fff7f7}.capx-cal-area-row.full{background:#fffaf0}
      @media(max-width:900px){.capx-cal-head{flex-direction:column}.capx-calendar-layout{grid-template-columns:1fr}.capx-calendar-simple{grid-template-columns:repeat(2,minmax(120px,1fr))}.capx-week{display:none}.capx-cal-area-row{grid-template-columns:1fr 60px}.capx-cal-area-row em,.capx-cal-area-row strong{text-align:left}}

      .capx-shipper-summary{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:12px;margin:14px 0}.capx-mini-card{border:1px solid var(--border);border-radius:14px;padding:14px;background:#f8fafc}.capx-mini-card span{display:block;font-size:12px;font-weight:900;color:var(--text2);margin-bottom:5px}.capx-mini-card b{display:block;font-size:24px;font-weight:900;color:var(--text)}.capx-mini-card em{display:block;font-size:11px;font-style:normal;color:var(--text3);font-weight:800;margin-top:4px}.capx-capgroup-layout{display:grid;grid-template-columns:minmax(420px,.85fr) minmax(480px,1.15fr);gap:14px;align-items:start}.capx-capgroup-form,.capx-capgroup-list{border:1px solid var(--border);border-radius:16px;background:#fff;padding:16px}.capx-capgroup-form h4,.capx-capgroup-list h4{margin:0 0 12px;font-size:15px;font-weight:900}.capx-form-label{display:grid;gap:6px;font-size:12px;font-weight:900;color:var(--text2);margin-bottom:10px}.capx-form-label input,.capx-form-label select{width:100%;min-width:0}.capx-unit-list{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:10px;background:#f8fafc;border:1px solid var(--border);border-radius:14px;padding:12px;max-height:360px;overflow:auto;margin:10px 0 14px}.capx-unit-card{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--border);border-radius:12px;background:#fff;padding:10px;cursor:pointer}.capx-unit-card:hover{border-color:#93c5fd;background:#eff6ff}.capx-unit-card input{margin-top:3px}.capx-unit-card b{display:block;font-weight:900;color:var(--text);font-size:13px}.capx-unit-card em{display:block;font-style:normal;color:var(--text3);font-size:11px;font-weight:800;margin-top:3px}.capx-group-cap-inputs{display:grid;gap:8px;margin:10px 0 14px}.capx-group-cap-inputs.compact{margin:8px 0 0}.capx-group-cap-row{display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;align-items:center}.capx-group-cap-row b{font-size:12px;font-weight:900}.capx-group-cap-row label{display:grid;gap:3px;font-size:11px;font-weight:900;color:var(--text2)}.capx-group-cap-row input{width:100%;min-width:0}.capx-capgroup-card{border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px;background:#f8fafc}.capx-capgroup-title{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.capx-capgroup-title input{font-weight:900;font-size:14px;min-width:220px}.capx-capgroup-title em{display:block;font-style:normal;font-size:11px;color:var(--text3);font-weight:800;margin-top:4px}.capx-capgroup-units{margin-top:8px;border-radius:10px;background:#fff;border:1px solid var(--border);padding:8px 10px;font-size:12px;font-weight:900;color:var(--text2);line-height:1.7}

      @media(max-width:900px){.capx-headline{flex-direction:column}.capx-kpis{grid-template-columns:repeat(2,1fr)}.capx-grid{grid-template-columns:1fr}.capx-calendar{grid-template-columns:repeat(2,1fr)}.capx-week{display:none}}
    `;
    document.head.appendChild(st);
  }
};


/* ════════ §20A データ保管場所対応表ヘルパー ═══════════════════ */
function storageFiscalYear() {
  const sel = document.getElementById('storage-fy-select');
  if (sel && sel.value) return String(sel.value);
  const plan = document.getElementById('plan-year-sel');
  if (plan && plan.value) return String(plan.value);
  return STATE.fiscalYear || getDefaultFiscalYear();
}
function storageFiscalMonths(fy) { return monthsOfFiscalYear(String(fy)); }
function storageRowsForFY(fy) {
  const months = storageFiscalMonths(fy);
  return (STATE.datasets || []).filter(d => months.includes(d.ym));
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
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div>
        </div>
        <div>${summary}</div>
      </div>
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
    </div>`;
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
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-weight:900;font-size:14px">重複・異常データ確認</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">同じ年月＋同じ区分の重複、単位ズレ、年度ズレ、極端に小さい金額を確認</div>
        </div>
        <div>${summary}</div>
      </div>
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
    </div>`;
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

  const years = new Set([String(fy), getDefaultFiscalYear()]);
  (STATE.datasets || []).forEach(d => years.add(String(d.fiscalYear || fiscalYearFromYM(d.ym))));
  if (STATE.planData && typeof STATE.planData === 'object') {
    Object.keys(STATE.planData).forEach(y => /^\d{4}$/.test(y) && years.add(y));
  }
  const yearOptions = [...years].sort().reverse().map(y => `<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('');

  const tableRows = [
    ['収支実績CSV', `${fy}年度`, (monthsConfirmed||monthsDaily)?storageBadge('登録済','ok'):storageBadge('未登録','warn'), `確定 ${monthsConfirmed}ヶ月 / 速報 ${monthsDaily}ヶ月`, '円', formatImportedAt(storageLatestAt(csvRows)), 'SKDL0001/0003。速報と確定は両方保持。表示は確定優先。', '月別チェック表から月単位で削除'],
    ['計画データ', `${fy}年度`, plan?storageBadge('登録済','ok'):storageBadge('未登録','warn'), plan?`${Object.keys(plan).length}科目 / 合計 ${fmt(storagePlanAllTotal(plan))}千円`:'0科目', '千円', formatImportedAt(planPack?.importedAt), '年度単位で完全独立。取込時は年度丸ごと入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deletePlan('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['収支補完', `${fy}年度`, histMonths?storageBadge('登録済','ok'):storageBadge('未登録','warn'), histMonths?`${histMonths}ヶ月 / 収入 ${fmt(histRows.reduce((s,d)=>s+storageAmountK(d,'totalIncome'),0))}千円`:'0ヶ月', '千円', formatImportedAt(storageLatestAt(histRows)), 'SKKS月次収支照会の貼付。年度単位で完全入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteHistory('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['作業者CSV', `${fy}年度`, workerRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), workerRows.length?`${workerRows.length}ヶ月 / ${fmt(workerRows.reduce((s,d)=>s+n(d.rowCount),0))}行`:'0ヶ月', '件数', formatImportedAt(storageLatestAt(workerRows)), '作業者分析・作業内容分析の元データ。月単位で個別削除できます。', '月別チェック表から月単位で削除'],
    ['商品住所CSV', `${fy}年度`, productRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), productRows.length?`${productRows.length}ヶ月 / 原票${fmt(productRows.reduce((s,d)=>s+n(d.uniqueCount),0))}件`:'0ヶ月', '件数/円', formatImportedAt(storageLatestAt(productRows)), '商品カテゴリ・エリア・キャパ・荷主判定の元データ。顧客氏名・番地は保存しません。', '月別チェック表から月単位で削除'],
  ];

  return `
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-weight:900;font-size:14px">データ保管場所 対応表</div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px">
          <span style="color:var(--text2)">対象年度</span>
          <select id="storage-fy-select" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${yearOptions}</select>
        </div>
      </div>
      ${warnings.length ? `<div style="border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.7"><strong>確認が必要なデータがあります</strong><br>${warnings.map(w=>'・'+esc(w)).join('<br>')}</div>` : `<div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px">この年度の保管状況に大きな異常は見つかりません。</div>`}
      <div class="scroll-x"><table class="tbl"><thead><tr><th>保管区分</th><th>対象</th><th>登録状況</th><th>件数/月数</th><th>元単位</th><th>最終更新</th><th>説明</th><th>操作</th></tr></thead><tbody>
        ${tableRows.map(r=>`<tr><td><strong>${esc(r[0])}</strong></td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td style="min-width:260px;color:var(--text2)">${esc(r[6])}</td><td>${r[7]}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
}
window.DATA_STORAGE_TABLE = {
  changeFY(fy){ STATE.fiscalYear = String(fy); renderImport(); },

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

/* ════════ §20 RENDER — Import ═════════════════════════════════ */
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
        <span style="margin-left:10px;color:var(--text2)">確定 ${statusMap[fy].confirmed.size}ヶ月 / 速報 ${statusMap[fy].daily.size}ヶ月</span>
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

    listEl.innerHTML = storageHtml + monthlyHtml + qualityHtml + historyHtml;
  }

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

function reportPolicyKey(fy, half) {
  return `${String(fy || getDefaultFiscalYear())}_${half || '上期'}`;
}

function reportHalfFromYM(ym) {
  const mm = Number(String(ym || '').slice(4,6));
  return (mm >= 4 && mm <= 9) ? '上期' : '下期';
}

function reportFYFromYM(ym) {
  return ym ? fiscalYearFromYM(ym) : getDefaultFiscalYear();
}

/* ════════ §23 REPORT_UI（スタブ） ═════════════════════════════ */
const REPORT_UI = {
  _OAI_KEY: 'report_oai_key_v1',

  getKey() { try { return localStorage.getItem(this._OAI_KEY)||''; } catch(e){ return ''; } },
  setKey(k) { try { localStorage.setItem(this._OAI_KEY, k); } catch(e){}},
  getFY()   { return document.getElementById('report-fy')?.value  || dashboardSelectedFiscalYear() || getDefaultFiscalYear(); },
  getYM()   { return document.getElementById('report-ym')?.value  || dashboardSelectedYM() || latestDS()?.ym || ''; },

  populateSelectors() {
    const fySel = document.getElementById('report-fy');
    const ymSel = document.getElementById('report-ym');
    if (!fySel) return;
    const years = [...new Set([...dashboardAvailableFiscalYears(), getDefaultFiscalYear()])]
      .filter(Boolean).sort((a,b)=>Number(b)-Number(a));
    const oldFY = fySel.value || getDefaultFiscalYear();
    fySel.innerHTML = years.map(y=>`<option value="${esc(y)}" ${String(y)===String(oldFY)?'selected':''}>${esc(y)}年度</option>`).join('');
    if (!fySel.value && years.length) fySel.value = years[0];
    const fym = monthsOfFiscalYear(fySel.value);
    const validYms = fym.filter(ym => activeDatasetByYM(ym));
    const currentYM = ymSel?.value || dashboardSelectedYM() || validYms.at(-1) || fym[0] || '';
    if (ymSel) {
      ymSel.innerHTML = fym.map(ym=>{
        const has = validYms.includes(ym);
        return `<option value="${esc(ym)}" ${ym===currentYM?'selected':''}>${esc(ymLabel(ym))}${has?'':'（データなし）'}</option>`;
      }).join('');
      if (currentYM) ymSel.value = currentYM;
    }
  },

  refresh() {
    this.populateSelectors();
    // APIキー表示
    const keyEl = document.getElementById('report-oai-key');
    const msg   = document.getElementById('report-key-msg');
    const k = this.getKey();
    if (keyEl && !keyEl.value) keyEl.value = k ? '●'.repeat(20) : '';
    if (msg) msg.textContent = k ? '✅ APIキー設定済み' : '⚠️ APIキーを入力してください';
    // ボタンにリスナーを接続
    const saveBtn = document.getElementById('report-save-key-btn');
    if (saveBtn && !saveBtn._bound) {
      saveBtn._bound = true;
      saveBtn.addEventListener('click', () => {
        const v = document.getElementById('report-oai-key')?.value?.trim();
        if (v && !v.startsWith('●')) this.setKey(v);
        const m = document.getElementById('report-key-msg');
        if (m) m.textContent = this.getKey() ? '✅ 保存しました' : '⚠️ 空です';
      });
    }
    const genBtn = document.getElementById('report-gen-btn');
    if (genBtn && !genBtn._bound) {
      genBtn._bound = true;
      genBtn.addEventListener('click', () => REPORT_UI.generate());
    }
  },

  prog(id, state, text) {
    const el = document.getElementById(id); if (!el) return;
    el.style.color = state==='done'?'#16a34a':state==='active'?'#1a6fc4':state==='error'?'#dc2626':'var(--text3)';
    el.textContent = (state==='done'?'✅':state==='active'?'🔄':state==='error'?'❌':'⬜') + ' ' + text;
  },

  buildDataSummary(ym) {
    const ds = ym ? activeDatasetByYM(ym) : latestDS();
    const prev = ds ? prevDS(ds.ym) : null;
    const lines = [];
    if (ds) {
      lines.push(`営業収益: ${fmtK(ds.totalIncome)}千円`);
      lines.push(`費用合計: ${fmtK(ds.totalExpense)}千円`);
      lines.push(`センター利益: ${fmtK(ds.profit)}千円`);
      lines.push(`利益率: ${pct(ds.profitRate)}`);
      lines.push(`みなし人件費率: ${pct(ds.pseudoLaborRate)}`);
      if (prev) lines.push(`前月比 営業収益: ${ratio(ds.totalIncome, prev.totalIncome)}`);
    } else {
      lines.push('月次収支データなし');
    }
    return lines.join('\n');
  },

  buildPrompt(type, fy, ym, extra) {
    const typeLabel = {monthly:'月次会議報告書', halfReview:'半期振り返り', policy:'半期方針'}[type]||type;
    const period    = reportHalfFromYM(ym);
    const prevPeri  = period==='上期'?'下半期':'上半期';
    const libs = (STATE.library||[]).slice(0,3)
      .map((item,i)=>`【資料${i+1}】${item.title||item.fileName||''}${item.memo?'\n'+item.memo:''}`).join('\n\n');

    return `${CENTER.name}の${typeLabel}を作成してください。

【絶対ルール】
・箇条書き（・や―）は一切使わない
・全て段落（流れる文章）で書く
・数字は必ず文中に具体的に入れる（百万円・千円単位）
・「一方で」「その中で」「これにより」「また」等の接続詞で段落をつなぐ
・「〜となりました」「〜しています」「〜で進めていく」等の語尾を使う
・JSONのみ返す（他のテキスト不要）

【文体サンプル（この書き方に寄せること）】
振り返り例:「下半期は、不採算業務の整理と新規売上の取り込みにより、利益が出る構造へ転換した期間となりました。営業収益は計画170.7百万円に対し実績180.3百万円（+9.6百万円）、粗利益は計画1.0百万円に対し実績12.1百万円（+11.1百万円）と、売上・利益ともに計画を達成しております。一方で、その達成過程については課題も明確です。」

方針例:「■クレーンの進め方\nクレーンは最も利益インパクトが大きく、1件約40,000円に対し傭車では約60％が支払となるため、1件あたり約16,000円の差が出る。月40件の実施で売上は960千円を見込んでいる。まずは240千円程度を確実に取りにいく形で進めていく。」

【出力JSON形式】
\`\`\`json
{
  "review": {
    "p1": "${prevPeri}全体の概況と実績数値の段落（3〜5文）",
    "p2": "課題・背景・対応経緯の段落（3〜5文）",
    "p3": "取り組みの成果と構造変化の段落（3〜5文）",
    "p4": "評価と${period}への接続（2〜3文）"
  },
  "policy": {
    "intro": "${period}方針宣言の段落（2〜3文）",
    "items": [
      {"title":"■ 施策タイトル1","p1":"内容・数値根拠（3〜5文）","p2":"実施方法・見通し（2〜4文）"},
      {"title":"■ 施策タイトル2","p1":"説明段落","p2":"説明段落"},
      {"title":"■ まとめ","p1":"全体まとめ（2〜3文）","p2":""}
    ]
  }
}
\`\`\`

【実績データ: ${ymLabel(ym)}】
${this.buildDataSummary(ym)}
${libs?'\n【過去資料参考情報】\n'+libs:''}
${extra?'\n【担当者からの追加情報】\n'+extra:''}`;
  },

  async generate() {
    const key = this.getKey();
    if (!key) { alert('ChatGPT APIキーを入力・保存してください。\nhttps://platform.openai.com/api-keys で取得できます。'); return; }
    const btn  = document.getElementById('report-gen-btn');
    const prog = document.getElementById('report-progress');
    if (btn)  { btn.disabled=true; btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></span>　生成中...'; }
    if (prog) prog.style.display='';

    try {
      // ① データ収集
      this.prog('rpg-1','active','データを収集中...');
      const ym    = this.getYM();
      const fy    = this.getFY();
      const type  = document.getElementById('report-type')?.value||'monthly';
      const extra = document.getElementById('report-extra')?.value?.trim()||'';
      const prompt = this.buildPrompt(type, fy, ym, extra);
      this.prog('rpg-1','done','データ収集完了');

      // ② ChatGPT API
      this.prog('rpg-2','active','ChatGPTが文章を生成中（20〜40秒）...');
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({
          model:'gpt-4o',
          max_tokens:3000,
          messages:[
            {role:'system', content:'あなたは物流センターの経営管理報告書ライターです。指示通りJSONのみ返してください。'},
            {role:'user', content:prompt}
          ]
        })
      });
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        throw new Error(e?.error?.message || 'OpenAI APIエラー HTTP ' + res.status);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const m = text.match(/```json\n?([\s\S]+?)```/) || text.match(/(\{[\s\S]+\})/);
      if (!m) throw new Error('ChatGPTの返答がJSON形式ではありませんでした:\n'+text.slice(0,200));
      const rpt = JSON.parse((m[1]||m[0]).trim());
      this.prog('rpg-2','done','文章生成完了');

      // ③ docx.iife.js を動的読み込み
      this.prog('rpg-3','active','Wordライブラリを読み込み中...');
      if (!window.docx) {
        await new Promise((resolve, reject) => {
          if (document.getElementById('docx-iife-script')) { resolve(); return; }
          const s = document.createElement('script');
          s.id = 'docx-iife-script'; s.src = 'docx.iife.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('docx.iife.js の読み込みに失敗。ファイルがサーバーに存在するか確認してください。'));
          document.head.appendChild(s);
        });
      }
      this.prog('rpg-3','done','Wordライブラリ読み込み完了');

      // ④ Word生成
      this.prog('rpg-4','active','Wordファイルを作成中...');
      const blob = await this._buildDocx(type, fy, ym, rpt);
      this.prog('rpg-4','done','Wordファイル作成完了');

      // ⑤ ダウンロード
      this.prog('rpg-5','active','ダウンロード中...');
      const tag = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const url2 = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url2; a.download=CENTER.name+'_報告書_'+tag+'.docx'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url2), 3000);
      this.prog('rpg-5','done','ダウンロード完了 ✨');

    } catch(e) {
      ['rpg-1','rpg-2','rpg-3','rpg-4','rpg-5'].forEach(id=>{
        const el=document.getElementById(id);
        if (el && el.textContent.includes('🔄')) this.prog(id,'error','エラー: '+e.message);
      });
      alert('エラーが発生しました:\n\n'+e.message);
      console.error('[REPORT_WORD]', e);
    } finally {
      if (btn) { btn.disabled=false; btn.innerHTML='📄　Word報告書を自動生成（ChatGPT + Word）'; }
    }
  },

  async _buildDocx(type, fy, ym, rpt) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, LevelFormat } = window.docx;
    const center   = CENTER.name;
    const dateStr  = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'});
    const period   = reportHalfFromYM(ym) || '上期';
    const prevPeri = period==='上期'?'下半期':'上半期';
    const NAVY='1A3E6F', GRAY='333333', BLUE='1A6FC4', LGRAY='666666';

    const sp  = (n=1) => Array.from({length:n},()=>new Paragraph({spacing:{before:0,after:0},children:[new TextRun({text:'',size:10})]}));
    const hr  = ()    => new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:1}},spacing:{before:80,after:100},children:[new TextRun({text:'',size:4})]});
    const h1  = t     => new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:440,after:100},children:[new TextRun({text:t,bold:true,size:30,color:NAVY,font:'游明朝'})]});
    const h2  = t     => new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:260,after:80},children:[new TextRun({text:t,bold:true,size:24,color:NAVY,font:'游明朝'})]});
    const para = t    => t&&t.trim() ? new Paragraph({spacing:{before:100,after:100},indent:{firstLine:440},children:[new TextRun({text:t,size:22,color:GRAY,font:'游明朝'})]}) : null;
    const kv   = (l,v)=> new Paragraph({spacing:{before:50,after:50},children:[new TextRun({text:l+'　',bold:true,size:21,color:NAVY,font:'游明朝'}),new TextRun({text:v,size:21,color:GRAY,font:'游明朝'})]});

    const ch = [
      new Paragraph({alignment:AlignmentType.RIGHT,spacing:{after:80},children:[new TextRun({text:dateStr,size:20,color:LGRAY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[new TextRun({text:center,bold:true,size:28,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[new TextRun({text:'家電物流事業部 管理者会議',bold:true,size:34,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:160},children:[new TextRun({text:prevPeri+'振り返り／'+period+'運営方針',size:22,color:LGRAY,font:'游明朝'})]}),
      hr(), ...sp(1),
    ];

    // 振り返り
    const rv = rpt.review||{};
    ch.push(h1('【'+prevPeri+' 振り返り】'), hr());
    const ds = activeDatasetByYM(ym);
    if (ds) {
      ch.push(h2('■ 実績サマリー'));
      ch.push(kv('収入合計', fmtK(ds.totalIncome)+'千円'));
      ch.push(kv('費用合計', fmtK(ds.totalExpense)+'千円'));
      ch.push(kv('営業利益', (ds.profit>=0?'+':'-')+fmtK(Math.abs(ds.profit))+'千円'));
      ch.push(...sp(1));
    }
    ['p1','p2','p3','p4'].forEach(k=>{ const p=para(rv[k]); if(p){ch.push(p);ch.push(...sp(1));} });

    // 方針
    const pl = rpt.policy||{};
    ch.push(...sp(1), h1('【'+period+' 運営方針】'), hr());
    const pi=para(pl.intro); if(pi){ch.push(pi);ch.push(...sp(1));}
    (pl.items||[]).forEach(item=>{
      if(item.title) ch.push(h2(item.title));
      ['p1','p2'].forEach(k=>{ const p=para(item[k]); if(p){ch.push(p);ch.push(...sp(1));} });
    });

    const doc = new Document({
      styles:{
        default:{document:{run:{font:'游明朝',size:22,color:GRAY}}},
        paragraphStyles:[
          {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:30,bold:true,font:'游明朝',color:NAVY},paragraph:{spacing:{before:440,after:100},outlineLevel:0}},
          {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:24,bold:true,font:'游明朝',color:NAVY},paragraph:{spacing:{before:260,after:80},outlineLevel:1}},
        ],
      },
      sections:[{
        properties:{page:{size:{width:11906,height:16838},margin:{top:1440,right:1440,bottom:1440,left:1440}}},
        children:ch,
      }],
    });
    return Packer.toBlob(doc);
  },
};
/* ════════ §24 PAST_LIBRARY（ファイル本体はStorage、台帳はfull_state） ══════════════════════════ */
const PAST_LIBRARY = {
  _selectedFile: null,
  _bulkFiles: [],

  handleBulkFiles(files) {
    this._bulkFiles = Array.from(files || []);
    const msg = document.getElementById('library-bulk-msg');
    const prev = document.getElementById('library-bulk-preview');
    if (msg) msg.textContent = `${this._bulkFiles.length}件選択しました`;
    if (prev) {
      prev.style.display = this._bulkFiles.length ? 'block' : 'none';
      prev.innerHTML = this._bulkFiles.map((f, idx) => `
        <div style="padding:7px 10px;border-bottom:1px solid var(--border,#d9dee8);font-size:12px">
          ${idx+1}. ${esc(f.name)} <span style="color:var(--text3)">(${fmtFileSize(f.size)})</span>
        </div>
      `).join('');
    }
  },

  async saveBulkSelected() {
    if (!this._bulkFiles.length) { UI.toast('一括登録するファイルを選択してください','warn'); return; }

    const cat = document.getElementById('library-bulk-category')?.value || 'その他';
    const fy  = document.getElementById('library-bulk-fy')?.value || getDefaultFiscalYear();
    const mm  = document.getElementById('library-bulk-month')?.value || '';
    const autoTitle = document.getElementById('library-bulk-auto-title')?.checked !== false;

    let saved = 0;
    for (const file of this._bulkFiles) {
      try {
        const storagePath = CLOUD._libraryFileKey(file.name, fy);
        await CLOUD.uploadFile(storagePath, file);

        STATE.library.push({
          id: Date.now() + saved,
          title: autoTitle ? file.name.replace(/\.[^.]+$/, '') : file.name,
          category: cat,
          fiscalYear: fy,
          month: mm,
          memo: '',
          content: '',
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || '',
          storagePath,
          savedAt: new Date().toISOString()
        });
        saved++;
      } catch(e) {
        UI.toast(`${file.name} のアップロードに失敗: ${e.message}`, 'error');
      }
    }

    if (saved) {
      STORE.save();
      this.renderList();
      UI.toast(`${saved}件の過去資料を保存しました`);
    }
    this.clearBulk();
  },

  clearBulk() {
    this._bulkFiles = [];
    const input = document.getElementById('library-bulk-file-input');
    if (input) input.value = '';
    const msg = document.getElementById('library-bulk-msg');
    if (msg) msg.textContent = '';
    const prev = document.getElementById('library-bulk-preview');
    if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
  },

  handleFile(file) {
    this._selectedFile = file || null;
    const st = document.getElementById('library-file-status');
    if (st) {
      st.textContent = file
        ? `選択: ${file.name}（${fmtFileSize(file.size)}） ※本体はStorage、台帳はfull_stateに保存`
        : '';
    }

    const title = document.getElementById('library-title');
    if (file && title && !title.value) title.value = file.name.replace(/\.[^.]+$/, '');
  },

  async save() {
    const title = document.getElementById('library-title')?.value;
    const cat   = document.getElementById('library-category')?.value;
    const fy    = document.getElementById('library-fy')?.value || getDefaultFiscalYear();
    const mm    = document.getElementById('library-month')?.value || '';
    const memo  = document.getElementById('library-memo')?.value;
    const content = document.getElementById('library-content')?.value;

    if (!title) { UI.toast('資料名を入力してください','warn'); return; }

    let fileMeta = {};
    if (this._selectedFile) {
      try {
        const file = this._selectedFile;
        const storagePath = CLOUD._libraryFileKey(file.name, fy);
        await CLOUD.uploadFile(storagePath, file);
        fileMeta = {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || '',
          storagePath
        };
      } catch(e) {
        UI.toast('ファイル本体のアップロードに失敗しました: ' + e.message, 'error');
        return;
      }
    }

    STATE.library.push({
      id: Date.now(),
      title,
      category: cat,
      fiscalYear: fy,
      month: mm,
      memo,
      content,
      ...fileMeta,
      savedAt: new Date().toISOString()
    });

    STORE.save();
    this.renderList();
    UI.toast('過去資料を保存しました');
    this.clearForm();
  },

  clearForm() {
    ['library-title','library-memo','library-content'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    this._selectedFile = null;
    const input = document.getElementById('library-file-input');
    if (input) input.value = '';
    const st = document.getElementById('library-file-status');
    if (st) st.textContent = '';
  },

  renderList() {
    const list = document.getElementById('library-list');
    const filter = document.getElementById('library-filter-category')?.value||'';
    if (!list) return;
    const items = STATE.library.filter(i=>!filter||i.category===filter);
    if (!items.length) {
      list.innerHTML='<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだ過去資料がありません</div>';
      return;
    }

    list.innerHTML = items.map(i=>`
      <div class="data-item">
        <span class="badge badge-info">${esc(i.category||'—')}</span>
        <span style="flex:1">
          ${esc(i.title)}
          ${i.fileName ? `<span style="font-size:10px;color:var(--text3);margin-left:6px">📎 ${esc(i.fileName)} / ${fmtFileSize(i.fileSize)}</span>` : ''}
        </span>
        <span style="font-size:10px;color:var(--text3)">${(i.savedAt||'').slice(0,10)}</span>
        ${i.storagePath ? `<button class="btn" onclick="PAST_LIBRARY.openFile(${i.id})" style="font-size:11px;padding:2px 8px">開く</button>` : ''}
        <button class="btn btn-danger" onclick="PAST_LIBRARY.delete(${i.id})" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`).join('');
  },

  async openFile(id) {
    const item = STATE.library.find(i => i.id === id);
    if (!item || !item.storagePath) { UI.toast('ファイル本体がありません','warn'); return; }

    const url = await CLOUD.createSignedUrl(item.storagePath);
    if (!url) { UI.toast('ファイルURLを作成できませんでした','error'); return; }
    window.open(url, '_blank');
  },

  async delete(id) {
    const item = STATE.library.find(i => i.id === id);
    if (!item) return;

    if (!confirm(`過去資料「${item.title}」を削除しますか？`)) return;

    if (item.storagePath) {
      await CLOUD.deleteFile(item.storagePath).catch(()=>{});
    }

    STATE.library=STATE.library.filter(i=>i.id!==id);
    STORE.save();
    this.renderList();
  },

  exportJSON() { STORE.exportJSON(); },

  clearAll() {
    if(confirm('全過去資料を削除しますか？\n※Storage上のファイル本体も削除を試行します。')){
      const paths = (STATE.library || []).map(i=>i.storagePath).filter(Boolean);
      paths.forEach(p => CLOUD.deleteFile(p).catch(()=>{}));
      STATE.library=[];
      STORE.save();
      this.renderList();
    }
  },
};

function fmtFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0B';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)}KB`;
  return `${(n/1024/1024).toFixed(1)}MB`;
}

/* ════════ §25 NAV ══════════════════════════════════════════════ */
const NAV = {
  // メイン画面切替（同期なし、再描画のみ）
  go(el) {
    let view = (el && el.dataset) ? el.dataset.view : (typeof el==='string' ? el : 'dashboard');
    if (!view || !document.getElementById('view-' + view)) view = 'dashboard';
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


/* ════════ §29-A AUTO SYNC（保存・更新時に自動クラウド同期） ════════
   運用方針：
   ・ページを開いた時は CLOUD.pull() でクラウド → ローカルを反映する
   ・CSV取込・削除・補完・計画更新などで STORE.save() が走ったら、自動でクラウドへ保存する
   ・自動保存では syncSmart（双方向同期）を使わない。保存のたびに pull すると重くなり、古いクラウド/ローカルとの再マージで復活事故が起きるため。
   ・自動保存は pushAll（ローカル → クラウド）のみ。削除済みマーカーも full_state/manifest に必ず入る。
*/
const AUTO_SYNC = {
  _timer: null,
  _installed: false,
  _suppress: false,
  _running: false,
  _pending: false,
  _lastError: '',
  delayMs: 1800,

  install() {
    if (this._installed) return;
    if (typeof STORE === 'undefined' || !STORE || STORE._autoSyncInstalled) return;

    const originalSave = STORE.save.bind(STORE);

    STORE.save = (...args) => {
      const result = originalSave(...args);

      // クラウド取得・復元中のローカル保存では、再アップロードを予約しない
      if (!AUTO_SYNC._suppress) {
        AUTO_SYNC.queue('STORE.save');
      }

      return result;
    };

    STORE._autoSyncInstalled = true;
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
}

/* ════════ §30 BOOT ═════════════════════════════════════════════ */
function setupFieldImportYMControls(){}
document.addEventListener('DOMContentLoaded', async () => {
  // 起動停止防止: どこかで初期化が止まっても最大8秒でローディング画面を解除する
  const _bootSafetyTimer = setTimeout(() => {
    try {
      const ov = document.getElementById('app-loading-overlay');
      if (ov) {
        ov.style.opacity = '0';
        setTimeout(() => ov.remove(), 420);
      }
      const banner = document.getElementById('js-error-banner');
      if (banner && !banner.textContent) {
        banner.style.display = 'block';
        banner.textContent = '起動処理が長くなったため、ローディング画面を解除しました。画面が空白の場合はコンソールエラーを確認してください。';
        setTimeout(() => { banner.style.display = 'none'; }, 6000);
      }
    } catch(e) {}
  }, 8000);
  // 0. 画面別モジュール読込（荷主分析など）
  try {
    await loadScreenModules();
  } catch(e) {
    console.warn(e);
    UI.toast('一部画面モジュールの読み込みに失敗しました', 'warn');
  }

  // 1. ローカルストレージから読込
  STORE.load();
  // 削除済みマーカー適用後の状態をローカルへ即保存し、リロード直後の古い補完・計画復活を防ぐ
  STORE.save();

  // 1.5 保存・取込・更新時の自動同期を有効化
  AUTO_SYNC.install();

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

  // 8. 前回ページを復元（F5対応）
  const _lastView = (() => {
    try {
      const v = sessionStorage.getItem('lastView') || 'dashboard';
      return document.getElementById('view-' + v) ? v : 'dashboard';
    } catch(e){ return 'dashboard'; }
  })();

  // 安全弁: 最大8秒でオーバーレイを強制消去
  function _hideOverlay() {
    clearTimeout(_bootSafetyTimer);
    const ov = document.getElementById('app-loading-overlay');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 400);
  }
  const _safetyTimer = setTimeout(() => {
    if (document.getElementById('app-loading-overlay')) _hideOverlay();
  }, 8000);

  // 9. クラウド設定フォームとバッジを初期化
  CLOUD.renderForm();
  UI.updateSaveStatus();

  // ── 画面を即座に表示（Supabase完了を待たない）──
  // キャッシュありなし関係なく、まず画面を出す。
  // Supabaseはバックグラウンドで同期し、完了後にデータを更新する。
  clearTimeout(_safetyTimer);
  NAV.go(_lastView);
  UI.updateTopbar(_lastView);
  _hideOverlay();

  // ── バックグラウンドでSupabase同期 ──
  // 初期描画直後にネットワーク同期を走らせると、画面表示と描画処理を取り合って重く見える。
  // まず画面操作できる状態を優先し、同期は少し遅らせて実行する。
  const runBackgroundPull = () => {
    AUTO_SYNC.withoutSyncAsync(async () => CLOUD.pull())
      .then(r => {
        if (r && r.ok && r.changed) {
          NAV.refresh();
          UI.updateTopbar(STATE.view || _lastView);
          UI.updateSaveStatus();
          UI.toast('クラウドの最新データを反映しました');
        }
      })
      .catch(e => {
        console.warn('[BOOT] Supabase同期失敗:', e?.message || e);
      });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(runBackgroundPull, { timeout: 2500 });
  } else {
    setTimeout(runBackgroundPull, 1200);
  }
});


/* =====================================================================
   現場明細 CSV完全再構築版（field.jsへ分割）
===================================================================== */


  function capacityDailyCauseHtml(row){
    if (!row) return '<div class="capx-empty">対象データがありません</div>';

    const over = Number(row.count || 0) - Number(row.cap || 0);
    const cities = Array.isArray(row.cities) ? row.cities : [];
    const cityHtml = cities.length
      ? cities.map((c,i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(c.city || '')}</span>
            <em>${fmt(c.count || 0)}件</em>
          </div>
        `).join('')
      : '<div class="capx-empty">市区町村内訳なし</div>';

    return `
      <div class="capx-cause-box">
        <div class="capx-cause-head">
          <div>
            <h3>${esc(row.date || '')} / ${esc(row.area || '')}</h3>
            <p>日別超過の原因を、市区町村別の件数で確認します。</p>
          </div>
          <button type="button" class="capx-cause-close" id="capx-cause-close">閉じる</button>
        </div>
        <div class="capx-cause-kpis">
          <div><span>実績</span><b>${fmt(row.count || 0)}件</b></div>
          <div><span>日キャパ</span><b>${fmt(row.cap || 0)}件</b></div>
          <div class="${over > 0 ? 'danger' : 'ok'}"><span>差分</span><b>${over > 0 ? '+' : ''}${fmt(over)}件</b></div>
          <div><span>使用率</span><b>${row.cap > 0 ? pct(row.rate || 0) : '-'}</b></div>
        </div>
        <div class="capx-cause-list">
          ${cityHtml}
        </div>
      </div>
    `;
  }

  function openCapacityDailyCause(key){
    const parts = String(key || '').split('__');
    const date = parts[0] || '';
    const area = parts.slice(1).join('__') || '';

    let rows = [];
    try {
      if (window.CAPACITY_UI && typeof CAPACITY_UI.dailyRows === 'function') {
        rows = CAPACITY_UI.dailyRows();
      }
    } catch(e) {}

    if (!Array.isArray(rows) || !rows.length) {
      rows = window.__CAPACITY_LAST_DAILY_ROWS || [];
    }

    const row = rows.find(r => String(r.date) === date && String(r.area) === area);
    let panel = document.getElementById('capx-cause-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'capx-cause-panel';
      document.body.appendChild(panel);
    }
    panel.innerHTML = capacityDailyCauseHtml(row);
    panel.classList.add('open');

    const close = document.getElementById('capx-cause-close');
    if (close) close.addEventListener('click', ()=>panel.classList.remove('open'));
  }


(function(){
  if (window.__CAPACITY_DAILY_CAUSE_BIND__) return;
  window.__CAPACITY_DAILY_CAUSE_BIND__ = true;
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest ? e.target.closest('[data-capx-daily-detail]') : null;
    if (!btn) return;
    e.preventDefault();
    if (typeof openCapacityDailyCause === 'function') {
      openCapacityDailyCause(btn.getAttribute('data-capx-daily-detail'));
    }
  });
})();


(function(){
  if (document.getElementById('capacity-cause-drill-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-cause-drill-style';
  st.textContent = `
    .capx-mini-detail{
      margin-left:8px;
      border:1px solid #cbd5e1;
      background:#fff;
      color:#1d4ed8;
      border-radius:999px;
      padding:4px 9px;
      font-size:11px;
      font-weight:900;
      cursor:pointer;
    }
    #capx-cause-panel{
      position:fixed;
      right:24px;
      top:84px;
      width:min(460px, calc(100vw - 48px));
      max-height:calc(100vh - 120px);
      overflow:auto;
      z-index:9999;
      display:none;
    }
    #capx-cause-panel.open{display:block;}
    .capx-cause-box{
      background:#fff;
      border:1px solid #dbe3ee;
      border-radius:20px;
      box-shadow:0 24px 60px rgba(15,23,42,.22);
      overflow:hidden;
      color:#0f172a;
      font-family:'Meiryo','Yu Gothic',sans-serif;
    }
    .capx-cause-head{
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:flex-start;
      padding:18px 20px;
      background:#f8fafc;
      border-bottom:1px solid #e5e7eb;
    }
    .capx-cause-head h3{margin:0;font-size:17px;font-weight:950;}
    .capx-cause-head p{margin:5px 0 0;color:#64748b;font-size:12px;font-weight:850;}
    .capx-cause-close{
      border:1px solid #cbd5e1;
      background:#fff;
      border-radius:999px;
      padding:7px 12px;
      font-weight:900;
      cursor:pointer;
      white-space:nowrap;
    }
    .capx-cause-kpis{
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:8px;
      padding:14px;
      background:#fff;
    }
    .capx-cause-kpis>div{
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:10px;
      background:#f8fafc;
    }
    .capx-cause-kpis>div.danger{background:#fef2f2;border-color:#fecaca;}
    .capx-cause-kpis>div.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-cause-kpis span{display:block;color:#64748b;font-size:11px;font-weight:900;margin-bottom:5px;}
    .capx-cause-kpis b{font-size:17px;font-weight:950;}
    .capx-cause-list{display:grid;gap:8px;padding:14px;}
    .capx-cause-row{
      display:grid;
      grid-template-columns:32px 1fr 72px;
      gap:8px;
      align-items:center;
      border:1px solid #eef2f7;
      border-radius:12px;
      padding:9px 10px;
      background:#fff;
    }
    .capx-cause-row b{
      width:24px;height:24px;border-radius:999px;
      background:#eaf3ff;color:#1d4ed8;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;
    }
    .capx-cause-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .capx-cause-row em{text-align:right;font-style:normal;font-weight:950;}
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-decision-ui-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-decision-ui-style';
  st.textContent = `
    .capx-section-head{
      display:flex;
      justify-content:space-between;
      gap:16px;
      align-items:flex-start;
      margin-bottom:12px;
    }
    .capx-mini-detail{
      border:1px solid #cbd5e1;
      background:#fff;
      color:#1d4ed8;
      border-radius:999px;
      padding:5px 10px;
      font-size:12px;
      font-weight:900;
      cursor:pointer;
      white-space:nowrap;
    }
    .capx-weekday-grid{
      display:grid;
      grid-template-columns:repeat(7,minmax(150px,1fr));
      gap:10px;
    }
    .capx-weekday-card{
      border:1px solid #dbe3ee;
      border-radius:18px;
      padding:14px;
      background:#fff;
      box-shadow:0 8px 18px rgba(15,23,42,.045);
      display:grid;
      gap:10px;
    }
    .capx-weekday-card.over{background:#fef2f2;border-color:#fecaca;}
    .capx-weekday-card.full{background:#fff7ed;border-color:#fed7aa;}
    .capx-weekday-card.good{background:#eff6ff;border-color:#bfdbfe;}
    .capx-weekday-card.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-weekday-card.unset{background:#f8fafc;border-color:#cbd5e1;}
    .capx-weekday-top{
      display:flex;
      justify-content:space-between;
      gap:8px;
      align-items:center;
    }
    .capx-weekday-top b{font-size:15px;font-weight:950;}
    .capx-weekday-main strong{display:block;font-size:26px;font-weight:950;line-height:1.1;}
    .capx-weekday-main span{display:block;margin-top:5px;color:#64748b;font-size:12px;font-weight:900;}
    .capx-weekday-sub{display:grid;gap:4px;color:#475569;font-size:12px;font-weight:850;}
    .capx-cause-inner{display:grid;gap:14px;}
    .capx-cause-title h4{margin:0;font-size:17px;font-weight:950;}
    .capx-cause-title p{margin:5px 0 0;color:#64748b;font-size:12px;font-weight:850;}
    .capx-cause-kpis{
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:8px;
    }
    .capx-cause-kpis>div{
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:10px;
      background:#f8fafc;
    }
    .capx-cause-kpis>div.danger{background:#fef2f2;border-color:#fecaca;}
    .capx-cause-kpis>div.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-cause-kpis span{display:block;color:#64748b;font-size:11px;font-weight:900;margin-bottom:5px;}
    .capx-cause-kpis b{font-size:17px;font-weight:950;}
    .capx-cause-inner h5{margin:0;font-size:14px;font-weight:950;}
    .capx-cause-list{display:grid;gap:8px;}
    .capx-cause-row{
      display:grid;
      grid-template-columns:32px 1fr 72px;
      gap:8px;
      align-items:center;
      border:1px solid #eef2f7;
      border-radius:12px;
      padding:9px 10px;
      background:#fff;
    }
    .capx-cause-row b{
      width:24px;height:24px;border-radius:999px;
      background:#eaf3ff;color:#1d4ed8;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;
    }
    .capx-cause-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .capx-cause-row em{text-align:right;font-style:normal;font-weight:950;}
    @media(max-width:1200px){
      .capx-weekday-grid{grid-template-columns:repeat(2,minmax(150px,1fr));}
      .capx-section-head{flex-direction:column;}
    }
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-final-decision-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-final-decision-style';
  st.textContent = `
    .capacity-status.alert{
      background:#fed7aa!important;
      color:#9a3412!important;
      border:1px solid #fdba74!important;
    }
    .capx-risk-alert td{background:#fff7ed!important;}
    .capx-kpi.alert:before{background:#f97316!important;}
    .capx-day.alert{background:#fff7ed!important;}
    .capx-weekday-card.alert{background:#fff7ed!important;border-color:#fdba74!important;}
    .capx-action-box{
      border:1px solid #fed7aa;
      background:#fff7ed;
      border-radius:16px;
      padding:12px 14px;
      display:grid;
      gap:7px;
    }
    .capx-action-box h5{
      margin:0;
      font-size:14px;
      font-weight:950;
      color:#9a3412;
    }
    .capx-action-item{
      font-size:13px;
      font-weight:850;
      color:#7c2d12;
      line-height:1.5;
    }
    .capx-city-hint{
      border:1px solid #bfdbfe;
      background:#eff6ff;
      color:#1e3a8a;
      border-radius:14px;
      padding:12px 14px;
      font-size:13px;
      font-weight:900;
      line-height:1.5;
      margin-bottom:10px;
    }
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-final-color-row-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-final-color-row-style';
  st.textContent = `
    .capacity-status.collapse{
      background:#7f1d1d!important;
      color:#fff!important;
      border:1px solid #7f1d1d!important;
    }
    .capacity-status.over{
      background:#fee2e2!important;
      color:#991b1b!important;
      border:1px solid #fecaca!important;
    }
    .capacity-status.full{
      background:#ffedd5!important;
      color:#9a3412!important;
      border:1px solid #fed7aa!important;
    }
    .capacity-status.good{
      background:#dbeafe!important;
      color:#1e40af!important;
      border:1px solid #bfdbfe!important;
    }
    .capacity-status.ok{
      background:#dcfce7!important;
      color:#166534!important;
      border:1px solid #bbf7d0!important;
    }
    .capacity-status.unset{
      background:#f1f5f9!important;
      color:#64748b!important;
      border:1px solid #cbd5e1!important;
    }
    .capx-risk-collapse td{background:#fff1f2!important;}
    .capx-risk-over td{background:#fff7f7!important;}
    .capx-risk-full td{background:#fffaf0!important;}
    .capx-risk-good td{background:#eff6ff!important;}
    .capx-risk-ok td{background:#f0fdf4!important;}
    .capx-risk-unset td{background:#f8fafc!important;}
    .capx-click-row{cursor:pointer;}
    .capx-click-row:hover td{outline:1px solid #bfdbfe;background:#eff6ff!important;}
    .capx-click-row.selected td{
      background:#eaf3ff!important;
      box-shadow:inset 4px 0 0 #2563eb;
    }
    .capx-cal-summary{
      display:flex;
      gap:8px;
      align-items:center;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    .capx-cal-summary span{
      display:inline-flex;
      border-radius:999px;
      border:1px solid #cbd5e1;
      background:#fff;
      padding:7px 10px;
      font-size:12px;
      font-weight:950;
      color:#334155;
    }
    .capx-cal-summary span.danger{background:#fee2e2;color:#991b1b;border-color:#fecaca;}
    .capx-cal-summary span.full{background:#fff7ed;color:#9a3412;border-color:#fed7aa;}
    .capx-cal-summary span.good{background:#eff6ff;color:#1e40af;border-color:#bfdbfe;}
    .capx-cause-kpis>div.danger{background:#fef2f2!important;border-color:#fecaca!important;}
    .capx-cause-kpis>div.ok{background:#ecfdf5!important;border-color:#bbf7d0!important;}
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-diff-focus-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-diff-focus-style';
  st.textContent = `
    .capx-diff{
      display:inline-flex;
      justify-content:flex-end;
      min-width:54px;
      font-weight:950;
      font-size:14px;
    }
    .capx-diff.plus{
      color:#991b1b;
    }
    .capx-diff.minus{
      color:#166534;
    }
    .capx-cause-kpis div:nth-child(3){
      background:#fef2f2;
      border-color:#fecaca;
    }
    .capx-kpi.amber em{
      line-height:1.35;
    }
  `;
  document.head.appendChild(st);
})();
