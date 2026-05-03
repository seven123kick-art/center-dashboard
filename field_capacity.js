/* field_capacity.js : キャパ分析 完成版（接続復旧＋月キャパ＋日別超過＋カレンダー）
   2026-05-03

   重要：
   - 既存のキャパ画面を壊さず、field-capacity-root を下に追加表示します。
   - エリア実績データは、STATE / localStorage を広めに検索して取得します。
   - 1日キャパを月内の日数分で積み上げて「月キャパ」にします。
   - 日別超過タブで「どの日・どの地区が超過したか」を見ます。
*/
'use strict';

(function(){
  const FLAG = '__FIELD_CAPACITY_FIXED_FULL_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const LS_MASTER = 'field_capacity_master_v4';
  const LS_MAPPING = 'field_capacity_area_mapping_v4';
  const LS_CALENDAR = 'field_capacity_calendar_v4';
  const LS_SHIPPER = 'field_capacity_shipper_v4';
  const LS_STATE = 'field_capacity_state_v4';

  const DEFAULT_MASTER = [
    { area:'埼玉_さいたま', weekday:85, weekend:95, memo:'さいたま市各区' },
    { area:'東京_板橋/北', weekday:90, weekend:100, memo:'板橋区・北区' },
    { area:'東京_豊島/文京/練馬', weekday:55, weekend:65, memo:'豊島区・文京区・練馬区' },
    { area:'埼玉_川口/朝霞/和光', weekday:70, weekend:80, memo:'川口市・朝霞市・和光市・志木市・新座市' },
    { area:'埼玉_戸田/蕨', weekday:55, weekend:65, memo:'戸田市・蕨市' },
    { area:'東京_東部', weekday:25, weekend:30, memo:'足立区・荒川区・台東区・墨田区・江東区' },
    { area:'東京_その他', weekday:20, weekend:25, memo:'その他23区' },
    { area:'埼玉_その他', weekday:25, weekend:30, memo:'その他埼玉' },
    { area:'その他', weekday:10, weekend:10, memo:'その他' }
  ];

  const DEFAULT_MAPPING = [
    { pattern:'埼玉県さいたま市|さいたま市', area:'埼玉_さいたま', priority:20 },
    { pattern:'東京都板橋区|東京都北区', area:'東京_板橋/北', priority:20 },
    { pattern:'東京都豊島区|東京都文京区|東京都練馬区', area:'東京_豊島/文京/練馬', priority:20 },
    { pattern:'埼玉県川口市|埼玉県朝霞市|埼玉県和光市|埼玉県志木市|埼玉県新座市', area:'埼玉_川口/朝霞/和光', priority:20 },
    { pattern:'埼玉県戸田市|埼玉県蕨市', area:'埼玉_戸田/蕨', priority:20 },
    { pattern:'東京都足立区|東京都荒川区|東京都台東区|東京都墨田区|東京都江東区|東京都葛飾区|東京都江戸川区', area:'東京_東部', priority:20 },
    { pattern:'東京都', area:'東京_その他', priority:5 },
    { pattern:'埼玉県', area:'埼玉_その他', priority:5 },
    { pattern:'千葉県|神奈川県|群馬県|栃木県|茨城県', area:'その他', priority:1 }
  ];

  const DAY_TYPES = [
    { key:'normal', label:'通常', cls:'normal' },
    { key:'holiday', label:'祝日', cls:'holiday' },
    { key:'busy', label:'繁忙日', cls:'busy' },
    { key:'limit', label:'制限日', cls:'limit' },
    { key:'special', label:'特殊日', cls:'special' }
  ];

  let rendering = false;
  let lastUsageRows = [];
  let lastDailyRows = [];

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
  function num(v){
    const n = Number(String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[^\d.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v)/1000).toLocaleString('ja-JP'); }
  function pct(v){ const n = Number(v); return Number.isFinite(n) ? n.toFixed(1) : '0.0'; }

  function normalizeYM(v){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 6 ? s.slice(0,6) : '';
  }
  function normalizeDate(v){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    if (s.length >= 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return '';
  }
  function todayYM(){
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function dateFromYM(ym, d=1){
    return `${String(ym).slice(0,4)}-${String(ym).slice(4,6)}-${String(d).padStart(2,'0')}`;
  }
  function daysInYM(ym){
    const y = Number(String(ym).slice(0,4));
    const m = Number(String(ym).slice(4,6));
    return new Date(y,m,0).getDate();
  }
  function dow(dateStr){
    return new Date(dateStr + 'T00:00:00').getDay();
  }
  function dowLabel(dateStr){
    return ['日','月','火','水','木','金','土'][dow(dateStr)];
  }
  function dateLabel(dateStr){
    return `${Number(dateStr.slice(5,7))}/${Number(dateStr.slice(8,10))}（${dowLabel(dateStr)}）`;
  }
  function isWeekend(dateStr){
    const d = dow(dateStr);
    return d === 0 || d === 6;
  }

  function loadJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch(e) {
      return fallback;
    }
  }
  function saveJSON(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }

  function state(){
    const s = loadJSON(LS_STATE, {});
    return {
      tab:s.tab || 'usage',
      ym:normalizeYM(s.ym) || latestYMFromData() || todayYM(),
      area:s.area || ''
    };
  }
  function setState(patch){
    saveJSON(LS_STATE, { ...state(), ...patch });
  }

  function master(){
    const rows = loadJSON(LS_MASTER, null);
    if (!arr(rows) || !rows.length) {
      saveJSON(LS_MASTER, DEFAULT_MASTER);
      return DEFAULT_MASTER.slice();
    }
    return rows;
  }
  function saveMaster(rows){ saveJSON(LS_MASTER, rows); }

  function mappings(){
    const rows = loadJSON(LS_MAPPING, null);
    if (!arr(rows) || !rows.length) {
      saveJSON(LS_MAPPING, DEFAULT_MAPPING);
      return DEFAULT_MAPPING.slice();
    }
    return rows;
  }
  function saveMappings(rows){ saveJSON(LS_MAPPING, rows); }

  function calendar(){ return loadJSON(LS_CALENDAR, {}); }
  function saveCalendar(v){ saveJSON(LS_CALENDAR, v); }

  function shipperAdjustments(){ return loadJSON(LS_SHIPPER, []); }
  function saveShipperAdjustments(v){ saveJSON(LS_SHIPPER, v); }

  function areas(){
    return [...new Set(master().map(r=>clean(r.area)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  }

  function localJSON(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw || !/^[\[{]/.test(raw.trim())) return null;
      return JSON.parse(raw);
    } catch(e) {
      return null;
    }
  }

  function getCandidateArraysFromObject(x){
    const out = [];
    if (!obj(x)) return out;

    ['tickets','rows','data','rawRows','items','records'].forEach(k=>{
      if (Array.isArray(x[k]) && x[k].length) out.push(x[k]);
    });

    Object.keys(x).forEach(k=>{
      const v = x[k];
      if (Array.isArray(v) && v.length && v.some(row=>obj(row) || Array.isArray(row))) out.push(v);
    });

    return out;
  }

  function looksLikeTicketRow(row){
    if (Array.isArray(row)) return row.length >= 14;
    if (!obj(row)) return false;
    const keys = Object.keys(row).join('|');
    return /原票|住所|郵便|配達|金額|売上|ticket|slip|address|zip/i.test(keys);
  }

  function collectRecords(){
    const out = [];
    const seen = new Set();

    function pushRecord(x, source){
      if (!obj(x)) return;

      const ym = normalizeYM(x.ym || x.YM || x.month || x.targetYM || x.date || x.name || source || state().ym);
      let tickets = [];

      if (arr(x.tickets).length) tickets = x.tickets;
      else if (arr(x.rows).length) tickets = x.rows;
      else if (arr(x.data).length) tickets = x.data;
      else if (arr(x.rawRows).length) tickets = x.rawRows;
      else {
        const arrays = getCandidateArraysFromObject(x);
        const found = arrays.find(a=>a.some(looksLikeTicketRow));
        if (found) tickets = found;
      }

      if (!ym || !tickets.length) return;

      const sig = `${ym}:${tickets.length}:${source}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ ym, tickets, source });
    }

    function pushArray(a, source){
      if (!Array.isArray(a) || !a.length) return;

      if (a.some(looksLikeTicketRow)) {
        const ym = normalizeYM(source) || latestCommonYM() || state().ym || todayYM();
        const sig = `${ym}:${a.length}:${source}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          out.push({ ym, tickets:a, source });
        }
        return;
      }

      a.forEach((x,i)=>pushRecord(x, `${source}.${i}`));
    }

    if (window.STATE) {
      [
        'productAddressData',
        'fieldData',
        'capacityData',
        'areaData',
        'mapData',
        'records'
      ].forEach(k=>{
        const v = STATE[k];
        if (Array.isArray(v)) pushArray(v, `STATE.${k}`);
        else if (obj(v)) pushRecord(v, `STATE.${k}`);
      });
    }

    // field_area.js 側が公開している場合は使う
    try {
      if (window.FIELD_AREA_UI && typeof FIELD_AREA_UI.getData === 'function') {
        const v = FIELD_AREA_UI.getData();
        if (Array.isArray(v)) pushArray(v, 'FIELD_AREA_UI.getData');
      }
      if (window.FIELD_AREA && typeof FIELD_AREA.getData === 'function') {
        const v = FIELD_AREA.getData();
        if (Array.isArray(v)) pushArray(v, 'FIELD_AREA.getData');
      }
    } catch(e) {}

    try {
      for (let i=0; i<localStorage.length; i++){
        const key = localStorage.key(i);
        const parsed = localJSON(key);
        if (!parsed) continue;

        if (Array.isArray(parsed)) {
          pushArray(parsed, key);
        } else if (obj(parsed)) {
          pushRecord(parsed, key);
          Object.keys(parsed).forEach(k=>{
            const v = parsed[k];
            if (Array.isArray(v)) pushArray(v, `${key}.${k}`);
            else if (obj(v)) pushRecord(v, `${key}.${k}`);
          });
        }
      }
    } catch(e) {}

    return out.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));
  }

  function latestCommonYM(){
    const stYm = normalizeYM(window.STATE?.selYM || window.STATE?.currentYM || window.STATE?.ym);
    if (stYm) return stYm;
    const sel = document.querySelector('select[id*="month"], select[id*="ym"], select[id*="YM"]');
    const selYm = normalizeYM(sel?.value || sel?.textContent);
    return selYm;
  }

  function latestYMFromData(){
    const yms = collectRecords().map(r=>r.ym).filter(Boolean).sort();
    return yms[yms.length - 1] || '';
  }

  function selectedRecord(){
    const s = state();
    const records = collectRecords();
    const list = records.filter(r=>r.ym === s.ym);
    return (list.length ? list : records).sort((a,b)=>arr(b.tickets).length-arr(a.tickets).length)[0] || null;
  }

  function rawAt(row, idx){
    return Array.isArray(row) ? clean(row[idx]) : '';
  }

  function getValue(row, keys, rawIndex){
    if (Array.isArray(row)) return rawAt(row, rawIndex);
    if (!obj(row)) return '';
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && clean(row[k]) !== '') return row[k];
    }
    return '';
  }

  function ticketSlip(t, idx){
    return clean(getValue(t, ['slip','slipNo','ticketNo','invoiceNo','エスライン原票番号','原票番号','荷主伝票番号'], 8)) || `__no_slip_${idx}`;
  }
  function ticketAmount(t){
    return num(getValue(t, ['amount','sales','value','金額','売上','単価'], 20));
  }
  function ticketDate(t, fallbackYM){
    return normalizeDate(getValue(t, ['date','deliveryDate','completeDate','配達完了日','作業日','日付'], 0)) || dateFromYM(fallbackYM || state().ym, 1);
  }
  function normalizeZip(v){
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }
  function ticketZip(t){
    return normalizeZip(getValue(t, ['zip','zipcode','postCode','postalCode','お届け先郵便番号','届け先郵便番号','郵便番号'], 11));
  }
  function ticketAddress(t){
    return clean(getValue(t, ['address','addr','destinationAddress','住所','お届け先住所','届け先住所','配送先住所'], 13));
  }

  function splitAddressToCity(address){
    const t = clean(address).replace(/\s+/g,'');
    if (!t) return '未設定';

    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = prefMatch ? t.slice(pref.length) : t;

    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return pref + wardCity[1];

    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return pref + muni[1];

    if (pref === '埼玉県' && /^蕨/.test(rest)) return '埼玉県蕨市';
    if (pref === '埼玉県' && /^戸田/.test(rest)) return '埼玉県戸田市';
    if (pref === '埼玉県' && /^川口/.test(rest)) return '埼玉県川口市';

    return pref ? pref + rest.slice(0,8) : rest.slice(0,8);
  }

  function cityFromZip(zip){
    const z = normalizeZip(zip);
    if (!z) return '';

    let hit = null;
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.get) hit = JP_ZIP_LOADER.get(z);
    else if (window.JP_ZIP_MASTER) hit = window.JP_ZIP_MASTER[z];

    if (!hit) return '';

    if (Array.isArray(hit)) return clean(hit[0]) + clean(hit[1]);
    if (obj(hit)) return clean(hit.pref || hit.prefecture || hit[0]) + clean(hit.city || hit.municipality || hit.addr1 || hit[1]);

    return splitAddressToCity(String(hit));
  }

  async function ensureZipParts(record){
    const zips = arr(record?.tickets).map(ticketZip).filter(Boolean);
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.loadForZips) {
      await JP_ZIP_LOADER.loadForZips(zips);
    }
  }

  function cityOfTicket(t){
    return cityFromZip(ticketZip(t)) || splitAddressToCity(ticketAddress(t));
  }

  function mappedAreaOfCity(city){
    const c = clean(city);
    const rules = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));

    for (const r of rules) {
      const parts = clean(r.pattern).split('|').map(x=>clean(x)).filter(Boolean);
      if (parts.some(p=>c.includes(p))) return clean(r.area || '未分類') || '未分類';
    }
    return '未分類';
  }

  function uniqueTickets(record){
    const map = new Map();

    arr(record?.tickets).forEach((t,idx)=>{
      const slip = ticketSlip(t, idx);
      const date = ticketDate(t, record?.ym || state().ym);
      const key = `${date}__${slip}`;
      const city = cityOfTicket(t);
      const area = mappedAreaOfCity(city);
      const amount = ticketAmount(t);

      if (!map.has(key)) map.set(key, { slip, date, city, area, amount });
      else {
        const x = map.get(key);
        x.amount += amount;
        if ((!x.city || x.city === '未設定') && city) x.city = city;
        if ((!x.area || x.area === '未分類') && area) x.area = area;
      }
    });

    return [...map.values()];
  }

  function cityRows(record){
    const map = new Map();
    uniqueTickets(record).forEach(t=>{
      const key = t.city || '未設定';
      if (!map.has(key)) map.set(key, { city:key, count:0, amount:0 });
      const r = map.get(key);
      r.count += 1;
      r.amount += t.amount;
    });
    return [...map.values()].sort((a,b)=>b.count-a.count || b.amount-a.amount);
  }

  function actualByArea(record){
    const map = new Map();

    uniqueTickets(record).forEach(t=>{
      const key = t.area || '未分類';
      if (!map.has(key)) map.set(key, { area:key, count:0, amount:0, cities:[] });
      const r = map.get(key);
      r.count += 1;
      r.amount += t.amount;

      let c = r.cities.find(x=>x.city === t.city);
      if (!c) {
        c = { city:t.city, count:0, amount:0 };
        r.cities.push(c);
      }
      c.count += 1;
      c.amount += t.amount;
    });

    return [...map.values()].map(r=>{
      r.cities.sort((a,b)=>b.count-a.count || b.amount-a.amount);
      return r;
    });
  }

  function actualByDateArea(record){
    const map = new Map();

    uniqueTickets(record).forEach(t=>{
      const key = `${t.date}__${t.area || '未分類'}`;
      if (!map.has(key)) map.set(key, { date:t.date, area:t.area || '未分類', count:0, amount:0, cities:[] });
      const r = map.get(key);
      r.count += 1;
      r.amount += t.amount;

      let c = r.cities.find(x=>x.city === t.city);
      if (!c) {
        c = { city:t.city, count:0, amount:0 };
        r.cities.push(c);
      }
      c.count += 1;
      c.amount += t.amount;
    });

    return [...map.values()].map(r=>{
      r.cities.sort((a,b)=>b.count-a.count || b.amount-a.amount);
      return r;
    });
  }

  function calRow(dateStr){ return calendar()[dateStr] || {}; }
  function dayType(dateStr){ return calRow(dateStr).type || 'normal'; }
  function dayAdj(dateStr){ return num(calRow(dateStr).adjust || 0); }

  function shipperAdj(dateStr, area){
    return shipperAdjustments()
      .filter(r=> (!r.date || r.date === dateStr) && (!r.area || r.area === area))
      .reduce((s,r)=>s+num(r.adjust),0);
  }

  function baseDailyCap(dateStr, area){
    const rows = master().filter(r=>clean(r.area) === area);
    if (!rows.length) return 0;

    return rows.reduce((s,r)=>{
      const holidayLike = isWeekend(dateStr) || dayType(dateStr) === 'holiday';
      return s + (holidayLike ? num(r.weekend) : num(r.weekday));
    },0);
  }

  function dailyCap(dateStr, area){
    return Math.max(0, baseDailyCap(dateStr, area) + dayAdj(dateStr) + shipperAdj(dateStr, area));
  }

  function monthlyCap(ym, area){
    const last = daysInYM(ym);
    let total = 0;
    for (let d=1; d<=last; d++) {
      total += dailyCap(dateFromYM(ym,d), area);
    }
    return total;
  }

  function judge(used, cap){
    const rate = cap > 0 ? used / cap * 100 : (used > 0 ? 999 : 0);
    if (cap <= 0 && used > 0) return { rate, label:'要確認', cls:'danger' };
    if (rate < 80) return { rate, label:'余裕あり', cls:'good' };
    if (rate <= 100) return { rate, label:'適正', cls:'ok' };
    if (rate <= 120) return { rate, label:'超過注意', cls:'warn' };
    return { rate, label:'要調整', cls:'danger' };
  }

  function usageRows(record){
    const s = state();
    const actual = actualByArea(record);
    const used = new Map(actual.map(r=>[r.area,r]));
    const all = [...new Set([...areas(), ...actual.map(r=>r.area)])].filter(Boolean);

    return all.map(area=>{
      const u = used.get(area) || { count:0, amount:0, cities:[] };
      const oneDay = baseDailyCap(dateFromYM(s.ym,1), area);
      const cap = monthlyCap(s.ym, area);
      const j = judge(u.count, cap);

      return {
        area,
        count:u.count,
        amount:u.amount,
        cities:u.cities || [],
        oneDay,
        cap,
        rate:j.rate,
        judge:j.label,
        cls:j.cls
      };
    }).filter(r=>!s.area || r.area === s.area)
      .sort((a,b)=>b.rate-a.rate || b.count-a.count);
  }

  function dailyRows(record){
    const s = state();
    const actual = actualByDateArea(record);
    const rows = actual.map(r=>{
      const cap = dailyCap(r.date, r.area);
      const j = judge(r.count, cap);
      return {
        ...r,
        cap,
        base:baseDailyCap(r.date, r.area),
        dayAdj:dayAdj(r.date),
        shipperAdj:shipperAdj(r.date, r.area),
        rate:j.rate,
        judge:j.label,
        cls:j.cls
      };
    }).filter(r=>!s.area || r.area === s.area);

    const riskOrder = { danger:4, warn:3, ok:2, good:1 };
    return rows.sort((a,b)=>
      (riskOrder[b.cls] || 0) - (riskOrder[a.cls] || 0)
      || b.rate - a.rate
      || String(a.date).localeCompare(String(b.date))
    );
  }

  function root(){
    let el = document.getElementById('field-capacity-root');
    if (el) return el;

    const view =
      document.getElementById('view-field-capacity') ||
      document.getElementById('view-capacity') ||
      document.querySelector('[data-view="field-capacity"]') ||
      document.querySelector('[data-view="capacity"]') ||
      document.querySelector('.view.active') ||
      document.querySelector('main') ||
      document.body;

    if (!view) return null;

    el = document.createElement('div');
    el.id = 'field-capacity-root';
    view.appendChild(el);
    return el;
  }

  function isCapacityVisible(){
    const activeText = document.querySelector('.active')?.textContent || '';
    const title = document.querySelector('h1,h2,.page-title')?.textContent || '';
    const bodyHead = document.body?.textContent?.slice(0,1500) || '';
    return /キャパ分析/.test(activeText + title + bodyHead);
  }

  async function render(){
    if (rendering) return;
    rendering = true;
    ensureStyle();

    try {
      const el = root();
      if (!el) return;

      const s = state();
      const record = selectedRecord();
      if (record) await ensureZipParts(record);

      const rows = record ? usageRows(record) : [];
      const dRows = record ? dailyRows(record) : [];
      lastUsageRows = rows;
      lastDailyRows = dRows;

      el.innerHTML = `
        <div class="fc4-wrap">
          ${headerHtml(s, record, rows)}
          ${tabsHtml(s)}
          ${s.tab === 'usage' ? usageHtml(record, rows) : ''}
          ${s.tab === 'daily' ? dailyHtml(record, dRows) : ''}
          ${s.tab === 'calendar' ? calendarHtml(s) : ''}
          ${s.tab === 'mapping' ? mappingHtml(record) : ''}
          ${s.tab === 'master' ? masterHtml() : ''}
          ${s.tab === 'shipper' ? shipperHtml() : ''}
        </div>
      `;

      bind();
    } catch(e) {
      console.error('[field_capacity]', e);
      const el = root();
      if (el) el.innerHTML = `<div class="fc4-error">キャパ分析エラー：${esc(e.message || e)}</div>`;
    } finally {
      rendering = false;
    }
  }

  function headerHtml(s, record, rows){
    const yms = [...new Set(collectRecords().map(r=>r.ym).filter(Boolean))].sort().reverse();
    const used = rows.reduce((x,r)=>x+r.count,0);
    const cap = rows.reduce((x,r)=>x+r.cap,0);
    const j = judge(used, cap);
    const overDays = record ? dailyRows(record).filter(r=>r.rate > 100).length : 0;
    const sourceText = record ? `${fmt(arr(record.tickets).length)}行 / ${esc(record.source || '')}` : '未取得';

    return `
      <div class="fc4-header">
        <div>
          <div class="fc4-title">キャパ分析</div>
          <div class="fc4-sub">月キャパと日別超過を分けて確認。土日・祝日・繁忙日の偏りを見ます。</div>
        </div>
        <div class="fc4-cond">
          <label>対象月
            <select id="fc4-ym">
              ${(yms.length ? yms : [s.ym]).map(ym=>`<option value="${esc(ym)}" ${s.ym===ym?'selected':''}>${esc(ymText(ym))}</option>`).join('')}
            </select>
          </label>
          <label>地区
            <select id="fc4-area">
              <option value="">全地区</option>
              ${areas().map(a=>`<option value="${esc(a)}" ${s.area===a?'selected':''}>${esc(a)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <div class="fc4-kpis">
        <div class="fc4-kpi blue"><span>実績件数</span><b>${fmt(used)}件</b></div>
        <div class="fc4-kpi green"><span>月キャパ</span><b>${fmt(cap)}件</b></div>
        <div class="fc4-kpi ${j.cls}"><span>月使用率</span><b>${pct(j.rate)}%</b><em>${esc(j.label)}</em></div>
        <div class="fc4-kpi purple"><span>対象データ</span><b>${sourceText}</b></div>
      </div>
      <div class="fc4-kpis small">
        <div class="fc4-kpi warn"><span>日別超過</span><b>${fmt(overDays)}件</b><em>100%超の日・地区</em></div>
        <div class="fc4-kpi"><span>登録地区</span><b>${fmt(areas().length)}地区</b></div>
        <div class="fc4-kpi"><span>マッピング</span><b>${fmt(mappings().length)}件</b></div>
        <div class="fc4-kpi"><span>日別補正</span><b>${fmt(Object.keys(calendar()).length)}件</b></div>
      </div>
    `;
  }

  function tabsHtml(s){
    const tabs = [
      ['usage','月別使用状況'],
      ['daily','日別超過'],
      ['calendar','日別カレンダー補正'],
      ['mapping','地区マッピング'],
      ['master','通常キャパ'],
      ['shipper','荷主別補正']
    ];
    return `<div class="fc4-tabs">${tabs.map(([k,l])=>`<button type="button" class="${s.tab===k?'active':''}" data-fc4-tab="${k}">${esc(l)}</button>`).join('')}</div>`;
  }

  function usageHtml(record, rows){
    if (!record) return `<div class="fc4-card"><div class="fc4-empty">エリア実績データがありません。商品・住所CSVまたは配送エリアCSVを読み込んでください。</div></div>`;

    return `
      <div class="fc4-grid">
        <div class="fc4-card main">
          <div class="fc4-card-head">
            <div>
              <h3>月別キャパ使用状況</h3>
              <p>日別キャパを合計した月キャパに対して、月間実績を判定します。</p>
            </div>
          </div>
          <div class="fc4-table-wrap">
            <table class="fc4-table">
              <thead>
                <tr>
                  <th>キャパ地区</th>
                  <th class="r">実績件数</th>
                  <th class="r">1日基準</th>
                  <th class="r">月キャパ</th>
                  <th class="r">使用率</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((r,i)=>`
                  <tr>
                    <td><button type="button" class="fc4-link" data-fc4-detail="${i}">${esc(r.area)}</button></td>
                    <td class="r"><b>${fmt(r.count)}</b></td>
                    <td class="r">${fmt(r.oneDay)}</td>
                    <td class="r"><b>${fmt(r.cap)}</b></td>
                    <td class="r">${pct(r.rate)}%</td>
                    <td><span class="fc4-badge ${esc(r.cls)}">${esc(r.judge)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="fc4-card side">
          <div class="fc4-card-head">
            <div><h3>市区町村内訳</h3><p>左の地区をクリック</p></div>
          </div>
          <div id="fc4-detail-box" class="fc4-empty">地区をクリックしてください</div>
        </div>
      </div>
    `;
  }

  function dailyHtml(record, rows){
    if (!record) return `<div class="fc4-card"><div class="fc4-empty">エリア実績データがありません。</div></div>`;

    const over = rows.filter(r=>r.rate > 100).length;
    const warn = rows.filter(r=>r.rate >= 80 && r.rate <= 100).length;

    return `
      <div class="fc4-card">
        <div class="fc4-card-head">
          <div>
            <h3>日別キャパ超過チェック</h3>
            <p>どの日・どの地区が超過したかを確認します。土日や祝日だけ詰まっているケースを見つけます。</p>
          </div>
          <div class="fc4-chips"><span>超過 ${fmt(over)}件</span><span>80%以上 ${fmt(warn)}件</span></div>
        </div>
        <div class="fc4-table-wrap">
          <table class="fc4-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>地区</th>
                <th class="r">実績</th>
                <th class="r">日キャパ</th>
                <th class="r">日別補正</th>
                <th class="r">荷主補正</th>
                <th class="r">使用率</th>
                <th>判定</th>
                <th>主な市区町村</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r=>`
                <tr class="fc4-risk-${esc(r.cls)}">
                  <td>${esc(dateLabel(r.date))}</td>
                  <td>${esc(r.area)}</td>
                  <td class="r"><b>${fmt(r.count)}</b></td>
                  <td class="r"><b>${fmt(r.cap)}</b></td>
                  <td class="r">${fmt(r.dayAdj)}</td>
                  <td class="r">${fmt(r.shipperAdj)}</td>
                  <td class="r">${pct(r.rate)}%</td>
                  <td><span class="fc4-badge ${esc(r.cls)}">${esc(r.judge)}</span></td>
                  <td>${esc((r.cities || []).slice(0,3).map(c=>`${c.city} ${c.count}件`).join(' / ') || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function calendarHtml(s){
    const ym = s.ym || todayYM();
    const y = Number(String(ym).slice(0,4));
    const m = Number(String(ym).slice(4,6));
    const last = daysInYM(ym);
    const firstDow = dow(dateFromYM(ym,1));
    const cal = calendar();
    const cells = [];

    for (let i=0; i<firstDow; i++) cells.push(null);
    for (let d=1; d<=last; d++) cells.push(dateFromYM(ym,d));
    while (cells.length % 7 !== 0) cells.push(null);

    return `
      <div class="fc4-card">
        <div class="fc4-card-head">
          <div>
            <h3>日別カレンダー補正</h3>
            <p>一般的な月間カレンダー形式です。日付ごとに祝日・繁忙日・制限日・補正数を設定できます。</p>
          </div>
        </div>
        <div class="fc4-calendar">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<div class="fc4-week ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}
          ${cells.map(date=>{
            if (!date) return `<div class="fc4-day blank"></div>`;
            const row = cal[date] || {};
            const type = row.type || 'normal';
            const typeObj = DAY_TYPES.find(x=>x.key===type) || DAY_TYPES[0];
            const isSun = dow(date) === 0;
            const isSat = dow(date) === 6;
            return `
              <div class="fc4-day ${esc(typeObj.cls)} ${isSun?'sun':''} ${isSat?'sat':''}">
                <div class="fc4-day-num">
                  <b>${Number(date.slice(8,10))}</b>
                  <span>${esc(typeObj.label)}</span>
                </div>
                <select data-cal-date="${date}" data-cal-field="type">
                  ${DAY_TYPES.map(t=>`<option value="${t.key}" ${type===t.key?'selected':''}>${esc(t.label)}</option>`).join('')}
                </select>
                <label>補正
                  <input type="number" data-cal-date="${date}" data-cal-field="adjust" value="${esc(row.adjust || 0)}">
                </label>
                <input class="memo" data-cal-date="${date}" data-cal-field="memo" value="${esc(row.memo || '')}" placeholder="メモ">
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function mappingHtml(record){
    const cRows = record ? cityRows(record) : [];
    const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));

    return `
      <div class="fc4-card">
        <div class="fc4-card-head">
          <div><h3>地区マッピング</h3><p>市区町村をキャパ地区へ割り当てます。未分類があればここで調整します。</p></div>
          <button type="button" id="fc4-add-map" class="fc4-btn primary">＋ ルール追加</button>
        </div>
        <div class="fc4-table-wrap">
          <table class="fc4-table editable">
            <thead><tr><th>優先</th><th>含む文字</th><th>変換先地区</th><th>該当例</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r,i)=>{
                const ex = cRows.filter(c=>clean(r.pattern).split('|').filter(Boolean).some(p=>c.city.includes(p))).slice(0,3).map(c=>c.city).join('、');
                return `
                  <tr data-map-index="${i}">
                    <td><input type="number" data-map-field="priority" value="${esc(r.priority || 1)}"></td>
                    <td><input data-map-field="pattern" value="${esc(r.pattern || '')}"></td>
                    <td>
                      <select data-map-field="area">
                        ${areas().concat(['未分類']).map(a=>`<option value="${esc(a)}" ${r.area===a?'selected':''}>${esc(a)}</option>`).join('')}
                      </select>
                    </td>
                    <td>${esc(ex || '—')}</td>
                    <td><button type="button" class="fc4-mini danger" data-map-delete="${i}">削除</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function masterHtml(){
    const rows = master();
    return `
      <div class="fc4-card">
        <div class="fc4-card-head">
          <div><h3>通常キャパ</h3><p>1日あたりの基準キャパです。月キャパは日別に自動積み上げします。</p></div>
          <button type="button" id="fc4-add-master" class="fc4-btn primary">＋ 行追加</button>
        </div>
        <div class="fc4-table-wrap">
          <table class="fc4-table editable">
            <thead><tr><th>地区</th><th class="r">平日</th><th class="r">土日祝</th><th>メモ</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r,i)=>`
                <tr data-master-index="${i}">
                  <td><input data-master-field="area" value="${esc(r.area || '')}"></td>
                  <td><input type="number" data-master-field="weekday" value="${esc(r.weekday || 0)}"></td>
                  <td><input type="number" data-master-field="weekend" value="${esc(r.weekend || 0)}"></td>
                  <td><input data-master-field="memo" value="${esc(r.memo || '')}"></td>
                  <td><button type="button" class="fc4-mini danger" data-master-delete="${i}">削除</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function shipperHtml(){
    const rows = shipperAdjustments();
    return `
      <div class="fc4-card">
        <div class="fc4-card-head">
          <div><h3>荷主別補正</h3><p>紙管理の荷主別差分を地区単位で加減算します。</p></div>
          <button type="button" id="fc4-add-shipper" class="fc4-btn primary">＋ 補正追加</button>
        </div>
        <div class="fc4-table-wrap">
          <table class="fc4-table editable">
            <thead><tr><th>日付</th><th>荷主</th><th>地区</th><th class="r">補正</th><th>理由</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r,i)=>`
                <tr data-shipper-index="${i}">
                  <td><input type="date" data-shipper-field="date" value="${esc(r.date || '')}"></td>
                  <td><input data-shipper-field="shipper" value="${esc(r.shipper || '')}" placeholder="例：コジマ"></td>
                  <td>
                    <select data-shipper-field="area">
                      <option value="">全地区</option>
                      ${areas().map(a=>`<option value="${esc(a)}" ${r.area===a?'selected':''}>${esc(a)}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="number" data-shipper-field="adjust" value="${esc(r.adjust || 0)}"></td>
                  <td><input data-shipper-field="memo" value="${esc(r.memo || '')}"></td>
                  <td><button type="button" class="fc4-mini danger" data-shipper-delete="${i}">削除</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function detailHtml(row){
    const cities = row.cities || [];
    if (!cities.length) return `<div class="fc4-empty">該当なし</div>`;
    return `<div class="fc4-city-list">${cities.map((c,i)=>`
      <div class="fc4-city-row"><b>${i+1}</b><span>${esc(c.city)}</span><em>${fmt(c.count)}件</em><small>${fmtK(c.amount)}千円</small></div>
    `).join('')}</div>`;
  }

  function bind(){
    const ym = document.getElementById('fc4-ym');
    if (ym && !ym.__fc4) {
      ym.__fc4 = true;
      ym.addEventListener('change', ()=>{ setState({ ym:ym.value }); render(); });
    }

    const area = document.getElementById('fc4-area');
    if (area && !area.__fc4) {
      area.__fc4 = true;
      area.addEventListener('change', ()=>{ setState({ area:area.value }); render(); });
    }

    document.querySelectorAll('[data-fc4-tab]').forEach(btn=>{
      if (btn.__fc4) return;
      btn.__fc4 = true;
      btn.addEventListener('click', ()=>{ setState({ tab:btn.dataset.fc4Tab }); render(); });
    });

    document.querySelectorAll('[data-fc4-detail]').forEach(btn=>{
      if (btn.__fc4) return;
      btn.__fc4 = true;
      btn.addEventListener('click', ()=>{
        const row = lastUsageRows[Number(btn.dataset.fc4Detail)];
        const box = document.getElementById('fc4-detail-box');
        if (box && row) box.innerHTML = detailHtml(row);
      });
    });

    bindCalendar();
    bindMapping();
    bindMaster();
    bindShipper();
  }

  function bindCalendar(){
    document.querySelectorAll('[data-cal-date]').forEach(input=>{
      if (input.__fc4) return;
      input.__fc4 = true;
      input.addEventListener('change', ()=>{
        const date = input.dataset.calDate;
        const field = input.dataset.calField;
        const cal = calendar();
        cal[date] = cal[date] || { type:'normal', adjust:0, memo:'' };
        cal[date][field] = input.type === 'number' ? num(input.value) : input.value;
        saveCalendar(cal);
        render();
      });
    });
  }

  function bindMapping(){
    const add = document.getElementById('fc4-add-map');
    if (add && !add.__fc4) {
      add.__fc4 = true;
      add.addEventListener('click', ()=>{
        const rows = mappings();
        rows.push({ pattern:'', area:'未分類', priority:1 });
        saveMappings(rows);
        render();
      });
    }

    document.querySelectorAll('[data-map-field]').forEach(input=>{
      if (input.__fc4) return;
      input.__fc4 = true;
      input.addEventListener('change', ()=>{
        const idx = Number(input.closest('[data-map-index]')?.dataset.mapIndex);
        const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        if (!rows[idx]) return;
        rows[idx][input.dataset.mapField] = input.type === 'number' ? num(input.value) : input.value;
        saveMappings(rows);
        render();
      });
    });

    document.querySelectorAll('[data-map-delete]').forEach(btn=>{
      if (btn.__fc4) return;
      btn.__fc4 = true;
      btn.addEventListener('click', ()=>{
        const idx = Number(btn.dataset.mapDelete);
        const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        rows.splice(idx,1);
        saveMappings(rows);
        render();
      });
    });
  }

  function bindMaster(){
    const add = document.getElementById('fc4-add-master');
    if (add && !add.__fc4) {
      add.__fc4 = true;
      add.addEventListener('click', ()=>{
        const rows = master();
        rows.push({ area:'', weekday:0, weekend:0, memo:'' });
        saveMaster(rows);
        render();
      });
    }

    document.querySelectorAll('[data-master-field]').forEach(input=>{
      if (input.__fc4) return;
      input.__fc4 = true;
      input.addEventListener('change', ()=>{
        const idx = Number(input.closest('[data-master-index]')?.dataset.masterIndex);
        const rows = master();
        if (!rows[idx]) return;
        rows[idx][input.dataset.masterField] = input.type === 'number' ? num(input.value) : input.value;
        saveMaster(rows);
        render();
      });
    });

    document.querySelectorAll('[data-master-delete]').forEach(btn=>{
      if (btn.__fc4) return;
      btn.__fc4 = true;
      btn.addEventListener('click', ()=>{
        const idx = Number(btn.dataset.masterDelete);
        const rows = master();
        rows.splice(idx,1);
        saveMaster(rows);
        render();
      });
    });
  }

  function bindShipper(){
    const add = document.getElementById('fc4-add-shipper');
    if (add && !add.__fc4) {
      add.__fc4 = true;
      add.addEventListener('click', ()=>{
        const rows = shipperAdjustments();
        rows.push({ date:dateFromYM(state().ym,1), shipper:'', area:'', adjust:0, memo:'' });
        saveShipperAdjustments(rows);
        render();
      });
    }

    document.querySelectorAll('[data-shipper-field]').forEach(input=>{
      if (input.__fc4) return;
      input.__fc4 = true;
      input.addEventListener('change', ()=>{
        const idx = Number(input.closest('[data-shipper-index]')?.dataset.shipperIndex);
        const rows = shipperAdjustments();
        if (!rows[idx]) return;
        rows[idx][input.dataset.shipperField] = input.type === 'number' ? num(input.value) : input.value;
        saveShipperAdjustments(rows);
        render();
      });
    });

    document.querySelectorAll('[data-shipper-delete]').forEach(btn=>{
      if (btn.__fc4) return;
      btn.__fc4 = true;
      btn.addEventListener('click', ()=>{
        const idx = Number(btn.dataset.shipperDelete);
        const rows = shipperAdjustments();
        rows.splice(idx,1);
        saveShipperAdjustments(rows);
        render();
      });
    });
  }

  function ensureStyle(){
    if (document.getElementById('field-capacity-fixed-style')) return;

    const st = document.createElement('style');
    st.id = 'field-capacity-fixed-style';
    st.textContent = `
      #field-capacity-root{font-family:'Meiryo','Yu Gothic',system-ui,sans-serif;color:#0f172a;margin-top:24px}
      .fc4-wrap{display:grid;gap:16px}
      .fc4-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:linear-gradient(180deg,#ffffff,#f8fafc);border:1px solid #e5e7eb;border-radius:20px;padding:18px 20px;box-shadow:0 12px 28px rgba(15,23,42,.06)}
      .fc4-title{font-size:22px;font-weight:950;color:#0f172a}
      .fc4-sub{font-size:12px;color:#64748b;font-weight:850;margin-top:5px}
      .fc4-cond{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .fc4-cond label{font-size:12px;font-weight:950;color:#475569}
      .fc4-cond select{margin-left:6px;border:1px solid #cbd5e1;border-radius:12px;padding:9px 12px;background:#fff;font-weight:900;color:#0f172a}
      .fc4-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}
      .fc4-kpis.small .fc4-kpi b{font-size:21px}
      .fc4-kpi{position:relative;overflow:hidden;background:#fff;border:1px solid #dbe3ee;border-radius:18px;padding:15px 18px;box-shadow:0 10px 24px rgba(15,23,42,.055)}
      .fc4-kpi:before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:#2563eb}
      .fc4-kpi span{display:block;font-size:12px;color:#64748b;font-weight:950;margin-bottom:8px}
      .fc4-kpi b{display:block;font-size:25px;color:#0f172a;font-weight:950;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fc4-kpi em{display:block;margin-top:6px;font-style:normal;font-size:12px;font-weight:950;color:#64748b}
      .fc4-kpi.blue{background:linear-gradient(180deg,#eff6ff,#fff)}.fc4-kpi.green{background:linear-gradient(180deg,#ecfdf5,#fff)}.fc4-kpi.purple{background:linear-gradient(180deg,#f5f3ff,#fff)}
      .fc4-kpi.good{background:linear-gradient(180deg,#ecfdf5,#fff)}.fc4-kpi.ok{background:linear-gradient(180deg,#eff6ff,#fff)}.fc4-kpi.warn{background:linear-gradient(180deg,#fff7ed,#fff)}.fc4-kpi.danger{background:linear-gradient(180deg,#fef2f2,#fff)}
      .fc4-kpi.good:before{background:#16a34a}.fc4-kpi.ok:before{background:#2563eb}.fc4-kpi.warn:before{background:#f97316}.fc4-kpi.danger:before{background:#dc2626}.fc4-kpi.green:before{background:#16a34a}.fc4-kpi.purple:before{background:#7c3aed}
      .fc4-tabs{display:flex;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:12px}
      .fc4-tabs button{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:950;cursor:pointer}
      .fc4-tabs button.active{background:#1d4ed8;border-color:#1d4ed8;color:#fff;box-shadow:0 8px 18px rgba(37,99,235,.22)}
      .fc4-grid{display:grid;grid-template-columns:minmax(620px,1.4fr) minmax(320px,.8fr);gap:16px}
      .fc4-card{background:#fff;border:1px solid #e5e7eb;border-radius:20px;box-shadow:0 12px 28px rgba(15,23,42,.055);overflow:hidden}
      .fc4-card-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
      .fc4-card h3{margin:0;font-size:17px;font-weight:950;color:#0f172a}
      .fc4-card p{margin:5px 0 0;color:#64748b;font-size:12px;font-weight:850}
      .fc4-chips{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .fc4-chips span{display:inline-flex;border-radius:999px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;padding:7px 10px;font-size:12px;font-weight:950}
      .fc4-table-wrap{overflow:auto;max-height:640px}
      .fc4-table{width:100%;border-collapse:collapse;min-width:900px}
      .fc4-table th{background:#f8fafc;color:#334155;font-size:12px;text-align:left;padding:12px 14px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
      .fc4-table td{font-size:13px;color:#0f172a;padding:10px 14px;border-bottom:1px solid #eef2f7;vertical-align:middle}
      .fc4-table .r{text-align:right}
      .fc4-table input,.fc4-table select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;background:#fff;color:#0f172a;font-weight:850}
      .fc4-table tr.fc4-risk-danger td{background:#fff7f7}.fc4-table tr.fc4-risk-warn td{background:#fffaf0}
      .fc4-link{border:0;background:transparent;color:#1d4ed8;font-weight:950;cursor:pointer;padding:0;text-align:left}
      .fc4-badge{display:inline-flex;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:950}
      .fc4-badge.good{background:#dcfce7;color:#166534}.fc4-badge.ok{background:#dbeafe;color:#1e40af}.fc4-badge.warn{background:#ffedd5;color:#9a3412}.fc4-badge.danger{background:#fee2e2;color:#991b1b}
      .fc4-empty,.fc4-error{padding:32px;text-align:center;color:#64748b;font-weight:900}
      .fc4-error{color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:16px}
      .fc4-city-list{display:grid;gap:8px;padding:14px}
      .fc4-city-row{display:grid;grid-template-columns:32px 1fr 80px 90px;gap:8px;align-items:center;border:1px solid #eef2f7;border-radius:12px;padding:9px 10px;background:#fff}
      .fc4-city-row b{width:24px;height:24px;border-radius:999px;background:#eaf3ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;font-size:12px}
      .fc4-city-row span{font-weight:950;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fc4-city-row em{font-style:normal;text-align:right;font-weight:950}.fc4-city-row small{text-align:right;color:#64748b;font-weight:850}
      .fc4-calendar{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:8px;padding:18px 20px;background:#f8fafc}
      .fc4-week{text-align:center;font-size:12px;font-weight:950;color:#475569;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:8px}
      .fc4-week.sun{color:#b91c1c}.fc4-week.sat{color:#1d4ed8}
      .fc4-day{min-height:150px;border:1px solid #e2e8f0;border-radius:16px;padding:10px;background:#fff;display:grid;gap:7px;box-shadow:0 8px 18px rgba(15,23,42,.04)}
      .fc4-day.blank{background:transparent;border:none;box-shadow:none}
      .fc4-day.sun{background:#fff7f7}.fc4-day.sat{background:#eff6ff}
      .fc4-day.holiday{background:#eff6ff}.fc4-day.busy{background:#fff7ed}.fc4-day.limit{background:#fef2f2}.fc4-day.special{background:#f5f3ff}
      .fc4-day-num{display:flex;justify-content:space-between;align-items:center}
      .fc4-day-num b{font-size:20px;font-weight:950}.fc4-day-num span{font-size:11px;color:#64748b;font-weight:950}
      .fc4-day select,.fc4-day input{border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-weight:850;background:#fff;min-width:0}
      .fc4-day label{font-size:11px;color:#475569;font-weight:950;display:grid;gap:4px}
      .fc4-btn,.fc4-mini{border:none;border-radius:12px;font-weight:950;cursor:pointer}.fc4-btn{padding:10px 14px}.fc4-mini{padding:7px 10px;font-size:12px}.fc4-btn.primary{background:#1d4ed8;color:#fff}.fc4-mini.danger{background:#fee2e2;color:#991b1b}
      @media(max-width:1000px){.fc4-header{flex-direction:column}.fc4-kpis{grid-template-columns:repeat(2,minmax(140px,1fr))}.fc4-grid{grid-template-columns:1fr}.fc4-calendar{grid-template-columns:repeat(2,minmax(140px,1fr))}.fc4-week{display:none}}
    `;
    document.head.appendChild(st);
  }

  function install(){
    window.FIELD_CAPACITY_UI = { render };

    if (!window.__fieldCapacityFixedInterval) {
      window.__fieldCapacityFixedInterval = setInterval(()=>{
        if (!isCapacityVisible()) return;
        const el = root();
        if (el && !el.innerHTML.trim()) render();
      }, 600);
    }
  }

  install();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ if (isCapacityVisible()) render(); });
  } else {
    setTimeout(()=>{ if (isCapacityVisible()) render(); },0);
  }
})();
