/* field_area.js : エリア分析 市区町村固定・実務UI版
   2026-05-03 修正版
   目的：
   - field_core.js の旧 renderMap 表示を上書きし、エリア分析を市区町村単位に固定
   - 郵便番号マスタを最優先し、町域・番地は集計に使わない
   - 上部の表示形式プルダウンは非表示にし、画面内トグルに統一
   - 年度・月は field_core.js の「表示対象」と連動
*/
'use strict';

(function(){
  const FLAG = '__FIELD_AREA_CITY_FIXED_V3_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  let rendering = false;
  let selectedFY = '';
  let selectedYMState = '';
  let guardTimer = null;
  let observer = null;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function clean(v){ return String(v ?? '').normalize('NFKC').trim(); }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
  function yen(v){
    const s = String(v ?? '')
      .normalize('NFKC')
      .replace(/,/g,'')
      .replace(/[円¥\s　]/g,'')
      .replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(Number(v || 0)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(Number(v || 0) / 1000).toLocaleString('ja-JP'); }
  function fmtPct(v,total){
    if (!total) return '0.0';
    return (Number(v || 0) / Number(total || 0) * 100).toFixed(1);
  }
  function normalizeZip(v){
    if (window.JP_ZIP_LOADER && typeof JP_ZIP_LOADER.normalizeZip === 'function') {
      return JP_ZIP_LOADER.normalizeZip(v);
    }
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }
  function normYM(v){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 6 ? s.slice(0,6) : '';
  }
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function monthText(ym){
    const m = Number(String(ym || '').slice(4,6));
    return m ? `${m}月` : '—';
  }
  function fiscalFromYM(ym){
    const y = Number(String(ym || '').slice(0,4));
    const m = Number(String(ym || '').slice(4,6));
    if (!y || !m) return '';
    return String(m >= 4 ? y : y - 1);
  }
  function fiscalMonthOrder(ym){
    const m = Number(String(ym || '').slice(4,6));
    return m >= 4 ? m : m + 12;
  }
  function fiscalYears(yms){
    return [...new Set((yms || []).map(fiscalFromYM).filter(Boolean))].sort().reverse();
  }
  function monthsForFY(yms, fy){
    return (yms || []).filter(ym => fiscalFromYM(ym) === String(fy)).sort((a,b)=>fiscalMonthOrder(a)-fiscalMonthOrder(b));
  }
  function fiscalFromYM(ym){
    const y = Number(String(ym || '').slice(0,4));
    const m = Number(String(ym || '').slice(4,6));
    if (!y || !m) return '';
    return String(m >= 4 ? y : y - 1);
  }
  function fiscalMonthOrder(ym){
    const m = Number(String(ym || '').slice(4,6));
    return m >= 4 ? m : m + 12;
  }
  function active(){
    const view = document.getElementById('view-field-area');
    if (!view) return false;
    return view.classList.contains('active') || (window.STATE && STATE.view === 'field-area');
  }

  function rawAt(row, idx){
    return Array.isArray(row) ? clean(row[idx]) : '';
  }
  function ticketZip(t){
    return normalizeZip(
      t?.zip || t?.zipcode || t?.postCode || t?.postalCode ||
      t?.['お届け先郵便番号'] || t?.['届け先郵便番号'] || t?.['郵便番号'] || t?.['L列']
    );
  }
  function ticketAddress(t){
    // 個人情報保護：住所全文は保存・参照しない。過去互換のため関数は残すが空にする。
    return '';
  }
  function ticketSlip(t, idx){
    return clean(t?.slip || t?.slipNo || t?.ticketNo || t?.invoiceNo || t?.['エスライン原票番号'] || t?.['原票番号']) || `__no_slip_${idx}`;
  }
  function ticketAmount(t){
    return yen(t?.amount || t?.sales || t?.value || t?.['金額'] || t?.['売上']);
  }

  function splitAddressToCity(address){
    const t = clean(address).replace(/\s+/g,'');
    if (!t) return { pref:'未設定', city:'未設定', status:'NO_ADDRESS' };

    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '未設定';
    const rest = prefMatch ? t.slice(pref.length) : t;

    const known = [
      'さいたま市西区','さいたま市北区','さいたま市大宮区','さいたま市見沼区','さいたま市中央区',
      'さいたま市桜区','さいたま市浦和区','さいたま市南区','さいたま市緑区','さいたま市岩槻区',
      '蕨市','戸田市','川口市','朝霞市','和光市','志木市','新座市','富士見市','ふじみ野市',
      '川越市','所沢市','狭山市','上尾市','桶川市','北本市','鴻巣市','入間市','草加市','越谷市',
      '板橋区','北区','豊島区','練馬区','文京区','足立区','荒川区','台東区','江東区','大田区',
      '世田谷区','新宿区','港区','墨田区','品川区'
    ];
    for (const name of known) {
      if (rest.startsWith(name)) return { pref, city:name, status:'FALLBACK' };
    }

    // 「蕨中央5-」のように市が欠けた住所への最低限補正
    if (pref === '埼玉県' && /^蕨/.test(rest)) return { pref, city:'蕨市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^戸田/.test(rest)) return { pref, city:'戸田市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^川口/.test(rest)) return { pref, city:'川口市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^朝霞/.test(rest)) return { pref, city:'朝霞市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^和光/.test(rest)) return { pref, city:'和光市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^志木/.test(rest)) return { pref, city:'志木市', status:'FALLBACK' };
    if (pref === '埼玉県' && /^新座/.test(rest)) return { pref, city:'新座市', status:'FALLBACK' };

    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return { pref, city:wardCity[1], status:'FALLBACK' };

    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return { pref, city:muni[1], status:'FALLBACK' };

    return { pref, city:'未設定', status:'FALLBACK' };
  }

  function areaFromZip(zip){
    const z = normalizeZip(zip);
    if (!z) return null;

    let hit = null;
    if (window.JP_ZIP_LOADER && typeof JP_ZIP_LOADER.get === 'function') {
      hit = JP_ZIP_LOADER.get(z);
    } else if (window.JP_ZIP_MASTER && typeof JP_ZIP_MASTER === 'object') {
      hit = JP_ZIP_MASTER[z];
    }

    if (!hit) return null;

    if (Array.isArray(hit)) {
      return {
        pref: clean(hit[0]) || '未設定',
        city: clean(hit[1]) || '未設定',
        status:'OK'
      };
    }

    if (obj(hit)) {
      return {
        pref: clean(hit.pref || hit.prefecture || hit[0]) || '未設定',
        city: clean(hit.city || hit.municipality || hit.addr1 || hit[1]) || '未設定',
        status:'OK'
      };
    }

    const p = splitAddressToCity(String(hit));
    return { pref:p.pref, city:p.city, status:'OK' };
  }

  function resolveTicket(t, idx){
    const zip = ticketZip(t);

    // 個人情報保護：住所全文やraw行は見ない。郵便番号マスタ→保存済みpref/city/areaの順で解決する。
    let area = areaFromZip(zip);
    if (!area && t?.pref && t?.city) area = { pref: clean(t.pref), city: clean(t.city), status:'SAVED' };
    if (!area && t?.area) {
      const p = splitAddressToCity(String(t.area));
      area = { pref:p.pref, city:p.city, status:'SAVED' };
    }
    if (!area) area = { pref:'未設定', city:'未設定', status: zip ? 'ZIP_NOT_FOUND' : 'NO_AREA' };

    const pref = area.pref || '未設定';
    const city = area.city || '未設定';
    const label = pref === '未設定' ? city : pref + city;

    return {
      slip: ticketSlip(t, idx),
      zip,
      pref,
      city,
      label: label || '未設定',
      amount: ticketAmount(t),
      status: area.status || 'UNKNOWN'
    };
  }

  function normalizeRecordTickets(x){
    if (!x || typeof x !== 'object') return [];
    if (Array.isArray(x.tickets)) return x.tickets.filter(Boolean);
    if (x.tickets && typeof x.tickets === 'object') return Object.values(x.tickets).filter(Boolean);
    return [];
  }

  function localStorageRecords(){
    // v29: 表示時のlocalStorage全探索は重く、別センター混入・削除済み復活の原因になるため廃止。
    return [];
  }

  function rawRecords(){
    const out = [];

    function pushRecord(x, source){
      if (!obj(x)) return;
      const ym = normYM(x.ym || x.YM || x.month || x.targetYM || x.date || x.name || source);
      // 個人情報保護：保存済みの安全化済み tickets だけを使う。rows/data/rawRows は参照しない。
      const tickets = normalizeRecordTickets(x);
      const has = tickets.length || Number(x.uniqueCount || 0) > 0 || Number(x.detailRows || 0) > 0;
      if (!ym || !has) return;
      out.push({ ...x, ym, tickets, __source:source });
    }

    // field_core.js の統一アクセサを最優先する。
    // これにより、年度プルダウンが出ない・別センターのデータを拾う・削除済みが復活する問題を防ぐ。
    if (window.FIELD_DATA_ACCESS) {
      FIELD_DATA_ACCESS.getProductRecords().forEach((x,i)=>pushRecord(x, `FIELD_DATA_ACCESS.product.${i}`));
      if (out.length) return out;
    }

    if (window.STATE) {
      arr(STATE.productAddressData).forEach((x,i)=>pushRecord(x, `STATE.productAddressData.${i}`));
      arr(STATE.fieldData).forEach((x,i)=>pushRecord(x, `STATE.fieldData.${i}`));
    }
    const seen = new Set();
    return out.filter(r=>{
      const sig = `${r.ym}:${r.tickets.length}:${r.amount || ''}:${r.uniqueCount || ''}:${r.__source}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    }).sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }

  function allYMs(){
    return [...new Set(rawRecords().map(r=>r.ym).filter(Boolean))].sort();
  }

  function selectedYM(){
    const yms = allYMs();
    if (!yms.length) return '';

    const common = document.getElementById('field-common-month-select');
    const commonYM = normYM(common?.value);
    if (!selectedYMState && commonYM && yms.includes(commonYM)) {
      selectedYMState = commonYM;
      selectedFY = fiscalFromYM(commonYM);
    }

    if (!selectedYMState) {
      const stateYM = normYM(window.STATE?.selYM);
      if (stateYM && yms.includes(stateYM)) {
        selectedYMState = stateYM;
        selectedFY = fiscalFromYM(stateYM);
      }
    }

    if (!selectedYMState || !yms.includes(selectedYMState)) {
      selectedYMState = yms[yms.length - 1] || '';
      selectedFY = fiscalFromYM(selectedYMState);
    }

    const years = fiscalYears(yms);
    if (!selectedFY || !years.includes(String(selectedFY))) {
      selectedFY = fiscalFromYM(selectedYMState) || years[0] || '';
    }

    const months = monthsForFY(yms, selectedFY);
    if (months.length && !months.includes(selectedYMState)) {
      selectedYMState = months[months.length - 1];
    }

    return selectedYMState;
  }

  function selectedRecord(ym){
    const list = rawRecords().filter(r=>r.ym === ym);
    if (!list.length) return null;
    return list.sort((a,b)=>arr(b.tickets).length - arr(a.tickets).length)[0];
  }

  async function ensureZipParts(record){
    const zips = arr(record?.tickets).map(ticketZip).filter(Boolean);
    if (window.JP_ZIP_LOADER && typeof JP_ZIP_LOADER.loadForZips === 'function') {
      await JP_ZIP_LOADER.loadForZips(zips);
    }
  }

  function uniqueTickets(record){
    const map = new Map();
    arr(record?.tickets).forEach((t,idx)=>{
      const r = resolveTicket(t, idx);
      const key = r.slip || `__${idx}`;
      if (!map.has(key)) map.set(key, r);
      else {
        const base = map.get(key);
        base.amount += r.amount;
        if (base.status !== 'OK' && r.status === 'OK') {
          base.zip = r.zip;
          base.pref = r.pref;
          base.city = r.city;
          base.label = r.label;
          base.status = 'OK';
        }
      }
    });
    return [...map.values()];
  }

  function buildRows(record, level){
    const tickets = uniqueTickets(record);
    const rows = new Map();
    const issues = { total:0, ok:0, ng:0 };

    tickets.forEach(t=>{
      issues.total++;
      if (t.status === 'OK') issues.ok++;
      else issues.ng++;

      const label = level === 'pref' ? (t.pref || '未設定') : (t.label || '未設定');
      if (!rows.has(label)) {
        rows.set(label, {
          label,
          count:0,
          amount:0,
          issue:0
        });
      }

      const r = rows.get(label);
      r.count += 1;
      r.amount += Number(t.amount || 0);
      if (t.status !== 'OK') r.issue += 1;
    });

    const list = [...rows.values()];
    list.__issues = issues;
    return list;
  }

  function sortRows(rows, mode){
    const list = [...rows];
    if (mode === 'amount') {
      list.sort((a,b)=>b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label,'ja'));
    } else if (mode === 'name') {
      list.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
    } else {
      list.sort((a,b)=>b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label,'ja'));
    }
    list.__issues = rows.__issues;
    return list;
  }

  function totals(rows){
    return {
      count: rows.reduce((s,r)=>s + Number(r.count || 0),0),
      amount: rows.reduce((s,r)=>s + Number(r.amount || 0),0),
      issues: rows.__issues || { total:0, ok:0, ng:0 }
    };
  }

  function getMode(){
    const v = document.getElementById('field-area-view-mode')?.value;
    if (v === 'pref' || v === 'history') return v;
    return 'overall';
  }
  function setMode(v){
    const sel = document.getElementById('field-area-view-mode');
    if (sel) {
      if (![...sel.options].some(o=>o.value === v)) {
        const op = document.createElement('option');
        op.value = v;
        op.textContent = v;
        sel.appendChild(op);
      }
      sel.value = v;
    }
  }
  function getSortMode(){
    return document.getElementById('field-area-sort-mode')?.value || 'count';
  }
  function setSortMode(v){
    const sel = document.getElementById('field-area-sort-mode');
    if (sel) sel.value = v;
  }
  function getMetric(){
    return document.getElementById('map-metric-sel')?.value || 'count';
  }
  function setMetric(v){
    const sel = document.getElementById('map-metric-sel');
    if (sel) sel.value = v;
  }


  function selectorHtml(ym){
    const yms = allYMs();
    const years = fiscalYears(yms);
    const fy = fiscalFromYM(ym) || selectedFY || years[0] || '';
    const months = monthsForFY(yms, fy);

    return `
      <div class="fa3-selector">
        <div>
          <strong>表示対象</strong>
          <span>年度順：4月 → 翌年3月 ／ 年度・月を共通管理</span>
        </div>
        <div class="fa3-selector-controls">
          <label>対象年度
            <select id="fa3-fy-select">
              ${years.map(y=>`<option value="${esc(y)}" ${String(y)===String(fy)?'selected':''}>${esc(y)}年度</option>`).join('')}
            </select>
          </label>
          <label>対象月
            <select id="fa3-ym-select">
              ${months.map(m=>`<option value="${esc(m)}" ${String(m)===String(ym)?'selected':''}>${esc(ymText(m))}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>`;
  }

  function cardHtml(ym, rows){
    const t = totals(rows);
    const top = rows[0];
    return `
      <div class="fa3-summary">
        <div class="fa3-title-row">
          <div>
            <div class="fa3-title">${esc(ymText(ym))} エリア分析</div>
            <div class="fa3-sub">市区町村単位で件数構成・売上構成を確認</div>
          </div>
          ${t.issues.ng ? `<div class="fa3-warn">要確認 ${fmt(t.issues.ng)}件</div>` : ''}
        </div>
        <div class="fa3-kpis">
          <div class="fa3-kpi"><span>原票件数</span><b>${fmt(t.count)}件</b></div>
          <div class="fa3-kpi"><span>売上</span><b>${fmtK(t.amount)}千円</b></div>
          <div class="fa3-kpi"><span>エリア数</span><b>${fmt(rows.length)}地区</b></div>
          <div class="fa3-kpi wide"><span>最多エリア</span><b>${top ? esc(top.label) : '—'}</b><em>${top ? `${fmt(top.count)}件 / ${fmtK(top.amount)}千円` : ''}</em></div>
        </div>
      </div>`;
  }

  function toolbarHtml(mode, sortMode, metric){
    return `
      <div class="fa3-toolbar">
        <div class="fa3-tabs">
          <button type="button" class="${mode === 'overall' ? 'active' : ''}" data-fa3-mode="overall">市区町村</button>
          <button type="button" class="${mode === 'pref' ? 'active' : ''}" data-fa3-mode="pref">都道府県</button>
          <button type="button" class="${mode === 'history' ? 'active' : ''}" data-fa3-mode="history">月別推移</button>
        </div>
        <div class="fa3-tools">
          <label>並び
            <select id="fa3-sort">
              <option value="count" ${sortMode === 'count' ? 'selected' : ''}>件数順</option>
              <option value="amount" ${sortMode === 'amount' ? 'selected' : ''}>売上順</option>
              <option value="name" ${sortMode === 'name' ? 'selected' : ''}>名称順</option>
            </select>
          </label>
          <label>バー
            <select id="fa3-metric">
              <option value="count" ${metric === 'count' ? 'selected' : ''}>件数</option>
              <option value="amount" ${metric === 'amount' ? 'selected' : ''}>売上</option>
            </select>
          </label>
        </div>
      </div>`;
  }

  function barsHtml(rows, metric){
    const t = totals(rows);
    const key = metric === 'amount' ? 'amount' : 'count';
    const max = Math.max(...rows.map(r=>Number(r[key] || 0)), 1);
    const base = metric === 'amount' ? t.amount : t.count;

    return rows.slice(0,30).map((r,i)=>{
      const val = Number(r[key] || 0);
      const w = Math.max(2, Math.round(val / max * 100));
      return `
        <div class="fa3-row">
          <div class="fa3-name"><i>${i + 1}</i><span title="${esc(r.label)}">${esc(r.label)}</span></div>
          <div class="fa3-track"><div style="width:${w}%"></div></div>
          <div class="fa3-val"><b>${fmt(r.count)}件</b><span>${fmtK(r.amount)}千円</span><em>${fmtPct(val, base)}%</em></div>
        </div>`;
    }).join('');
  }

  function tableHtml(rows){
    const t = totals(rows);
    return `
      <div class="fa3-table-wrap">
        <table class="fa3-table">
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
            ${rows.slice(0,30).map((r,i)=>`
              <tr>
                <td>${i + 1}</td>
                <td>${esc(r.label)}</td>
                <td class="r">${fmt(r.count)}</td>
                <td class="r">${fmtPct(r.count, t.count)}%</td>
                <td class="r">${fmtK(r.amount)}</td>
                <td class="r">${fmtPct(r.amount, t.amount)}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }



  function normalizeAreaCardLabel(label){
    const s = String(label || '').replace(/\s+/g,'');

    if (!s || s === '未設定') return 'その他|未分類';

    const tokyoWard = s.match(/東京都(.+?区)/);
    if (tokyoWard) return `東京都${tokyoWard[1]}|${tokyoWard[1]}方面`;

    const saitamaWard = s.match(/埼玉県さいたま市(.+?区)/);
    if (saitamaWard) return `さいたま市${saitamaWard[1]}|さいたま市${saitamaWard[1]}方面`;

    const prefCity = s.match(/^(埼玉県|東京都|群馬県|栃木県|茨城県|千葉県|神奈川県)(.+?市)/);
    if (prefCity) return `${prefCity[2]}|${prefCity[2]}方面`;

    const prefTown = s.match(/^(埼玉県|東京都|群馬県|栃木県|茨城県|千葉県|神奈川県)(.+?[町村])/);
    if (prefTown) return `${prefTown[2]}|${prefTown[2]}方面`;

    if (/千葉県|神奈川県/.test(s)) return 'その他|千葉・神奈川ほか';
    if (/群馬県/.test(s)) return '群馬その他|群馬方面';
    if (/栃木県/.test(s)) return '栃木その他|栃木方面';
    if (/茨城県/.test(s)) return '茨城その他|茨城方面';

    return `${s}|${s}方面`;
  }

  function areaGroupOf(label){
    return normalizeAreaCardLabel(label);
  }

  function groupRowsFromCityRows(cityRows){
    const m = new Map();

    (cityRows || []).forEach(r=>{
      const raw = areaGroupOf(r.label);
      const [name, sub] = raw.split('|');

      if (!m.has(name)) {
        m.set(name, {
          label:name,
          sub:sub || '',
          count:0,
          amount:0,
          children:[]
        });
      }

      const x = m.get(name);
      x.count += Number(r.count || 0);
      x.amount += Number(r.amount || 0);
      x.children.push(r);
    });

    return [...m.values()].map(g=>{
      g.children = (g.children || []).sort((a,b)=>b.count-a.count || b.amount-a.amount || a.label.localeCompare(b.label,'ja'));
      return g;
    }).sort((a,b)=>b.count-a.count || b.amount-a.amount || a.label.localeCompare(b.label,'ja'));
  }

  function heatLevel(value, max){
    if (!max) return 'lv1';
    const r = value / max;
    if (r >= .75) return 'lv5';
    if (r >= .50) return 'lv4';
    if (r >= .25) return 'lv3';
    if (r >= .10) return 'lv2';
    return 'lv1';
  }

  function areaDistributionHtml(cityRows, metric){
    const groupsRaw = groupRowsFromCityRows(cityRows);
    if (!groupsRaw.length) return '';

    const key = metric === 'amount' ? 'amount' : 'count';
    const totalCount = cityRows.reduce((s,r)=>s+Number(r.count||0),0);
    const totalAmount = cityRows.reduce((s,r)=>s+Number(r.amount||0),0);

    const sorted = groupsRaw.slice().sort((a,b)=>Number(b[key]||0)-Number(a[key]||0) || b.count-a.count || a.label.localeCompare(b.label,'ja'));
    const main = sorted.slice(0, 11);
    const rest = sorted.slice(11);

    if (rest.length) {
      main.push({
        label:'その他',
        sub:'少数エリアまとめ',
        count:rest.reduce((s,g)=>s+Number(g.count||0),0),
        amount:rest.reduce((s,g)=>s+Number(g.amount||0),0),
        children:rest.flatMap(g=>g.children || []).sort((a,b)=>b.count-a.count || b.amount-a.amount || a.label.localeCompare(b.label,'ja'))
      });
    }

    const max = Math.max(...main.map(g=>Number(g[key] || 0)), 1);

    return `
      <div class="fa3-map-block">
        <div class="fa3-map-head">
          <div>
            <div class="fa3-section map">主要市区町村分布</div>
            <p>郵便番号から市区町村・区単位で自動分類します。新しい住所も原則自動でカード化し、少数はその他に集約します。</p>
          </div>
          <div class="fa3-map-legend"><span></span><em>少</em><i></i><i></i><i></i><i></i><em>多</em></div>
        </div>

        <div class="fa3-map-grid city-auto">
          ${main.map(g=>{
            const val = Number(g[key] || 0);
            const lv = heatLevel(val, max);
            const share = metric === 'amount' ? fmtPct(g.amount,totalAmount) : fmtPct(g.count,totalCount);
            const top = (g.children || [])[0];

            return `
              <details class="fa3-map-cell ${lv}">
                <summary>
                  <strong>${esc(g.label)}</strong>
                  <small class="fa3-map-sub">${esc(g.sub || g.label + '方面')}</small>
                  <b>${fmt(g.count)}件</b>
                  <span>${fmtK(g.amount)}千円 / ${share}%</span>
                  <small>${top ? '最多：' + esc(top.label) : '—'}</small>
                </summary>
                <div class="fa3-map-drill">
                  ${(g.children || []).slice(0,10).map((c,i)=>`
                    <div class="fa3-map-drill-row">
                      <i>${i + 1}</i>
                      <em title="${esc(c.label)}">${esc(c.label)}</em>
                      <b>${fmt(c.count)}件</b>
                      <span>${fmtK(c.amount)}千円</span>
                    </div>
                  `).join('') || '<div class="fa3-map-drill-empty">該当データなし</div>'}
                </div>
              </details>`;
          }).join('')}
        </div>
      </div>`;
  }

  function topAreaTrendHtml(records, currentYM, metric){
    const current = records.find(r=>r.ym === currentYM) || records[records.length - 1];
    if (!current) return '';
    const currentRows = sortRows(buildRows(current, 'city'), 'count').slice(0,5);
    if (!currentRows.length) return '';

    const labels = currentRows.map(r=>r.label);
    const rows = records.slice().sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
    const key = metric === 'amount' ? 'amount' : 'count';

    let max = 1;
    const series = labels.map(label=>{
      const values = rows.map(rec=>{
        const cityRows = buildRows(rec, 'city');
        const hit = cityRows.find(r=>r.label === label);
        const v = hit ? Number(hit[key] || 0) : 0;
        max = Math.max(max, v);
        return { ym:rec.ym, value:v };
      });
      return { label, values };
    });

    return `
      <div class="fa3-trend-block">
        <div class="fa3-section trend">主要エリア推移 TOP5</div>
        <div class="fa3-trend-list">
          ${series.map(s=>`
            <div class="fa3-trend-row">
              <div class="fa3-trend-name">${esc(s.label)}</div>
              <div class="fa3-sparks">
                ${s.values.map(v=>`
                  <div class="fa3-spark" title="${esc(ymText(v.ym))}：${fmt(v.value)}">
                    <i style="height:${Math.max(4, Math.round(v.value / max * 58))}px"></i>
                    <span>${esc(monthText(v.ym))}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function prefDetailHtml(record, metric, sortMode){
    const prefRows = sortRows(buildRows(record, 'pref'), sortMode);
    const cityRows = sortRows(buildRows(record, 'city'), sortMode);
    const total = totals(cityRows);
    const key = metric === 'amount' ? 'amount' : 'count';
    const maxPref = Math.max(...prefRows.map(r=>Number(r[key] || 0)), 1);

    return `
      <div class="fa3-pref-detail">
        <div class="fa3-pref-title">都道府県別 詳細</div>
        ${prefRows.map((p)=>{
          const cities = cityRows
            .filter(c => c.label && (c.label.startsWith(p.label) || p.label === '未設定'))
            .slice(0,20);

          const w = Math.max(2, Math.round(Number(p[key] || 0) / maxPref * 100));
          const share = metric === 'amount' ? fmtPct(p.amount,total.amount) : fmtPct(p.count,total.count);

          return `
            <details class="fa3-pref-card">
              <summary>
                <div class="fa3-pref-main">
                  <span>${esc(p.label)}</span>
                  <small>${fmt(p.count)}件 / ${fmtK(p.amount)}千円 / ${share}%</small>
                </div>
                <div class="fa3-pref-bar"><i style="width:${w}%"></i></div>
              </summary>
              <div class="fa3-pref-cities">
                ${cities.map((c,i)=>`
                  <div class="fa3-pref-city">
                    <b>${i + 1}</b>
                    <span>${esc(c.label)}</span>
                    <em>${fmt(c.count)}件</em>
                    <small>${fmtK(c.amount)}千円</small>
                  </div>
                `).join('')}
              </div>
            </details>`;
        }).join('')}
      </div>`;
  }

  function rankingHtml(rows, metric, title, record, mode, sortMode){
    const records = rawRecords();
    return `
      <div class="fa3-body">
        <div class="fa3-section">${esc(title)}</div>
        ${barsHtml(rows, metric)}
        ${mode === 'overall' ? `
          <div class="fa3-two-col">
            ${areaDistributionHtml(rows, metric)}
            ${topAreaTrendHtml(records, selectedYM(), metric)}
          </div>
          ${prefDetailHtml(record, metric, sortMode)}
        ` : ''}
      </div>`;
  }

  function historyHtml(records, currentYM){
    const rows = records.map(rec=>{
      const cityRows = sortRows(buildRows(rec, 'city'), 'count');
      const t = totals(cityRows);
      return { ym:rec.ym, count:t.count, amount:t.amount, top:cityRows[0] };
    }).sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));

    const maxCount = Math.max(...rows.map(r=>r.count), 1);
    const maxAmount = Math.max(...rows.map(r=>r.amount), 1);

    return `
      <div class="fa3-body">
        <div class="fa3-section">月別推移</div>
        <div class="fa3-history">
          ${rows.map(r=>`
            <div class="fa3-month ${r.ym === currentYM ? 'active' : ''}">
              <div><b>${esc(monthText(r.ym))}</b><span>${fmt(r.count)}件 / ${fmtK(r.amount)}千円</span></div>
              <p><i style="width:${Math.max(2, Math.round(r.count / maxCount * 100))}%"></i></p>
              <p><i style="width:${Math.max(2, Math.round(r.amount / maxAmount * 100))}%"></i></p>
              <small>最多：${r.top ? esc(r.top.label) : '—'}</small>
            </div>`).join('')}
        </div>
        <div class="fa3-note">上段バー：件数 / 下段バー：売上</div>
      </div>`;
  }

  async function render(){
    const box = document.getElementById('field-map');
    if (!box || rendering) return;

    rendering = true;
    ensureStyle();

    try {
      const ym = selectedYM();
      const record = selectedRecord(ym);

      if (!record) {
        box.innerHTML = '<div class="fa3-empty">商品・住所CSVを読み込んでください</div>';
        return;
      }

      await ensureZipParts(record);

      const mode = getMode();
      const sortMode = getSortMode();
      const metric = getMetric();
      const level = mode === 'pref' ? 'pref' : 'city';

      let rows = sortRows(buildRows(record, level), sortMode);

      box.innerHTML = `
        <div class="fa-area-v3">
          ${selectorHtml(ym)}
          ${cardHtml(ym, rows)}
          ${toolbarHtml(mode, sortMode, metric)}
          ${mode === 'history'
            ? historyHtml(rawRecords(), ym)
            : rankingHtml(rows, metric, mode === 'pref' ? '都道府県別構成' : '市区町村別ランキング', record, mode, sortMode)}
        </div>`;

      bindControls();

      const no = document.getElementById('map-no-data');
      if (no) no.style.display = 'none';
      const debug = document.getElementById('map-debug-info');
      if (debug) {
        debug.style.display = 'none';
        debug.textContent = '';
      }
    } catch(e) {
      console.error(e);
      box.innerHTML = `<div class="fa3-empty">エリア分析の表示でエラー：${esc(e.message || e)}</div>`;
    } finally {
      rendering = false;
    }
  }

  function bindControls(){
    const fySel = document.getElementById('fa3-fy-select');
    const ymSel = document.getElementById('fa3-ym-select');

    if (fySel && !fySel.__fa3Bound) {
      fySel.__fa3Bound = true;
      fySel.addEventListener('change', ()=>{
        selectedFY = fySel.value;
        const months = monthsForFY(allYMs(), selectedFY);
        selectedYMState = months[months.length - 1] || '';
        const commonFy = document.getElementById('field-common-fy-select');
        if (commonFy) commonFy.value = selectedFY;
        const commonYm = document.getElementById('field-common-month-select');
        if (commonYm && selectedYMState) commonYm.value = selectedYMState;
        setTimeout(render, 0);
      });
    }

    if (ymSel && !ymSel.__fa3Bound) {
      ymSel.__fa3Bound = true;
      ymSel.addEventListener('change', ()=>{
        selectedYMState = ymSel.value;
        selectedFY = fiscalFromYM(selectedYMState);
        const commonFy = document.getElementById('field-common-fy-select');
        if (commonFy) commonFy.value = selectedFY;
        const commonYm = document.getElementById('field-common-month-select');
        if (commonYm) commonYm.value = selectedYMState;
        if (window.STATE) STATE.selYM = selectedYMState;
        setTimeout(render, 0);
      });
    }

    document.querySelectorAll('[data-fa3-mode]').forEach(btn=>{
      if (btn.__fa3Bound) return;
      btn.__fa3Bound = true;
      btn.addEventListener('click', ()=>{
        setMode(btn.dataset.fa3Mode);
        setTimeout(render, 0);
      });
    });

    const sort = document.getElementById('fa3-sort');
    if (sort && !sort.__fa3Bound) {
      sort.__fa3Bound = true;
      sort.addEventListener('change', ()=>{
        setSortMode(sort.value);
        setTimeout(render, 0);
      });
    }

    const metric = document.getElementById('fa3-metric');
    if (metric && !metric.__fa3Bound) {
      metric.__fa3Bound = true;
      metric.addEventListener('change', ()=>{
        setMetric(metric.value);
        setTimeout(render, 0);
      });
    }
  }

  function bindExternalControls(){
    ['field-common-fy-select','field-common-month-select','field-area-view-mode','field-area-sort-mode','map-metric-sel'].forEach(id=>{
      const el = document.getElementById(id);
      if (!el || el.__fa3ExternalBound) return;
      el.__fa3ExternalBound = true;
      el.addEventListener('change', ()=>setTimeout(render, 120));
    });
  }

  function install(){
    window.FIELD_AREA_UI = { render };
    window.FIELD_UI = window.FIELD_UI || {};
    window.FIELD_UI.renderMap = render;

    const modeSel = document.getElementById('field-area-view-mode');
    if (modeSel) {
      [...modeSel.options].forEach(o=>{
        if (o.value === 'overall') o.textContent = '市区町村';
        if (o.value === 'pref') o.textContent = '都道府県';
      });
      if (![...modeSel.options].some(o=>o.value === 'history')) {
        const op = document.createElement('option');
        op.value = 'history';
        op.textContent = '月別推移';
        modeSel.appendChild(op);
      }
      if (!['overall','pref','history'].includes(modeSel.value)) modeSel.value = 'overall';
    }

    bindExternalControls();
  }

  function ensureObserver(){
    const box = document.getElementById('field-map');
    if (!box || observer) return;

    observer = new MutationObserver(()=>{
      if (!active() || rendering) return;
      if (!box.querySelector('.fa-area-v3') && box.textContent.trim()) {
        setTimeout(render, 80);
      }
    });
    observer.observe(box, { childList:true, subtree:false });
  }

  function startGuard(){
    if (guardTimer) return;
    guardTimer = setInterval(()=>{
      if (!active()) return;
      install();
      ensureObserver();
      const box = document.getElementById('field-map');
      if (box && !box.querySelector('.fa-area-v3')) render();
    }, 350);
  }

  function ensureStyle(){
    if (document.getElementById('field-area-v3-style')) return;

    const st = document.createElement('style');
    st.id = 'field-area-v3-style';
    st.textContent = `
      #view-field-area #fpane-map > .card > .card-header > div:last-child{display:none!important}
      #view-field-area #fpane-map > .card > .card-header .card-title + div{display:none!important}
      #view-field-area #fpane-map > .card > .card-header{padding:16px 20px 10px!important}
      #view-field-area #fpane-map > .card > .card-header .card-title{font-size:17px!important;font-weight:950!important;color:#0f172a!important}

      #field-map{height:auto!important;min-height:260px;border:0!important;border-radius:0!important;background:#fff!important;overflow:visible!important}
      #field-map .fa-area-v3{background:#fff}
      #field-map .fa3-selector{margin:0;padding:18px 20px;border-bottom:1px solid #e5e7eb;background:linear-gradient(180deg,#f8fbff,#eef5ff);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
      #field-map .fa3-selector strong{display:block;font-size:15px;font-weight:950;color:#0f172a;margin-bottom:4px}
      #field-map .fa3-selector span{display:block;font-size:12px;color:#64748b;font-weight:850}
      #field-map .fa3-selector-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      #field-map .fa3-selector-controls label{font-size:12px;color:#334155;font-weight:950}
      #field-map .fa3-selector-controls select{margin-left:7px;border:1px solid #cbd5e1;border-radius:13px;padding:10px 34px 10px 13px;background:#fff;color:#0f172a;font-weight:900;box-shadow:0 8px 18px rgba(15,23,42,.05)}

      #field-map .fa3-summary{padding:18px 20px 16px;border-bottom:1px solid #e5e7eb;background:linear-gradient(180deg,#ffffff,#f8fafc)}
      #field-map .fa3-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
      #field-map .fa3-title{font-size:22px;font-weight:950;color:#0f172a;letter-spacing:.01em}
      #field-map .fa3-sub{font-size:12px;color:#64748b;margin-top:5px;font-weight:800}
      #field-map .fa3-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:950;white-space:nowrap}

      #field-map .fa3-kpis{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr)) minmax(260px,1.25fr);gap:12px}
      #field-map .fa3-kpi{position:relative;background:linear-gradient(180deg,#ffffff,#f8fafc);border:1px solid #dbe3ee;border-radius:18px;padding:16px 18px 16px 20px;box-shadow:0 10px 24px rgba(15,23,42,.055);min-width:0;overflow:hidden}
      #field-map .fa3-kpi:before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:#2563eb}
      #field-map .fa3-kpi:nth-child(1){background:linear-gradient(180deg,#eff6ff,#ffffff)}
      #field-map .fa3-kpi:nth-child(1):before{background:#2563eb}
      #field-map .fa3-kpi:nth-child(2){background:linear-gradient(180deg,#ecfdf5,#ffffff)}
      #field-map .fa3-kpi:nth-child(2):before{background:#16a34a}
      #field-map .fa3-kpi:nth-child(3){background:linear-gradient(180deg,#fff7ed,#ffffff)}
      #field-map .fa3-kpi:nth-child(3):before{background:#f97316}
      #field-map .fa3-kpi:nth-child(4){background:linear-gradient(180deg,#f5f3ff,#ffffff)}
      #field-map .fa3-kpi:nth-child(4):before{background:#7c3aed}
      #field-map .fa3-kpi span{display:block;font-size:12px;color:#64748b;font-weight:950;margin-bottom:8px}
      #field-map .fa3-kpi b{display:block;font-size:25px;color:#0f172a;font-weight:950;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #field-map .fa3-kpi em{display:block;font-style:normal;font-size:12px;color:#64748b;font-weight:850;margin-top:6px}

      #field-map .fa3-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#fff}
      #field-map .fa3-tabs{display:flex;gap:10px;flex-wrap:wrap}
      #field-map .fa3-tabs button{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:10px 18px;font-size:14px;font-weight:950;cursor:pointer}
      #field-map .fa3-tabs button.active{background:#1d4ed8;border-color:#1d4ed8;color:#fff;box-shadow:0 8px 18px rgba(37,99,235,.22)}
      #field-map .fa3-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      #field-map .fa3-tools label{font-size:12px;color:#64748b;font-weight:950}
      #field-map .fa3-tools select{margin-left:6px;border:1px solid #cbd5e1;border-radius:12px;padding:9px 32px 9px 12px;font-weight:900;color:#0f172a;background:#fff}

      #field-map .fa3-body{padding:18px 20px}
      #field-map .fa3-section{font-size:17px;font-weight:950;color:#0f172a;margin:0 0 14px;border-left:4px solid #2563eb;padding-left:10px}
      #field-map .fa3-row{display:grid;grid-template-columns:minmax(260px,420px) minmax(300px,1fr) minmax(230px,280px);gap:18px;margin:12px 0;align-items:center}
      #field-map .fa3-name{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:950;color:#0f172a;min-width:0}
      #field-map .fa3-name i{width:28px;height:28px;border-radius:999px;background:#eaf3ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-style:normal;font-weight:950;flex:0 0 auto}
      #field-map .fa3-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa3-track{height:25px;background:#e2e8f0;border-radius:999px;overflow:hidden}
      #field-map .fa3-track div{height:100%;border-radius:999px;background:linear-gradient(90deg,#174f7f,#2563eb)}
      #field-map .fa3-val{text-align:right;white-space:nowrap;font-size:15px}
      #field-map .fa3-val b{font-weight:950;color:#0f172a;margin-right:10px}
      #field-map .fa3-val span{font-weight:850;color:#64748b;margin-right:10px}
      #field-map .fa3-val em{font-style:normal;color:#1d4ed8;font-weight:950}



      #field-map .fa3-two-col{display:grid;grid-template-columns:minmax(360px,1fr) minmax(360px,1fr);gap:16px;margin-top:22px}
      #field-map .fa3-map-block,#field-map .fa3-trend-block{border:1px solid #e2e8f0;border-radius:18px;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,.05);padding:16px}
      #field-map .fa3-map-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
      #field-map .fa3-section.map,#field-map .fa3-section.trend{border-left-color:#0ea5e9;margin-bottom:4px}
      #field-map .fa3-map-head p{margin:0;color:#64748b;font-size:12px;font-weight:850}
      #field-map .fa3-map-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;font-weight:900;white-space:nowrap}
      #field-map .fa3-map-legend span,#field-map .fa3-map-legend i{display:block;width:14px;height:9px;border-radius:999px}
      #field-map .fa3-map-legend span{background:#dbeafe}
      #field-map .fa3-map-legend i:nth-of-type(1){background:#bfdbfe}
      #field-map .fa3-map-legend i:nth-of-type(2){background:#60a5fa}
      #field-map .fa3-map-legend i:nth-of-type(3){background:#2563eb}
      #field-map .fa3-map-legend i:nth-of-type(4){background:#1e3a8a}
      #field-map .fa3-map-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      #field-map .fa3-map-cell{min-height:112px;border-radius:16px;padding:12px;border:1px solid #dbeafe;display:flex;flex-direction:column;justify-content:space-between;box-shadow:inset 0 1px 0 rgba(255,255,255,.55)}
      #field-map .fa3-map-cell strong{font-size:14px;font-weight:950}
      #field-map .fa3-map-cell b{font-size:23px;font-weight:950;line-height:1}
      #field-map .fa3-map-cell span{font-size:12px;font-weight:900}
      #field-map .fa3-map-cell small{font-size:11px;font-weight:850;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa3-map-cell.lv1{background:#eff6ff;color:#1e3a8a}
      #field-map .fa3-map-cell.lv2{background:#dbeafe;color:#1e3a8a}
      #field-map .fa3-map-cell.lv3{background:#93c5fd;color:#0f172a}
      #field-map .fa3-map-cell.lv4{background:#3b82f6;color:#fff;border-color:#2563eb}
      #field-map .fa3-map-cell.lv5{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;border-color:#1d4ed8}
      #field-map .fa3-map-cell.blank{visibility:hidden;box-shadow:none;border:none;background:transparent}

      #field-map .fa3-map-cell summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;gap:6px;height:100%;outline:none}
      #field-map .fa3-map-cell summary::-webkit-details-marker{display:none}
      #field-map .fa3-map-cell[open]{box-shadow:0 12px 26px rgba(15,23,42,.14)}
      #field-map .fa3-map-sub{font-size:11px!important;font-weight:900!important;opacity:.92!important;white-space:normal!important;line-height:1.35}
      #field-map .fa3-map-drill{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.55);display:grid;gap:6px}
      #field-map .fa3-map-cell.lv1 .fa3-map-drill,#field-map .fa3-map-cell.lv2 .fa3-map-drill,#field-map .fa3-map-cell.lv3 .fa3-map-drill{border-top-color:rgba(30,58,138,.16)}
      #field-map .fa3-map-drill-row{display:grid;grid-template-columns:24px minmax(0,1fr);grid-template-areas:'rank name' 'rank nums';gap:4px 8px;align-items:center;border-radius:10px;padding:8px;background:rgba(255,255,255,.28)}
      #field-map .fa3-map-cell.lv1 .fa3-map-drill-row,#field-map .fa3-map-cell.lv2 .fa3-map-drill-row,#field-map .fa3-map-cell.lv3 .fa3-map-drill-row{background:rgba(255,255,255,.72)}
      #field-map .fa3-map-drill-row i{grid-area:rank;font-style:normal;width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);font-size:11px;font-weight:950}
      #field-map .fa3-map-drill-row em{grid-area:name;font-style:normal;font-size:12px;font-weight:950;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      #field-map .fa3-map-drill-row b{grid-area:nums;font-size:12px;font-weight:950;text-align:left}
      #field-map .fa3-map-drill-row span{grid-area:nums;font-size:12px;font-weight:950;text-align:right;justify-self:end}
      #field-map .fa3-map-drill-empty{font-size:12px;font-weight:900;opacity:.8}


      #field-map .fa3-map-grid.city-auto{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
      #field-map .fa3-map-cell summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;gap:6px;height:100%;outline:none}
      #field-map .fa3-map-cell summary::-webkit-details-marker{display:none}
      #field-map .fa3-map-cell[open]{box-shadow:0 12px 26px rgba(15,23,42,.14)}
      #field-map .fa3-map-sub{font-size:11px!important;font-weight:900!important;opacity:.92!important;white-space:normal!important;line-height:1.35}
      #field-map .fa3-map-drill{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.55);display:grid;gap:6px}
      #field-map .fa3-map-cell.lv1 .fa3-map-drill,#field-map .fa3-map-cell.lv2 .fa3-map-drill,#field-map .fa3-map-cell.lv3 .fa3-map-drill{border-top-color:rgba(30,58,138,.16)}
      #field-map .fa3-map-drill-row{display:grid;grid-template-columns:24px minmax(0,1fr);grid-template-areas:'rank name' 'rank nums';gap:4px 8px;align-items:center;border-radius:10px;padding:8px;background:rgba(255,255,255,.28)}
      #field-map .fa3-map-cell.lv1 .fa3-map-drill-row,#field-map .fa3-map-cell.lv2 .fa3-map-drill-row,#field-map .fa3-map-cell.lv3 .fa3-map-drill-row{background:rgba(255,255,255,.72)}
      #field-map .fa3-map-drill-row i{grid-area:rank;font-style:normal;width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);font-size:11px;font-weight:950}
      #field-map .fa3-map-drill-row em{grid-area:name;font-style:normal;font-size:12px;font-weight:950;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      #field-map .fa3-map-drill-row b{grid-area:nums;font-size:12px;font-weight:950;text-align:left}
      #field-map .fa3-map-drill-row span{grid-area:nums;font-size:12px;font-weight:950;text-align:right;justify-self:end}
      #field-map .fa3-map-drill-empty{font-size:12px;font-weight:900;opacity:.8}

      #field-map .fa3-trend-list{display:grid;gap:12px}
      #field-map .fa3-trend-row{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:12px;align-items:end;border-bottom:1px solid #eef2f7;padding-bottom:10px}
      #field-map .fa3-trend-name{font-size:13px;font-weight:950;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa3-sparks{display:flex;align-items:end;gap:8px;min-height:82px}
      #field-map .fa3-spark{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:22px}
      #field-map .fa3-spark i{width:16px;border-radius:999px 999px 3px 3px;background:linear-gradient(180deg,#60a5fa,#1d4ed8);display:block}
      #field-map .fa3-spark span{font-size:10px;color:#64748b;font-weight:850}

      #field-map .fa3-pref-detail{margin-top:22px;border-top:1px solid #e5e7eb;padding-top:18px}
      #field-map .fa3-pref-title{font-size:16px;font-weight:950;color:#0f172a;margin:0 0 12px;border-left:4px solid #16a34a;padding-left:10px}
      #field-map .fa3-pref-card{border:1px solid #e2e8f0;border-radius:16px;background:#fff;margin:10px 0;overflow:hidden;box-shadow:0 8px 20px rgba(15,23,42,.04)}
      #field-map .fa3-pref-card summary{cursor:pointer;list-style:none;padding:13px 16px;background:#f8fafc;display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:16px;align-items:center}
      #field-map .fa3-pref-card summary::-webkit-details-marker{display:none}
      #field-map .fa3-pref-main span{display:block;font-size:15px;font-weight:950;color:#0f172a}
      #field-map .fa3-pref-main small{display:block;margin-top:4px;font-size:12px;color:#64748b;font-weight:850}
      #field-map .fa3-pref-bar{height:16px;background:#e2e8f0;border-radius:999px;overflow:hidden}
      #field-map .fa3-pref-bar i{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#22c55e);border-radius:999px}
      #field-map .fa3-pref-cities{padding:10px 16px 14px;display:grid;gap:8px}
      #field-map .fa3-pref-city{display:grid;grid-template-columns:34px 1fr 90px 110px;gap:10px;align-items:center;padding:8px 10px;border-radius:12px;background:#fff;border:1px solid #eef2f7}
      #field-map .fa3-pref-city b{width:24px;height:24px;border-radius:999px;background:#ecfdf5;color:#15803d;display:inline-flex;align-items:center;justify-content:center;font-size:12px}
      #field-map .fa3-pref-city span{font-size:13px;font-weight:900;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #field-map .fa3-pref-city em{font-style:normal;font-size:13px;font-weight:950;color:#0f172a;text-align:right}
      #field-map .fa3-pref-city small{font-size:13px;font-weight:850;color:#64748b;text-align:right}

      #field-map .fa3-table-wrap{display:none;margin-top:20px;max-height:460px;overflow:auto;border:1px solid #e5e7eb;border-radius:16px}
      #field-map .fa3-table{width:100%;border-collapse:collapse;min-width:760px}
      #field-map .fa3-table th{background:#f8fafc;color:#334155;font-size:12px;text-align:left;padding:12px 14px;border-bottom:1px solid #e5e7eb}
      #field-map .fa3-table td{font-size:13px;color:#0f172a;padding:12px 14px;border-bottom:1px solid #e5e7eb}
      #field-map .fa3-table .r{text-align:right}

      #field-map .fa3-history{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
      #field-map .fa3-month{border:1px solid #e2e8f0;border-radius:16px;padding:13px;background:#fff;box-shadow:0 8px 20px rgba(15,23,42,.05)}
      #field-map .fa3-month.active{border-color:#2563eb;box-shadow:0 10px 24px rgba(37,99,235,.12)}
      #field-map .fa3-month div{display:flex;justify-content:space-between;gap:8px;align-items:center}
      #field-map .fa3-month b{font-size:15px;color:#0f172a}
      #field-map .fa3-month span{font-size:12px;color:#64748b;font-weight:900}
      #field-map .fa3-month p{height:9px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin:8px 0}
      #field-map .fa3-month p i{display:block;height:100%;background:linear-gradient(90deg,#174f7f,#2563eb);border-radius:999px}
      #field-map .fa3-month small{color:#64748b;font-weight:850}
      #field-map .fa3-note{font-size:12px;color:#64748b;font-weight:850;margin-top:10px}
      #field-map .fa3-empty{padding:46px;text-align:center;color:#64748b;font-weight:900}

      @media (max-width:900px){
        #field-map .fa3-kpis{grid-template-columns:repeat(2,minmax(130px,1fr))}
        #field-map .fa3-toolbar,#field-map .fa3-selector{align-items:flex-start;flex-direction:column}
        #field-map .fa3-row{grid-template-columns:1fr;gap:7px;border-bottom:1px solid #eef2f7;padding-bottom:11px}
        #field-map .fa3-val{text-align:left}
        #field-map .fa3-two-col{grid-template-columns:1fr}
        #field-map .fa3-map-grid{grid-template-columns:1fr}
        #field-map .fa3-trend-row{grid-template-columns:1fr}
        #field-map .fa3-map-drill-row{grid-template-columns:24px minmax(0,1fr);gap:4px 8px}
        #field-map .fa3-map-drill-row b{text-align:left}
        #field-map .fa3-map-drill-row span{text-align:right}
        #field-map .fa3-pref-card summary{grid-template-columns:1fr}
        #field-map .fa3-pref-city{grid-template-columns:30px 1fr;gap:8px}
        #field-map .fa3-pref-city em,#field-map .fa3-pref-city small{text-align:left}
      }
    `;
    document.head.appendChild(st);
  }

  install();
  startGuard();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{
      install();
      ensureObserver();
      if (active()) render();
    });
  } else {
    setTimeout(()=>{
      install();
      ensureObserver();
      if (active()) render();
    }, 0);
  }
})();
