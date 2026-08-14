/* =====================================================================
   経営管理システム pl.js
   2026-05-01
   ・app.jsから月次収支表（PL）を安全分割
   ・STATE / STORE / CSV / 計画データ / 共通関数はapp.js側を使用
   ・このファイルは月次収支表の期間セレクタ、折りたたみ、表描画のみ担当
===================================================================== */
'use strict';

(function(){
  if (window.__PL_MODULE_LOADED_20260501__) return;
  window.__PL_MODULE_LOADED_20260501__ = true;

function renderPLPeriodSelector() {
  const tbody = document.getElementById('pl-tbody');
  if (!tbody) return;
  const tableCard = tbody.closest('.card') || tbody.closest('section') || tbody.parentElement?.parentElement;
  if (!tableCard || !tableCard.parentNode) return;
  let box = document.getElementById('pl-period-selector');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pl-period-selector';
    tableCard.parentNode.insertBefore(box, tableCard);
  }
  if (window.PERIOD_UI?.render) {
    PERIOD_UI.render(box, {
      viewKey: 'pl',
      kind: 'all',
      useMonth: true,
      subtitle: '年度順：4月 → 翌年3月 / 月次収支表を切替',
      onChange: () => { renderPL(); UI.updateTopbar('pl'); }
    });
  }
}

/* ════════ §13 RENDER — P&L ════════════════════════════════════ */
const PL_TOGGLE = {
  _open: {},
  isOpen(id) {
    return !!this._open[id];
  },
  toggle(id) {
    this._open[id] = !this._open[id];
    renderPL();
  }
};

function ensurePLStyle() {
  if (document.getElementById('pl-fold-style')) return;
  const style = document.createElement('style');
  style.id = 'pl-fold-style';
  style.textContent = `
    #pl-tbl .col-current { background:#eef6ff; }
    #pl-tbl .col-plan { background:#fff8e1; }
    #pl-tbl .col-prev { background:#f6f8fb; border-left:2px solid #b8c3d1; }
    #pl-tbl .col-lastyear { background:#faf8ff; border-left:2px solid #c8bfdf; }
    #pl-tbl .pl-group-row td { background:#f8fafc; border-top:1px solid #cbd5e1; }
    #pl-tbl .pl-child-row td { font-size:12px; color:#475569; }
    #pl-tbl .pl-total-row td { background:#eef2f7; font-weight:900; border-top:2px solid #94a3b8; }
    #pl-tbl .pl-profit-row td { background:#ecfdf5; font-weight:900; border-top:2px solid #16a34a; }
    #pl-tbl .pl-fold-btn {
      width:22px;
      height:22px;
      border:1px solid #94a3b8;
      border-radius:6px;
      background:#fff;
      color:#1a4d7c;
      font-weight:900;
      line-height:18px;
      margin-right:7px;
      cursor:pointer;
      box-shadow:0 1px 2px rgba(15,23,42,.08);
    }
    #pl-tbl .pl-fold-spacer { display:inline-block; width:32px; }
    #pl-tbl .pl-child-label { color:#475569; }
  `;
  document.head.appendChild(style);
}

function renderPL() {
  ensurePLStyle();

  const notice = document.getElementById('pl-notice');
  const tbody  = document.getElementById('pl-tbody');
  if (!tbody) return;

  renderPLPeriodSelector();

  const ds = selectedDashboardDS();
  if (!ds) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">データがありません</div>';
    tbody.innerHTML = '';
    return;
  }
  if (notice) notice.innerHTML = '';

  const kpiArea = document.getElementById('pl-kpi-area');
  if (kpiArea) {
    const revenue = n(ds.totalIncome || 0);
    const expense = n(ds.totalExpense || 0);
    const profit = revenue - expense;
    const profitRate = revenue > 0 ? profit / revenue * 100 : 0;
    const laborRate = n(ds.pseudoLaborRate || 0);
    kpiArea.innerHTML = `
      <div class="pl-kpi-card pl-kpi-primary">
        <span>センター利益（粗利）</span>
        <strong class="${profit >= 0 ? 'profit-positive' : 'profit-negative'}">${fmtK(profit)}<small>千円</small></strong>
        <em>利益率 ${pct(profitRate)}</em>
      </div>
      <div class="pl-kpi-card">
        <span>営業収益</span>
        <strong>${fmtK(revenue)}<small>千円</small></strong>
        <em>${ymLabel(ds.ym)} ${datasetKindLabel(ds)}</em>
      </div>
      <div class="pl-kpi-card">
        <span>費用合計</span>
        <strong>${fmtK(expense)}<small>千円</small></strong>
        <em>収入比 ${revenue > 0 ? pct(expense / revenue * 100) : '—'}</em>
      </div>
      <div class="pl-kpi-card">
        <span>みなし人件費率</span>
        <strong class="${laborRate <= CONFIG.TARGETS.pseudoLaborRate ? 'profit-positive' : 'profit-negative'}">${pct(laborRate)}</strong>
        <em>目標 ${CONFIG.TARGETS.pseudoLaborRate}%以内</em>
      </div>`;
  }

  const prev = prevDS(ds.ym);
  const py   = sameMonthLastYear(ds.ym);
  const fy   = fiscalYearFromYM(ds.ym);
  const mm   = ds.ym.slice(4,6);
  const plan = getPlanRowsForFiscalYear(fy);

  function valueFromRows(dataSet, keys) {
    if (!dataSet) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.reduce((sum, key) => sum + n(dataSet.rows?.[key] ?? 0), 0);
  }

  function planValue(label, keys) {
    if (!plan) return null;

    if (label === '売上原価') {
      const direct = readPlanValueByLabel(plan, '売上原価', mm);
      if (direct != null) return direct;
      return CONFIG.PL_DEF
        .filter(d => d.type === 'group' && d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(plan, d.label, mm, d.keys) || 0), 0);
    }

    if (label === '粗利益') {
      const direct = readPlanValueByLabel(plan, '粗利益', mm);
      if (direct != null) return direct;
      const revenue = getPlanValueK(plan, '営業収益', mm, CONFIG.PL_DEF.find(d=>d.id==='revenue')?.keys || CONFIG.INCOME_KEYS) || 0;
      const cost = CONFIG.PL_DEF
        .filter(d => d.type === 'group' && d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(plan, d.label, mm, d.keys) || 0), 0);
      return revenue - cost;
    }

    return getPlanValueK(plan, label, mm, keys);
  }

  const totalRevenue = ds.totalIncome || valueFromRows(ds, CONFIG.INCOME_KEYS) || 0;
  const totalCost    = ds.totalExpense || valueFromRows(ds, CONFIG.EXPENSE_KEYS) || 0;
  const totalGross   = totalRevenue - totalCost;

  const prevRevenue = prev ? (prev.totalIncome || valueFromRows(prev, CONFIG.INCOME_KEYS) || 0) : null;
  const prevCost    = prev ? (prev.totalExpense || valueFromRows(prev, CONFIG.EXPENSE_KEYS) || 0) : null;
  const prevGross   = prev ? (prevRevenue - prevCost) : null;

  const pyRevenue = py ? (py.totalIncome || valueFromRows(py, CONFIG.INCOME_KEYS) || 0) : null;
  const pyCost    = py ? (py.totalExpense || valueFromRows(py, CONFIG.EXPENSE_KEYS) || 0) : null;
  const pyGross   = py ? (pyRevenue - pyCost) : null;

  const rows = [];
  const exportRows = [];

  for (const def of CONFIG.PL_DEF) {
    if (def.type === 'group') {
      const actual = def.id === 'revenue' ? totalRevenue : valueFromRows(ds, def.keys);
      const prevV  = def.id === 'revenue' ? prevRevenue : valueFromRows(prev, def.keys);
      const pyV    = def.id === 'revenue' ? pyRevenue : valueFromRows(py, def.keys);
      const planV  = planValue(def.label, def.keys);
      const open   = PL_TOGGLE.isOpen(def.id);

      const groupOpt = {
        label: def.label,
        value: actual,
        base: totalRevenue,
        planV,
        prevV,
        pyV,
        bold: true,
        groupId: def.id,
        open,
        rowClass: 'pl-group-row'
      };
      rows.push(makePLRow(groupOpt));
      exportRows.push(makeExportPLRow(groupOpt));

      if (open && Array.isArray(def.children)) {
        for (const child of def.children) {
          const childActual = valueFromRows(ds, child.keys);
          const childPrev   = valueFromRows(prev, child.keys);
          const childPy     = valueFromRows(py, child.keys);
          const childPlan   = planValue(child.label, child.keys);

          if (!childActual && !childPrev && !childPy && !childPlan) continue;

          const childOpt = {
            label: child.label,
            value: childActual,
            base: totalRevenue,
            planV: childPlan,
            prevV: childPrev,
            pyV: childPy,
            bold: false,
            child: true,
            rowClass: 'pl-child-row'
          };
          rows.push(makePLRow(childOpt));
          exportRows.push(makeExportPLRow(childOpt));
        }
      }

      continue;
    }

    if (def.type === 'total-cost') {
      const totalCostOpt = {
        label: def.label,
        value: totalCost,
        base: totalRevenue,
        planV: planValue('売上原価', CONFIG.EXPENSE_KEYS),
        prevV: prevCost,
        pyV: pyCost,
        bold: true,
        total: true,
        rowClass: 'pl-total-row'
      };
      rows.push(makePLRow(totalCostOpt));
      exportRows.push(makeExportPLRow(totalCostOpt));
      continue;
    }

    if (def.type === 'gross-profit') {
      const grossProfitOpt = {
        label: def.label,
        value: totalGross,
        base: totalRevenue,
        planV: planValue('粗利益', []),
        prevV: prevGross,
        pyV: pyGross,
        bold: true,
        total: true,
        rowClass: 'pl-profit-row'
      };
      rows.push(makePLRow(grossProfitOpt));
      exportRows.push(makeExportPLRow(grossProfitOpt));
      continue;
    }
  }

  tbody.innerHTML = rows.join('');

  const title = document.getElementById('pl-card-title');
  if (title) title.textContent = `月次収支表（${ymLabel(ds.ym)}・${datasetKindLabel(ds)}）`;

  /* ---- 出力用構造化データの構築（Phase10-C2追加） ----
     画面表示に使った計算済みexportRowsをそのまま再利用する。
     Dataset/planDataからの再集計は一切行わない。 */
  window.PL_UI_EXPORT = window.PL_UI_EXPORT || {};
  window.PL_UI_EXPORT._lastExportData = {
    title: '月次収支表',
    center: (typeof CENTER !== 'undefined' && CENTER?.name) ? CENTER.name : '',
    period: ymLabel(ds.ym) + '　単位：千円',
    filename: (typeof EXPORT_SERVICE !== 'undefined' && EXPORT_SERVICE.buildFilename)
      ? EXPORT_SERVICE.buildFilename([(typeof CENTER !== 'undefined' && CENTER?.name) || '', '月次収支', ds.ym], 'xlsx')
      : null,
    sheets: [{
      name: '月次収支表',
      columns: ['科目', '実績', '収入比', '計画', '計画差異', '計画比', '前月実績', '前月差異', '前月比', '前年実績', '前年差異', '前年比'],
      rows: exportRows,
    }],
  };
}


