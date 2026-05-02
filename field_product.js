/* field_product.js
   商品カテゴリ分析：復旧・安定版 2026-05-02
   - field_core.js の旧描画に上書きされても、商品カテゴリ分析表示中は本ファイル側で再描画
   - N/R列相当の「作業内容」を優先して、クレーン・リサイクル・廃材・作業系を判定
   - 通常のサイズ配送料は、商品名がある場合は商品名分類を優先
   - 商品名が空欄の場合は、作業内容から補完
   - クレーン／ユニック／手吊り／吊り系は最優先
   - 「ユニック含まず」はクレーン扱いしない
   - Chart.js 依存なし。HTMLバーで表示
*/
'use strict';

(function(){
  const MODULE_KEY = '__FIELD_PRODUCT_STABLE_WORKFIRST_20260502_V2__';
  window[MODULE_KEY] = true;

  const MONTHS = ['04','05','06','07','08','09','10','11','12','01','02','03'];
  const COLORS = ['#1a4d7c','#e05b4d','#198754','#b85c00','#2563eb','#7c3aed','#0891b2','#be185d','#65a30d','#ea580c'];

  let renderTimer = null;
  let forceUntil = 0;

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function n(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    const num = Number(s);
    return Number.isFinite(num) ? num : 0;
  }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
  function fmt(v){ return Math.round(n(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(n(v) / 1000).toLocaleString('ja-JP'); }
  function pct(v,total){ return total ? (n(v) / total * 100).toFixed(1) + '%' : '0.0%'; }
  function ymLabel2(ym){
    if (typeof ymLabel === 'function') return ymLabel(ym);
    const s = String(ym || '');
    if (s.length >= 6) return `${s.slice(0,4)}年${Number(s.slice(4,6))}月`;
    return s || '未選択';
  }
  function fiscalYearFromYM2(ym){
    const y = Number(String(ym || '').slice(0,4));
    const m = Number(String(ym || '').slice(4,6));
    if (!y || !m) return String(new Date().getFullYear());
    return String(m <= 3 ? y - 1 : y);
  }
  function ymFromFiscalMonth(fy, mm){
    fy = Number(String(fy || '').replace(/年度/g,''));
    mm = String(mm || '04').padStart(2,'0');
    const year = ['01','02','03'].includes(mm) ? fy + 1 : fy;
    return `${year}${mm}`;
  }
  function normalizeText(text){
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‐‑‒–—―ー－]/g,'-')
      .replace(/\s+/g,'')
      .replace(/　+/g,'');
  }

  function viewActive(){
    const v = document.getElementById('view-field-product');
    return !!(v && v.classList.contains('active'));
  }

  function getYms(){
    const s = window.STATE || {};
    const yms = new Set();
    safeArray(s.productAddressData).forEach(d => d && d.ym && yms.add(String(d.ym)));
    safeArray(s.workerCsvData).forEach(d => d && d.ym && yms.add(String(d.ym)));
    safeArray(s.fieldData).forEach(d => d && d.ym && yms.add(String(d.ym)));
    return [...yms].sort();
  }

  function latestYM(){
    const yms = getYms();
    return yms[yms.length - 1] || (window.STATE && STATE.selYM) || '';
  }

  function hasDataYM(ym){
    return getYms().includes(String(ym || ''));
  }

  function selectedYM(){
    const yms = getYms();
    const latest = latestYM();

    const localMonth = document.getElementById('fp-product-month-select');
    const localYear = document.getElementById('fp-product-year-select');
    if (localMonth && localYear && localMonth.value && localYear.value) {
      const ym = ymFromFiscalMonth(localYear.value, localMonth.value);
      if (hasDataYM(ym)) return ym;
      return latest;
    }

    const commonMonth = document.getElementById('field-common-month-select');
    const commonYear = document.getElementById('field-common-year-select');
    if (commonMonth && commonYear && commonMonth.value && commonYear.value) {
      const ym = ymFromFiscalMonth(commonYear.value, commonMonth.value);
      if (hasDataYM(ym)) return ym;
      return latest;
    }

    return latest;
  }

  function productRecord(ym){
    const s = window.STATE || {};
    return safeArray(s.productAddressData).find(d => String(d.ym) === String(ym))
        || safeArray(s.fieldData).find(d => String(d.ym) === String(ym) && safeArray(d.tickets).length);
  }

  function workerRecord(ym){
    const s = window.STATE || {};
    return safeArray(s.workerCsvData).find(d => String(d.ym) === String(ym));
  }

  function getWorkTextFromDetail(d){
    if (!d) return '';
    return String(d.work ?? d.workContent ?? d.work_content ?? d['作業内容'] ?? d.label ?? d.name ?? '');
  }

  function getAmountFromDetail(d){
    if (!d) return 0;
    return n(d.amount ?? d.price ?? d.value ?? d['金額']);
  }

  function isKansen(workRaw){
    const t = normalizeText(workRaw);
    return t.includes('幹線') || t.includes('中継');
  }

  function isCrane(workRaw){
    const raw = String(workRaw || '');
    const t = normalizeText(raw);
    if (!raw.trim()) return false;
    if (t.includes('ユニック含まず') || t.includes('unic含まず')) return false;

    return (
      /クレーン|ｸﾚｰﾝ|クレ－ン|クレ-ン|クーレン|ﾕﾆｯｸ|ユニック|手吊り|手吊|吊り|吊|UNIC/i.test(raw)
      || /クレ-ン|クーレン|ユニック|手吊|吊|unic/i.test(t)
    );
  }

  function isRecycle(workRaw){
    const raw = String(workRaw || '');
    const t = normalizeText(raw);
    return /リサイクル|ﾘｻｲｸﾙ|家電リサイクル|リサイクル料|リサイクル料金/i.test(raw) || t.includes('リサイクル');
  }

  function isWaste(workRaw){
    const raw = String(workRaw || '');
    const t = normalizeText(raw);
    return /廃材|廃材処理|廃材引取|廃材引取り|廃材引取料/i.test(raw) || t.includes('廃材');
  }

  function isEstimate(workRaw){
    const t = normalizeText(workRaw);
    return t.includes('見積') || t.includes('下見') || t.includes('現調');
  }

  function isStairs(workRaw){
    const t = normalizeText(workRaw);
    return t.includes('階段') || t.includes('段上げ');
  }

  function isInstallWork(workRaw){
    const t = normalizeText(workRaw);
    return t.includes('設置') || t.includes('取付') || t.includes('取付け') || t.includes('搬入') || t.includes('搬出') || t.includes('入替') || t.includes('入れ替え');
  }

  function isSizeDelivery(workRaw){
    const raw = String(workRaw || '');
    const t = normalizeText(raw);
    return /サイズ\s*[①②③④⑤⑥⑦1-7]/.test(raw) || /サイズ[①②③④⑤⑥⑦1-7]/.test(t);
  }

  function sizeMid(workRaw){
    const raw = String(workRaw || '');
    const m = raw.match(/サイズ\s*([①②③④⑤⑥⑦1-7])/);
    if (!m) return 'サイズその他';
    const map = {'①':'①','②':'②','③':'③','④':'④','⑤':'⑤','⑥':'⑥','⑦':'⑦','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦'};
    return `サイズ${map[m[1]] || m[1]}`;
  }

  function bracketParts(text){
    const s = String(text || '');
    const parts = [];
    const re = /【([^】]+)】/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] && m[1].trim()) parts.push(m[1].trim());
    }
    return parts.length ? parts : (s.trim() ? [s.trim()] : []);
  }

  function refrigeratorVolume(text){
    const s = String(text || '').normalize('NFKC');
    let v = 0;

    const explicit = s.match(/([1-9]\d{2})\s*l/i) || s.match(/([1-9]\d{2})\s*Ｌ/i);
    if (explicit) v = Number(explicit[1]);

    if (!v) {
      const nums = Array.from(s.matchAll(/(?:^|[^0-9])([1-9]\d)(?:[^0-9]|$)/g)).map(x => Number(x[1]));
      const p = nums.find(x => x >= 20 && x <= 99);
      if (p) v = p * 10;
    }

    if (!v) {
      const nums3 = Array.from(s.matchAll(/(?:^|[^0-9])([1-9]\d{2})(?:[^0-9]|$)/g)).map(x => Number(x[1]));
      const p = nums3.find(x => x >= 100 && x <= 900);
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

  function classifyProductText(productRaw){
    const raw = String(productRaw || '');
    const t = normalizeText(raw);

    if (!raw.trim()) return { big:'付帯作業・その他', mid:'未設定', small:'未設定' };

    if (isCrane(raw)) return { big:'クレーン', mid:'クレーン作業', small:raw };

    if (isRecycle(raw)) {
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(t)) return { big:'リサイクル', mid:'冷蔵庫', small:raw };
      if (/洗濯|センタク|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(t)) return { big:'リサイクル', mid:'洗濯機', small:raw };
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(t)) return { big:'リサイクル', mid:'テレビ', small:raw };
      return { big:'リサイクル', mid:'その他', small:raw };
    }

    if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(t)) return { big:'冷蔵庫', mid:refrigeratorVolume(raw), small:raw };
    if (/洗濯|センタク|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(t)) return { big:'洗濯機', mid:(/ドラム|乾燥/.test(raw) || /ドラム|乾燥/.test(t)) ? 'ドラム・乾燥機' : '洗濯機', small:raw };
    if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(t)) return { big:'テレビ', mid:'テレビ', small:raw };
    if (/エアコン|空調/.test(raw) || /エアコン|空調/.test(t)) return { big:'エアコン', mid:'エアコン', small:raw };
    if (/レンジ|オーブン/.test(raw) || /レンジ|オーブン/.test(t)) return { big:'レンジ', mid:'レンジ', small:raw };
    if (/炊飯/.test(raw) || /炊飯/.test(t)) return { big:'炊飯器', mid:'炊飯器', small:raw };

    return { big:'付帯作業・その他', mid:'その他', small:raw };
  }

  function classify(workRaw, productRaw){
    const work = String(workRaw || '');

    // 最優先：商品ではない売上・作業系
    if (isCrane(work)) {
      let mid = 'クレーン作業';
      if (isEstimate(work)) mid = 'クレーン見積もり';
      else if (normalizeText(work).includes('差額')) mid = 'クレーン差額';
      else if (isInstallWork(work)) mid = 'クレーン搬入';
      return { big:'クレーン', mid, small:work || 'クレーン' };
    }

    if (isRecycle(work)) {
      const wt = normalizeText(work);
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(work) || /冷蔵|冷凍/.test(wt)) return { big:'リサイクル', mid:'冷蔵庫', small:work };
      if (/洗濯|センタク|ドラム|乾燥/.test(work) || /洗濯|ドラム|乾燥/.test(wt)) return { big:'リサイクル', mid:'洗濯機', small:work };
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(work) || /テレビ|tv|液晶|有機|oled/.test(wt)) return { big:'リサイクル', mid:'テレビ', small:work };
      return { big:'リサイクル', mid:'その他', small:work };
    }

    if (isWaste(work)) return { big:'廃材', mid:'廃材', small:work };

    if (isStairs(work)) return { big:'作業', mid:'階段上げ', small:work };
    if (isEstimate(work)) return { big:'作業', mid:'見積もり', small:work };

    // 商品名がある通常配送は、サイズ配送料ではなく商品名を優先
    const productParts = bracketParts(productRaw);
    if (productParts.length) {
      return classifyProductText(productParts[0]);
    }

    // 商品名がない場合だけ作業内容で補完
    if (isSizeDelivery(work)) return { big:'配送', mid:sizeMid(work), small:work };
    if (isInstallWork(work)) return { big:'作業', mid:'設置・搬入', small:work };

    return classifyProductText(work || productRaw || '');
  }

  function addToMap(map, cls, count, amount){
    const key = `${cls.big}||${cls.mid}`;
    if (!map.has(key)) {
      map.set(key, { big:cls.big, mid:cls.mid, count:0, amount:0, small:new Map() });
    }
    const m = map.get(key);
    m.count += count;
    m.amount += amount;
    const smallLabel = cls.small || cls.mid || cls.big;
    if (!m.small.has(smallLabel)) m.small.set(smallLabel, { label:smallLabel, count:0, amount:0 });
    const s = m.small.get(smallLabel);
    s.count += count;
    s.amount += amount;
  }

  function aggregate(){
    const ym = selectedYM();
    const rec = productRecord(ym);
    const worker = workerRecord(ym);

    const map = new Map();
    let totalAmount = 0;
    let totalCount = 0;
    let excludedAmount = 0;
    const slips = new Set();

    if (rec && safeArray(rec.tickets).length) {
      safeArray(rec.tickets).forEach(t => {
        if (t.slip) slips.add(String(t.slip));

        const details = safeArray(t.workDetails).length
          ? safeArray(t.workDetails)
          : Object.entries(t.works || {}).map(([work, amount]) => ({ work, amount }));

        if (details.length) {
          details.forEach(d => {
            const work = getWorkTextFromDetail(d);
            const amount = getAmountFromDetail(d);
            if (isKansen(work)) {
              excludedAmount += amount;
              return;
            }
            const cls = classify(work, t.product || '');
            addToMap(map, cls, 1, amount);
            totalAmount += amount;
            totalCount += 1;
          });
        } else {
          const amount = n(t.amount);
          const cls = classify('', t.product || '');
          addToMap(map, cls, 1, amount);
          totalAmount += amount;
          totalCount += 1;
        }
      });
    } else if (worker && worker.workers) {
      // 保険：商品住所CSVがない場合は作業者CSVの works から表示
      Object.values(worker.workers).forEach(w => {
        Object.entries(w.works || {}).forEach(([work, obj]) => {
          const amount = typeof obj === 'object' ? n(obj.amount) : n(obj);
          if (isKansen(work)) {
            excludedAmount += amount;
            return;
          }
          const cls = classify(work, '');
          addToMap(map, cls, 1, amount);
          totalAmount += amount;
          totalCount += 1;
        });
      });
    }

    const mids = Array.from(map.values()).map(x => ({
      ...x,
      smallList: Array.from(x.small.values()).sort((a,b)=>b.amount-a.amount || b.count-a.count)
    })).sort((a,b)=>b.amount-a.amount || b.count-a.count);

    const bigMap = new Map();
    mids.forEach(m => {
      if (!bigMap.has(m.big)) bigMap.set(m.big, { big:m.big, amount:0, count:0, mids:[] });
      const b = bigMap.get(m.big);
      b.amount += m.amount;
      b.count += m.count;
      b.mids.push(m);
    });

    const bigs = Array.from(bigMap.values()).sort((a,b)=>b.amount-a.amount || b.count-a.count);

    return {
      ym,
      rec,
      worker,
      mids,
      bigs,
      totalAmount,
      totalCount,
      slipCount: slips.size || (rec ? n(rec.uniqueCount) : totalCount),
      excludedAmount
    };
  }

  function ensureStyle(){
    if (document.getElementById('field-product-stable-style-v2')) return;
    const st = document.createElement('style');
    st.id = 'field-product-stable-style-v2';
    st.textContent = `
      #view-field-product .fp-selector-card{
        background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:16px 18px;margin-bottom:14px;
        display:flex;justify-content:space-between;gap:12px;align-items:center;box-shadow:0 10px 24px rgba(15,23,42,.06)
      }
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
      #view-field-product .fp-detail-card.open .fp-detail-body{display:block}
      #view-field-product .fp-detail-card.open>.fp-detail-head .fp-plus{transform:rotate(45deg)}
      #view-field-product .fp-mini-table{width:100%;border-collapse:collapse;font-size:12px}
      #view-field-product .fp-mini-table th{background:#f3f6fb;color:#334155;text-align:left;padding:8px}
      #view-field-product .fp-mini-table td{border-bottom:1px solid #e5e7eb;padding:8px}
      #view-field-product .fp-mini-table .r{text-align:right}
      @media(max-width:1200px){
        #view-field-product .fp-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}
        #view-field-product .fp-grid{grid-template-columns:1fr}
        #view-field-product .fp-bar-row{grid-template-columns:1fr}
        #view-field-product .fp-val{text-align:left}
        #view-field-product .fp-selector-card{display:block}
        #view-field-product .fp-selector-controls{margin-top:12px}
      }
    `;
    document.head.appendChild(st);
  }

  function kpi(label, value, sub, accent='navy'){
    return `<div class="kpi-card accent-${accent}">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
    </div>`;
  }

  function renderSelector(result){
    const yms = getYms();
    const years = [...new Set(yms.map(fiscalYearFromYM2))].sort((a,b)=>Number(b)-Number(a));
    const ym = result.ym || latestYM();
    const curFY = fiscalYearFromYM2(ym);
    const curMM = String(ym).slice(4,6) || '03';

    return `<div class="fp-selector-card">
      <div>
        <div class="fp-selector-title">表示対象</div>
        <div class="fp-selector-sub">年度順：4月 → 翌年3月 / 年度・月を共通管理</div>
      </div>
      <div class="fp-selector-controls">
        <label>対象年度</label>
        <select id="fp-product-year-select">
          ${(years.length ? years : [curFY]).map(y=>`<option value="${esc(y)}" ${String(y)===String(curFY)?'selected':''}>${esc(y)}年度</option>`).join('')}
        </select>
        <label>対象月</label>
        <select id="fp-product-month-select">
          ${MONTHS.map(mm=>`<option value="${mm}" ${mm===curMM?'selected':''}>${Number(mm)}月</option>`).join('')}
        </select>
      </div>
    </div>`;
  }

  function render(){
    if (!viewActive()) return;

    ensureStyle();
    const view = document.getElementById('view-field-product');
    if (!view) return;

    const result = aggregate();
    const maxBig = Math.max(...result.bigs.map(x=>x.amount),1);
    const maxMid = Math.max(...result.mids.slice(0,12).map(x=>x.amount),1);
    const top = result.bigs[0];

    view.innerHTML = `
      ${renderSelector(result)}
      <div class="fp-note">
        商品カテゴリは、作業内容を優先して分類しています。クレーン・ユニック・手吊り系は最優先でクレーンへ集約し、通常の商品配送は商品名で補完します。
      </div>

      <div class="fp-kpi">
        ${kpi('対象月', ymLabel2(result.ym), '商品カテゴリ分析')}
        ${kpi('商品売上', `${fmtK(result.totalAmount)}千円`, '幹線料除外後', 'green')}
        ${kpi('原票数', fmt(result.slipCount), '原票番号ユニーク')}
        ${kpi('平均単価', `${fmt(result.slipCount ? result.totalAmount / result.slipCount : 0)}円`, '売上 ÷ 原票数', 'amber')}
        ${kpi('最大カテゴリ', top ? top.big : '—', top ? `${fmtK(top.amount)}千円 / ${pct(top.amount,result.totalAmount)}` : '', 'navy')}
      </div>

      <div class="fp-grid">
        <div class="fp-card">
          <div class="fp-card-head">
            <div class="fp-card-title">大分類別 売上構成</div>
            <div class="fp-card-sub">クレーン・リサイクル・商品分類を整理</div>
          </div>
          <div class="fp-card-body">
            ${result.bigs.length ? result.bigs.map((x,i)=>`
              <div class="fp-bar-row">
                <div class="fp-bar-name">${i+1}. ${esc(x.big)}<div class="fp-sub">${fmt(x.count)}点 / ${pct(x.amount,result.totalAmount)}</div></div>
                <div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,x.amount/maxBig*100).toFixed(1)}%;background:${COLORS[i%COLORS.length]}"></div></div>
                <div class="fp-val">${fmtK(x.amount)}千円</div>
              </div>`).join('') : `<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>`}
          </div>
        </div>

        <div class="fp-card">
          <div class="fp-card-head">
            <div class="fp-card-title">中分類 上位</div>
            <div class="fp-card-sub">容量帯・作業区分別</div>
          </div>
          <div class="fp-card-body">
            ${result.mids.length ? result.mids.slice(0,12).map((x,i)=>`
              <div class="fp-bar-row">
                <div class="fp-bar-name">${i+1}. ${esc(x.mid || x.big)}<div class="fp-sub">${esc(x.big)} / ${fmt(x.count)}点</div></div>
                <div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,x.amount/maxMid*100).toFixed(1)}%;background:${COLORS[i%COLORS.length]}"></div></div>
                <div class="fp-val">${fmtK(x.amount)}千円</div>
              </div>`).join('') : `<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>`}
          </div>
        </div>
      </div>

      <div class="fp-card">
        <div class="fp-card-head">
          <div class="fp-card-title">商品カテゴリ別詳細</div>
          <div class="fp-card-sub">大分類 → 中分類 → 元表記を開閉できます</div>
        </div>
        <div class="fp-card-body">
          ${result.bigs.length ? result.bigs.map((big,idx)=>{
            const mids = big.mids.sort((a,b)=>b.amount-a.amount || b.count-a.count);
            return `<div class="fp-detail-card ${idx===0?'open':''}">
              <div class="fp-detail-head" onclick="this.parentElement.classList.toggle('open')">
                <div class="fp-plus">＋</div>
                <div class="fp-detail-title">${esc(big.big)}</div>
                <div class="fp-pill">${fmtK(big.amount)}千円</div>
                <div class="fp-pill">${fmt(big.count)}点</div>
              </div>
              <div class="fp-detail-body">
                ${mids.map(mid=>`
                  <div class="fp-detail-card">
                    <div class="fp-detail-head" onclick="this.parentElement.classList.toggle('open')">
                      <div class="fp-plus">＋</div>
                      <div class="fp-detail-title">${esc(mid.mid || mid.big)}</div>
                      <div class="fp-pill">${fmtK(mid.amount)}千円</div>
                      <div class="fp-pill">${fmt(mid.count)}点</div>
                    </div>
                    <div class="fp-detail-body">
                      <table class="fp-mini-table">
                        <thead><tr><th>小分類・元表記</th><th class="r">商品点数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead>
                        <tbody>
                          ${mid.smallList.slice(0,100).map(s=>`<tr><td>${esc(s.label)}</td><td class="r">${fmt(s.count)}</td><td class="r">${fmtK(s.amount)}千円</td><td class="r">${pct(s.amount,result.totalAmount)}</td></tr>`).join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>`).join('')}
              </div>
            </div>`;
          }).join('') : `<div style="padding:24px;text-align:center;color:#8493a8">データなし</div>`}
        </div>
      </div>
    `;

    const yearSel = document.getElementById('fp-product-year-select');
    const monthSel = document.getElementById('fp-product-month-select');
    [yearSel, monthSel].forEach(sel => {
      if (!sel) return;
      sel.onchange = () => {
        const commonYear = document.getElementById('field-common-year-select');
        const commonMonth = document.getElementById('field-common-month-select');
        if (commonYear) commonYear.value = yearSel.value;
        if (commonMonth) commonMonth.value = monthSel.value;
        forceRenderSoon();
      };
    });

    view.dataset.productStableRendered = '1';
  }

  function forceRenderSoon(){
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 50);
    forceUntil = Date.now() + 2500;
  }

  function startActiveLoop(){
    setInterval(() => {
      if (!viewActive()) return;
      const view = document.getElementById('view-field-product');
      if (!view) return;

      const notOurScreen = view.dataset.productStableRendered !== '1'
        || !!view.querySelector('#f-product-tbody')
        || view.textContent.includes('商品カテゴリ別売上') && !view.querySelector('.fp-selector-card');

      if (Date.now() < forceUntil || notOurScreen) render();
    }, 350);
  }

  function hook(){
    const oldNavGo = window.NAV && window.NAV.go;
    if (oldNavGo && !window.__FIELD_PRODUCT_STABLE_NAV_PATCHED_V2__) {
      window.__FIELD_PRODUCT_STABLE_NAV_PATCHED_V2__ = true;
      window.NAV.go = function(el){
        const ret = oldNavGo.apply(this, arguments);
        const viewName = el && el.dataset ? el.dataset.view : '';
        if (viewName === 'field-product') forceRenderSoon();
        return ret;
      };
    }

    // FIELD_CSV_REBUILD.refresh が呼ばれた後にも再描画
    if (window.FIELD_CSV_REBUILD && typeof window.FIELD_CSV_REBUILD.refresh === 'function' && !window.__FIELD_PRODUCT_REFRESH_PATCHED_V2__) {
      window.__FIELD_PRODUCT_REFRESH_PATCHED_V2__ = true;
      const oldRefresh = window.FIELD_CSV_REBUILD.refresh.bind(window.FIELD_CSV_REBUILD);
      window.FIELD_CSV_REBUILD.refresh = function(){
        const ret = oldRefresh.apply(this, arguments);
        forceRenderSoon();
        return ret;
      };
    }

    document.addEventListener('change', e => {
      const id = e.target && e.target.id;
      if (id === 'field-common-month-select' || id === 'field-common-year-select') forceRenderSoon();
    });

    document.addEventListener('click', e => {
      const nav = e.target && e.target.closest ? e.target.closest('.nav-item[data-view="field-product"]') : null;
      if (nav) forceRenderSoon();
    });

    startActiveLoop();
    forceRenderSoon();
    window.addEventListener('load', forceRenderSoon);
  }

  window.FIELD_PRODUCT_UI = window.FIELD_PRODUCT_UI || {};
  window.FIELD_PRODUCT_UI.render = render;
  window.FIELD_PRODUCT_UI.refresh = forceRenderSoon;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

})();
