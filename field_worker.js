/* field_worker.js : 作業者分析ビュー（表形式＋クリック内訳版）
   2026-05-01
   ・作業者ランキングを表形式化
   ・ランキング行クリックで右側に作業内容内訳を表示
   ・初期表示は1位作業者を自動選択
   ・field_core.jsの既存CSV/保存/同期ロジックは変更しない
*/
'use strict';
(function(){
  if (window.__FIELD_WORKER_PROFESSIONAL_20260501__) return;
  window.__FIELD_WORKER_PROFESSIONAL_20260501__ = true;

  const STATE_KEY = '__fieldWorkerSelectedName';

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
  function num(v){ return Number(v || 0) || 0; }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
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

  function rowsFromRecord(rec){
    const workers = rec && rec.workers ? rec.workers : {};
    return Object.values(workers).map(w => ({
      label: String(w.name || '未設定'),
      count: num(w.rows),
      amount: num(w.amount),
      works: w.works || {}
    })).sort((a,b)=> b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label, 'ja'));
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
    const totalAmount = rows.reduce((s,r)=>s+r.amount,0);
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">対象月</div><div class="kpi-value">${esc(ymText(ym))}</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">明細件数</div><div class="kpi-value">${fmt(rec.rowCount || rows.reduce((s,r)=>s+r.count,0))}</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">作業者数</div><div class="kpi-value">${fmt(rec.workerCount || rows.length)}</div></div>
      <div class="kpi-card accent-amber"><div class="kpi-label">金額</div><div class="kpi-value">${fmtK(totalAmount)}千円</div></div>`;
  }

  function renderRanking(rows, selectedName){
    const box = document.getElementById('f-worker-bars');
    if (!box) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0) || 1;
    const totalAmount = rows.reduce((s,r)=>s+r.amount,0) || 1;
    const maxCount = Math.max(...rows.map(r=>r.count), 1);
    const topRows = rows.slice(0, 30);

    box.innerHTML = `
      <div class="scroll-x">
        <table class="tbl field-worker-ranking-table">
          <thead>
            <tr>
              <th style="width:48px">順位</th>
              <th>作業者</th>
              <th class="r">件数</th>
              <th class="r">構成比</th>
              <th class="r">金額</th>
            </tr>
          </thead>
          <tbody>
            ${topRows.map((r,i)=>{
              const active = r.label === selectedName;
              const pct = r.count / totalCount * 100;
              const width = Math.max(3, r.count / maxCount * 100);
              return `<tr class="field-worker-row ${active ? 'is-active' : ''}" data-worker="${esc(r.label)}" onclick="FIELD_WORKER_UI.selectWorker('${esc(String(r.label).replace(/'/g, "\\'"))}')">
                <td><span class="rank-badge">${i+1}</span></td>
                <td>
                  <strong>${esc(r.label)}</strong>
                  <div class="mini-track"><div class="mini-fill" style="width:${width.toFixed(1)}%"></div></div>
                </td>
                <td class="r"><strong>${fmt(r.count)}</strong>件</td>
                <td class="r">${pct.toFixed(1)}%</td>
                <td class="r">${fmtK(r.amount)}千</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px">上位30名を表示。行をクリックすると右側に作業内容内訳を表示します。</div>`;
  }

  function renderWorkerDetail(row){
    const titleEl = document.querySelector('#fpane-worker .grid2 .card:nth-child(2) .card-title');
    if (titleEl) titleEl.textContent = row ? `作業内容内訳：${row.label}` : '作業者別　作業内容内訳';

    const canvas = document.getElementById('c-worker-content');
    if (!canvas) return;

    if (!row) {
      if (typeof CHART_MGR !== 'undefined') {
        CHART_MGR.make('c-worker-content', { type:'bar', data:{ labels:[], datasets:[{data:[]}] }, options:{ responsive:true, maintainAspectRatio:false } });
      }
      return;
    }

    const works = Object.entries(row.works || {})
      .map(([label,count]) => ({ label: label || '未設定', count:num(count) }))
      .filter(x => x.count > 0)
      .sort((a,b)=>b.count-a.count)
      .slice(0,10);

    if (!works.length) {
      const parent = canvas.parentElement;
      if (parent) {
        parent.innerHTML = `<canvas id="c-worker-content"></canvas><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-weight:700">作業内容データがありません</div>`;
      }
      return;
    }

    if (typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make('c-worker-content', {
        type:'doughnut',
        data:{
          labels:works.map(w=>w.label),
          datasets:[{
            data:works.map(w=>w.count),
            backgroundColor:works.map((_,i)=>CONFIG.COLORS[i % CONFIG.COLORS.length])
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{
            legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } },
            tooltip:{ callbacks:{ label:(ctx)=>`${ctx.label}: ${fmt(ctx.raw)}件` } }
          }
        }
      });
    }
  }

  function renderDetailTable(rows, selectedName){
    const tbody = document.getElementById('f-worker-tbody');
    if (!tbody) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0) || 1;
    const tableRows = rows.slice(0, 80);
    tbody.innerHTML = tableRows.map((r,i)=>{
      const delivery = findWorkCount(r.works, ['配送','配送料','配達']);
      const install = findWorkCount(r.works, ['設置','取付','工事']);
      const recycle = findWorkCount(r.works, ['リサイクル','回収']);
      const active = r.label === selectedName;
      return `<tr class="field-worker-detail-row ${active ? 'is-active' : ''}" onclick="FIELD_WORKER_UI.selectWorker('${esc(String(r.label).replace(/'/g, "\\'"))}')" style="cursor:pointer">
        <td><strong>${i+1}. ${esc(r.label)}</strong></td>
        <td class="r">${fmt(r.count)}</td>
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
    if (document.getElementById('field-worker-pro-style')) return;
    const st = document.createElement('style');
    st.id = 'field-worker-pro-style';
    st.textContent = `
      .field-worker-ranking-table td{vertical-align:middle;padding-top:9px;padding-bottom:9px}
      .field-worker-row,.field-worker-detail-row{cursor:pointer;transition:background .15s ease}
      .field-worker-row:hover td,.field-worker-detail-row:hover td{background:#f8fafc!important}
      .field-worker-row.is-active td,.field-worker-detail-row.is-active td{background:#eaf3ff!important}
      .rank-badge{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:#e5edf7;color:#1a4d7c;font-weight:900;font-size:12px}
      .field-worker-row.is-active .rank-badge{background:#1a4d7c;color:#fff}
      .mini-track{height:7px;background:#e5e7eb;border-radius:999px;margin-top:7px;overflow:hidden;max-width:280px}
      .mini-fill{height:100%;background:#1a4d7c;border-radius:999px}
    `;
    document.head.appendChild(st);
  }

  function renderWorkerProfessional(){
    ensureStyle();
    const ym = selectedYM();
    const rec = workerRecord(ym);
    const kpi = document.getElementById('f-kpi-worker');
    const bars = document.getElementById('f-worker-bars');
    const tbody = document.getElementById('f-worker-tbody');

    if (!rec) {
      if (kpi) kpi.innerHTML = '<div class="card" style="grid-column:1/-1;padding:20px;color:var(--text3);font-weight:700">選択月の作業者CSVがありません。</div>';
      if (bars) bars.innerHTML = '<div style="padding:30px;color:var(--text3);font-weight:700">作業者別CSVを読み込むとランキングを表示します。</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">データなし</td></tr>';
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
      // 共通セレクタ等はfield_core側に任せ、最後に作業者画面だけ上書き描画する
      if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh) FIELD_CSV_REBUILD.refresh(false);
      renderWorkerProfessional();
    },
    selectWorker(name){
      sessionStorage.setItem(STATE_KEY, String(name || ''));
      renderWorkerProfessional();
    },
    renderProfessional: renderWorkerProfessional
  };

  // field_core側refreshの後でも、作業者画面表示中ならプロ表示に戻す
  if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh && !FIELD_CSV_REBUILD.__workerProfessionalPatched) {
    const oldRefresh = FIELD_CSV_REBUILD.refresh.bind(FIELD_CSV_REBUILD);
    FIELD_CSV_REBUILD.refresh = function(){
      const result = oldRefresh.apply(FIELD_CSV_REBUILD, arguments);
      const activeWorkerView = document.getElementById('view-field-worker');
      if (activeWorkerView && activeWorkerView.classList.contains('active')) {
        setTimeout(renderWorkerProfessional, 0);
      }
      return result;
    };
    FIELD_CSV_REBUILD.__workerProfessionalPatched = true;
  }
})();
