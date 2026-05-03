/* field_area.js : エリア分析ビュー 市区町村固定・実務UI版
   2026-05-03
   目的：
   - エリア別の件数構成・売上構成を見やすく表示
   - 商品カテゴリは表示しない
   - 郵便番号OK等の検証情報は通常非表示
   - 要確認がある場合のみ件数表示
   - 表示切替：市区町村ランキング / 都道府県 / 月別推移
*/
'use strict';

(function(){
  const FLAG = '__FIELD_AREA_CITY_ONLY_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  let timer = null;
  let rendering = false;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function num(v){
    const s = String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function fmt1(v){ const n = Number(v); return Number.isFinite(n) ? n.toFixed(1) : '0.0'; }
  function pct(v,total){ return total ? (num(v) / total * 100) : 0; }
  function clean(v){ return String(v ?? '').normalize('NFKC').trim(); }
  function normalizeZip(v){
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }
  function normYM(v){
    const d = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return d.length >= 6 ? d.slice(0,6) : '';
  }
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function ymShort(ym){
    const m = Number(String(ym || '').slice(4,6));
    return m ? `${m}月` : '—';
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
    } catch(e) { return null; }
  }

  function splitPrefCity(text){
    const t = clean(text).replace(/\s+/g,'');
    if (!t) return { pref:'', city:'' };
    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = prefMatch ? t.slice(pref.length) : t;
    let city = '';
    let town = '';
    const wardCity = rest.match(/^(.+?市.+?区)(.*)$/);
    const muni = rest.match(/^(.+?[市区町村])(.*)$/);
    if (wardCity) { city = wardCity[1]; town = wardCity[2] || ''; }
    else if (muni) { city = muni[1]; town = muni[2] || ''; }
    return { pref, city, town };
  }

  function areaFromZip(zipRaw){
    const zip = normalizeZip(zipRaw);
    if (!zip) return null;

    let hit = null;
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.get) hit = JP_ZIP_LOADER.get(zip);
    else if (window.JP_ZIP_MASTER && typeof window.JP_ZIP_MASTER === 'object') hit = window.JP_ZIP_MASTER[zip];

    if (!hit) return null;

    if (Array.isArray(hit)) return { zip, pref: clean(hit[0]) || '未設定', city: clean(hit[1]) || '未設定', town: clean(hit[2]) || '', zipStatus:'OK' };

    if (obj(hit)) {
      const pref = clean(hit.pref || hit.prefecture || hit[0]);
      const city = clean(hit.city || hit.municipality || hit.addr1 || hit[1]);
      const town = clean(hit.town || hit.area || hit.addr2 || hit[2]);
      return { zip, pref: pref || '未設定', city: city || '未設定', town: town || '', zipStatus:'OK' };
    }

    const p = splitPrefCity(hit);
    return { zip, pref: p.pref || '未設定', city: p.city || '未設定', town: p.town || '', zipStatus:'OK' };
  }

  function areaFromAddress(address){
    const p = splitPrefCity(address);
    return {
      pref: p.pref || '未設定',
      city: p.city || '未設定',
      town: p.town || '',
      zipStatus: address ? 'FALLBACK' : 'NO_ADDRESS'
    };
  }

  function resolveArea(t){
    const zipHit = areaFromZip(t.zip);
    if (zipHit) return zipHit;
    const fallback = areaFromAddress(t.address);
    fallback.zip = normalizeZip(t.zip);
    fallback.zipStatus = fallback.zip ? 'ZIP_NOT_FOUND' : 'NO_ZIP';
    return fallback;
  }

  function normalizeTicket(t){
    if (!obj(t)) return null;
    const slip = clean(t.slip || t.slipNo || t.ticketNo || t.invoiceNo || t['エスライン原票番号'] || t['原票番号']);
    const zip = normalizeZip(
      t.zip || t.zipcode || t.postalCode || t.postCode ||
      t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] || t['L列']
    );
    const address = clean(t.address || t.addr || t.destinationAddress || t['住所'] || t['届け先住所'] || t['配送先住所'] || t['お届け先住所']);
    const base = {
      slip, zip, address,
      amount: num(t.amount || t.sales || t.value || t['金額'] || t['売上'])
    };
    const resolved = resolveArea(base);
    const pref = clean(t.pref || t.prefecture || t['都道府県']) || resolved.pref;
    const city = clean(t.city || t.municipality || t['市区町村']) || resolved.city;
    const town = clean(t.town || t['町域'] || t['町名']) || resolved.town || '';
    const cityLabel = pref === '未設定' ? city : pref + city;
    const townLabel = town ? cityLabel + town : cityLabel;
    return { ...base, pref: pref || '未設定', city: city || '未設定', town, area: cityLabel || '未設定', townLabel: townLabel || cityLabel || '未設定', zipStatus: resolved.zipStatus || 'UNKNOWN' };
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
      if (!key) { noSlip.push({ ...t, slip:`__no_slip_${idx}` }); return; }
      if (!bySlip.has(key)) bySlip.set(key, { ...t });
      else {
        const base = bySlip.get(key);
        base.amount += num(t.amount);
        if (!base.zip && t.zip) base.zip = t.zip;
        if (!base.address && t.address) base.address = t.address;
        if (base.zipStatus !== 'OK' && t.zipStatus === 'OK') {
          base.pref = t.pref; base.city = t.city; base.town = t.town; base.area = t.area; base.townLabel = t.townLabel; base.zipStatus = 'OK';
        }
      }
    });

    const uniqueTickets = [...bySlip.values(), ...noSlip];
    return {
      ...x, ym, __source: source,
      tickets: uniqueTickets,
      uniqueCount: Number(x.uniqueCount || uniqueTickets.length),
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
        if (Array.isArray(parsed)) parsed.forEach((x,idx)=>push(x, `${key}.${idx}`));
        else if (obj(parsed)) {
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

  function allYMs(){ return [...new Set(collectProductRecords().map(x=>x.ym).filter(Boolean))].sort(); }

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
      const at = arr(a.tickets).length, bt = arr(b.tickets).length;
      if (bt !== at) return bt - at;
      return String(b.__source || '').localeCompare(String(a.__source || ''));
    })[0];
  }

  async function ensureZipParts(rec){
    const zips = arr(rec?.tickets).map(t => normalizeZip(
      t.zip || t.zipcode || t.postalCode || t.postCode ||
      t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] || t['L列']
    )).filter(Boolean);

    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.loadForZips) {
      await JP_ZIP_LOADER.loadForZips(zips);
    }
  }

  function buildRows(rec, level){
    const map = new Map();
    const zipIssues = { total:0, ok:0, noZip:0, notFound:0 };

    arr(rec?.tickets).forEach(t=>{
      const nt = normalizeTicket(t);
      if (!nt) return;

      zipIssues.total += 1;
      if (nt.zipStatus === 'OK') zipIssues.ok += 1;
      else if (nt.zipStatus === 'NO_ZIP') zipIssues.noZip += 1;
      else zipIssues.notFound += 1;

      let key = nt.area || '未設定';
      let label = nt.area || '未設定';
      if (level === 'pref') {
        key = nt.pref || '未設定';
        label = key; else if (level === 'city') {
        key = nt.area || '未設定';
        label = key;
      }

      if (!map.has(key)) {
        map.set(key, { label, pref:nt.pref || '未設定', city:nt.city || '未設定', town:nt.town || '', count:0, amount:0, zipNg:0 });
      }
      const row = map.get(key);
      row.count += 1;
      row.amount += num(nt.amount);
      if (nt.zipStatus !== 'OK') row.zipNg += 1;
    });

    const rows = [...map.values()];
    rows.__zipIssues = zipIssues;
    return rows;
  }

  function totals(rows){
    return {
      count: rows.reduce((s,r)=>s + Number(r.count || 0),0),
      amount: rows.reduce((s,r)=>s + Number(r.amount || 0),0),
      issues: rows.__zipIssues || { total:0, ok:0, noZip:0, notFound:0 }
    };
  }

  function sortRows(rows, sortMode){
    const list = [...rows];
    if (sortMode === 'amount') list.sort((a,b)=>b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label,'ja'));
    else if (sortMode === 'name') list.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
    else list.sort((a,b)=>b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label,'ja'));
    return list;
  }

  function getMode(){
    return document.getElementById('field-area-view-mode')?.value || 'ranking';
  }
  function getSortMode(){
    return document.getElementById('field-area-sort-mode')?.value || 'count';
  }
  function getMetric(){
    return document.getElementById('map-metric-sel')?.value || 'count';
  }

  function controlsHtml(mode, sortMode, metric){
    return `
      <div class="fa-tabs">
        <button class="fa-tab ${mode === 'ranking' ? 'active' : ''}" data-fa-mode="ranking">市区町村</button>
        <button class="fa-tab ${mode === 'pref' ? 'active' : ''}" data-fa-mode="pref">都道府県</button>
        <button class="fa-tab ${mode === 'history' ? 'active' : ''}" data-fa-mode="history">月別推移</button>
      </div>
      <div class="fa-control-right">
        <label>並び</label>
        <select id="fa-sort-select">
          <option value="count" ${sortMode === 'count' ? 'selected' : ''}>件数順</option>
          <option value="amount" ${sortMode === 'amount' ? 'selected' : ''}>売上順</option>
          <option value="name" ${sortMode === 'name' ? 'selected' : ''}>名称順</option>
        </select>
        <label>バー</label>
        <select id="fa-metric-select">
          <option value="count" ${metric === 'count' ? 'selected' : ''}>件数</option>
          <option value="amount" ${metric === 'amount' ? 'selected' : ''}>売上</option>
        </select>
      </div>`;
  }

  function summaryHtml(ym, rows){
    const t = totals(rows);
    const top = rows[0];
    const issueCount = Number(t.issues.noZip || 0) + Number(t.issues.notFound || 0);
    return `
      <div class="fa-summary">
        <div class="fa-headline">
          <div>
            <div class="fa-title">${esc(ymText(ym))} エリア分析</div>
            <div class="fa-subtitle">件数構成と売上構成をエリア別に確認</div>
          </div>
          ${issueCount > 0 ? `<div class="fa-issue">要確認 ${fmt(issueCount)}件</div>` : ''}
        </div>
        <div class="fa-kpis">
          <div class="fa-kpi"><div>原票件数</div><strong>${fmt(t.count)}</strong><span>件</span></div>
          <div class="fa-kpi"><div>売上</div><strong>${fmtK(t.amount)}</strong><span>千円</span></div>
          <div class="fa-kpi"><div>エリア数</div><strong>${fmt(rows.length)}</strong><span>地区</span></div>
          <div class="fa-kpi wide"><div>最多エリア</div><strong>${top ? esc(top.label) : '—'}</strong><span>${top ? `${fmt(top.count)}件 / ${fmtK(top.amount)}千円` : ''}</span></div>
        </div>
      </div>`;
  }

  function barRowsHtml(rows, metric, totalCount, totalAmount){
    const key = metric === 'amount' ? 'amount' : 'count';
    if (!rows.length) return '<div class="fa-empty">データなし</div>';
    const max = Math.max(...rows.map(r=>Number(r[key] || 0)), 1);
    return rows.map((r,i)=>{
      const val = Number(r[key] || 0);
      const w = Math.max(2, Math.round(val / max * 100));
      const share = metric === 'amount' ? pct(r.amount,totalAmount) : pct(r.count,totalCount);
      return `
        <div class="fa-row">
          <div class="fa-label" title="${esc(r.label)}">
            <span class="fa-rank">${i + 1}</span>
            <span class="fa-name">${esc(r.label)}</span>
          </div>
          <div class="fa-track"><div class="fa-fill" style="width:${w}%"></div></div>
          <div class="fa-value">
            <b>${fmt(r.count)}件</b>
            <span>${fmtK(r.amount)}千円</span>
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
              <th>順位</th>
              <th>エリア</th>
              <th class="r">件数</th>
              <th class="r">件数構成比</th>
              <th class="r">売上（千円）</th>
              <th class="r">売上構成比</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr>
                <td>${i + 1}</td>
                <td>${esc(r.label)}</td>
                <td class="r">${fmt(r.count)}</td>
                <td class="r">${fmt1(pct(r.count,totalCount))}%</td>
                <td class="r">${fmtK(r.amount)}</td>
                <td class="r">${fmt1(pct(r.amount,totalAmount))}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function rankingHtml(rows, metric){
    const t = totals(rows);
    const limited = rows.slice(0,30);
    return `
      <div class="fa-body">
        <div class="fa-section-title">市区町村別ランキング TOP${limited.length}</div>
        ${barRowsHtml(limited, metric, t.count, t.amount)}
        ${tableHtml(limited, t.count, t.amount)}
      </div>`;
  }

  function prefHtml(rows, metric, sortMode){
    const t = totals(rows);
    const limited = rows.slice(0,47);
    return `
      <div class="fa-body">
        <div class="fa-section-title">都道府県別構成</div>
        ${barRowsHtml(limited, metric, t.count, t.amount)}
        ${tableHtml(limited, t.count, t.amount)}
      </div>`;
  }

  function historyHtml(records, currentYM){
    const byYM = records.map(rec=>{
      const rows = buildRows(rec, 'city');
      const t = totals(rows);
      return { ym:rec.ym, count:t.count, amount:t.amount, top: rows.sort((a,b)=>b.count-a.count)[0] };
    }).sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

    const maxCount = Math.max(...byYM.map(x=>x.count), 1);
    const maxAmount = Math.max(...byYM.map(x=>x.amount), 1);

    return `
      <div class="fa-body">
        <div class="fa-section-title">月別推移</div>
        <div class="fa-history">
          ${byYM.map(x=>{
            const active = x.ym === currentYM ? ' active' : '';
            return `
              <div class="fa-month${active}">
                <div class="fa-month-head">
                  <b>${esc(ymShort(x.ym))}</b>
                  <span>${fmt(x.count)}件 / ${fmtK(x.amount)}千円</span>
                </div>
                <div class="fa-mini">
                  <div><span style="width:${Math.max(2, Math.round(x.count / maxCount * 100))}%"></span></div>
                  <div><span style="width:${Math.max(2, Math.round(x.amount / maxAmount * 100))}%"></span></div>
                </div>
                <small>最多：${x.top ? esc(x.top.label) : '—'}</small>
              </div>`;
          }).join('')}
        </div>
        <div class="fa-history-note">上段バー：件数 / 下段バー：売上</div>
      </div>`;
  }

  async function render(){
    if (rendering) return;
    rendering = true;
    const box = document.getElementById('field-map');
    const no = document.getElementById('map-no-data');
    const debug = document.getElementById('map-debug-info');
    if (!box) { rendering = false; return; }

    ensureStyle();

    try {
      const ym = selectedYM();
      const rec = getRecordForYM(ym);

      if (!rec || !arr(rec.tickets).length) {
        box.innerHTML = '<div class="fa-empty">商品・住所CSVを読み込んでください</div>';
        if (no) no.style.display = 'none';
        if (debug) debug.style.display = 'none';
        return;
      }

      box.innerHTML = '<div class="fa-empty">エリア分析を読み込み中...</div>';
      await ensureZipParts(rec);

      const mode = getMode();
      const sortMode = getSortMode();
      const metric = getMetric();
      const level = mode === 'pref' ? 'pref' : 'city';

      let rows = buildRows(rec, level);
      rows = sortRows(rows, sortMode);

      if (!rows.length) {
        box.innerHTML = '<div class="fa-empty">住所・エリアを判定できるデータがありません</div>';
        if (no) no.style.display = 'none';
        if (debug) {
          debug.style.display = 'block';
          debug.textContent = `${ymText(ym)} の商品・住所CSVはありますが、住所列または郵便番号列を確認できません。`;
        }
        return;
      }

      box.innerHTML = `
        ${summaryHtml(ym, rows)}
        <div class="fa-toolbar">${controlsHtml(mode, sortMode, metric)}</div>
      `;

      if (mode === 'history') {
        const records = collectProductRecords();
        box.insertAdjacentHTML('beforeend', historyHtml(records, ym));
      } else if (mode === 'pref') {
        box.insertAdjacentHTML('beforeend', prefHtml(rows, metric, sortMode));
      } else {
        box.insertAdjacentHTML('beforeend', rankingHtml(rows, metric));
      }

      bindInlineControls();

      if (no) no.style.display = 'none';
      if (debug) {
        debug.style.display = 'none';
        debug.textContent = '';
      }
    } catch(e) {
      box.innerHTML = `<div class="fa-empty">エリア分析の表示でエラー：${esc(e.message || e)}</div>`;
      console.error(e);
    } finally {
      rendering = false;
    }
  }

  function bindInlineControls(){
    document.querySelectorAll('[data-fa-mode]').forEach(btn=>{
      if (btn.__faBound) return;
      btn.__faBound = true;
      btn.addEventListener('click', ()=>{
        const sel = document.getElementById('field-area-view-mode');
        if (sel) sel.value = btn.dataset.faMode;
        render();
      });
    });

    const sort = document.getElementById('fa-sort-select');
    if (sort && !sort.__faBound) {
      sort.__faBound = true;
      sort.addEventListener('change', ()=>{
        const base = document.getElementById('field-area-sort-mode');
        if (base) base.value = sort.value;
        render();
      });
    }

    const metric = document.getElementById('fa-metric-select');
    if (metric && !metric.__faBound) {
      metric.__faBound = true;
      metric.addEventListener('change', ()=>{
        const base = document.getElementById('map-metric-sel');
        if (base) base.value = metric.value;
        render();
      });
    }
  }

  function ensureStyle(){
    if (document.getElementById('field-area-pro-style')) return;
    const style = document.createElement('style');
    style.id = 'field-area-pro-style';
    style.textContent = `
      #field-map{height:auto!important;min-height:260px;border-radius:18px!important;border:1px solid #e5e7eb;overflow:hidden;background:#fff}
      #field-map .fa-summary{padding:18px 20px 16px;border-bottom:1px solid #e5e7eb;background:linear-gradient(180deg,#ffffff,#f8fafc)}
      #field-map .fa-headline{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
      #field-map .fa-title{font-size:20px;font-weight:950;color:#0f172a;letter-spacing:.01em}
      #field-map .fa-subtitle{font-size:12px;color:#64748b;margin-top:5px;font-weight:800}
      #field-map .fa-issue{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:950;white-space:nowrap}
      #field-map .fa-kpis{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr)) minmax(220px,1.4fr);gap:10px}
      #field-map .fa-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:13px 14px;box-shadow:0 8px 22px rgba(15,23,42,.05);min-width:0}
      #field-map .fa-kpi div{font-size:11px;color:#64748b;font-weight:900;margin-bottom:6px}
      #field-map .fa-kpi strong{display:block;font-size:22px;color:#0f172a;font-weight:950;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #field-map .fa-kpi span{display:block;font-size:11px;color:#64748b;font-weight:800;margin-top:4px}
      #field-map .fa-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid #e5e7eb;background:#fff}
      #field-map .fa-tabs{display:flex;gap:8px;flex-wrap:wrap}
      #field-map .fa-tab{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:950;cursor:pointer}
      #field-map .fa-tab.active{background:#1d4ed8;border-color:#1d4ed8;color:#fff;box-shadow:0 8px 18px rgba(37,99,235,.22)}
      #field-map .fa-control-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #field-map .fa-control-right label{font-size:12px;color:#64748b;font-weight:950}
      #field-map .fa-control-right select{border:1px solid #cbd5e1;border-radius:12px;padding:8px 28px 8px 10px;font-weight:900;color:#0f172a;background:#fff}
      #field-map .fa-body{padding:18px 20px}
      #field-map .fa-section-title{font-size:16px;font-weight:950;color:#0f172a;margin:0 0 14px;border-left:4px solid #2563eb;padding-left:10px}
      #field-map .fa-row{display:grid;grid-template-columns:minmax(220px,360px) minmax(280px,1fr) minmax(210px,260px);gap:18px;margin:12px 0;align-items:center}
      #field-map .fa-label{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:950;color:#0f172a;min-width:0}
      #field-map .fa-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa-rank{width:26px;height:26px;border-radius:999px;background:#eaf3ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:950;flex:0 0 auto}
      #field-map .fa-track{height:24px;background:#e2e8f0;border-radius:999px;overflow:hidden}
      #field-map .fa-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#174f7f,#2563eb)}
      #field-map .fa-value{font-size:14px;color:#0f172a;text-align:right;white-space:nowrap}
      #field-map .fa-value b{font-weight:950;margin-right:10px}
      #field-map .fa-value span{color:#64748b;font-weight:850;margin-right:10px}
      #field-map .fa-value em{font-style:normal;color:#1d4ed8;font-weight:950}
      #field-map .fa-table-wrap{margin-top:20px;max-height:460px;overflow:auto;border:1px solid #e5e7eb;border-radius:16px}
      #field-map .fa-table{margin:0;min-width:760px}
      #field-map .fa-table th{font-size:12px;color:#334155;background:#f8fafc}
      #field-map .fa-table td{font-size:13px}
      #field-map .fa-history{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
      #field-map .fa-month{border:1px solid #e2e8f0;border-radius:16px;padding:13px;background:#fff;box-shadow:0 8px 20px rgba(15,23,42,.05)}
      #field-map .fa-month.active{border-color:#2563eb;box-shadow:0 10px 24px rgba(37,99,235,.12)}
      #field-map .fa-month-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
      #field-map .fa-month-head b{font-size:15px;color:#0f172a}
      #field-map .fa-month-head span{font-size:12px;color:#64748b;font-weight:900}
      #field-map .fa-mini{display:grid;gap:6px;margin:10px 0}
      #field-map .fa-mini div{height:9px;background:#e2e8f0;border-radius:999px;overflow:hidden}
      #field-map .fa-mini span{display:block;height:100%;background:linear-gradient(90deg,#174f7f,#2563eb);border-radius:999px}
      #field-map .fa-month small{color:#64748b;font-weight:850}
      #field-map .fa-history-note{font-size:12px;color:#64748b;font-weight:850;margin-top:10px}
      #field-map .fa-empty{padding:46px;text-align:center;color:#64748b;font-weight:900}
      @media (max-width:900px){
        #field-map .fa-kpis{grid-template-columns:repeat(2,minmax(130px,1fr))}
        #field-map .fa-toolbar{align-items:flex-start;flex-direction:column}
        #field-map .fa-row{grid-template-columns:1fr;gap:7px;border-bottom:1px solid #eef2f7;padding-bottom:11px}
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
      const hasOwnUi = !!box.querySelector('.fa-summary, .fa-empty');
      if (!hasOwnUi) render();
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
