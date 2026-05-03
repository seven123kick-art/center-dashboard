/* field_capacity.js : キャパ分析 B案・軽量カレンダー版
   2026-05-03

   目的：
   - Out of Memory 回避
   - カレンダー＋色分けまで実装
   - 明細全件の再探索をしない
   - localStorage全件スキャンしない
   - setInterval監視しない

   設計：
   1. データ取得は STATE.productAddressData / STATE.fieldData のみに限定
   2. 初回描画時だけ、CSV行を「月別・日別・地区別」に集計
   3. 画面表示は集計済みデータだけ使用
   4. 日別カレンダーは「日別実績 ÷ 日別キャパ」で色分け
*/
'use strict';

(function(){
  const FLAG = '__FIELD_CAPACITY_B_SAFE_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const LS_MASTER = 'field_capacity_b_master_v1';
  const LS_MAP = 'field_capacity_b_map_v1';
  const LS_CAL = 'field_capacity_b_calendar_v1';
  const LS_STATE = 'field_capacity_b_state_v1';

  const DEFAULT_MASTER = [
    { area:'埼玉_さいたま', weekday:85, weekend:95, memo:'さいたま市各区' },
    { area:'東京_板橋/北', weekday:90, weekend:100, memo:'板橋区・北区' },
    { area:'東京_豊島/文京/練馬', weekday:55, weekend:65, memo:'豊島区・文京区・練馬区' },
    { area:'埼玉_川口/朝霞/和光', weekday:70, weekend:80, memo:'川口・朝霞・和光方面' },
    { area:'埼玉_戸田/蕨', weekday:55, weekend:65, memo:'戸田市・蕨市' },
    { area:'東京_東部', weekday:25, weekend:30, memo:'足立・荒川・台東・墨田・江東方面' },
    { area:'東京_その他', weekday:20, weekend:25, memo:'その他東京' },
    { area:'埼玉_その他', weekday:25, weekend:30, memo:'その他埼玉' },
    { area:'その他', weekday:10, weekend:10, memo:'その他' }
  ];

  const DEFAULT_MAP = [
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
    { key:'normal', label:'通常' },
    { key:'holiday', label:'祝日' },
    { key:'busy', label:'繁忙日' },
    { key:'limit', label:'制限日' },
    { key:'special', label:'特殊日' }
  ];

  let rendering = false;
  let cache = null;
  let lastAreaRows = [];

  function arr(v){ return Array.isArray(v) ? v : []; }
  function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function clean(v){ return String(v ?? '').normalize('NFKC').trim(); }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function num(v){
    const n = Number(String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[^\d.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function pct(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0'; }

  function load(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      return fallback;
    }
  }
  function save(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }

  function todayYM(){
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function normalizeYM(v){
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 6 ? s.slice(0,6) : '';
  }
  function normalizeDate(v, fallbackYM){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    if (s.length >= 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return `${String(fallbackYM).slice(0,4)}-${String(fallbackYM).slice(4,6)}-01`;
  }
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function dateFromYM(ym,d){
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
  function isWeekend(dateStr){
    const d = dow(dateStr);
    return d === 0 || d === 6;
  }

  function getState(){
    const s = load(LS_STATE, {});
    return {
      tab:s.tab || 'summary',
      ym:normalizeYM(s.ym) || latestYM() || todayYM(),
      area:s.area || ''
    };
  }
  function setState(patch){
    save(LS_STATE, { ...getState(), ...patch });
  }

  function master(){
    const m = load(LS_MASTER, null);
    if (!arr(m) || !m.length) {
      save(LS_MASTER, DEFAULT_MASTER);
      return DEFAULT_MASTER.slice();
    }
    return m;
  }
  function saveMaster(rows){
    save(LS_MASTER, rows);
    cache = null;
  }

  function maps(){
    const m = load(LS_MAP, null);
    if (!arr(m) || !m.length) {
      save(LS_MAP, DEFAULT_MAP);
      return DEFAULT_MAP.slice();
    }
    return m;
  }
  function saveMaps(rows){
    save(LS_MAP, rows);
    cache = null;
  }

  function cal(){
    return load(LS_CAL, {});
  }
  function saveCal(v){
    save(LS_CAL, v);
    cache = null;
  }

  function areas(){
    return [...new Set(master().map(r=>clean(r.area)).filter(Boolean))];
  }

  function dataSources(){
    const out = [];

    if (window.STATE) {
      if (arr(STATE.productAddressData)) out.push(['STATE.productAddressData', STATE.productAddressData]);
      if (arr(STATE.fieldData)) out.push(['STATE.fieldData', STATE.fieldData]);
    }

    return out;
  }

  function latestYM(){
    const yms = [];
    dataSources().forEach(([name, src])=>{
      arr(src).forEach(x=>{
        if (obj(x)) {
          const ym = normalizeYM(x.ym || x.month || x.date || x.name);
          if (ym) yms.push(ym);
        }
      });
    });
    yms.sort();
    return yms[yms.length - 1] || '';
  }

  function selectedRawRecord(){
    const s = getState();

    for (const [name, src] of dataSources()) {
      if (!arr(src) || !src.length) continue;

      // 形式A：[{ym,tickets:[...]}]
      const records = src.filter(obj);
      if (records.length) {
        const matched = records.find(x=>normalizeYM(x.ym || x.month || x.date || x.name) === s.ym) || records[records.length - 1];
        const tickets =
          arr(matched.tickets).length ? matched.tickets :
          arr(matched.rows).length ? matched.rows :
          arr(matched.data).length ? matched.data :
          arr(matched.rawRows).length ? matched.rawRows : [];

        if (tickets.length) {
          return {
            ym:normalizeYM(matched.ym || matched.month || matched.date || matched.name) || s.ym,
            source:name,
            tickets
          };
        }
      }

      // 形式B：CSV行配列そのもの
      if (src.some(Array.isArray)) {
        return { ym:s.ym, source:name, tickets:src };
      }
    }

    return null;
  }

  function rawAt(row, idx){
    return Array.isArray(row) ? clean(row[idx]) : '';
  }
  function getVal(row, keys, idx){
    if (Array.isArray(row)) return rawAt(row, idx);
    if (!obj(row)) return '';
    for (const k of keys) {
      if (row[k] !== undefined && clean(row[k]) !== '') return row[k];
    }
    return '';
  }

  function normalizeZip(v){
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }

  function cityFromAddress(address){
    const t = clean(address).replace(/\s+/g,'');
    if (!t) return '未設定';

    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = pref ? t.slice(pref.length) : t;

    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return pref + wardCity[1];

    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return pref + muni[1];

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

    return cityFromAddress(String(hit));
  }

  function ticketSlip(row, idx){
    return clean(getVal(row, ['slip','slipNo','ticketNo','invoiceNo','エスライン原票番号','原票番号'], 8)) || `no_${idx}`;
  }
  function ticketDate(row, ym){
    return normalizeDate(getVal(row, ['date','deliveryDate','completeDate','配達完了日','作業日','日付'], 0), ym);
  }
  function ticketCity(row){
    const zip = normalizeZip(getVal(row, ['zip','zipcode','postalCode','お届け先郵便番号','郵便番号'], 11));
    const zc = cityFromZip(zip);
    if (zc) return zc;

    return cityFromAddress(getVal(row, ['address','お届け先住所','住所','配送先住所'], 13));
  }

  function mappedArea(city){
    const c = clean(city);
    const rules = maps().slice().sort((a,b)=>num(b.priority)-num(a.priority));
    for (const r of rules) {
      const parts = clean(r.pattern).split('|').map(x=>clean(x)).filter(Boolean);
      if (parts.some(p=>c.includes(p))) return r.area || '未分類';
    }
    return '未分類';
  }

  function aggregate(){
    const raw = selectedRawRecord();
    if (!raw) return null;

    const slipSet = new Set();
    const tickets = [];

    arr(raw.tickets).forEach((row, idx)=>{
      const date = ticketDate(row, raw.ym);
      const slip = ticketSlip(row, idx);
      const key = `${date}_${slip}`;
      if (slipSet.has(key)) return;
      slipSet.add(key);

      const city = ticketCity(row);
      const area = mappedArea(city);
      tickets.push({ date, slip, city, area });
    });

    const byArea = new Map();
    const byDateArea = new Map();

    tickets.forEach(t=>{
      if (!byArea.has(t.area)) byArea.set(t.area, { area:t.area, count:0, cities:new Map() });
      const ar = byArea.get(t.area);
      ar.count++;
      ar.cities.set(t.city, (ar.cities.get(t.city) || 0) + 1);

      const dk = `${t.date}_${t.area}`;
      if (!byDateArea.has(dk)) byDateArea.set(dk, { date:t.date, area:t.area, count:0, cities:new Map() });
      const dr = byDateArea.get(dk);
      dr.count++;
      dr.cities.set(t.city, (dr.cities.get(t.city) || 0) + 1);
    });

    return {
      ym:raw.ym,
      source:raw.source,
      rawCount:arr(raw.tickets).length,
      ticketCount:tickets.length,
      byArea,
      byDateArea
    };
  }

  function getAgg(){
    const s = getState();
    if (cache && cache.ym === s.ym) return cache;
    cache = aggregate();
    return cache;
  }

  function calType(dateStr){
    return cal()[dateStr]?.type || 'normal';
  }
  function calAdj(dateStr){
    return num(cal()[dateStr]?.adjust || 0);
  }

  function baseDailyCap(dateStr, area){
    const row = master().find(r=>r.area === area);
    if (!row) return 0;
    const holiday = isWeekend(dateStr) || calType(dateStr) === 'holiday';
    return holiday ? num(row.weekend) : num(row.weekday);
  }
  function dailyCap(dateStr, area){
    return Math.max(0, baseDailyCap(dateStr, area) + calAdj(dateStr));
  }
  function monthlyCap(ym, area){
    let total = 0;
    for (let d=1; d<=daysInYM(ym); d++) {
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

  function areaRows(){
    const ag = getAgg();
    if (!ag) return [];

    const allAreas = [...new Set([...areas(), ...ag.byArea.keys()])];

    return allAreas.map(area=>{
      const hit = ag.byArea.get(area) || { area, count:0, cities:new Map() };
      const cap = monthlyCap(ag.ym, area);
      const j = judge(hit.count, cap);

      return {
        area,
        count:hit.count,
        oneDay:baseDailyCap(dateFromYM(ag.ym,1), area),
        cap,
        rate:j.rate,
        judge:j.label,
        cls:j.cls,
        cities:[...hit.cities.entries()].map(([city,count])=>({city,count})).sort((a,b)=>b.count-a.count)
      };
    }).sort((a,b)=>b.rate-a.rate || b.count-a.count);
  }

  function dailyRows(){
    const ag = getAgg();
    if (!ag) return [];

    const risk = { danger:4, warn:3, ok:2, good:1 };

    return [...ag.byDateArea.values()].map(r=>{
      const cap = dailyCap(r.date, r.area);
      const j = judge(r.count, cap);

      return {
        date:r.date,
        area:r.area,
        count:r.count,
        cap,
        rate:j.rate,
        judge:j.label,
        cls:j.cls,
        cities:[...r.cities.entries()].map(([city,count])=>({city,count})).sort((a,b)=>b.count-a.count)
      };
    }).sort((a,b)=>(risk[b.cls]||0)-(risk[a.cls]||0) || b.rate-a.rate);
  }

  function root(){
    let el = document.getElementById('field-capacity-root');
    if (el) return el;

    const view =
      document.getElementById('view-field-capacity') ||
      document.getElementById('view-capacity') ||
      document.querySelector('[data-view="field-capacity"]') ||
      document.querySelector('[data-view="capacity"]') ||
      document.querySelector('.view.active');

    if (!view) return null;

    el = document.createElement('div');
    el.id = 'field-capacity-root';
    view.appendChild(el);
    return el;
  }

  function render(){
    if (rendering) return;
    rendering = true;
    ensureStyle();

    try {
      const el = root();
      if (!el) return;

      const s = getState();
      const ag = getAgg();
      const rows = areaRows();
      const dRows = dailyRows();
      lastAreaRows = rows;

      el.innerHTML = `
        <div class="capb">
          ${headerHtml(ag, rows, dRows)}
          ${tabsHtml(s)}
          ${s.tab === 'summary' ? summaryHtml(ag, rows) : ''}
          ${s.tab === 'daily' ? dailyHtml(ag, dRows) : ''}
          ${s.tab === 'calendar' ? calendarHtml(s, dRows) : ''}
          ${s.tab === 'mapping' ? mappingHtml() : ''}
          ${s.tab === 'master' ? masterHtml() : ''}
        </div>
      `;

      bind();
    } catch(e) {
      console.error('[field_capacity]', e);
      const el = root();
      if (el) el.innerHTML = `<div class="capb-error">キャパ分析エラー：${esc(e.message || e)}</div>`;
    } finally {
      rendering = false;
    }
  }

  function headerHtml(ag, rows, dRows){
    const used = rows.reduce((s,r)=>s+r.count,0);
    const cap = rows.reduce((s,r)=>s+r.cap,0);
    const j = judge(used, cap);
    const over = dRows.filter(r=>r.rate > 100).length;

    return `
      <div class="capb-head">
        <div>
          <h2>キャパ分析</h2>
          <p>月キャパ・日別超過・カレンダー色分けを軽量集計で表示します。</p>
        </div>
        <div class="capb-kpis">
          <div><span>実績件数</span><b>${fmt(used)}件</b></div>
          <div><span>月キャパ</span><b>${fmt(cap)}件</b></div>
          <div class="${esc(j.cls)}"><span>月使用率</span><b>${pct(j.rate)}%</b><em>${esc(j.label)}</em></div>
          <div><span>日別超過</span><b>${fmt(over)}件</b><em>100%超</em></div>
        </div>
        <div class="capb-src">対象データ：${ag ? `${esc(ymText(ag.ym))} / ${fmt(ag.rawCount)}行 / ${esc(ag.source)}` : '未取得'}</div>
      </div>
    `;
  }

  function tabsHtml(s){
    const tabs = [
      ['summary','月別使用状況'],
      ['daily','日別超過'],
      ['calendar','カレンダー'],
      ['mapping','地区マッピング'],
      ['master','通常キャパ']
    ];

    return `<div class="capb-tabs">${tabs.map(([k,l])=>`
      <button type="button" class="${s.tab===k?'active':''}" data-capb-tab="${k}">${esc(l)}</button>
    `).join('')}</div>`;
  }

  function summaryHtml(ag, rows){
    if (!ag) return `<div class="capb-card empty">CSV実績データが見つかりません。先に配送エリアCSVを読み込んでください。</div>`;

    return `
      <div class="capb-grid">
        <div class="capb-card">
          <h3>地区別 月キャパ使用状況</h3>
          <table>
            <thead>
              <tr><th>地区</th><th class="r">実績</th><th class="r">1日基準</th><th class="r">月キャパ</th><th class="r">使用率</th><th>判定</th></tr>
            </thead>
            <tbody>
              ${rows.map((r,i)=>`
                <tr>
                  <td><button class="link" data-capb-detail="${i}">${esc(r.area)}</button></td>
                  <td class="r"><b>${fmt(r.count)}</b></td>
                  <td class="r">${fmt(r.oneDay)}</td>
                  <td class="r">${fmt(r.cap)}</td>
                  <td class="r">${pct(r.rate)}%</td>
                  <td><span class="badge ${esc(r.cls)}">${esc(r.judge)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="capb-card">
          <h3>市区町村内訳</h3>
          <div id="capb-detail" class="empty">地区をクリックしてください</div>
        </div>
      </div>
    `;
  }

  function dailyHtml(ag, rows){
    if (!ag) return `<div class="capb-card empty">CSV実績データが見つかりません。</div>`;

    return `
      <div class="capb-card">
        <h3>日別キャパ超過チェック</h3>
        <table>
          <thead>
            <tr><th>日付</th><th>地区</th><th class="r">実績</th><th class="r">日キャパ</th><th class="r">使用率</th><th>判定</th><th>主な市区町村</th></tr>
          </thead>
          <tbody>
            ${rows.map(r=>`
              <tr class="risk-${esc(r.cls)}">
                <td>${esc(r.date)}（${esc(dowLabel(r.date))}）</td>
                <td>${esc(r.area)}</td>
                <td class="r"><b>${fmt(r.count)}</b></td>
                <td class="r">${fmt(r.cap)}</td>
                <td class="r">${pct(r.rate)}%</td>
                <td><span class="badge ${esc(r.cls)}">${esc(r.judge)}</span></td>
                <td>${esc(r.cities.slice(0,3).map(c=>`${c.city} ${c.count}件`).join(' / ') || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function calendarHtml(s, dRows){
    const ym = getAgg()?.ym || s.ym;
    const last = daysInYM(ym);
    const firstDow = dow(dateFromYM(ym,1));
    const cells = [];
    const dayRisk = new Map();

    dRows.forEach(r=>{
      const prev = dayRisk.get(r.date);
      if (!prev || r.rate > prev.rate) dayRisk.set(r.date, r);
    });

    for (let i=0; i<firstDow; i++) cells.push(null);
    for (let d=1; d<=last; d++) cells.push(dateFromYM(ym,d));
    while (cells.length % 7 !== 0) cells.push(null);

    return `
      <div class="capb-card">
        <h3>カレンダー（日別超過＋補正）</h3>
        <div class="capb-calendar">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<div class="week ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}
          ${cells.map(date=>{
            if (!date) return `<div class="day blank"></div>`;
            const c = cal()[date] || {};
            const risk = dayRisk.get(date);
            const cls = risk ? risk.cls : (isWeekend(date) ? 'weekend' : '');
            return `
              <div class="day ${esc(cls)}">
                <div class="daytop">
                  <b>${Number(date.slice(8,10))}</b>
                  <span>${risk ? `${fmt(risk.count)}件 / ${pct(risk.rate)}%` : '0件'}</span>
                </div>
                <select data-cal-date="${date}" data-cal-field="type">
                  ${DAY_TYPES.map(t=>`<option value="${t.key}" ${(c.type || 'normal')===t.key?'selected':''}>${esc(t.label)}</option>`).join('')}
                </select>
                <input type="number" data-cal-date="${date}" data-cal-field="adjust" value="${esc(c.adjust || 0)}" placeholder="補正">
                <input data-cal-date="${date}" data-cal-field="memo" value="${esc(c.memo || '')}" placeholder="メモ">
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function mappingHtml(){
    const rows = maps().slice().sort((a,b)=>num(b.priority)-num(a.priority));

    return `
      <div class="capb-card">
        <h3>地区マッピング</h3>
        <button id="capb-add-map">＋ ルール追加</button>
        <table>
          <thead><tr><th>優先</th><th>含む文字</th><th>キャパ地区</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-map-index="${i}">
                <td><input type="number" data-map-field="priority" value="${esc(r.priority)}"></td>
                <td><input data-map-field="pattern" value="${esc(r.pattern)}"></td>
                <td><input data-map-field="area" value="${esc(r.area)}"></td>
                <td><button data-map-delete="${i}">削除</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function masterHtml(){
    const rows = master();

    return `
      <div class="capb-card">
        <h3>通常キャパ</h3>
        <button id="capb-add-master">＋ 行追加</button>
        <table>
          <thead><tr><th>地区</th><th class="r">平日</th><th class="r">土日祝</th><th>メモ</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-master-index="${i}">
                <td><input data-master-field="area" value="${esc(r.area)}"></td>
                <td><input type="number" data-master-field="weekday" value="${esc(r.weekday)}"></td>
                <td><input type="number" data-master-field="weekend" value="${esc(r.weekend)}"></td>
                <td><input data-master-field="memo" value="${esc(r.memo)}"></td>
                <td><button data-master-delete="${i}">削除</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bind(){
    document.querySelectorAll('[data-capb-tab]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        setState({ tab:btn.dataset.capbTab });
        render();
      });
    });

    document.querySelectorAll('[data-capb-detail]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const row = lastAreaRows[Number(btn.dataset.capbDetail)];
        const box = document.getElementById('capb-detail');
        if (!box || !row) return;
        box.innerHTML = row.cities.length
          ? row.cities.map((c,i)=>`<div class="cityrow"><b>${i+1}</b><span>${esc(c.city)}</span><em>${fmt(c.count)}件</em></div>`).join('')
          : '<div class="empty">該当なし</div>';
      });
    });

    document.querySelectorAll('[data-cal-date]').forEach(input=>{
      input.addEventListener('change', ()=>{
        const date = input.dataset.calDate;
        const field = input.dataset.calField;
        const c = cal();
        c[date] = c[date] || {};
        c[date][field] = input.type === 'number' ? num(input.value) : input.value;
        saveCal(c);
        render();
      });
    });

    const addMap = document.getElementById('capb-add-map');
    if (addMap) addMap.addEventListener('click', ()=>{
      const rows = maps();
      rows.push({ pattern:'', area:'未分類', priority:1 });
      saveMaps(rows);
      render();
    });

    document.querySelectorAll('[data-map-field]').forEach(input=>{
      input.addEventListener('change', ()=>{
        const rows = maps().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        const idx = Number(input.closest('[data-map-index]').dataset.mapIndex);
        rows[idx][input.dataset.mapField] = input.type === 'number' ? num(input.value) : input.value;
        saveMaps(rows);
        render();
      });
    });

    document.querySelectorAll('[data-map-delete]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const rows = maps().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        rows.splice(Number(btn.dataset.mapDelete),1);
        saveMaps(rows);
        render();
      });
    });

    const addMaster = document.getElementById('capb-add-master');
    if (addMaster) addMaster.addEventListener('click', ()=>{
      const rows = master();
      rows.push({ area:'', weekday:0, weekend:0, memo:'' });
      saveMaster(rows);
      render();
    });

    document.querySelectorAll('[data-master-field]').forEach(input=>{
      input.addEventListener('change', ()=>{
        const rows = master();
        const idx = Number(input.closest('[data-master-index]').dataset.masterIndex);
        rows[idx][input.dataset.masterField] = input.type === 'number' ? num(input.value) : input.value;
        saveMaster(rows);
        render();
      });
    });

    document.querySelectorAll('[data-master-delete]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const rows = master();
        rows.splice(Number(btn.dataset.masterDelete),1);
        saveMaster(rows);
        render();
      });
    });
  }

  function ensureStyle(){
    if (document.getElementById('capb-style')) return;

    const st = document.createElement('style');
    st.id = 'capb-style';
    st.textContent = `
      #field-capacity-root{margin-top:24px}
      .capb{display:grid;gap:14px;font-family:'Meiryo','Yu Gothic',sans-serif;color:#0f172a}
      .capb-head,.capb-card,.capb-tabs{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 10px 24px rgba(15,23,42,.05)}
      .capb-head{padding:18px 20px}
      .capb-head h2{margin:0;font-size:22px;font-weight:950}
      .capb-head p{margin:4px 0 0;color:#64748b;font-size:12px;font-weight:850}
      .capb-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-top:14px}
      .capb-kpis>div{border:1px solid #dbe3ee;border-radius:16px;padding:14px;background:linear-gradient(180deg,#f8fafc,#fff)}
      .capb-kpis .danger{background:#fef2f2}.capb-kpis .warn{background:#fff7ed}.capb-kpis .good{background:#ecfdf5}
      .capb-kpis span{display:block;color:#64748b;font-size:12px;font-weight:950;margin-bottom:6px}
      .capb-kpis b{font-size:24px;font-weight:950}.capb-kpis em{display:block;font-style:normal;color:#64748b;font-size:12px;font-weight:900;margin-top:4px}
      .capb-src{margin-top:10px;color:#64748b;font-size:12px;font-weight:850}
      .capb-tabs{padding:12px;display:flex;gap:10px;flex-wrap:wrap}
      .capb-tabs button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:10px 16px;font-weight:950;cursor:pointer}
      .capb-tabs button.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
      .capb-grid{display:grid;grid-template-columns:minmax(620px,1.4fr) minmax(320px,.8fr);gap:14px}
      .capb-card{padding:18px 20px;overflow:auto}
      .capb-card h3{margin:0 0 12px;font-size:17px;font-weight:950}
      table{width:100%;border-collapse:collapse;min-width:780px}
      th{background:#f8fafc;color:#334155;text-align:left;font-size:12px;padding:11px;border-bottom:1px solid #e5e7eb}
      td{padding:10px 11px;border-bottom:1px solid #eef2f7;font-size:13px}
      .r{text-align:right}
      input,select{border:1px solid #cbd5e1;border-radius:10px;padding:8px 9px;font-weight:850}
      button.link{border:0;background:transparent;color:#1d4ed8;font-weight:950;cursor:pointer}
      .badge{border-radius:999px;padding:5px 9px;font-size:12px;font-weight:950}
      .badge.good{background:#dcfce7;color:#166534}.badge.ok{background:#dbeafe;color:#1e40af}.badge.warn{background:#ffedd5;color:#9a3412}.badge.danger{background:#fee2e2;color:#991b1b}
      tr.risk-danger td{background:#fff7f7}tr.risk-warn td{background:#fffaf0}
      .empty{text-align:center;color:#64748b;font-weight:900;padding:24px}
      .cityrow{display:grid;grid-template-columns:32px 1fr 70px;gap:8px;border:1px solid #eef2f7;border-radius:12px;padding:8px 10px;margin-bottom:7px}
      .cityrow b{color:#1d4ed8}.cityrow span{font-weight:900}.cityrow em{text-align:right;font-style:normal;font-weight:900}
      .capb-calendar{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:14px}
      .week{text-align:center;font-weight:950;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px}.week.sun{color:#b91c1c}.week.sat{color:#1d4ed8}
      .day{min-height:140px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:9px;display:grid;gap:7px}
      .day.weekend{background:#eff6ff}.day.good{background:#ecfdf5}.day.ok{background:#eff6ff}.day.warn{background:#fff7ed}.day.danger{background:#fef2f2}.day.blank{background:transparent;border:0}
      .daytop{display:flex;justify-content:space-between;gap:8px}.daytop b{font-size:18px}.daytop span{font-size:11px;font-weight:900;color:#64748b}
      @media(max-width:900px){.capb-grid{grid-template-columns:1fr}.capb-kpis{grid-template-columns:repeat(2,1fr)}.capb-calendar{grid-template-columns:repeat(2,1fr)}.week{display:none}}
    `;
    document.head.appendChild(st);
  }

  window.FIELD_CAPACITY_UI = { render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    setTimeout(render, 0);
  }
})();
