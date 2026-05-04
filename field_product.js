/* field_product.js : 商品カテゴリ分析 完全安定版
   2026-05-02
   原因対策：
   1) field_core側の旧描画に戻されても商品カテゴリ画面表示中は再描画
   2) 年度/月は「YYYYMM」を基準にし、登録済みデータ月だけ表示
   3) STATEだけでなく localStorage 全体から workerCsvData / productAddressData 相当を探索
   4) 商品・住所CSVが見つかれば R列作業内容＋U列金額を優先
   5) 商品・住所CSVがなくても作業者CSVの works から暫定表示
   6) クレーン／ユニック／手吊り／吊り系は最優先でクレーン分類
*/
'use strict';

(function(){
  const FLAG = '__FIELD_PRODUCT_ROBUST_FINAL_20260502__';
  window[FLAG] = true;

  const COLORS = ['#1a4d7c','#e05b4d','#198754','#b85c00','#2563eb','#7c3aed','#0891b2','#be185d','#65a30d','#ea580c'];
  const MONTH_ORDER = ['04','05','06','07','08','09','10','11','12','01','02','03'];
  let timer = null;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function num(v){
    const s = String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v)/1000).toLocaleString('ja-JP'); }
  function pct(v,total){ return total ? (num(v)/total*100).toFixed(1)+'%' : '0.0%'; }

  function normYM(v){
    const s = String(v ?? '').normalize('NFKC');
    const d = s.replace(/[^\d]/g,'');
    if (d.length >= 6) return d.slice(0,6);
    return '';
  }
  function ymText(ym){
    const y = String(ym||'').slice(0,4);
    const m = Number(String(ym||'').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function fiscalYear(ym){
    const y = Number(String(ym||'').slice(0,4));
    const m = Number(String(ym||'').slice(4,6));
    if (!y || !m) return '';
    return String(m <= 3 ? y - 1 : y);
  }
  function fyMonthSort(a,b){
    const ma = String(a).slice(4,6), mb = String(b).slice(4,6);
    return MONTH_ORDER.indexOf(ma) - MONTH_ORDER.indexOf(mb);
  }
  function normalizeText(v){
    return String(v ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‐‑‒–—―ー－]/g,'-')
      .replace(/\s+/g,'')
      .replace(/　+/g,'');
  }

  function active(){
    const v = document.getElementById('view-field-product');
    return !!(v && v.classList.contains('active'));
  }

  function localJSON(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      if (!/^[\[{]/.test(raw.trim())) return null;
      return JSON.parse(raw);
    } catch(e) { return null; }
  }

  function collectRecords(){
    const out = { product:[], worker:[] };
    const seen = new Set();

    function pushProduct(x, source){
      if (!obj(x)) return;
      const ym = normYM(x.ym || x.YM || x.month || x.targetYM || x.date || x.name);
      const has = arr(x.tickets).length || arr(x.rows).length || arr(x.data).length || arr(x.rawRows).length || obj(x.products);
      if (!ym || !has) return;
      const key = `p:${source}:${ym}:${arr(x.tickets).length}:${arr(x.rows).length}:${arr(x.data).length}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.product.push({ ...x, ym, __source:source });
    }

    function pushWorker(x, source){
      if (!obj(x)) return;
      const ym = normYM(x.ym || x.YM || x.month || x.targetYM || x.date || x.name);
      const has = obj(x.workers) || arr(x.rows).length || arr(x.data).length || arr(x.rawRows).length;
      if (!ym || !has) return;
      const key = `w:${source}:${ym}:${Object.keys(x.workers||{}).length}:${arr(x.rows).length}:${arr(x.data).length}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.worker.push({ ...x, ym, __source:source });
    }

    const st = window.STATE || {};
    arr(st.productAddressData).forEach((x,i)=>pushProduct(x, `STATE.productAddressData.${i}`));
    arr(st.workerCsvData).forEach((x,i)=>pushWorker(x, `STATE.workerCsvData.${i}`));

    // 保存済みの旧raw行を拾わないため、localStorage全体探索は行わない。

    return out;
  }

  function allYMs(){
    const rec = collectRecords();
    const yms = new Set();
    rec.product.forEach(x=>x.ym && yms.add(x.ym));
    rec.worker.forEach(x=>x.ym && yms.add(x.ym));
    return [...yms].sort();
  }

  function selectedYM(){
    const yms = allYMs();
    const latest = yms[yms.length-1] || '';

    const localMonth = document.getElementById('fp-product-month-select');
    if (localMonth && normYM(localMonth.value) && yms.includes(normYM(localMonth.value))) return normYM(localMonth.value);

    const common = document.getElementById('field-common-month-select');
    if (common && normYM(common.value) && yms.includes(normYM(common.value))) return normYM(common.value);

    const st = window.STATE || {};
    if (normYM(st.selYM) && yms.includes(normYM(st.selYM))) return normYM(st.selYM);

    // 画面上の最終データ表記から拾う保険
    const sub = document.getElementById('page-sub')?.textContent || '';
    const m = sub.match(/(\d{4})年\s*(\d{1,2})月/);
    if (m) {
      const ym = `${m[1]}${String(m[2]).padStart(2,'0')}`;
      if (yms.includes(ym)) return ym;
    }

    return latest;
  }

  function getRecordsForYM(ym){
    const rec = collectRecords();
    return {
      product: rec.product.filter(x=>x.ym === ym),
      worker: rec.worker.filter(x=>x.ym === ym)
    };
  }

  function textFrom(row, keys){
    if (!row) return '';
    for (const k of keys){
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return '';
  }
  function amountFrom(row){
    return num(row?.amount ?? row?.price ?? row?.value ?? row?.金額 ?? row?.['金額'] ?? row?.U ?? row?.['U列'] ?? row?.Q ?? row?.['Q列']);
  }
  function slipFrom(row){
    return String(row?.slip ?? row?.slipNo ?? row?.slip_no ?? row?.invoiceNo ?? row?.原票番号 ?? row?.['原票番号'] ?? row?.I ?? row?.['I列'] ?? '').trim();
  }
  function workFrom(row){
    return textFrom(row, ['work','workContent','work_content','作業内容','作業名','R列','R','N列','N','label','name','content']);
  }
  function productFrom(row){
    return textFrom(row, ['product','productName','product_name','商品名','商品','P列','P','I列商品','firstProduct']);
  }

  function isKansen(t){
    const s = normalizeText(t);
    return s.includes('幹線') || s.includes('中継');
  }
  function isCrane(t){
    const raw = String(t||'');
    const s = normalizeText(raw);
    if (!raw.trim()) return false;
    if (s.includes('ユニック含まず') || s.includes('unic含まず')) return false;
    return /クレーン|ｸﾚｰﾝ|クレ－ン|クレ-ン|クーレン|ユニック|ﾕﾆｯｸ|UNIC|手吊り|手吊|吊り|吊/i.test(raw)
      || /クレ-ン|クーレン|ユニック|unic|手吊|吊/i.test(s);
  }
  function isRecycle(t){
    const raw = String(t||'');
    const s = normalizeText(raw);
    return /リサイクル|ﾘｻｲｸﾙ|家電リサイクル|リサイクル料/i.test(raw) || s.includes('リサイクル');
  }
  function isWaste(t){
    const raw = String(t||'');
    const s = normalizeText(raw);
    return /廃材|廃材処理|廃材引取|廃材引取り/i.test(raw) || s.includes('廃材');
  }
  function isEstimate(t){
    const s = normalizeText(t);
    return s.includes('見積') || s.includes('下見') || s.includes('現調');
  }
  function isStairs(t){
    const s = normalizeText(t);
    return s.includes('階段') || s.includes('段上げ');
  }
  function isInstall(t){
    const s = normalizeText(t);
    return s.includes('設置') || s.includes('取付') || s.includes('搬入') || s.includes('搬出') || s.includes('入替') || s.includes('入れ替え');
  }
  function isSize(t){
    const raw = String(t||'');
    const s = normalizeText(raw);
    return /サイズ\s*[①②③④⑤⑥⑦1-7]/.test(raw) || /サイズ[①②③④⑤⑥⑦1-7]/.test(s);
  }
  function sizeMid(t){
    const raw = String(t||'');
    const m = raw.match(/サイズ\s*([①②③④⑤⑥⑦1-7])/);
    if (!m) return 'サイズその他';
    const map = {'①':'①','②':'②','③':'③','④':'④','⑤':'⑤','⑥':'⑥','⑦':'⑦','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦'};
    return `サイズ${map[m[1]] || m[1]}`;
  }

  function bracketParts(text){
    const s = String(text||'');
    const res = [];
    const re = /【([^】]+)】/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] && m[1].trim()) res.push(m[1].trim());
    }
    return res.length ? res : (s.trim() ? [s.trim()] : []);
  }

  function fridgeVolume(text){
    const s = String(text||'').normalize('NFKC');
    let v = 0;
    const m3 = s.match(/([1-9]\d{2})\s*l/i) || s.match(/([1-9]\d{2})\s*L/i);
    if (m3) v = Number(m3[1]);

    if (!v) {
      const nums2 = Array.from(s.matchAll(/(?:^|[^0-9])([1-9]\d)(?:[^0-9]|$)/g)).map(x=>Number(x[1]));
      const p = nums2.find(x=>x>=20 && x<=99);
      if (p) v = p * 10;
    }
    if (!v) {
      const nums3 = Array.from(s.matchAll(/(?:^|[^0-9])([1-9]\d{2})(?:[^0-9]|$)/g)).map(x=>Number(x[1]));
      const p = nums3.find(x=>x>=100 && x<=900);
      if (p) v = p;
    }

    if (!v) return '容量不明';
    if (v < 300) return '300L未満';
    if (v < 400) return '300〜399L';
    if (v < 500) return '400〜499L';
    if (v < 600) return '500〜599L';
    if (v < 700) return '600〜699L';
    return '700L以上';
  }

  function classifyProductOnly(product){
    const raw = String(product||'');
    const s = normalizeText(raw);
    if (!raw.trim()) return {big:'付帯作業・その他', mid:'未設定', small:'未設定'};

    if (isCrane(raw)) return {big:'クレーン', mid:'クレーン作業', small:raw};

    if (isRecycle(raw)) {
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(s)) return {big:'リサイクル', mid:'冷蔵庫', small:raw};
      if (/洗濯|センタク|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(s)) return {big:'リサイクル', mid:'洗濯機', small:raw};
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(s)) return {big:'リサイクル', mid:'テレビ', small:raw};
      return {big:'リサイクル', mid:'その他', small:raw};
    }

    if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(s)) return {big:'冷蔵庫', mid:fridgeVolume(raw), small:raw};
    if (/洗濯|センタク|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(s)) return {big:'洗濯機', mid:(/ドラム|乾燥/.test(raw)||/ドラム|乾燥/.test(s))?'ドラム・乾燥機':'洗濯機', small:raw};
    if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(s)) return {big:'テレビ', mid:'テレビ', small:raw};
    if (/エアコン|空調/.test(raw) || /エアコン|空調/.test(s)) return {big:'エアコン', mid:'エアコン', small:raw};
    if (/レンジ|オーブン/.test(raw) || /レンジ|オーブン/.test(s)) return {big:'レンジ', mid:'レンジ', small:raw};
    if (/炊飯/.test(raw) || /炊飯/.test(s)) return {big:'炊飯器', mid:'炊飯器', small:raw};

    return {big:'付帯作業・その他', mid:'その他', small:raw};
  }

  function classify(work, product){
    const w = String(work||'');

    if (isCrane(w)) {
      let mid = 'クレーン作業';
      if (isEstimate(w)) mid = 'クレーン見積もり';
      else if (normalizeText(w).includes('差額')) mid = 'クレーン差額';
      else if (isInstall(w)) mid = 'クレーン搬入';
      return {big:'クレーン', mid, small:w || 'クレーン'};
    }

    if (isRecycle(w)) {
      const s = normalizeText(w);
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(w) || /冷蔵|冷凍/.test(s)) return {big:'リサイクル', mid:'冷蔵庫', small:w};
      if (/洗濯|センタク|ドラム|乾燥/.test(w) || /洗濯|ドラム|乾燥/.test(s)) return {big:'リサイクル', mid:'洗濯機', small:w};
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(w) || /テレビ|tv|液晶|有機|oled/.test(s)) return {big:'リサイクル', mid:'テレビ', small:w};
      return {big:'リサイクル', mid:'その他', small:w};
    }

    if (isWaste(w)) return {big:'廃材', mid:'廃材', small:w};
    if (isStairs(w)) return {big:'作業', mid:'階段上げ', small:w};
    if (isEstimate(w)) return {big:'作業', mid:'見積もり', small:w};

    const parts = bracketParts(product);
    if (parts.length) return classifyProductOnly(parts[0]);

    if (isSize(w)) return {big:'配送', mid:sizeMid(w), small:w};
    if (isInstall(w)) return {big:'作業', mid:'設置・搬入', small:w};

    return classifyProductOnly(w || product || '');
  }

  function add(map, cls, count, amount){
    const key = `${cls.big}||${cls.mid}`;
    if (!map.has(key)) map.set(key, {big:cls.big, mid:cls.mid, count:0, amount:0, small:new Map()});
    const m = map.get(key);
    m.count += count;
    m.amount += amount;
    const sk = cls.small || cls.mid || cls.big;
    if (!m.small.has(sk)) m.small.set(sk, {label:sk, count:0, amount:0});
    const sm = m.small.get(sk);
    sm.count += count;
    sm.amount += amount;
  }

  function rowsFromProductRecord(rec){
    const rows = [];

    arr(rec?.tickets).forEach(t=>{
      const product = t.product || t.productName || t.product_name || '';
      const slip = t.slip || t.slipNo || '';
      const details = arr(t.workDetails).length
        ? arr(t.workDetails)
        : Object.entries(t.works || {}).map(([work, amount])=>({work, amount}));

      if (details.length) {
        details.forEach(d=>rows.push({
          slip,
          product,
          work: workFrom(d),
          amount: amountFrom(d)
        }));
      } else {
        rows.push({
          slip,
          product,
          work: '',
          amount: amountFrom(t)
        });
      }
    });



    return rows.filter(r=>r.product || r.work || r.amount);
  }

  function rowsFromWorkerRecord(rec){
    const rows = [];
    Object.values(rec?.workers || {}).forEach(w=>{
      Object.entries(w.works || {}).forEach(([work, v])=>{
        const amount = obj(v) ? amountFrom(v) : num(v);
        rows.push({slip:'', product:'', work, amount});
      });
      Object.entries(w.chartWorks || {}).forEach(([work, v])=>{
        if (w.works && w.works[work]) return;
        const amount = obj(v) ? amountFrom(v) : num(v);
        rows.push({slip:'', product:'', work, amount});
      });
    });



    return rows.filter(r=>r.product || r.work || r.amount);
  }

  function aggregate(){
    const ym = selectedYM();
    const records = getRecordsForYM(ym);
    let rows = [];

    // 商品・住所CSVがあればそれを優先。なければ作業者CSVを保険利用。
    records.product.forEach(r=>{ rows.push(...rowsFromProductRecord(r)); });
    if (!rows.length) records.worker.forEach(r=>{ rows.push(...rowsFromWorkerRecord(r)); });

    const map = new Map();
    let totalAmount = 0;
    let totalCount = 0;
    const slips = new Set();
    let excluded = 0;

    rows.forEach(r=>{
      if (isKansen(r.work)) {
        excluded += r.amount;
        return;
      }

      const cls = classify(r.work, r.product);
      add(map, cls, 1, r.amount);
      totalAmount += r.amount;
      totalCount += 1;
      if (r.slip) slips.add(String(r.slip));
    });

    const mids = [...map.values()].map(m=>({
      ...m,
      smallList:[...m.small.values()].sort((a,b)=>b.amount-a.amount || b.count-a.count)
    })).sort((a,b)=>b.amount-a.amount || b.count-a.count);

    const bigMap = new Map();
    mids.forEach(m=>{
      if (!bigMap.has(m.big)) bigMap.set(m.big,{big:m.big, amount:0, count:0, mids:[]});
      const b = bigMap.get(m.big);
      b.amount += m.amount;
      b.count += m.count;
      b.mids.push(m);
    });

    const bigs = [...bigMap.values()].sort((a,b)=>b.amount-a.amount || b.count-a.count);

    return {
      ym,
      rows,
      bigs,
      mids,
      totalAmount,
      totalCount,
      slipCount: slips.size || totalCount,
      excluded
    };
  }

  function ensureStyle(){
    if (document.getElementById('field-product-final-style')) return;
    const st = document.createElement('style');
    st.id = 'field-product-final-style';
    st.textContent = `
      #view-field-product .fp-selector-card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:16px 18px;margin-bottom:14px;display:flex;justify-content:space-between;gap:12px;align-items:center;box-shadow:0 10px 24px rgba(15,23,42,.06)}
      #view-field-product .fp-selector-title{font-size:16px;font-weight:900;color:#0f172a;margin-bottom:6px}
      #view-field-product .fp-selector-sub{font-size:12px;color:#8493a8;font-weight:700}
      #view-field-product .fp-selector-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      #view-field-product .fp-selector-controls label{font-size:12px;font-weight:900;color:#0f172a}
      #view-field-product .fp-selector-controls select{font-size:14px;font-weight:900;border:1px solid #cbd5e1;border-radius:10px;padding:9px 14px;background:#fff;color:#0f172a}
      #view-field-product .fp-note{font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.7}
      #view-field-product .fp-kpi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
      #view-field-product .fp-kpi .kpi-card{min-height:96px}
      #view-field-product .fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      #view-field-product .fp-card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.06);overflow:hidden}
      #view-field-product .fp-card-head{padding:14px 16px;border-bottom:1px solid #dbe3ee}
      #view-field-product .fp-card-title{font-size:15px;font-weight:900;color:#0f172a}
      #view-field-product .fp-card-sub{font-size:12px;color:#8493a8;font-weight:700;margin-top:4px}
      #view-field-product .fp-card-body{padding:16px}
      #view-field-product .fp-bar-row{display:grid;grid-template-columns:minmax(130px,230px) 1fr minmax(120px,150px);gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #eef2f7}
      #view-field-product .fp-bar-name{font-weight:900;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #view-field-product .fp-track{height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden}
      #view-field-product .fp-fill{height:100%;border-radius:999px;background:#1a4d7c}
      #view-field-product .fp-val{text-align:right;font-weight:900;color:#0f172a;white-space:nowrap}
      #view-field-product .fp-sub{font-size:12px;color:#64748b;font-weight:700}
      #view-field-product .fp-detail-card{border:1px solid #dbe3ee;border-radius:14px;margin:10px 0;background:#fff;overflow:hidden}
      #view-field-product .fp-detail-head{display:grid;grid-template-columns:30px 1fr auto auto;gap:10px;align-items:center;padding:12px 14px;background:#f8fafc;cursor:pointer}
      #view-field-product .fp-detail-head:hover{background:#f1f5f9}
      #view-field-product .fp-plus{font-weight:900;color:#1a4d7c;font-size:18px}
      #view-field-product .fp-detail-title{font-size:15px;font-weight:900;color:#0f172a}
      #view-field-product .fp-pill{display:inline-flex;align-items:center;border:1px solid #dbe3ee;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;background:#fff;color:#334155;white-space:nowrap}
      #view-field-product .fp-detail-body{display:none;padding:12px 18px 16px}
      #view-field-product .fp-detail-card.open>.fp-detail-body{display:block}
      #view-field-product .fp-detail-card.open>.fp-detail-head .fp-plus{transform:rotate(45deg)}
      #view-field-product .fp-mini-table{width:100%;border-collapse:collapse;font-size:12px}
      #view-field-product .fp-mini-table th{background:#f3f6fb;color:#334155;text-align:left;padding:8px}
      #view-field-product .fp-mini-table td{border-bottom:1px solid #e5e7eb;padding:8px}
      #view-field-product .fp-mini-table .r{text-align:right}
      @media(max-width:1200px){#view-field-product .fp-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}#view-field-product .fp-grid{grid-template-columns:1fr}#view-field-product .fp-bar-row{grid-template-columns:1fr}#view-field-product .fp-val{text-align:left}#view-field-product .fp-selector-card{display:block}#view-field-product .fp-selector-controls{margin-top:12px}}
    `;
    document.head.appendChild(st);
  }

  function kpi(label,value,sub,accent='navy'){
    return `<div class="kpi-card accent-${accent}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${sub?`<div class="kpi-sub">${esc(sub)}</div>`:''}</div>`;
  }

  function selectorHTML(result){
    const yms = allYMs();
    const ym = result.ym || yms[yms.length-1] || '';
    const fy = fiscalYear(ym);
    const years = [...new Set(yms.map(fiscalYear).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
    const months = yms.filter(x=>fiscalYear(x)===fy).sort(fyMonthSort);

    return `<div class="fp-selector-card">
      <div>
        <div class="fp-selector-title">表示対象</div>
        <div class="fp-selector-sub">年度順：4月 → 翌年3月 / 登録済みデータ月のみ表示</div>
      </div>
      <div class="fp-selector-controls">
        <label>対象年度</label>
        <select id="fp-product-year-select">${(years.length?years:[fy]).map(y=>`<option value="${esc(y)}" ${y===fy?'selected':''}>${esc(y)}年度</option>`).join('')}</select>
        <label>対象月</label>
        <select id="fp-product-month-select">${(months.length?months:[ym]).filter(Boolean).map(x=>`<option value="${esc(x)}" ${x===ym?'selected':''}>${esc(ymText(x))}</option>`).join('') || '<option value="">データなし</option>'}</select>
      </div>
    </div>`;
  }

  function render(){
    if (!active()) return;

    ensureStyle();
    const view = document.getElementById('view-field-product');
    if (!view) return;

    const result = aggregate();
    const maxBig = Math.max(...result.bigs.map(x=>x.amount),1);
    const maxMid = Math.max(...result.mids.slice(0,12).map(x=>x.amount),1);
    const top = result.bigs[0];

    view.innerHTML = `
      ${selectorHTML(result)}
      <div class="fp-note">商品カテゴリは、作業内容を優先して分類しています。クレーン・ユニック・手吊り系は最優先でクレーンへ集約し、通常の商品配送は商品名で補完します。</div>

      <div class="fp-kpi">
        ${kpi('対象月', ymText(result.ym), '商品カテゴリ分析')}
        ${kpi('商品売上', `${fmtK(result.totalAmount)}千円`, '幹線料除外後', 'green')}
        ${kpi('原票数', fmt(result.slipCount), '原票番号ユニーク')}
        ${kpi('平均単価', `${fmt(result.slipCount ? result.totalAmount/result.slipCount : 0)}円`, '売上 ÷ 原票数', 'amber')}
        ${kpi('最大カテゴリ', top ? top.big : '—', top ? `${fmtK(top.amount)}千円 / ${pct(top.amount,result.totalAmount)}` : '', 'navy')}
      </div>

      <div class="fp-grid">
        <div class="fp-card">
          <div class="fp-card-head"><div class="fp-card-title">大分類別 売上構成</div><div class="fp-card-sub">クレーン・リサイクル・商品分類を整理</div></div>
          <div class="fp-card-body">
            ${result.bigs.length ? result.bigs.map((x,i)=>`
              <div class="fp-bar-row">
                <div class="fp-bar-name">${i+1}. ${esc(x.big)}<div class="fp-sub">${fmt(x.count)}点 / ${pct(x.amount,result.totalAmount)}</div></div>
                <div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,x.amount/maxBig*100).toFixed(1)}%;background:${COLORS[i%COLORS.length]}"></div></div>
                <div class="fp-val">${fmtK(x.amount)}千円</div>
              </div>`).join('') : '<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>'}
          </div>
        </div>
        <div class="fp-card">
          <div class="fp-card-head"><div class="fp-card-title">中分類 上位</div><div class="fp-card-sub">容量帯・作業区分別</div></div>
          <div class="fp-card-body">
            ${result.mids.length ? result.mids.slice(0,12).map((x,i)=>`
              <div class="fp-bar-row">
                <div class="fp-bar-name">${i+1}. ${esc(x.mid || x.big)}<div class="fp-sub">${esc(x.big)} / ${fmt(x.count)}点</div></div>
                <div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,x.amount/maxMid*100).toFixed(1)}%;background:${COLORS[i%COLORS.length]}"></div></div>
                <div class="fp-val">${fmtK(x.amount)}千円</div>
              </div>`).join('') : '<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>'}
          </div>
        </div>
      </div>

      <div class="fp-card">
        <div class="fp-card-head"><div class="fp-card-title">商品カテゴリ別詳細</div><div class="fp-card-sub">大分類 → 中分類 → 元表記を開閉できます</div></div>
        <div class="fp-card-body">
          ${result.bigs.length ? result.bigs.map((big,idx)=>`
            <div class="fp-detail-card ${idx===0?'open':''}">
              <div class="fp-detail-head" onclick="this.parentElement.classList.toggle('open')">
                <div class="fp-plus">＋</div><div class="fp-detail-title">${esc(big.big)}</div><div class="fp-pill">${fmtK(big.amount)}千円</div><div class="fp-pill">${fmt(big.count)}点</div>
              </div>
              <div class="fp-detail-body">
                ${big.mids.sort((a,b)=>b.amount-a.amount||b.count-a.count).map(mid=>`
                  <div class="fp-detail-card">
                    <div class="fp-detail-head" onclick="this.parentElement.classList.toggle('open')">
                      <div class="fp-plus">＋</div><div class="fp-detail-title">${esc(mid.mid || mid.big)}</div><div class="fp-pill">${fmtK(mid.amount)}千円</div><div class="fp-pill">${fmt(mid.count)}点</div>
                    </div>
                    <div class="fp-detail-body">
                      <table class="fp-mini-table">
                        <thead><tr><th>小分類・元表記</th><th class="r">商品点数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead>
                        <tbody>${mid.smallList.slice(0,100).map(s=>`<tr><td>${esc(s.label)}</td><td class="r">${fmt(s.count)}</td><td class="r">${fmtK(s.amount)}千円</td><td class="r">${pct(s.amount,result.totalAmount)}</td></tr>`).join('')}</tbody>
                      </table>
                    </div>
                  </div>`).join('')}
              </div>
            </div>`).join('') : '<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>'}
        </div>
      </div>
    `;

    const fySel = document.getElementById('fp-product-year-select');
    const ymSel = document.getElementById('fp-product-month-select');
    if (fySel) fySel.onchange = () => {
      const yms = allYMs().filter(x=>fiscalYear(x)===fySel.value).sort(fyMonthSort);
      const next = yms[yms.length-1] || allYMs().at(-1) || '';
      if (window.STATE) STATE.selYM = next;
      const common = document.getElementById('field-common-month-select');
      if (common && [...common.options].some(o=>o.value===next)) common.value = next;
      rerender();
    };
    if (ymSel) ymSel.onchange = () => {
      if (window.STATE) STATE.selYM = ymSel.value;
      const common = document.getElementById('field-common-month-select');
      if (common && [...common.options].some(o=>o.value===ymSel.value)) common.value = ymSel.value;
      rerender();
    };

    view.dataset.fieldProductFinal = '1';
  }

  function rerender(){
    clearTimeout(timer);
    timer = setTimeout(render, 40);
  }

  function hook(){
    if (window.NAV && typeof NAV.go === 'function' && !window.__FIELD_PRODUCT_NAV_FINAL_PATCHED__) {
      window.__FIELD_PRODUCT_NAV_FINAL_PATCHED__ = true;
      const old = NAV.go.bind(NAV);
      NAV.go = function(el){
        const ret = old.apply(this, arguments);
        if (el && el.dataset && el.dataset.view === 'field-product') rerender();
        return ret;
      };
    }

    document.addEventListener('change', e=>{
      const id = e.target && e.target.id;
      if (id === 'field-common-month-select' || id === 'field-common-year-select' || id === 'field-common-fy-select') rerender();
    });

    setInterval(()=>{
      if (!active()) return;
      const view = document.getElementById('view-field-product');
      if (!view) return;
      const oldUI = view.dataset.fieldProductFinal !== '1' || view.querySelector('#f-product-tbody') || view.querySelector('#c-product-bar');
      if (oldUI) render();
    }, 300);

    rerender();
    window.addEventListener('load', rerender);
  }

  window.FIELD_PRODUCT_UI = window.FIELD_PRODUCT_UI || {};
  window.FIELD_PRODUCT_UI.render = render;
  window.FIELD_PRODUCT_UI.refresh = rerender;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

})();
