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
  areaData:  [],    // PDF：荷主別配送エリア別物量 [{ym,shipper,zip,address,area,count,...}]
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
    if (pdf.length)  { AREA_PDF_IMPORT.handleFiles(pdf); return; }
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
  // PDF内の日付は補助情報としてのみ使う。
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

  async importAreaPdf(files) {
    await AREA_PDF_IMPORT.handleFiles(files);
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
    ['エリア補完', `${fy}年度`, fieldRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), fieldRows.length?`${fieldRows.length}件`:'0件', '件数', '—', '作業者別CSV・エリアPDF由来。今後、年度別保管に拡張。', '今後実装'],
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

/* ════════ §27-A AREA PDF IMPORT（荷主別配送エリア別物量PDF） ════════
   対象帳票：荷主別配送エリア別物量
   取込内容：郵便番号・住所・件数・配送料・幹線料・付帯料金・サイズ①〜⑧
   注意：作業者別CSVとは完全に別処理。PDF内の日付ではなく画面選択中の年月で保存する。
════════════════════════════════════════════════════════════════ */
const AREA_PDF_IMPORT = {
  async handleFiles(files) {
    const arr = Array.from(files || []);
    const pdfs = arr.filter(f => /\.pdf$/i.test(f.name));
    const others = arr.filter(f => !/\.pdf$/i.test(f.name));

    for (const pdf of pdfs) await this.importPdf(pdf);

    if (others.length) IMPORT.handleFiles(others);
  },

  async importPdf(file) {
    try {
      UI.toast('荷主別配送エリア別物量PDFを解析中です...');
      await ASSETS.pdfjs();
      if (!window.pdfjsLib) throw new Error('PDF.jsを読み込めませんでした');

      const forcedYM = selectedYMForImport();
      if (!forcedYM) {
        UI.toast('先に取込対象の年度・月を選択してください', 'warn');
        return;
      }

      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

      let fullText = '';
      let allRecords = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageLines = this.itemsToLines(content.items);
        const pageText = pageLines.join('\n');
        fullText += '\n' + pageText;
        allRecords = allRecords.concat(this.parseLines(pageLines, p));
      }

      allRecords = allRecords.map(r => ({ ...r, ym: forcedYM, importedAt: new Date().toISOString(), sourceFileName: file.name }));

      if (!allRecords.length) {
        if (!Array.isArray(STATE.areaData)) STATE.areaData = [];
        STATE.areaData = STATE.areaData.filter(r => !(r.ym === forcedYM && r.sourceFileName === file.name));
        STATE.areaData.push({ ym: forcedYM, sourceFileName: file.name, rawOnly: true, rawText: fullText.slice(0, 800000), importedAt: new Date().toISOString() });
        STORE.save();
        renderFieldDataList2();
        UI.toast(`${ymLabel(forcedYM)} PDF原文は保存しましたが、明細行は読み込めませんでした`, 'warn');
        NAV.refresh();
        return;
      }

      const parsed = { ym: forcedYM, fileName: file.name, importedAt: new Date().toISOString(), totalCount: allRecords.reduce((sum, r) => sum + n(r.count), 0), records: allRecords };
      this.saveParsed(parsed);
      UI.toast(`${ymLabel(parsed.ym)} エリアPDF取込完了：${fmt(parsed.records.length)}行 / ${fmt(parsed.totalCount)}件`);
      NAV.refresh();
    } catch(e) {
      console.error(e);
      UI.toast('PDF取込エラー: ' + e.message, 'error');
    }
  },

  itemsToLines(items) {
    const buckets = [];
    for (const it of items || []) {
      const str = String(it.str || '').trim();
      if (!str) continue;
      const tr = it.transform || [];
      const x = Number(tr[4] || 0);
      const y = Number(tr[5] || 0);
      let bucket = buckets.find(b => Math.abs(b.y - y) <= 2.4);
      if (!bucket) { bucket = { y, items: [] }; buckets.push(bucket); }
      bucket.items.push({ x, str });
    }
    return buckets.sort((a,b) => b.y - a.y).map(b => b.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').replace(/[　]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  },

  parseLines(lines, pageNo) {
    const records = [];
    let currentMeta = { shipperCode:'', shipperName:'', pdfDateFrom:'', pdfDateTo:'' };
    const expanded = [];
    for (const raw of lines || []) {
      const line = String(raw || '').trim();
      if (!line) continue;
      const safe = line.replace(/(\d)\s*(20\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+Page)/g, '$1\n$2').replace(/(合計[:：][^\n]*?)(?=20\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+Page)/g, '$1\n');
      expanded.push(...safe.split(/\n+/).map(x=>x.trim()).filter(Boolean));
    }
    for (const line of expanded) {
      const shipperMeta = this.extractMetaFromLine(line);
      if (shipperMeta.shipperCode || shipperMeta.pdfDateFrom) { currentMeta = { ...currentMeta, ...shipperMeta }; continue; }
      const rec = this.parseDetailLine(line, currentMeta, pageNo);
      if (rec) records.push(rec);
    }
    return records;
  },

  extractMetaFromLine(line) {
    const t = String(line || '').replace(/\s+/g,' ').trim();
    const meta = {};
    const shipperMatch = t.match(/荷主[:：]\s*([0-9A-Z]+)\s+(.+?)(?:\s+配達完了日|$)/);
    if (shipperMatch) { meta.shipperCode = shipperMatch[1]; meta.shipperName = shipperMatch[2].trim(); }
    const dateMatch = t.match(/配達完了日[:：]\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{4})\/(\d{2})\/(\d{2})/);
    if (dateMatch) { meta.pdfDateFrom = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`; meta.pdfDateTo = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`; }
    return meta;
  },

  parseDetailLine(line, meta, pageNo) {
    let t = String(line || '').replace(/[　]/g,' ').replace(/\s+/g,' ').trim();
    if (!t) return null;
    if (/^20\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+Page/i.test(t)) return null;
    if (/荷主別配送エリア別物量|管理者印|担当者印|配達完了日/.test(t)) return null;
    if (/郵便番号\s+住所\s+件数/.test(t)) return null;
    if (/^\/?\s*\/\s*\/?/.test(t)) return null;
    if (/^合計[:：]/.test(t)) return null;
    const head = t.match(/^((?:\d\s*){7}|UNKNOWN|UN\s*KN\s*OWN)\s+(.+)$/i);
    if (!head) return null;
    let zip = head[1].replace(/\s+/g,'').toUpperCase();
    if (zip.includes('UNKNOWN')) zip = 'UNKNOWN';
    let rest = head[2].trim();
    const nums = [];
    let remain = rest;
    while (nums.length < 20) {
      const m = remain.match(/(?:^|\s)(-?\d[\d,]*)(?:\s*)$/);
      if (!m) break;
      nums.unshift(toNumberSafe(m[1]));
      remain = remain.slice(0, m.index).trimEnd();
    }
    if (nums.length < 12) return null;
    const tail = nums.slice(-12);
    const [count, deliveryFee, trunkFee, extraFee, s1,s2,s3,s4,s5,s6,s7,s8] = tail;
    let address = remain.replace(/郵便番号.*$/, '').replace(/件数.*$/, '').replace(/\s+/g, '').trim();
    if (!address || address === '住所') return null;
    return { ym: null, source: 'area_pdf', pageNo, shipperCode: meta.shipperCode || '', shipperName: meta.shipperName || '', pdfDateFrom: meta.pdfDateFrom || '', pdfDateTo: meta.pdfDateTo || '', zip, address, area: normalizeAreaName(address), count, deliveryFee, trunkFee, extraFee, size: [s1,s2,s3,s4,s5,s6,s7,s8] };
  },

  saveParsed(parsed) {
    if (!Array.isArray(STATE.areaData)) STATE.areaData = [];
    STATE.areaData = STATE.areaData.filter(r => !(r.ym === parsed.ym && r.sourceFileName === parsed.fileName));
    parsed.records.forEach(r => { STATE.areaData.push({ ...r, sourceFileName: parsed.fileName }); });
    this.rebuildFieldDataFromAreaData(parsed.ym);
    STORE.save();
    renderFieldDataList2();
    FIELD_UI.updatePeriodBadge && FIELD_UI.updatePeriodBadge();
  },

  rebuildFieldDataFromAreaData(ym) {
    const rows = (STATE.areaData || []).filter(r => r.ym === ym && !r.rawOnly);
    if (!rows.length) return;
    const areas = {};
    for (const r of rows) {
      const area = r.area || '未分類';
      if (!areas[area]) areas[area] = { count:0, amount:0, shippers:{}, size:[0,0,0,0,0,0,0,0] };
      areas[area].count += n(r.count);
      areas[area].amount += n(r.deliveryFee) + n(r.trunkFee) + n(r.extraFee);
      for (let i=0;i<8;i++) areas[area].size[i] += n(r.size?.[i]);
      const shipper = r.shipperName || r.shipperCode || '未設定';
      if (!areas[area].shippers[shipper]) areas[area].shippers[shipper] = { count:0, amount:0, size:[0,0,0,0,0,0,0,0] };
      areas[area].shippers[shipper].count += n(r.count);
      areas[area].shippers[shipper].amount += n(r.deliveryFee) + n(r.trunkFee) + n(r.extraFee);
      for (let i=0;i<8;i++) areas[area].shippers[shipper].size[i] += n(r.size?.[i]);
    }
    STATE.fieldData = (STATE.fieldData || []).filter(d => d.ym !== ym);
    STATE.fieldData.push({ ym, source: 'area_pdf', areas, importedAt: new Date().toISOString() });
    STATE.fieldData.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }
};
function toNumberSafe(v) {
  const s = String(v ?? '').replace(/,/g,'').replace(/[^\d.-]/g,'');
  if (!s || s === '-' || s === '.') return 0;
  const num = Number(s);
  return Number.isFinite(num) ? num : 0;
}