function openPLFullView() {
  const modal = document.getElementById('pl-fullscreen');
  const fullBody = document.getElementById('pl-full-tbody');
  if (!modal || !fullBody) return;

  const savedOpen = { ...PL_TOGGLE._open };
  for (const def of CONFIG.PL_DEF) {
    if (def.type === 'group') PL_TOGGLE._open[def.id] = true;
  }

  renderPL();
  const mainBody = document.getElementById('pl-tbody');
  fullBody.innerHTML = mainBody ? mainBody.innerHTML : '';
  fullBody.querySelectorAll('.pl-fold-btn').forEach((button) => {
    const label = document.createElement('span');
    label.className = 'pl-fold-spacer';
    button.replaceWith(label);
  });

  PL_TOGGLE._open = savedOpen;
  renderPL();

  const ds = selectedDashboardDS();
  const title = document.getElementById('pl-fullscreen-title');
  if (title && ds) title.textContent = `月次収支表 全項目（${ymLabel(ds.ym)}・${datasetKindLabel(ds)}）`;

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('pl-fullscreen-open');
}

function closePLFullView() {
  const modal = document.getElementById('pl-fullscreen');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pl-fullscreen-open');
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePLFullView();
});

function makePLRow(opt) {
  const label = opt.label || '';
  const v = n(opt.value);
  const base = n(opt.base);
  const planK = opt.planV != null ? opt.planV : null;
  const prevV = opt.prevV != null ? opt.prevV : null;
  const pyV = opt.pyV != null ? opt.pyV : null;
  const boldStyle = opt.bold ? 'font-weight:900' : '';
  const rowClass = opt.rowClass || '';
  const rat = base && base > 0 ? pct(v / base * 100) : '—';

  let labelHtml = esc(label);
  if (opt.groupId) {
    const mark = opt.open ? '－' : '＋';
    labelHtml = `<button class="pl-fold-btn" onclick="PL_TOGGLE.toggle('${esc(opt.groupId)}')">${mark}</button>${esc(label)}`;
  } else if (opt.child) {
    labelHtml = `<span class="pl-fold-spacer"></span><span class="pl-child-label">└ ${esc(label)}</span>`;
  } else if (opt.total) {
    labelHtml = `<span class="pl-fold-spacer"></span>${esc(label)}`;
  }

  const planDiffClass = planK != null ? (v >= planK * 1000 ? 'cell-up' : 'cell-down') : '';
  const prevDiffClass = prevV != null ? (v >= prevV ? 'cell-up' : 'cell-down') : '';
  const pyDiffClass   = pyV != null ? (v >= pyV ? 'cell-up' : 'cell-down') : '';

  return `<tr class="${rowClass}">
    <td style="${boldStyle}">${labelHtml}</td>
    <td class="r col-current" style="${boldStyle}">${fmtK(v)}</td>
    <td class="r col-current">${rat}</td>
    <td class="r col-plan">${planK!=null?fmt(planK):'—'}</td>
    <td class="r col-plan ${planDiffClass}">${planK!=null?diff(v,planK*1000):'—'}</td>
    <td class="r col-plan">${planK!=null?ratio(v,planK*1000):'—'}</td>
    <td class="r col-prev">${prevV!=null?fmtK(prevV):'—'}</td>
    <td class="r col-prev ${prevDiffClass}">${prevV!=null?diff(v,prevV):'—'}</td>
    <td class="r col-prev">${prevV!=null?ratio(v,prevV):'—'}</td>
    <td class="r col-lastyear">${pyV!=null?fmtK(pyV):'—'}</td>
    <td class="r col-lastyear ${pyDiffClass}">${pyV!=null?diff(v,pyV):'—'}</td>
    <td class="r col-lastyear">${pyV!=null?ratio(v,pyV):'—'}</td>
  </tr>`;
}

