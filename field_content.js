/* field_content.js : 作業内容分析ビュー 完全版（大分類・中分類・小分類＋HTMLバー表示）
   2026-05-02
   ・Chart.jsに依存しないため、グラフが空になる問題を回避
   ・商品・住所CSVの workDetails / works を使用
   ・大分類 → 中分類 → 小分類をトグルで確認
   ・既存HTMLの #fpane-content を安全に再描画
*/
'use strict';
(function(){
  if (window.__FIELD_CONTENT_COMPLETE_20260502__) return;
  window.__FIELD_CONTENT_COMPLETE_20260502__ = true;

  const SIZE_ORDER = ['サイズ①','サイズ②','サイズ③','サイズ④','サイズ⑤','サイズ⑥','サイズ⑦'];

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function num(v){ return Number(v || 0) || 0; }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function fmt1(v){ return (Math.round(num(v) * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits:1, maximumFractionDigits:1 }); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }

  function selectedYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel && sel.value) return sel.value;
    const yms = window.FIELD_DATA_ACCESS?.getAllYms ? FIELD_DATA_ACCESS.getAllYms() : [...new Set([...safeArray(STATE?.productAddressData).map(d=>d.ym), ...safeArray(STATE?.workerCsvData).map(d=>d.ym)])].filter(Boolean).sort();
    return (window.STATE && STATE.selYM && yms.includes(STATE.selYM)) ? STATE.selYM : (yms.at(-1) || '');
  }
  function productRecord(ym){
    const records = window.FIELD_DATA_ACCESS?.getProductRecords ? FIELD_DATA_ACCESS.getProductRecords() : safeArray(STATE?.productAddressData);
    return records.find(d => d && d.ym === ym) || null;
  }

  function clean(v){ return String(v ?? '').replace(/[\u0000-\u001f]/g,'').trim(); }
  function compact(v){ return clean(v).replace(/[\s　]/g,''); }
  function amountOf(v){ return num(v); }
  function normalizeText(v){ return String(v ?? '').normalize('NFKC').replace(/[\s　]/g,'').toLowerCase(); }
  function isKansen(t){ const s = normalizeText(t); return s.includes('幹線') || s.includes('中継'); }
  function isCrane(t){
    const raw = String(t || '');
    const s = normalizeText(raw);
    if (!raw.trim()) return false;
    if (s.includes('ユニック含まず') || s.includes('unic含まず')) return false;
    return /クレーン|ｸﾚｰﾝ|クレ－ン|クレ-ン|クーレン|ユニック|ﾕﾆｯｸ|UNIC|手吊り|手吊|吊り/i.test(raw)
      || /クレ-ン|クーレン|ユニック|unic|手吊|吊/i.test(s);
  }
  function isRecycle(t){ const raw=String(t||''); const s=normalizeText(raw); return /リサイクル|ﾘｻｲｸﾙ|家電リサイクル|リサイクル料/i.test(raw) || s.includes('リサイクル'); }
  function isWaste(t){ const raw=String(t||''); const s=normalizeText(raw); return /廃材|廃材処理|廃材引取|廃材引取り/i.test(raw) || s.includes('廃材'); }
  function isEstimate(t){ const s=normalizeText(t); return s.includes('見積') || s.includes('下見') || s.includes('現調'); }
  function isInstall(t){ const s=normalizeText(t); return s.includes('設置') || s.includes('取付') || s.includes('搬入') || s.includes('搬出') || s.includes('入替') || s.includes('入れ替え'); }

  function sizeName(text){
    const s = compact(text);
    const m = s.match(/サイズ([①②③④⑤⑥⑦1-7])/);
    if (!m) return '';
    const map = { '①':'①','②':'②','③':'③','④':'④','⑤':'⑤','⑥':'⑥','⑦':'⑦','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦' };
    return `サイズ${map[m[1]] || m[1]}`;
  }

  function classifyWork(raw, product){
    const label = clean(raw) || clean(product) || '未設定';
    const workText = clean(raw);
    const productText = clean(product);
    const combined = `${workText} ${productText}`.trim();
    const s = compact(combined);
    const sz = sizeName(workText) || sizeName(productText);

    // 商品カテゴリ分析と粒度を合わせるため、作業名だけでなく商品名も判定材料にする。
    // クレーンは商品名側にしか出ないケースがあるため、最優先で拾う。
    if (isCrane(combined)) {
      let middle = 'クレーン作業';
      if (isEstimate(combined)) middle = 'クレーン見積';
      else if (normalizeText(combined).includes('差額')) middle = 'クレーン差額';
      else if (isInstall(combined)) middle = 'クレーン搬入';
      return { major:'クレーン', middle, minor:label, order:50 };
    }

    if (isRecycle(combined)) {
      if (/洗濯/.test(s)) return { major:'リサイクル', middle:'洗濯機リサイクル', minor:label, order:30 };
      if (/冷蔵|冷凍/.test(s)) return { major:'リサイクル', middle:'冷蔵庫リサイクル', minor:label, order:31 };
      if (/テレビ|TV|ＴＶ/i.test(combined) || /テレビ|tv/.test(s)) return { major:'リサイクル', middle:'テレビリサイクル', minor:label, order:32 };
      return { major:'リサイクル', middle:'その他リサイクル', minor:label, order:33 };
    }

    if (isWaste(combined)) return { major:'廃材', middle:'廃材', minor:label, order:40 };
    if (sz) return { major:'配送', middle:sz, minor:label, order:10 + SIZE_ORDER.indexOf(sz) };
    if (/即日配送/.test(s)) return { major:'配送', middle:'即日配送', minor:label, order:18 };
    if (isKansen(combined)) return { major:'幹線料', middle:'幹線料', minor:label, order:90 };
    if (/設置|取付|取り付け|取付け|取替|入替|入れ替え/.test(s) || isInstall(combined)) return { major:'付帯作業', middle:'取付・設置', minor:label, order:60 };
    if (/ニップル|ホース|ジョイント|部材|マット|防止|架台|金具/.test(s)) return { major:'付帯作業', middle:'部材・付属品', minor:label, order:61 };
    if (/冷蔵|冷凍|洗濯|ドラム|テレビ|TV|ＴＶ|レンジ|照明|エアコン|炊飯/i.test(combined) || /冷蔵|冷凍|洗濯|ドラム|テレビ|tv|レンジ|照明|エアコン|炊飯/.test(s)) {
      return { major:'家電作業', middle:normalizeAppliance(s), minor:label, order:70 };
    }
    if (/大型|重量物|特殊/.test(s)) return { major:'特殊', middle:'特殊作業', minor:label, order:80 };
    return { major:'その他', middle:'その他', minor:label, order:999 };
  }

  function normalizeAppliance(s){
    if (/冷蔵|冷凍/.test(s)) return '冷蔵庫';
    if (/洗濯|ドラム/.test(s)) return '洗濯機';
    if (/テレビ|TV|ＴＶ/.test(s)) return 'テレビ';
    if (/レンジ/.test(s)) return 'レンジ';
    if (/照明/.test(s)) return '照明';
    if (/エアコン/.test(s)) return 'エアコン';
    if (/炊飯/.test(s)) return '炊飯器';
    return '家電作業';
  }

  function blankNode(label){ return { label, count:0, amount:0, order:999, children:new Map() }; }
  function addMap(map, label, amount, order){
    if (!map.has(label)) map.set(label, { label, count:0, amount:0, order: order ?? 999, children:new Map() });
    const item = map.get(label);
    item.count += 1;
    item.amount += amountOf(amount);
    item.order = Math.min(item.order ?? 999, order ?? 999);
    return item;
  }
  function sortRows(a,b){ return b.amount - a.amount || b.count - a.count || (a.order ?? 999) - (b.order ?? 999) || String(a.label).localeCompare(String(b.label),'ja'); }
  function pct(v,total){ return total > 0 ? num(v) / total * 100 : 0; }

  function buildRows(rec){
    const majorMap = new Map();
    safeArray(rec?.tickets).forEach(t => {
      const details = safeArray(t.workDetails).length
        ? t.workDetails
        : Object.entries(t.works || {}).map(([work, amount]) => ({ work, amount }));
      details.forEach(d => {
        const raw = d.work || d.label || d.name || '未設定';
        const amount = amountOf(d.amount);
        const product = t.product || t.productName || t.product_name || '';
        if (isKansen(raw)) return;
        const c = classifyWork(raw, product);
        const major = addMap(majorMap, c.major, amount, c.order);
        const middle = addMap(major.children, c.middle, amount, c.order);
        addMap(middle.children, c.minor, amount, c.order);
      });
    });
    return [...majorMap.values()].sort(sortRows);
  }

  function ensureStyles(){
    if (document.getElementById('field-content-complete-style-20260502')) return;
    const st = document.createElement('style');
    st.id = 'field-content-complete-style-20260502';
    st.textContent = `
      .fc-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
      .fc-kpi{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);border-top:5px solid #1a4d7c;padding:16px;min-height:104px}.fc-kpi.green{border-top-color:#059669}.fc-kpi.amber{border-top-color:#f97316}.fc-kpi-label{font-size:12px;font-weight:900;color:#334155;margin-bottom:8px}.fc-kpi-target-month .fc-kpi-value{font-size:27px!important;white-space:nowrap!important;letter-spacing:-.04em!important}.fc-kpi-value{font-size:28px;font-weight:900;color:#0f172a;line-height:1.1;white-space:nowrap}.fc-kpi-sub{font-size:12px;color:#8291a7;font-weight:800;margin-top:8px;line-height:1.45}
      .fc-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.fc-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.fc-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}.fc-title{font-size:15px;font-weight:900;color:#18324f}.fc-sub{font-size:12px;color:#8291a7;font-weight:800}.fc-body{padding:14px 16px}
      .fc-bar-row{display:grid;grid-template-columns:30px minmax(110px,190px) minmax(160px,1fr) minmax(115px,150px);gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #edf2f7}.fc-rank{width:24px;height:24px;border-radius:999px;background:#e8f1fb;color:#1a4d7c;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:12px}.fc-name{font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fc-track{height:13px;background:#e5e7eb;border-radius:999px;overflow:hidden}.fc-fill{height:100%;background:#1a4d7c;border-radius:999px}.fc-val{text-align:right;font-size:12px;font-weight:900}.fc-val span{display:block;color:#8291a7;font-size:11px;margin-top:2px}
      .fc-detail details{border:1px solid var(--border);border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}.fc-detail summary{cursor:pointer;list-style:none;padding:13px 16px;background:#f8fafc;display:flex;justify-content:space-between;gap:12px;align-items:center;font-weight:900}.fc-detail summary::-webkit-details-marker{display:none}.fc-pill{display:inline-flex;align-items:center;border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;color:#334155}.fc-detail-body{padding:12px 16px}.fc-table{width:100%;border-collapse:collapse}.fc-table th,.fc-table td{border-bottom:1px solid #edf2f7;padding:8px;font-size:13px}.fc-table th{background:#f3f6fb;color:#334155;text-align:left;font-weight:900}.fc-table .r{text-align:right}.fc-note{font-size:12px;color:#64748b;line-height:1.7;margin:0 0 12px 2px}
      @media(max-width:1200px){.fc-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fc-grid{grid-template-columns:1fr}.fc-bar-row{grid-template-columns:30px minmax(100px,150px) minmax(120px,1fr) minmax(90px,120px)}}`;
    document.head.appendChild(st);
  }

  function bars(rows, total, opts={}){
    const limit = opts.limit || rows.length;
    const list = rows.slice(0, limit);
    if (!list.length) return '<div style="padding:40px;text-align:center;color:var(--text3);font-weight:800">データなし</div>';
    const max = Math.max(...list.map(r=>r.amount), 1);
    return list.map((r,i)=>{
      const width = Math.max(2, r.amount / max * 100);
      return `<div class="fc-bar-row"><div class="fc-rank">${i+1}</div><div class="fc-name" title="${esc(r.label)}">${esc(r.label)}</div><div class="fc-track"><div class="fc-fill" style="width:${width.toFixed(1)}%"></div></div><div class="fc-val">${fmtK(r.amount)}千円<span>${fmt(r.count)}点 / ${fmt1(pct(r.amount,total))}%</span></div></div>`;
    }).join('');
  }

  function render(){
    ensureStyles();
    const pane = document.getElementById('fpane-content');
    if (!pane) return;
    const ym = selectedYM();
    const rec = productRecord(ym);
    if (!rec || !safeArray(rec.tickets).length) {
      pane.innerHTML = `<div class="fc-note">商品・住所CSVを読み込むと、作業内容分析を表示します。</div><div class="fc-card"><div class="fc-body" style="padding:44px;text-align:center;color:var(--text3);font-weight:800">選択月の作業内容データがありません。</div></div>`;
      return;
    }
    const majors = buildRows(rec);
    const totalAmount = majors.reduce((s,r)=>s+r.amount,0);
    const totalCount = majors.reduce((s,r)=>s+r.count,0);
    const top = majors[0] || blankNode('-');
    const avg = totalCount ? totalAmount / totalCount : 0;
    const mids = majors.flatMap(m => [...m.children.values()].map(x => ({...x, label:x.label, major:m.label}))).sort(sortRows);

    pane.innerHTML = `<div class="fc-note">作業内容は、大分類 → 中分類 → 小分類で整理しています。グラフはChart.jsを使わず、HTMLバーで表示しています。</div>
      <div class="fc-kpi-grid">
        <div class="fc-kpi fc-kpi-target-month"><div class="fc-kpi-label">対象月</div><div class="fc-kpi-value">${esc(ymText(ym))}</div><div class="fc-kpi-sub">作業内容分析</div></div>
        <div class="fc-kpi green"><div class="fc-kpi-label">作業内容売上</div><div class="fc-kpi-value">${fmtK(totalAmount)}千円</div><div class="fc-kpi-sub">商品・住所CSV 作業明細ベース</div></div>
        <div class="fc-kpi"><div class="fc-kpi-label">作業明細</div><div class="fc-kpi-value">${fmt(totalCount)}</div><div class="fc-kpi-sub">明細点数</div></div>
        <div class="fc-kpi amber"><div class="fc-kpi-label">平均単価</div><div class="fc-kpi-value">${fmt(avg)}円</div><div class="fc-kpi-sub">売上 ÷ 作業明細</div></div>
        <div class="fc-kpi"><div class="fc-kpi-label">最大カテゴリ</div><div class="fc-kpi-value">${esc(top.label)}</div><div class="fc-kpi-sub">${fmtK(top.amount)}千円 / ${fmt1(pct(top.amount,totalAmount))}%</div></div>
      </div>
      <div class="fc-grid">
        <div class="fc-card"><div class="fc-head"><div><div class="fc-title">大分類別 売上構成</div><div class="fc-sub">全体構造</div></div></div><div class="fc-body">${bars(majors,totalAmount)}</div></div>
        <div class="fc-card"><div class="fc-head"><div><div class="fc-title">中分類 上位</div><div class="fc-sub">どの作業が金額を作っているか</div></div></div><div class="fc-body">${bars(mids,totalAmount,{limit:12})}</div></div>
      </div>
      <div class="fc-card fc-detail"><div class="fc-head"><div><div class="fc-title">大分類別 詳細</div><div class="fc-sub">クリックで中分類・小分類を確認</div></div><span class="fc-pill">上位：${esc(top.label)} ${fmtK(top.amount)}千円</span></div><div class="fc-body">
      ${majors.map((m,idx)=>{
        const children = [...m.children.values()].sort(sortRows);
        return `<details ${idx < 3 ? 'open' : ''}><summary><span>＋ ${esc(m.label)} <span class="fc-pill">${fmtK(m.amount)}千円</span> <span class="fc-pill">${fmt(m.count)}点</span></span><span>${fmt1(pct(m.amount,totalAmount))}%</span></summary><div class="fc-detail-body">
          ${children.map(mid=>{
            const minors = [...mid.children.values()].sort(sortRows).slice(0,20);
            return `<details style="margin-bottom:8px" ${children.length <= 4 ? 'open' : ''}><summary><span>${esc(mid.label)} <span class="fc-pill">${fmtK(mid.amount)}千円</span> <span class="fc-pill">${fmt(mid.count)}点</span></span><span>${fmt1(pct(mid.amount,totalAmount))}%</span></summary><div class="fc-detail-body"><table class="fc-table"><thead><tr><th>小分類・元表記</th><th class="r">点数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead><tbody>${minors.map(mi=>`<tr><td>${esc(mi.label)}</td><td class="r">${fmt(mi.count)}</td><td class="r">${fmtK(mi.amount)}千円</td><td class="r">${fmt1(pct(mi.amount,totalAmount))}%</td></tr>`).join('')}</tbody></table></div></details>`;
          }).join('')}</div></details>`;
      }).join('')}</div></div>`;
  }

  function renderSoon(){ clearTimeout(window.__fieldContentCompleteTimer); window.__fieldContentCompleteTimer = setTimeout(()=>{ try { render(); } catch(e){ console.error('[field_content]', e); } }, 80); }

  window.FIELD_CONTENT_UI = { render, renderSoon };
  if (window.FIELD_CSV_REBUILD) FIELD_CSV_REBUILD.renderContent = render;

  if (window.NAV && typeof NAV.go === 'function' && !NAV.__fieldContentWrapped20260502) {
    const oldGo = NAV.go.bind(NAV);
    NAV.go = function(el){ const r = oldGo(el); renderSoon(); return r; };
    NAV.__fieldContentWrapped20260502 = true;
  }
  document.addEventListener('change', (e)=>{
    if (e.target && (e.target.id === 'field-common-month-select' || e.target.id === 'field-common-fy-select')) renderSoon();
  }, true);
  document.addEventListener('DOMContentLoaded', renderSoon);
  setTimeout(renderSoon, 300);
  setTimeout(renderSoon, 900);
})();