function normalizeAreaName(address) {
  const t = String(address || '').replace(/\s+/g,'');
  if (!t || t.includes('郵便番号未登録') || t === 'UNKNOWN') return '郵便番号未登録';

  const prefMatch = t.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  const pref = prefMatch ? prefMatch[1] : '';

  const rest = pref ? t.slice(pref.length) : t;

  // 市区町村・郡町村を大まかに抽出
  const m = rest.match(/^(.+?[市区町村])/);
  if (m) return pref + m[1];

  return pref ? pref + rest : rest;
}


function setupFieldImportYMControls() {
  const fySel = document.getElementById('field-pdf-fy-select');
  const mSel = document.getElementById('field-pdf-month-select');
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
  const fySel = document.getElementById('field-pdf-fy-select');
  const mSel = document.getElementById('field-pdf-month-select');
  if (!fySel || !mSel) return;

  const fy = String(fySel.value || dashboardSelectedFiscalYear());
  const mm = String(mSel.value || '04').padStart(2,'0');

  const year = ['01','02','03'].includes(mm) ? String(parseInt(fy,10)+1) : fy;
  STATE.fiscalYear = fy;
  STATE.selYM = `${year}${mm}`;

  const note = document.getElementById('field-import-ym-note');
  if (note) note.textContent = `${ymLabel(STATE.selYM)} として保存します。PDF内の日付は参考情報として保存します。`;
}

const FIELD_IMPORT2 = {
  handleFiles(files) { AREA_PDF_IMPORT.handleFiles(files); },
  handleDrop(e) { e.preventDefault(); if(e.dataTransfer.files.length) AREA_PDF_IMPORT.handleFiles(e.dataTransfer.files); },
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
      const areaLabel = areaRows.length ? ` / PDF ${fmt(areaRows.length)}行・${fmt(areaCount)}件` : '';
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


/* ════════════════════════════════════════════════════════════════
   2026-04-29 追補修正：荷主別配送エリア別物量PDF 取込安定化
   ・作業者別CSVとは別処理
   ・年度／月選択UIをアプリ側で自動生成
   ・PDF.jsの行分割崩れに対応した全文正規表現解析
   ・STATE.areaData → STATE.fieldData を再構築して画面に表示
════════════════════════════════════════════════════════════════ */

function ensureFieldImportYMControls() {
  const zone =
    document.getElementById('field-upload-zone2') ||
    document.getElementById('field-upload-zone');

  if (!zone) return;

  let box = document.getElementById('field-pdf-period-box');

  if (!box) {
    box = document.createElement('div');
    box.id = 'field-pdf-period-box';
    box.style.cssText = [
      'margin:0 0 12px',
      'padding:12px 14px',
      'border:1px solid #d9dee8',
      'border-radius:12px',
      'background:#f8fafc',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:12px',
      'flex-wrap:wrap'
    ].join(';');

    box.innerHTML = `
      <div>
        <div style="font-weight:900;color:#1f2d3d;font-size:13px">荷主別配送エリア別物量PDFの取込年月</div>
        <div id="field-import-ym-note" style="font-size:12px;color:#64748b;margin-top:4px"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select id="field-pdf-fy-select" style="height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;background:#fff;font-weight:800"></select>
        <select id="field-pdf-month-select" style="height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;background:#fff;font-weight:800">
          <option value="04">4月</option>
          <option value="05">5月</option>
          <option value="06">6月</option>
          <option value="07">7月</option>
          <option value="08">8月</option>
          <option value="09">9月</option>
          <option value="10">10月</option>
          <option value="11">11月</option>
          <option value="12">12月</option>
          <option value="01">1月</option>
          <option value="02">2月</option>
          <option value="03">3月</option>
        </select>
      </div>
    `;

    zone.parentNode.insertBefore(box, zone);
  }

  const fySel = document.getElementById('field-pdf-fy-select');
  const mSel = document.getElementById('field-pdf-month-select');
  if (!fySel || !mSel) return;

  const now = new Date();
  const defaultFY = dashboardSelectedFiscalYear ? dashboardSelectedFiscalYear() : getDefaultFiscalYear();
  const current = fySel.value || defaultFY;

  fySel.innerHTML = '';
  for (let y = now.getFullYear() + 1; y >= 2020; y--) {
    fySel.innerHTML += `<option value="${y}">${y}年度</option>`;
  }

  fySel.value = [...fySel.options].some(o => o.value === String(current)) ? String(current) : String(defaultFY);

  const selected = STATE.selYM || (typeof dashboardSelectedYM === 'function' ? dashboardSelectedYM() : null);
  if (selected) {
    fySel.value = fiscalYearFromYM(selected);
    mSel.value = selected.slice(4,6);
  }

  fySel.onchange = syncFieldImportYMFromControls;
  mSel.onchange = syncFieldImportYMFromControls;

  syncFieldImportYMFromControls();
}

selectedYMForImport = function selectedYMForImport() {
  const fySel = document.getElementById('field-pdf-fy-select');
  const mSel = document.getElementById('field-pdf-month-select');

  if (fySel && mSel && fySel.value && mSel.value) {
    const fy = String(fySel.value);
    const mm = String(mSel.value).padStart(2, '0');
    const year = ['01','02','03'].includes(mm) ? String(parseInt(fy,10) + 1) : fy;
    STATE.fiscalYear = fy;
    STATE.selYM = `${year}${mm}`;
    return STATE.selYM;
  }

  return STATE.selYM || (typeof dashboardSelectedYM === 'function' ? dashboardSelectedYM() : null) || latestDS()?.ym || null;
};

if (typeof AREA_PDF_IMPORT !== 'undefined') {
  AREA_PDF_IMPORT.handleFiles = async function(files) {
    ensureFieldImportYMControls();
    syncFieldImportYMFromControls();

    const arr = Array.from(files || []);
    const pdfs = arr.filter(f => /\.pdf$/i.test(f.name));
    const others = arr.filter(f => !/\.pdf$/i.test(f.name));

    for (const pdf of pdfs) await this.importPdf(pdf);

    if (others.length) IMPORT.handleFiles(others);
  };

  AREA_PDF_IMPORT.importPdf = async function(file) {
    try {
      ensureFieldImportYMControls();
      syncFieldImportYMFromControls();

      UI.toast('荷主別配送エリア別物量PDFを解析中です...');
      await ASSETS.pdfjs();
      if (!window.pdfjsLib) throw new Error('PDF.jsを読み込めませんでした');

      const forcedYM = selectedYMForImport();
      if (!forcedYM) {
        UI.toast('取込対象の年度・月を選択してください', 'warn');
        return;
      }

      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

      let allRecords = [];
      let fullText = '';

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();

        const lineText = this.itemsToPageText ? this.itemsToPageText(content.items) : '';
        const rawText = (content.items || []).map(i => String(i.str || '')).join(' ');
        const pageText = `${lineText}\n${rawText}`;

        fullText += '\n' + pageText;
        allRecords = allRecords.concat(parseAreaVolumePdfText(pageText));
      }

      allRecords = allRecords.map(r => ({
        ...r,
        ym: forcedYM,
        importedAt: new Date().toISOString()
      }));

      if (!allRecords.length) {
        if (!Array.isArray(STATE.areaData)) STATE.areaData = [];
        STATE.areaData = STATE.areaData.filter(r => !(r.ym === forcedYM && r.sourceFileName === file.name));
        STATE.areaData.push({
          ym: forcedYM,
          source: 'area_pdf',
          sourceFileName: file.name,
          rawOnly: true,
          rawText: fullText.slice(0, 500000),
          importedAt: new Date().toISOString()
        });
        STORE.save();
        if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
        NAV.refresh();
        UI.toast(`${ymLabel(forcedYM)} PDF原文は保存しましたが、明細行は読み込めませんでした`, 'warn');
        return;
      }

      const parsed = {
        ym: forcedYM,
        fileName: file.name,
        importedAt: new Date().toISOString(),
        totalCount: allRecords.reduce((sum, r) => sum + n(r.count), 0),
        totalDeliveryFee: allRecords.reduce((sum, r) => sum + n(r.deliveryFee), 0),
        totalTrunkFee: allRecords.reduce((sum, r) => sum + n(r.trunkFee), 0),
        totalExtraFee: allRecords.reduce((sum, r) => sum + n(r.extraFee), 0),
        shipperCount: new Set(allRecords.map(r => `${r.shipperCode}_${r.shipperName}`)).size,
        records: allRecords
      };

      this.saveParsed(parsed);

      if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
      NAV.refresh();

      UI.toast(
        `${ymLabel(parsed.ym)} エリア物量PDF取込完了：` +
        `${fmt(parsed.shipperCount)}荷主 / ${fmt(parsed.records.length)}行 / ${fmt(parsed.totalCount)}件`
      );
    } catch(e) {
      console.error(e);
      UI.toast('PDF取込エラー: ' + e.message, 'error');
    }
  };
}

