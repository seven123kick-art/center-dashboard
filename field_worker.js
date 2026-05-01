/* field_worker.js : 作業者分析ビュー（作業CSV単独・平均件数/日・平均売上/日強化版）
   2026-05-01
   ・件数：作業者CSVの原票番号ユニーク
   ・稼働日：A列日付で判定
   ・平均件数/日：配送件数 ÷ 稼働日
   ・平均売上/日：金額 ÷ 稼働日
   ・金額：field_core.jsで幹線料系を除外済みの金額を使用
   ・作業内容内訳：サイズ①〜⑦は順番固定、その他は表記ゆれを統合
   ・グラフ：円グラフではなく横棒ランキング表示
*/
'use strict';
(function(){
  if (window.__FIELD_WORKER_AVG_SALES_DAY_20260501__) return;
  window.__FIELD_WORKER_AVG_SALES_DAY_20260501__ = true;

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

  function rowsFromRecord(rec){
    const workers = rec && rec.workers ? rec.workers : {};
    return Object.values(workers).map(w => {
      const slips = w.slips || {};
      const count = Object.keys(slips).length || num(w.rows);
      const workDays = safeArray(w.workDays);
      const workDayCount = num(w.workDayCount || workDays.length);
      const avg = workDayCount > 0 ? count / workDayCount : 0;
      const amount = num(w.amount);
      const excludedAmount = num(w.excludedAmount || w.excluded || 0);
      return {
        label: String(w.name || '未設定'),
        count,
        lineRows:num(w.lineRows),
        amount,
        excludedAmount,
        works: w.works || {},
        workDays,
        workDayCount,
        avgPerWorkDay: avg,
        avgSalesPerWorkDay: workDayCount > 0 ? amount / workDayCount : 0,
        slips
      };
    }).sort((a,b)=> b.count - a.count || b.amount - a.amount || a.label.localeCompare(b.label, 'ja'));
  }

  function normalizeWorkLabel(label){
    const s = String(label || '').trim();
    if (!s) return { group:'other', label:'未設定', order:999 };

    const sizeMatch = s.match(/サイズ\s*([①②③④⑤⑥⑦1-7])/);
    if (sizeMatch) {
      const raw = sizeMatch[1];
      const map = { '①':1,'②':2,'③':3,'④':4,'⑤':5,'⑥':6,'⑦':7,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7 };
      const no = map[raw] || 9;
      return { group:'size', label:`サイズ${['','①','②','③','④','⑤','⑥','⑦'][no] || raw}`, order:no };
    }

    if (/大型冷蔵庫|冷蔵庫.*大型|冷蔵.*400|冷蔵.*４００|冷蔵/.test(s)) return { group:'other', label:'冷蔵庫', order:20 };
    if (/廃材|廃材引取|廃材処理/.test(s)) return { group:'other', label:'廃材', order:10 };
    if (/リサイクル/.test(s)) return { group:'other', label:'リサイクル', order:11 };
    if (/洗濯|ドラム式洗濯|全自動洗濯/.test(s)) return { group:'other', label:'洗濯機', order:12 };
    if (/テレビ|TV|ＴＶ/.test(s)) return { group:'other', label:'テレビ', order:13 };
    if (/エアコン|空調/.test(s)) return { group:'other', label:'エアコン', order:14 };
    if (/レンジ|オーブン/.test(s)) return { group:'other', label:'レンジ', order:15 };
    if (/洗浄便座|温水便座/.test(s)) return { group:'other', label:'洗浄便座', order:16 };
    if (/食洗|食器洗/.test(s)) return { group:'other', label:'食洗機', order:17 };
    if (/照明|シーリング/.test(s)) return { group:'other', label:'照明', order:18 };
    if (/取付|設置/.test(s)) return { group:'other', label:'取付・設置', order:19 };
    return { group:'other', label:s, order:200 };
  }

  function splitWorks(works){
    const sizeMap = new Map();
    const otherMap = new Map();
    Object.entries(works || {}).forEach(([rawLabel, count]) => {
      const meta = normalizeWorkLabel(rawLabel);
      const itemMap = meta.group === 'size' ? sizeMap : otherMap;
      if (!itemMap.has(meta.label)) itemMap.set(meta.label, { label:meta.label, count:0, order:meta.order });
      itemMap.get(meta.label).count += num(count);
    });

    const fixedSizeLabels = ['サイズ①','サイズ②','サイズ③','サイズ④','サイズ⑤','サイズ⑥','サイズ⑦'];
    const size = fixedSizeLabels.map((label,idx)=> sizeMap.get(label) || { label, count:0, order:idx+1 });
    const other = Array.from(otherMap.values()).filter(x=>x.count>0).sort((a,b)=>a.order-b.order || b.count-a.count || a.label.localeCompare(b.label,'ja'));
    return { size, other };
  }

  function renderWorkerAmountNote(){
    const selector = document.getElementById('field-common-selector-box');
    const view = document.getElementById('view-field-worker');
    if (!view) return;
    let note = document.getElementById('worker-amount-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'worker-amount-note';
      note.style.cssText = 'margin:-4px 0 14px;color:#64748b;font-size:12px;line-height:1.6;padding:0 4px';
      if (selector && selector.parentNode === view) selector.insertAdjacentElement("afterend", note);
      else view.insertBefore(note, view.firstChild);
    }
    note.innerHTML = '※作業者分析の金額は、作業者CSVから幹線料金を除外して表示しています。';
  }

  function makeKpi(rec, rows, ym){
    const kpi = document.getElementById('f-kpi-worker');
    if (!kpi) return;
    const totalCount = rows.reduce((s,r)=>s+r.count,0);
    const totalAmount = rows.reduce((s,r)=>s+r.amount,0);
    const workDayCount = num(rec.workDayCount || safeArray(rec.workDays).length || 0);
    const avgCount = workDayCount > 0 ? totalCount / workDayCount : 0;
    const avgSales = workDayCount > 0 ? totalAmount / workDayCount : 0;
    kpi.style.gridTemplateColumns = 'repeat(6,minmax(0,1fr))';
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">対象月</div><div class="kpi-value">${esc(ymText(ym))}</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">配送件数</div><div class="kpi-value">${fmt(totalCount)}</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">稼働日数</div><div class="kpi-value">${workDayCount ? fmt(workDayCount) : '—'}日</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">平均件数/日</div><div class="kpi-value">${workDayCount ? fmt1(avgCount) : '—'}件</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">平均売上/日</div><div class="kpi-value">${workDayCount ? fmtK(avgSales) : '—'}千円</div></div>
      <div class="kpi-card accent-amber"><div class="kpi-label">金額</div><div class="kpi-value">${fmtK(totalAmount)}千円</div></div>`;
  }

  function renderStatusNotice(){
    const el = document.getElementById('worker-join-notice');
    if (el) el.remove();
    renderWorkerAmountNote();
  }

  function renderRanking(rows, selectedName){
    const box = document.getElementById('f-worker-bars');
    if (!box) return;
    const maxCount = Math.max(...rows.map(r=>r.count), 1);
    const topRows = rows.slice(0, 50);

    box.innerHTML = `
      <div class="worker-card-intro">
        <div class="worker-card-main-title">作業者別ランキング</div>
        <div class="worker-card-sub-title">配送件数・平均件数/日・平均売上/日を比較</div>
      </div>
      <div class="scroll-x">
        <table class="tbl field-worker-ranking-table">
          <thead><tr>
            <th style="width:48px">順位</th><th>作業者</th><th class="r">配送件数</th><th class="r">稼働日</th><th class="r">平均件数/日</th><th class="r">平均売上/日</th><th class="r">金額</th>
          </tr></thead>
          <tbody>${topRows.map((r,i)=>{
            const active = r.label === selectedName;
            const width = Math.max(3, r.count / maxCount * 100);
            return `<tr class="field-worker-row ${active ? 'is-active' : ''}" data-worker="${esc(r.label)}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')">
              <td><span class="rank-badge">${i+1}</span></td>
              <td><strong>${esc(r.label)}</strong><div class="mini-track"><div class="mini-fill" style="width:${width.toFixed(1)}%"></div></div></td>
              <td class="r"><strong>${fmt(r.count)}</strong>件</td>
              <td class="r">${r.workDayCount ? fmt(r.workDayCount)+'日' : '—'}</td>
              <td class="r"><strong>${r.workDayCount ? fmt1(r.avgPerWorkDay) : '—'}</strong>件/日</td>
              <td class="r"><strong>${r.workDayCount ? fmtK(r.avgSalesPerWorkDay) : '—'}</strong>千円/日</td>
              <td class="r">${fmtK(r.amount)}千</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function renderBarList(containerId, items, unitLabel){
    const box = document.getElementById(containerId);
    if (!box) return;
    const positive = items.filter(x=>num(x.count)>0);
    if (!positive.length) {
      box.innerHTML = '<div class="field-empty-overlay" style="position:static;padding:28px 10px;text-align:center;color:var(--text3)">データなし</div>';
      return;
    }
    const max = Math.max(...positive.map(x=>num(x.count)), 1);
    box.innerHTML = positive.map((it,idx)=>{
      const width = Math.max(2, num(it.count)/max*100);
      return `<div class="work-break-row">
        <div class="work-break-label" title="${esc(it.label)}">${idx+1}. ${esc(it.label)}</div>
        <div class="work-break-track"><div class="work-break-fill" style="width:${width.toFixed(1)}%"></div></div>
        <div class="work-break-value">${fmt(it.count)}${unitLabel}</div>
      </div>`;
    }).join('');
  }

  function ensureWorkerChartStyles(){
    if (document.getElementById('worker-bar-style-20260501')) return;
    const style = document.createElement('style');
    style.id = 'worker-bar-style-20260501';
    style.textContent = `
      .worker-detail-summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .worker-detail-summary span{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);background:#f8fafc;border-radius:999px;padding:6px 10px;font-size:12px;color:#334155}
      .worker-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;height:auto}
      .worker-chart-card{border:1px solid var(--border);border-radius:12px;padding:12px;background:#fff;min-height:300px}
      .worker-chart-title{font-weight:900;color:#334155;margin-bottom:12px}
      .worker-chart-wrap{height:auto;min-height:230px;position:relative}
      .work-break-row{display:grid;grid-template-columns:minmax(92px,130px) minmax(120px,1fr) minmax(70px,90px);gap:10px;align-items:center;margin:9px 0}
      .work-break-label{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}
      .work-break-track{height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden}
      .work-break-fill{height:100%;background:#1a4d7c;border-radius:999px}
      .work-break-value{text-align:right;font-size:12px;font-weight:900;color:#0f172a;white-space:nowrap}
      .worker-card-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin:0 0 12px;padding:2px 0 10px;border-bottom:1px solid #edf2f7}
      .worker-card-main-title{font-size:16px;font-weight:900;color:#0f172a;letter-spacing:.02em}
      .worker-card-sub-title{font-size:12px;font-weight:700;color:#64748b}
      .field-worker-ranking-table th{font-size:12px;color:#334155;background:#f3f6fb}
      .field-worker-ranking-table td{font-size:13px;padding-top:10px;padding-bottom:10px}
      .field-worker-ranking-table .field-worker-row.is-active td{background:#eaf3ff !important;border-top:1px solid #bfdbfe;border-bottom:1px solid #bfdbfe}
      .field-worker-ranking-table .field-worker-row.is-active td:first-child{border-left:4px solid #1a4d7c}
      .field-worker-ranking-table .field-worker-row{cursor:pointer}
      .field-worker-ranking-table .field-worker-row:hover td{background:#f8fbff}
      .rank-badge{display:inline-flex;align-items:center;justify-content:center;min-width:25px;height:25px;border-radius:999px;background:#e5eef9;color:#1a4d7c;font-weight:900}
      .field-worker-row.is-active .rank-badge{background:#1a4d7c;color:#fff}
      .worker-selected-hero{border:1px solid #bfdbfe;background:linear-gradient(135deg,#eff6ff,#ffffff);border-radius:14px;padding:14px 16px;margin-bottom:12px}
      .worker-selected-name{font-size:20px;font-weight:900;color:#0f172a;line-height:1.25}
      .worker-selected-meta{font-size:12px;font-weight:800;color:#475569;margin-top:6px}
      .worker-detail-summary span{font-size:12px;font-weight:800}
      .worker-chart-title{font-size:14px}
      .work-break-label,.work-break-value{font-size:13px}
      @media(max-width:1200px){.worker-chart-grid{grid-template-columns:1fr}.worker-chart-card{min-height:unset}.worker-card-intro{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function renderWorkerDetail(row){
    ensureWorkerChartStyles();
    const titleEl = document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-title');
    if (titleEl) titleEl.textContent = row ? `選択中の作業者：${row.label}` : '選択中の作業者';
    const oldCanvas = document.getElementById('c-worker-content');
    const body = oldCanvas ? oldCanvas.parentElement : document.querySelector('#view-field-worker .grid2 .card:nth-child(2) .card-body');
    if (!body) return;
    if (!document.getElementById('worker-size-bars') || !document.getElementById('worker-other-bars')) {
      body.style.height = 'auto'; body.style.position = 'relative';
      body.innerHTML = `<div class="worker-selected-hero" id="worker-selected-hero"></div><div class="worker-detail-summary" id="worker-detail-summary"></div><div class="worker-chart-grid"><div class="worker-chart-card"><div class="worker-chart-title">サイズ系（①〜⑦）</div><div class="worker-chart-wrap" id="worker-size-bars"></div></div><div class="worker-chart-card"><div class="worker-chart-title">その他（表記統合）</div><div class="worker-chart-wrap" id="worker-other-bars"></div></div></div>`;
    }
    const hero = document.getElementById('worker-selected-hero');
    const summary = document.getElementById('worker-detail-summary');
    if (!row) {
      if (hero) hero.innerHTML = '<div class="worker-selected-name">作業者を選択してください</div>';
      if (summary) summary.innerHTML = '<span>ランキング行をクリックすると内訳が表示されます</span>';
      renderBarList('worker-size-bars', [], '件');
      renderBarList('worker-other-bars', [], '件');
      return;
    }
    const split = splitWorks(row.works);
    const sizeTotal = split.size.reduce((s,x)=>s+num(x.count),0);
    const otherTotal = split.other.reduce((s,x)=>s+num(x.count),0);
    if (hero) hero.innerHTML = `<div class="worker-selected-name">${esc(row.label)}</div><div class="worker-selected-meta">配送 ${fmt(row.count)}件 ｜ 稼働 ${row.workDayCount ? fmt(row.workDayCount) : '—'}日 ｜ 平均 ${row.workDayCount ? fmt1(row.avgPerWorkDay) : '—'}件/日 ｜ ${row.workDayCount ? fmtK(row.avgSalesPerWorkDay) : '—'}千円/日</div>`;
    if (summary) summary.innerHTML = `
      <span><strong>${esc(row.label)}</strong></span>
      <span>配送件数：<strong>${fmt(row.count)}</strong>件</span>
      <span>稼働：<strong>${row.workDayCount ? fmt(row.workDayCount) : '—'}</strong>日</span>
      <span>平均件数/日：<strong>${row.workDayCount ? fmt1(row.avgPerWorkDay) : '—'}</strong>件</span>
      <span>平均売上/日：<strong>${row.workDayCount ? fmtK(row.avgSalesPerWorkDay) : '—'}</strong>千円</span>
      <span>金額：<strong>${fmtK(row.amount)}</strong>千</span>
      <span>サイズ系：<strong>${fmt(sizeTotal)}</strong>件</span><span>その他：<strong>${fmt(otherTotal)}</strong>件</span>`;
    renderBarList('worker-size-bars', split.size, '件');
    renderBarList('worker-other-bars', split.other, '件');
  }

  function renderDetailTable(rows, selectedName){
    const tbody = document.getElementById('f-worker-tbody');
    if (!tbody) return;
    const tableRows = rows.slice(0, 100);
    tbody.innerHTML = tableRows.map((r,i)=>`<tr class="field-worker-detail-row ${r.label===selectedName?'is-active':''}" onclick="FIELD_WORKER_UI.selectWorker('${jsArg(r.label)}')" style="cursor:pointer"><td><strong>${i+1}. ${esc(r.label)}</strong></td><td class="r">${fmt(r.count)}</td><td class="r">${r.workDayCount?fmt(r.workDayCount):'—'}</td><td class="r">${r.workDayCount?fmt1(r.avgPerWorkDay):'—'}</td><td class="r">${r.workDayCount?fmtK(r.avgSalesPerWorkDay):'—'}</td><td class="r">${fmtK(r.amount)}</td></tr>`).join('');
  }

  function ensureDetailHeader(){
    const table = document.getElementById('f-worker-tbody')?.closest('table');
    if (!table) return;
    const thead = table.querySelector('thead tr');
    if (thead) thead.innerHTML = '<th>作業者</th><th class="r">配送件数</th><th class="r">稼働日</th><th class="r">平均件数/日</th><th class="r">平均売上/日</th><th class="r">金額（千円）</th>';
  }

  function render(){
    try {
      if (typeof window.setupFieldCommonSelectors === 'function') window.setupFieldCommonSelectors();
    } catch(e) {}
    const ym = selectedYM();
    const rec = workerRecord(ym);
    const rows = rowsFromRecord(rec);
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

  const oldRefresh = window.refreshFieldAll;
  window.refreshFieldAll = function(...args){
    if (typeof oldRefresh === 'function') oldRefresh.apply(this,args);
    try { render(); } catch(e) { console.error(e); }
  };


  function forceRenderSoon(){
    clearTimeout(window.__fieldWorkerForceTimer);
    window.__fieldWorkerForceTimer = setTimeout(()=>{
      try {
        const view = document.getElementById('view-field-worker');
        if (view && view.classList.contains('active')) render();
      } catch(e) { console.error(e); }
    }, 30);
  }

  // field_core側の月・年度変更処理で旧描画が走った後、必ず作業者専用UIで上書きする
  document.addEventListener('change', (e)=>{
    const id = e.target && e.target.id;
    if (id === 'field-common-month-select' || id === 'field-common-fy-select') forceRenderSoon();
  }, true);

  document.addEventListener('click', (e)=>{
    const nav = e.target && e.target.closest ? e.target.closest('[data-view="field-worker"]') : null;
    if (nav) forceRenderSoon();
  }, true);

  // 旧renderWorkerがテキストランキングを描いた場合も検知して戻す
  document.addEventListener('DOMContentLoaded', ()=>{
    const box = document.getElementById('f-worker-bars');
    if (box && window.MutationObserver) {
      const mo = new MutationObserver(()=>{
        const view = document.getElementById('view-field-worker');
        if (!view || !box || !view.classList.contains('active')) return;
        if (!box.querySelector('.field-worker-ranking-table')) forceRenderSoon();
      });
      mo.observe(box, { childList:true, subtree:false });
    }
    setTimeout(()=>{ try { render(); } catch(e){} }, 250);
  });
})();
