/* field_product.js : 商品カテゴリ分析（N列作業内容優先・クレーン補正完全版）
   2026-05-02
   方針：
   ・金額系の分類は N列相当の作業内容を最優先
   ・クレーン／ユニック／手吊り／吊り は商品名より優先して「クレーン」
   ・ただし「ユニック含まず」はクレーン扱いしない
   ・幹線料は除外
   ・N列で分類できない場合のみ、I列相当の商品名から冷蔵庫・洗濯機・テレビ等を判定
   ・商品名は【】単位で分解して補助分類
   ・Chart.js に依存せず HTMLバーで表示
*/
'use strict';

(function(){
  if (window.__FIELD_PRODUCT_N_FIRST_CRANE_20260502__) return;
  window.__FIELD_PRODUCT_N_FIRST_CRANE_20260502__ = true;

  const COLORS = ['#1a4d7c','#e05b4d','#198754','#b85c00','#2563eb','#7c3aed','#0891b2','#be185d','#65a30d','#ea580c'];

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function num(v){ return Number(v || 0) || 0; }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function pct(v,total){ return total ? (num(v) / total * 100).toFixed(1) + '%' : '0.0%'; }
  function ymText(ym){
    if (typeof ymLabel === 'function') return ymLabel(ym);
    const s = String(ym || '');
    if (s.length >= 6) return `${s.slice(0,4)}年${Number(s.slice(4,6))}月`;
    return s || '未選択';
  }

  function normalizeText(text){
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‐‑‒–—―ー－]/g, '-')
      .replace(/\s+/g, '')
      .replace(/　+/g, '');
  }

  function rawText(row, keys){
    for (const k of keys) {
      const v = row && row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function getWorkText(row){
    return rawText(row, [
      'workContent','work_content','work','workName','work_name','作業内容','作業名','N列','N',
      'content','itemName','firstWork'
    ]);
  }

  function getProductText(row){
    return rawText(row, [
      'productName','product_name','product','商品名','商品','I列','I','category','productCategory',
      'firstProduct'
    ]);
  }

  function getAmount(row){
    return num(row.amount ?? row.price ?? row.金額 ?? row['金額'] ?? row.Q ?? row['Q列'] ?? row.total ?? row.value);
  }

  function getSlip(row){
    return String(row.slipNo ?? row.slip_no ?? row.invoiceNo ?? row.invoice_no ?? row['原票番号'] ?? row.I ?? row['I列'] ?? row.X ?? row['X列'] ?? '').trim();
  }

  function getBillingType(row){
    const s = rawText(row, ['billingType','billing_type','付帯区分','M列','M','kubun','区分']);
    return normalizeText(s);
  }

  function isKansen(text){
    const t = normalizeText(text);
    return /幹線|中継/.test(t);
  }

  function isCraneWork(workRaw){
    const t = normalizeText(workRaw);
    if (!t) return false;
    if (t.includes('ユニック含まず') || t.includes('ﾕﾆｯｸ含まず')) return false;
    return /クレーン|ｸﾚｰﾝ|クーレン|ユニック|ﾕﾆｯｸ|unic|手吊|吊り|吊/.test(workRaw) ||
           /クレ-ン|ユニック|手吊|吊/.test(t);
  }

  function isRecycleWork(workRaw){
    const t = normalizeText(workRaw);
    return /リサイクル|ﾘｻｲｸﾙ|家電リサイクル|リサイクル料|リサイクル料金/.test(workRaw) || t.includes('リサイクル');
  }

  function isWasteWork(workRaw){
    const t = normalizeText(workRaw);
    return /廃材|廃材処理|廃材引取|廃材引取り|廃材引取料/.test(workRaw) || t.includes('廃材');
  }

  function isSizeDelivery(workRaw){
    const t = normalizeText(workRaw);
    return /サイズ[①②③④⑤⑥⑦1-7]/.test(workRaw) || /サイズ[1-7]/.test(t);
  }

  function sizeMid(workRaw){
    const m = String(workRaw || '').match(/サイズ\s*([①②③④⑤⑥⑦1-7])/);
    if (!m) return 'サイズその他';
    const map = {'①':'①','②':'②','③':'③','④':'④','⑤':'⑤','⑥':'⑥','⑦':'⑦','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦'};
    return `サイズ${map[m[1]] || m[1]}`;
  }

  function extractBracketParts(text){
    const s = String(text || '');
    const parts = [];
    const re = /【([^】]+)】/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] && m[1].trim()) parts.push(m[1].trim());
    }
    if (parts.length) return parts;
    return s.trim() ? [s.trim()] : [];
  }

  function extractRefrigeratorVolume(text){
    const s = String(text || '').normalize('NFKC');
    let m = s.match(/([1-9]\d{2})\s*l/i) || s.match(/([1-9]\d{2})\s*Ｌ/i);
    let v = m ? Number(m[1]) : 0;

    if (!v) {
      // 冷蔵庫文脈で 50, 55 など2桁があれば 500L, 550L とみなす
      const nums = Array.from(s.matchAll(/(?:^|[^0-9])([1-9]\d)(?:[^0-9]|$)/g)).map(x => Number(x[1]));
      const plausible = nums.find(n => n >= 20 && n <= 99);
      if (plausible) v = plausible * 10;
    }

    if (!v) return '容量不明';
    if (v < 300) return '300L未満';
    if (v < 400) return '300〜399L';
    if (v < 500) return '400〜499L';
    if (v < 600) return '500〜599L';
    if (v < 700) return '600〜699L';
    return '700L以上';
  }

  function classifyProductFromText(productRaw){
    const raw = String(productRaw || '');
    const t = normalizeText(raw);

    if (!raw.trim()) return { big:'付帯作業・その他', mid:'未設定', small:'未設定' };

    // 商品名側にもクレーンが書かれているケースは拾う
    if (isCraneWork(raw)) return { big:'クレーン', mid:'クレーン作業', small:raw };

    if (isRecycleWork(raw)) {
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(t)) return { big:'リサイクル', mid:'冷蔵庫', small:raw };
      if (/洗濯|ﾃﾝﾀｸ|センタク|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(t)) return { big:'リサイクル', mid:'洗濯機', small:raw };
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(t)) return { big:'リサイクル', mid:'テレビ', small:raw };
      return { big:'リサイクル', mid:'その他', small:raw };
    }

    if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(raw) || /冷蔵|冷凍/.test(t)) {
      return { big:'冷蔵庫', mid:extractRefrigeratorVolume(raw), small:raw };
    }

    if (/洗濯|センタク|ﾃﾝﾀｸ|ドラム|乾燥/.test(raw) || /洗濯|ドラム|乾燥/.test(t)) {
      return { big:'洗濯機', mid:/ドラム|乾燥/.test(raw) || /ドラム|乾燥/.test(t) ? 'ドラム・乾燥機' : '洗濯機', small:raw };
    }

    if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(raw) || /テレビ|tv|液晶|有機|oled/.test(t)) {
      return { big:'テレビ', mid:'テレビ', small:raw };
    }

    if (/エアコン|空調/.test(raw) || /エアコン|空調/.test(t)) return { big:'エアコン', mid:'エアコン', small:raw };
    if (/レンジ|オーブン/.test(raw) || /レンジ|オーブン/.test(t)) return { big:'レンジ', mid:'レンジ', small:raw };
    if (/炊飯/.test(raw) || /炊飯/.test(t)) return { big:'炊飯器', mid:'炊飯器', small:raw };

    return { big:'付帯作業・その他', mid:'その他', small:raw };
  }

  function classifyByWorkFirst(workRaw, productRaw){
    const work = String(workRaw || '');
    const t = normalizeText(work);

    // ① N列：クレーン最優先
    if (isCraneWork(work)) {
      let mid = 'クレーン作業';
      if (/見積|下見|現調/.test(work)) mid = 'クレーン見積もり';
      else if (/差額/.test(work)) mid = 'クレーン差額';
      else if (/搬入|搬出|入替|入れ|入れ替え/.test(work)) mid = 'クレーン搬入';
      return { big:'クレーン', mid, small:work || productRaw || 'クレーン' };
    }

    // ② N列：リサイクル
    if (isRecycleWork(work)) {
      if (/冷蔵|ﾚｲｿﾞｳ|冷凍/.test(work) || /冷蔵|冷凍/.test(t)) return { big:'リサイクル', mid:'冷蔵庫', small:work };
      if (/洗濯|センタク|ドラム|乾燥/.test(work) || /洗濯|ドラム|乾燥/.test(t)) return { big:'リサイクル', mid:'洗濯機', small:work };
      if (/テレビ|TV|ＴＶ|液晶|有機|OLED/i.test(work) || /テレビ|tv|液晶|有機|oled/.test(t)) return { big:'リサイクル', mid:'テレビ', small:work };
      return { big:'リサイクル', mid:'その他', small:work };
    }

    // ③ N列：廃材
    if (isWasteWork(work)) return { big:'廃材', mid:'廃材', small:work };

    // ④ N列：サイズ配送料
    if (isSizeDelivery(work)) return { big:'配送', mid:sizeMid(work), small:work };

    // ⑤ N列：作業系
    if (/階段|段上げ/.test(work) || /階段|段上げ/.test(t)) return { big:'作業', mid:'階段上げ', small:work };
    if (/見積|下見|現調/.test(work) || /見積|下見|現調/.test(t)) return { big:'作業', mid:'見積もり', small:work };
    if (/設置|取付|取付け|搬入|搬出|入替|入れ替え/.test(work) || /設置|取付|搬入|搬出|入替|入れ替え/.test(t)) return { big:'作業', mid:'設置・搬入', small:work };

    // ⑥ I列：商品名から分類
    return classifyProductFromText(productRaw);
  }

  function addAgg(map, cls, count, amount, slip){
    const key = `${cls.big}||${cls.mid}`;
    if (!map.has(key)) {
      map.set(key, { big:cls.big, mid:cls.mid, count:0, amount:0, slips:new Set(), small:new Map() });
    }
    const item = map.get(key);
    item.count += count;
    item.amount += amount;
    if (slip) item.slips.add(slip);

    const smallKey = cls.small || cls.mid || cls.big;
    if (!item.small.has(smallKey)) item.small.set(smallKey, { label:smallKey, count:0, amount:0 });
    const sm = item.small.get(smallKey);
    sm.count += count;
    sm.amount += amount;
  }

  function sourceRows(){
    const s = window.STATE || {};
    const ym = selectedYM();

    const candidates = [];
    if (Array.isArray(s.productAddressData)) candidates.push(...s.productAddressData.filter(x=>!ym || x.ym===ym));
    if (Array.isArray(s.workerCsvData)) candidates.push(...s.workerCsvData.filter(x=>!ym || x.ym===ym));
    if (Array.isArray(s.fieldCsvData)) candidates.push(...s.fieldCsvData.filter(x=>!ym || x.ym===ym));
    if (Array.isArray(s.fieldData)) candidates.push(...s.fieldData.filter(x=>!ym || x.ym===ym));

    const rows = [];

    candidates.forEach(rec => {
      if (!rec) return;
      if (Array.isArray(rec.rows)) rows.push(...rec.rows);
      if (Array.isArray(rec.data)) rows.push(...rec.data);
      if (Array.isArray(rec.items)) rows.push(...rec.items);
      if (rec.rawRows && Array.isArray(rec.rawRows)) rows.push(...rec.rawRows);

      // productAddressData の集計済み rows がない場合の保険
      if (rec.products && typeof rec.products === 'object') {
        Object.values(rec.products).forEach(v => {
          if (Array.isArray(v)) rows.push(...v);
          else if (v && typeof v === 'object') rows.push(v);
        });
      }
    });

    // 重複しすぎる場合の最低限の重複除外
    const seen = new Set();
    return rows.filter((r,idx)=>{
      const key = [
        getSlip(r) || idx,
        getWorkText(r),
        getProductText(r),
        getAmount(r),
        getBillingType(r)
      ].join('||');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function selectedYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel && sel.value) return sel.value;
    const s = window.STATE || {};
    return s.selYM || safeArray(s.productAddressData).at(-1)?.ym || safeArray(s.workerCsvData).at(-1)?.ym || '';
  }

  function aggregate(){
    const rows = sourceRows();
    const map = new Map();
    let totalAmount = 0;
    let totalCount = 0;
    const slipSet = new Set();
    let excludedAmount = 0;

    rows.forEach(row => {
      const work = getWorkText(row);
      const product = getProductText(row);
      const amount = getAmount(row);
      const slip = getSlip(row);

      if (isKansen(work)) {
        excludedAmount += amount;
        return;
      }

      const cls = classifyByWorkFirst(work, product);
      totalAmount += amount;
      totalCount += 1;
      if (slip) slipSet.add(slip);

      addAgg(map, cls, 1, amount, slip);
    });

    const list = Array.from(map.values()).map(x => ({
      ...x,
      slipCount: x.slips.size || x.count,
      smallList: Array.from(x.small.values()).sort((a,b)=>b.amount-a.amount || b.count-a.count)
    })).sort((a,b)=>b.amount-a.amount || b.count-a.count);

    const bigMap = new Map();
    list.forEach(x=>{
      if (!bigMap.has(x.big)) bigMap.set(x.big, { big:x.big, amount:0, count:0, mids:[] });
      const b = bigMap.get(x.big);
      b.amount += x.amount;
      b.count += x.count;
      b.mids.push(x);
    });
    const bigList = Array.from(bigMap.values()).sort((a,b)=>b.amount-a.amount || b.count-a.count);

    return { rows, list, bigList, totalAmount, totalCount, slipCount:slipSet.size || totalCount, excludedAmount, ym:selectedYM() };
  }

  function ensureStyles(){
    if (document.getElementById('field-product-nfirst-style')) return;
    const st = document.createElement('style');
    st.id = 'field-product-nfirst-style';
    st.textContent = `
      .fp-note{font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.7}
      .fp-kpi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
      .fp-kpi .kpi-card{min-height:94px}
      .fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      .fp-bar-row{display:grid;grid-template-columns:minmax(120px,220px) 1fr minmax(120px,150px);gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid #eef2f7}
      .fp-bar-name{font-weight:900;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fp-track{height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden}
      .fp-fill{height:100%;border-radius:999px;background:#1a4d7c}
      .fp-val{text-align:right;font-weight:900;color:#0f172a;white-space:nowrap}
      .fp-sub{font-size:12px;color:#64748b;font-weight:700}
      .fp-detail-card{border:1px solid #dbe3ee;border-radius:14px;margin:10px 0;background:#fff;overflow:hidden}
      .fp-detail-head{display:grid;grid-template-columns:30px 1fr auto auto;gap:10px;align-items:center;padding:12px 14px;background:#f8fafc;cursor:pointer}
      .fp-detail-head:hover{background:#f1f5f9}
      .fp-plus{font-weight:900;color:#1a4d7c;font-size:18px}
      .fp-detail-title{font-size:15px;font-weight:900;color:#0f172a}
      .fp-pill{display:inline-flex;align-items:center;border:1px solid #dbe3ee;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;background:#fff;color:#334155}
      .fp-detail-body{display:none;padding:12px 18px 16px}
      .fp-detail-card.open .fp-detail-body{display:block}
      .fp-detail-card.open .fp-plus{transform:rotate(45deg)}
      .fp-mini-table{width:100%;border-collapse:collapse;font-size:12px}
      .fp-mini-table th{background:#f3f6fb;color:#334155;text-align:left;padding:8px}
      .fp-mini-table td{border-bottom:1px solid #e5e7eb;padding:8px}
      .fp-mini-table .r{text-align:right}
      @media(max-width:1200px){.fp-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}.fp-grid{grid-template-columns:1fr}.fp-bar-row{grid-template-columns:1fr}.fp-val{text-align:left}}
    `;
    document.head.appendChild(st);
  }

  function kpiCard(label, value, sub, accent='navy'){
    return `<div class="kpi-card accent-${accent}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${sub?`<div class="kpi-sub">${esc(sub)}</div>`:''}</div>`;
  }

  function renderKpi(result){
    const area = document.getElementById('f-product-kpi') || createBeforeFirstCard('f-product-kpi','fp-kpi');
    const top = result.bigList[0];
    const avg = result.slipCount ? result.totalAmount / result.slipCount : 0;
    area.innerHTML = [
      kpiCard('対象月', ymText(result.ym), '商品カテゴリ分析'),
      kpiCard('商品売上', `${fmtK(result.totalAmount)}千円`, '幹線料除外後', 'green'),
      kpiCard('原票数', fmt(result.slipCount), '原票番号ユニーク'),
      kpiCard('平均単価', `${fmt(avg)}円`, '売上 ÷ 原票数', 'amber'),
      kpiCard('最大カテゴリ', top ? top.big : '—', top ? `${fmtK(top.amount)}千円 / ${pct(top.amount,result.totalAmount)}` : '', 'navy')
    ].join('');
  }

  function createBeforeFirstCard(id, cls){
    const view = document.getElementById('view-field-product');
    const el = document.createElement('div');
    el.id = id;
    el.className = cls;
    if (view) {
      const firstCard = view.querySelector('.card');
      view.insertBefore(el, firstCard || view.firstChild);
    }
    return el;
  }

  function renderBars(result){
    const card1 = document.querySelector('#view-field-product .card:nth-of-type(1) .card-body') || document.querySelector('#view-field-product .card .card-body');
    if (!card1) return;
    const max = Math.max(...result.bigList.map(x=>x.amount),1);
    card1.innerHTML = `<div class="fp-grid" style="grid-template-columns:1fr">
      <div>
        <div class="card-title" style="margin-bottom:8px">大分類別 売上構成</div>
        ${result.bigList.map((x,i)=>`
          <div class="fp-bar-row">
            <div class="fp-bar-name">${i+1}. ${esc(x.big)}<div class="fp-sub">${fmt(x.count)}点 / ${pct(x.amount,result.totalAmount)}</div></div>
            <div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,x.amount/max*100).toFixed(1)}%;background:${COLORS[i%COLORS.length]}"></div></div>
            <div class="fp-val">${fmtK(x.amount)}千円</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function renderDetail(result){
    const tbody = document.getElementById('f-product-tbody');
    const table = tbody ? tbody.closest('table') : null;
    if (!tbody || !table) return;
    const thead = table.querySelector('thead tr');
    if (thead) thead.innerHTML = `<th>分類</th><th class="r">商品点数</th><th class="r">売上（千円）</th><th class="r">構成比</th>`;
    tbody.innerHTML = result.bigList.map((big,idx)=>{
      const mids = big.mids.sort((a,b)=>b.amount-a.amount || b.count-a.count);
      const body = mids.map(mid=>`
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
              <tbody>${mid.smallList.slice(0,80).map(s=>`<tr><td>${esc(s.label)}</td><td class="r">${fmt(s.count)}</td><td class="r">${fmtK(s.amount)}千円</td><td class="r">${pct(s.amount,result.totalAmount)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`).join('');

      return `<tr><td colspan="4" style="padding:0;border:0">
        <div class="fp-detail-card ${idx===0?'open':''}">
          <div class="fp-detail-head" onclick="this.parentElement.classList.toggle('open')">
            <div class="fp-plus">＋</div>
            <div class="fp-detail-title">${esc(big.big)}</div>
            <div class="fp-pill">${fmtK(big.amount)}千円</div>
            <div class="fp-pill">${fmt(big.count)}点</div>
          </div>
          <div class="fp-detail-body">${body}</div>
        </div>
      </td></tr>`;
    }).join('');
  }

  function render(){
    ensureStyles();
    const result = aggregate();

    const view = document.getElementById('view-field-product');
    if (!view) return;

    let note = document.getElementById('field-product-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'field-product-note';
      note.className = 'fp-note';
      const first = view.querySelector('.card');
      view.insertBefore(note, first || view.firstChild);
    }
    note.textContent = '商品カテゴリは、N列の作業内容を優先して分類し、分類できない場合のみ商品名で補完しています。クレーン・ユニック・手吊り系は最優先でクレーンに集約します。';

    renderKpi(result);
    renderBars(result);
    renderDetail(result);
  }

  function hook(){
    const old = window.FIELD_PRODUCT_UI && window.FIELD_PRODUCT_UI.render;
    window.FIELD_PRODUCT_UI = window.FIELD_PRODUCT_UI || {};
    window.FIELD_PRODUCT_UI.render = render;
    window.FIELD_PRODUCT_UI.refresh = render;

    const oldNavGo = window.NAV && window.NAV.go;
    if (oldNavGo && !window.__FIELD_PRODUCT_NAV_HOOKED_20260502__) {
      window.__FIELD_PRODUCT_NAV_HOOKED_20260502__ = true;
      window.NAV.go = function(el){
        const ret = oldNavGo.apply(this, arguments);
        setTimeout(()=>{
          const active = document.querySelector('.view.active');
          if (active && active.id === 'view-field-product') render();
        }, 80);
        return ret;
      };
    }

    document.addEventListener('change', e => {
      if (e.target && (e.target.id === 'field-common-month-select' || e.target.id === 'field-common-year-select')) {
        setTimeout(()=>{
          const active = document.querySelector('.view.active');
          if (active && active.id === 'view-field-product') render();
        }, 80);
      }
    });

    setTimeout(()=>{
      const active = document.querySelector('.view.active');
      if (active && active.id === 'view-field-product') render();
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

})();