function parseAreaVolumePdfText(text) {
  const t = String(text || '')
    .replace(/[　]/g, ' ')
    .replace(/(\d)(202\d\/)/g, '$1 $2')
    .replace(/(0)(荷主[:：])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/荷主別配送エリア別物量/.test(t) && !/郵便番号\s+住所\s+件数/.test(t)) return [];

  const meta = extractAreaVolumeMeta(t);
  const records = [];

  const num = '(-?\\d[\\d,]*)';
  const rowRe = new RegExp(
    '(?:^|\\s)' +
    '((?:\\d{7})|UNKNOWN)' +
    '\\s+(.+?)\\s+' +
    Array(12).fill(num).join('\\s+') +
    '(?=\\s+(?:\\d{7}|UNKNOWN|合計[:：]|荷主[:：]|配達完了日|郵便番号|202\\d/|$))',
    'gi'
  );

  let m;
  while ((m = rowRe.exec(t)) !== null) {
    const zip = String(m[1] || '').trim().toUpperCase();
    let address = String(m[2] || '').trim();

    if (!address || /^(住所|件数)$/.test(address)) continue;
    if (/郵便番号\s+住所\s+件数/.test(address)) continue;

    address = address
      .replace(/^住所\s*/, '')
      .replace(/\s+/g, '')
      .trim();

    const values = m.slice(3, 15).map(toNumberSafe);
    if (values.length !== 12) continue;

    const [count, deliveryFee, trunkFee, extraFee, s1,s2,s3,s4,s5,s6,s7,s8] = values;
    if (!Number.isFinite(count)) continue;

    records.push({
      ym: null,
      source: 'area_pdf',
      branchCode: meta.branchCode,
      branchName: meta.branchName,
      shipperCode: meta.shipperCode,
      shipperName: meta.shipperName,
      pdfDateFrom: meta.pdfDateFrom,
      pdfDateTo: meta.pdfDateTo,
      zip,
      address,
      area: normalizeAreaName(address),
      count,
      deliveryFee,
      trunkFee,
      extraFee,
      totalFee: n(deliveryFee) + n(trunkFee) + n(extraFee),
      size: [s1,s2,s3,s4,s5,s6,s7,s8]
    });
  }

  return records;
}

function extractAreaVolumeMeta(text) {
  const t = String(text || '').replace(/[　]/g,' ').replace(/\s+/g,' ');

  let branchCode = '';
  let branchName = '';
  let shipperCode = '';
  let shipperName = '';
  let pdfDateFrom = '';
  let pdfDateTo = '';

  const branchMatch = t.match(/支店[:：]\s*([0-9A-Z]+)\s+(.+?)\s+管理者印/);
  if (branchMatch) {
    branchCode = branchMatch[1] || '';
    branchName = (branchMatch[2] || '').trim();
  }

  const shipperMatch = t.match(/荷主[:：]\s*([0-9A-Z]+)\s+(.+?)\s+配達完了日/);
  if (shipperMatch) {
    shipperCode = shipperMatch[1] || '';
    shipperName = (shipperMatch[2] || '').trim();
  }

  const dateMatch = t.match(/配達完了日[:：]\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{4})\/(\d{2})\/(\d{2})/);
  if (dateMatch) {
    pdfDateFrom = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    pdfDateTo = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
  }

  return { branchCode, branchName, shipperCode, shipperName, pdfDateFrom, pdfDateTo };
}

const __renderImportOriginalForAreaPdf = typeof renderImport === 'function' ? renderImport : null;
if (__renderImportOriginalForAreaPdf) {
  renderImport = function renderImportPatched() {
    __renderImportOriginalForAreaPdf();
    ensureFieldImportYMControls();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
  };
}

const __renderFieldDataList2OriginalForAreaPdf = typeof renderFieldDataList2 === 'function' ? renderFieldDataList2 : null;
if (__renderFieldDataList2OriginalForAreaPdf) {
  renderFieldDataList2 = function renderFieldDataList2Patched() {
    const list = document.getElementById('field-data-list2');
    const badge = document.getElementById('field-import-badge');

    const fieldRows = STATE.fieldData || [];
    const areaRows = (STATE.areaData || []).filter(r => !r.rawOnly);

    if (!list) {
      __renderFieldDataList2OriginalForAreaPdf();
      return;
    }

    const yms = [...new Set([
      ...fieldRows.map(d => d.ym),
      ...areaRows.map(r => r.ym)
    ].filter(Boolean))].sort();

    if (yms.length) {
      if (badge) { badge.textContent='読込済'; badge.className='badge badge-ok'; }

      list.innerHTML = yms.map(ym => {
        const f = fieldRows.find(d => d.ym === ym);
        const rows = areaRows.filter(r => r.ym === ym);
        const totalCount = rows.reduce((s,r)=>s+n(r.count),0) || Object.values(f?.areas || {}).reduce((s,a)=>s+n(a.count),0);
        const shipperCount = new Set(rows.map(r => `${r.shipperCode}_${r.shipperName}`)).size;
        const rowCount = rows.length;

        return `
          <div class="data-item">
            <span>
              <strong>${ymLabel(ym)}</strong>
              <span style="margin-left:8px;color:var(--text3);font-size:11px">
                エリア物量PDF ${fmt(rowCount)}行・${fmt(totalCount)}件${shipperCount ? `・${fmt(shipperCount)}荷主` : ''}
              </span>
            </span>
            <button class="btn btn-danger" onclick="IMPORT.deleteFieldData && IMPORT.deleteFieldData('${ym}')" style="font-size:11px;padding:2px 8px">削除</button>
          </div>`;
      }).join('');

      const rowEl = document.getElementById('field-delete-all-row');
      if (rowEl) rowEl.style.display = 'flex';
    } else {
      __renderFieldDataList2OriginalForAreaPdf();
    }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    ensureFieldImportYMControls();
    if (typeof renderFieldDataList2 === 'function') renderFieldDataList2();
  }, 300);
});

