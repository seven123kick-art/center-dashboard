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

  const years = dashboardAvailableFiscalYears();
  const fy = dashboardSelectedFiscalYear();
  const months = monthsOfFiscalYear(fy);
  const selectedYM = dashboardSelectedYM();
  const monthOptions = months.map(ym => {
    const ds = activeDatasetByYM(ym);
    const label = ds ? `${ymLabel(ym)}（${datasetKindLabel(ds)}）` : `${ymLabel(ym)}（未登録）`;
    return `<option value="${ym}" ${ym===selectedYM?'selected':''} ${ds?'':'disabled'}>${label}</option>`;
  }).join('');

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:#fff;border:1px solid var(--border,#d9dee8);border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.05)">
      <div>
        <div style="font-weight:900;color:var(--text,#1f2d3d);font-size:14px">表示対象</div>
        <div style="font-size:12px;color:var(--text3,#8090a3);margin-top:3px">年度順：4月 → 翌年3月 / 月次収支表を切替</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象年度
          <select id="pl-fy-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800">
            ${years.map(y=>`<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;font-weight:800;color:var(--text2,#52606d)">対象月
          <select id="pl-ym-select" style="margin-left:6px;padding:8px 28px 8px 10px;border:1px solid var(--border,#d9dee8);border-radius:9px;background:#fff;font-weight:800;min-width:190px">
            ${monthOptions || '<option value="">データなし</option>'}
          </select>
        </label>
      </div>
    </div>`;

  const fySel = document.getElementById('pl-fy-select');
  const ymSel = document.getElementById('pl-ym-select');
  if (fySel) fySel.onchange = () => {
    STATE.fiscalYear = fySel.value;
    const list = monthsOfFiscalYear(STATE.fiscalYear).filter(ym => activeDatasetByYM(ym));
    STATE.selYM = list.length ? list[list.length - 1] : null;
    renderPL();
    UI.updateTopbar('pl');
  };
  if (ymSel) ymSel.onchange = () => {
    if (ymSel.value) STATE.selYM = ymSel.value;
    renderPL();
    UI.updateTopbar('pl');
  };
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
    #pl-tbl .col-prev { background:#f5f6f8; border-left:4px solid #94a3b8; }
    #pl-tbl .col-lastyear { background:#fff1f7; border-left:4px solid #d946ef; }
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

  for (const def of CONFIG.PL_DEF) {
    if (def.type === 'group') {
      const actual = def.id === 'revenue' ? totalRevenue : valueFromRows(ds, def.keys);
      const prevV  = def.id === 'revenue' ? prevRevenue : valueFromRows(prev, def.keys);
      const pyV    = def.id === 'revenue' ? pyRevenue : valueFromRows(py, def.keys);
      const planV  = planValue(def.label, def.keys);
      const open   = PL_TOGGLE.isOpen(def.id);

      rows.push(makePLRow({
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
      }));

      if (open && Array.isArray(def.children)) {
        for (const child of def.children) {
          const childActual = valueFromRows(ds, child.keys);
          const childPrev   = valueFromRows(prev, child.keys);
          const childPy     = valueFromRows(py, child.keys);
          const childPlan   = planValue(child.label, child.keys);

          if (!childActual && !childPrev && !childPy && !childPlan) continue;

          rows.push(makePLRow({
            label: child.label,
            value: childActual,
            base: totalRevenue,
            planV: childPlan,
            prevV: childPrev,
            pyV: childPy,
            bold: false,
            child: true,
            rowClass: 'pl-child-row'
          }));
        }
      }

      continue;
    }

    if (def.type === 'total-cost') {
      rows.push(makePLRow({
        label: def.label,
        value: totalCost,
        base: totalRevenue,
        planV: planValue('売上原価', CONFIG.EXPENSE_KEYS),
        prevV: prevCost,
        pyV: pyCost,
        bold: true,
        total: true,
        rowClass: 'pl-total-row'
      }));
      continue;
    }

    if (def.type === 'gross-profit') {
      rows.push(makePLRow({
        label: def.label,
        value: totalGross,
        base: totalRevenue,
        planV: planValue('粗利益', []),
        prevV: prevGross,
        pyV: pyGross,
        bold: true,
        total: true,
        rowClass: 'pl-profit-row'
      }));
      continue;
    }
  }

  tbody.innerHTML = rows.join('');

  const title = document.getElementById('pl-card-title');
  if (title) title.textContent = `月次収支表（${ymLabel(ds.ym)}・${datasetKindLabel(ds)}）`;
}

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

  window.PL_TOGGLE = PL_TOGGLE;
  window.renderPL = renderPL;
})();
