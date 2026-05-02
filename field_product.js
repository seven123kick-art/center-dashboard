/* field_product.js : 商品カテゴリ分析 完全版（一般分類＋【】単位分解＋冷蔵庫容量補正版）
   2026-05-02
   ・Chart.jsに依存しないHTMLバー表示
   ・商品名は 【商品名】 単位で一度分解してから分類
   ・一般的な商品カテゴリへ戻し、冷蔵庫/洗濯機/テレビ等を主軸に整理
   ・冷蔵庫は容量帯で中分類。2桁数字は末尾に0を補って容量扱い（例：50 → 500L）
   ・リサイクル文字を含むものは大分類「リサイクル」、中分類は冷蔵庫/洗濯機/テレビ等で判定
   ・複数商品が1原票に入る場合は、売上を商品点数で按分して合計売上を崩さない
   ・商品名が空欄の場合は、作業内容（N列想定／保存済みworkDetails等）から分類を補完
   ・表示対象（年度/月）セレクターを商品カテゴリ分析にも必ず表示
*/
'use strict';
(function(){
  if (window.__FIELD_PRODUCT_BRACKET_SELECTOR_20260502__) return;
  window.__FIELD_PRODUCT_BRACKET_SELECTOR_20260502__ = true;

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function num(v){ return Number(v || 0) || 0; }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function fmt1(v){ return (Math.round(num(v) * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits:1, maximumFractionDigits:1 }); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }
  function clean(v){ return String(v ?? '').replace(/[\u0000-\u001f]/g,'').trim(); }
  function compact(v){ return clean(v).replace(/[\s　]/g,''); }
  function toHalf(v){
    // NFKCで全角英数・半角カナをまとめて正規化する。
    // 例：ﾚｲｿﾞｳｺ → レイゾウコ、Ｌ → L、５００ → 500
    return String(v ?? '')
      .normalize('NFKC')
      .replace(/～/g,'〜')
      .replace(/－/g,'-')
      .replace(/―/g,'-');
  }

  function selectedYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel && sel.value) return sel.value;
    return (window.STATE && STATE.selYM) || safeArray(STATE?.productAddressData).at(-1)?.ym || '';
  }
  function productRecord(ym){ return safeArray(STATE?.productAddressData).find(d => d && d.ym === ym) || null; }

  function ensureSelector(){
    if (typeof window.setupFieldCommonSelectors === 'function') {
      try { window.setupFieldCommonSelectors(); } catch(e){ console.warn('[field_product] selector setup failed', e); }
    }
  }

  function extractBracketUnits(rawProduct){
    const raw = clean(rawProduct);
    if (!raw) return ['未設定'];
    const units = [];
    const re = /【([^】]+)】/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const item = clean(m[1]);
      if (item) units.push(item);
    }
    return units.length ? units : [raw];
  }

  function extractFridgeVolume(text){
    const s = toHalf(compact(text));
    const candidates = [];

    // 500L / 500Ｌ / 500リットル / 500〜599L のような容量表記を優先
    for (const m of s.matchAll(/(\d{2,4})\s*(?:L|Ｌ|リットル|ﾘｯﾄﾙ)/gi)) {
      let n = Number(m[1]);
      if (n >= 10 && n <= 99) n = n * 10; // 50Lのように登録されているケースは500L扱い
      if (n >= 80 && n <= 900) candidates.push(n);
    }

    // 500〜599 / 500-599 のような範囲表記
    for (const m of s.matchAll(/(\d{2,4})\s*[〜~\-ー]\s*(\d{2,4})/g)) {
      let n1 = Number(m[1]);
      let n2 = Number(m[2]);
      if (n1 >= 10 && n1 <= 99) n1 *= 10;
      if (n2 >= 10 && n2 <= 99) n2 *= 10;
      if (n1 >= 80 && n1 <= 900) candidates.push(n1);
      if (n2 >= 80 && n2 <= 900) candidates.push(n2);
    }

    // 型番や商品名に 50 / 55 のような2桁、500 のような3桁がある場合。
    // 冷蔵庫判定後だけ使うため、2桁は容量として×10する。
    for (const m of s.matchAll(/(\d{2,4})/g)) {
      let n = Number(m[1]);
      if (!Number.isFinite(n)) continue;
      if (n >= 10 && n <= 99) n = n * 10;
      if (n >= 80 && n <= 900) candidates.push(n);
    }

    if (!candidates.length) return 0;
    // 型番に複数数字がある場合は、一番大きい容量候補を採用
    return Math.max(...candidates);
  }

  function volumeBand(text){
    const v = extractFridgeVolume(text);
    if (v >= 600) return '600L以上';
    if (v >= 500) return '500〜599L';
    if (v >= 400) return '400〜499L';
    if (v >= 300) return '300〜399L';
    if (v >= 200) return '200〜299L';
    if (v >= 100) return '100〜199L';
    return '容量不明';
  }

  function classifyProductUnit(unit){
    const raw = clean(unit) || '未設定';
    const s = toHalf(compact(raw));

    function containsAny(re){ return re.test(s); }
    function detectItemMiddle(){
      if (containsAny(/冷蔵|冷凍|レイゾウコ|ﾚｲｿﾞｳｺ|フリーザ|冷凍庫/)) return '冷蔵庫';
      if (containsAny(/洗濯|ドラム|乾燥|センタク|ｾﾝﾀｸ/)) return '洗濯機';
      if (containsAny(/テレビ|TV|ＴＶ|液晶|有機|有機EL|有機ＥＬ/)) return 'テレビ';
      if (containsAny(/エアコン|空調/)) return 'エアコン';
      if (containsAny(/レンジ|オーブン|電子レンジ/)) return 'レンジ';
      if (containsAny(/炊飯/)) return '炊飯器';
      return 'その他';
    }

    // リサイクルの文字が入るものは商品ではなくリサイクル扱い。
    // 中分類は後続の冷蔵庫・洗濯機・テレビなどで一般的に分類する。
    if (containsAny(/リサイクル|ﾘｻｲｸﾙ|Recycle/i)) {
      const middle = detectItemMiddle();
      return { major:'リサイクル', middle, minor:raw, order:300 };
    }

    // 作業系は商品カテゴリとは分ける
    if (containsAny(/下見|見積|見積もり|見積り|下検|現調/)) {
      return { major:'作業', middle:'見積もり', minor:raw, order:410 };
    }
    if (containsAny(/階段|段上|段上げ/)) {
      return { major:'作業', middle:'階段上げ', minor:raw, order:420 };
    }
    if (containsAny(/クレーン|クーレン|ユニック|UNIC|吊|吊り|吊上|吊上げ/i)) {
      return { major:'クレーン', middle:'クレーン', minor:raw, order:430 };
    }

    if (!raw || raw === '未設定' || containsAny(/未設定|不明/)) {
      return { major:'付帯作業・その他', middle:'未設定', minor:raw || '未設定', order:900 };
    }

    // 一般的な商品カテゴリ
    if (containsAny(/冷蔵|冷凍|レイゾウコ|ﾚｲｿﾞｳｺ|フリーザ|冷凍庫/)) {
      const band = volumeBand(s);
      const orderMap = { '600L以上':10, '500〜599L':11, '400〜499L':12, '300〜399L':13, '200〜299L':14, '100〜199L':15, '容量不明':19 };
      return { major:'冷蔵庫', middle:band, minor:raw, order:orderMap[band] ?? 19 };
    }
    if (containsAny(/洗濯|ドラム|乾燥|センタク|ｾﾝﾀｸ/)) {
      if (containsAny(/ドラム/)) return { major:'洗濯機', middle:'ドラム式', minor:raw, order:20 };
      if (containsAny(/乾燥/)) return { major:'洗濯機', middle:'乾燥機', minor:raw, order:21 };
      return { major:'洗濯機', middle:'全自動・縦型', minor:raw, order:22 };
    }
    if (containsAny(/テレビ|TV|ＴＶ|液晶|有機|有機EL|有機ＥＬ/)) {
      if (containsAny(/有機|有機EL|有機ＥＬ/)) return { major:'テレビ', middle:'有機EL・液晶', minor:raw, order:30 };
      if (containsAny(/液晶/)) return { major:'テレビ', middle:'有機EL・液晶', minor:raw, order:30 };
      return { major:'テレビ', middle:'テレビ', minor:raw, order:31 };
    }
    if (containsAny(/エアコン|空調/)) return { major:'エアコン', middle:'エアコン', minor:raw, order:40 };
    if (containsAny(/レンジ|オーブン|電子レンジ/)) return { major:'レンジ', middle:'レンジ', minor:raw, order:50 };
    if (containsAny(/炊飯/)) return { major:'炊飯器', middle:'炊飯器', minor:raw, order:60 };
    if (containsAny(/照明|シーリング/)) return { major:'照明', middle:'照明', minor:raw, order:70 };

    return { major:'付帯作業・その他', middle:'その他', minor:raw, order:800 };
  }

  function blankNode(label){ return { label, count:0, amount:0, order:999, children:new Map() }; }
  function addMap(map, label, amount, count, order){
    if (!map.has(label)) map.set(label, blankNode(label));
    const item = map.get(label);
    item.count += num(count || 1);
    item.amount += num(amount);
    item.order = Math.min(item.order ?? 999, order ?? 999);
    return item;
  }
  function sortRows(a,b){ return b.amount - a.amount || b.count - a.count || (a.order ?? 999) - (b.order ?? 999) || String(a.label).localeCompare(String(b.label),'ja'); }
  function pct(v,total){ return total > 0 ? num(v) / total * 100 : 0; }

  function fallbackWorkTexts(t){
    const texts = [];

    // 商品・住所CSVの保存形はバージョンにより差があるため、複数候補を順に拾う。
    // ユーザー指定：商品名が空欄の場合はN列の作業内容から補完。
    // ただし現行保存データでは workDetails / works / firstRow に入っているケースがあるため、ここで吸収する。
    safeArray(t?.workDetails).forEach(d => {
      const w = clean(d?.work || d?.label || d?.name);
      if (w) texts.push(w);
    });
    Object.keys(t?.works || {}).forEach(w => {
      const x = clean(w);
      if (x) texts.push(x);
    });

    // N列=0始まり13番目、R列=0始まり17番目も保険で見る。
    const row = safeArray(t?.firstRow || t?.representativeRow || []);
    [13, 17].forEach(idx => {
      const x = clean(row[idx]);
      if (x) texts.push(x);
    });

    return Array.from(new Set(texts.filter(Boolean)));
  }

  function productSourceUnits(t){
    const product = clean(t?.product);

    // ① 商品名がある場合は【】単位で最優先分類
    if (product) return extractBracketUnits(product);

    // ② 商品名が空欄の場合は、作業内容から補完
    const workTexts = fallbackWorkTexts(t);
    if (workTexts.length) return workTexts.flatMap(x => extractBracketUnits(x));

    // ③ 最後の保険。既存カテゴリは商品名空欄由来の可能性があるため、分類不能なら未設定に寄せる。
    const fallback = clean(t?.category || t?.sizeBucket);
    return fallback ? [fallback] : ['未設定'];
  }

  function buildRows(rec){
    const majorMap = new Map();
    safeArray(rec?.tickets).forEach(t => {
      const units = productSourceUnits(t);
      const baseAmount = num(t.amount);
      const splitAmount = units.length > 0 ? baseAmount / units.length : baseAmount;
      units.forEach(unit => {
        const c = classifyProductUnit(unit);
        const major = addMap(majorMap, c.major, splitAmount, 1, c.order);
        const middle = addMap(major.children, c.middle, splitAmount, 1, c.order);
        addMap(middle.children, c.minor, splitAmount, 1, c.order);
      });
    });
    return [...majorMap.values()].sort(sortRows);
  }

  function ensureStyles(){
    if (document.getElementById('field-product-bracket-style-20260502')) return;
    const st = document.createElement('style');
    st.id = 'field-product-bracket-style-20260502';
    st.textContent = `
      .fp-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
      .fp-kpi{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);border-top:5px solid #1a4d7c;padding:16px;min-height:104px;overflow:hidden}
      .fp-kpi.green{border-top-color:#059669}.fp-kpi.amber{border-top-color:#f97316}
      .fp-kpi-label{font-size:12px;font-weight:900;color:#334155;margin-bottom:8px}
      .fp-kpi-value{font-size:28px;font-weight:900;color:#0f172a;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fp-kpi-sub{font-size:12px;color:#8291a7;font-weight:800;margin-top:8px;line-height:1.45}
      .fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      .fp-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
      .fp-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:10px;align-items:center}
      .fp-title{font-size:15px;font-weight:900;color:#18324f}.fp-sub{font-size:12px;color:#8291a7;font-weight:800;margin-top:3px}
      .fp-body{padding:14px 16px}.fp-note{font-size:12px;color:#64748b;line-height:1.7;margin:0 0 12px 2px}
      .fp-bar-row{display:grid;grid-template-columns:30px minmax(120px,210px) minmax(160px,1fr) minmax(120px,160px);gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #edf2f7}
      .fp-rank{width:24px;height:24px;border-radius:999px;background:#e8f1fb;color:#1a4d7c;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:12px}
      .fp-name{font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fp-track{height:13px;background:#e5e7eb;border-radius:999px;overflow:hidden}.fp-fill{height:100%;background:#1a4d7c;border-radius:999px}
      .fp-val{text-align:right;font-size:12px;font-weight:900}.fp-val span{display:block;color:#8291a7;font-size:11px;margin-top:2px}
      .fp-detail details{border:1px solid var(--border);border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}.fp-detail summary{cursor:pointer;list-style:none;padding:13px 16px;background:#f8fafc;display:flex;justify-content:space-between;gap:12px;align-items:center;font-weight:900}.fp-detail summary::-webkit-details-marker{display:none}
      .fp-pill{display:inline-flex;border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;color:#334155;margin-left:4px}.fp-detail-body{padding:12px 16px}
      .fp-table{width:100%;border-collapse:collapse}.fp-table th,.fp-table td{border-bottom:1px solid #edf2f7;padding:8px;font-size:13px}.fp-table th{background:#f3f6fb;text-align:left;font-weight:900}.fp-table .r{text-align:right}
      @media(max-width:1200px){.fp-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fp-grid{grid-template-columns:1fr}.fp-bar-row{grid-template-columns:30px minmax(100px,160px) minmax(120px,1fr) minmax(90px,120px)}}`;
    document.head.appendChild(st);
  }

  function bars(rows,total,limit){
    const list = rows.slice(0, limit || rows.length);
    if (!list.length) return '<div style="padding:40px;text-align:center;color:var(--text3);font-weight:800">データなし</div>';
    const max = Math.max(...list.map(r=>r.amount), 1);
    return list.map((r,i)=>`<div class="fp-bar-row"><div class="fp-rank">${i+1}</div><div class="fp-name" title="${esc(r.label)}">${esc(r.label)}</div><div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,r.amount/max*100).toFixed(1)}%"></div></div><div class="fp-val">${fmtK(r.amount)}千円<span>${fmt(r.count)}点 / ${fmt1(pct(r.amount,total))}%</span></div></div>`).join('');
  }

  function render(){
    ensureSelector();
    ensureStyles();
    const pane = document.getElementById('fpane-product');
    if (!pane) return;
    const ym = selectedYM();
    const rec = productRecord(ym);
    if (!rec || !safeArray(rec.tickets).length) {
      pane.innerHTML = `<div class="fp-note">商品・住所CSVを読み込むと、商品カテゴリ分析を表示します。</div><div class="fp-card"><div class="fp-body" style="padding:44px;text-align:center;color:var(--text3);font-weight:800">選択月の商品カテゴリデータがありません。</div></div>`;
      return;
    }
    const majors = buildRows(rec);
    const totalAmount = majors.reduce((s,r)=>s+r.amount,0);
    const totalCount = majors.reduce((s,r)=>s+r.count,0);
    const top = majors[0] || blankNode('-');
    const avg = totalCount ? totalAmount / totalCount : 0;
    const mids = majors.flatMap(m => [...m.children.values()].map(x => ({...x, major:m.label}))).sort(sortRows);
    pane.innerHTML = `<div class="fp-note">商品名は【】単位で分解し、一般的な商品分類（冷蔵庫・洗濯機・テレビ等）を基本に、大分類 → 中分類 → 小分類で整理しています。冷蔵庫は2桁数字も容量として補正して分類します。</div>
      <div class="fp-kpi-grid">
        <div class="fp-kpi"><div class="fp-kpi-label">対象月</div><div class="fp-kpi-value">${esc(ymText(ym))}</div><div class="fp-kpi-sub">商品カテゴリ分析</div></div>
        <div class="fp-kpi green"><div class="fp-kpi-label">商品売上</div><div class="fp-kpi-value">${fmtK(totalAmount)}千円</div><div class="fp-kpi-sub">商品・住所CSV 原票ベース</div></div>
        <div class="fp-kpi"><div class="fp-kpi-label">商品点数</div><div class="fp-kpi-value">${fmt(totalCount)}</div><div class="fp-kpi-sub">【】分解後の点数</div></div>
        <div class="fp-kpi amber"><div class="fp-kpi-label">平均単価</div><div class="fp-kpi-value">${fmt(avg)}円</div><div class="fp-kpi-sub">商品売上 ÷ 商品点数</div></div>
        <div class="fp-kpi"><div class="fp-kpi-label">最大カテゴリ</div><div class="fp-kpi-value">${esc(top.label)}</div><div class="fp-kpi-sub">${fmtK(top.amount)}千円 / ${fmt1(pct(top.amount,totalAmount))}%</div></div>
      </div>
      <div class="fp-grid">
        <div class="fp-card"><div class="fp-head"><div><div class="fp-title">大分類別 売上構成</div><div class="fp-sub">冷蔵庫・洗濯機・テレビなど</div></div></div><div class="fp-body">${bars(majors,totalAmount)}</div></div>
        <div class="fp-card"><div class="fp-head"><div><div class="fp-title">中分類 上位</div><div class="fp-sub">冷蔵庫容量帯・商品種別</div></div></div><div class="fp-body">${bars(mids,totalAmount,12)}</div></div>
      </div>
      <div class="fp-card fp-detail"><div class="fp-head"><div><div class="fp-title">商品カテゴリ別 詳細</div><div class="fp-sub">クリックで中分類・小分類を確認</div></div><span class="fp-pill">上位：${esc(top.label)} ${fmtK(top.amount)}千円</span></div><div class="fp-body">
      ${majors.map((m,idx)=>{ const children=[...m.children.values()].sort(sortRows); return `<details ${idx<3?'open':''}><summary><span>＋ ${esc(m.label)} <span class="fp-pill">${fmtK(m.amount)}千円</span> <span class="fp-pill">${fmt(m.count)}点</span></span><span>${fmt1(pct(m.amount,totalAmount))}%</span></summary><div class="fp-detail-body">${children.map(mid=>{ const minors=[...mid.children.values()].sort(sortRows).slice(0,30); return `<details style="margin-bottom:8px" ${children.length<=4?'open':''}><summary><span>${esc(mid.label)} <span class="fp-pill">${fmtK(mid.amount)}千円</span> <span class="fp-pill">${fmt(mid.count)}点</span></span><span>${fmt1(pct(mid.amount,totalAmount))}%</span></summary><div class="fp-detail-body"><table class="fp-table"><thead><tr><th>小分類・元表記</th><th class="r">商品点数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead><tbody>${minors.map(mi=>`<tr><td>${esc(mi.label)}</td><td class="r">${fmt(mi.count)}</td><td class="r">${fmtK(mi.amount)}千円</td><td class="r">${fmt1(pct(mi.amount,totalAmount))}%</td></tr>`).join('')}</tbody></table></div></details>`; }).join('')}</div></details>`; }).join('')}</div></div>`;
  }

  function renderSoon(){ clearTimeout(window.__fieldProductBracketTimer); window.__fieldProductBracketTimer = setTimeout(()=>{ try { render(); } catch(e){ console.error('[field_product]', e); } }, 80); }
  window.FIELD_PRODUCT_UI = { render, renderSoon };
  if (window.FIELD_CSV_REBUILD) FIELD_CSV_REBUILD.renderProduct = render;
  if (window.NAV && typeof NAV.go === 'function' && !NAV.__fieldProductBracketWrapped20260502) {
    const oldGo = NAV.go.bind(NAV);
    NAV.go = function(el){ const r = oldGo(el); renderSoon(); return r; };
    NAV.__fieldProductBracketWrapped20260502 = true;
  }
  document.addEventListener('change', (e)=>{ if (e.target && (e.target.id === 'field-common-month-select' || e.target.id === 'field-common-fy-select')) renderSoon(); }, true);
  document.addEventListener('DOMContentLoaded', renderSoon);
  setTimeout(renderSoon, 300);
  setTimeout(renderSoon, 900);
})();
