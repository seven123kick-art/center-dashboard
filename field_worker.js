/* field_worker.js : 作業者分析ビュー（原票番号JOIN確定売上版）
   2026-05-01
   ・速報：作業者CSVのみで表示（件数・稼働日・作業CSV金額）
   ・確定：確定CSV取込後、原票番号が一致したものだけ確定CSV売上に切替
   ・同一原票番号が複数作業者に出た場合は二重計上防止のため均等按分
   ・1日平均は A列日付に対する稼働日ベース
   ・作業内容内訳はサイズ系／その他の2グラフ
*/
'use strict';
(function(){
  if (window.__FIELD_WORKER_JOIN_CONFIRMED_20260501__) return;
  window.__FIELD_WORKER_JOIN_CONFIRMED_20260501__ = true;

  const STATE_KEY = '__fieldWorkerSelectedName';

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function jsArg(v){ return String(v ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' '); }
  function num(v){ return Number(v || 0) || 0; }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmt1(v){ return (Math.round(num(v) * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits:1, maximumFractionDigits:1 }); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }

  function selectedYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel && sel.value) return sel.value;
    return STATE.selYM
      || safeArray(STATE.workerCsvData).at(-1)?.ym
      || safeArray(STATE.productAddressData).at(-1)?.ym
      || (typeof latestDS === 'function' ? latestDS()?.ym : '')
      || '';
  }

  function workerRecord(ym){
    return safeArray(STATE.workerCsvData).find(d => d && d.ym === ym) || null;
  }

  function getDatasetForYM(ym){
    if (typeof activeDatasetByYM === 'function') {
      const active = activeDatasetByYM(ym);
      if (active) return active;
    }
    return safeArray(STATE.datasets).find(d => d && d.ym === ym && (d.type || 'confirmed') === 'confirmed')
        || safeArray(STATE.datasets).find(d => d && d.ym === ym)
        || null;
  }

  function confirmedSlipMap(ym){
    const ds = getDatasetForYM(ym);
    const map = ds && ds.confirmedSlipSales ? ds.confirmedSlipSales : null;
    return map && typeof map === 'object' ? map : {};
  }

  function buildSlipWorkerCount(rec){
    const map = {};
    Object.values(rec?.workers || {}).forEach(w => {
      Object.keys(w.slips || {}).forEach(slip => {
        if (!slip || String(slip).startsWith('__row_')) return;
        map[slip] = (map[slip] || 0) + 1;
      });
    });
    return map;
  }

  function rowsFromRecord(rec, ym){
    const workers = rec && rec.workers ? rec.workers : {};
    const confirmed = confirmedSlipMap(ym);
    const hasConfirmed = Object.keys(confirmed).length > 0;
    const slipWorkerCount = buildSlipWorkerCount(rec);

    return Object.values(workers).map(w => {
      const slips = w.slips || {};
      const count = Object.keys(slips).length || num(w.rows);
      const workDays = safeArray(w.workDays);
      const workDayCount = num(w.workDayCount || workDays.length);
      const avg = workDayCount > 0 ? count / workDayCount : 0;
      let confirmedAmount = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let速報Amount = num(w.amount);

      Object.keys(slips).forEach(slip => {
        if (String(slip).startsWith('__row_')) return;
        const hit = confirmed[slip];
        if (hasConfirmed && hit) {
          const divisor = Math.max(1, num(slipWorkerCount[slip]));
          confirmedAmount += num(hit.income) / divisor;
          matchedCount += 1;
        } else if (hasConfirmed) {
          unmatchedCount += 1;
        }
      });

      const matchRate = count > 0 ? matchedCount / count * 100 : 0;
      const amount = hasConfirmed ? confirmedAmount :速報Amount;
      return {
        label: String(w.name || '未設定'),
        count,
        lineRows:num(w.lineRows),
        amount,
       速報Amount,
        confirmedAmount,
        hasConfirmed,
        matchedCount,
        unmatchedCount,
        matchRate,
        amountMode: hasConfirmed ? '確定JOIN' : '速報',
        works: w.works || {},
        workDays,
        workDayCount,
        avgPerWorkDay: avg,
        slips
      };
    }).sort((a,b)=> b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label, 'ja'));
  }

  function isSizeWork(label){
    const s = String(label || '');
    return /サイズ/.test(s) || /大型|中型|小型|幹線料|配送料/.test(s);
  }

  function splitWorks(works){
    const size = [];
    const other = [];
    Object.entries(works || {}).forEach(([label,count]) => {
      const item = { label: label || '未設定', count:num(count) };
      if (item.count <= 0) return;
      (isSizeWork(item.label) ? size : other).push(item);
    });
    const sorter = (a,b)=>b.count-a.count || a.label.localeCompare(b.label,'ja');
    size.sort(sorter); other.sort(sorter);
    return { size, other };
  }

  function makeKpi(rec, rows, ym){
    const kpi = document.getElementById('f-kpi-worker');
    if (!kpi) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0);
    const totalAmount = rows.reduce((s,r)=>s+r.amount,0);
    const matched = rows.reduce((s,r)=>s+r.matchedCount,0);
    const hasConfirmed = rows.some(r=>r.hasConfirmed);
    const workDayCount = num(rec.workDayCount || safeArray(rec.workDays).length || 0);
    const avg = workDayCount > 0 ? totalCount / workDayCount : 0;
    const matchRate = totalCount > 0 ? matched / totalCount * 100 : 0;
    kpi.style.gridTemplateColumns = 'repeat(5,minmax(0,1fr))';
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">対象月</div><div class="kpi-value">${esc(ymText(ym))}</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">配送件数</div><div class="kpi-value">${fmt(totalCount)}</div><div class="kpi-sub">作業者×原票番号</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">稼働日数</div><div class="kpi-value">${workDayCount ? fmt(workDayCount) : '—'}日</div><div class="kpi-sub">A列日付で判定</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">1日平均</div><div class="kpi-value">${workDayCount ? fmt1(avg) : '—'}件</div><div class="kpi-sub">配送件数 ÷ 稼働日</div></div>
      <div class="kpi-card ${hasConfirmed ? 'accent-green' : 'accent-amber'}"><div class="kpi-label">売上（${hasConfirmed ? '確定JOIN' : '速報'}）</div><div class="kpi-value">${fmtK(totalAmount)}千円</div><div class="kpi-sub">${hasConfirmed ? `一致率 ${fmt1(matchRate)}%` : '作業CSV金額'}</div></div>`;
  }

  function renderStatusNotice(rows){
    let el = document.getElementById('worker-join-notice');
    const view = document.getElementById('view-field-worker');
    if (!view) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'worker-join-notice';
      const kpi = document.getElementById('f-kpi-worker');
      if (kpi && kpi.parentNode) kpi.parentNode.insertBefore(el, kpi.nextSibling);
      else view.prepend(el);
    }
    const hasConfirmed = rows.some(r=>r.hasConfirmed);
    const total = rows.reduce((s,r)=>s+r.count,0);
    const matched = rows.reduce((s,r)=>s+r.matchedCount,0);
    if (!hasConfirmed) {
      el.innerHTML = `<div class="msg msg-warn" style="margin:10px 0">速報表示です。確定CSVを取り込むと、作業者CSVと確定CSVの原票番号が一致した分だけ確定売上に切り替わります。</div>`;
    } else {
      const rate = total > 0 ? matched / total * 100 : 0;
      el.innerHTML = `<div class="msg msg-info" style="margin:10px 0">確定JOIN表示：一致 ${fmt(matched)}件 / 対象 ${fmt(total)}件（${fmt1(rate)}%）。一致しない原票番号は確定売上に含めていません。同一原票番号が複数作業者にある場合は均等按分しています。</div>`;
    }
  }

  function renderRanking(rows, selectedName){
    const box = document.getElementById('f-worker-bars');
    if (!box) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0) || 1;
    const maxCount = Math.max(...rows.map(r=>r.count), 1);
    const topRows = rows.slice(0, 50);

    box.innerHTML = `
      <div class="scroll-x">
        <table class="tbl field-worker-ranking-table">
          <thead><tr>
            <th style="width:48px">順位</th><th>作業者</th><th class="r">配送件数</th><th class="r">稼働日</th><th class="r">1日平均</th><th class="r">一致率</th><th class="r">売上</th><th class="c">状態</th>
          </tr></thead>
          <tbody>${topRows.map((r,i)=>{
            const active = r.label === selectedName;
            const pct = r.count / totalCount * 100;
            const width = Math.max(3, r.count / maxCount * 100);
            return `<tr class="field-worker-row ${active ? 'is-active' : ''}" data-worker="${esc(r.label)}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')">
              <td><span class="rank-badge">${i+1}</span></td>
              <td><strong>${esc(r.label)}</strong><div class="mini-track"><div class="mini-fill" style="width:${width.toFixed(1)}%"></div></div></td>
              <td class="r"><strong>${fmt(r.count)}</strong>件</td>
              <td class="r">${r.workDayCount ? fmt(r.workDayCount)+'日' : '—'}</td>
              <td class="r"><strong>${r.workDayCount ? fmt1(r.avgPerWorkDay) : '—'}</strong>件/日</td>
              <td class="r">${r.hasConfirmed ? fmt1(r.matchRate)+'%' : '—'}</td>
              <td class="r">${fmtK(r.amount)}千</td>
              <td class="c"><span class="badge ${r.hasConfirmed ? 'badge-ok' : 'badge-warn'}">${r.amountMode}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px">売上は、確定CSVがある場合は原票番号一致分だけ確定売上を採用します。確定CSVが無い場合は作業CSV金額の速報表示です。</div>`;
  }

  function renderDoughnut(canvasId, items, emptyText){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!items.length) {
      if (typeof CHART_MGR !== 'undefined' && CHART_MGR.destroy) CHART_MGR.destroy(canvasId);
      const parent = canvas.parentElement;
      if (parent) parent.innerHTML = `<canvas id="${canvasId}"></canvas><div class="field-empty-overlay">${esc(emptyText)}</div>`;
      return;
    }
    if (typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make(canvasId, {
        type:'doughnut',
        data:{ labels:items.map(w=>w.label), datasets:[{ data:items.map(w=>w.count), backgroundColor:items.map((_,i)=>CONFIG.COLORS[i % CONFIG.COLORS.length]) }] },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'58%', plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:10 } } }, tooltip:{ callbacks:{ label:(ctx)=>`${ctx.label}: ${fmt(ctx.raw)}件` } } } }
      });
    }
  }

  function renderWorkerDetail(row){
    const titleEl = document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-title');
    if (titleEl) titleEl.textContent = row ? `作業内容内訳：${row.label}` : '作業者別　作業内容内訳';
    const oldCanvas = document.getElementById('c-worker-content');
    const body = oldCanvas ? oldCanvas.parentElement : document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-body');
    if (!body) return;
    if (!document.getElementById('c-worker-size') || !document.getElementById('c-worker-other')) {
      body.style.height = '390px'; body.style.position = 'relative';
      body.innerHTML = `<div class="worker-detail-summary" id="worker-detail-summary"></div><div class="worker-chart-grid"><div class="worker-chart-card"><div class="worker-chart-title">サイズ系</div><div class="worker-chart-wrap"><canvas id="c-worker-size"></canvas></div></div><div class="worker-chart-card"><div class="worker-chart-title">その他</div><div class="worker-chart-wrap"><canvas id="c-worker-other"></canvas></div></div></div>`;
    }
    const summary = document.getElementById('worker-detail-summary');
    if (!row) {
      if (summary) summary.innerHTML = '<span>作業者を選択してください</span>';
      renderDoughnut('c-worker-size', [], 'サイズ系データなし');
      renderDoughnut('c-worker-other', [], 'その他データなし');
      return;
    }
    const split = splitWorks(row.works);
    const sizeTotal = split.size.reduce((s,x)=>s+x.count,0);
    const otherTotal = split.other.reduce((s,x)=>s+x.count,0);
    if (summary) summary.innerHTML = `
      <span><strong>${esc(row.label)}</strong></span>
      <span>配送：<strong>${fmt(row.count)}</strong>件</span>
      <span>稼働：<strong>${row.workDayCount ? fmt(row.workDayCount) : '—'}</strong>日</span>
      <span>平均：<strong>${row.workDayCount ? fmt1(row.avgPerWorkDay) : '—'}</strong>件/日</span>
      <span>売上：<strong>${fmtK(row.amount)}</strong>千</span>
      <span>${row.hasConfirmed ? `一致：<strong>${fmt(row.matchedCount)}</strong>件 / ${fmt1(row.matchRate)}%` : '速報表示'}</span>
      <span>サイズ系：<strong>${fmt(sizeTotal)}</strong>件</span><span>その他：<strong>${fmt(otherTotal)}</strong>件</span>`;
    renderDoughnut('c-worker-size', split.size.slice(0,8), 'サイズ系データなし');
    renderDoughnut('c-worker-other', split.other.slice(0,8), 'その他データなし');
  }

  function renderDetailTable(rows, selectedName){
    const tbody = document.getElementById('f-worker-tbody');
    if (!tbody) return;
    const tableRows = rows.slice(0, 100);
    tbody.innerHTML = tableRows.map((r,i)=>`<tr class="field-worker-detail-row ${r.label===selectedName?'is-active':''}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')" style="cursor:pointer"><td><strong>${i+1}. ${esc(r.label)}</strong></td><td class="r">${fmt(r.count)}</td><td class="r">${r.workDayCount?fmt(r.workDayCount):'—'}</td><td class="r">${r.workDayCount?fmt1(r.avgPerWorkDay):'—'}</td><td class="r">${r.hasConfirmed?fmt1(r.matchRate)+'%':'—'}</td><td class="r">${fmtK(r.amount)}</td></tr>`).join('');
  }

  function ensureDetailHeader(){
    const table = document.getElementById('f-worker-tbody')?.closest('table');
    if (!table) return;
    const thead = table.querySelector('thead tr');
    if (thead) thead.innerHTML = '<th>作業者</th><th class="r">配送件数</th><th class="r">稼働日</th><th class="r">1日平均</th><th class="r">一致率</th><th class="r">売上（千円）</th>';
  }

  function render(){
    const ym = selectedYM();
    const rec = workerRecord(ym);
    const rows = rowsFromRecord(rec, ym);
    ensureDetailHeader();
    if (!rec || !rows.length) {
      const kpi = document.getElementById('f-kpi-worker'); if (kpi) kpi.innerHTML = '<div class="msg msg-info">選択月の作業者CSVがありません。</div>';
      const box = document.getElementById('f-worker-bars'); if (box) box.innerHTML = '<div class="empty">作業者CSVを取り込んでください。</div>';
      renderWorkerDetail(null);
      renderDetailTable([], '');
      return;
    }
    let selectedName = window[STATE_KEY];
    if (!rows.some(r=>r.label===selectedName)) selectedName = rows[0].label;
    window[STATE_KEY] = selectedName;
    const selectedRow = rows.find(r=>r.label===selectedName) || rows[0];
    makeKpi(rec, rows, ym);
    renderStatusNotice(rows);
    renderRanking(rows, selectedName);
    renderWorkerDetail(selectedRow);
    renderDetailTable(rows, selectedName);
  }

  window.FIELD_WORKER_UI = {
    render,
    selectWorker(name){ window[STATE_KEY] = name; render(); }
  };

  const oldRefresh = window.FIELD_CSV_REBUILD && window.FIELD_CSV_REBUILD.refresh;
  if (window.FIELD_CSV_REBUILD) {
    window.FIELD_CSV_REBUILD.renderWorker = render;
    window.FIELD_CSV_REBUILD.refresh = function(){ if (typeof oldRefresh === 'function') oldRefresh.apply(this, arguments); render(); };
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 300));
})();