/* ---------- Excel出力用の並行ヘルパー（Phase10-C2追加） ----------
   makePLRow(opt)と全く同一のopt引数を受け取り、HTML文字列の代わりに
   Excel用の配列行を返す。makePLRow(opt)自体・その呼出コードは一切
   変更していない。金額は既存fmtK/fmtと同じ単位変換（実績・前月・
   前年は円→千円、計画は既に千円のためそのまま）を数値型で行う。
   比率（収入比・計画比・前月比・前年比）は既存ratio()/pct()と同じ
   計算式を数値化して用いる。分析値自体（v/base/planV/prevV/pyV）は
   呼出元から渡されたものをそのまま使い、一切再計算しない。 */
function makeExportPLRow(opt) {
  const label = opt.label || '';
  const v = n(opt.value);
  const base = n(opt.base);
  const planK = opt.planV != null ? opt.planV : null;
  const prevV = opt.prevV != null ? opt.prevV : null;
  const pyV = opt.pyV != null ? opt.pyV : null;
  const ratNum = base && base > 0 ? (v / base) : null;
  const planDiff = planK != null ? (v - planK * 1000) : null;
  const planRatio = planK != null && Number(planK) !== 0 ? (v / (planK * 1000) - 1) : null;
  const prevDiff = prevV != null ? (v - prevV) : null;
  const prevRatio = prevV != null && Number(prevV) !== 0 ? (v / prevV - 1) : null;
  const pyDiff = pyV != null ? (v - pyV) : null;
  const pyRatio = pyV != null && Number(pyV) !== 0 ? (v / pyV - 1) : null;

  const displayLabel = opt.child ? `└ ${label}` : label;

  return [
    displayLabel,
    v / 1000,
    ratNum,
    planK != null ? planK : null,
    planDiff != null ? planDiff / 1000 : null,
    planRatio,
    prevV != null ? prevV / 1000 : null,
    prevDiff != null ? prevDiff / 1000 : null,
    prevRatio,
    pyV != null ? pyV / 1000 : null,
    pyDiff != null ? pyDiff / 1000 : null,
    pyRatio,
  ];
}

  window.PL_TOGGLE = PL_TOGGLE;
  window.renderPL = renderPL;
  window.openPLFullView = openPLFullView;
  window.closePLFullView = closePLFullView;

  /* ---------- Excel出力 / 印刷（Phase10-C2追加） ---------- */
  function plExportExcel() {
    const data = window.PL_UI_EXPORT?._lastExportData;
    if (!data) { if (window.UI?.toast) UI.toast('出力するデータがありません', 'warn'); return; }
    if (!window.EXPORT_SERVICE) { if (window.UI?.toast) UI.toast('出力機能を読み込めませんでした', 'error'); return; }
    EXPORT_SERVICE.toExcel(data).catch(e => {
      console.error('[PL_UI.exportExcel]', e);
      if (window.UI?.toast) UI.toast('Excel出力に失敗しました: ' + e.message, 'error');
    });
  }
  function plPrintReport() {
    const data = window.PL_UI_EXPORT?._lastExportData;
    if (!data) { if (window.UI?.toast) UI.toast('印刷するデータがありません', 'warn'); return; }
    if (!window.EXPORT_SERVICE) { if (window.UI?.toast) UI.toast('出力機能を読み込めませんでした', 'error'); return; }
    EXPORT_SERVICE.toPrint(data);
  }
  window.PL_UI_EXPORT = window.PL_UI_EXPORT || {};
  window.PL_UI_EXPORT.exportExcel = plExportExcel;
  window.PL_UI_EXPORT.printReport = plPrintReport;
})();
