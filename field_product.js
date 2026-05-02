/* field_product.js : 商品カテゴリ分析 完全版（大分類・中分類・小分類＋HTMLバー表示）
   2026-05-02
   ・Chart.jsに依存しないため、グラフが空になる問題を回避
   ・商品・住所CSVの tickets を使用
   ・商品カテゴリを大分類 → 中分類 → 小分類で整理
   ・既存HTMLの #fpane-product を安全に再描画
*/
'use strict';
(function(){
  if (window.__FIELD_PRODUCT_COMPLETE_20260502__) return;
  window.__FIELD_PRODUCT_COMPLETE_20260502__ = true;

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
    return (window.STATE && STATE.selYM) || safeArray(STATE?.productAddressData).at(-1)?.ym || '';
  }
  function productRecord(ym){ return safeArray(STATE?.productAddressData).find(d => d && d.ym === ym) || null; }
  function clean(v){ return String(v ?? '').replace(/[\u0000-\u001f]/g,'').trim(); }
  function compact(v){ return clean(v).replace(/[\s　]/g,''); }

  function classifyProduct(t){
    const raw = clean(t.product || t.category || t.sizeBucket || '未設定');
    const s = compact(raw);
    if (/冷蔵|冷凍/.test(s)) {
      if (/500|５００|５01|５０１|以上/.test(s)) return { major:'冷蔵庫', middle:'500L以上', minor:raw, order:10 };
      if (/400|４００|499|４９９/.test(s)) return { major:'冷蔵庫', middle:'400〜499L', minor:raw, order:11 };
      if (/300|３００/.test(s)) return { major:'冷蔵庫', middle:'300L台', minor:raw, order:12 };
      if (/200|２００/.test(s)) return { major:'冷蔵庫', middle:'200L台', minor:raw, order:13 };
      return { major:'冷蔵庫', middle:'冷蔵庫その他', minor:raw, order:19 };
    }
    if (/洗濯|ドラム|乾燥/.test(s)) {
      if (/ドラム/.test(s)) return { major:'洗濯機', middle:'ドラム式', minor:raw, order:20 };
      if (/乾燥/.test(s)) return { major:'洗濯機', middle:'乾燥機', minor:raw, order:21 };
      return { major:'洗濯機', middle:'洗濯機', minor:raw, order:22 };
    }
    if (/テレビ|TV|ＴＶ/.test(s)) return { major:'テレビ', middle:'テレビ', minor:raw, order:30 };
    if (/レンジ|オーブン/.test(s)) return { major:'レンジ', middle:'レンジ', minor:raw, order:40 };
    if (/エアコン|空調/.test(s)) return { major:'エアコン', middle:'エアコン', minor:raw, order:50 };
    if (/炊飯/.test(s)) return { major:'炊飯器', middle:'炊飯器', minor:raw, order:60 };
    if (!raw || raw === '未設定') return { major:'未設定', middle:'未設定', minor:raw || '未設定', order:900 };
    return { major:'その他', middle:'その他', minor:raw, order:800 };
  }

  function addMap(map, label, amount, order){
    if (!map.has(label)) map.set(label, { label, count:0, amount:0, order: order ?? 999, children:new Map() });
    const item = map.get(label);
    item.count += 1;
    item.amount += num(amount);
    item.order = Math.min(item.order ?? 999, order ?? 999);
    return item;
  }
  function sortRows(a,b){ return b.amount - a.amount || b.count - a.count || (a.order ?? 999) - (b.order ?? 999) || String(a.label).localeCompare(String(b.label),'ja'); }
  function pct(v,total){ return total > 0 ? num(v) / total * 100 : 0; }

  function buildRows(rec){
    const majorMap = new Map();
    safeArray(rec?.tickets).forEach(t => {
      const c = classifyProduct(t);
      const amount = num(t.amount);
      const major = addMap(majorMap, c.major, amount, c.order);
      const middle = addMap(major.children, c.middle, amount, c.order);
      addMap(middle.children, c.minor, amount, c.order);
    });
    return [...majorMap.values()].sort(sortRows);
  }

  function ensureStyles(){
    if (document.getElementById('field-product-complete-style-20260502')) return;
    const st = document.createElement('style');
    st.id = 'field-product-complete-style-20260502';
    st.textContent = `
      .fp-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}.fp-kpi{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);border-top:5px solid #1a4d7c;padding:16px;min-height:104px}.fp-kpi.green{border-top-color:#059669}.fp-kpi.amber{border-top-color:#f97316}.fp-kpi-label{font-size:12px;font-weight:900;color:#334155;margin-bottom:8px}.fp-kpi-value{font-size:28px;font-weight:900;color:#0f172a;line-height:1.1;white-space:nowrap}.fp-kpi-sub{font-size:12px;color:#8291a7;font-weight:800;margin-top:8px;line-height:1.45}
      .fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.fp-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.fp-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:10px}.fp-title{font-size:15px;font-weight:900;color:#18324f}.fp-sub{font-size:12px;color:#8291a7;font-weight:800}.fp-body{padding:14px 16px}.fp-bar-row{display:grid;grid-template-columns:30px minmax(110px,190px) minmax(160px,1fr) minmax(115px,150px);gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #edf2f7}.fp-rank{width:24px;height:24px;border-radius:999px;background:#e8f1fb;color:#1a4d7c;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:12px}.fp-name{font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fp-track{height:13px;background:#e5e7eb;border-radius:999px;overflow:hidden}.fp-fill{height:100%;background:#1a4d7c;border-radius:999px}.fp-val{text-align:right;font-size:12px;font-weight:900}.fp-val span{display:block;color:#8291a7;font-size:11px;margin-top:2px}.fp-detail details{border:1px solid var(--border);border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}.fp-detail summary{cursor:pointer;list-style:none;padding:13px 16px;background:#f8fafc;display:flex;justify-content:space-between;gap:12px;align-items:center;font-weight:900}.fp-detail summary::-webkit-details-marker{display:none}.fp-pill{display:inline-flex;border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;color:#334155}.fp-detail-body{padding:12px 16px}.fp-table{width:100%;border-collapse:collapse}.fp-table th,.fp-table td{border-bottom:1px solid #edf2f7;padding:8px;font-size:13px}.fp-table th{background:#f3f6fb;text-align:left;font-weight:900}.fp-table .r{text-align:right}.fp-note{font-size:12px;color:#64748b;line-height:1.7;margin:0 0 12px 2px}@media(max-width:1200px){.fp-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fp-grid{grid-template-columns:1fr}.fp-bar-row{grid-template-columns:30px minmax(100px,150px) minmax(120px,1fr) minmax(90px,120px)}}`;
    document.head.appendChild(st);
  }

  function bars(rows,total,limit){
    const list = rows.slice(0, limit || rows.length);
    if (!list.length) return '<div style="padding:40px;text-align:center;color:var(--text3);font-weight:800">データなし</div>';
    const max = Math.max(...list.map(r=>r.amount), 1);
    return list.map((r,i)=>`<div class="fp-bar-row"><div class="fp-rank">${i+1}</div><div class="fp-name" title="${esc(r.label)}">${esc(r.label)}</div><div class="fp-track"><div class="fp-fill" style="width:${Math.max(2,r.amount/max*100).toFixed(1)}%"></div></div><div class="fp-val">${fmtK(r.amount)}千円<span>${fmt(r.count)}件 / ${fmt1(pct(r.amount,total))}%</span></div></div>`).join('');
  }

  function render(){
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
    const top = majors[0] || {label:'-',amount:0,count:0,children:new Map()};
    const avg = totalCount ? totalAmount / totalCount : 0;
    const mids = majors.flatMap(m=>[...m.children.values()].map(x=>({...x, major:m.label}))).sort(sortRows);
    pane.innerHTML = `<div class="fp-note">商品カテゴリを大分類 → 中分類 → 小分類で整理しています。グラフはChart.jsを使わず、HTMLバーで表示しています。</div>
      <div class="fp-kpi-grid"><div class="fp-kpi"><div class="fp-kpi-label">対象月</div><div class="fp-kpi-value">${esc(ymText(ym))}</div><div class="fp-kpi-sub">商品カテゴリ分析</div></div><div class="fp-kpi green"><div class="fp-kpi-label">商品売上</div><div class="fp-kpi-value">${fmtK(totalAmount)}千円</div><div class="fp-kpi-sub">商品・住所CSV 原票ベース</div></div><div class="fp-kpi"><div class="fp-kpi-label">伝票数</div><div class="fp-kpi-value">${fmt(totalCount)}</div><div class="fp-kpi-sub">I列原票番号ユニーク</div></div><div class="fp-kpi amber"><div class="fp-kpi-label">平均単価</div><div class="fp-kpi-value">${fmt(avg)}円</div><div class="fp-kpi-sub">商品売上 ÷ 伝票数</div></div><div class="fp-kpi"><div class="fp-kpi-label">最大カテゴリ</div><div class="fp-kpi-value">${esc(top.label)}</div><div class="fp-kpi-sub">${fmtK(top.amount)}千円 / ${fmt1(pct(top.amount,totalAmount))}%</div></div></div>
      <div class="fp-grid"><div class="fp-card"><div class="fp-head"><div><div class="fp-title">大分類別 売上構成</div><div class="fp-sub">冷蔵庫・洗濯機など</div></div></div><div class="fp-body">${bars(majors,totalAmount)}</div></div><div class="fp-card"><div class="fp-head"><div><div class="fp-title">中分類 上位</div><div class="fp-sub">容量帯・形式別</div></div></div><div class="fp-body">${bars(mids,totalAmount,12)}</div></div></div>
      <div class="fp-card fp-detail"><div class="fp-head"><div><div class="fp-title">商品カテゴリ別 詳細</div><div class="fp-sub">クリックで中分類・小分類を確認</div></div><span class="fp-pill">上位：${esc(top.label)} ${fmtK(top.amount)}千円</span></div><div class="fp-body">${majors.map((m,idx)=>{ const children=[...m.children.values()].sort(sortRows); return `<details ${idx<3?'open':''}><summary><span>＋ ${esc(m.label)} <span class="fp-pill">${fmtK(m.amount)}千円</span> <span class="fp-pill">${fmt(m.count)}件</span></span><span>${fmt1(pct(m.amount,totalAmount))}%</span></summary><div class="fp-detail-body">${children.map(mid=>{ const minors=[...mid.children.values()].sort(sortRows).slice(0,20); return `<details style="margin-bottom:8px" ${children.length<=4?'open':''}><summary><span>${esc(mid.label)} <span class="fp-pill">${fmtK(mid.amount)}千円</span> <span class="fp-pill">${fmt(mid.count)}件</span></span><span>${fmt1(pct(mid.amount,totalAmount))}%</span></summary><div class="fp-detail-body"><table class="fp-table"><thead><tr><th>小分類・元表記</th><th class="r">伝票数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead><tbody>${minors.map(mi=>`<tr><td>${esc(mi.label)}</td><td class="r">${fmt(mi.count)}</td><td class="r">${fmtK(mi.amount)}千円</td><td class="r">${fmt1(pct(mi.amount,totalAmount))}%</td></tr>`).join('')}</tbody></table></div></details>`; }).join('')}</div></details>`; }).join('')}</div></div>`;
  }

  function renderSoon(){ clearTimeout(window.__fieldProductCompleteTimer); window.__fieldProductCompleteTimer = setTimeout(()=>{ try { render(); } catch(e){ console.error('[field_product]', e); } }, 80); }
  window.FIELD_PRODUCT_UI = { render, renderSoon };
  if (window.FIELD_CSV_REBUILD) FIELD_CSV_REBUILD.renderProduct = render;
  if (window.NAV && typeof NAV.go === 'function' && !NAV.__fieldProductWrapped20260502) {
    const oldGo = NAV.go.bind(NAV);
    NAV.go = function(el){ const r = oldGo(el); renderSoon(); return r; };
    NAV.__fieldProductWrapped20260502 = true;
  }
  document.addEventListener('change', (e)=>{ if (e.target && (e.target.id === 'field-common-month-select' || e.target.id === 'field-common-fy-select')) renderSoon(); }, true);
  document.addEventListener('DOMContentLoaded', renderSoon);
  setTimeout(renderSoon, 300);
  setTimeout(renderSoon, 900);
})();
