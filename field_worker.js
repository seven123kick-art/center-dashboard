/* field_worker.js : 作業者分析ビュー（単一CSV完結・幹線料除外ロジック完全統一版）
   2026-05-01
   ・件数：作業者CSVの原票番号ユニーク
   ・稼働日：A列日付で判定
   ・1日平均：配送件数 ÷ 稼働日
   ・金額：作業者CSV金額から、幹線料系だけを集計前に除外（サイズ配送料は対象）
   ・グラフ：幹線料系を除外した作業内容を、サイズ系／その他に2分割
*/
'use strict';
(function(){
  if (window.__FIELD_WORKER_SINGLE_CSV_EXCLUDED_20260501__) return;
  window.__FIELD_WORKER_SINGLE_CSV_EXCLUDED_20260501__ = true;

  const STATE_KEY = '__fieldWorkerSelectedName';

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
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

  function isKansenWork(label){
    const s = String(label || '').replace(/[\s　]/g,'');
    return /幹線|幹線料|中継|中継料/.test(s);
  }
  function isSizeWork(label){
    const s = String(label || '').replace(/[\s　]/g,'');
    return /サイズ|大型|中型|小型/.test(s);
  }

  function rowsFromRecord(rec){
    const workers = rec && rec.workers ? rec.workers : {};
    return Object.values(workers).map(w => {
      const count = num(w.rows);
      const workDays = safeArray(w.workDays);
      const workDayCount = num(w.workDayCount || workDays.length);
      const avg = workDayCount > 0 ? count / workDayCount : 0;
      const amount = num(w.includedAmount || w.amount);
      return {
        label: String(w.name || '未設定'),
        count,
        amount,
        excludedAmount: num(w.excludedAmount),
        includedAmount: amount,
        lineRows:num(w.lineRows),
        excludedLineRows:num(w.excludedLineRows),
        works: w.works || {},
        chartWorks: w.chartWorks || w.works || {},
        includedWorks: w.includedWorks || {},
        excludedWorks: w.excludedWorks || {},
        workDays,
        workDayCount,
        avgPerWorkDay: avg
      };
    }).sort((a,b)=> b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label, 'ja'));
  }

  function splitWorks(works){
    const size = [];
    const other = [];
    Object.entries(works || {}).forEach(([label,count]) => {
      if (isKansenWork(label)) return;
      const item = { label: label || '未設定', count:num(count) };
      if (item.count <= 0) return;
      (isSizeWork(item.label) ? size : other).push(item);
    });
    const sorter = (a,b)=>b.count-a.count || a.label.localeCompare(b.label,'ja');
    size.sort(sorter);
    other.sort(sorter);
    return { size, other };
  }

  function findWorkCount(works, patterns){
    const entries = Object.entries(works || {});
    let total = 0;
    entries.forEach(([k,v]) => {
      const key = String(k || '');
      if (patterns.some(p => key.includes(p))) total += num(v);
    });
    return total;
  }

  function makeKpi(rec, rows, ym){
    const kpi = document.getElementById('f-kpi-worker');
    if (!kpi) return;
    const totalCount = rec.rowCount || rows.reduce((s,r)=>s+r.count,0);
    const totalAmount = rows.reduce((s,r)=>s+r.amount,0);
    const excludedAmount = rows.reduce((s,r)=>s+r.excludedAmount,0) || num(rec.excludedAmount);
    const workDayCount = num(rec.workDayCount || safeArray(rec.workDays).length || 0);
    const avg = workDayCount > 0 ? totalCount / workDayCount : 0;
    kpi.style.gridTemplateColumns = 'repeat(5,minmax(0,1fr))';
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">対象月</div><div class="kpi-value">${esc(ymText(ym))}</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">配送件数</div><div class="kpi-value">${fmt(totalCount)}</div><div class="kpi-sub">原票番号ユニーク</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">稼働日数</div><div class="kpi-value">${workDayCount ? fmt(workDayCount) : '—'}日</div><div class="kpi-sub">A列日付で判定</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">1日平均</div><div class="kpi-value">${workDayCount ? fmt1(avg) : '—'}件</div><div class="kpi-sub">配送件数 ÷ 稼働日</div></div>
      <div class="kpi-card accent-amber"><div class="kpi-label">金額（幹線除外後）</div><div class="kpi-value">${fmtK(totalAmount)}千円</div><div class="kpi-sub">除外 ${fmtK(excludedAmount)}千円</div></div>`;
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
          <thead>
            <tr>
              <th style="width:48px">順位</th>
              <th>作業者</th>
              <th class="r">配送件数</th>
              <th class="r">稼働日</th>
              <th class="r">1日平均</th>
              <th class="r">構成比</th>
              <th class="r">金額（幹線除外後）</th>
            </tr>
          </thead>
          <tbody>
            ${topRows.map((r,i)=>{
              const active = r.label === selectedName;
              const pct = r.count / totalCount * 100;
              const width = Math.max(3, r.count / maxCount * 100);
              return `<tr class="field-worker-row ${active ? 'is-active' : ''}" data-worker="${esc(r.label)}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')">
                <td><span class="rank-badge">${i+1}</span></td>
                <td>
                  <strong>${esc(r.label)}</strong>
                  <div class="mini-track"><div class="mini-fill" style="width:${width.toFixed(1)}%"></div></div>
                </td>
                <td class="r"><strong>${fmt(r.count)}</strong>件</td>
                <td class="r">${r.workDayCount ? fmt(r.workDayCount)+'日' : '—'}</td>
                <td class="r"><strong>${r.workDayCount ? fmt1(r.avgPerWorkDay) : '—'}</strong>件/日</td>
                <td class="r">${pct.toFixed(1)}%</td>
                <td class="r">${fmtK(r.amount)}千</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px">上位50名を表示。1日平均は「A列日付に1件以上作業がある日」を稼働日として算出します。金額は作業者CSVから幹線料系だけを集計前に除外した参考値です。サイズ配送料は売上対象に含めます。グラフは幹線料系を除外して表示します。</div>`;
  }

  function renderDoughnut(canvasId, items, emptyText){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!items.length) {
      if (typeof CHART_MGR !== 'undefined') CHART_MGR.destroy && CHART_MGR.destroy(canvasId);
      const parent = canvas.parentElement;
      if (parent) {
        parent.innerHTML = `<canvas id="${canvasId}"></canvas><div class="field-empty-overlay">${esc(emptyText)}</div>`;
      }
      return;
    }
    if (typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make(canvasId, {
        type:'doughnut',
        data:{
          labels:items.map(w=>w.label),
          datasets:[{
            data:items.map(w=>w.count),
            backgroundColor:items.map((_,i)=>CONFIG.COLORS[i % CONFIG.COLORS.length])
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          cutout:'58%',
          plugins:{
            legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:10 } } },
            tooltip:{ callbacks:{ label:(ctx)=>`${ctx.label}: ${fmt(ctx.raw)}件` } }
          }
        }
      });
    }
  }

  function renderWorkerDetail(row){
    const titleEl = document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-title');
    if (titleEl) titleEl.textContent = row ? `作業内容内訳（明細行ベース）：${row.label}` : '作業者別　作業内容内訳（明細行ベース）';

    const oldCanvas = document.getElementById('c-worker-content');
    const body = oldCanvas ? oldCanvas.parentElement : document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-body');
    if (!body) return;

    if (!document.getElementById('c-worker-size') || !document.getElementById('c-worker-other')) {
      body.style.height = '360px';
      body.style.position = 'relative';
      body.innerHTML = `
        <div class="worker-detail-summary" id="worker-detail-summary"></div>
        <div class="worker-chart-grid">
          <div class="worker-chart-card">
            <div class="worker-chart-title">サイズ系（幹線料除外）</div>
            <div class="worker-chart-wrap"><canvas id="c-worker-size"></canvas></div>
          </div>
          <div class="worker-chart-card">
            <div class="worker-chart-title">その他（幹線料除外）</div>
            <div class="worker-chart-wrap"><canvas id="c-worker-other"></canvas></div>
          </div>
        </div>`;
    }

    const summary = document.getElementById('worker-detail-summary');
    if (!row) {
      if (summary) summary.innerHTML = '<span>作業者を選択してください</span>';
      renderDoughnut('c-worker-size', [], 'サイズ系データなし');
      renderDoughnut('c-worker-other', [], 'その他データなし');
      return;
    }

    const split = splitWorks(row.chartWorks || row.works);
    const sizeTotal = split.size.reduce((s,x)=>s+x.count,0);
    const otherTotal = split.other.reduce((s,x)=>s+x.count,0);
    if (summary) {
      summary.innerHTML = `
        <span><strong>${esc(row.label)}</strong></span>
        <span>配送件数：<strong>${fmt(row.count)}</strong>件</span>
        <span>稼働：<strong>${row.workDayCount ? fmt(row.workDayCount) : '—'}</strong>日</span>
        <span>平均：<strong>${row.workDayCount ? fmt1(row.avgPerWorkDay) : '—'}</strong>件/日</span>
        <span>金額対象：<strong>${fmtK(row.amount)}</strong>千</span>
        <span>除外：<strong>${fmtK(row.excludedAmount)}</strong>千</span>
        <span>サイズ系：<strong>${fmt(sizeTotal)}</strong>件</span>
        <span>その他：<strong>${fmt(otherTotal)}</strong>件</span>`;
    }

    renderDoughnut('c-worker-size', split.size.slice(0,8), 'サイズ系データなし');
    renderDoughnut('c-worker-other', split.other.slice(0,8), 'その他データなし');
  }

  function renderDetailTable(rows, selectedName){
    const tbody = document.getElementById('f-worker-tbody');
    if (!tbody) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0) || 1;
    const tableRows = rows.slice(0, 100);
    tbody.innerHTML = tableRows.map((r,i)=>{
      const workForTable = r.chartWorks || r.works;
      const delivery = findWorkCount(workForTable, ['配送','配送料','配達']);
      const install = findWorkCount(workForTable, ['設置','取付','工事']);
      const recycle = findWorkCount(workForTable, ['リサイクル','回収']);
      const active = r.label === selectedName;
      return `<tr class="field-worker-detail-row ${active ? 'is-active' : ''}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')" style="cursor:pointer">
        <td><strong>${i+1}. ${esc(r.label)}</strong></td>
        <td class="r">${fmt(r.count)}</td>
        <td class="r">${r.workDayCount ? fmt(r.workDayCount) : '—'}</td>
        <td class="r">${r.workDayCount ? fmt1(r.avgPerWorkDay) : '—'}</td>
        <td class="r">${fmtK(r.amount)}</td>
        <td class="r">${(r.count/totalCount*100).toFixed(1)}%</td>
        <td class="r">${r.count ? fmt(r.amount/r.count) : '0'}</td>
        <td class="r">${delivery ? fmt(delivery) : '—'}</td>
        <td class="r">${install ? fmt(install) : '—'}</td>
        <td class="r">${recycle ? fmt(recycle) : '—'}</td>
      </tr>`;
    }).join('');
  }

  function ensureStyle(){
    if (document.getElementById('field-worker-workdays-style')) return;
    const st = document.createElement('style');
    st.id = 'field-worker-workdays-style';
    st.textContent = `
      #f-kpi-worker{gap:12px;margin-bottom:16px}
      .field-worker-ranking-table td{vertical-align:middle;padding-top:9px;padding-bottom:9px}
      .field-worker-row,.field-worker-detail-row{cursor:pointer;transition:background .15s ease}
      .field-worker-row:hover td,.field-worker-detail-row:hover td{background:#f8fafc!important}
      .field-worker-row.is-active td,.field-worker-detail-row.is-active td{background:#eaf3ff!important}
      .rank-badge{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:#e5edf7;color:#1a4d7c;font-weight:900;font-size:12px}
      .field-worker-row.is-active .rank-badge{background:#1a4d7c;color:#fff}
      .mini-track{height:7px;background:#e5e7eb;border-radius:999px;margin-top:7px;overflow:hidden;max-width:280px}
      .mini-fill{height:100%;background:#1a4d7c;border-radius:999px}
      .worker-detail-summary{display:flex;flex-wrap:wrap;gap:8px 14px;margin-bottom:12px;font-size:12px;color:var(--text2)}
      .worker-detail-summary span{background:#f8fafc;border:1px solid var(--border);border-radius:999px;padding:5px 9px}
      .worker-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;height:300px}
      .worker-chart-card{border:1px solid var(--border);border-radius:12px;background:#fff;min-width:0;padding:10px;display:flex;flex-direction:column}
      .worker-chart-title{font-weight:800;color:var(--text2);font-size:12px;margin-bottom:6px}
      .worker-chart-wrap{position:relative;flex:1;min-height:0}
      .field-empty-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-weight:700;font-size:12px;pointer-events:none}
      @media(max-width:1300px){#f-kpi-worker{grid-template-columns:repeat(3,minmax(0,1fr))!important}.worker-chart-grid{grid-template-columns:1fr;height:520px}}
    `;
    document.head.appendChild(st);
  }

  function patchWorkerTableHeader(){
    const table = document.getElementById('f-worker-tbody')?.closest('table');
    const headRow = table?.querySelector('thead tr');
    if (!headRow || headRow.dataset.workdaysPatched === '1') return;
    headRow.dataset.workdaysPatched = '1';
    headRow.innerHTML = `
      <th>作業者</th>
      <th class="r">配送件数</th>
      <th class="r">稼働日</th>
      <th class="r">1日平均</th>
      <th class="r">金額対象（千円）</th>
      <th class="r">構成比</th>
      <th class="r">単価（円）</th>
      <th class="r">配送</th>
      <th class="r">設置</th>
      <th class="r">回収</th>`;
  }

  function renderWorkerProfessional(){
    ensureStyle();
    patchWorkerTableHeader();
    const ym = selectedYM();
    const rec = workerRecord(ym);
    const kpi = document.getElementById('f-kpi-worker');
    const bars = document.getElementById('f-worker-bars');
    const tbody = document.getElementById('f-worker-tbody');

    if (!rec) {
      if (kpi) kpi.innerHTML = '<div class="card" style="grid-column:1/-1;padding:20px;color:var(--text3);font-weight:700">選択月の作業者CSVがありません。</div>';
      if (bars) bars.innerHTML = '<div style="padding:30px;color:var(--text3);font-weight:700">作業者別CSVを読み込むとランキングを表示します。</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:24px">データなし</td></tr>';
      renderWorkerDetail(null);
      return;
    }

    const rows = rowsFromRecord(rec);
    if (!rows.length) {
      if (kpi) kpi.innerHTML = '<div class="card" style="grid-column:1/-1;padding:20px;color:var(--text3);font-weight:700">作業者データがありません。</div>';
      return;
    }

    let selectedName = sessionStorage.getItem(STATE_KEY) || rows[0].label;
    if (!rows.some(r => r.label === selectedName)) selectedName = rows[0].label;
    sessionStorage.setItem(STATE_KEY, selectedName);
    const selectedRow = rows.find(r => r.label === selectedName) || rows[0];

    makeKpi(rec, rows, ym);
    renderRanking(rows, selectedName);
    renderWorkerDetail(selectedRow);
    renderDetailTable(rows, selectedName);
  }

  window.FIELD_WORKER_UI = {
    render(){
      if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh) FIELD_CSV_REBUILD.refresh(false);
      renderWorkerProfessional();
    },
    selectWorker(name){
      sessionStorage.setItem(STATE_KEY, String(name || ''));
      renderWorkerProfessional();
    },
    renderProfessional: renderWorkerProfessional
  };

  if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh && !FIELD_CSV_REBUILD.__workerWorkdaysPatched) {
    const oldRefresh = FIELD_CSV_REBUILD.refresh.bind(FIELD_CSV_REBUILD);
    FIELD_CSV_REBUILD.refresh = function(){
      const result = oldRefresh.apply(FIELD_CSV_REBUILD, arguments);
      const activeWorkerView = document.getElementById('view-field-worker');
      if (activeWorkerView && activeWorkerView.classList.contains('active')) {
        setTimeout(renderWorkerProfessional, 0);
      }
      return result;
    };
    FIELD_CSV_REBUILD.__workerWorkdaysPatched = true;
  }
})();
