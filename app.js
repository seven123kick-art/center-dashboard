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
  },
  async pdfjs(){
    await this.loadScript('pdfjs', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return !!window.pdfjsLib;
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
  areaData:  [],    // CSV：荷主別配送エリア別物量 [{ym,shipper,zip,address,area,count,...}]
  capacity:  null,  // {areas:{name:{max}},updatedAt}
  planData:  {},    // 年度別計画データ { "2026": { rows, importedAt, itemCount } }
  fiscalYear: null, // 現在操作中の年度
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
    STATE.areaData  = this._g('areaData')  || [];
    STATE.capacity  = this._g('capacity')  || null;
    STATE.planData  = normalizePlanData(this._g('planData'));
    STATE.memos     = this._g('memos')     || {};
    STATE.library   = this._g('library')   || [];
  },

  save() {
    this._s('datasets',  STATE.datasets);
    this._s('fieldData', STATE.fieldData);
    this._s('areaData',  STATE.areaData);
    this._s('capacity',  STATE.capacity);
    this._s('planData',  STATE.planData);
    this._s('memos',     STATE.memos);
    this._s('library',   STATE.library);
  },

  exportJSON() {
    const blob = new Blob([JSON.stringify({
      center:CENTER.id, exportedAt:new Date().toISOString(),
      datasets:STATE.datasets, fieldData:STATE.fieldData, areaData:STATE.areaData,
      capacity:STATE.capacity, planData:STATE.planData, memos:STATE.memos, library:STATE.library,
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

  const idx = STATE.datasets.findIndex(d => d.ym === ds.ym && (d.type || 'confirmed') === type);
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
    const pdf  = arr.filter(f=>/\.pdf$/i.test(f.name));

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
    if (pdf.length)  { UI.toast('PDF取込は廃止しました。現場明細はCSVを取り込んでください。','warn'); return; }
    UI.toast('対応形式：CSV（収支）・XLSX（キャパ）','warn');
  },

  async processCSV(files, ym, opt={}) {
    const mm = ym.slice(4,6);
    const monthCol = CONFIG.PLAN_MONTH_COLS[mm] ?? null;
    const selectedType = document.querySelector('input[name="manual-import-type"]:checked')?.value;
    const importType = selectedType === 'daily' ? 'daily' : 'confirmed';
    const existing = STATE.datasets.find(d => d.ym === ym && (d.type || 'confirmed') === importType);

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
        STATE.datasets = STATE.datasets.filter(d => !(d.ym === ym && (d.type || 'confirmed') === type));
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

  deleteDataset(ym, type) {
    type = type || 'confirmed';
    const ds = STATE.datasets.find(d=>d.ym===ym && (d.type || 'confirmed') === type);
    const typeLabel = type === 'daily' ? '速報' : '確定';
    const detail = ds ? `\n区分：${typeLabel}\n${ds.fileName || 'ファイル名なし'}\n収入 ${fmtK(ds.totalIncome)}千円` : '';
    if (!confirm(`${ymLabel(ym)}の${typeLabel}データを削除しますか？${detail}`)) return;
    STATE.datasets = STATE.datasets.filter(d=>!(d.ym===ym && (d.type || 'confirmed') === type));
    STORE.save();
    NAV.refresh();
    UI.toast(`${ymLabel(ym)}の${typeLabel}データを削除しました`);
  },

  replaceDataset(ym, type) {
    type = type || 'confirmed';
    const ds = STATE.datasets.find(d=>d.ym===ym && (d.type || 'confirmed') === type);
    if (!ds) { UI.toast('入替対象データが見つかりません','warn'); return; }

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
  _fullStateKey() { return `${CENTER.id}/full_state.json`; },
  _planKey() { return `${CENTER.id}/plan/data.json`; },
  _memosKey() { return `${CENTER.id}/memos/data.json`; },
  _libraryKey() { return `${CENTER.id}/library/data.json`; },
  _libraryFileKey(fileName, fy='unknown') {
    const safe = String(fileName || 'file').replace(/[\\/:*?"<>|#%&{}$!@+=`' ]/g, '_');
    return `${CENTER.id}/library_files/${fy}/${Date.now()}_${safe}`;
  },
  _legacyKey() { return `${CENTER.id}/data_v5.json`; },
  _makeManifest() {
    return {
      version: 6,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      datasets: STATE.datasets.map(d => ({ ym:d.ym, type:d.type, importedAt:d.importedAt || null, totalIncome:d.totalIncome || 0, totalExpense:d.totalExpense || 0, profit:d.profit || 0 })),
      hasCapacity: !!STATE.capacity,
      hasFieldData: !!(STATE.fieldData && STATE.fieldData.length),
      hasPlanData: !!(STATE.planData && Object.keys(STATE.planData).length),
      planDataUpdatedAt: latestPlanUpdatedAt(),
      hasMemos: !!(STATE.memos && Object.keys(STATE.memos).length),
      hasLibrary: !!(STATE.library && STATE.library.length),
    };
  },
  _makeFullState() {
    return {
      version: 15,
      center: CENTER.id,
      savedAt: new Date().toISOString(),
      datasets: STATE.datasets || [],
      fieldData: STATE.fieldData || [],
      areaData: STATE.areaData || [],
      capacity: STATE.capacity || null,
      planData: STATE.planData || {},
      fiscalYear: STATE.fiscalYear || null,
      memos: STATE.memos || {},
      library: STATE.library || [],
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
    if (typeof AUTO_SYNC !== 'undefined') {
      AUTO_SYNC.withoutSync(() => STORE.save());
    } else {
      STORE.save();
    }
    return true;
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
      const targets = STATE.datasets.filter(d => d.ym === ym);
      if (!targets.length) return { ok:false, error:'対象月データなし' };
      for (const ds of targets) await this._uploadJSON(this._datasetKey(ym, ds.type || 'confirmed'), ds);
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
      for (const ds of STATE.datasets) await this._uploadJSON(this._datasetKey(ds.ym, ds.type || 'confirmed'), ds);
      if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
      if (STATE.fieldData && STATE.fieldData.length) await this._uploadJSON(this._fieldKey(), STATE.fieldData);
      if (STATE.planData && Object.keys(STATE.planData).length) await this._uploadJSON(this._planKey(), STATE.planData);
      if (STATE.memos && Object.keys(STATE.memos).length) await this._uploadJSON(this._memosKey(), STATE.memos);
      if (STATE.library && STATE.library.length) await this._uploadJSON(this._libraryKey(), STATE.library);
      await this._uploadJSON(this._manifestKey(), this._makeManifest());
      await this._uploadJSON(this._fullStateKey(), this._makeFullState());
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
      const metaType = meta.type || 'confirmed';
      const local = STATE.datasets.find(d => d.ym === meta.ym && (d.type || 'confirmed') === metaType);
      if (!local || String(meta.importedAt||'') > String(local.importedAt||'')) {
        const ds = await this._downloadJSON(this._datasetKey(meta.ym, metaType));
        if (ds && ds.ym) { upsertDataset(ds); changed++; }
      }
    }
    if (manifest.hasCapacity && !STATE.capacity) {
      const cap = await this._downloadJSON(this._capacityKey());
      if (cap) { STATE.capacity = cap; changed++; }
    }

    if (manifest.hasFieldData) {
      const field = await this._downloadJSON(this._fieldKey());
      if (Array.isArray(field)) { STATE.fieldData = field; changed++; }
    }

    if (manifest.hasPlanData) {
      const cloudPlan = await this._downloadJSON(this._planKey());
      if (cloudPlan && typeof cloudPlan === 'object') {
        STATE.planData = mergePlanDataByUpdatedAt(STATE.planData, cloudPlan);
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

      // 一度適用してから、manifest/skdlの月別データも必ず取得
      this._applyFullState(mergedBase);
      this._busy = false;
      const manifestResult = await this.pullManifestAndMissing();
      this._busy = true;

      // manifest取得後の最新STATEを full_state として再保存
      const finalFull = this._makeFullState();
      await this._uploadJSON(this._fullStateKey(), finalFull);

      if (STATE.planData && Object.keys(STATE.planData).length) await this._uploadJSON(this._planKey(), STATE.planData);
      if (STATE.capacity) await this._uploadJSON(this._capacityKey(), STATE.capacity);
      if (STATE.fieldData && STATE.fieldData.length) await this._uploadJSON(this._fieldKey(), STATE.fieldData);
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

function dashboardAvailableFiscalYears() {
  const set = new Set();
  for (const d of activeDatasets()) {
    if (d && d.ym) set.add(fiscalYearFromYM(d.ym));
  }
  const latest = latestDS();
  if (latest && latest.ym) set.add(fiscalYearFromYM(latest.ym));
  set.add(getDefaultFiscalYear());
  return [...set].sort((a,b)=>parseInt(b,10)-parseInt(a,10));
}
function dashboardSelectedFiscalYear() {
  if (STATE.fiscalYear) return String(STATE.fiscalYear);
  const latest = latestDS();
  return latest && latest.ym ? fiscalYearFromYM(latest.ym) : getDefaultFiscalYear();
}
function dashboardSelectedYM() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const validMonths = months.filter(ym => activeDatasetByYM(ym));
  if (STATE.selYM && months.includes(STATE.selYM) && activeDatasetByYM(STATE.selYM)) return STATE.selYM;
  const latestInFY = validMonths.length ? validMonths[validMonths.length - 1] : null;
  if (latestInFY) {
    STATE.selYM = latestInFY;
    return latestInFY;
  }
  const latest = latestDS();
  if (latest && latest.ym) {
    STATE.fiscalYear = fiscalYearFromYM(latest.ym);
    STATE.selYM = latest.ym;
    return latest.ym;
  }
  return null;
}
function selectedDashboardDS() {
  const ym = dashboardSelectedYM();
  return ym ? activeDatasetByYM(ym) : latestDS();
}


function selectedYMForImport() {
  // 取込時の年月は画面で選択している年度・月を最優先にする。
  // CSV内の日付は補助情報としてのみ使う。
  return dashboardSelectedYM() || STATE.selYM || latestDS()?.ym || null;
}

function selectedFiscalYearForImport() {
  return dashboardSelectedFiscalYear() || STATE.fiscalYear || getDefaultFiscalYear();
}

function dashboardDatasetsForSelectedFiscalYear() {
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  return months.map(ym => activeDatasetByYM(ym)).filter(Boolean);
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

  const useMonth = opt.useMonth !== false;
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
        <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / ${useMonth?'年度・月を共通管理':'年度累計表示'}</div>
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
    const ds = activeDatasetByYM(ym);
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
    const list = monthsOfFiscalYear(STATE.fiscalYear).filter(ym => activeDatasetByYM(ym));
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
function renderPLPeriodSelector() {
  const tbody = document.getElementById('pl-tbody');
  if (!tbody) return;

  const tableCard = tbody.closest('.card') || tbody.closest('section') || tbody.parentElement?.parentElement;
  if (!tableCard || !tableCard.parentNode) return;

  let box = document.getElementById('pl-period-selector');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pl-period-selector';
    tableCard.parentNode.insertBefore(box, tableCard);
  }

  const years = dashboardAvailableFiscalYears();
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const selectedYM = dashboardSelectedYM();
  const monthOptions = months.map(ym => {
    const ds = activeDatasetByYM(ym);
    const label = ds ? `${ymLabel(ym)}（${datasetKindLabel(ds)}）` : `${ymLabel(ym)}（未登録）`;
    return `<option value="${ym}" ${ym===selectedYM?'selected':''} ${ds?'':'disabled'}>${label}</option>`;
  }).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
      <div>
        <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">表示対象</div>
        <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / 月次収支表を切替</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
          <select id="pl-fy-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800">
            ${years.map(y=>`<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
          <select id="pl-ym-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:190px">
            ${monthOptions || '<option value="">データなし</option>'}
          </select>
        </label>
      </div>
    </div>`;

  const fySel = document.getElementById('pl-fy-select');
  const ymSel = document.getElementById('pl-ym-select');
  if (fySel) fySel.onchange = () => {
    STATE.fiscalYear = fySel.value;
    const list = monthsOfFiscalYear(STATE.fiscalYear).filter(ym => activeDatasetByYM(ym));
    STATE.selYM = list.length ? list[list.length - 1] : null;
    renderPL();
    UI.updateTopbar('pl');
  };
  if (ymSel) ymSel.onchange = () => {
    if (ymSel.value) STATE.selYM = ymSel.value;
    renderPL();
    UI.updateTopbar('pl');
  };
}

function latestDS() {
  const list = activeDatasets();
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
  return {
    version: 15,
    center: CENTER.id,
    savedAt: new Date().toISOString(),
    datasets: mergeDatasetsByImportedAt(local.datasets || [], cloud.datasets || []),
    fieldData: (cloud.fieldData && cloud.fieldData.length) ? cloud.fieldData : (local.fieldData || []),
    areaData: (cloud.areaData && cloud.areaData.length) ? cloud.areaData : (local.areaData || []),
    capacity: cloud.capacity || local.capacity || null,
    planData: mergePlanDataByUpdatedAt(local.planData || {}, cloud.planData || {}),
    fiscalYear: local.fiscalYear || cloud.fiscalYear || null,
    memos: { ...(local.memos || {}), ...(cloud.memos || {}) },
    library: (cloud.library && cloud.library.length) ? cloud.library : (local.library || []),
  };
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
const PL_TOGGLE = {
  _open: {},
  isOpen(id) {
    return !!this._open[id];
  },
  toggle(id) {
    this._open[id] = !this._open[id];
    renderPL();
  }
};

function ensurePLStyle() {
  if (document.getElementById('pl-fold-style')) return;
  const style = document.createElement('style');
  style.id = 'pl-fold-style';
  style.textContent = `
    #pl-tbl .col-current { background:#eef6ff; }
    #pl-tbl .col-plan { background:#fff8e1; }
    #pl-tbl .col-prev { background:#f5f6f8; border-left:4px solid #94a3b8; }
    #pl-tbl .col-lastyear { background:#fff1f7; border-left:4px solid #d946ef; }
    #pl-tbl .pl-group-row td { background:#f8fafc; border-top:1px solid #cbd5e1; }
    #pl-tbl .pl-child-row td { font-size:12px; color:#475569; }
    #pl-tbl .pl-total-row td { background:#eef2f7; font-weight:900; border-top:2px solid #94a3b8; }
    #pl-tbl .pl-profit-row td { background:#ecfdf5; font-weight:900; border-top:2px solid #16a34a; }
    #pl-tbl .pl-fold-btn {
      width:22px;
      height:22px;
      border:1px solid #94a3b8;
      border-radius:6px;
      background:#fff;
      color:#1a4d7c;
      font-weight:900;
      line-height:18px;
      margin-right:7px;
      cursor:pointer;
      box-shadow:0 1px 2px rgba(15,23,42,.08);
    }
    #pl-tbl .pl-fold-spacer { display:inline-block; width:32px; }
    #pl-tbl .pl-child-label { color:#475569; }
  `;
  document.head.appendChild(style);
}

function renderPL() {
  ensurePLStyle();

  const notice = document.getElementById('pl-notice');
  const tbody  = document.getElementById('pl-tbody');
  if (!tbody) return;

  renderPLPeriodSelector();

  const ds = selectedDashboardDS();
  if (!ds) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">データがありません</div>';
    tbody.innerHTML = '';
    return;
  }
  if (notice) notice.innerHTML = '';

  const prev = prevDS(ds.ym);
  const py   = sameMonthLastYear(ds.ym);
  const fy   = fiscalYearFromYM(ds.ym);
  const mm   = ds.ym.slice(4,6);
  const plan = getPlanRowsForFiscalYear(fy);

  function valueFromRows(dataSet, keys) {
    if (!dataSet) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.reduce((sum, key) => sum + n(dataSet.rows?.[key] ?? 0), 0);
  }

  function planValue(label, keys) {
    if (!plan) return null;

    if (label === '売上原価') {
      const direct = readPlanValueByLabel(plan, '売上原価', mm);
      if (direct != null) return direct;
      return CONFIG.PL_DEF
        .filter(d => d.type === 'group' && d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(plan, d.label, mm, d.keys) || 0), 0);
    }

    if (label === '粗利益') {
      const direct = readPlanValueByLabel(plan, '粗利益', mm);
      if (direct != null) return direct;
      const revenue = getPlanValueK(plan, '営業収益', mm, CONFIG.PL_DEF.find(d=>d.id==='revenue')?.keys || CONFIG.INCOME_KEYS) || 0;
      const cost = CONFIG.PL_DEF
        .filter(d => d.type === 'group' && d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(plan, d.label, mm, d.keys) || 0), 0);
      return revenue - cost;
    }

    return getPlanValueK(plan, label, mm, keys);
  }

  const totalRevenue = ds.totalIncome || valueFromRows(ds, CONFIG.INCOME_KEYS) || 0;
  const totalCost    = ds.totalExpense || valueFromRows(ds, CONFIG.EXPENSE_KEYS) || 0;
  const totalGross   = totalRevenue - totalCost;

  const prevRevenue = prev ? (prev.totalIncome || valueFromRows(prev, CONFIG.INCOME_KEYS) || 0) : null;
  const prevCost    = prev ? (prev.totalExpense || valueFromRows(prev, CONFIG.EXPENSE_KEYS) || 0) : null;
  const prevGross   = prev ? (prevRevenue - prevCost) : null;

  const pyRevenue = py ? (py.totalIncome || valueFromRows(py, CONFIG.INCOME_KEYS) || 0) : null;
  const pyCost    = py ? (py.totalExpense || valueFromRows(py, CONFIG.EXPENSE_KEYS) || 0) : null;
  const pyGross   = py ? (pyRevenue - pyCost) : null;

  const rows = [];

  for (const def of CONFIG.PL_DEF) {
    if (def.type === 'group') {
      const actual = def.id === 'revenue' ? totalRevenue : valueFromRows(ds, def.keys);
      const prevV  = def.id === 'revenue' ? prevRevenue : valueFromRows(prev, def.keys);
      const pyV    = def.id === 'revenue' ? pyRevenue : valueFromRows(py, def.keys);
      const planV  = planValue(def.label, def.keys);
      const open   = PL_TOGGLE.isOpen(def.id);

      rows.push(makePLRow({
        label: def.label,
        value: actual,
        base: totalRevenue,
        planV,
        prevV,
        pyV,
        bold: true,
        groupId: def.id,
        open,
        rowClass: 'pl-group-row'
      }));

      if (open && Array.isArray(def.children)) {
        for (const child of def.children) {
          const childActual = valueFromRows(ds, child.keys);
          const childPrev   = valueFromRows(prev, child.keys);
          const childPy     = valueFromRows(py, child.keys);
          const childPlan   = planValue(child.label, child.keys);

          if (!childActual && !childPrev && !childPy && !childPlan) continue;

          rows.push(makePLRow({
            label: child.label,
            value: childActual,
            base: totalRevenue,
            planV: childPlan,
            prevV: childPrev,
            pyV: childPy,
            bold: false,
            child: true,
            rowClass: 'pl-child-row'
          }));
        }
      }

      continue;
    }

    if (def.type === 'total-cost') {
      rows.push(makePLRow({
        label: def.label,
        value: totalCost,
        base: totalRevenue,
        planV: planValue('売上原価', CONFIG.EXPENSE_KEYS),
        prevV: prevCost,
        pyV: pyCost,
        bold: true,
        total: true,
        rowClass: 'pl-total-row'
      }));
      continue;
    }

    if (def.type === 'gross-profit') {
      rows.push(makePLRow({
        label: def.label,
        value: totalGross,
        base: totalRevenue,
        planV: planValue('粗利益', []),
        prevV: prevGross,
        pyV: pyGross,
        bold: true,
        total: true,
        rowClass: 'pl-profit-row'
      }));
      continue;
    }
  }

  tbody.innerHTML = rows.join('');

  const title = document.getElementById('pl-card-title');
  if (title) title.textContent = `月次収支表（${ymLabel(ds.ym)}・${datasetKindLabel(ds)}）`;
}

function makePLRow(opt) {
  const label = opt.label || '';
  const v = n(opt.value);
  const base = n(opt.base);
  const planK = opt.planV != null ? opt.planV : null;
  const prevV = opt.prevV != null ? opt.prevV : null;
  const pyV = opt.pyV != null ? opt.pyV : null;
  const boldStyle = opt.bold ? 'font-weight:900' : '';
  const rowClass = opt.rowClass || '';
  const rat = base && base > 0 ? pct(v / base * 100) : '—';

  let labelHtml = esc(label);
  if (opt.groupId) {
    const mark = opt.open ? '－' : '＋';
    labelHtml = `<button class="pl-fold-btn" onclick="PL_TOGGLE.toggle('${esc(opt.groupId)}')">${mark}</button>${esc(label)}`;
  } else if (opt.child) {
    labelHtml = `<span class="pl-fold-spacer"></span><span class="pl-child-label">└ ${esc(label)}</span>`;
  } else if (opt.total) {
    labelHtml = `<span class="pl-fold-spacer"></span>${esc(label)}`;
  }

  const planDiffClass = planK != null ? (v >= planK * 1000 ? 'cell-up' : 'cell-down') : '';
  const prevDiffClass = prevV != null ? (v >= prevV ? 'cell-up' : 'cell-down') : '';
  const pyDiffClass   = pyV != null ? (v >= pyV ? 'cell-up' : 'cell-down') : '';

  return `<tr class="${rowClass}">
    <td style="${boldStyle}">${labelHtml}</td>
    <td class="r col-current" style="${boldStyle}">${fmtK(v)}</td>
    <td class="r col-current">${rat}</td>
    <td class="r col-plan">${planK!=null?fmt(planK):'—'}</td>
    <td class="r col-plan ${planDiffClass}">${planK!=null?diff(v,planK*1000):'—'}</td>
    <td class="r col-plan">${planK!=null?ratio(v,planK*1000):'—'}</td>
    <td class="r col-prev">${prevV!=null?fmtK(prevV):'—'}</td>
    <td class="r col-prev ${prevDiffClass}">${prevV!=null?diff(v,prevV):'—'}</td>
    <td class="r col-prev">${prevV!=null?ratio(v,prevV):'—'}</td>
    <td class="r col-lastyear">${pyV!=null?fmtK(pyV):'—'}</td>
    <td class="r col-lastyear ${pyDiffClass}">${pyV!=null?diff(v,pyV):'—'}</td>
    <td class="r col-lastyear">${pyV!=null?ratio(v,pyV):'—'}</td>
  </tr>`;
}


/* ════════ §14 RENDER — Trend ══════════════════════════════════ */
function renderTrend() {
  const notice = document.getElementById('trend-notice');
  renderCommonPeriodSelector('trend');

  const list = datasetsForSelectedFiscalYear();
  if (!list.length) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
    return;
  }
  if (notice) notice.innerHTML = '';

  const labels = list.map(d=>ymLabel(d.ym));
  const inc = list.map(d=>d.totalIncome/1000);
  const exp = list.map(d=>d.totalExpense/1000);
  const prf = list.map(d=>d.profit/1000);

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

  const tbody = document.getElementById('trend-tbody');
  if (tbody) {
    const rows = [...list].reverse().map((d,i,arr)=>{
      const prev = i<arr.length-1 ? arr[i+1] : null;
      return `<tr>
        <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
        <td class="r">${fmtK(d.totalIncome)}</td><td class="r">${fmtK(d.totalExpense)}</td>
        <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
        <td class="r">${pct(d.profitRate)}</td>
        <td class="r">—</td>
        <td class="r">${ratio(d.totalIncome,prev?.totalIncome)}</td>
        <td class="r">${ratio(d.totalIncome,sameMonthLastYear(d.ym)?.totalIncome)}</td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');
  }
}

/* ════════ §15 RENDER — Shipper ════════════════════════════════ */
function renderShipper() {
  renderCommonPeriodSelector('shipper');

  const ds = selectedDatasetInSelectedFiscalYear();
  const chartEl = document.getElementById('c-shipper-bar');
  const hasShippers = ds && ds.shippers && Object.keys(ds.shippers).length > 0;

  const noticeId = 'shipper-notice';
  let noticeEl = document.getElementById(noticeId);
  if (!noticeEl) {
    const view = document.getElementById('view-shipper');
    if (view) { noticeEl=document.createElement('div'); noticeEl.id=noticeId; view.prepend(noticeEl); }
  }
  if (!hasShippers && noticeEl) {
    noticeEl.innerHTML = '<div class="msg msg-info" style="margin-bottom:14px">選択月の荷主別データがありません。荷主コード付きCSVを取り込むと荷主分析が表示されます。</div>';
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

  const ds = selectedDatasetInSelectedFiscalYear();
  const fyList = datasetsForSelectedFiscalYear();

  if (!ds) {
    view.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
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
      <div class="card"><div class="card-header"><span class="card-title">固定費 / 変動費　構成（選択月）</span></div>
        <div class="card-body">
          ${gauge(ds.fixedRate, 50, 65, '%', true)}
          ${gauge(ds.variableRate, T.variableRateMax, 90, '%', true)}
          <div style="font-size:12px;color:var(--text2);line-height:1.8">
            固定費：${fmtK(ds.fixedCost)}千円 / 変動費：${fmtK(ds.varCost)}千円
          </div>
        </div></div>
      <div class="card"><div class="card-header"><span class="card-title">損益分岐点　簡易判定（選択月）</span></div>
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

  renderCommonPeriodSelector('indicators');

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

  if (!list.length) {
    if (kpi) kpi.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="8" style="padding:16px;color:var(--text3);text-align:center">選択年度のデータがありません</td></tr>';
    return;
  }

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

  async importAreaCsv(files) {
    await AREA_CSV_IMPORT.handleFiles(files);
    this.populateYMSel();
    this.render();
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
  return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${fg};font-weight:900;font-size:11px">${text}</span>`;
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
  const fieldRows = (STATE.fieldData || []).filter(d => !d.ym || storageFiscalMonths(fy).includes(d.ym));
  const shipperRows = csvRows.filter(d => d.shippers && Object.keys(d.shippers).length);
  const warnings = storageWarnings(fy);

  const years = new Set([String(fy), getDefaultFiscalYear()]);
  (STATE.datasets || []).forEach(d => years.add(String(d.fiscalYear || fiscalYearFromYM(d.ym))));
  if (STATE.planData && typeof STATE.planData === 'object') {
    Object.keys(STATE.planData).forEach(y => /^\d{4}$/.test(y) && years.add(y));
  }
  const yearOptions = [...years].sort().reverse().map(y => `<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('');

  const tableRows = [
    ['収支実績CSV', `${fy}年度`, (monthsConfirmed||monthsDaily)?storageBadge('登録済','ok'):storageBadge('未登録','warn'), `確定 ${monthsConfirmed}ヶ月 / 速報 ${monthsDaily}ヶ月`, '円', formatImportedAt(storageLatestAt(csvRows)), 'SKDL0001/0003。速報と確定は両方保持。表示は確定優先。', '月別一覧から入替/削除'],
    ['計画データ', `${fy}年度`, plan?storageBadge('登録済','ok'):storageBadge('未登録','warn'), plan?`${Object.keys(plan).length}科目 / 合計 ${fmt(storagePlanAllTotal(plan))}千円`:'0科目', '千円', formatImportedAt(planPack?.importedAt), '年度単位で完全独立。取込時は年度丸ごと入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deletePlan('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['収支補完', `${fy}年度`, histMonths?storageBadge('登録済','ok'):storageBadge('未登録','warn'), histMonths?`${histMonths}ヶ月 / 収入 ${fmt(histRows.reduce((s,d)=>s+storageAmountK(d,'totalIncome'),0))}千円`:'0ヶ月', '千円', formatImportedAt(storageLatestAt(histRows)), 'SKKS月次収支照会の貼付。年度単位で完全入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteHistory('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['エリア補完', `${fy}年度`, fieldRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), fieldRows.length?`${fieldRows.length}件`:'0件', '件数', '—', '作業者別現場CSV由来。今後、年度別保管に拡張。', '今後実装'],
    ['荷主別データ', `${fy}年度`, shipperRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), shipperRows.length?`${shipperRows.length}ヶ月`:'0ヶ月', '円', formatImportedAt(storageLatestAt(shipperRows)), '荷主別CSVまたはSKDL内の荷主情報。未取込なら荷主分析は出ません。', '今後実装'],
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
  deletePlan(fy){
    if (!STATE.planData || !STATE.planData[fy]) { UI.toast(`${fy}年度の計画データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の計画データを削除しますか？\n他年度は削除しません。`)) return;
    delete STATE.planData[fy];
    STORE.save();
    NAV.refresh();
    UI.toast(`${fy}年度の計画データを削除しました`);
  },
  deleteHistory(fy){
    const rows = (STATE.datasets || []).filter(d => storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (!rows.length) { UI.toast(`${fy}年度の収支補完データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の収支補完データ ${rows.length}件を削除しますか？\n通常CSVは削除しません。`)) return;
    STATE.datasets = (STATE.datasets || []).filter(d => !(storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));
    STORE.save();
    NAV.refresh();
    UI.toast(`${fy}年度の収支補完データを削除しました`);
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
        <button class="btn" onclick="IMPORT.replaceDataset('${ds.ym}','${ds.type || 'confirmed'}')" style="font-size:11px;padding:2px 8px">入替</button>
        <button class="btn btn-danger" onclick="IMPORT.deleteDataset('${ds.ym}','${ds.type || 'confirmed'}')" style="font-size:11px;padding:2px 8px">削除</button>
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
    const selected = selectedFieldDataInSelectedFiscalYear();
    if (badge) badge.textContent = selected
      ? `${ymLabel(selected.ym)} 読込済`
      : 'データ未読込';
  },
  renderDataList() {
    renderCommonPeriodSelector('field');
    const list = document.getElementById('field-data-list');
    if (!list) return;
    const rows = fieldDataForSelectedFiscalYear();
    list.innerHTML = rows.length
      ? rows.map(d=>`<div class="data-item">${ymLabel(d.ym)}</div>`).join('')
      : '<div style="padding:12px 16px;font-size:12px;color:var(--text3)">選択年度の現場明細データがありません</div>';
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
    delete STATE.planData[fy];
    STORE.save();
    const msg = document.getElementById('plan-import-msg');
    if (msg) msg.textContent = `${fy}年度の計画データを削除しました`;
    renderImport();
    NAV.refresh();
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
    UI.toast(`${fy}年度 収支補完 ${imported}ヶ月を完全入替しました`);
  },
  doClearHistory() {
    const fy = getSelectedFiscalYear('tsv-year-sel-history');
    const rows = STATE.datasets.filter(d => d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (!rows.length) { UI.toast(`${fy}年度の収支補完データは未登録です`, 'warn'); return; }
    if (!confirm(`${fy}年度の収支補完データ ${rows.length}件を削除しますか？\n※通常CSVで取り込んだデータは削除しません。`)) return;
    const before = STATE.datasets.length;
    STATE.datasets = STATE.datasets.filter(d => !(d.source === 'history' && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));
    STORE.save();
    const deleted = before - STATE.datasets.length;
    renderImport();
    NAV.refresh();
    UI.toast(`${fy}年度 収支補完 ${deleted}件を削除しました`);
  }
};

// 現場データ取込2（インポート画面の2つ目のゾーン）

/* ════════ §27-A FIELD CSV IMPORT（現場明細CSV） ════════
   対象：
   1) 作業者別CSV
   2) 荷主別配送エリア別物量CSV（商品・住所・商品サイズ・科目・原票番号）

   方針：CSV取込は廃止。CSVだけを現場データとして取り込む。
   ・エスライン原票番号の重複を検出
   ・重複で件数が膨らまないよう、エリア件数は原票番号のユニーク件数で集計
   ・商品名型番、住所、サイズ別数量、作業内容/コードを保持
════════════════════════════════════════════════════════════════ */
const AREA_CSV_IMPORT = {
  async handleFiles(files) {
    const arr = Array.from(files || []);
    const csvs = arr.filter(f => /\.csv$/i.test(f.name));
    const others = arr.filter(f => !/\.csv$/i.test(f.name));

    if (others.length) {
      UI.toast('現場データはCSVのみ取込できます。CSV取込は廃止しました。', 'warn');
    }
    if (!csvs.length) return;

    for (const csv of csvs) await this.importCsv(csv);

    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
    if (FIELD_UI && FIELD_UI.updatePeriodBadge) FIELD_UI.updatePeriodBadge();
    NAV.refresh();
  },

  async importCsv(file) {
    const ym = selectedYMForImport();
    if (!ym) throw new Error('取込年月を選択してください');

    UI.toast('現場明細CSVを解析中です...');
    const text = await CSV.read(file);
    const rows = CSV.toRows(text);
    if (!rows || rows.length < 2) {
      UI.toast(`${file.name}: CSVの明細行がありません`, 'warn');
      return;
    }

    const parsed = this.parseCsvRows(rows, file.name, ym);
    if (!parsed.records.length) {
      UI.toast(`${file.name}: 現場明細として読める行がありません`, 'warn');
      return;
    }

    this.saveParsed(parsed);
    STORE.save();

    const dupText = parsed.duplicateSlipCount
      ? ` / 重複原票 ${fmt(parsed.duplicateSlipCount)}件`
      : ' / 重複原票 0件';

    UI.toast(
      `${ymLabel(parsed.ym)} ${parsed.kindLabel}取込完了：` +
      `${fmt(parsed.recordCount)}行 / 原票${fmt(parsed.uniqueSlipCount)}件${dupText}`
    );
  },

  parseCsvRows(rows, fileName, ym) {
    const header = rows[0].map(h => normalizeHeaderName(h));
    const idx = makeHeaderIndex(header);

    const hasSlip = idx('エスライン原票番号') >= 0 || idx('原票番号') >= 0;
    const hasProduct = idx('商品名型番') >= 0 || idx('商品名') >= 0;
    const hasAddress = idx('住所') >= 0 || idx('お届け先住所') >= 0;
    const isAreaDetail = hasSlip || hasProduct || hasAddress;

    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.some(v => String(v || '').trim())) continue;

      if (isAreaDetail) {
        const rec = this.parseAreaDetailRow(row, idx, ym, fileName, r + 1);
        if (rec) records.push(rec);
      } else {
        const rec = this.parseWorkerRow(row, idx, ym, fileName, r + 1, header);
        if (rec) records.push(rec);
      }
    }

    const duplicate = analyzeSlipDuplicates(records);
    for (const rec of records) {
      const key = rec.slipNo || '';
      rec.duplicateSlipCount = key && duplicate.countBySlip[key] ? duplicate.countBySlip[key] : 0;
      rec.isDuplicateSlip = rec.duplicateSlipCount > 1;
    }

    const uniqueSlipCount = countUniqueSlips(records);

    return {
      ym,
      source: isAreaDetail ? 'area_csv' : 'worker_csv',
      kind: isAreaDetail ? 'area_detail_csv' : 'worker_csv',
      kindLabel: isAreaDetail ? '商品・住所CSV' : '作業者別CSV',
      fileName,
      importedAt: new Date().toISOString(),
      recordCount: records.length,
      uniqueSlipCount,
      duplicateSlipCount: duplicate.duplicateSlipCount,
      duplicateLineCount: duplicate.duplicateLineCount,
      duplicateGroups: duplicate.groups,
      records
    };
  },

  parseAreaDetailRow(row, idx, ym, fileName, lineNo) {
    const get = (...names) => {
      for (const name of names) {
        const i = idx(name);
        if (i >= 0) return String(row[i] ?? '').trim();
      }
      return '';
    };

    const slipNo = get('エスライン原票番号', '原票番号');
    const shipperCode = get('荷主コード');
    const shipperName = get('荷主名');
    const storeCode = get('受注店コード');
    const storeName = get('店名');
    const branchCode = get('配達支店コード');
    const branchName = get('配達支店名');
    const zip = normalizeZip(get('お届け先郵便番号', '郵便番号'));
    const address = get('住所', 'お届け先住所');
    const destAddress = get('お届け先住所');
    const product = get('商品名型番', '商品名', '品名');
    const itemCode = get('コード', '商品コード');
    const workContent = get('作業内容', '科目', '作業区分');
    const unitPrice = toNumberSafe(get('単価'));
    const quantity = toNumberSafe(get('数量')) || 1;
    const amount = toNumberSafe(get('金額'));
    const recycleTicketNo = get('リサイクル券番号');
    const deliveredDate = normalizeDateText(get('配達完了日'));

    const size = [];
    for (let i = 1; i <= 8; i++) {
      size.push(toNumberSafe(get(`サイズ別数量${i}`, `サイズ別数量${toZenkakuNumber(i)}`, `サイズ${i}`)));
    }

    if (!slipNo && !address && !product && !workContent) return null;

    const area = normalizeAreaName(address || destAddress || zip || '未設定');
    const productCategory = classifyProductCategory(product, workContent, itemCode);
    const mainSize = detectMainSize(size);

    return {
      ym,
      source: 'area_csv',
      fileName,
      lineNo,
      deliveredDate,
      shipperCode,
      shipperName,
      storeCode,
      storeName,
      branchCode,
      branchName,
      slipNo,
      customerSlipNo: get('荷主伝票番号'),
      zip,
      address,
      destAddress,
      customerName: get('お届け先名'),
      product,
      productCategory,
      itemCode,
      workContent,
      account: workContent || itemCode || '未設定',
      unitPrice,
      quantity,
      amount,
      recycleTicketNo,
      recycleCompletedDate: normalizeDateText(get('リサイクル完了日')),
      size,
      mainSize,
      area,
      count: quantity || 1
    };
  },

  parseWorkerRow(row, idx, ym, fileName, lineNo, header) {
    const get = (...names) => {
      for (const name of names) {
        const i = idx(name);
        if (i >= 0) return String(row[i] ?? '').trim();
      }
      return '';
    };

    const workerName = get('作業者名', '作業者', '担当者', '社員名', '氏名') || String(row[0] || '').trim();
    const workContent = get('作業内容', '作業区分', '科目');
    const count = toNumberSafe(get('件数', '数量', '実績')) || 1;
    if (!workerName) return null;

    const raw = {};
    header.forEach((h, i) => { raw[h || `列${i+1}`] = row[i] ?? ''; });

    return {
      ym,
      source: 'worker_csv',
      fileName,
      lineNo,
      workerName,
      workContent,
      account: workContent || '未設定',
      count,
      amount: toNumberSafe(get('金額', '売上', '料金')),
      raw
    };
  },

  saveParsed(parsed) {
    STATE.areaData = (STATE.areaData || []).filter(r => !(r.ym === parsed.ym && r.source === parsed.source));

    const rowsToSave = parsed.records.map(r => ({
      ...r,
      importKind: parsed.kind,
      importKindLabel: parsed.kindLabel,
      importedAt: parsed.importedAt,
      recordCount: parsed.recordCount,
      uniqueSlipCount: parsed.uniqueSlipCount,
      duplicateSlipCount: parsed.duplicateSlipCount,
      duplicateLineCount: parsed.duplicateLineCount
    }));

    STATE.areaData.push(...rowsToSave);
    STATE.areaData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));

    if (parsed.source === 'area_csv') {
      this.rebuildFieldDataFromAreaCsv(parsed.ym);
    } else {
      this.saveWorkerSummary(parsed);
    }
  },

  rebuildFieldDataFromAreaCsv(ym) {
    const rows = (STATE.areaData || []).filter(r => r.ym === ym && r.source === 'area_csv');
    if (!rows.length) return;

    const areas = {};
    const seenSlipByArea = {};

    for (const r of rows) {
      const area = r.area || normalizeAreaName(r.address || r.destAddress || r.zip || '未設定');
      if (!areas[area]) {
        areas[area] = {
          count:0,
          lineCount:0,
          amount:0,
          shippers:{},
          products:{},
          accounts:{},
          size:[0,0,0,0,0,0,0,0],
          duplicateSlipCount:0
        };
        seenSlipByArea[area] = new Set();
      }

      areas[area].lineCount += 1;
      areas[area].amount += n(r.amount);
      (r.size || []).forEach((v,i)=>{ areas[area].size[i] += n(v); });

      const slip = r.slipNo || `__line_${r.lineNo}`;
      if (!seenSlipByArea[area].has(slip)) {
        seenSlipByArea[area].add(slip);
        areas[area].count += 1;
      } else {
        areas[area].duplicateSlipCount += 1;
      }

      const shipper = r.shipperName || r.shipperCode || '未設定';
      if (!areas[area].shippers[shipper]) areas[area].shippers[shipper] = { count:0, amount:0, lineCount:0 };
      areas[area].shippers[shipper].lineCount += 1;
      areas[area].shippers[shipper].amount += n(r.amount);
      areas[area].shippers[shipper].count = countUniqueSlips(rows.filter(x => (x.area || normalizeAreaName(x.address || x.destAddress || x.zip || '未設定')) === area && (x.shipperName || x.shipperCode || '未設定') === shipper));

      const product = r.productCategory || '未設定';
      areas[area].products[product] = (areas[area].products[product] || 0) + 1;

      const account = r.account || '未設定';
      areas[area].accounts[account] = (areas[area].accounts[account] || 0) + 1;
    }

    const duplicateInfo = analyzeSlipDuplicates(rows);

    STATE.fieldData = (STATE.fieldData || []).filter(d => !(d.ym === ym && d.source === 'area_csv'));
    STATE.fieldData.push({
      ym,
      source: 'area_csv',
      label: '商品・住所CSV',
      areas,
      importedAt: new Date().toISOString(),
      rowCount: rows.length,
      uniqueSlipCount: countUniqueSlips(rows),
      duplicateSlipCount: duplicateInfo.duplicateSlipCount,
      duplicateLineCount: duplicateInfo.duplicateLineCount,
      duplicateGroups: duplicateInfo.groups
    });
    STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));
  },

  saveWorkerSummary(parsed) {
    const workers = {};
    for (const r of parsed.records) {
      const name = r.workerName || '未設定';
      if (!workers[name]) workers[name] = { count:0, amount:0, accounts:{} };
      workers[name].count += n(r.count);
      workers[name].amount += n(r.amount);
      const account = r.account || '未設定';
      workers[name].accounts[account] = (workers[name].accounts[account] || 0) + n(r.count);
    }

    STATE.fieldData = (STATE.fieldData || []).filter(d => !(d.ym === parsed.ym && d.source === 'worker_csv'));
    STATE.fieldData.push({
      ym: parsed.ym,
      source: 'worker_csv',
      label: '作業者別CSV',
      workers,
      importedAt: parsed.importedAt,
      rowCount: parsed.recordCount
    });
    STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));
  }
};

function normalizeHeaderName(v) {
  return String(v || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\s　]/g, '')
    .replace(/[①]/g, '1')
    .replace(/[②]/g, '2')
    .replace(/[③]/g, '3')
    .replace(/[④]/g, '4')
    .replace(/[⑤]/g, '5')
    .replace(/[⑥]/g, '6')
    .replace(/[⑦]/g, '7')
    .replace(/[⑧]/g, '8')
    .trim();
}

function makeHeaderIndex(header) {
  return function(name) {
    const key = normalizeHeaderName(name);
    return header.findIndex(h => normalizeHeaderName(h) === key);
  };
}

function toNumberSafe(v) {
  const s = String(v ?? '').replace(/,/g,'').replace(/[円千]/g,'').replace(/[^\d.-]/g,'');
  if (!s || s === '-' || s === '.') return 0;
  const num = Number(s);
  return Number.isFinite(num) ? num : 0;
}

function normalizeZip(v) {
  return String(v || '').replace(/[^0-9A-Za-z]/g,'').toUpperCase();
}

function normalizeDateText(v) {
  const s = String(v || '').replace(/[^0-9]/g,'');
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return String(v || '').trim();
}

function toZenkakuNumber(n) {
  return String(n).replace(/[0-9]/g, d => '０１２３４５６７８９'[Number(d)]);
}

function normalizeAreaName(address) {
  const t = String(address || '').replace(/\s+/g,'');
  if (!t || t.includes('郵便番号未登録') || t === 'UNKNOWN') return '郵便番号未登録';

  const prefMatch = t.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  const pref = prefMatch ? prefMatch[1] : '';
  const rest = pref ? t.slice(pref.length) : t;
  const m = rest.match(/^(.+?[市区町村])/);
  if (m) return pref + m[1];
  return pref ? pref + rest : rest;
}

function classifyProductCategory(product, workContent, itemCode) {
  const t = `${product || ''} ${workContent || ''} ${itemCode || ''}`;
  if (/冷蔵|冷凍/.test(t)) return '冷蔵庫';
  if (/洗濯|洗乾|ランドリー/.test(t)) return '洗濯機';
  if (/エアコン|空調/.test(t)) return 'エアコン';
  if (/テレビ|ＴＶ|TV|液晶/.test(t)) return 'テレビ';
  if (/レンジ|オーブン/.test(t)) return 'レンジ';
  if (/リサイクル|リサ券/.test(t)) return 'リサイクル';
  if (/工事|取付|設置/.test(t)) return '工事・設置';
  return product ? 'その他商品' : (workContent || '未設定');
}

function detectMainSize(size) {
  const arr = Array.isArray(size) ? size : [];
  let best = 0, max = 0;
  arr.forEach((v,i)=>{ if (n(v) > max) { max = n(v); best = i+1; } });
  return max > 0 ? `サイズ${best}` : '未設定';
}

function analyzeSlipDuplicates(records) {
  const map = {};
  for (const r of records || []) {
    const key = String(r.slipNo || '').trim();
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }

  const groups = Object.entries(map)
    .filter(([, list]) => list.length > 1)
    .map(([slipNo, list]) => ({
      slipNo,
      lineCount: list.length,
      products: [...new Set(list.map(r => r.product).filter(Boolean))],
      accounts: [...new Set(list.map(r => r.account).filter(Boolean))],
      address: list[0]?.address || list[0]?.destAddress || '',
      shipper: list[0]?.shipperName || list[0]?.shipperCode || '',
      amount: list.reduce((s,r)=>s+n(r.amount),0)
    }))
    .sort((a,b)=>b.lineCount-a.lineCount || String(a.slipNo).localeCompare(String(b.slipNo)));

  const countBySlip = {};
  Object.entries(map).forEach(([k,v]) => { countBySlip[k] = v.length; });

  return {
    groups,
    countBySlip,
    duplicateSlipCount: groups.length,
    duplicateLineCount: groups.reduce((s,g)=>s+g.lineCount,0)
  };
}

function countUniqueSlips(records) {
  const slips = new Set((records || []).map(r => String(r.slipNo || '').trim()).filter(Boolean));
  if (slips.size) return slips.size;
  return (records || []).length;
}

function setupFieldImportYMControls() {
  const fySel = document.getElementById('field-csv-fy-select');
  const mSel = document.getElementById('field-csv-month-select');
  if (!fySel || !mSel) return;

  const years = dashboardAvailableFiscalYears();
  const currentFY = dashboardSelectedFiscalYear();
  fySel.innerHTML = years.map(y => `<option value="${y}" ${String(y)===String(currentFY)?'selected':''}>${y}年度</option>`).join('');

  const ym = dashboardSelectedYM();
  if (ym) {
    fySel.value = fiscalYearFromYM(ym);
    mSel.value = ym.slice(4,6);
  } else {
    fySel.value = currentFY;
    mSel.value = '04';
  }

  syncFieldImportYMFromControls();
}

function syncFieldImportYMFromControls() {
  const fySel = document.getElementById('field-csv-fy-select');
  const mSel = document.getElementById('field-csv-month-select');
  if (!fySel || !mSel) return;

  const fy = String(fySel.value || dashboardSelectedFiscalYear());
  const mm = String(mSel.value || '04').padStart(2,'0');

  const year = ['01','02','03'].includes(mm) ? String(parseInt(fy,10)+1) : fy;
  STATE.fiscalYear = fy;
  STATE.selYM = `${year}${mm}`;

  const note = document.getElementById('field-import-ym-note');
  if (note) note.textContent = `${ymLabel(STATE.selYM)} として保存します。CSVの配達完了日は参考情報として保存します。`;
}

const FIELD_IMPORT2 = {
  handleFiles(files) { AREA_CSV_IMPORT.handleFiles(files); },
  handleDrop(e) { e.preventDefault(); if(e.dataTransfer.files.length) AREA_CSV_IMPORT.handleFiles(e.dataTransfer.files); },
};

// 現場データリスト更新（グローバル関数として呼ばれる）
function renderFieldDataList2() {
  const list = document.getElementById('field-data-list2');
  if (!list) return;
  const badge = document.getElementById('field-import-badge');
  if (STATE.fieldData.length) {
    if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }
    list.innerHTML = STATE.fieldData.map(d=>{
      const areaRows = (STATE.areaData || []).filter(r => r.ym === d.ym);
      const areaCount = areaRows.reduce((s,r)=>s+n(r.count),0);
      const areaLabel = areaRows.length ? ` / CSV ${fmt(areaRows.length)}行・${fmt(areaCount)}件` : '';
      return `
      <div class="data-item">
        <span>${ymLabel(d.ym)}${areaLabel}</span>
        <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${d.ym}')" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`;
    }).join('');
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
  STATE.areaData = (STATE.areaData || []).filter(d=>d.ym!==ym);
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


/* ════════ §29-A AUTO SYNC（保存・更新時に自動クラウド同期） ════════ */
const AUTO_SYNC = {
  _timer: null,
  _installed: false,
  _suppress: false,

  install() {
    if (this._installed || !window.STORE && typeof STORE === 'undefined') return;
    if (STORE._autoSyncInstalled) return;

    const originalSave = STORE.save.bind(STORE);

    STORE.save = (...args) => {
      const result = originalSave(...args);

      // クラウドから取得してローカル反映している最中は、再同期ループを防ぐ
      if (!AUTO_SYNC._suppress) {
        AUTO_SYNC.queue();
      }

      return result;
    };

    STORE._autoSyncInstalled = true;
    this._installed = true;
  },

  queue() {
    if (!window.CLOUD && typeof CLOUD === 'undefined') return;
    if (!CLOUD || typeof CLOUD.syncSmart !== 'function') return;

    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (AUTO_SYNC._suppress) return;

      CLOUD.syncSmart()
        .then(r => {
          if (r && r.ok) {
            UI.updateSaveStatus();
            UI.updateCloudBadge && UI.updateCloudBadge('ok');
          }
        })
        .catch(() => {});
    }, 1200);
  },

  withoutSync(fn) {
    this._suppress = true;
    try {
      return fn();
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

/* ════════ §30 BOOT ═════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // 1. ローカルストレージから読込
  STORE.load();

  // 1.5 保存・取込・更新時の自動同期を有効化
  AUTO_SYNC.install();

  // 2. センター情報を画面に反映
  document.querySelectorAll('[data-center-name]').forEach(el=>el.textContent=CENTER.name);
  document.querySelectorAll('[data-center-import-name]').forEach(el=>el.textContent=CENTER.name+'データ取込');

  // 3. ドロップゾーン設定
  setupDropZone('upload-zone', 'file-input', f=>IMPORT.handleFiles(f));
  setupDropZone('field-upload-zone', 'field-file-input', f=>IMPORT.handleFiles(f));
  setupDropZone('field-upload-zone2', 'field-file-input2', f=>FIELD_IMPORT2.handleFiles(f));

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

  // 8. ダッシュボードを初期表示
  NAV.go('dashboard');

  // 9. クラウド設定フォームとバッジを初期化
  CLOUD.renderForm();

  // 10. ステータス更新
  UI.updateSaveStatus();
  UI.updateTopbar('dashboard');

  // 11. 起動時はまず取得を優先し、full_state と月別CSVの両方を確認する
  CLOUD.pull()
    .then(r => {
      if (r && r.ok) {
        NAV.refresh();
        UI.updateTopbar(STATE.view || 'dashboard');
        UI.updateSaveStatus();
        if (r.changed) UI.toast('クラウドの最新データを反映しました');
      }
    })
    .catch(() => {});
});




/* ════════ FIELD CSV IMPORT final patch（2026-04-29）════════
   CSV取込廃止版。現場明細はCSVのみ取り込む。
   表示一覧では、作業者別CSV / 商品・住所CSV / 原票番号重複を確認できる。
════════════════════════════════════════════════════════════════ */
const __renderImportOriginalForFieldCsv = typeof renderImport === 'function' ? renderImport : null;
if (__renderImportOriginalForFieldCsv) {
  renderImport = function renderImportPatchedForFieldCsv() {
    __renderImportOriginalForFieldCsv();
    setupFieldImportYMControls();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
  };
}

const __renderFieldDataList2OriginalForFieldCsv = typeof renderFieldDataList2 === 'function' ? renderFieldDataList2 : null;
if (__renderFieldDataList2OriginalForFieldCsv) {
  renderFieldDataList2 = function renderFieldDataList2PatchedForFieldCsv() {
    const list = document.getElementById('field-data-list2');
    const badge = document.getElementById('field-import-badge');
    if (!list) return __renderFieldDataList2OriginalForFieldCsv();

    const fieldRows = STATE.fieldData || [];
    const detailRows = (STATE.areaData || []).filter(r => r.source === 'area_csv');
    const workerRows = (STATE.areaData || []).filter(r => r.source === 'worker_csv');

    const yms = [...new Set([
      ...fieldRows.map(d => d.ym),
      ...detailRows.map(r => r.ym),
      ...workerRows.map(r => r.ym)
    ].filter(Boolean))].sort();

    if (!yms.length) {
      if (badge) { badge.textContent='未読込'; badge.className='badge badge-warn'; }
      list.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>';
      const rowEl = document.getElementById('field-delete-all-row');
      if (rowEl) rowEl.style.display = 'none';
      return;
    }

    if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }

    list.innerHTML = yms.map(ym => {
      const dRows = detailRows.filter(r => r.ym === ym);
      const wRows = workerRows.filter(r => r.ym === ym);
      const uniqueSlip = countUniqueSlips(dRows);
      const dup = analyzeSlipDuplicates(dRows);
      const itemCats = [...new Set(dRows.map(r => r.productCategory).filter(Boolean))].length;
      const accounts = [...new Set(dRows.map(r => r.account).filter(Boolean))].length;
      const addresses = [...new Set(dRows.map(r => r.address || r.destAddress).filter(Boolean))].length;
      const workers = [...new Set(wRows.map(r => r.workerName).filter(Boolean))].length;

      const detailLabel = dRows.length
        ? `商品・住所CSV ${fmt(dRows.length)}行 / 原票${fmt(uniqueSlip)}件 / 住所${fmt(addresses)}件 / 商品分類${fmt(itemCats)} / 科目${fmt(accounts)} / 重複原票${fmt(dup.duplicateSlipCount)}件`
        : '商品・住所CSV 未登録';

      const workerLabel = wRows.length
        ? `作業者別CSV ${fmt(wRows.length)}行 / 作業者${fmt(workers)}名`
        : '作業者別CSV 未登録';

      const dupColor = dup.duplicateSlipCount ? '#b91c1c' : '#15803d';
      const dupBg = dup.duplicateSlipCount ? '#fee2e2' : '#dcfce7';

      return `
        <div class="data-item" style="align-items:flex-start;gap:12px">
          <div style="flex:1;line-height:1.7">
            <div><strong>${ymLabel(ym)}</strong></div>
            <div style="font-size:11px;color:var(--text2)">✅ ${detailLabel}</div>
            <div style="font-size:11px;color:var(--text2)">✅ ${workerLabel}</div>
            ${dRows.length ? `<div style="font-size:11px;margin-top:3px"><span style="display:inline-block;background:${dupBg};color:${dupColor};border-radius:999px;padding:2px 8px;font-weight:800">原票重複チェック：${dup.duplicateSlipCount ? `要確認 ${fmt(dup.duplicateSlipCount)}件` : 'OK'}</span></div>` : ''}
          </div>
          <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${ym}')" style="font-size:11px;padding:2px 8px">削除</button>
        </div>`;
    }).join('');

    const rowEl = document.getElementById('field-delete-all-row');
    if (rowEl) rowEl.style.display = 'flex';
  };
}

IMPORT.deleteFieldData = function(ym) {
  STATE.fieldData = (STATE.fieldData || []).filter(d=>d.ym!==ym);
  STATE.areaData = (STATE.areaData || []).filter(d=>d.ym!==ym);
  STORE.save();
  renderFieldDataList2();
  NAV.refresh();
  UI.toast(`${ymLabel(ym)} の現場CSVデータを削除しました`);
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    setupFieldImportYMControls();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
  }, 300);
});

/* ════════ 月次登録チェック表：現場CSV列追加（2026-04-29）════════ */
const __renderMonthlyCheckTableOriginalForFieldCsv = typeof renderMonthlyCheckTable === 'function' ? renderMonthlyCheckTable : null;
if (__renderMonthlyCheckTableOriginalForFieldCsv) {
  renderMonthlyCheckTable = function renderMonthlyCheckTableWithFieldCsv() {
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

    function fieldCsvState(ym, source) {
      const rows = (STATE.areaData || []).filter(r => r.ym === ym && r.source === source);
      if (!rows.length) return { label:'未登録', kind:'danger', note:'' };
      if (source === 'area_csv') {
        const dup = analyzeSlipDuplicates(rows);
        const uniqueSlip = countUniqueSlips(rows);
        return {
          label: dup.duplicateSlipCount ? `要確認 ${dup.duplicateSlipCount}` : '登録済',
          kind: dup.duplicateSlipCount ? 'warn' : 'ok',
          note: `商品住所 ${rows.length}行 / 原票${uniqueSlip}件 / 重複${dup.duplicateSlipCount}件`
        };
      }
      const workers = new Set(rows.map(r => r.workerName).filter(Boolean)).size;
      return { label:'登録済', kind:'ok', note:`作業者 ${rows.length}行 / ${workers}名` };
    }

    return `
      <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
          <div>
            <div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div>
          </div>
          <div>${summary}</div>
        </div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
          ${states.map(s=>{
            const worker = fieldCsvState(s.ym, 'worker_csv');
            const detail = fieldCsvState(s.ym, 'area_csv');
            const note = [s.note, worker.note, detail.note].filter(Boolean).join(' / ');
            return `
            <tr>
              <td><strong>${ymLabel(s.ym)}</strong></td>
              <td>${storageBadge(s.csvLabel, s.csvKind)}</td>
              <td>${storageBadge(s.histLabel, s.histKind)}</td>
              <td>${storageBadge(s.planLabel, s.planKind)}</td>
              <td>${storageBadge(worker.label, worker.kind)}</td>
              <td>${storageBadge(detail.label, detail.kind)}</td>
              <td>${storageBadge(s.judge, s.kind)}</td>
              <td style="min-width:360px;color:var(--text2)">${esc(note)}</td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
      </div>`;
  };
}


/* ════════════════════════════════════════════════════════════════
   2026-04-29 現場明細CSV 完全分離版 FINAL
   ・PDF関連処理は使用しない
   ・作業者別CSVと商品・住所CSVを別々の取込枠で年月指定
   ・商品・住所CSVは列位置固定で解析
      I列：エスライン原票番号
      L列：お届け先郵便番号
      P列：商品名型番
      R列：作業内容
      U列：金額
   ・件数はI列エスライン原票番号のユニーク件数
   ・I列重複行は件数・商品・サイズ判定から除外
   ・R列作業内容とU列金額のみ、原票番号へ紐付けて集計
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const FIELD_FINAL = {
    getFiscalYears(){
      const set = new Set();
      try { (dashboardAvailableFiscalYears() || []).forEach(y => set.add(String(y))); } catch(e) {}
      try { set.add(String(getDefaultFiscalYear())); } catch(e) {}
      set.add('2025');
      set.add('2026');
      return [...set].filter(Boolean).sort((a,b)=>parseInt(b,10)-parseInt(a,10));
    },

    ymFromControls(kind){
      const fyEl = document.getElementById(kind === 'worker' ? 'field-worker-fy-select' : 'field-product-fy-select');
      const moEl = document.getElementById(kind === 'worker' ? 'field-worker-month-select' : 'field-product-month-select');
      const fy = String(fyEl?.value || STATE.fiscalYear || dashboardSelectedFiscalYear() || getDefaultFiscalYear());
      const mm = String(moEl?.value || STATE.selYM?.slice(4,6) || '04').padStart(2,'0');
      const yy = ['01','02','03'].includes(mm) ? String(parseInt(fy,10)+1) : fy;
      return yy + mm;
    },

    setupControls(){
      const years = this.getFiscalYears();
      const currentFY = String(STATE.fiscalYear || dashboardSelectedFiscalYear() || getDefaultFiscalYear());
      for (const kind of ['worker','product']) {
        const fyEl = document.getElementById(kind === 'worker' ? 'field-worker-fy-select' : 'field-product-fy-select');
        const moEl = document.getElementById(kind === 'worker' ? 'field-worker-month-select' : 'field-product-month-select');
        const note = document.getElementById(kind === 'worker' ? 'field-worker-ym-note' : 'field-product-ym-note');
        if (fyEl && !fyEl.dataset.ready) {
          fyEl.innerHTML = years.map(y=>`<option value="${esc(y)}">${esc(y)}年度</option>`).join('');
          fyEl.value = years.includes(currentFY) ? currentFY : years[0];
          fyEl.dataset.ready = '1';
        }
        if (moEl && !moEl.dataset.ready) {
          const mm = STATE.selYM ? STATE.selYM.slice(4,6) : '03';
          moEl.innerHTML = ['04','05','06','07','08','09','10','11','12','01','02','03'].map(m=>`<option value="${m}">${parseInt(m,10)}月</option>`).join('');
          moEl.value = mm;
          moEl.dataset.ready = '1';
        }
        const update = () => {
          const ym = this.ymFromControls(kind);
          if (note) note.textContent = `${ymLabel(ym)} として保存します。CSV内の日付は参考情報として保持します。`;
        };
        if (fyEl && !fyEl.dataset.bound) { fyEl.addEventListener('change', update); fyEl.dataset.bound = '1'; }
        if (moEl && !moEl.dataset.bound) { moEl.addEventListener('change', update); moEl.dataset.bound = '1'; }
        update();
      }
    },

    async importWorkerFiles(files){
      const ym = this.ymFromControls('worker');
      const arr = Array.from(files || []).filter(f=>/\.csv$/i.test(f.name));
      if (!arr.length) { UI.toast('作業者別CSVを選択してください', 'warn'); return; }
      for (const file of arr) await this.importWorkerCsv(file, ym);
      this.afterImport();
    },

    async importProductFiles(files){
      const ym = this.ymFromControls('product');
      const arr = Array.from(files || []).filter(f=>/\.csv$/i.test(f.name));
      if (!arr.length) { UI.toast('商品・住所CSVを選択してください', 'warn'); return; }
      for (const file of arr) await this.importProductCsv(file, ym);
      this.afterImport();
    },

    afterImport(){
      STORE.save();
      if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC.schedule) AUTO_SYNC.schedule();
      if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
      if (FIELD_UI && FIELD_UI.updatePeriodBadge) FIELD_UI.updatePeriodBadge();
      NAV.refresh();
      UI.updateSaveStatus && UI.updateSaveStatus();
    },

    async readCsv(file){
      const text = await CSV.read(file);
      const rows = CSV.toRows(text);
      if (!rows || rows.length < 2) throw new Error(`${file.name}: CSV明細行がありません`);
      return rows;
    },

    async importProductCsv(file, ym){
      UI.toast(`${file.name} を商品・住所CSVとして解析中...`);
      const rows = await this.readCsv(file);
      const parsed = this.parseProductRowsByFixedColumns(rows, file.name, ym);
      if (!parsed.uniqueRecords.length) { UI.toast(`${file.name}: 商品・住所CSVとして読める行がありません`, 'warn'); return; }

      STATE.areaData = (STATE.areaData || []).filter(r => !(r.ym === ym && r.source === 'area_csv'));
      STATE.areaData.push(...parsed.uniqueRecords);
      STATE.areaData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)) || String(a.slipNo).localeCompare(String(b.slipNo)));
      this.rebuildFieldSummaryFromProduct(ym, parsed);
      UI.toast(`${ymLabel(ym)} 商品・住所CSV取込完了：原票${fmt(parsed.uniqueSlipCount)}件 / 明細${fmt(parsed.rawLineCount)}行 / 重複除外${fmt(parsed.excludedDuplicateLineCount)}行`);
    },

    parseProductRowsByFixedColumns(rows, fileName, ym){
      const header = rows[0] || [];
      const bySlip = new Map();
      let rawLineCount = 0;
      let blankSlipCount = 0;

      for (let r=1; r<rows.length; r++) {
        const row = rows[r] || [];
        if (!row.some(v=>String(v||'').trim())) continue;
        rawLineCount++;

        const slipNo = String(row[8] ?? '').trim();              // I列
        if (!slipNo) { blankSlipCount++; continue; }

        const deliveredDate = normalizeDateText(row[0]);
        const shipperCode = String(row[1] ?? '').trim();
        const shipperName = String(row[2] ?? '').trim();
        const storeCode = String(row[3] ?? '').trim();
        const storeName = String(row[4] ?? '').trim();
        const branchCode = String(row[6] ?? '').trim();
        const branchName = String(row[7] ?? '').trim();
        const customerSlipNo = String(row[9] ?? '').trim();
        const zip = normalizeZip(row[11]);                       // L列
        const address = String(row[12] ?? '').trim();            // M列
        const destAddress = String(row[13] ?? '').trim();
        const customerName = String(row[14] ?? '').trim();
        const product = String(row[15] ?? '').trim();            // P列
        const itemCode = String(row[16] ?? '').trim();
        const workContent = String(row[17] ?? '').trim();        // R列
        const unitPrice = toNumberSafe(row[18]);
        const quantity = toNumberSafe(row[19]) || 1;
        const amount = toNumberSafe(row[20]);                    // U列
        const recycleTicketNo = String(row[21] ?? '').trim();
        const recycleCompletedDate = normalizeDateText(row[22]);
        const size = [];
        for (let i=23; i<=30; i++) size.push(toNumberSafe(row[i]));

        if (!bySlip.has(slipNo)) {
          const area = normalizeAreaName(address || destAddress || zip || '未設定');
          bySlip.set(slipNo, {
            ym,
            source:'area_csv',
            importKind:'product_address_csv',
            importKindLabel:'商品・住所CSV',
            fileName,
            importedAt:new Date().toISOString(),
            lineNo:r+1,
            rawLineCount:0,
            duplicateExcludedLineCount:0,
            deliveredDate,
            shipperCode, shipperName, storeCode, storeName, branchCode, branchName,
            slipNo,
            customerSlipNo,
            zip,
            address,
            destAddress,
            customerName,
            product,
            productCategory: classifyProductCategory(product, workContent, itemCode),
            itemCode,
            workContent: workContent || '未設定',
            account: workContent || itemCode || '未設定',
            unitPrice,
            quantity,
            amount:0,
            recycleTicketNo,
            recycleCompletedDate,
            size,
            mainSize: detectMainSize(size),
            area,
            count:1,
            workDetails:[],
            accounts:{},
            rawHeader: header
          });
        }

        const rec = bySlip.get(slipNo);
        rec.rawLineCount += 1;
        if (rec.rawLineCount > 1) rec.duplicateExcludedLineCount += 1;

        // 重複行では、件数・商品・サイズは増やさない。R列作業内容とU列金額だけ原票へ紐付ける。
        const account = workContent || itemCode || '未設定';
        const detail = { workContent: workContent || '未設定', account, amount, unitPrice, quantity, lineNo:r+1 };
        rec.workDetails.push(detail);
        rec.amount += amount;
        rec.accounts[account] = (rec.accounts[account] || 0) + amount;
        rec.workContent = [...new Set(rec.workDetails.map(x=>x.workContent).filter(Boolean))].join(' / ') || '未設定';
        rec.account = [...new Set(rec.workDetails.map(x=>x.account).filter(Boolean))].join(' / ') || '未設定';
      }

      const uniqueRecords = [...bySlip.values()].map(r => ({
        ...r,
        duplicateSlipCount: r.rawLineCount,
        isDuplicateSlip: r.rawLineCount > 1,
        duplicateNote: r.rawLineCount > 1 ? `同一原票内の重複${r.rawLineCount}行。件数・商品・サイズは1件扱い。R列/U列のみ集計。` : ''
      }));

      const duplicateGroups = uniqueRecords
        .filter(r=>r.rawLineCount > 1)
        .map(r=>({
          slipNo:r.slipNo,
          lineCount:r.rawLineCount,
          excludedLineCount:r.duplicateExcludedLineCount,
          address:r.address || r.destAddress || '',
          product:r.product || '',
          accounts:Object.keys(r.accounts || {}),
          amount:r.amount
        }))
        .sort((a,b)=>b.lineCount-a.lineCount || String(a.slipNo).localeCompare(String(b.slipNo)));

      return {
        ym,
        source:'area_csv',
        fileName,
        rawLineCount,
        blankSlipCount,
        uniqueSlipCount: uniqueRecords.length,
        excludedDuplicateLineCount: uniqueRecords.reduce((s,r)=>s+n(r.duplicateExcludedLineCount),0),
        duplicateGroups,
        uniqueRecords
      };
    },

    rebuildFieldSummaryFromProduct(ym, parsed){
      const rows = (STATE.areaData || []).filter(r => r.ym === ym && r.source === 'area_csv');
      const areas = {};
      for (const r of rows) {
        const area = r.area || normalizeAreaName(r.address || r.destAddress || r.zip || '未設定');
        if (!areas[area]) areas[area] = { count:0, lineCount:0, amount:0, shippers:{}, products:{}, accounts:{}, size:[0,0,0,0,0,0,0,0], zipSet:{}, duplicateExcludedLineCount:0 };
        areas[area].count += 1; // ユニーク原票1件
        areas[area].lineCount += n(r.rawLineCount) || 1;
        areas[area].amount += n(r.amount);
        areas[area].duplicateExcludedLineCount += n(r.duplicateExcludedLineCount);
        if (r.zip) areas[area].zipSet[r.zip] = true;
        (r.size || []).forEach((v,i)=>{ areas[area].size[i] += n(v); });
        const shipper = r.shipperName || r.shipperCode || '未設定';
        if (!areas[area].shippers[shipper]) areas[area].shippers[shipper] = { count:0, amount:0, lineCount:0 };
        areas[area].shippers[shipper].count += 1;
        areas[area].shippers[shipper].amount += n(r.amount);
        areas[area].shippers[shipper].lineCount += n(r.rawLineCount) || 1;
        const product = r.productCategory || '未設定';
        areas[area].products[product] = (areas[area].products[product] || 0) + 1;
        for (const acc of Object.keys(r.accounts || {})) areas[area].accounts[acc] = (areas[area].accounts[acc] || 0) + n(r.accounts[acc]);
      }

      STATE.fieldData = (STATE.fieldData || []).filter(d => !(d.ym === ym && d.source === 'area_csv'));
      STATE.fieldData.push({
        ym,
        source:'area_csv',
        label:'商品・住所CSV',
        areas,
        importedAt:new Date().toISOString(),
        rowCount: rows.length,
        rawLineCount: parsed.rawLineCount,
        uniqueSlipCount: parsed.uniqueSlipCount,
        duplicateSlipCount: parsed.duplicateGroups.length,
        duplicateLineCount: parsed.rawLineCount,
        duplicateExcludedLineCount: parsed.excludedDuplicateLineCount,
        duplicateGroups: parsed.duplicateGroups,
        note:'件数はI列エスライン原票番号のユニーク件数。重複行は商品・サイズ判定から除外し、R列作業内容/U列金額のみ原票番号へ紐付け。'
      });
      STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));
    },

    async importWorkerCsv(file, ym){
      UI.toast(`${file.name} を作業者別CSVとして解析中...`);
      const rows = await this.readCsv(file);
      const header = rows[0].map(h => normalizeHeaderName(h));
      const idx = makeHeaderIndex(header);
      const records = [];
      for (let r=1; r<rows.length; r++) {
        const row = rows[r] || [];
        if (!row.some(v=>String(v||'').trim())) continue;
        const rec = this.parseWorkerRow(row, idx, ym, file.name, r+1, header);
        if (rec) records.push(rec);
      }
      if (!records.length) { UI.toast(`${file.name}: 作業者別CSVとして読める行がありません`, 'warn'); return; }

      STATE.areaData = (STATE.areaData || []).filter(r => !(r.ym === ym && r.source === 'worker_csv'));
      STATE.areaData.push(...records);
      this.saveWorkerSummary({ ym, source:'worker_csv', kind:'worker_csv', kindLabel:'作業者別CSV', fileName:file.name, importedAt:new Date().toISOString(), recordCount:records.length, records });
      UI.toast(`${ymLabel(ym)} 作業者別CSV取込完了：${fmt(records.length)}行`);
    },

    parseWorkerRow(row, idx, ym, fileName, lineNo, header){
      const get = (...names) => {
        for (const name of names) {
          const i = idx(name);
          if (i >= 0) return String(row[i] ?? '').trim();
        }
        return '';
      };
      const workerName = get('作業者名','作業者','担当者','社員名','氏名') || String(row[0] || '').trim();
      const workContent = get('作業内容','作業区分','科目');
      const count = toNumberSafe(get('件数','数量','実績')) || 1;
      if (!workerName) return null;
      const raw = {}; header.forEach((h,i)=>{ raw[h || `列${i+1}`] = row[i] ?? ''; });
      return { ym, source:'worker_csv', importKind:'worker_csv', importKindLabel:'作業者別CSV', fileName, importedAt:new Date().toISOString(), lineNo, workerName, workContent, account:workContent || '未設定', count, amount:toNumberSafe(get('金額','売上','料金')), raw };
    },

    saveWorkerSummary(parsed){
      const workers = {};
      for (const r of parsed.records) {
        const name = r.workerName || '未設定';
        if (!workers[name]) workers[name] = { count:0, amount:0, accounts:{} };
        workers[name].count += n(r.count);
        workers[name].amount += n(r.amount);
        const account = r.account || '未設定';
        workers[name].accounts[account] = (workers[name].accounts[account] || 0) + n(r.count);
      }
      STATE.fieldData = (STATE.fieldData || []).filter(d => !(d.ym === parsed.ym && d.source === 'worker_csv'));
      STATE.fieldData.push({ ym:parsed.ym, source:'worker_csv', label:'作業者別CSV', workers, importedAt:parsed.importedAt, rowCount:parsed.recordCount, fileName:parsed.fileName });
      STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));
    }
  };

  function fieldFinalHandleDrop(e, kind){
    e.preventDefault();
    const zone = e.currentTarget;
    if (zone) zone.classList.remove('drag');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    if (kind === 'worker') FIELD_FINAL.importWorkerFiles(files).catch(err=>UI.toast(err.message,'error'));
    else FIELD_FINAL.importProductFiles(files).catch(err=>UI.toast(err.message,'error'));
  }

  window.FIELD_WORKER_IMPORT2 = {
    handleFiles(files){ FIELD_FINAL.importWorkerFiles(files).catch(err=>UI.toast(err.message,'error')); },
    handleDrop(e){ fieldFinalHandleDrop(e, 'worker'); }
  };
  window.FIELD_PRODUCT_IMPORT2 = {
    handleFiles(files){ FIELD_FINAL.importProductFiles(files).catch(err=>UI.toast(err.message,'error')); },
    handleDrop(e){ fieldFinalHandleDrop(e, 'product'); }
  };

  // 旧1枠から呼ばれても安全に商品CSVとして処理する。ただし新UIでは使わない。
  if (typeof FIELD_IMPORT2 !== 'undefined') {
    FIELD_IMPORT2.handleFiles = function(files){
      const arr = Array.from(files || []);
      if (!arr.length) return;
      UI.toast('現場CSVは「作業者別CSV」「商品・住所CSV」の専用枠から取り込んでください。今回は商品・住所CSVとして処理します。', 'warn');
      FIELD_FINAL.importProductFiles(files).catch(err=>UI.toast(err.message,'error'));
    };
    FIELD_IMPORT2.handleDrop = function(e){ fieldFinalHandleDrop(e, 'product'); };
  }

  const originalRenderFieldDataList2 = typeof renderFieldDataList2 === 'function' ? renderFieldDataList2 : null;
  window.renderFieldDataList2 = renderFieldDataList2 = function(){
    const list = document.getElementById('field-data-list2');
    const badge = document.getElementById('field-import-badge');
    if (!list) { if (originalRenderFieldDataList2) originalRenderFieldDataList2(); return; }

    const detailRows = (STATE.areaData || []).filter(r => r.source === 'area_csv');
    const workerRows = (STATE.areaData || []).filter(r => r.source === 'worker_csv');
    const fieldRows = STATE.fieldData || [];
    const yms = [...new Set([...detailRows.map(r=>r.ym), ...workerRows.map(r=>r.ym), ...fieldRows.map(d=>d.ym)].filter(Boolean))].sort();

    if (!yms.length) {
      if (badge) { badge.textContent='未読込'; badge.className='badge badge-warn'; }
      list.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>';
      const rowEl = document.getElementById('field-delete-all-row'); if (rowEl) rowEl.style.display = 'none';
      return;
    }

    if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }
    list.innerHTML = yms.map(ym=>{
      const dRows = detailRows.filter(r=>r.ym===ym);
      const wRows = workerRows.filter(r=>r.ym===ym);
      const dMeta = (STATE.fieldData || []).find(d=>d.ym===ym && d.source==='area_csv') || {};
      const workers = new Set(wRows.map(r=>r.workerName).filter(Boolean)).size;
      const addresses = new Set(dRows.map(r=>r.address || r.destAddress).filter(Boolean)).size;
      const zips = new Set(dRows.map(r=>r.zip).filter(Boolean)).size;
      const products = new Set(dRows.map(r=>r.productCategory).filter(Boolean)).size;
      const accounts = new Set(dRows.flatMap(r=>Object.keys(r.accounts || {}))).size;
      const detailLabel = dRows.length
        ? `商品・住所CSV 原票${fmt(dRows.length)}件 / 明細${fmt(dMeta.rawLineCount || dRows.reduce((s,r)=>s+n(r.rawLineCount||1),0))}行 / 郵便番号${fmt(zips)}件 / 住所${fmt(addresses)}件 / 商品分類${fmt(products)} / 科目${fmt(accounts)} / 重複除外${fmt(dMeta.duplicateExcludedLineCount || dRows.reduce((s,r)=>s+n(r.duplicateExcludedLineCount),0))}行`
        : '商品・住所CSV 未登録';
      const workerLabel = wRows.length ? `作業者別CSV ${fmt(wRows.length)}行 / 作業者${fmt(workers)}名` : '作業者別CSV 未登録';
      return `<div class="data-item" style="align-items:flex-start;gap:12px">
        <div style="flex:1;line-height:1.7">
          <div><strong>${ymLabel(ym)}</strong></div>
          <div style="font-size:11px;color:var(--text2)">✅ ${esc(detailLabel)}</div>
          <div style="font-size:11px;color:var(--text2)">✅ ${esc(workerLabel)}</div>
          ${dRows.length ? `<div style="font-size:11px;margin-top:3px"><span style="display:inline-block;background:#dcfce7;color:#15803d;border-radius:999px;padding:2px 8px;font-weight:800">原票重複：件数から除外済（I列基準）</span></div>` : ''}
        </div>
        <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${ym}')" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`;
    }).join('');
    const rowEl = document.getElementById('field-delete-all-row'); if (rowEl) rowEl.style.display = 'flex';
  };

  IMPORT.deleteFieldData = function(ym){
    STATE.fieldData = (STATE.fieldData || []).filter(d=>d.ym!==ym);
    STATE.areaData = (STATE.areaData || []).filter(d=>d.ym!==ym);
    STORE.save();
    renderFieldDataList2();
    NAV.refresh();
    UI.toast(`${ymLabel(ym)} の現場CSVデータを削除しました`);
  };

  // エリア地図タブは、地図の代わりに市区町村別の物量バーを確実に表示する。
  const originalRenderMap = FIELD_UI && FIELD_UI.renderMap ? FIELD_UI.renderMap.bind(FIELD_UI) : null;
  FIELD_UI.renderMap = function(){
    const map = document.getElementById('field-map');
    const tbody = document.getElementById('f-city-tbody');
    const noData = document.getElementById('map-no-data');
    if (!map && !tbody) { if (originalRenderMap) originalRenderMap(); return; }
    const ym = dashboardSelectedYM() || STATE.selYM || selectedYMForImport();
    const metric = document.getElementById('map-metric-sel')?.value || 'count';
    const rows = (STATE.areaData || []).filter(r=>r.ym===ym && r.source==='area_csv');
    if (!rows.length) {
      if (map) map.innerHTML = '';
      if (tbody) tbody.innerHTML = '';
      if (noData) noData.style.display = 'block';
      return;
    }
    if (noData) noData.style.display = 'none';
    const grouped = {};
    for (const r of rows) {
      const area = r.area || normalizeAreaName(r.address || r.destAddress || r.zip || '未設定');
      if (!grouped[area]) grouped[area] = { area, count:0, amount:0 };
      grouped[area].count += 1;
      grouped[area].amount += n(r.amount);
    }
    const list = Object.values(grouped).sort((a,b)=>(metric==='amount'?b.amount-a.amount:b.count-a.count));
    const totalCount = list.reduce((s,x)=>s+x.count,0) || 1;
    const totalAmount = list.reduce((s,x)=>s+x.amount,0) || 1;
    const maxVal = Math.max(...list.map(x=>metric==='amount'?x.amount:x.count),1);
    if (map) {
      map.innerHTML = `<div style="padding:16px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px">${ymLabel(ym)} / 商品・住所CSV / I列原票番号ユニーク件数で集計</div>
        ${list.slice(0,30).map(x=>{
          const val = metric==='amount' ? x.amount : x.count;
          const w = Math.max(4, Math.round(val / maxVal * 100));
          return `<div style="display:grid;grid-template-columns:220px 1fr 90px;gap:10px;align-items:center;margin-bottom:8px;font-size:12px">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.area)}</div>
            <div style="height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden"><div style="height:100%;width:${w}%;background:#1a4d7c;border-radius:999px"></div></div>
            <div style="text-align:right;font-weight:800">${metric==='amount'?fmtK(x.amount)+'千円':fmt(x.count)+'件'}</div>
          </div>`;
        }).join('')}
      </div>`;
    }
    if (tbody) {
      tbody.innerHTML = list.map(x=>{
        const pref = (x.area.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/)||['',''])[1] || '';
        const city = pref ? x.area.replace(pref,'') : x.area;
        const comp = metric==='amount' ? x.amount / totalAmount * 100 : x.count / totalCount * 100;
        return `<tr><td>${esc(pref || '-')}</td><td>${esc(city || x.area)}</td><td class="r">${fmt(x.count)}</td><td class="r">${fmtK(x.amount)}</td><td class="r">${pct(comp)}</td></tr>`;
      }).join('');
    }
  };

  // 月次登録チェック表：重複は異常扱いせず、除外済みとして表示。
  if (typeof renderMonthlyCheckTable === 'function') {
    const originalMonthly = renderMonthlyCheckTable;
    renderMonthlyCheckTable = function(){
      const fy = storageFiscalYear();
      const months = storageFiscalMonths(fy);
      const states = months.map(ym => storageMonthState(fy, ym));
      const missingCount = states.filter(s => s.judge === '漏れ').length;
      const dailyOnlyCount = states.filter(s => s.judge === '注意').length;
      const abnormalCount = states.filter(s => s.judge === '異常').length;
      const histOnlyCount = states.filter(s => s.judge === '補完のみ').length;
      const summary = abnormalCount ? storageBadge(`異常 ${abnormalCount}件`, 'danger') : missingCount ? storageBadge(`漏れ ${missingCount}ヶ月`, 'danger') : dailyOnlyCount || histOnlyCount ? storageBadge(`確認 ${dailyOnlyCount + histOnlyCount}ヶ月`, 'warn') : storageBadge('12ヶ月 OK', 'ok');
      function fieldCsvState(ym, source){
        const rows = (STATE.areaData || []).filter(r=>r.ym===ym && r.source===source);
        if (!rows.length) return { label:'未登録', kind:'danger', note:'' };
        if (source === 'area_csv') {
          const meta = (STATE.fieldData || []).find(d=>d.ym===ym && d.source==='area_csv') || {};
          return { label:'登録済', kind:'ok', note:`商品住所 原票${rows.length}件 / 明細${meta.rawLineCount || rows.reduce((s,r)=>s+n(r.rawLineCount||1),0)}行 / 重複除外${meta.duplicateExcludedLineCount || rows.reduce((s,r)=>s+n(r.duplicateExcludedLineCount),0)}行` };
        }
        const workers = new Set(rows.map(r=>r.workerName).filter(Boolean)).size;
        return { label:'登録済', kind:'ok', note:`作業者 ${rows.length}行 / ${workers}名` };
      }
      return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div></div><div>${summary}</div></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
        ${states.map(s=>{ const worker=fieldCsvState(s.ym,'worker_csv'); const detail=fieldCsvState(s.ym,'area_csv'); const note=[s.note, worker.note, detail.note].filter(Boolean).join(' / '); return `<tr><td><strong>${ymLabel(s.ym)}</strong></td><td>${storageBadge(s.csvLabel,s.csvKind)}</td><td>${storageBadge(s.histLabel,s.histKind)}</td><td>${storageBadge(s.planLabel,s.planKind)}</td><td>${storageBadge(worker.label,worker.kind)}</td><td>${storageBadge(detail.label,detail.kind)}</td><td>${storageBadge(s.judge,s.kind)}</td><td style="min-width:360px;color:var(--text2)">${esc(note)}</td></tr>`; }).join('')}
        </tbody></table></div></div>`;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(()=>{
      FIELD_FINAL.setupControls();
      if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
    }, 200);
  });

  // 画面遷移時にも、現場画面なら地図を再描画
  const originalNavRefresh = NAV && NAV.refresh ? NAV.refresh.bind(NAV) : null;
  if (NAV && originalNavRefresh) {
    NAV.refresh = function(){
      const r = originalNavRefresh();
      try { if (STATE.view === 'field') setTimeout(()=>FIELD_UI.renderMap(), 50); } catch(e) {}
      return r;
    };
  }
})();


/* ════════════════════════════════════════════════════════════════
   2026-04-29 現場明細CSV エリア表示改善 FINAL-3（表示整理版）
   ・地図タブの重なりを解消（市区町村別明細カードを非表示）
   ・全体ランキング / 都道府県別を切替
   ・都道府県別は「開く」ボタンを大きく表示し、開閉状態も表示
   ・I列エスライン原票番号でユニーク集計（念のため表示時にも再ユニーク化）
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  function fieldGetYMClean(){
    const sel = document.getElementById('field-month-sel');
    if (sel && sel.value) return sel.value;
    return dashboardSelectedYM() || STATE.selYM || selectedYMForImport();
  }

  function splitPrefCityClean(areaText){
    const raw = String(areaText || '未設定').replace(/\s+/g,'');
    if (!raw || raw === '未設定') return { pref:'未設定', city:'未設定', area:'未設定' };
    if (raw.includes('郵便番号未登録') || raw === 'UNKNOWN') return { pref:'未設定', city:'郵便番号未登録', area:'郵便番号未登録' };
    const m = raw.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.*)$/);
    if (!m) return { pref:'未設定', city:raw, area:raw };
    const pref = m[1] || '未設定';
    const city = m[2] || pref;
    return { pref, city, area: pref + (city === pref ? '' : city) };
  }

  function fieldUniqueRowsBySlip(ym){
    const src = (STATE.areaData || []).filter(r => r && r.ym === ym && r.source === 'area_csv');
    const map = new Map();
    for (const r of src) {
      const key = String(r.slipNo || '').trim() || `__line_${r.lineNo || map.size + 1}`;
      if (!map.has(key)) map.set(key, { ...r, __displayAmount: 0, __displayRawRows: 0 });
      const rec = map.get(key);
      rec.__displayAmount += n(r.amount);
      rec.__displayRawRows += n(r.rawLineCount || 1);
      if (!rec.area && r.area) rec.area = r.area;
      if (!rec.address && r.address) rec.address = r.address;
      if (!rec.destAddress && r.destAddress) rec.destAddress = r.destAddress;
      if (!rec.zip && r.zip) rec.zip = r.zip;
    }
    return [...map.values()].map(r => ({ ...r, amount: r.__displayAmount || n(r.amount), rawLineCount: r.__displayRawRows || n(r.rawLineCount || 1) }));
  }

  function buildAreaAggClean(ym){
    const rows = fieldUniqueRowsBySlip(ym);
    const cityMap = new Map();
    const prefMap = new Map();
    let totalCount = 0;
    let totalAmount = 0;

    for (const r of rows) {
      const areaName = r.area || normalizeAreaName(r.address || r.destAddress || r.zip || '未設定');
      const pc = splitPrefCityClean(areaName);
      const key = `${pc.pref}||${pc.city}`;
      if (!cityMap.has(key)) {
        cityMap.set(key, { pref: pc.pref, city: pc.city, area: pc.pref === '未設定' ? pc.city : pc.pref + pc.city, count:0, amount:0, rawLineCount:0, zips:new Set() });
      }
      const c = cityMap.get(key);
      c.count += 1;
      c.amount += n(r.amount);
      c.rawLineCount += n(r.rawLineCount || 1);
      if (r.zip) c.zips.add(r.zip);

      if (!prefMap.has(pc.pref)) prefMap.set(pc.pref, { pref: pc.pref, count:0, amount:0, rawLineCount:0, cities:[] });
      const p = prefMap.get(pc.pref);
      p.count += 1;
      p.amount += n(r.amount);
      p.rawLineCount += n(r.rawLineCount || 1);

      totalCount += 1;
      totalAmount += n(r.amount);
    }

    const cities = [...cityMap.values()];
    for (const p of prefMap.values()) p.cities = cities.filter(c => c.pref === p.pref);
    return { rows, cities, prefs:[...prefMap.values()], totalCount, totalAmount };
  }

  function getAreaMetric(){ return document.getElementById('map-metric-sel')?.value || 'count'; }
  function getAreaMode(){ return document.getElementById('field-area-view-mode')?.value || 'overall'; }
  function getAreaSort(){ return document.getElementById('field-area-sort-mode')?.value || 'count'; }

  function sortAreaList(list, metric, sortMode){
    const arr = [...list];
    if (sortMode === 'name') return arr.sort((a,b)=>String(a.city || a.pref || a.area).localeCompare(String(b.city || b.pref || b.area), 'ja'));
    if (sortMode === 'amount' || metric === 'amount') return arr.sort((a,b)=>n(b.amount)-n(a.amount) || n(b.count)-n(a.count) || String(a.city || a.pref).localeCompare(String(b.city || b.pref),'ja'));
    return arr.sort((a,b)=>n(b.count)-n(a.count) || n(b.amount)-n(a.amount) || String(a.city || a.pref).localeCompare(String(b.city || b.pref),'ja'));
  }

  function barRow(item, maxVal, metric, totalCount, totalAmount, opt={}){
    const val = metric === 'amount' ? n(item.amount) : n(item.count);
    const w = Math.max(2, Math.round((val / Math.max(maxVal,1)) * 100));
    const label = item.area || ((item.pref && item.city) ? item.pref + item.city : (item.city || item.pref || '未設定'));
    const ratio = metric === 'amount' ? n(item.amount) / Math.max(totalAmount,1) * 100 : n(item.count) / Math.max(totalCount,1) * 100;
    const main = metric === 'amount' ? `${fmtK(item.amount)}千円` : `${fmt(item.count)}件`;
    const sub = metric === 'amount' ? `${fmt(item.count)}件・${pct(ratio)}` : `${fmtK(item.amount)}千円・${pct(ratio)}`;
    const rank = opt.rank ? `<div style="width:32px;text-align:center;font-weight:900;color:#64748b">${opt.rank}</div>` : '';
    return `<div style="display:grid;grid-template-columns:${opt.rank?'32px ':''}260px 1fr 120px;gap:10px;align-items:center;padding:${opt.compact?'6px 0':'8px 0'};border-bottom:1px solid #f1f5f9;font-size:12px">${rank}<div title="${esc(label)}" style="font-weight:900;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div><div style="height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden"><div style="height:100%;width:${w}%;background:#1a4d7c;border-radius:999px"></div></div><div style="text-align:right;font-weight:900;color:#0f172a"><div>${main}</div><div style="font-size:10px;color:#64748b;font-weight:700">${sub}</div></div></div>`;
  }

  function summaryBox(agg, ym){
    return `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px"><div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:12px"><div style="font-size:11px;color:#64748b;font-weight:800">対象月</div><div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:4px">${ymLabel(ym)}</div></div><div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:12px"><div style="font-size:11px;color:#64748b;font-weight:800">原票ユニーク件数</div><div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:4px">${fmt(agg.totalCount)}件</div></div><div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:12px"><div style="font-size:11px;color:#64748b;font-weight:800">U列金額合計</div><div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:4px">${fmtK(agg.totalAmount)}千円</div></div></div>`;
  }

  function renderOverallClean(box, agg, ym, metric, sortMode){
    const list = sortAreaList(agg.cities, metric, sortMode);
    const maxVal = Math.max(...list.map(x => metric === 'amount' ? n(x.amount) : n(x.count)), 1);
    box.innerHTML = `<div style="padding:16px">${summaryBox(agg, ym)}<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><div><div style="font-size:14px;font-weight:900;color:#0f172a">全体ランキング</div><div style="font-size:11px;color:#64748b;margin-top:3px">市区町村を全体で並べます。I列原票番号で1件化済み。</div></div><div style="font-size:11px;color:#64748b;font-weight:800">${fmt(list.length)}地区</div></div><div style="border-top:1px solid #e5e7eb">${list.map((x,i)=>barRow(x, maxVal, metric, agg.totalCount, agg.totalAmount, {rank:i+1})).join('')}</div></div>`;
  }

  function updateOnePrefToggle(detail){
    const t = detail.querySelector('[data-pref-toggle]');
    if (!t) return;
    t.textContent = detail.open ? '－ 閉じる' : '＋ 開く';
    t.style.background = detail.open ? '#dcfce7' : '#dbeafe';
    t.style.borderColor = detail.open ? '#86efac' : '#93c5fd';
    t.style.color = detail.open ? '#166534' : '#1e40af';
  }

  function bindPrefToggles(root){
    root.querySelectorAll('details[data-pref-detail]').forEach(d=>{ updateOnePrefToggle(d); d.addEventListener('toggle', ()=>updateOnePrefToggle(d)); });
  }

  function renderPrefClean(box, agg, ym, metric, sortMode){
    const prefs = [...agg.prefs].sort((a,b)=>n(b.count)-n(a.count) || String(a.pref).localeCompare(String(b.pref),'ja'));
    box.innerHTML = `<div style="padding:16px">${summaryBox(agg, ym)}<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><div><div style="font-size:14px;font-weight:900;color:#0f172a">都道府県別</div><div style="font-size:11px;color:#64748b;margin-top:3px">都道府県ごとに折りたたみ表示します。左の「開く」ボタンで市区町村を確認できます。</div></div><button type="button" id="field-open-all-pref" class="btn" style="font-size:11px;padding:5px 10px">すべて開く</button></div><div style="display:grid;gap:10px">${prefs.map((p,idx)=>{ const cities=sortAreaList(p.cities,metric,sortMode); const maxVal=Math.max(...cities.map(x=>metric==='amount'?n(x.amount):n(x.count)),1); const prefRatio=n(p.count)/Math.max(agg.totalCount,1)*100; return `<details data-pref-detail ${idx===0?'open':''} style="border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)"><summary style="cursor:pointer;list-style:none;padding:12px 14px;background:#f8fafc;display:grid;grid-template-columns:92px 1fr 120px 120px 80px;gap:10px;align-items:center;font-size:12px"><span data-pref-toggle style="display:inline-flex;align-items:center;justify-content:center;border:1px solid #93c5fd;background:#dbeafe;color:#1e40af;border-radius:999px;padding:4px 8px;font-weight:900">＋ 開く</span><span style="font-weight:900;color:#0f172a;font-size:14px">${esc(p.pref)}</span><span style="text-align:right;font-weight:900">${fmt(p.count)}件</span><span style="text-align:right;font-weight:900">${fmtK(p.amount)}千円</span><span style="text-align:right;color:#64748b;font-weight:800">${pct(prefRatio)}</span></summary><div style="padding:10px 14px 12px;background:#fff">${cities.map(c=>barRow(c,maxVal,metric,agg.totalCount,agg.totalAmount,{compact:true})).join('')}</div></details>`; }).join('')}</div></div>`;
    bindPrefToggles(box);
    const allBtn=document.getElementById('field-open-all-pref');
    if (allBtn) allBtn.onclick=function(){ const details=[...document.querySelectorAll('details[data-pref-detail]')]; const shouldOpen=details.some(d=>!d.open); details.forEach(d=>{ d.open=shouldOpen; updateOnePrefToggle(d); }); allBtn.textContent=shouldOpen?'すべて閉じる':'すべて開く'; };
  }

  function hideOldCityTable(){
    const tbody = document.getElementById('f-city-tbody');
    const card = tbody ? tbody.closest('.card') : null;
    if (card) card.style.display = 'none';
  }

  function renderCleanMap(){
    const map = document.getElementById('field-map');
    const noData = document.getElementById('map-no-data');
    if (!map) return;
    hideOldCityTable();
    const ym=fieldGetYMClean();
    const metric=getAreaMetric();
    const mode=getAreaMode();
    const sortMode=getAreaSort();
    const agg=buildAreaAggClean(ym);
    if (!agg.rows.length){
      map.innerHTML='<div style="padding:36px;text-align:center;color:#94a3b8;font-weight:800">対象月の商品・住所CSVがありません。</div>';
      if(noData)noData.style.display='none';
      return;
    }
    if(noData)noData.style.display='none';
    if(mode==='pref') renderPrefClean(map,agg,ym,metric,sortMode);
    else renderOverallClean(map,agg,ym,metric,sortMode);
  }

  if (window.FIELD_UI) FIELD_UI.renderMap = renderCleanMap;

  document.addEventListener('change', function(e){
    if(e.target && ['map-metric-sel','field-area-view-mode','field-area-sort-mode','map-data-sel','field-month-sel','field-fy-sel'].includes(e.target.id)){
      try{ renderCleanMap(); }catch(err){ console.error(err); }
    }
  });

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(()=>{ try{ hideOldCityTable(); if(STATE.view==='field') renderCleanMap(); }catch(e){} }, 300);
  });
})();

/* ════════════════════════════════════════════════════════════════
   2026-04-29 FINAL FIX
   ・商品・住所CSVは同一年月を必ず完全入替（読込のたびに増えない）
   ・表示時もI列エスライン原票番号で再ユニーク化（過去の重複保存が残っていても増えない）
   ・エリア地図は背景・バー・下部カードが重ならない1画面表示へ整理
   ・削除は該当年月の現場CSV（作業者CSV＋商品住所CSV）を完全削除
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  function finalInjectStyle(){
    if (document.getElementById('field-final-fix-style')) return;
    const st = document.createElement('style');
    st.id = 'field-final-fix-style';
    st.textContent = `
      #field-map{display:block;position:relative;overflow:visible;background:#fff;min-height:0;}
      #field-map *{box-sizing:border-box;}
      .field-final-wrap{padding:16px;background:#fff;overflow:hidden;}
      .field-final-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px;}
      .field-final-kpi{border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:12px;min-width:0;}
      .field-final-kpi-label{font-size:11px;color:#64748b;font-weight:800;}
      .field-final-kpi-value{font-size:18px;font-weight:900;color:#0f172a;margin-top:4px;}
      .field-final-row{display:grid;grid-template-columns:44px minmax(180px,300px) minmax(160px,1fr) 130px;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;min-width:0;}
      .field-final-row.no-rank{grid-template-columns:minmax(180px,300px) minmax(160px,1fr) 130px;}
      .field-final-name{font-weight:900;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
      .field-final-track{height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden;min-width:0;}
      .field-final-bar{height:100%;background:#1a4d7c;border-radius:999px;max-width:100%;}
      .field-final-value{text-align:right;font-weight:900;color:#0f172a;white-space:nowrap;}
      .field-final-sub{font-size:10px;color:#64748b;font-weight:700;}
      .field-final-pref{border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04);}
      .field-final-pref + .field-final-pref{margin-top:10px;}
      .field-final-pref summary{cursor:pointer;list-style:none;padding:12px 14px;background:#f8fafc;display:grid;grid-template-columns:100px minmax(140px,1fr) 110px 120px 80px;gap:10px;align-items:center;font-size:12px;}
      .field-final-pref summary::-webkit-details-marker{display:none;}
      .field-final-toggle{display:inline-flex;align-items:center;justify-content:center;border:1px solid #93c5fd;background:#dbeafe;color:#1e40af;border-radius:999px;padding:4px 8px;font-weight:900;white-space:nowrap;}
      details[open] .field-final-toggle{background:#dcfce7;border-color:#86efac;color:#166534;}
      .field-final-pref-body{padding:10px 14px 12px;background:#fff;overflow:hidden;}
      .field-final-old-table-hidden{display:none!important;}
      @media(max-width:900px){.field-final-summary{grid-template-columns:1fr}.field-final-row,.field-final-row.no-rank{grid-template-columns:1fr}.field-final-value{text-align:left}.field-final-pref summary{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  function finalYMFromControls(kind){
    const fyEl = document.getElementById(kind === 'worker' ? 'field-worker-fy-select' : 'field-product-fy-select');
    const moEl = document.getElementById(kind === 'worker' ? 'field-worker-month-select' : 'field-product-month-select');
    const fy = String(fyEl?.value || STATE.fiscalYear || dashboardSelectedFiscalYear() || getDefaultFiscalYear());
    const mm = String(moEl?.value || STATE.selYM?.slice(4,6) || '03').padStart(2,'0');
    const yy = ['01','02','03'].includes(mm) ? String(parseInt(fy,10)+1) : fy;
    return yy + mm;
  }

  function finalFieldYM(){
    const sel = document.getElementById('field-month-sel');
    if (sel && sel.value) return sel.value;
    return dashboardSelectedYM() || STATE.selYM || finalYMFromControls('product');
  }

  function finalNormalizeZip(v){
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : s;
  }

  function finalNumber(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円￥\s　]/g,'').replace(/[▲△]/g,'-').replace(/[^0-9.\-]/g,'');
    if (!s || s === '-' || s === '.') return 0;
    const x = parseFloat(s);
    return isNaN(x) ? 0 : x;
  }

  function finalAreaName(address, destAddress, zip){
    if (typeof normalizeAreaName === 'function') return normalizeAreaName(address || destAddress || zip || '未設定');
    return String(address || destAddress || zip || '未設定').replace(/\s+/g,'');
  }

  function finalSplitPrefCity(areaText){
    const raw = String(areaText || '未設定').replace(/\s+/g,'');
    if (!raw || raw === '未設定') return { pref:'未設定', city:'未設定', area:'未設定' };
    if (raw.includes('郵便番号未登録') || raw === 'UNKNOWN') return { pref:'未設定', city:'郵便番号未登録', area:'郵便番号未登録' };
    const m = raw.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.*)$/);
    if (!m) return { pref:'未設定', city:raw, area:raw };
    const pref = m[1] || '未設定';
    const city = m[2] || pref;
    return { pref, city, area: pref + (city === pref ? '' : city) };
  }

  function finalClassifyProduct(product, workContent, itemCode){
    if (typeof classifyProductCategory === 'function') return classifyProductCategory(product, workContent, itemCode);
    const t = String(product || workContent || itemCode || '未設定');
    if (/冷蔵|冷凍/.test(t)) return '冷蔵庫';
    if (/洗濯|乾燥/.test(t)) return '洗濯機';
    if (/テレビ|TV/.test(t)) return 'テレビ';
    if (/エアコン/.test(t)) return 'エアコン';
    return t || '未設定';
  }

  function finalDetectSize(row){
    const size = [];
    for (let i=23; i<=30; i++) size.push(finalNumber(row[i]));
    if (typeof detectMainSize === 'function') return detectMainSize(size);
    const idx = size.findIndex(v => v > 0);
    return idx >= 0 ? `サイズ${idx+1}` : '未設定';
  }

  function finalIsProductRow(r){
    if (!r) return false;
    return r.source === 'area_csv' || r.importKind === 'product_address_csv' || r.importKindLabel === '商品・住所CSV' || (!!r.slipNo && (!!r.zip || !!r.address || !!r.destAddress));
  }

  function finalRemoveProductMonth(ym){
    STATE.areaData = (STATE.areaData || []).filter(r => !(r && r.ym === ym && finalIsProductRow(r)));
    STATE.fieldData = (STATE.fieldData || []).filter(d => !(d && d.ym === ym && d.source === 'area_csv'));
  }

  function finalRemoveWorkerMonth(ym){
    STATE.areaData = (STATE.areaData || []).filter(r => !(r && r.ym === ym && r.source === 'worker_csv'));
    STATE.fieldData = (STATE.fieldData || []).filter(d => !(d && d.ym === ym && d.source === 'worker_csv'));
  }

  async function finalReadCsv(file){
    const text = await CSV.read(file);
    const rows = CSV.toRows(text);
    if (!rows || rows.length < 2) throw new Error(`${file.name}: CSV明細行がありません`);
    return rows;
  }

  function finalParseProductRows(rows, fileName, ym){
    const header = rows[0] || [];
    const bySlip = new Map();
    let rawLineCount = 0;
    let blankSlipCount = 0;

    for (let r=1; r<rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some(v => String(v || '').trim())) continue;
      rawLineCount++;

      const slipNo = String(row[8] ?? '').trim(); // I列：エスライン原票番号
      if (!slipNo) { blankSlipCount++; continue; }

      const zip = finalNormalizeZip(row[11]); // L列：郵便番号
      const address = String(row[12] ?? '').trim();
      const destAddress = String(row[13] ?? '').trim();
      const product = String(row[15] ?? '').trim(); // P列：商品
      const itemCode = String(row[16] ?? '').trim();
      const workContent = String(row[17] ?? '').trim(); // R列：作業内容
      const amount = finalNumber(row[20]); // U列：金額
      const area = finalAreaName(address, destAddress, zip);

      if (!bySlip.has(slipNo)) {
        const size = [];
        for (let i=23; i<=30; i++) size.push(finalNumber(row[i]));
        bySlip.set(slipNo, {
          ym,
          source:'area_csv',
          importKind:'product_address_csv',
          importKindLabel:'商品・住所CSV',
          fileName,
          importedAt:new Date().toISOString(),
          lineNo:r+1,
          slipNo,
          deliveredDate: typeof normalizeDateText === 'function' ? normalizeDateText(row[0]) : String(row[0] || ''),
          shipperCode:String(row[1] ?? '').trim(),
          shipperName:String(row[2] ?? '').trim(),
          storeCode:String(row[3] ?? '').trim(),
          storeName:String(row[4] ?? '').trim(),
          branchCode:String(row[6] ?? '').trim(),
          branchName:String(row[7] ?? '').trim(),
          customerSlipNo:String(row[9] ?? '').trim(),
          zip,
          address,
          destAddress,
          customerName:String(row[14] ?? '').trim(),
          product,
          productCategory: finalClassifyProduct(product, workContent, itemCode),
          itemCode,
          workContent: workContent || '未設定',
          account: workContent || itemCode || '未設定',
          amount:0,
          unitPrice:finalNumber(row[18]),
          quantity:finalNumber(row[19]) || 1,
          recycleTicketNo:String(row[21] ?? '').trim(),
          recycleCompletedDate: typeof normalizeDateText === 'function' ? normalizeDateText(row[22]) : String(row[22] || ''),
          size,
          mainSize: finalDetectSize(row),
          area,
          count:1,
          rawLineCount:0,
          duplicateExcludedLineCount:0,
          workDetails:[],
          accounts:{},
          rawHeader:header
        });
      }

      const rec = bySlip.get(slipNo);
      rec.rawLineCount += 1;
      if (rec.rawLineCount > 1) rec.duplicateExcludedLineCount += 1;

      // 重複行は件数・P列商品・サイズには使わない。R列作業内容とU列金額だけ原票へ紐付ける。
      const account = workContent || itemCode || '未設定';
      rec.amount += amount;
      rec.accounts[account] = (rec.accounts[account] || 0) + amount;
      rec.workDetails.push({ workContent:workContent || '未設定', account, amount, lineNo:r+1 });
      rec.workContent = [...new Set(rec.workDetails.map(x=>x.workContent).filter(Boolean))].join(' / ') || '未設定';
      rec.account = [...new Set(rec.workDetails.map(x=>x.account).filter(Boolean))].join(' / ') || '未設定';
    }

    const uniqueRecords = [...bySlip.values()].map(r => ({
      ...r,
      duplicateSlipCount:r.rawLineCount,
      isDuplicateSlip:r.rawLineCount > 1,
      duplicateNote:r.rawLineCount > 1 ? `同一原票内の重複${r.rawLineCount}行。件数・商品・サイズは1件扱い。R列/U列のみ集計。` : ''
    }));

    const duplicateGroups = uniqueRecords
      .filter(r => r.rawLineCount > 1)
      .map(r => ({ slipNo:r.slipNo, lineCount:r.rawLineCount, excludedLineCount:r.duplicateExcludedLineCount, address:r.address || r.destAddress || '', product:r.product || '', accounts:Object.keys(r.accounts || {}), amount:r.amount }))
      .sort((a,b)=>b.lineCount-a.lineCount || String(a.slipNo).localeCompare(String(b.slipNo)));

    return {
      ym,
      source:'area_csv',
      fileName,
      rawLineCount,
      blankSlipCount,
      uniqueSlipCount:uniqueRecords.length,
      excludedDuplicateLineCount:uniqueRecords.reduce((s,r)=>s+n(r.duplicateExcludedLineCount),0),
      duplicateGroups,
      uniqueRecords
    };
  }

  function finalRebuildProductSummary(ym, parsed){
    const rows = finalUniqueProductRows(ym);
    const areas = {};
    for (const r of rows) {
      const area = r.area || finalAreaName(r.address, r.destAddress, r.zip);
      if (!areas[area]) areas[area] = { count:0, lineCount:0, amount:0, shippers:{}, products:{}, accounts:{}, size:[0,0,0,0,0,0,0,0], zipSet:{}, duplicateExcludedLineCount:0 };
      areas[area].count += 1;
      areas[area].lineCount += n(r.rawLineCount || 1);
      areas[area].amount += n(r.amount);
      areas[area].duplicateExcludedLineCount += n(r.duplicateExcludedLineCount);
      if (r.zip) areas[area].zipSet[r.zip] = true;
      (r.size || []).forEach((v,i)=>{ areas[area].size[i] += n(v); });
      const shipper = r.shipperName || r.shipperCode || '未設定';
      if (!areas[area].shippers[shipper]) areas[area].shippers[shipper] = { count:0, amount:0, lineCount:0 };
      areas[area].shippers[shipper].count += 1;
      areas[area].shippers[shipper].amount += n(r.amount);
      areas[area].shippers[shipper].lineCount += n(r.rawLineCount || 1);
      const product = r.productCategory || '未設定';
      areas[area].products[product] = (areas[area].products[product] || 0) + 1;
      for (const acc of Object.keys(r.accounts || {})) areas[area].accounts[acc] = (areas[area].accounts[acc] || 0) + n(r.accounts[acc]);
    }
    STATE.fieldData = (STATE.fieldData || []).filter(d => !(d && d.ym === ym && d.source === 'area_csv'));
    STATE.fieldData.push({
      ym,
      source:'area_csv',
      label:'商品・住所CSV',
      areas,
      importedAt:new Date().toISOString(),
      rowCount:rows.length,
      rawLineCount:parsed.rawLineCount,
      uniqueSlipCount:parsed.uniqueSlipCount,
      duplicateSlipCount:parsed.duplicateGroups.length,
      duplicateLineCount:parsed.rawLineCount,
      duplicateExcludedLineCount:parsed.excludedDuplicateLineCount,
      duplicateGroups:parsed.duplicateGroups,
      note:'件数はI列エスライン原票番号のユニーク件数。重複行は商品・サイズ判定から除外し、R列作業内容/U列金額のみ原票番号へ紐付け。'
    });
    STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)));
  }

  function finalUniqueProductRows(ym){
    const rows = (STATE.areaData || []).filter(r => r && r.ym === ym && finalIsProductRow(r));
    const map = new Map();
    for (const r of rows) {
      const key = String(r.slipNo || '').trim();
      if (!key) continue;
      const old = map.get(key);
      if (!old || String(r.importedAt || '') >= String(old.importedAt || '')) map.set(key, r);
    }
    return [...map.values()];
  }

  async function finalImportProductFiles(files){
    const ym = finalYMFromControls('product');
    const arr = Array.from(files || []).filter(f=>/\.csv$/i.test(f.name));
    if (!arr.length) { UI.toast('商品・住所CSVを選択してください', 'warn'); return; }

    // 複数ファイルを選んだ場合も、同じ年月の過去商品住所CSVを先に完全削除してから入れる。
    finalRemoveProductMonth(ym);
    let lastParsed = null;
    let importedFiles = 0;
    for (const file of arr) {
      UI.toast(`${file.name} を商品・住所CSVとして解析中...`);
      const parsed = finalParseProductRows(await finalReadCsv(file), file.name, ym);
      if (!parsed.uniqueRecords.length) { UI.toast(`${file.name}: 商品・住所CSVとして読める行がありません`, 'warn'); continue; }
      STATE.areaData.push(...parsed.uniqueRecords);
      lastParsed = parsed;
      importedFiles++;
    }
    if (!importedFiles || !lastParsed) return;

    STATE.areaData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)) || String(a.source).localeCompare(String(b.source)) || String(a.slipNo || '').localeCompare(String(b.slipNo || '')));
    finalRebuildProductSummary(ym, lastParsed);
    finalAfterFieldImport();
    UI.toast(`${ymLabel(ym)} 商品・住所CSVを入替完了：原票${fmt(finalUniqueProductRows(ym).length)}件 / 明細${fmt(lastParsed.rawLineCount)}行 / 重複除外${fmt(lastParsed.excludedDuplicateLineCount)}行`);
  }

  function finalAfterFieldImport(){
    STORE.save();
    if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC.schedule) AUTO_SYNC.schedule();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
    if (window.FIELD_UI && FIELD_UI.updatePeriodBadge) FIELD_UI.updatePeriodBadge();
    if (window.FIELD_UI && FIELD_UI.renderMap) FIELD_UI.renderMap();
    NAV.refresh();
    if (UI.updateSaveStatus) UI.updateSaveStatus();
  }

  function finalHideOldArtifacts(){
    const tbody = document.getElementById('f-city-tbody');
    const card = tbody ? tbody.closest('.card') : null;
    if (card) card.classList.add('field-final-old-table-hidden');
    const debug = document.getElementById('map-debug-info');
    if (debug) debug.style.display = 'none';
  }

  function finalMetric(){ return document.getElementById('map-metric-sel')?.value || 'count'; }
  function finalMode(){ return document.getElementById('field-area-view-mode')?.value || 'overall'; }
  function finalSort(){ return document.getElementById('field-area-sort-mode')?.value || 'count'; }

  function finalBuildAgg(ym){
    const rows = finalUniqueProductRows(ym);
    const cityMap = new Map();
    const prefMap = new Map();
    let totalCount = 0;
    let totalAmount = 0;
    for (const r of rows) {
      const pc = finalSplitPrefCity(r.area || finalAreaName(r.address, r.destAddress, r.zip));
      const key = `${pc.pref}||${pc.city}`;
      if (!cityMap.has(key)) cityMap.set(key, { pref:pc.pref, city:pc.city, area:pc.area, count:0, amount:0, rawLineCount:0 });
      const c = cityMap.get(key);
      c.count += 1;
      c.amount += n(r.amount);
      c.rawLineCount += n(r.rawLineCount || 1);
      if (!prefMap.has(pc.pref)) prefMap.set(pc.pref, { pref:pc.pref, count:0, amount:0, rawLineCount:0, cities:[] });
      const p = prefMap.get(pc.pref);
      p.count += 1;
      p.amount += n(r.amount);
      p.rawLineCount += n(r.rawLineCount || 1);
      totalCount += 1;
      totalAmount += n(r.amount);
    }
    const cities = [...cityMap.values()];
    for (const p of prefMap.values()) p.cities = cities.filter(c => c.pref === p.pref);
    return { rows, cities, prefs:[...prefMap.values()], totalCount, totalAmount };
  }

  function finalSortAreas(list, metric, sortMode){
    const arr = [...list];
    if (sortMode === 'name') return arr.sort((a,b)=>String(a.area || a.city || a.pref).localeCompare(String(b.area || b.city || b.pref), 'ja'));
    if (sortMode === 'amount' || metric === 'amount') return arr.sort((a,b)=>n(b.amount)-n(a.amount) || n(b.count)-n(a.count) || String(a.area || a.city).localeCompare(String(b.area || b.city),'ja'));
    return arr.sort((a,b)=>n(b.count)-n(a.count) || n(b.amount)-n(a.amount) || String(a.area || a.city).localeCompare(String(b.area || b.city),'ja'));
  }

  function finalBarRow(item, maxVal, metric, totalCount, totalAmount, rank){
    const val = metric === 'amount' ? n(item.amount) : n(item.count);
    const w = Math.max(2, Math.min(100, Math.round((val / Math.max(maxVal,1)) * 100)));
    const label = item.area || ((item.pref && item.city) ? item.pref + item.city : (item.city || item.pref || '未設定'));
    const ratio = metric === 'amount' ? n(item.amount) / Math.max(totalAmount,1) * 100 : n(item.count) / Math.max(totalCount,1) * 100;
    const main = metric === 'amount' ? `${fmtK(item.amount)}千円` : `${fmt(item.count)}件`;
    const sub = metric === 'amount' ? `${fmt(item.count)}件・${pct(ratio)}` : `${fmtK(item.amount)}千円・${pct(ratio)}`;
    return `<div class="field-final-row ${rank ? '' : 'no-rank'}">${rank ? `<div style="text-align:center;font-weight:900;color:#64748b">${rank}</div>` : ''}<div class="field-final-name" title="${esc(label)}">${esc(label)}</div><div class="field-final-track"><div class="field-final-bar" style="width:${w}%"></div></div><div class="field-final-value"><div>${main}</div><div class="field-final-sub">${sub}</div></div></div>`;
  }

  function finalSummary(agg, ym){
    return `<div class="field-final-summary"><div class="field-final-kpi"><div class="field-final-kpi-label">対象月</div><div class="field-final-kpi-value">${ymLabel(ym)}</div></div><div class="field-final-kpi"><div class="field-final-kpi-label">原票ユニーク件数</div><div class="field-final-kpi-value">${fmt(agg.totalCount)}件</div></div><div class="field-final-kpi"><div class="field-final-kpi-label">U列金額合計</div><div class="field-final-kpi-value">${fmtK(agg.totalAmount)}千円</div></div></div>`;
  }

  function finalRenderOverall(map, agg, ym, metric, sortMode){
    const list = finalSortAreas(agg.cities, metric, sortMode);
    const maxVal = Math.max(...list.map(x => metric === 'amount' ? n(x.amount) : n(x.count)), 1);
    map.innerHTML = `<div class="field-final-wrap">${finalSummary(agg, ym)}<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><div><div style="font-size:14px;font-weight:900;color:#0f172a">全体ランキング</div><div style="font-size:11px;color:#64748b;margin-top:3px">同一原票番号は1件化。再取込時は同年月データを入替しています。</div></div><div style="font-size:11px;color:#64748b;font-weight:800">${fmt(list.length)}地区</div></div><div style="border-top:1px solid #e5e7eb">${list.map((x,i)=>finalBarRow(x,maxVal,metric,agg.totalCount,agg.totalAmount,i+1)).join('')}</div></div>`;
  }

  function finalRenderPref(map, agg, ym, metric, sortMode){
    const prefs = [...agg.prefs].sort((a,b)=>n(b.count)-n(a.count) || String(a.pref).localeCompare(String(b.pref),'ja'));
    map.innerHTML = `<div class="field-final-wrap">${finalSummary(agg, ym)}<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><div><div style="font-size:14px;font-weight:900;color:#0f172a">都道府県別</div><div style="font-size:11px;color:#64748b;margin-top:3px">「＋ 開く」で都道府県内の市区町村を確認できます。</div></div><button type="button" id="field-final-open-all" class="btn" style="font-size:11px;padding:5px 10px">すべて開く</button></div>${prefs.map((p,idx)=>{ const cities=finalSortAreas(p.cities,metric,sortMode); const maxVal=Math.max(...cities.map(x=>metric==='amount'?n(x.amount):n(x.count)),1); const ratio=n(p.count)/Math.max(agg.totalCount,1)*100; return `<details class="field-final-pref" ${idx===0?'open':''}><summary><span class="field-final-toggle">＋ 開く</span><span style="font-weight:900;color:#0f172a;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.pref)}</span><span style="text-align:right;font-weight:900">${fmt(p.count)}件</span><span style="text-align:right;font-weight:900">${fmtK(p.amount)}千円</span><span style="text-align:right;color:#64748b;font-weight:800">${pct(ratio)}</span></summary><div class="field-final-pref-body">${cities.map(c=>finalBarRow(c,maxVal,metric,agg.totalCount,agg.totalAmount,null)).join('')}</div></details>`; }).join('')}</div>`;
    const allBtn = document.getElementById('field-final-open-all');
    if (allBtn) allBtn.onclick = function(){ const details=[...document.querySelectorAll('.field-final-pref')]; const shouldOpen=details.some(d=>!d.open); details.forEach(d=>d.open=shouldOpen); allBtn.textContent=shouldOpen?'すべて閉じる':'すべて開く'; };
  }

  function finalRenderMap(){
    finalInjectStyle();
    finalHideOldArtifacts();
    const map = document.getElementById('field-map');
    const noData = document.getElementById('map-no-data');
    if (!map) return;
    const ym = finalFieldYM();
    const agg = finalBuildAgg(ym);
    if (!agg.rows.length) {
      map.innerHTML = '<div class="field-final-wrap" style="padding:36px;text-align:center;color:#94a3b8;font-weight:800">対象月の商品・住所CSVがありません。</div>';
      if (noData) noData.style.display = 'none';
      return;
    }
    if (noData) noData.style.display = 'none';
    if (finalMode() === 'pref') finalRenderPref(map, agg, ym, finalMetric(), finalSort());
    else finalRenderOverall(map, agg, ym, finalMetric(), finalSort());
  }

  function finalDeleteFieldData(ym){
    if (!ym) return;
    STATE.fieldData = (STATE.fieldData || []).filter(d => d && d.ym !== ym);
    STATE.areaData = (STATE.areaData || []).filter(r => r && r.ym !== ym);
    STORE.save();
    if (typeof AUTO_SYNC !== 'undefined' && AUTO_SYNC.schedule) AUTO_SYNC.schedule();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
    if (window.FIELD_UI && FIELD_UI.updatePeriodBadge) FIELD_UI.updatePeriodBadge();
    finalRenderMap();
    NAV.refresh();
    UI.toast(`${ymLabel(ym)} の現場CSVデータを完全削除しました`);
  }

  finalInjectStyle();

  window.FIELD_PRODUCT_IMPORT2 = window.FIELD_PRODUCT_IMPORT2 || {};
  window.FIELD_PRODUCT_IMPORT2.handleFiles = function(files){ finalImportProductFiles(files).catch(err=>UI.toast(err.message,'error')); };
  window.FIELD_PRODUCT_IMPORT2.handleDrop = function(e){ e.preventDefault(); e.currentTarget && e.currentTarget.classList.remove('drag'); finalImportProductFiles(e.dataTransfer && e.dataTransfer.files).catch(err=>UI.toast(err.message,'error')); };

  if (typeof IMPORT !== 'undefined') IMPORT.deleteFieldData = finalDeleteFieldData;
  if (window.FIELD_UI) FIELD_UI.renderMap = finalRenderMap;

  document.addEventListener('change', function(e){
    if(e.target && ['map-metric-sel','field-area-view-mode','field-area-sort-mode','map-data-sel','field-month-sel','field-fy-sel'].includes(e.target.id)){
      try{ finalRenderMap(); }catch(err){ console.error(err); }
    }
  });

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(()=>{ try{ finalInjectStyle(); finalHideOldArtifacts(); if(STATE.view==='field') finalRenderMap(); }catch(e){} }, 300);
  });
})();

/* =========================================================
   2026-04-29 現場CSV最終補正
   ・エリア地図の白背景から文字がはみ出す問題を修正
   ・現場明細の月別削除／全件削除を areaData まで確実に削除
   ・削除後にクラウド full_state へ即時反映して、再読込で復活しないようにする
========================================================= */
(function(){
  'use strict';

  function safeCall(fn){ try { if (typeof fn === 'function') fn(); } catch(e){ console.error(e); } }

  function injectFieldLayoutFix(){
    let st = document.getElementById('field-csv-overflow-delete-fix-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'field-csv-overflow-delete-fix-style';
      document.head.appendChild(st);
    }
    st.textContent = `
      /* エリア地図カードの背景・文字はみ出し防止 */
      #field-map{
        display:block!important;
        position:relative!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:hidden!important;
        background:#fff!important;
      }
      #field-map .field-final-wrap{
        display:block!important;
        width:100%!important;
        max-width:100%!important;
        background:#fff!important;
        overflow:hidden!important;
        border-radius:0 0 8px 8px;
      }
      #field-map .field-final-row{
        width:100%!important;
        max-width:100%!important;
        grid-template-columns:44px minmax(160px,280px) minmax(120px,1fr) 120px!important;
        padding:8px 0!important;
      }
      #field-map .field-final-row.no-rank{
        grid-template-columns:minmax(160px,280px) minmax(120px,1fr) 120px!important;
      }
      #field-map .field-final-name,
      #field-map .field-final-value,
      #field-map .field-final-sub{
        min-width:0!important;
        max-width:100%!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
      }
      #field-map .field-final-track{
        min-width:0!important;
        width:100%!important;
        max-width:100%!important;
      }
      #field-map .field-final-bar{
        max-width:100%!important;
      }
      #field-map .field-final-pref,
      #field-map .field-final-pref-body{
        max-width:100%!important;
        overflow:hidden!important;
      }
      #field-map .field-final-pref summary{
        grid-template-columns:100px minmax(120px,1fr) 100px 110px 70px!important;
        max-width:100%!important;
        overflow:hidden!important;
      }
      #field-map + .card,
      .field-final-old-table-hidden{
        display:none!important;
      }
      @media(max-width:1100px){
        #field-map .field-final-row,
        #field-map .field-final-row.no-rank{
          grid-template-columns:36px minmax(120px,220px) minmax(100px,1fr) 105px!important;
        }
      }
    `;
  }

  function getFieldYMForDelete(){
    const sel = document.getElementById('field-month-sel');
    if (sel && sel.value) return sel.value;
    if (typeof dashboardSelectedYM === 'function') return dashboardSelectedYM();
    return (window.STATE && STATE.selYM) || null;
  }

  async function pushFieldDeletionToCloud(){
    if (typeof STORE !== 'undefined' && STORE.save) STORE.save();
    if (typeof CLOUD !== 'undefined' && CLOUD.pushAll) {
      try {
        await CLOUD.pushAll();
        if (typeof UI !== 'undefined' && UI.updateCloudBadge) UI.updateCloudBadge('ok');
      } catch(e) {
        console.error(e);
        if (typeof UI !== 'undefined' && UI.toast) UI.toast('クラウド反映に失敗しました。再度「今すぐ同期」を押してください。', 'warn');
      }
    }
  }

  function refreshFieldAfterDelete(){
    safeCall(()=>renderFieldDataList2());
    safeCall(()=>window.FIELD_UI && FIELD_UI.updatePeriodBadge && FIELD_UI.updatePeriodBadge());
    safeCall(()=>window.FIELD_UI && FIELD_UI.renderMap && FIELD_UI.renderMap());
    safeCall(()=>NAV && NAV.refresh && NAV.refresh());
    safeCall(()=>UI && UI.updateSaveStatus && UI.updateSaveStatus());
  }

  async function deleteFieldMonthFixed(ym){
    if (!ym) ym = getFieldYMForDelete();
    if (!ym) return;
    if (!confirm(`${ymLabel(ym)} の現場明細CSVを削除しますか？\n\n作業者CSV・商品住所CSVの両方を削除します。`)) return;

    STATE.fieldData = (STATE.fieldData || []).filter(d => d && d.ym !== ym);
    STATE.areaData  = (STATE.areaData  || []).filter(r => r && r.ym !== ym);

    refreshFieldAfterDelete();
    await pushFieldDeletionToCloud();
    refreshFieldAfterDelete();

    if (typeof UI !== 'undefined' && UI.toast) UI.toast(`${ymLabel(ym)} の現場明細CSVを削除しました`);
  }

  async function clearFieldAllFixed(){
    if (!confirm('現場明細データを全月削除しますか？\n\n作業者CSV・商品住所CSV・エリア集計をすべて削除します。')) return;

    STATE.fieldData = [];
    STATE.areaData  = [];

    refreshFieldAfterDelete();
    await pushFieldDeletionToCloud();
    refreshFieldAfterDelete();

    if (typeof UI !== 'undefined' && UI.toast) UI.toast('現場明細データを全件削除しました');
  }

  function forceReplaceDeleteHandlers(){
    if (typeof IMPORT !== 'undefined') IMPORT.deleteFieldData = deleteFieldMonthFixed;
    if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = clearFieldAllFixed;
  }

  injectFieldLayoutFix();
  forceReplaceDeleteHandlers();

  document.addEventListener('DOMContentLoaded', function(){
    injectFieldLayoutFix();
    forceReplaceDeleteHandlers();
    setTimeout(function(){
      injectFieldLayoutFix();
      forceReplaceDeleteHandlers();
      safeCall(()=>window.FIELD_UI && FIELD_UI.renderMap && FIELD_UI.renderMap());
    }, 300);
  });

  document.addEventListener('change', function(e){
    if (e.target && ['map-metric-sel','field-area-view-mode','field-area-sort-mode','map-data-sel','field-month-sel','field-fy-sel'].includes(e.target.id)) {
      setTimeout(injectFieldLayoutFix, 0);
    }
  });
})();

/* ════════════════════════════════════════════════════════════════
   FINAL PATCH 2026-04-29
   ・現場明細削除後に対象月プルダウンの「現場明細あり」が残る問題を修正
   ・fieldDataだけでなく areaData（商品住所CSV / 作業者CSV）を基準に月ステータスを判定
   ・削除後は月セレクト・右上バッジ・地図表示を必ず再描画
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  function safe(fn){ try { return fn(); } catch(e){ console.error(e); return null; } }

  function fieldMonthStatus(ym){
    const hasLegacyField = (STATE.fieldData || []).some(d => d && d.ym === ym);
    const hasWorkerCsv   = (STATE.areaData || []).some(r => r && r.ym === ym && r.source === 'worker_csv');
    const hasProductCsv  = (STATE.areaData || []).some(r => r && r.ym === ym && (r.source === 'area_csv' || r.source === 'product_address_csv'));

    if (hasWorkerCsv && hasProductCsv) return { has:true, label:'作業者・商品住所あり' };
    if (hasProductCsv) return { has:true, label:'商品住所あり' };
    if (hasWorkerCsv || hasLegacyField) return { has:true, label:'作業者CSVあり' };
    return { has:false, label:'未登録' };
  }

  const originalRenderCommonPeriodSelector = typeof renderCommonPeriodSelector === 'function' ? renderCommonPeriodSelector : null;
  window.renderCommonPeriodSelector = renderCommonPeriodSelector = function(viewKey, opt={}){
    if (viewKey !== 'field') {
      if (originalRenderCommonPeriodSelector) return originalRenderCommonPeriodSelector(viewKey, opt);
      return;
    }

    const view = document.getElementById('view-' + viewKey);
    if (!view) return;

    const useMonth = opt.useMonth !== false;
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
      const st = fieldMonthStatus(ym);
      const selected = ym === selectedYM ? 'selected' : '';
      return `<option value="${ym}" ${selected}>${ymLabel(ym)}（${st.label}）</option>`;
    }).join('');

    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
        <div>
          <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">表示対象</div>
          <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / 年度・月を共通管理</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
            <select id="${viewKey}-fy-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800">
              ${years.map(y=>`<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('')}
            </select>
          </label>
          ${useMonth ? `
          <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
            <select id="${viewKey}-month-sel" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:210px">
              ${monthOptions}
            </select>
          </label>` : ''}
        </div>
      </div>
    `;

    const fySel = document.getElementById(`${viewKey}-fy-select`);
    if (fySel) fySel.onchange = () => {
      STATE.fiscalYear = fySel.value;
      const months2 = monthsOfFiscalYear(STATE.fiscalYear);
      STATE.selYM = months2.includes(STATE.selYM) ? STATE.selYM : months2[months2.length - 1];
      STORE.save();
      NAV.refresh();
    };

    const moSel = document.getElementById(`${viewKey}-month-sel`);
    if (moSel) moSel.onchange = () => {
      STATE.selYM = moSel.value;
      STORE.save();
      NAV.refresh();
    };
  };

  function getCurrentFieldYM(){
    const sel = document.getElementById('field-month-sel');
    if (sel && sel.value) return sel.value;
    if (typeof dashboardSelectedYM === 'function') return dashboardSelectedYM();
    return STATE.selYM || null;
  }

  function redrawFieldScreen(){
    safe(()=>renderCommonPeriodSelector('field'));
    safe(()=>FIELD_UI && FIELD_UI.updatePeriodBadge && FIELD_UI.updatePeriodBadge());
    safe(()=>FIELD_UI && FIELD_UI.renderMap && FIELD_UI.renderMap());
    safe(()=>renderFieldDataList2 && renderFieldDataList2());
    safe(()=>UI && UI.updateSaveStatus && UI.updateSaveStatus());
  }

  if (window.FIELD_UI || typeof FIELD_UI !== 'undefined') {
    const target = window.FIELD_UI || FIELD_UI;
    target.updatePeriodBadge = function(){
      const badge = document.getElementById('field-period-badge');
      if (!badge) return;
      const ym = getCurrentFieldYM();
      const st = ym ? fieldMonthStatus(ym) : {has:false,label:'未登録'};
      badge.textContent = ym && st.has ? `${ymLabel(ym)} 読込済` : 'データ未読込';
    };
  }

  async function persistFieldDelete(){
    safe(()=>STORE.save());
    if (typeof CLOUD !== 'undefined' && CLOUD.pushAll) {
      try { await CLOUD.pushAll(); }
      catch(e){ console.error(e); safe(()=>UI.toast('クラウド反映に失敗しました。今すぐ同期を押してください。','warn')); }
    }
  }

  async function deleteFieldMonthAll(ym){
    ym = ym || getCurrentFieldYM();
    if (!ym) return;
    if (!confirm(`${ymLabel(ym)} の現場明細CSVを削除しますか？\n\n作業者CSV・商品住所CSVを削除します。`)) return;

    STATE.fieldData = (STATE.fieldData || []).filter(d => d && d.ym !== ym);
    STATE.areaData = (STATE.areaData || []).filter(r => r && r.ym !== ym);

    redrawFieldScreen();
    await persistFieldDelete();
    redrawFieldScreen();
    safe(()=>UI.toast(`${ymLabel(ym)} の現場明細CSVを削除しました`));
  }

  async function clearFieldAll(){
    if (!confirm('現場明細データを全月削除しますか？\n\n作業者CSV・商品住所CSVをすべて削除します。')) return;
    STATE.fieldData = [];
    STATE.areaData = [];
    redrawFieldScreen();
    await persistFieldDelete();
    redrawFieldScreen();
    safe(()=>UI.toast('現場明細データを全件削除しました'));
  }

  if (typeof IMPORT !== 'undefined') IMPORT.deleteFieldData = deleteFieldMonthAll;
  if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = clearFieldAll;
  window.deleteFieldMonthAll = deleteFieldMonthAll;
  window.clearFieldAll = clearFieldAll;

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(redrawFieldScreen, 250);
  });
})();

/* ════════════════════════════════════════════════════════════════
   FINAL PATCH 2026-04-29 現場明細CSV 削除永続化FIX
   ・商品住所CSVが削除後も月次登録チェック表に残る問題を修正
   ・削除済み月マーカーをlocalStorageに保持し、クラウド同期後の復活も防止
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  function safe(fn){ try { return fn(); } catch(e){ console.error(e); return null; } }
  function markerKey(){ return (typeof STORE !== 'undefined' && STORE._p ? STORE._p : 'mgmt5_field_') + 'deleted_field_months'; }
  function readMarkers(){ try { return JSON.parse(localStorage.getItem(markerKey()) || '{}') || {}; } catch(e){ return {}; } }
  function writeMarkers(v){ try { localStorage.setItem(markerKey(), JSON.stringify(v || {})); } catch(e){} }
  function markDeleted(ym){ if(!ym) return; const m=readMarkers(); m[String(ym)] = new Date().toISOString(); writeMarkers(m); }
  function unmarkDeleted(ym){ if(!ym) return; const m=readMarkers(); if (m[String(ym)]) { delete m[String(ym)]; writeMarkers(m); } }
  function isDeletedYM(ym){ return !!readMarkers()[String(ym)]; }
  function sameYM(v, ym){ return String(v || '') === String(ym || ''); }
  function isProductSource(r){ return r && (r.source === 'area_csv' || r.source === 'product_address_csv' || r.importKind === 'product_address_csv' || r.importKindLabel === '商品・住所CSV'); }
  function isWorkerSource(r){ return r && (r.source === 'worker_csv' || r.importKind === 'worker_csv' || r.importKindLabel === '作業者別CSV'); }
  function persistLocal(){ if (typeof STORE !== 'undefined' && STORE.save) STORE.save(); }
  function purgeDeletedMonthsFromState(){
    const markers = readMarkers();
    const beforeF = (STATE.fieldData || []).length;
    const beforeA = (STATE.areaData || []).length;
    STATE.fieldData = (STATE.fieldData || []).filter(d => d && !markers[String(d.ym || '')]);
    STATE.areaData  = (STATE.areaData  || []).filter(r => r && !markers[String(r.ym || '')]);
    return beforeF !== STATE.fieldData.length || beforeA !== STATE.areaData.length;
  }
  async function pushDeletionCloud(){
    persistLocal();
    if (typeof CLOUD === 'undefined') return;
    try {
      if (CLOUD._uploadJSON && CLOUD._fullStateKey && CLOUD._makeFullState) await CLOUD._uploadJSON(CLOUD._fullStateKey(), CLOUD._makeFullState());
      if (CLOUD._uploadJSON && CLOUD._manifestKey && CLOUD._makeManifest) await CLOUD._uploadJSON(CLOUD._manifestKey(), CLOUD._makeManifest());
      if (CLOUD._uploadJSON && CLOUD._fieldKey) await CLOUD._uploadJSON(CLOUD._fieldKey(), STATE.fieldData || []);
      if (typeof UI !== 'undefined' && UI.updateCloudBadge) UI.updateCloudBadge('ok');
    } catch(e) { console.error(e); safe(()=>UI.toast('クラウド反映に失敗しました。もう一度削除してください。','warn')); }
  }
  function redrawAllFieldViews(){
    safe(()=>renderFieldDataList2 && renderFieldDataList2());
    safe(()=>window.FIELD_UI && FIELD_UI.updatePeriodBadge && FIELD_UI.updatePeriodBadge());
    safe(()=>window.FIELD_UI && FIELD_UI.renderMap && FIELD_UI.renderMap());
    safe(()=>NAV && NAV.refresh && NAV.refresh());
    safe(()=>UI && UI.updateSaveStatus && UI.updateSaveStatus());
  }
  function currentFieldYM(){
    const sel = document.getElementById('field-month-sel');
    if (sel && sel.value) return sel.value;
    if (typeof dashboardSelectedYM === 'function') return dashboardSelectedYM();
    return STATE && STATE.selYM ? STATE.selYM : null;
  }
  async function deleteFieldMonthHard(ym){
    ym = ym || currentFieldYM();
    if (!ym) return;
    if (!confirm(`${ymLabel(ym)} の現場明細CSVを削除しますか？\n\n作業者CSV・商品住所CSVの両方を削除します。`)) return;
    markDeleted(ym);
    STATE.fieldData = (STATE.fieldData || []).filter(d => d && !sameYM(d.ym, ym));
    STATE.areaData  = (STATE.areaData  || []).filter(r => r && !sameYM(r.ym, ym));
    persistLocal();
    redrawAllFieldViews();
    await pushDeletionCloud();
    purgeDeletedMonthsFromState();
    persistLocal();
    redrawAllFieldViews();
    safe(()=>UI.toast(`${ymLabel(ym)} の現場明細CSVを削除しました`));
  }
  async function clearFieldAllHard(){
    if (!confirm('現場明細データを全月削除しますか？\n\n作業者CSV・商品住所CSVをすべて削除します。')) return;
    const m = readMarkers();
    (STATE.fieldData || []).forEach(d=>{ if(d && d.ym) m[String(d.ym)] = new Date().toISOString(); });
    (STATE.areaData || []).forEach(r=>{ if(r && r.ym) m[String(r.ym)] = new Date().toISOString(); });
    writeMarkers(m);
    STATE.fieldData = [];
    STATE.areaData = [];
    persistLocal();
    redrawAllFieldViews();
    await pushDeletionCloud();
    redrawAllFieldViews();
    safe(()=>UI.toast('現場明細データを全件削除しました'));
  }
  function unmarkFromImport(kind){
    let ym = null;
    if (typeof finalYMFromControls === 'function') ym = finalYMFromControls(kind);
    if (!ym && typeof dashboardSelectedYM === 'function') ym = dashboardSelectedYM();
    if (ym) unmarkDeleted(ym);
  }
  if (typeof FIELD_FINAL !== 'undefined') {
    if (FIELD_FINAL.importProductFiles && !FIELD_FINAL.importProductFiles._deleteFixWrapped2) {
      const oldProduct = FIELD_FINAL.importProductFiles.bind(FIELD_FINAL);
      FIELD_FINAL.importProductFiles = async function(files){ unmarkFromImport('product'); return oldProduct(files); };
      FIELD_FINAL.importProductFiles._deleteFixWrapped2 = true;
    }
    if (FIELD_FINAL.importWorkerFiles && !FIELD_FINAL.importWorkerFiles._deleteFixWrapped2) {
      const oldWorker = FIELD_FINAL.importWorkerFiles.bind(FIELD_FINAL);
      FIELD_FINAL.importWorkerFiles = async function(files){ unmarkFromImport('worker'); return oldWorker(files); };
      FIELD_FINAL.importWorkerFiles._deleteFixWrapped2 = true;
    }
  }
  if (typeof IMPORT !== 'undefined') IMPORT.deleteFieldData = deleteFieldMonthHard;
  if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = clearFieldAllHard;
  window.deleteFieldMonthAll = deleteFieldMonthHard;
  window.clearFieldAll = clearFieldAllHard;
  function fieldStateForMonthly(ym, source){
    if (isDeletedYM(ym)) return { label:'未登録', kind:'danger', note:'' };
    const rows = (STATE.areaData || []).filter(r => r && sameYM(r.ym, ym) && (source === 'worker_csv' ? isWorkerSource(r) : isProductSource(r)));
    if (!rows.length) return { label:'未登録', kind:'danger', note:'' };
    if (source === 'area_csv') {
      const meta = (STATE.fieldData || []).find(d=>d && sameYM(d.ym,ym) && d.source === 'area_csv') || {};
      const rawLine = meta.rawLineCount || rows.reduce((s,r)=>s+n(r.rawLineCount || 1),0);
      const dupLine = meta.duplicateExcludedLineCount || rows.reduce((s,r)=>s+n(r.duplicateExcludedLineCount || 0),0);
      return { label:'登録済', kind:'ok', note:`商品住所 原票${fmt(rows.length)}件 / 明細${fmt(rawLine)}行 / 重複除外${fmt(dupLine)}行` };
    }
    const workers = new Set(rows.map(r=>r.workerName).filter(Boolean)).size;
    return { label:'登録済', kind:'ok', note:`作業者 ${fmt(rows.length)}行 / ${fmt(workers)}名` };
  }
  if (typeof renderMonthlyCheckTable === 'function') {
    renderMonthlyCheckTable = function(){
      const fy = storageFiscalYear();
      const states = storageFiscalMonths(fy).map(ym => storageMonthState(fy, ym));
      const missingCount = states.filter(s => s.judge === '漏れ').length;
      const dailyOnlyCount = states.filter(s => s.judge === '注意').length;
      const abnormalCount = states.filter(s => s.judge === '異常').length;
      const histOnlyCount = states.filter(s => s.judge === '補完のみ').length;
      const summary = abnormalCount ? storageBadge(`異常 ${abnormalCount}件`, 'danger') : missingCount ? storageBadge(`漏れ ${missingCount}ヶ月`, 'danger') : dailyOnlyCount || histOnlyCount ? storageBadge(`確認 ${dailyOnlyCount + histOnlyCount}ヶ月`, 'warn') : storageBadge('12ヶ月 OK', 'ok');
      return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div></div><div>${summary}</div></div><div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>${states.map(s=>{ const worker=fieldStateForMonthly(s.ym,'worker_csv'); const detail=fieldStateForMonthly(s.ym,'area_csv'); const note=[s.note, worker.note, detail.note].filter(Boolean).join(' / '); return `<tr><td><strong>${ymLabel(s.ym)}</strong></td><td>${storageBadge(s.csvLabel,s.csvKind)}</td><td>${storageBadge(s.histLabel,s.histKind)}</td><td>${storageBadge(s.planLabel,s.planKind)}</td><td>${storageBadge(worker.label,worker.kind)}</td><td>${storageBadge(detail.label,detail.kind)}</td><td>${storageBadge(s.judge,s.kind)}</td><td style="min-width:360px;color:var(--text2)">${esc(note)}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    };
  }
  if (typeof CLOUD !== 'undefined' && CLOUD._applyFullState && !CLOUD._applyFullState._deleteFixWrapped2) {
    const oldApply = CLOUD._applyFullState.bind(CLOUD);
    CLOUD._applyFullState = function(full){ const r = oldApply(full); if (purgeDeletedMonthsFromState()) persistLocal(); return r; };
    CLOUD._applyFullState._deleteFixWrapped2 = true;
  }
  document.addEventListener('DOMContentLoaded', function(){ if (purgeDeletedMonthsFromState()) persistLocal(); setTimeout(redrawAllFieldViews, 300); });
})();

/* ════════════════════════════════════════════════════════════════
   FINAL FIELD CSV STABLE PATCH 2026-04-29 v2
   ・商品住所CSV / 作業者CSV を分離表示
   ・削除を月×種別で反映
   ・エリア地図の背景・文字はみ出しを修正
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  function safe(fn,fb){try{return fn();}catch(e){console.error(e);return fb;}}
  function num(v){const n=parseFloat(String(v??'').replace(/,/g,''));return isNaN(n)?0:n;}
  function yml(ym){return typeof ymLabel==='function'?ymLabel(ym):`${String(ym).slice(0,4)}年${parseInt(String(ym).slice(4,6),10)}月`;}
  function fm(v){return typeof fmt==='function'?fmt(v):Number(v||0).toLocaleString('ja-JP');}
  function es(s){return typeof esc==='function'?esc(s):String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function badge(label,kind){return typeof storageBadge==='function'?storageBadge(label,kind):`<span class="badge ${kind==='ok'?'badge-ok':'badge-warn'}">${es(label)}</span>`;}
  function isProd(r){return !!(r&&(r.source==='area_csv'||r.source==='product_address_csv'||r.importKind==='product_address_csv'||r.importKindLabel==='商品・住所CSV'||r.dataKind==='product_address_csv'));}
  function isWork(r){return !!(r&&(r.source==='worker_csv'||r.importKind==='worker_csv'||r.importKindLabel==='作業者別CSV'||r.dataKind==='worker_csv'));}
  function same(v,ym){return String(v||'')===String(ym||'');}
  function key(){return ((typeof STORE!=='undefined'&&STORE._p)?STORE._p:'mgmt5_field_')+'field_deleted_kind_v2';}
  function readM(){return safe(()=>JSON.parse(localStorage.getItem(key())||'{}')||{},{});}
  function writeM(m){safe(()=>localStorage.setItem(key(),JSON.stringify(m||{})));}
  function mark(ym,kind){const m=readM();m[ym]=m[ym]||{};m[ym][kind]=new Date().toISOString();writeM(m);}
  function unmark(ym,kind){const m=readM();if(m[ym]){delete m[ym][kind];if(!Object.keys(m[ym]).length)delete m[ym];writeM(m);}}
  function marked(ym,kind){const m=readM();return !!(m[String(ym)]&&m[String(ym)][kind]);}
  function prodRows(ym){return (STATE.areaData||[]).filter(r=>r&&same(r.ym,ym)&&isProd(r)&&!marked(ym,'product'));}
  function workRows(ym){return (STATE.areaData||[]).filter(r=>r&&same(r.ym,ym)&&isWork(r)&&!marked(ym,'worker'));}
  function prodMeta(ym){return (STATE.fieldData||[]).find(d=>d&&same(d.ym,ym)&&(d.source==='area_csv'||d.source==='product_address_csv'||d.importKind==='product_address_csv'))||{};}
  function workMeta(ym){return (STATE.fieldData||[]).find(d=>d&&same(d.ym,ym)&&(d.source==='worker_csv'||d.importKind==='worker_csv'))||{};}
  function currentYM(){const s=document.getElementById('field-month-sel');if(s&&s.value)return s.value;if(typeof dashboardSelectedYM==='function')return dashboardSelectedYM();return STATE.selYM||null;}
  function purge(){const ba=(STATE.areaData||[]).length,bf=(STATE.fieldData||[]).length;STATE.areaData=(STATE.areaData||[]).filter(r=>{if(!r||!r.ym)return false;if(isProd(r)&&marked(r.ym,'product'))return false;if(isWork(r)&&marked(r.ym,'worker'))return false;return true;});STATE.fieldData=(STATE.fieldData||[]).filter(d=>{if(!d||!d.ym)return false;const p=d.source==='area_csv'||d.source==='product_address_csv'||d.importKind==='product_address_csv';const w=d.source==='worker_csv'||d.importKind==='worker_csv';if(p&&marked(d.ym,'product'))return false;if(w&&marked(d.ym,'worker'))return false;return true;});return ba!==(STATE.areaData||[]).length||bf!==(STATE.fieldData||[]).length;}
  function save(){safe(()=>STORE&&STORE.save&&STORE.save());}
  async function push(){save();if(typeof CLOUD==='undefined')return;try{if(CLOUD._uploadJSON&&CLOUD._fullStateKey&&CLOUD._makeFullState)await CLOUD._uploadJSON(CLOUD._fullStateKey(),CLOUD._makeFullState());if(CLOUD._uploadJSON&&CLOUD._manifestKey&&CLOUD._makeManifest)await CLOUD._uploadJSON(CLOUD._manifestKey(),CLOUD._makeManifest());if(CLOUD._uploadJSON&&CLOUD._fieldKey)await CLOUD._uploadJSON(CLOUD._fieldKey(),STATE.fieldData||[]);}catch(e){console.error(e);safe(()=>UI.toast('クラウド反映に失敗しました。今すぐ同期を押してください。','warn'));}}
  function style(){let st=document.getElementById('field-stable-css-v2');if(st)st.remove();st=document.createElement('style');st.id='field-stable-css-v2';st.textContent=`#fpane-map .card,#fpane-map .card-body,#field-map{overflow:visible!important;height:auto!important;max-height:none!important}#field-map{min-height:120px!important;background:#fff}.field-stable-wrap{padding:14px 18px 18px;background:#fff;overflow:visible}.field-rank-row{display:grid;grid-template-columns:minmax(180px,270px) minmax(220px,1fr) minmax(90px,120px);gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid #eef1f5}.field-rank-name{font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.field-rank-bg{height:18px;background:#e5e7eb;border-radius:999px;overflow:hidden}.field-rank-bar{height:100%;background:#1a4d7c;border-radius:999px;min-width:2px}.field-rank-val{text-align:right;font-weight:900;white-space:nowrap}.field-kpis{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:10px;margin-bottom:14px}.field-kpi{border:1px solid var(--border,#e5e7eb);border-radius:12px;background:#f8fafc;padding:10px}.field-kpi div:first-child{font-size:11px;color:var(--text3,#8090a3);font-weight:800}.field-kpi div:last-child{font-size:18px;font-weight:900;margin-top:4px}.field-pref{border:1px solid var(--border,#e5e7eb);border-radius:12px;margin-bottom:10px;background:#fff;overflow:hidden}.field-pref summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;background:#f8fafc;padding:10px 12px;font-weight:900}.field-pref-body{padding:6px 12px 12px}.field-empty{padding:42px 16px;text-align:center;color:var(--text3,#8090a3);background:#fff}.field-list-month{border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:12px 14px;margin:10px 0;background:#fff}.field-list-grid{display:grid;grid-template-columns:1fr auto;gap:8px}.field-list-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}@media(max-width:900px){.field-rank-row{grid-template-columns:1fr 90px}.field-rank-bg{grid-column:1/-1}.field-kpis{grid-template-columns:1fr}}`;document.head.appendChild(st);}
  function label(r){const city=String(r.city||r.cityName||r.area||'').trim();const pref=String(r.prefecture||r.pref||'').trim();if(city&&pref&&city.startsWith(pref))return city;if(city&&pref)return pref+city;if(city)return city;const ad=String(r.address||'').trim();const m=ad.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.+?[市区町村])/);return m?m[1]+m[2]:'地域未判定';}
  function pref(label){const m=String(label||'').match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);return m?m[1]:'都道府県未判定';}
  function agg(ym){const rows=prodRows(ym);const mp=new Map();const total={count:0,amount:0};rows.forEach(r=>{const nm=label(r);const amount=num(r.amount??r.workAmount??r.totalAmount??r.price??0);if(!mp.has(nm))mp.set(nm,{name:nm,pref:pref(nm),count:0,amount:0});const x=mp.get(nm);x.count++;x.amount+=amount;total.count++;total.amount+=amount;});return{rows,items:[...mp.values()],total};}
  function sortItems(items,metric,sort){const a=[...items];if(sort==='amount')a.sort((x,y)=>y.amount-x.amount||y.count-x.count||x.name.localeCompare(y.name,'ja'));else if(sort==='name')a.sort((x,y)=>x.name.localeCompare(y.name,'ja'));else a.sort((x,y)=>y.count-x.count||y.amount-x.amount||x.name.localeCompare(y.name,'ja'));return a;}
  function rank(items,metric,total){const max=Math.max(1,...items.map(i=>metric==='amount'?i.amount:i.count));return items.map((i,idx)=>{const v=metric==='amount'?i.amount:i.count;const pct=total? v/total*100:0;const w=Math.max(2,v/max*100);const vt=metric==='amount'?`${fm(Math.round(v/1000))}千円`:`${fm(v)}件`;return `<div class="field-rank-row"><div class="field-rank-name" title="${es(i.name)}">${idx+1}. ${es(i.name)}</div><div class="field-rank-bg"><div class="field-rank-bar" style="width:${w}%"></div></div><div class="field-rank-val">${vt}<span style="font-size:11px;color:var(--text3);margin-left:6px">${pct.toFixed(1)}%</span></div></div>`}).join('');}
  function renderMap(){style();const box=document.getElementById('field-map');if(!box)return;const no=document.getElementById('map-no-data');if(no)no.style.display='none';const ym=currentYM();const metric=(document.getElementById('map-metric-sel')||{}).value==='amount'?'amount':'count';const sort=(document.getElementById('map-sort-sel')||document.getElementById('field-map-sort-sel')||{}).value||metric;const mode=(document.getElementById('map-view-mode-sel')||document.getElementById('field-map-view-mode-sel')||{}).value||'ranking';const d=agg(ym);if(!ym||!d.rows.length){box.innerHTML=`<div class="field-empty"><div style="font-weight:900;margin-bottom:6px">商品・住所CSVを読み込んでください</div><div style="font-size:12px">エリア地図は商品・住所CSVをI列エスライン原票番号で1件化して表示します。作業者CSVだけでは表示しません。</div></div>`;return;}const totalMetric=metric==='amount'?d.total.amount:d.total.count;const sorted=sortItems(d.items,metric,sort);let body='';if(mode==='pref'){const pm=new Map();sorted.forEach(i=>{if(!pm.has(i.pref))pm.set(i.pref,[]);pm.get(i.pref).push(i)});body=[...pm.entries()].map(([p,list])=>({p,list:sortItems(list,metric,sort),count:list.reduce((s,i)=>s+i.count,0),amount:list.reduce((s,i)=>s+i.amount,0)})).sort((a,b)=>metric==='amount'?b.amount-a.amount:b.count-a.count).map((p,i)=>`<details class="field-pref" ${i<3?'open':''}><summary><span>＋ ${es(p.p)}</span><span>${fm(p.list.length)}地区 / ${metric==='amount'?fm(Math.round(p.amount/1000))+'千円':fm(p.count)+'件'}</span></summary><div class="field-pref-body">${rank(p.list,metric,metric==='amount'?p.amount:p.count)}</div></details>`).join('')}else{body=`<div style="font-size:12px;color:var(--text2);margin-bottom:8px">全体ランキング：市区町村を全体で並べます。I列原票番号で1件化済み。</div>${rank(sorted,metric,totalMetric)}`;}box.innerHTML=`<div class="field-stable-wrap"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div style="font-weight:900">${yml(ym)} / 商品・住所CSV / I列原票番号ユニーク件数で集計</div><div style="font-size:12px;color:var(--text3)">${fm(d.items.length)}地区</div></div><div class="field-kpis"><div class="field-kpi"><div>原票ユニーク件数</div><div>${fm(d.total.count)}件</div></div><div class="field-kpi"><div>U列金額合計</div><div>${fm(Math.round(d.total.amount/1000))}千円</div></div><div class="field-kpi"><div>表示地区数</div><div>${fm(d.items.length)}地区</div></div></div>${body}</div>`;}
  function months(){const s=new Set();(STATE.areaData||[]).forEach(r=>{if(r&&r.ym)s.add(String(r.ym))});(STATE.fieldData||[]).forEach(d=>{if(d&&d.ym)s.add(String(d.ym))});return[...s].sort();}
  function renderList(){purge();const list=document.getElementById('field-data-list2');if(!list)return;const ms=months();if(!ms.length){list.innerHTML='<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>';const row=document.getElementById('field-delete-all-row');if(row)row.style.display='none';return;}list.innerHTML=ms.map(ym=>{const p=prodRows(ym),w=workRows(ym),pm=prodMeta(ym);const pLine=p.length?`✅ 商品・住所CSV 原票${fm(p.length)}件 / 明細${fm(pm.rawLineCount||p.reduce((s,r)=>s+num(r.rawLineCount||1),0))}行 / 重複除外${fm(pm.duplicateExcludedLineCount||p.reduce((s,r)=>s+num(r.duplicateExcludedLineCount||0),0))}行`:'□ 商品・住所CSV 未登録';const wLine=w.length?`✅ 作業者別CSV ${fm(w.length)}行 / 作業者${fm(new Set(w.map(r=>r.workerName).filter(Boolean)).size)}名`:'□ 作業者別CSV 未登録';return `<div class="field-list-month"><div class="field-list-grid"><div><div style="font-size:14px;font-weight:900;margin-bottom:6px">${yml(ym)}</div><div style="font-size:12px;line-height:1.8;color:var(--text2)">${pLine}<br>${wLine}</div></div><div class="field-list-actions">${p.length?`<button class="btn btn-danger" onclick="deleteFieldCsvKindStable('${ym}','product')" style="font-size:11px;padding:3px 8px">商品住所削除</button>`:''}${w.length?`<button class="btn btn-danger" onclick="deleteFieldCsvKindStable('${ym}','worker')" style="font-size:11px;padding:3px 8px">作業者削除</button>`:''}<button class="btn btn-danger" onclick="deleteFieldCsvMonthStable('${ym}')" style="font-size:11px;padding:3px 8px">月削除</button></div></div></div>`}).join('');const row=document.getElementById('field-delete-all-row');if(row)row.style.display='flex';}
  async function deleteKind(ym,kind,ask=true){const label=kind==='product'?'商品・住所CSV':'作業者CSV';if(ask&&!confirm(`${yml(ym)} の ${label} を削除しますか？`))return;mark(ym,kind);STATE.areaData=(STATE.areaData||[]).filter(r=>{if(!same(r&&r.ym,ym))return true;if(kind==='product'&&isProd(r))return false;if(kind==='worker'&&isWork(r))return false;return true});STATE.fieldData=(STATE.fieldData||[]).filter(d=>{if(!same(d&&d.ym,ym))return true;const p=d.source==='area_csv'||d.source==='product_address_csv'||d.importKind==='product_address_csv';const w=d.source==='worker_csv'||d.importKind==='worker_csv';if(kind==='product'&&p)return false;if(kind==='worker'&&w)return false;return true});save();redraw();await push();redraw();safe(()=>UI.toast(`${yml(ym)} の ${label} を削除しました`));}
  async function deleteMonth(ym){if(!confirm(`${yml(ym)} の現場明細CSVを削除しますか？\n\n商品・住所CSV／作業者CSVの両方を削除します。`))return;await deleteKind(ym,'product',false);await deleteKind(ym,'worker',false);}
  async function clearAll(){if(!confirm('現場明細CSVを全月削除しますか？'))return;months().forEach(ym=>{mark(ym,'product');mark(ym,'worker')});STATE.areaData=[];STATE.fieldData=[];save();redraw();await push();redraw();}
  window.deleteFieldCsvKindStable=deleteKind;window.deleteFieldCsvMonthStable=deleteMonth;window.clearFieldCsvAllStable=clearAll;if(typeof IMPORT!=='undefined')IMPORT.deleteFieldData=deleteMonth;if(typeof DATA_RESET!=='undefined')DATA_RESET.clearFieldAll=clearAll;
  window.fieldMonthStatus=function(ym){const p=prodRows(ym).length,w=workRows(ym).length;if(p&&w)return{has:true,label:'商品住所・作業者あり'};if(p)return{has:true,label:'商品住所あり'};if(w)return{has:true,label:'作業者CSVあり'};return{has:false,label:'未登録'}};
  if(typeof renderMonthlyCheckTable==='function'){window.renderMonthlyCheckTable=renderMonthlyCheckTable=function(){const fy=typeof storageFiscalYear==='function'?storageFiscalYear():(STATE.fiscalYear||new Date().getFullYear());const states=(typeof storageFiscalMonths==='function'?storageFiscalMonths(fy):[]).map(ym=>storageMonthState(fy,ym));const summary=badge('確認','warn');return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${parseInt(fy,10)+1}年3月（年度順）</div></div><div>${summary}</div></div><div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>${states.map(s=>{const w=workRows(s.ym),p=prodRows(s.ym),pm=prodMeta(s.ym);const wb=w.length?{label:'登録済',kind:'ok',note:`作業者 ${fm(w.length)}行 / ${fm(new Set(w.map(r=>r.workerName).filter(Boolean)).size)}名`}:{label:'未登録',kind:'danger',note:''};const pb=p.length?{label:'登録済',kind:'ok',note:`商品住所 原票${fm(p.length)}件 / 明細${fm(pm.rawLineCount||p.reduce((a,r)=>a+num(r.rawLineCount||1),0))}行 / 重複除外${fm(pm.duplicateExcludedLineCount||p.reduce((a,r)=>a+num(r.duplicateExcludedLineCount||0),0))}行`}:{label:'未登録',kind:'danger',note:''};const note=[s.note,wb.note,pb.note].filter(Boolean).join(' / ');return `<tr><td><strong>${yml(s.ym)}</strong></td><td>${badge(s.csvLabel,s.csvKind)}</td><td>${badge(s.histLabel,s.histKind)}</td><td>${badge(s.planLabel,s.planKind)}</td><td>${badge(wb.label,wb.kind)}</td><td>${badge(pb.label,pb.kind)}</td><td>${badge(s.judge,s.kind)}</td><td style="min-width:360px;color:var(--text2)">${es(note)}</td></tr>`}).join('')}</tbody></table></div></div>`}}
  function importYM(kind){if(typeof finalYMFromControls==='function')return finalYMFromControls(kind);return currentYM();}
  if(typeof FIELD_FINAL!=='undefined'){if(FIELD_FINAL.importProductFiles&&!FIELD_FINAL.importProductFiles._stableV2){const old=FIELD_FINAL.importProductFiles.bind(FIELD_FINAL);FIELD_FINAL.importProductFiles=async function(files){const ym=importYM('product');unmark(ym,'product');STATE.areaData=(STATE.areaData||[]).filter(r=>!(same(r&&r.ym,ym)&&isProd(r)));STATE.fieldData=(STATE.fieldData||[]).filter(d=>!(same(d&&d.ym,ym)&&(d.source==='area_csv'||d.source==='product_address_csv'||d.importKind==='product_address_csv')));save();const res=await old(files);redraw();return res};FIELD_FINAL.importProductFiles._stableV2=true}if(FIELD_FINAL.importWorkerFiles&&!FIELD_FINAL.importWorkerFiles._stableV2){const old=FIELD_FINAL.importWorkerFiles.bind(FIELD_FINAL);FIELD_FINAL.importWorkerFiles=async function(files){const ym=importYM('worker');unmark(ym,'worker');STATE.areaData=(STATE.areaData||[]).filter(r=>!(same(r&&r.ym,ym)&&isWork(r)));STATE.fieldData=(STATE.fieldData||[]).filter(d=>!(same(d&&d.ym,ym)&&(d.source==='worker_csv'||d.importKind==='worker_csv')));save();const res=await old(files);redraw();return res};FIELD_FINAL.importWorkerFiles._stableV2=true}}
  if(typeof CLOUD!=='undefined'&&CLOUD._applyFullState&&!CLOUD._applyFullState._stableV2){const old=CLOUD._applyFullState.bind(CLOUD);CLOUD._applyFullState=function(full){const r=old(full);if(purge())save();return r};CLOUD._applyFullState._stableV2=true}
  function redraw(){purge();safe(()=>renderFieldDataList2&&renderFieldDataList2());safe(()=>FIELD_UI&&FIELD_UI.updatePeriodBadge&&FIELD_UI.updatePeriodBadge());safe(()=>FIELD_UI&&FIELD_UI.renderMap&&FIELD_UI.renderMap());safe(()=>UI&&UI.updateSaveStatus&&UI.updateSaveStatus())}
  window.renderFieldDataList2=renderFieldDataList2=renderList;if(window.FIELD_UI||typeof FIELD_UI!=='undefined'){const ui=window.FIELD_UI||FIELD_UI;ui.renderMap=renderMap;ui.updatePeriodBadge=function(){const b=document.getElementById('field-period-badge');if(!b)return;const ym=currentYM();const st=window.fieldMonthStatus(ym);b.textContent=st.has?`${yml(ym)} 読込済`:'データ未読込'}}
  document.addEventListener('DOMContentLoaded',function(){style();if(purge())save();setTimeout(redraw,300)});setTimeout(function(){style();redraw()},600);
})();
