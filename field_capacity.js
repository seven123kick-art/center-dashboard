/* field_capacity.js : キャパ分析 軽量復旧版
   2026-05-03
   目的：
   - Out of Memory 回避
   - 既存キャパ画面を壊さず、下部に軽量UIを追加
   - localStorage全件スキャン禁止
   - 日別カレンダー補正・月キャパ・日別超過の土台を維持
*/
'use strict';

(function(){
  const FLAG = '__FIELD_CAPACITY_SAFE_20260503__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const LS_MASTER = 'field_capacity_master_safe_v1';
  const LS_MAPPING = 'field_capacity_mapping_safe_v1';
  const LS_CALENDAR = 'field_capacity_calendar_safe_v1';
  const LS_STATE = 'field_capacity_state_safe_v1';

  const DEFAULT_MASTER = [
    { area:'埼玉_さいたま', weekday:85, weekend:95, memo:'さいたま市各区' },
    { area:'東京_板橋/北', weekday:90, weekend:100, memo:'板橋区・北区' },
    { area:'東京_豊島/文京/練馬', weekday:55, weekend:65, memo:'豊島区・文京区・練馬区' },
    { area:'埼玉_川口/朝霞/和光', weekday:70, weekend:80, memo:'川口市・朝霞市・和光市' },
    { area:'埼玉_戸田/蕨', weekday:55, weekend:65, memo:'戸田市・蕨市' },
    { area:'東京_東部', weekday:25, weekend:30, memo:'足立・荒川・台東・墨田・江東' },
    { area:'東京_その他', weekday:20, weekend:25, memo:'その他東京' },
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
    { key:'normal', label:'通常' },
    { key:'holiday', label:'祝日' },
    { key:'busy', label:'繁忙日' },
    { key:'limit', label:'制限日' },
    { key:'special', label:'特殊日' }
  ];

  let rendering = false;
  let lastRows = [];

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
  function ymText(ym){
    const y = String(ym || '').slice(0,4);
    const m = Number(String(ym || '').slice(4,6));
    return y && m ? `${y}年${m}月` : '—';
  }
  function dateFromYM(ym, d){
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
  function isWeekend(dateStr){
    const d = dow(dateStr);
    return d === 0 || d === 6;
  }

  function getState(){
    const s = load(LS_STATE, {});
    return {
      tab:s.tab || 'usage',
      ym:normalizeYM(s.ym) || getSafeLatestYM() || todayYM(),
      area:s.area || ''
    };
  }
  function setState(patch){
    save(LS_STATE, { ...getState(), ...patch });
  }

  function master(){
    const rows = load(LS_MASTER, null);
    if (!arr(rows) || !rows.length) {
      save(LS_MASTER, DEFAULT_MASTER);
      return DEFAULT_MASTER.slice();
    }
    return rows;
  }
  function saveMaster(rows){ save(LS_MASTER, rows); }

  function mappings(){
    const rows = load(LS_MAPPING, null);
    if (!arr(rows) || !rows.length) {
      save(LS_MAPPING, DEFAULT_MAPPING);
      return DEFAULT_MAPPING.slice();
    }
    return rows;
  }
  function saveMappings(rows){ save(LS_MAPPING, rows); }

  function calendar(){ return load(LS_CALENDAR, {}); }
  function saveCalendar(v){ save(LS_CALENDAR, v); }

  function areas(){
    return [...new Set(master().map(r=>clean(r.area)).filter(Boolean))];
  }

  function getSafeLatestYM(){
    const st = normalizeYM(window.STATE?.selYM || window.STATE?.currentYM || window.STATE?.ym);
    if (st) return st;

    const candidates = [
      window.STATE?.productAddressData,
      window.STATE?.fieldData
    ];

    for (const c of candidates) {
      if (arr(c) && c.length) {
        const ym = normalizeYM(c[c.length - 1]?.ym || c[c.length - 1]?.month || c[c.length - 1]?.date);
        if (ym) return ym;
      }
    }

    return '';
  }

  function getRecord(){
    const s = getState();

    const sources = [
      ['STATE.productAddressData', window.STATE?.productAddressData],
      ['STATE.fieldData', window.STATE?.fieldData]
    ];

    for (const [name, src] of sources) {
      if (!arr(src) || !src.length) continue;

      const records = src.filter(x=>obj(x));
      const matched = records.find(x=>normalizeYM(x.ym || x.month || x.date) === s.ym) || records[records.length - 1];

      if (matched) {
        const tickets = arr(matched.tickets).length ? matched.tickets :
          arr(matched.rows).length ? matched.rows :
          arr(matched.data).length ? matched.data :
          arr(matched.rawRows).length ? matched.rawRows : [];

        if (tickets.length) return { ym:normalizeYM(matched.ym || matched.month || matched.date) || s.ym, tickets, source:name };
      }

      // 配列そのものがCSV行の場合
      if (src.some(x=>Array.isArray(x))) {
        return { ym:s.ym, tickets:src, source:name };
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
  function normalizeDate(v, fallbackYM){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    if (s.length >= 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return dateFromYM(fallbackYM || getState().ym, 1);
  }
  function normalizeZip(v){
    if (window.JP_ZIP_LOADER && JP_ZIP_LOADER.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }

  function cityFromAddress(address){
    const t = clean(address).replace(/\s+/g,'');
    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = pref ? t.slice(pref.length) : t;
    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return pref + wardCity[1];
    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return pref + muni[1];
    return pref + rest.slice(0,8);
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

  function ticketSlip(t, idx){
    return clean(getVal(t, ['slip','slipNo','ticketNo','invoiceNo','エスライン原票番号','原票番号'], 8)) || `no_${idx}`;
  }
  function ticketDate(t, ym){
    return normalizeDate(getVal(t, ['date','deliveryDate','completeDate','配達完了日','作業日','日付'], 0), ym);
  }
  function ticketCity(t){
    const zip = normalizeZip(getVal(t, ['zip','zipcode','postalCode','お届け先郵便番号','郵便番号'], 11));
    const byZip = cityFromZip(zip);
    if (byZip) return byZip;

    const addr = getVal(t, ['address','お届け先住所','住所','配送先住所'], 13);
    return cityFromAddress(addr) || '未設定';
  }

  function mappedArea(city){
    const c = clean(city);
    const rules = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
    for (const r of rules) {
      const parts = clean(r.pattern).split('|').map(clean).filter(Boolean);
      if (parts.some(p=>c.includes(p))) return r.area || '未分類';
    }
    return '未分類';
  }

  function uniqueTickets(record){
    const map = new Map();
    arr(record?.tickets).forEach((t,idx)=>{
      const slip = ticketSlip(t, idx);
      const date = ticketDate(t, record.ym);
      const key = `${date}_${slip}`;
      const city = ticketCity(t);
      const area = mappedArea(city);

      if (!map.has(key)) map.set(key, { date, slip, city, area, count:1 });
    });
    return [...map.values()];
  }

  function calType(dateStr){
    return calendar()[dateStr]?.type || 'normal';
  }
  function calAdj(dateStr){
    return num(calendar()[dateStr]?.adjust || 0);
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

  function usageRows(record){
    const tickets = uniqueTickets(record);
    const byArea = new Map();

    tickets.forEach(t=>{
      if (!byArea.has(t.area)) byArea.set(t.area, { area:t.area, count:0, cities:new Map() });
      const r = byArea.get(t.area);
      r.count++;
      r.cities.set(t.city, (r.cities.get(t.city) || 0) + 1);
    });

    const allAreas = [...new Set([...areas(), ...byArea.keys()])];

    return allAreas.map(area=>{
      const hit = byArea.get(area) || { area, count:0, cities:new Map() };
      const cap = monthlyCap(record.ym, area);
      const j = judge(hit.count, cap);
      return {
        area,
        count:hit.count,
        cap,
        oneDay:baseDailyCap(dateFromYM(record.ym,1), area),
        rate:j.rate,
        judge:j.label,
        cls:j.cls,
        cities:[...hit.cities.entries()].map(([city,count])=>({city,count})).sort((a,b)=>b.count-a.count)
      };
    }).sort((a,b)=>b.rate-a.rate || b.count-a.count);
  }

  function dailyRows(record){
    const tickets = uniqueTickets(record);
    const by = new Map();

    tickets.forEach(t=>{
      const key = `${t.date}_${t.area}`;
      if (!by.has(key)) by.set(key, { date:t.date, area:t.area, count:0, cities:new Map() });
      const r = by.get(key);
      r.count++;
      r.cities.set(t.city, (r.cities.get(t.city) || 0) + 1);
    });

    const risk = { danger:4, warn:3, ok:2, good:1 };

    return [...by.values()].map(r=>{
      const cap = dailyCap(r.date, r.area);
      const j = judge(r.count, cap);
      return {
        ...r,
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

  async function render(){
    if (rendering) return;
    rendering = true;
    ensureStyle();

    try {
      const el = root();
      if (!el) return;

      const s = getState();
      const record = getRecord();

      const rows = record ? usageRows(record) : [];
      const dRows = record ? dailyRows(record) : [];
      lastRows = rows;

      el.innerHTML = `
        <div class="fc-safe">
          ${headerHtml(record, rows, dRows)}
          ${tabsHtml(s)}
          ${s.tab === 'usage' ? usageHtml(record, rows) : ''}
          ${s.tab === 'daily' ? dailyHtml(record, dRows) : ''}
          ${s.tab === 'calendar' ? calendarHtml(s) : ''}
          ${s.tab === 'mapping' ? mappingHtml(record) : ''}
          ${s.tab === 'master' ? masterHtml() : ''}
        </div>
      `;

      bind();
    } catch(e) {
      console.error(e);
      const el = root();
      if (el) el.innerHTML = `<div class="fc-error">キャパ分析エラー：${esc(e.message || e)}</div>`;
    } finally {
      rendering = false;
    }
  }

  function headerHtml(record, rows, dRows){
    const used = rows.reduce((s,r)=>s+r.count,0);
    const cap = rows.reduce((s,r)=>s+r.cap,0);
    const j = judge(used, cap);
    const over = dRows.filter(r=>r.rate > 100).length;

    return `
      <div class="fc-head">
        <div>
          <h2>キャパ分析</h2>
          <p>月キャパと日別超過を分けて確認します。</p>
        </div>
        <div class="fc-kpis">
          <div><span>実績</span><b>${fmt(used)}件</b></div>
          <div><span>月キャパ</span><b>${fmt(cap)}件</b></div>
          <div><span>月使用率</span><b>${pct(j.rate)}%</b><em>${esc(j.label)}</em></div>
          <div><span>日別超過</span><b>${fmt(over)}件</b></div>
        </div>
      </div>
    `;
  }

  function tabsHtml(s){
    const tabs = [
      ['usage','月別使用状況'],
      ['daily','日別超過'],
      ['calendar','日別カレンダー補正'],
      ['mapping','地区マッピング'],
      ['master','通常キャパ']
    ];
    return `<div class="fc-tabs">${tabs.map(([k,l])=>`<button type="button" class="${s.tab===k?'active':''}" data-fc-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  function usageHtml(record, rows){
    if (!record) return `<div class="fc-card empty">CSV実績データが見つかりません。先に配送エリアCSVを読み込んでください。</div>`;

    return `
      <div class="fc-grid">
        <div class="fc-card">
          <h3>月別キャパ使用状況</h3>
          <table>
            <thead><tr><th>地区</th><th>実績</th><th>1日基準</th><th>月キャパ</th><th>使用率</th><th>判定</th></tr></thead>
            <tbody>${rows.map((r,i)=>`
              <tr>
                <td><button class="link" data-detail="${i}">${esc(r.area)}</button></td>
                <td>${fmt(r.count)}</td>
                <td>${fmt(r.oneDay)}</td>
                <td>${fmt(r.cap)}</td>
                <td>${pct(r.rate)}%</td>
                <td><span class="badge ${r.cls}">${esc(r.judge)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="fc-card">
          <h3>市区町村内訳</h3>
          <div id="fc-detail" class="empty">地区をクリックしてください</div>
        </div>
      </div>
    `;
  }

  function dailyHtml(record, rows){
    if (!record) return `<div class="fc-card empty">CSV実績データが見つかりません。</div>`;
    return `
      <div class="fc-card">
        <h3>日別キャパ超過チェック</h3>
        <table>
          <thead><tr><th>日付</th><th>地区</th><th>実績</th><th>日キャパ</th><th>使用率</th><th>判定</th><th>主な市区町村</th></tr></thead>
          <tbody>${rows.map(r=>`
            <tr class="risk-${r.cls}">
              <td>${esc(r.date)}</td>
              <td>${esc(r.area)}</td>
              <td>${fmt(r.count)}</td>
              <td>${fmt(r.cap)}</td>
              <td>${pct(r.rate)}%</td>
              <td><span class="badge ${r.cls}">${esc(r.judge)}</span></td>
              <td>${esc(r.cities.slice(0,3).map(c=>`${c.city} ${c.count}件`).join(' / '))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function calendarHtml(s){
    const ym = s.ym;
    const last = daysInYM(ym);
    const first = dow(dateFromYM(ym,1));
    const cal = calendar();
    const cells = [];
    for (let i=0; i<first; i++) cells.push(null);
    for (let d=1; d<=last; d++) cells.push(dateFromYM(ym,d));
    while (cells.length % 7) cells.push(null);

    return `
      <div class="fc-card">
        <h3>日別カレンダー補正</h3>
        <div class="cal-grid">
          ${['日','月','火','水','木','金','土'].map(d=>`<div class="week">${d}</div>`).join('')}
          ${cells.map(date=>{
            if (!date) return `<div class="day blank"></div>`;
            const row = cal[date] || {};
            return `
              <div class="day ${isWeekend(date)?'weekend':''}">
                <b>${Number(date.slice(8,10))}</b>
                <select data-cal-date="${date}" data-cal-field="type">
                  ${DAY_TYPES.map(t=>`<option value="${t.key}" ${(row.type||'normal')===t.key?'selected':''}>${t.label}</option>`).join('')}
                </select>
                <input type="number" data-cal-date="${date}" data-cal-field="adjust" value="${esc(row.adjust || 0)}" placeholder="補正">
                <input data-cal-date="${date}" data-cal-field="memo" value="${esc(row.memo || '')}" placeholder="メモ">
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function mappingHtml(record){
    const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
    return `
      <div class="fc-card">
        <h3>地区マッピング</h3>
        <button id="add-map">＋ ルール追加</button>
        <table>
          <thead><tr><th>優先</th><th>含む文字</th><th>地区</th><th></th></tr></thead>
          <tbody>${rows.map((r,i)=>`
            <tr data-map-index="${i}">
              <td><input type="number" data-map-field="priority" value="${esc(r.priority)}"></td>
              <td><input data-map-field="pattern" value="${esc(r.pattern)}"></td>
              <td><input data-map-field="area" value="${esc(r.area)}"></td>
              <td><button data-map-delete="${i}">削除</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function masterHtml(){
    const rows = master();
    return `
      <div class="fc-card">
        <h3>通常キャパ</h3>
        <button id="add-master">＋ 行追加</button>
        <table>
          <thead><tr><th>地区</th><th>平日</th><th>土日祝</th><th>メモ</th><th></th></tr></thead>
          <tbody>${rows.map((r,i)=>`
            <tr data-master-index="${i}">
              <td><input data-master-field="area" value="${esc(r.area)}"></td>
              <td><input type="number" data-master-field="weekday" value="${esc(r.weekday)}"></td>
              <td><input type="number" data-master-field="weekend" value="${esc(r.weekend)}"></td>
              <td><input data-master-field="memo" value="${esc(r.memo)}"></td>
              <td><button data-master-delete="${i}">削除</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bind(){
    document.querySelectorAll('[data-fc-tab]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ setState({ tab:btn.dataset.fcTab }); render(); });
    });

    document.querySelectorAll('[data-detail]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const r = lastRows[Number(btn.dataset.detail)];
        const box = document.getElementById('fc-detail');
        if (!box || !r) return;
        box.innerHTML = `<div>${r.cities.map((c,i)=>`<p><b>${i+1}</b> ${esc(c.city)} ${fmt(c.count)}件</p>`).join('')}</div>`;
      });
    });

    document.querySelectorAll('[data-cal-date]').forEach(input=>{
      input.addEventListener('change', ()=>{
        const cal = calendar();
        const date = input.dataset.calDate;
        cal[date] = cal[date] || {};
        cal[date][input.dataset.calField] = input.type === 'number' ? num(input.value) : input.value;
        saveCalendar(cal);
        render();
      });
    });

    const addMap = document.getElementById('add-map');
    if (addMap) addMap.addEventListener('click', ()=>{
      const rows = mappings();
      rows.push({ pattern:'', area:'未分類', priority:1 });
      saveMappings(rows);
      render();
    });

    document.querySelectorAll('[data-map-field]').forEach(input=>{
      input.addEventListener('change', ()=>{
        const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        const idx = Number(input.closest('[data-map-index]').dataset.mapIndex);
        rows[idx][input.dataset.mapField] = input.type === 'number' ? num(input.value) : input.value;
        saveMappings(rows);
        render();
      });
    });

    document.querySelectorAll('[data-map-delete]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const rows = mappings().slice().sort((a,b)=>num(b.priority)-num(a.priority));
        rows.splice(Number(btn.dataset.mapDelete),1);
        saveMappings(rows);
        render();
      });
    });

    const addMaster = document.getElementById('add-master');
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
    if (document.getElementById('field-capacity-safe-style')) return;
    const st = document.createElement('style');
    st.id = 'field-capacity-safe-style';
    st.textContent = `
      #field-capacity-root{margin-top:24px}
      .fc-safe{display:grid;gap:14px;font-family:'Meiryo','Yu Gothic',sans-serif;color:#0f172a}
      .fc-head,.fc-card,.fc-tabs{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 10px 24px rgba(15,23,42,.05)}
      .fc-head{padding:18px 20px;display:grid;gap:12px}
      .fc-head h2{margin:0;font-size:22px;font-weight:950}
      .fc-head p{margin:4px 0 0;color:#64748b;font-size:12px;font-weight:850}
      .fc-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px}
      .fc-kpis>div{border:1px solid #dbe3ee;border-radius:16px;padding:14px;background:linear-gradient(180deg,#f8fafc,#fff)}
      .fc-kpis span{display:block;color:#64748b;font-size:12px;font-weight:950;margin-bottom:6px}
      .fc-kpis b{font-size:24px;font-weight:950}
      .fc-kpis em{display:block;font-style:normal;color:#64748b;font-size:12px;font-weight:900;margin-top:4px}
      .fc-tabs{padding:12px;display:flex;gap:10px;flex-wrap:wrap}
      .fc-tabs button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:10px 16px;font-weight:950;cursor:pointer}
      .fc-tabs button.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
      .fc-grid{display:grid;grid-template-columns:minmax(620px,1.4fr) minmax(320px,.8fr);gap:14px}
      .fc-card{padding:18px 20px;overflow:auto}
      .fc-card h3{margin:0 0 12px;font-size:17px;font-weight:950}
      table{width:100%;border-collapse:collapse;min-width:780px}
      th{background:#f8fafc;color:#334155;text-align:left;font-size:12px;padding:11px;border-bottom:1px solid #e5e7eb}
      td{padding:10px 11px;border-bottom:1px solid #eef2f7;font-size:13px}
      input,select{border:1px solid #cbd5e1;border-radius:10px;padding:8px 9px;font-weight:850}
      button.link{border:0;background:transparent;color:#1d4ed8;font-weight:950;cursor:pointer}
      .badge{border-radius:999px;padding:5px 9px;font-size:12px;font-weight:950}
      .badge.good{background:#dcfce7;color:#166534}.badge.ok{background:#dbeafe;color:#1e40af}.badge.warn{background:#ffedd5;color:#9a3412}.badge.danger{background:#fee2e2;color:#991b1b}
      tr.risk-danger td{background:#fff7f7}tr.risk-warn td{background:#fffaf0}
      .empty{text-align:center;color:#64748b;font-weight:900}
      .cal-grid{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:14px}
      .week{text-align:center;font-weight:950;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px}
      .day{min-height:140px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:9px;display:grid;gap:7px}
      .day.weekend{background:#eff6ff}.day.blank{background:transparent;border:0}
      @media(max-width:900px){.fc-grid{grid-template-columns:1fr}.fc-kpis{grid-template-columns:repeat(2,1fr)}.cal-grid{grid-template-columns:repeat(2,1fr)}.week{display:none}}
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