/* ════════ AREA PDF IMPORT v4 修正（2026-04-29）════════
   ・PDF.js / 帳票PDFの郵便番号が「11 20 001」のように分割されるケースに対応
   ・UNKNOWN が「UN KN OWN」のように分割されるケースに対応
   ・1行ごとに解析し、荷主情報をページ内ヘッダーから保持
   ・対象帳票：荷主別配送エリア別物量
════════════════════════════════════════════════════════════════ */
function parseAreaVolumePdfText(text) {
  const rawLines = String(text || '')
    .replace(/[　]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/);

  const records = [];
  let meta = {
    branchCode: '',
    branchName: '',
    shipperCode: '',
    shipperName: '',
    pdfDateFrom: '',
    pdfDateTo: ''
  };

  function cleanLine(line) {
    return String(line || '').replace(/\s+/g, ' ').trim();
  }

  function numValue(v) {
    const s = String(v ?? '').replace(/,/g, '').replace(/[^\d.\-]/g, '');
    if (!s || s === '-' || s === '.') return 0;
    const num = parseFloat(s);
    return Number.isFinite(num) ? num : 0;
  }

  function cleanZip(v) {
    const s = String(v || '').replace(/\s+/g, '').toUpperCase();
    if (s === 'UNKNOWN' || s === 'UNKNONW' || s === 'UNKNOW') return 'UNKNOWN';
    return s;
  }

  function cleanAddress(v) {
    return String(v || '')
      .replace(/^住所\s*/, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function updateMetaFromLine(line) {
    const branch = line.match(/支店[:：]\s*([0-9A-Z]+)\s+(.+?)\s+管\s*理\s*者\s*印/i)
      || line.match(/支店[:：]\s*([0-9A-Z]+)\s+(.+?)\s+管理者印/i);
    if (branch) {
      meta.branchCode = branch[1] || meta.branchCode;
      meta.branchName = String(branch[2] || meta.branchName).replace(/\s+/g, '').trim();
    }

    const shipper = line.match(/荷主[:：]\s*([0-9A-Z]+)\s+(.+)$/i);
    if (shipper && !/荷主別配送エリア別物量/.test(line)) {
      meta.shipperCode = shipper[1] || '';
      meta.shipperName = String(shipper[2] || '')
        .replace(/配達完了日.*$/, '')
        .replace(/\s+/g, '')
        .trim();
    }

    const dateLine = line.replace(/\s+/g, '');
    const date = dateLine.match(/配達完了日[:：]?([0-9]{4})\/(\d{2})\/(\d{2}).*?([0-9]{4})\/(\d{2})\/(\d{2})/);
    if (date) {
      meta.pdfDateFrom = `${date[1]}-${date[2]}-${date[3]}`;
      meta.pdfDateTo = `${date[4]}-${date[5]}-${date[6]}`;
    }
  }

  const rowRe = /^((?:\d\s*){7}|UNKNOWN|UN\s*KN\s*OWN)\s+(.+?)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)\s*$/i;

  for (const raw of rawLines) {
    const line = cleanLine(raw);
    if (!line) continue;

    updateMetaFromLine(line);

    if (/郵便番号\s+住所\s+件数/.test(line)) continue;
    if (/合計[:：]/.test(line)) continue;
    if (/Page\s+\d+\s+\/\s+\d+/i.test(line)) continue;
    if (/荷主別配送エリア別物量|配達完了日|管理者印|担当者印/.test(line)) continue;

    const m = line.match(rowRe);
    if (!m) continue;

    const zip = cleanZip(m[1]);
    const address = cleanAddress(m[2]);
    if (!address || /^(住所|件数)$/.test(address)) continue;

    const values = m.slice(3, 15).map(numValue);
    if (values.length !== 12) continue;

    const [count, deliveryFee, trunkFee, extraFee, s1, s2, s3, s4, s5, s6, s7, s8] = values;

    records.push({
      ym: null,
      source: 'area_pdf',
      branchCode: meta.branchCode,
      branchName: meta.branchName,
      shipperCode: meta.shipperCode,
      shipperName: meta.shipperName,
      pdfDateFrom: meta.pdfDateFrom,
      pdfDateTo: meta.pdfDateTo,
      zip,
      address,
      area: typeof normalizeAreaName === 'function' ? normalizeAreaName(address) : address,
      count,
      deliveryFee,
      trunkFee,
      extraFee,
      totalFee: numValue(deliveryFee) + numValue(trunkFee) + numValue(extraFee),
      size: [s1, s2, s3, s4, s5, s6, s7, s8]
    });
  }

  return records;
}


/* =====================================================================
   現場明細 CSV完全再構築版 2026-04-29
   方針:
   - PDF関連は使わない
   - 作業者CSVと商品・住所CSVを完全分離
   - 商品・住所CSVは I列(エスライン原票番号)でユニーク化
   - L列(郵便番号)を住所/市区町村集計に使用
   - P列(商品)はユニーク原票だけ判定
   - R列(作業内容)とU列(金額)だけ原票番号に紐付けて合算
   - 同じ年月を再取込した場合は追記せず完全置換
   - 削除は年月＋種別単位で完全削除
===================================================================== */
(function(){
  'use strict';

  const FIELD_REBUILD_VERSION = 'field-csv-rebuild-20260429';
  const MONTHS = ['04','05','06','07','08','09','10','11','12','01','02','03'];

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function yen(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    if (!s || s === '-' || s === '.') return 0;
    const num = Number(s);
    return Number.isFinite(num) ? num : 0;
  }
  function clean(v){ return String(v ?? '').replace(/[\u0000-\u001f]/g,'').trim(); }
  function esc2(s){
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function ymFromFiscalMonth(fy, mm){
    fy = String(fy || getDefaultFiscalYear()).replace(/年度/g,'');
    mm = String(mm || '04').padStart(2,'0');
    const year = ['01','02','03'].includes(mm) ? Number(fy) + 1 : Number(fy);
    return `${year}${mm}`;
  }
  function fiscalFromYM2(ym){ return fiscalYearFromYM ? fiscalYearFromYM(ym) : (Number(String(ym).slice(4,6)) <= 3 ? String(Number(String(ym).slice(0,4))-1) : String(ym).slice(0,4)); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }
  function msg(text, type='ok'){
    const el = document.getElementById('field-import-msg2') || document.getElementById('field-upload-msg') || document.getElementById('session-msg');
    if (el) {
      const color = type === 'error' ? '#b91c1c' : type === 'warn' ? '#92400e' : '#065f46';
      const bg = type === 'error' ? '#fee2e2' : type === 'warn' ? '#fef3c7' : '#dcfce7';
      el.innerHTML = `<div style="padding:8px 10px;border-radius:8px;background:${bg};color:${color};font-weight:700;margin:6px 0">${esc2(text)}</div>`;
    }
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(text, type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'ok');
  }

  function ensureState(){
    if (!Array.isArray(STATE.workerCsvData)) STATE.workerCsvData = [];
    if (!Array.isArray(STATE.productAddressData)) STATE.productAddressData = [];
    // 旧PDF/旧混在データは参照しない。念のため配列は残すが現場CSV判定には使わない。
    if (!Array.isArray(STATE.fieldData)) STATE.fieldData = [];
    if (!Array.isArray(STATE.areaData)) STATE.areaData = [];
  }

  // STOREへ新しい現場CSV専用データを保存対象として追加
  const originalStoreLoad = STORE.load.bind(STORE);
  const originalStoreSave = STORE.save.bind(STORE);
  STORE.load = function(){
    originalStoreLoad();
    STATE.workerCsvData = this._g('workerCsvData') || [];
    STATE.productAddressData = this._g('productAddressData') || [];
    ensureState();
  };
  STORE.save = function(){
    ensureState();
    originalStoreSave();
    this._s('workerCsvData', STATE.workerCsvData);
    this._s('productAddressData', STATE.productAddressData);
  };

  // クラウド full_state へ現場CSV専用データを追加
  if (typeof CLOUD !== 'undefined') {
    const oldMakeFull = CLOUD._makeFullState ? CLOUD._makeFullState.bind(CLOUD) : null;
    CLOUD._makeFullState = function(){
      const base = oldMakeFull ? oldMakeFull() : { version: 1, center: CENTER.id, savedAt: new Date().toISOString() };
      ensureState();
      base.workerCsvData = STATE.workerCsvData;
      base.productAddressData = STATE.productAddressData;
      base.version = Math.max(Number(base.version || 1), 30);
      return base;
    };
    const oldApplyFull = CLOUD._applyFullState ? CLOUD._applyFullState.bind(CLOUD) : null;
    CLOUD._applyFullState = function(full){
      const ok = oldApplyFull ? oldApplyFull(full) : true;
      if (full && Array.isArray(full.workerCsvData)) STATE.workerCsvData = full.workerCsvData;
      if (full && Array.isArray(full.productAddressData)) STATE.productAddressData = full.productAddressData;
      ensureState();
      return ok;
    };
  }

  function setupYmSelects(){
    ensureState();
    const years = new Set();
    const now = new Date();
    for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) years.add(String(y));
    safeArray(STATE.datasets).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.workerCsvData).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.productAddressData).forEach(d => d?.ym && years.add(fiscalFromYM2(d.ym)));
    const sortedYears = [...years].sort((a,b)=>Number(b)-Number(a));

    function fillPair(fyId, mId, noteId){
      const fySel = document.getElementById(fyId);
      const mSel = document.getElementById(mId);
      const note = document.getElementById(noteId);
      if (!fySel || !mSel) return;
      const keepFY = fySel.value || localStorage.getItem(`${STORE._p}${fyId}`) || fiscalFromYM2(STATE.selYM || latestDS()?.ym || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`);
      const keepM = mSel.value || localStorage.getItem(`${STORE._p}${mId}`) || String((STATE.selYM || latestDS()?.ym || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`).slice(4,6));
      fySel.innerHTML = sortedYears.map(y => `<option value="${y}">${y}年度</option>`).join('');
      mSel.innerHTML = MONTHS.map(mm => `<option value="${mm}">${Number(mm)}月</option>`).join('');
      fySel.value = sortedYears.includes(String(keepFY)) ? String(keepFY) : sortedYears[0];
      mSel.value = MONTHS.includes(String(keepM).padStart(2,'0')) ? String(keepM).padStart(2,'0') : '04';
      const update = () => {
        localStorage.setItem(`${STORE._p}${fyId}`, fySel.value);
        localStorage.setItem(`${STORE._p}${mId}`, mSel.value);
        if (note) note.textContent = `${ymText(ymFromFiscalMonth(fySel.value, mSel.value))} として保存します。CSV内の日付は参考情報として保持します。`;
      };
      fySel.onchange = update;
      mSel.onchange = update;
      update();
    }
    fillPair('field-worker-fy-select', 'field-worker-month-select', 'field-worker-ym-note');
    fillPair('field-product-fy-select', 'field-product-month-select', 'field-product-ym-note');
  }

  function selectedWorkerYM(){ return ymFromFiscalMonth(document.getElementById('field-worker-fy-select')?.value, document.getElementById('field-worker-month-select')?.value); }
  function selectedProductYM(){ return ymFromFiscalMonth(document.getElementById('field-product-fy-select')?.value, document.getElementById('field-product-month-select')?.value); }

  function csvRowsFromText(text){ return CSV && CSV.toRows ? CSV.toRows(text) : []; }
  async function readCsvFile(file){ return CSV && CSV.read ? CSV.read(file) : await file.text(); }

  function headerIndex(header, names, fallback){
    const normalized = header.map(h => clean(h).replace(/[\s　]/g,''));
    for (const name of names) {
      const i = normalized.findIndex(h => h === name || h.includes(name));
      if (i >= 0) return i;
    }
    return fallback;
  }

  function parseWorkerCsvRows(rows, fileName){
    if (!rows.length) return { rowCount:0, workerCount:0, workers:{} };
    const header = rows[0] || [];
    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));
    const workerIdx = headerIndex(header, ['作業者名','作業者','担当者','社員名','氏名'], 0);
    const amountIdx = headerIndex(header, ['金額','売上','合計'], -1);
    const workIdx = headerIndex(header, ['作業内容','内容','科目'], -1);
    const workers = {};
    body.forEach(r => {
      const name = clean(r[workerIdx]) || '未設定';
      if (!workers[name]) workers[name] = { name, rows:0, amount:0, works:{} };
      workers[name].rows += 1;
      if (amountIdx >= 0) workers[name].amount += yen(r[amountIdx]);
      if (workIdx >= 0) {
        const w = clean(r[workIdx]) || '未設定';
        workers[name].works[w] = (workers[name].works[w] || 0) + 1;
      }
    });
    return { rowCount: body.length, workerCount: Object.keys(workers).length, workers, sourceFileName:fileName };
  }

  function productCategory(product){
    const p = clean(product);
    if (!p) return '未設定';
    if (/冷蔵|冷凍庫/.test(p)) return '冷蔵庫';
    if (/洗濯|乾燥/.test(p)) return '洗濯機';
    if (/テレビ|TV|ＴＶ/.test(p)) return 'テレビ';
    if (/エアコン|空調/.test(p)) return 'エアコン';
    if (/レンジ|オーブン/.test(p)) return 'レンジ';
    if (/炊飯/.test(p)) return '炊飯器';
    return 'その他';
  }
  function sizeBucketFromProduct(product){
    const p = clean(product);
    if (/冷蔵庫.*100.*199|１００～１９９|100～199/.test(p)) return '冷蔵庫100-199L';
    if (/冷蔵庫.*200.*299|２００～２９９|200～299/.test(p)) return '冷蔵庫200-299L';
    if (/冷蔵庫.*300|３００|300/.test(p)) return '冷蔵庫300L以上';
    if (/洗濯機.*5|５ｋｇ|5kg/i.test(p)) return '洗濯機5kg前後';
    if (/洗濯/.test(p)) return '洗濯機';
    return productCategory(p);
  }
  function areaFromAddress(address){
    const t = clean(address).replace(/\s+/g,'');
    if (!t) return { pref:'未設定', city:'未設定', area:'未設定' };
    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '未設定';
    const rest = prefMatch ? t.slice(pref.length) : t;
    let city = rest;
    const wardCity = rest.match(/^(.+?市.+?区)/);
    const muni = rest.match(/^(.+?[市区町村])/);
    if (wardCity) city = wardCity[1];
    else if (muni) city = muni[1];
    else city = rest.slice(0, 12) || '未設定';
    return { pref, city, area: pref === '未設定' ? city : pref + city };
  }

  function parseProductAddressRows(rows, fileName){
    if (!rows.length) return { rawRows:0, detailRows:0, uniqueCount:0, tickets:[] };
    const header = rows[0] || [];
    const body = rows.slice(1).filter(r => r && r.some(c => clean(c)));
    const idxSlip = headerIndex(header, ['エスライン原票番号','原票番号'], 8);     // I列
    const idxZip = headerIndex(header, ['お届け先郵便番号','郵便番号'], 11);       // L列
    const idxAddress = headerIndex(header, ['住所','お届け先住所'], 12);          // M列優先
    const idxProduct = headerIndex(header, ['商品名型番','商品名','商品'], 15);    // P列
    const idxWork = headerIndex(header, ['作業内容'], 17);                       // R列
    const idxAmount = headerIndex(header, ['金額'], 20);                         // U列

    const map = new Map();
    let detailRows = 0;
    for (const row of body) {
      const slip = clean(row[idxSlip]);
      if (!slip) continue;
      detailRows++;
      if (!map.has(slip)) {
        const address = clean(row[idxAddress]) || clean(row[13]);
        const product = clean(row[idxProduct]);
        const area = areaFromAddress(address);
        map.set(slip, {
          slip,
          zip: clean(row[idxZip]),
          address,
          product,
          category: productCategory(product),
          sizeBucket: sizeBucketFromProduct(product),
          pref: area.pref,
          city: area.city,
          area: area.area,
          amount: 0,
          works: {},
          workDetails: [],
          firstRow: row
        });
      }
      const ticket = map.get(slip);
      const work = clean(row[idxWork]) || '未設定';
      const amount = yen(row[idxAmount]);
      ticket.amount += amount;
      ticket.works[work] = (ticket.works[work] || 0) + amount;
      ticket.workDetails.push({ work, amount });
    }
    const tickets = [...map.values()];
    return {
      sourceFileName: fileName,
      rawRows: body.length,
      detailRows,
      uniqueCount: tickets.length,
      duplicateExcluded: Math.max(0, detailRows - tickets.length),
      addressCount: tickets.filter(t => t.address).length,
      zipCount: tickets.filter(t => t.zip).length,
      productCategoryCount: new Set(tickets.map(t => t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t => Object.keys(t.works || {}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      tickets
    };
  }

  function upsertByYm(listName, record){
    ensureState();
    STATE[listName] = safeArray(STATE[listName]).filter(d => d.ym !== record.ym);
    STATE[listName].push(record);
    STATE[listName].sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }

  async function importWorker(files){
    ensureState(); setupYmSelects();
    const ym = selectedWorkerYM();
    let combined = { rowCount:0, workerCount:0, workers:{}, files:[] };
    for (const file of Array.from(files || [])) {
      const text = await readCsvFile(file);
      const parsed = parseWorkerCsvRows(csvRowsFromText(text), file.name);
      combined.rowCount += parsed.rowCount;
      combined.files.push(file.name);
      Object.values(parsed.workers || {}).forEach(w => {
        if (!combined.workers[w.name]) combined.workers[w.name] = { name:w.name, rows:0, amount:0, works:{} };
        combined.workers[w.name].rows += w.rows;
        combined.workers[w.name].amount += w.amount;
        Object.entries(w.works || {}).forEach(([k,v]) => combined.workers[w.name].works[k] = (combined.workers[w.name].works[k] || 0) + v);
      });
    }
    combined.workerCount = Object.keys(combined.workers).length;
    upsertByYm('workerCsvData', { ym, source:'worker_csv', importedAt:new Date().toISOString(), ...combined });
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} 作業者別CSVを入替完了：${combined.rowCount.toLocaleString()}行 / 作業者${combined.workerCount.toLocaleString()}名`);
  }

  async function importProduct(files){
    ensureState(); setupYmSelects();
    const ym = selectedProductYM();
    let allTickets = [];
    let rawRows = 0, detailRows = 0, filesUsed = [];
    for (const file of Array.from(files || [])) {
      const text = await readCsvFile(file);
      const parsed = parseProductAddressRows(csvRowsFromText(text), file.name);
      rawRows += parsed.rawRows;
      detailRows += parsed.detailRows;
      filesUsed.push(file.name);
      allTickets.push(...parsed.tickets);
    }
    // 複数ファイル選択時も原票番号で再ユニーク化
    const ticketMap = new Map();
    allTickets.forEach(t => {
      if (!t.slip) return;
      if (!ticketMap.has(t.slip)) ticketMap.set(t.slip, { ...t, works:{...t.works}, workDetails:[...(t.workDetails||[])] });
      else {
        const base = ticketMap.get(t.slip);
        base.amount += yen(t.amount);
        Object.entries(t.works || {}).forEach(([k,v]) => base.works[k] = (base.works[k] || 0) + yen(v));
        base.workDetails.push(...(t.workDetails || []));
      }
    });
    const tickets = [...ticketMap.values()];
    const record = {
      ym,
      source:'product_address_csv',
      importedAt:new Date().toISOString(),
      files: filesUsed,
      rawRows,
      detailRows,
      uniqueCount: tickets.length,
      duplicateExcluded: Math.max(0, detailRows - tickets.length),
      addressCount: tickets.filter(t=>t.address).length,
      zipCount: tickets.filter(t=>t.zip).length,
      productCategoryCount: new Set(tickets.map(t=>t.category).filter(Boolean)).size,
      workTypeCount: new Set(tickets.flatMap(t=>Object.keys(t.works||{}))).size,
      amount: tickets.reduce((s,t)=>s+yen(t.amount),0),
      tickets
    };
    upsertByYm('productAddressData', record);
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} 商品・住所CSVを入替完了：原票${record.uniqueCount.toLocaleString()}件 / 明細${record.detailRows.toLocaleString()}行 / 重複除外${record.duplicateExcluded.toLocaleString()}行`);
  }

  window.FIELD_WORKER_IMPORT2 = {
    handleFiles(files){ importWorker(files).catch(e => msg('作業者CSV取込エラー：' + e.message, 'error')); },
    handleDrop(e){ e.preventDefault(); importWorker(e.dataTransfer.files).catch(err => msg('作業者CSV取込エラー：' + err.message, 'error')); }
  };
  window.FIELD_PRODUCT_IMPORT2 = {
    handleFiles(files){ importProduct(files).catch(e => msg('商品・住所CSV取込エラー：' + e.message, 'error')); },
    handleDrop(e){ e.preventDefault(); importProduct(e.dataTransfer.files).catch(err => msg('商品・住所CSV取込エラー：' + err.message, 'error')); }
  };

  function getSelectedFieldYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel?.value) return sel.value;
    return STATE.selYM || safeArray(STATE.productAddressData).at(-1)?.ym || safeArray(STATE.workerCsvData).at(-1)?.ym || latestDS()?.ym || '';
  }
  function setupFieldCommonSelectors(){
    ensureState();
    const view = document.getElementById('view-field');
    if (!view) return;
    let box = document.getElementById('field-common-selector-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'field-common-selector-box';
      box.className = 'card';
      box.style.cssText = 'margin-bottom:14px';
      box.innerHTML = `
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><div style="font-size:15px;font-weight:900">表示対象</div><div style="font-size:12px;color:var(--text3);margin-top:4px">年度順：4月 → 翌年3月 / 年度・月を共通管理</div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label style="font-size:12px;font-weight:800">対象年度</label><select id="field-common-fy-select" style="font-size:13px;font-weight:800;min-width:120px"></select>
            <label style="font-size:12px;font-weight:800">対象月</label><select id="field-common-month-select" style="font-size:13px;font-weight:800;min-width:190px"></select>
          </div>
        </div>`;
      const tabs = view.querySelector('.field-tabs');
      view.insertBefore(box, tabs || view.firstChild);
    }
    const fySel = document.getElementById('field-common-fy-select');
    const mSel = document.getElementById('field-common-month-select');
    if (!fySel || !mSel) return;
    const yset = new Set([getDefaultFiscalYear()]);
    safeArray(STATE.datasets).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.workerCsvData).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    safeArray(STATE.productAddressData).forEach(d=>d?.ym && yset.add(fiscalFromYM2(d.ym)));
    const years = [...yset].sort((a,b)=>Number(b)-Number(a));
    const keepFY = fySel.value || fiscalFromYM2(STATE.selYM || safeArray(STATE.productAddressData).at(-1)?.ym || safeArray(STATE.workerCsvData).at(-1)?.ym || latestDS()?.ym || `${new Date().getFullYear()}04`);
    fySel.innerHTML = years.map(y=>`<option value="${y}">${y}年度</option>`).join('');
    fySel.value = years.includes(keepFY) ? keepFY : years[0];
    function fillMonths(){
      const fy = fySel.value;
      const current = mSel.value || STATE.selYM;
      mSel.innerHTML = MONTHS.map(mm => {
        const ym = ymFromFiscalMonth(fy, mm);
        const hasW = safeArray(STATE.workerCsvData).some(d=>d.ym===ym);
        const hasP = safeArray(STATE.productAddressData).some(d=>d.ym===ym);
        const label = `${ymText(ym)}${hasW||hasP ? `（${hasW?'作業者':''}${hasW&&hasP?'・':''}${hasP?'商品住所':''}あり）` : '（未登録）'}`;
        return `<option value="${ym}">${label}</option>`;
      }).join('');
      if ([...mSel.options].some(o=>o.value===current)) mSel.value = current;
      else {
        const latest = [...mSel.options].reverse().find(o => /あり/.test(o.textContent));
        mSel.value = latest ? latest.value : ymFromFiscalMonth(fy, '04');
      }
      STATE.fiscalYear = fy;
      STATE.selYM = mSel.value;
    }
    fySel.onchange = () => { fillMonths(); refreshFieldAll(false); };
    mSel.onchange = () => { STATE.selYM = mSel.value; refreshFieldAll(false); };
    fillMonths();
  }

  function productRecord(ym){ return safeArray(STATE.productAddressData).find(d=>d.ym===ym); }
  function workerRecord(ym){ return safeArray(STATE.workerCsvData).find(d=>d.ym===ym); }

  function renderBars(container, rows, valueKey='count'){
    if (!container) return;
    if (!rows.length) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">データを読み込んでください</div>'; return; }
    const max = Math.max(...rows.map(r=>Number(r[valueKey]||0)), 1);
    container.innerHTML = rows.map((r,i)=>{
      const val = Number(r[valueKey]||0);
      const pct = Math.max(2, Math.round(val/max*100));
      const sub = valueKey === 'amount' ? `${Math.round(val/1000).toLocaleString()}千円` : `${val.toLocaleString()}件`;
      return `<div style="display:grid;grid-template-columns:260px 1fr 110px;gap:12px;align-items:center;margin:8px 0">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i+1}. ${esc2(r.label)}</div>
        <div style="height:18px;background:#e5e7eb;border-radius:999px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#1a4d7c;border-radius:999px"></div></div>
        <div style="text-align:right;font-weight:900">${sub}</div>
      </div>`;
    }).join('');
  }

  function renderMap(){
    const box = document.getElementById('field-map');
    const no = document.getElementById('map-no-data');
    if (!box) return;
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    if (!rec || !safeArray(rec.tickets).length) {
      box.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text3)">商品・住所CSVを読み込んでください</div>';
      if (no) no.style.display = 'none';
      return;
    }
    const mode = document.getElementById('field-area-view-mode')?.value || 'overall';
    const sortMode = document.getElementById('field-area-sort-mode')?.value || 'count';
    const metric = document.getElementById('map-metric-sel')?.value || 'count';
    const map = new Map();
    for (const t of rec.tickets) {
      const key = t.area || '未設定';
      if (!map.has(key)) map.set(key, { label:key, pref:t.pref||'未設定', city:t.city||key, count:0, amount:0 });
      const row = map.get(key);
      row.count += 1;
      row.amount += yen(t.amount);
    }
    let rows = [...map.values()];
    const sortFn = sortMode === 'amount' ? (a,b)=>b.amount-a.amount : sortMode === 'name' ? (a,b)=>a.label.localeCompare(b.label,'ja') : (a,b)=>b.count-a.count;
    rows.sort(sortFn);

    const summary = `<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2)">
      <strong>${ymText(ym)} / 商品・住所CSV / I列原票番号ユニーク件数で集計</strong>
      <span style="margin-left:14px">原票 ${rec.uniqueCount.toLocaleString()}件</span>
      <span style="margin-left:14px">金額 ${Math.round(rec.amount/1000).toLocaleString()}千円</span>
      <span style="margin-left:14px">重複除外 ${rec.duplicateExcluded.toLocaleString()}行</span>
    </div>`;

    if (mode !== 'pref') {
      box.innerHTML = summary + `<div style="padding:14px 16px">${barsHtml(rows, metric)}</div>`;
      return;
    }
    const prefMap = new Map();
    rows.forEach(r => {
      if (!prefMap.has(r.pref)) prefMap.set(r.pref, { pref:r.pref, count:0, amount:0, children:[] });
      const p = prefMap.get(r.pref); p.count += r.count; p.amount += r.amount; p.children.push(r);
    });
    const prefs = [...prefMap.values()].sort(sortFn);
    box.innerHTML = summary + `<div style="padding:14px 16px">` + prefs.map((p,idx)=>`
      <details ${idx<3?'open':''} style="border:1px solid var(--border);border-radius:12px;background:#fff;margin-bottom:10px;overflow:hidden">
        <summary style="cursor:pointer;padding:12px 14px;background:#f8fafc;font-weight:900;display:flex;justify-content:space-between;align-items:center">
          <span>＋ ${esc2(p.pref)} <span style="font-size:11px;color:var(--text3);font-weight:700">${p.children.length}地区</span></span>
          <span>${metric==='amount' ? Math.round(p.amount/1000).toLocaleString()+'千円' : p.count.toLocaleString()+'件'}</span>
        </summary>
        <div style="padding:10px 14px">${barsHtml(p.children.sort(sortFn), metric)}</div>
      </details>`).join('') + `</div>`;
  }
  function barsHtml(rows, metric){
    const key = metric === 'amount' ? 'amount' : 'count';
    if (!rows.length) return '<div style="padding:20px;color:var(--text3)">データなし</div>';
    const max = Math.max(...rows.map(r=>Number(r[key]||0)), 1);
    return rows.map((r,i)=>{
      const val = Number(r[key] || 0);
      const w = Math.max(2, Math.round(val/max*100));
      const amount = Math.round((r.amount||0)/1000).toLocaleString();
      return `<div style="display:grid;grid-template-columns:260px 1fr 150px;gap:12px;align-items:center;margin:7px 0;min-width:0">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i+1}. ${esc2(r.label)}</div>
        <div style="height:18px;background:#e5e7eb;border-radius:999px;overflow:hidden;min-width:120px"><div style="width:${w}%;height:100%;background:#1a4d7c;border-radius:999px"></div></div>
        <div style="text-align:right;font-weight:900">${r.count.toLocaleString()}件 <span style="color:var(--text3);font-size:11px">/ ${amount}千円</span></div>
      </div>`;
    }).join('');
  }

  function renderWorker(){
    const ym = getSelectedFieldYM();
    const rec = workerRecord(ym);
    const kpi = document.getElementById('f-kpi-worker');
    const bars = document.getElementById('f-worker-bars');
    const tbody = document.getElementById('f-worker-tbody');
    if (!rec) {
      if (kpi) kpi.innerHTML = '<div class="card" style="grid-column:1/-1;padding:20px;color:var(--text3)">作業者別CSVを読み込んでください</div>';
      if (bars) bars.innerHTML = '<div style="padding:30px;color:var(--text3)">データなし</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">データなし</td></tr>';
      return;
    }
    const rows = Object.values(rec.workers||{}).map(w=>({ label:w.name, count:w.rows, amount:w.amount, works:w.works })).sort((a,b)=>b.count-a.count);
    if (kpi) kpi.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">対象月</div><div class="kpi-value">${ymText(ym)}</div></div>
      <div class="kpi-card"><div class="kpi-label">明細行</div><div class="kpi-value">${rec.rowCount.toLocaleString()}</div></div>
      <div class="kpi-card"><div class="kpi-label">作業者</div><div class="kpi-value">${rec.workerCount.toLocaleString()}</div></div>
      <div class="kpi-card"><div class="kpi-label">金額</div><div class="kpi-value">${Math.round(rows.reduce((s,r)=>s+r.amount,0)/1000).toLocaleString()}千円</div></div>`;
    renderBars(bars, rows.slice(0,20), 'count');
    if (tbody) tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">-</td><td class="r">${r.count?Math.round(r.amount/r.count).toLocaleString():0}</td><td class="r">-</td><td class="r">-</td><td class="r">-</td></tr>`).join('');
  }

  function renderContent(){
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    const tbody = document.getElementById('f-content-tbody');
    if (!tbody) return;
    if (!rec) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">商品・住所CSVを読み込んでください</td></tr>'; return; }
    const map = new Map();
    rec.tickets.forEach(t => Object.entries(t.works || {}).forEach(([work,amount]) => {
      if (!map.has(work)) map.set(work, { label:work, count:0, amount:0 });
      const r = map.get(work); r.count += 1; r.amount += yen(amount);
    }));
    const rows = [...map.values()].sort((a,b)=>b.amount-a.amount);
    const total = rows.reduce((s,r)=>s+r.amount,0) || 1;
    tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">${(r.amount/total*100).toFixed(1)}%</td></tr>`).join('');
  }
  function renderProduct(){
    const ym = getSelectedFieldYM();
    const rec = productRecord(ym);
    const tbody = document.getElementById('f-product-tbody');
    if (!tbody) return;
    if (!rec) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:24px">商品・住所CSVを読み込んでください</td></tr>'; return; }
    const map = new Map();
    rec.tickets.forEach(t => {
      const k = t.category || '未設定';
      if (!map.has(k)) map.set(k, { label:k, count:0, amount:0 });
      const r = map.get(k); r.count += 1; r.amount += yen(t.amount);
    });
    const rows = [...map.values()].sort((a,b)=>b.count-a.count);
    const total = rows.reduce((s,r)=>s+r.count,0) || 1;
    tbody.innerHTML = rows.map(r=>`<tr><td>${esc2(r.label)}</td><td class="r">${r.count.toLocaleString()}</td><td class="r">${Math.round(r.amount/1000).toLocaleString()}</td><td class="r">${(r.count/total*100).toFixed(1)}%</td></tr>`).join('');
  }

  function renderDataList(){
    ensureState();
    const list = document.getElementById('field-data-list2') || document.getElementById('field-data-list');
    const badge = document.getElementById('field-import-badge');
    const yms = [...new Set([...safeArray(STATE.workerCsvData).map(d=>d.ym), ...safeArray(STATE.productAddressData).map(d=>d.ym)])].filter(Boolean).sort();
    if (badge) { badge.textContent = yms.length ? '読込済' : '未読込'; badge.className = yms.length ? 'badge badge-ok' : 'badge badge-warn'; }
    const delAll = document.getElementById('field-delete-all-row'); if (delAll) delAll.style.display = yms.length ? 'flex' : 'none';
    if (!list) return;
    if (!yms.length) { list.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">まだデータがありません</div>'; return; }
    list.innerHTML = yms.map(ym => {
      const w = workerRecord(ym);
      const p = productRecord(ym);
      return `<div style="padding:12px 16px;border-bottom:1px solid #eef2f7;display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div style="font-weight:900;font-size:14px;margin-bottom:6px">${ymText(ym)}</div>
          <div style="font-size:12px;line-height:1.7;color:var(--text2)">
            ${p ? `✅ 商品・住所CSV 原票${p.uniqueCount.toLocaleString()}件 / 明細${p.detailRows.toLocaleString()}行 / 重複除外${p.duplicateExcluded.toLocaleString()}行` : '⬜ 商品・住所CSV 未登録'}<br>
            ${w ? `✅ 作業者別CSV ${w.rowCount.toLocaleString()}行 / 作業者${w.workerCount.toLocaleString()}名` : '⬜ 作業者別CSV 未登録'}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${w ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','worker')">作業者削除</button>` : ''}
          ${p ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','product')">商品住所削除</button>` : ''}
          <button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="FIELD_CSV_REBUILD.deleteMonthType('${ym}','all')">月削除</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderMonthlyCheck(){
    const oldFn = window.renderMonthlyCheckTable;
    window.renderMonthlyCheckTable = function(){
      const fy = typeof storageFiscalYear === 'function' ? storageFiscalYear() : (STATE.fiscalYear || getDefaultFiscalYear());
      const months = typeof storageFiscalMonths === 'function' ? storageFiscalMonths(fy) : MONTHS.map(mm=>ymFromFiscalMonth(fy,mm));
      const rows = months.map(ym => {
        const base = typeof storageMonthState === 'function' ? storageMonthState(fy, ym) : { ym, csvLabel:'未登録', csvKind:'danger', histLabel:'なし', histKind:'warn', planLabel:'未登録', planKind:'warn', judge:'漏れ', kind:'danger', note:'CSV未登録' };
        const w = workerRecord(ym);
        const p = productRecord(ym);
        let judge = base.judge, kind = base.kind, note = base.note || '';
        if (base.csvLabel === '未登録' && base.histLabel === 'なし') { judge = '漏れ'; kind = 'danger'; }
        if (p || w) {
          note = [note, w ? `作業者 ${w.rowCount.toLocaleString()}行 / ${w.workerCount.toLocaleString()}名` : '', p ? `商品住所 原票${p.uniqueCount.toLocaleString()}件 / 明細${p.detailRows.toLocaleString()}行 / 重複除外${p.duplicateExcluded.toLocaleString()}行` : ''].filter(Boolean).join(' / ');
        }
        return { ...base, workerLabel:w?'登録済':'未登録', workerKind:w?'ok':'danger', productLabel:p?'登録済':'未登録', productKind:p?'ok':'danger', judge, kind, note };
      });
      const need = rows.filter(r => r.kind !== 'ok').length;
      const summary = typeof storageBadge === 'function' ? storageBadge(`確認 ${need}ヶ月`, need ? 'warn' : 'ok') : '';
      const badge = (label,kind) => typeof storageBadge === 'function' ? storageBadge(label,kind) : label;
      return `<div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div><div style="font-weight:900;font-size:14px">年度別 月次登録チェック表</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${fy}年度：${fy}年4月 ～ ${Number(fy)+1}年3月（年度順）</div></div><div>${summary}</div></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>収支補完</th><th>計画</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>確認内容</th></tr></thead><tbody>
        ${rows.map(s=>`<tr><td><strong>${ymText(s.ym)}</strong></td><td>${badge(s.csvLabel,s.csvKind)}</td><td>${badge(s.histLabel,s.histKind)}</td><td>${badge(s.planLabel,s.planKind)}</td><td>${badge(s.workerLabel,s.workerKind)}</td><td>${badge(s.productLabel,s.productKind)}</td><td>${badge(s.judge,s.kind)}</td><td style="min-width:260px;color:var(--text2)">${esc2(s.note)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    };
  }

  function refreshFieldAll(rebuildSelectors=true){
    ensureState();
    if (rebuildSelectors) setupFieldCommonSelectors();
    setupYmSelects();
    FIELD_UI.updatePeriodBadge();
    renderWorker();
    renderContent();
    renderProduct();
    renderMap();
    renderDataList();
    const topBadge = document.getElementById('field-period-badge');
    if (topBadge) {
      const ym = getSelectedFieldYM();
      const w = workerRecord(ym), p = productRecord(ym);
      topBadge.textContent = `${ymText(ym)} ${w||p?'読込済':'未登録'}`;
    }
  }

  function deleteMonthType(ym, type){
    ensureState();
    if (type === 'worker' || type === 'all') STATE.workerCsvData = safeArray(STATE.workerCsvData).filter(d => d.ym !== ym);
    if (type === 'product' || type === 'all') STATE.productAddressData = safeArray(STATE.productAddressData).filter(d => d.ym !== ym);
    // 旧混在データも同じ年月は消して復活を防止
    STATE.fieldData = safeArray(STATE.fieldData).filter(d => d.ym !== ym);
    STATE.areaData = safeArray(STATE.areaData).filter(d => d.ym !== ym);
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg(`${ymText(ym)} の${type==='all'?'現場明細':type==='worker'?'作業者CSV':'商品住所CSV'}を削除しました`, 'warn');
  }
  window.FIELD_CSV_REBUILD = { refresh:refreshFieldAll, deleteMonthType, importWorker, importProduct };
  window.renderFieldDataList2 = renderDataList;
  if (typeof DATA_RESET !== 'undefined') DATA_RESET.clearFieldAll = function(){
    if (!confirm('現場明細データ（作業者CSV・商品住所CSV）を全月削除しますか？')) return;
    ensureState();
    STATE.workerCsvData = [];
    STATE.productAddressData = [];
    STATE.fieldData = [];
    STATE.areaData = [];
    STORE.save();
    if (CLOUD?.pushAll) CLOUD.pushAll().catch(()=>{});
    refreshFieldAll();
    msg('現場明細データを全削除しました', 'warn');
  };

  // FIELD_UIをCSV専用に上書き
  FIELD_UI.renderMap = renderMap;
  FIELD_UI.renderDataList = function(){ refreshFieldAll(); };
  FIELD_UI.updatePeriodBadge = function(){
    const badge = document.getElementById('field-period-badge');
    if (!badge) return;
    const ym = getSelectedFieldYM();
    badge.textContent = `${ymText(ym)} ${(workerRecord(ym)||productRecord(ym)) ? '読込済' : '未登録'}`;
  };
  const oldSwitch = FIELD_UI.switchTab.bind(FIELD_UI);
  FIELD_UI.switchTab = function(el){ oldSwitch(el); refreshFieldAll(false); };

  renderMonthlyCheck();

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      ensureState();
      setupYmSelects();
      setupFieldCommonSelectors();
      refreshFieldAll(false);
    }, 200);
  });
})();
