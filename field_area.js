/* field_area.js : エリア分析ビュー 完全版
   2026-05-03
   方針：
   1) エリア分析の本体を field_area.js に集約
   2) field_core.js 側の旧 renderMap() はまだ削除しない
   3) center.html 側の onchange="FIELD_UI.renderMap()" を壊さないため、FIELD_UI.renderMap を本ファイル側で上書き
   4) STATE だけに依存せず localStorage 全体から productAddressData 相当を探索
   5) I列エスライン原票番号で1件化済みの tickets を前提に、都道府県・市区町村・エリア別に集計
*/
'use strict';

(function(){
  const FLAG = '__FIELD_AREA_COMPLETE_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const MONTH_ORDER = ['04','05','06','07','08','09','10','11','12','01','02','03'];
  let timer = null;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
  function num(v){
    const s = String(v ?? '')
      .normalize('NFKC')
      .replace(/,/g,'')
      .replace(/[円¥\s　]/g,'')
      .replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function fmt1(v){
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(1) : '0.0';
  }
  function pct(v,total){ return total ? (num(v) / total * 100) : 0; }
  function clean(v){ return String(v ?? '').normalize('NFKC').trim(); }
  function normYM(v){
    const s = String(v ?? '').normalize('NFKC');
    const d = s.replace(/[^0-9]/g,'');
    if (d.length >= 6) return d.slice(0,6);
    return '';
  }
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function fiscalYear(ym){
    const y = Number(String(ym || '').slice(0,4));
    const m = Number(String(ym || '').slice(4,6));
    if (!y || !m) return '';
    return String(m <= 3 ? y - 1 : y);
  }
  function fyMonthSort(a,b){
    const ma = String(a || '').slice(4,6);
    const mb = String(b || '').slice(4,6);
    return MONTH_ORDER.indexOf(ma) - MONTH_ORDER.indexOf(mb);
  }
  function active(){
    const v = document.getElementById('view-field-area');
    return !!(v && v.classList.contains('active'));
  }

  function localJSON(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      if (!/^[\[{]/.test(raw.trim())) return null;
      return JSON.parse(raw);
    } catch(e) {
      return null;
    }
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

  function normalizeTicket(t){
    if (!obj(t)) return null;
    const slip = clean(t.slip || t.slipNo || t.ticketNo || t.invoiceNo || t['エスライン原票番号'] || t['原票番号']);
    const address = clean(t.address || t.addr || t['住所'] || t['届け先住所'] || t['配送先住所']);
    const derived = areaFromAddress(address);
    const pref = clean(t.pref || t.prefecture || t['都道府県']) || derived.pref;
    const city = clean(t.city || t.municipality || t['市区町村']) || derived.city;
    const area = clean(t.area || t.areaName || t['エリア']) || (pref === '未設定' ? city : pref + city) || derived.area;
    return {
      slip,
      pref: pref || '未設定',
      city: city || '未設定',
      area: area || '未設定',
      address,
      product: clean(t.product || t.productName || t['商品']),
      category: clean(t.category || t.productCategory || t['商品カテゴリ']) || '未設定',
      amount: num(t.amount || t.sales || t.value || t['金額'] || t['売上'])
    };
  }

  function normalizeProductRecord(x, source){
    if (!obj(x)) return null;
    const ym = normYM(x.ym || x.YM || x.month || x.targetYM || x.date || x.name || source);
    if (!ym) return null;

    let tickets = [];
    if (arr(x.tickets).length) tickets = x.tickets.map(normalizeTicket).filter(Boolean);
    else if (arr(x.rows).length) tickets = x.rows.map(normalizeTicket).filter(Boolean);
    else if (arr(x.data).length) tickets = x.data.map(normalizeTicket).filter(Boolean);
    else if (arr(x.rawRows).length) tickets = x.rawRows.map(normalizeTicket).filter(Boolean);

    if (!tickets.length) return null;

    const bySlip = new Map();
    const noSlip = [];
    tickets.forEach((t,idx)=>{
      const key = t.slip;
      if (!key) {
        noSlip.push({ ...t, slip:`__no_slip_${idx}` });
        return;
      }
      if (!bySlip.has(key)) bySlip.set(key, { ...t });
      else {
        const base = bySlip.get(key);
        base.amount += num(t.amount);
        if (!base.address && t.address) base.address = t.address;
        if ((base.pref === '未設定' || !base.pref) && t.pref) base.pref = t.pref;
        if ((base.city === '未設定' || !base.city) && t.city) base.city = t.city;
        if ((base.area === '未設定' || !base.area) && t.area) base.area = t.area;
        if ((base.category === '未設定' || !base.category) && t.category) base.category = t.category;
      }
    });

    const uniqueTickets = [...bySlip.values(), ...noSlip];
    return {
      ...x,
      ym,
      __source: source,
      tickets: uniqueTickets,
      uniqueCount: Number(x.uniqueCount || uniqueTickets.length),
      detailRows: Number(x.detailRows || x.rawRows || uniqueTickets.length),
      duplicateExcluded: Number(x.duplicateExcluded || Math.max(0, Number(x.detailRows || 0) - uniqueTickets.length)),
      amount: Number(x.amount || uniqueTickets.reduce((s,t)=>s + num(t.amount),0))
    };
  }

  function collectProductRecords(){
    const out = [];
    const seen = new Set();

    function push(x, source){
      const rec = normalizeProductRecord(x, source);
      if (!rec) return;
      const key = `${rec.ym}:${rec.tickets.length}:${rec.amount}:${source}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(rec);
    }

    const st = window.STATE || {};
    arr(st.productAddressData).forEach((x,i)=>push(x, `STATE.productAddressData.${i}`));
    arr(st.fieldData).forEach((x,i)=>push(x, `STATE.fieldData.${i}`));

    try {
      for (let i=0; i<localStorage.length; i++){
        const key = localStorage.key(i);
        const parsed = localJSON(key);
        if (!parsed) continue;

        if (Array.isArray(parsed)) {
          parsed.forEach((x,idx)=>push(x, `${key}.${idx}`));
        } else if (obj(parsed)) {
          push(parsed, key);
          Object.keys(parsed).forEach(k=>{
            const v = parsed[k];
            if (Array.isArray(v)) v.forEach((x,idx)=>push(x, `${key}.${k}.${idx}`));
          });
        }
      }
    } catch(e) {}

    out.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    return out;
  }

  function allYMs(){
    return [...new Set(collectProductRecords().map(x=>x.ym).filter(Boolean))].sort();
  }

  function selectedYM(){
    const yms = allYMs();
    const latest = yms[yms.length - 1] || '';

    const common = document.getElementById('field-common-month-select');
    if (common && normYM(common.value) && yms.includes(normYM(common.value))) return normYM(common.value);

    const st = window.STATE || {};
    if (normYM(st.selYM) && yms.includes(normYM(st.selYM))) return normYM(st.selYM);

    const sub = document.getElementById('page-sub')?.textContent || '';
    const m = sub.match(/(\d{4})年\s*(\d{1,2})月/);
    if (m) {
      const ym = `${m[1]}${String(m[2]).padStart(2,'0')}`;
      if (yms.includes(ym)) return ym;
    }

    return latest;
  }

  function getRecordForYM(ym){
    const list = collectProductRecords().filter(x=>x.ym === ym);
    if (!list.length) return null;
    return list.sort((a,b)=>{
      const at = arr(a.tickets).length;
      const bt = arr(b.tickets).length;
      if (bt !== at) return bt - at;
      return String(b.__source || '').localeCompare(String(a.__source || ''));
    })[0];
  }

  function sortRows(rows, mode, metric){
    const key = metric === 'amount' ? 'amount' : 'count';
    const list = [...rows];
    if (mode === 'amount') list.sort((a,b)=>b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label,'ja'));
    else if (mode === 'name') list.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
    else list.sort((a,b)=>b[key] - a[key] || b.amount - a.amount || a.label.localeCompare(b.label,'ja'));
    return list;
  }

  function buildAreaRows(rec){
    const map = new Map();
    arr(rec?.tickets).forEach(t=>{
      const nt = normalizeTicket(t);
      if (!nt) return;
      const key = nt.area || '未設定';
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          pref: nt.pref || '未設定',
          city: nt.city || key,
          count: 0,
          amount: 0,
          categories: new Map()
        });
      }
      const row = map.get(key);
      row.count += 1;
      row.amount += num(nt.amount);
      const cat = nt.category || '未設定';
      row.categories.set(cat, (row.categories.get(cat) || 0) + 1);
    });
    return [...map.values()].map(r=>{
      const topCat = [...r.categories.entries()].sort((a,b)=>b[1]-a[1])[0];
      return { ...r, topCategory: topCat ? topCat[0] : '未設定' };
    });
  }

  function summaryHtml(ym, rec, rows){
    const totalCount = rows.reduce((s,r)=>s + Number(r.count || 0),0);
    const totalAmount = rows.reduce((s,r)=>s + Number(r.amount || 0),0);
    const prefCount = new Set(rows.map(r=>r.pref).filter(Boolean)).size;
    const areaCount = rows.length;
    const top = rows[0];
    return `
      <div class="fa-summary">
        <div class="fa-summary-head">
          <div>
            <div class="fa-title">${esc(ymText(ym))} エリア分析</div>
            <div class="fa-note">商品・住所CSVをI列エスライン原票番号で1件化して、住所から都道府県・市区町村を判定</div>
          </div>
          <div class="fa-source">取得元：${esc(rec.__source || rec.source || 'productAddressData')}</div>
        </div>
        <div class="fa-kpis">
          <div class="fa-kpi"><div>原票件数</div><strong>${fmt(totalCount)}</strong><span>件</span></div>
          <div class="fa-kpi"><div>売上</div><strong>${fmtK(totalAmount)}</strong><span>千円</span></div>
          <div class="fa-kpi"><div>都道府県</div><strong>${fmt(prefCount)}</strong><span>件</span></div>
          <div class="fa-kpi"><div>市区町村</div><strong>${fmt(areaCount)}</strong><span>地区</span></div>
          <div class="fa-kpi"><div>最多エリア</div><strong>${top ? esc(top.label) : '—'}</strong><span>${top ? `${fmt(top.count)}件` : ''}</span></div>
        </div>
      </div>`;
  }

  function barsHtml(rows, metric, totalCount, totalAmount){
    const key = metric === 'amount' ? 'amount' : 'count';
    if (!rows.length) return '<div class="fa-empty">データなし</div>';
    const max = Math.max(...rows.map(r=>Number(r[key] || 0)), 1);
    return rows.map((r,i)=>{
      const val = Number(r[key] || 0);
      const w = Math.max(2, Math.round(val / max * 100));
      const shareBase = key === 'amount' ? totalAmount : totalCount;
      const share = pct(val, shareBase);
      return `
        <div class="field-area-row fa-row">
          <div class="field-area-label fa-label" title="${esc(r.label)}">
            <span class="fa-rank">${i + 1}</span>
            <span>${esc(r.label)}</span>
            <small>${esc(r.topCategory || '')}</small>
          </div>
          <div class="field-area-track fa-track"><div class="field-area-fill fa-fill" style="width:${w}%"></div></div>
          <div class="field-area-value fa-value">
            <b>${fmt(r.count)}件</b>
            <span>/ ${fmtK(r.amount)}千円</span>
            <em>${fmt1(share)}%</em>
          </div>
        </div>`;
    }).join('');
  }

  function tableHtml(rows, totalCount, totalAmount){
    if (!rows.length) return '';
    return `
      <div class="fa-table-wrap">
        <table class="tbl fa-table">
          <thead>
            <tr>
              <th>順位</th><th>都道府県</th><th>市区町村</th><th>主カテゴリ</th>
              <th class="r">件数</th><th class="r">売上（千円）</th><th class="r">件数構成比</th><th class="r">売上構成比</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr>
                <td>${i + 1}</td>
                <td>${esc(r.pref)}</td>
                <td>${esc(r.city)}</td>
                <td>${esc(r.topCategory || '未設定')}</td>
                <td class="r">${fmt(r.count)}</td>
                <td class="r">${fmtK(r.amount)}</td>
                <td class="r">${fmt1(pct(r.count,totalCount))}%</td>
                <td class="r">${fmt1(pct(r.amount,totalAmount))}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderOverall(box, rows, metric){
    const totalCount = rows.reduce((s,r)=>s + Number(r.count || 0),0);
    const totalAmount = rows.reduce((s,r)=>s + Number(r.amount || 0),0);
    const limited = rows.slice(0,30);
    box.insertAdjacentHTML('beforeend', `
      <div class="fa-body">
        <div class="fa-section-title">エリア別ランキング TOP${limited.length}</div>
        ${barsHtml(limited, metric, totalCount, totalAmount)}
        ${tableHtml(limited, totalCount, totalAmount)}
      </div>`);
  }

  function renderPref(box, rows, metric, sortMode){
    const totalCount = rows.reduce((s,r)=>s + Number(r.count || 0),0);
    const totalAmount = rows.reduce((s,r)=>s + Number(r.amount || 0),0);
    const prefMap = new Map();
    rows.forEach(r=>{
      if (!prefMap.has(r.pref)) prefMap.set(r.pref, { label:r.pref, pref:r.pref, count:0, amount:0, children:[] });
      const p = prefMap.get(r.pref);
      p.count += r.count;
      p.amount += r.amount;
      p.children.push(r);
    });
    const prefs = sortRows([...prefMap.values()], sortMode, metric);
    box.insertAdjacentHTML('beforeend', `
      <div class="fa-body">
        <div class="fa-section-title">都道府県別内訳</div>
        ${prefs.map((p,idx)=>{
          const children = sortRows(p.children, sortMode, metric);
          return `
            <details class="fa-detail" ${idx < 3 ? 'open' : ''}>
              <summary>
                <span>＋ ${esc(p.pref)} <small>${fmt(children.length)}地区</small></span>
                <b>${metric === 'amount' ? `${fmtK(p.amount)}千円` : `${fmt(p.count)}件`} <em>${fmt1(pct(metric === 'amount' ? p.amount : p.count, metric === 'amount' ? totalAmount : totalCount))}%</em></b>
              </summary>
              <div class="fa-detail-body">${barsHtml(children, metric, totalCount, totalAmount)}</div>
            </details>`;
        }).join('')}
      </div>`);
  }

  function render(){
    const box = document.getElementById('field-map');
    const no = document.getElementById('map-no-data');
    const debug = document.getElementById('map-debug-info');
    if (!box) return;

    ensureStyle();

    const ym = selectedYM();
    const rec = getRecordForYM(ym);
    if (!rec || !arr(rec.tickets).length) {
      box.innerHTML = '<div class="fa-empty">商品・住所CSVを読み込んでください</div>';
      if (no) no.style.display = 'none';
      if (debug) debug.style.display = 'none';
      return;
    }

    const mode = document.getElementById('field-area-view-mode')?.value || 'overall';
    const sortMode = document.getElementById('field-area-sort-mode')?.value || 'count';
    const metric = document.getElementById('map-metric-sel')?.value || 'count';

    let rows = buildAreaRows(rec);
    rows = sortRows(rows, sortMode, metric);

    if (!rows.length) {
      box.innerHTML = '<div class="fa-empty">住所・エリアを判定できるデータがありません</div>';
      if (no) no.style.display = 'none';
      if (debug) {
        debug.style.display = 'block';
        debug.textContent = `${ymText(ym)} の商品・住所CSVはありますが、住所列またはエリア判定に使えるデータが確認できません。`;
      }
      return;
    }

    box.innerHTML = summaryHtml(ym, rec, rows);
    if (mode === 'pref') renderPref(box, rows, metric, sortMode);
    else renderOverall(box, rows, metric);

    if (no) no.style.display = 'none';
    if (debug) {
      debug.style.display = 'none';
      debug.textContent = '';
    }
  }

  function ensureStyle(){
    if (document.getElementById('field-area-complete-style')) return;
    const style = document.createElement('style');
    style.id = 'field-area-complete-style';
    style.textContent = `
      #field-map{height:auto!important;min-height:260px;border-radius:16px!important;border:1px solid var(--border,#e5e7eb);overflow:hidden;background:#fff}
      #field-map .fa-summary{padding:16px 18px;border-bottom:1px solid #e5e7eb;background:linear-gradient(180deg,#ffffff,#f8fafc)}
      #field-map .fa-summary-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}
      #field-map .fa-title{font-size:18px;font-weight:900;color:#0f172a;letter-spacing:.01em}
      #field-map .fa-note{font-size:12px;color:#64748b;margin-top:5px;font-weight:700;line-height:1.6}
      #field-map .fa-source{font-size:11px;color:#64748b;background:#eef2ff;border:1px solid #c7d2fe;border-radius:999px;padding:6px 10px;font-weight:800}
      #field-map .fa-kpis{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px}
      #field-map .fa-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;box-shadow:0 8px 22px rgba(15,23,42,.05);min-width:0}
      #field-map .fa-kpi div{font-size:11px;color:#64748b;font-weight:900;margin-bottom:5px}
      #field-map .fa-kpi strong{display:block;font-size:20px;color:#0f172a;font-weight:950;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #field-map .fa-kpi span{display:block;font-size:11px;color:#64748b;font-weight:800;margin-top:4px}
      #field-map .fa-body{padding:16px 18px}
      #field-map .fa-section-title{font-size:15px;font-weight:950;color:#0f172a;margin:0 0 12px;border-left:4px solid #2563eb;padding-left:10px}
      #field-map .fa-row{grid-template-columns:minmax(220px,320px) minmax(260px,1fr) minmax(190px,250px)!important;gap:16px!important;margin:11px 0!important;align-items:center}
      #field-map .fa-label{display:flex;align-items:center;gap:8px;font-size:13px!important;font-weight:900;color:#0f172a;min-width:0}
      #field-map .fa-label span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa-label small{font-size:10px;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:3px 7px;white-space:nowrap;font-weight:900}
      #field-map .fa-rank{width:24px;height:24px;border-radius:999px;background:#eaf3ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:950;flex:0 0 auto}
      #field-map .fa-track{height:22px!important;background:#e2e8f0!important;border-radius:999px;overflow:hidden}
      #field-map .fa-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#174f7f,#2563eb)!important}
      #field-map .fa-value{font-size:13px!important;color:#0f172a;text-align:right;white-space:nowrap}
      #field-map .fa-value b{font-weight:950;margin-right:5px}
      #field-map .fa-value span{color:#64748b;font-weight:800}
      #field-map .fa-value em{font-style:normal;margin-left:8px;color:#1d4ed8;font-weight:950}
      #field-map .fa-table-wrap{margin-top:18px;max-height:520px;overflow:auto;border:1px solid #e5e7eb;border-radius:14px}
      #field-map .fa-table{margin:0;min-width:860px}
      #field-map .fa-detail{border:1px solid #e5e7eb;border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden;box-shadow:0 8px 22px rgba(15,23,42,.04)}
      #field-map .fa-detail summary{cursor:pointer;padding:13px 15px;background:#f8fafc;font-weight:950;display:flex;justify-content:space-between;align-items:center;gap:14px;color:#0f172a}
      #field-map .fa-detail summary small{font-size:11px;color:#64748b;margin-left:8px;font-weight:900}
      #field-map .fa-detail summary b{font-size:13px;white-space:nowrap}
      #field-map .fa-detail summary em{font-style:normal;color:#1d4ed8;margin-left:6px}
      #field-map .fa-detail-body{padding:10px 14px 14px}
      #field-map .fa-empty{padding:46px;text-align:center;color:#64748b;font-weight:900}
      @media (max-width:900px){
        #field-map .fa-kpis{grid-template-columns:repeat(2,minmax(130px,1fr))}
        #field-map .fa-row{grid-template-columns:1fr!important;gap:6px!important;border-bottom:1px solid #eef2f7;padding-bottom:10px}
        #field-map .fa-value{text-align:left}
      }
    `;
    document.head.appendChild(style);
  }

  function install(){
    window.FIELD_AREA_UI = { render };
    window.FIELD_UI = window.FIELD_UI || {};
    window.FIELD_UI.renderMap = render;

    ['field-area-view-mode','field-area-sort-mode','map-metric-sel','field-common-month-select','field-common-fy-select'].forEach(id=>{
      const el = document.getElementById(id);
      if (!el || el.__fieldAreaBound) return;
      el.__fieldAreaBound = true;
      el.addEventListener('change', ()=>setTimeout(render, 0));
    });
  }

  function startGuard(){
    if (timer) return;
    timer = setInterval(()=>{
      if (!active()) return;
      install();
      const box = document.getElementById('field-map');
      if (!box) return;
      const text = box.textContent || '';
      const hasOwnUi = !!box.querySelector('.fa-summary, .fa-empty');
      if (!hasOwnUi || /Leaflet|地図|商品・住所CSVを読み込んでください/.test(text)) render();
    }, 500);
  }

  install();
  startGuard();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ install(); if (active()) render(); });
  } else {
    setTimeout(()=>{ install(); if (active()) render(); }, 0);
  }
})();
