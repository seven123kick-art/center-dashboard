/* =====================================================================
   経営管理システム budget_actual.js
   2026-08-14
   Version6 Phase10-B：予実差異分析
   ・月次PL全体を対象に「計画に対して実績がどうだったか」を一目で
     判断できる画面を新設する。
   ・実績データの取得は既存 activeDatasets() / activeDatasetByYM() /
     activeRealCsvDatasetByYM()（いずれもRepository.Dataset.getActive()
     経由の既存有効Dataset判定、速報/確定優先ロジックを含む）を
     そのまま使用する。本ファイルでは有効Dataset判定ロジックを
     一切新規実装しない。
   ・予算データの取得・科目突合には既存 readPlanValueByLabel() /
     PLAN_LABEL_ALIASES / normalizePlanLabel() / sumPlanValues() /
     getPlanValueK() をそのまま使用する。新規の単純な科目名完全一致
     ロジックは作らない。
   ・PL科目階層は既存 CONFIG.PL_DEF をそのまま正本として使用する。
   ・営業収益/営業費用/営業利益の合計値算出は、既存pl.jsの
     totalRevenue/totalCost/totalGross算出パターン
     （ds.totalIncome || valueFromRows(ds, CONFIG.INCOME_KEYS) など）を
     忠実に再現する。
   ・valueFromRows() / planValue()相当のヘルパーは、pl.js/
     profit_structure.js側のローカルクロージャ関数のため、モジュール
     境界を越えて直接呼び出せない（Phase10-B1確認済み）。そのため
     本ファイル内に同一ロジックの薄い複製を持つが、内部で使用する
     計算・取得はすべて既存グローバル関数（readPlanValueByLabel等）
     であり、新しい業務ロジックは追加していない。
   ・取込、保存、Cloud同期、Dataset/planData構造は一切変更しない。
   ・良化/悪化の色判定（ba-good/ba-bad）は本画面専用の新規クラスで
     あり、既存PL画面のcell-up/cell-downロジックには一切触れない。
===================================================================== */
'use strict';

(function () {
  if (window.__BUDGET_ACTUAL_MODULE_LOADED_20260814__) return;
  window.__BUDGET_ACTUAL_MODULE_LOADED_20260814__ = true;

  /* ---------- 表示整形（他モジュールと同一の防御パターン。実体は
     既存 src/core/format.js のグローバル関数をそのまま使う） ---------- */
  function escLocal(v) { return typeof esc === 'function' ? esc(v) : String(v ?? ''); }
  function fmtKLocal(v) { return typeof fmtK === 'function' ? fmtK(v) : '—'; }
  function fmtLocal(v) { return typeof fmt === 'function' ? fmt(v) : '—'; }
  function pctLocal(v) { return typeof pct === 'function' ? pct(v) : '—'; }
  function diffLocal(a, b) { return typeof diff === 'function' ? diff(a, b) : '—'; }
  function ratioLocal(a, b) { return typeof ratio === 'function' ? ratio(a, b) : '—'; }
  function ymLabelLocal(ym) { return typeof ymLabel === 'function' ? ymLabel(ym) : String(ym || ''); }

  /* ---------- 前年比の表示ロジック（今回追加） ----------
     既存の共通ratio()（src/core/format.js）は「!a||!b→'—'」という
     欠損判定のみを行い、比較対象（前年実績）がマイナスの場合を
     考慮していない。そのため前年が赤字だった場合に
     (実績/前年-1)*100 という計算式が意味をなさない極端な数値
     （例：-1,974.0%）を返してしまう。
     このratio()自体はPL/Trend/dashboard/indicators/report_ui.js等、
     他の完成済み画面でも広く使われている共通関数であり、今回は
     予実差異分析の前年比表示に限定した対応とするため、ratio()
     自体は一切変更しない（他画面への影響を避けるため）。
     前年が正数の場合は、既存ratio()の計算結果をそのまま使用し、
     通常の前年比計算は一切変更していない。 */
  function yoyRatioLabel(actual, compare) {
    if (actual == null || compare == null) return '—';
    if (compare > 0) return ratioLocal(actual, compare); // 通常ケース：既存計算をそのまま使用
    if (compare === 0) return '—'; // 0除算を避ける、既存ratio()と同じ挙動
    // compare < 0（前年が赤字）の場合
    if (actual > 0) return '黒字転換';
    if (actual === 0) return '—';
    // actual < 0（今年も赤字）
    if (actual > compare) return '赤字縮小';
    if (actual < compare) return '赤字拡大';
    return '—';
  }

  /* ---------- Excel数値セル用の薄いヘルパー（Phase10-C1追加） ----------
     既存diff()/ratio()（src/core/format.js）と完全に同一の計算式・
     完全に同一の欠損判定（!a||!bで欠損扱い）を用いる、表示形式の
     違いだけの薄いラッパー。分析値の計算・再集計は一切行わない。
     diff()/ratio()は「文字列」を返すためExcelセルへ直接入れると
     文字列型になってしまうため、Excel側で数値型として扱うために
     同じ計算式で数値そのものを返すだけの関数。 */
  function numDiff(a, b) {
    if (a == null || b == null || !a || !b) return null;
    return a - b;
  }
  function numRatio(a, b) {
    if (a == null || b == null || !a || !b) return null;
    return (a / b - 1); // Excel側でパーセント表示形式にすれば画面のratio()と同じ見た目になる
  }

  /* ---------- Excel出力用の前年比ヘルパー（今回追加） ----------
     画面のyoyRatioLabel()と同一の判定ロジック。前年が正数の通常
     ケースでは既存numRatio()の計算結果（数値）をそのまま返し、
     前年がマイナス/0の場合のみ意味のある文字列を返す。numRatio()
     自体・予算比計算は一切変更していない。 */
  function yoyRatioForExcel(actual, compare) {
    if (actual == null || compare == null) return null;
    if (compare > 0) return numRatio(actual, compare);
    if (compare === 0) return null;
    if (actual > 0) return '黒字転換';
    if (actual === 0) return null;
    if (actual > compare) return '赤字縮小';
    if (actual < compare) return '赤字拡大';
    return null;
  }

  /* ---------- Excel金額列の単位統一（円→千円、Phase10-C1修正） ----------
     画面表示では実績・前年（actRev等）は円単位のfmtK()で千円表示、
     予算（planRev等）はfmt()でそのまま千円表示という既存仕様がある
     （fmtK/fmtの定義自体は一切変更していない）。Excel出力では
     数値としてこの表示単位を統一するため、円単位の値だけをExcel
     格納直前に1000で割る。計算ロジック（actualRevenue/
     planGroupValue/numDiff/numRatio等）は一切変更していない。
     null/0は区別してそのまま維持し、0を欠損扱いにしない。 */
  function toK(v) {
    if (v == null) return null;
    return v / 1000;
  }

  /* ---------- 実績値の取得（pl.jsのローカルclosure valueFromRows()と
     完全に同一のロジック。モジュール境界のため複製が必要
     ―Phase10-B1確認済み。新しい算出方法ではない） ---------- */
  function valueFromRows(dataSet, keys) {
    if (!dataSet) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.reduce((sum, key) => sum + n(dataSet.rows?.[key] ?? 0), 0);
  }

  function groupDefs() {
    return (CONFIG.PL_DEF || []).filter(d => d && d.type === 'group');
  }

  /* ---------- 計画値の取得（pl.jsのローカルclosure planValue()と
     完全に同一のロジック。'営業費用'は既存pl.jsの'売上原価'ラベル
     （このシステムでは費用合計を指す既存運用）、'営業利益'は
     既存'粗利益'ラベルへ、それぞれそのままマッピングするだけで、
     算出方法自体は一切変更していない） ---------- */
  function planGroupValue(planRows, label, keys, mm) {
    if (!planRows || (typeof isPlanMonthAvailable==='function' && !isPlanMonthAvailable(planRows, mm))) return null;

    if (label === '営業費用') {
      const direct = readPlanValueByLabel(planRows, '売上原価', mm);
      if (direct != null) return direct;
      return groupDefs()
        .filter(d => d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(planRows, d.label, mm, d.keys) || 0), 0);
    }

    if (label === '営業利益') {
      const direct = readPlanValueByLabel(planRows, '粗利益', mm);
      if (direct != null) return direct;
      const revDef = groupDefs().find(d => d.id === 'revenue');
      const revenue = getPlanValueK(planRows, '営業収益', mm, revDef?.keys || CONFIG.INCOME_KEYS) || 0;
      const cost = groupDefs()
        .filter(d => d.id !== 'revenue')
        .reduce((sum, d) => sum + (getPlanValueK(planRows, d.label, mm, d.keys) || 0), 0);
      return revenue - cost;
    }

    return getPlanValueK(planRows, label, mm, keys);
  }

  /* ---------- 実績合計（pl.jsのtotalRevenue/totalCost/totalGross
     算出パターンと完全に同一。ds.totalIncome/totalExpenseを優先し、
     無ければCONFIG.INCOME_KEYS/EXPENSE_KEYSからの再集計にフォール
     バックする既存仕様をそのまま踏襲） ---------- */
  function actualRevenue(ds) {
    if (!ds) return null;
    return ds.totalIncome || valueFromRows(ds, CONFIG.INCOME_KEYS) || 0;
  }
  function actualExpense(ds) {
    if (!ds) return null;
    return ds.totalExpense || valueFromRows(ds, CONFIG.EXPENSE_KEYS) || 0;
  }
  function actualProfit(ds) {
    if (!ds) return null;
    const rev = actualRevenue(ds);
    const exp = actualExpense(ds);
    if (rev == null || exp == null) return null;
    return rev - exp;
  }

  /* ---------- 良化/悪化の色分類（本画面専用の新規UI分類ロジック。
     既存diff()/ratio()の「!a||!b→'—'」という既存の欠損/0判定と
     整合させ、数値差が表示されない場合は色も付けない） ---------- */
  function baDiffClass(actual, compare, isExpense) {
    if (actual == null || compare == null || !actual || !compare) return '';
    const rawDiff = actual - compare;
    if (rawDiff === 0) return 'ba-neutral';
    const isGood = isExpense ? (rawDiff < 0) : (rawDiff > 0);
    return isGood ? 'ba-good' : 'ba-bad';
  }

  function ensureStyle() {
    // Version6: visual styles live in assets/css/features/budget-actual.css.
  }

  function renderPeriodSelector() {
    const root = document.getElementById('budget-actual-root');
    if (!root) return;
    let box = document.getElementById('budget-actual-period-selector');
    if (!box) {
      box = document.createElement('div');
      box.id = 'budget-actual-period-selector';
      root.prepend(box);
    }
    if (window.PERIOD_UI?.render) {
      PERIOD_UI.render(box, {
        viewKey: 'budget-actual',
        kind: 'revenue',
        useMonth: true,
        subtitle: '年度順：4月 → 翌年3月 / 予算と実績の差異を確認',
        onChange: () => BUDGET_ACTUAL_UI.render()
      });
    }
  }

  function summaryCard(title, actual, planV, pyV, isExpense) {
    const diffPlan = (actual != null && planV != null) ? diffLocal(actual, planV * 1000) : '—';
    const ratioPlan = (actual != null && planV != null) ? ratioLocal(actual, planV * 1000) : '—';
    const diffPy = (actual != null && pyV != null) ? diffLocal(actual, pyV) : '—';
    const ratioPy = yoyRatioLabel(actual, pyV);
    const planDiffClass = baDiffClass(actual, planV != null ? planV * 1000 : null, isExpense);
    const pyDiffClass = baDiffClass(actual, pyV, isExpense);

    return `
      <div class="ba-summary-card">
        <div class="ba-summary-title">${escLocal(title)}</div>
        <table class="ba-summary-table">
          <tr><td>実績</td><td>${actual != null ? fmtKLocal(actual) : '—'}</td></tr>
          <tr><td>予算</td><td>${planV != null ? fmtLocal(planV) : '—'}</td></tr>
          <tr><td>予実差</td><td class="${planDiffClass}">${diffPlan}</td></tr>
          <tr><td>予算比</td><td class="${planDiffClass}">${ratioPlan}</td></tr>
          <tr><td>前年実績</td><td>${pyV != null ? fmtKLocal(pyV) : '—'}</td></tr>
          <tr><td>前年差</td><td class="${pyDiffClass}">${diffPy}</td></tr>
          <tr><td>前年比</td><td class="${pyDiffClass}">${ratioPy}</td></tr>
        </table>
      </div>`;
  }

  function subjectRow(label, actual, planV, pyV, isExpense, isTotal) {
    const diffPlan = (actual != null && planV != null) ? diffLocal(actual, planV * 1000) : '—';
    const ratioPlan = (actual != null && planV != null) ? ratioLocal(actual, planV * 1000) : '—';
    const diffPy = (actual != null && pyV != null) ? diffLocal(actual, pyV) : '—';
    const ratioPy = yoyRatioLabel(actual, pyV);
    const planDiffClass = baDiffClass(actual, planV != null ? planV * 1000 : null, isExpense);
    const pyDiffClass = baDiffClass(actual, pyV, isExpense);
    const rowClass = isTotal ? 'ba-total-row' : '';

    return `<tr class="${rowClass}">
      <td>${escLocal(label)}</td>
      <td class="r">${planV != null ? fmtLocal(planV) : '—'}</td>
      <td class="r">${actual != null ? fmtKLocal(actual) : '—'}</td>
      <td class="r ${planDiffClass}">${diffPlan}</td>
      <td class="r ${planDiffClass}">${ratioPlan}</td>
      <td class="r">${pyV != null ? fmtKLocal(pyV) : '—'}</td>
      <td class="r ${pyDiffClass}">${diffPy}</td>
      <td class="r ${pyDiffClass}">${ratioPy}</td>
    </tr>`;
  }

  function render() {
    ensureStyle();
    const root = document.getElementById('budget-actual-root');
    if (!root) return;

    renderPeriodSelector();

    const ym = STATE.selYM;
    const ds = ym ? activeRealCsvDatasetByYM(ym) : null;

    root.querySelectorAll('.ba-content').forEach(el => el.remove());
    const content = document.createElement('div');
    content.className = 'ba-content';

    if (!ds) {
      content.innerHTML = '<div class="msg msg-info">選択月の収支データがありません。</div>';
      root.appendChild(content);
      if (window.UI?.updateTopbar) UI.updateTopbar('budget-actual');
      return;
    }

    const fy = fiscalYearFromYM(ds.ym);
    const mm = ds.ym.slice(4, 6);
    const planRows = getPlanRowsForFiscalYear(fy);
    const py = sameMonthLastYear(ds.ym);

    const actRev = actualRevenue(ds);
    const actExp = actualExpense(ds);
    const actPrf = actualProfit(ds);
    const pyRev = py ? actualRevenue(py) : null;
    const pyExp = py ? actualExpense(py) : null;
    const pyPrf = py ? actualProfit(py) : null;

    const revDef = groupDefs().find(d => d.id === 'revenue');
    const planRev = planGroupValue(planRows, '営業収益', revDef?.keys || CONFIG.INCOME_KEYS, mm);
    const planExp = planGroupValue(planRows, '営業費用', CONFIG.EXPENSE_KEYS, mm);
    const planPrf = planGroupValue(planRows, '営業利益', [], mm);

    /* ---- A. 上部サマリー ---- */
    const summaryHtml = `
      <div class="ba-summary-grid">
        ${summaryCard('営業収益', actRev, planRev, pyRev, false)}
        ${summaryCard('営業費用', actExp, planExp, pyExp, true)}
        ${summaryCard('営業利益', actPrf, planPrf, pyPrf, false)}
      </div>`;

    /* ---- C. 科目別予実（既存CONFIG.PL_DEFの並び順をそのまま使用） ---- */
    const subjectRows = groupDefs().map(def => {
      const isExpense = def.id !== 'revenue';
      const actual = valueFromRows(ds, def.keys);
      const planV = planGroupValue(planRows, def.label, def.keys, mm);
      const pyV = py ? valueFromRows(py, def.keys) : null;
      return subjectRow(def.label, actual, planV, pyV, isExpense, false);
    }).join('');

    const subjectTotalRow = subjectRow('営業費用合計', actExp, planExp, pyExp, true, true)
      + subjectRow('営業利益', actPrf, planPrf, pyPrf, false, true);

    const subjectHtml = `
      <div class="card ba-table-card">
        <div class="card-header ba-card-header"><div><span class="card-title">科目別予実</span><div class="ba-card-subtitle">予算・実績・前年を同じ基準で比較</div></div></div>
        <div class="scroll-x">
          <table class="tbl">
            <thead><tr>
              <th style="min-width:140px">科目</th>
              <th class="r" style="min-width:80px">予算</th>
              <th class="r" style="min-width:80px">実績</th>
              <th class="r" style="min-width:80px">予実差</th>
              <th class="r" style="min-width:70px">予算比</th>
              <th class="r" style="min-width:80px">前年実績</th>
              <th class="r" style="min-width:80px">前年差</th>
              <th class="r" style="min-width:70px">前年比</th>
            </tr></thead>
            <tbody>${subjectRows}${subjectTotalRow}</tbody>
          </table>
        </div>
      </div>`;

    /* ---- D. 月別推移（年度4月～翌3月） ---- */
    const months = monthsOfFiscalYear(fy);
    const trendRows = months.map(monthYm => {
      const monthDs = activeRealCsvDatasetByYM(monthYm);
      const monthMm = monthYm.slice(4, 6);
      const monthActRev = monthDs ? actualRevenue(monthDs) : null;
      const monthActPrf = monthDs ? actualProfit(monthDs) : null;
      const monthPlanRev = planGroupValue(planRows, '営業収益', revDef?.keys || CONFIG.INCOME_KEYS, monthMm);
      const monthPlanPrf = planGroupValue(planRows, '営業利益', [], monthMm);
      return `<tr>
        <td>${escLocal(ymLabelLocal(monthYm))}</td>
        <td class="r">${monthPlanRev != null ? fmtLocal(monthPlanRev) : '—'}</td>
        <td class="r">${monthActRev != null ? fmtKLocal(monthActRev) : '—'}</td>
        <td class="r">${monthPlanPrf != null ? fmtLocal(monthPlanPrf) : '—'}</td>
        <td class="r">${monthActPrf != null ? fmtKLocal(monthActPrf) : '—'}</td>
      </tr>`;
    }).join('');

    const trendHtml = `
      <div class="card ba-table-card">
        <div class="card-header ba-card-header"><div><span class="card-title">月別推移（${escLocal(fy)}年度）</span><div class="ba-card-subtitle">営業収益と営業利益の年度内推移</div></div></div>
        <div class="scroll-x">
          <table class="tbl">
            <thead><tr>
              <th style="min-width:80px">月</th>
              <th class="r" style="min-width:100px">営業収益予算</th>
              <th class="r" style="min-width:100px">営業収益実績</th>
              <th class="r" style="min-width:100px">営業利益予算</th>
              <th class="r" style="min-width:100px">営業利益実績</th>
            </tr></thead>
            <tbody>${trendRows}</tbody>
          </table>
        </div>
      </div>`;

    content.innerHTML = `
      <div class="ba-commandbar">
        <div>
          <div class="ba-command-title">予実サマリー</div>
          <div class="ba-command-meta">${escLocal(ymLabelLocal(ds.ym))}・${escLocal(typeof datasetKindLabel === 'function' ? datasetKindLabel(ds) : '')}　単位：千円</div>
        </div>
        <div class="ba-command-actions no-print">
          <button class="btn" onclick="BUDGET_ACTUAL_UI.exportExcel()">Excel出力</button>
          <button class="btn" onclick="BUDGET_ACTUAL_UI.printReport()">印刷 / PDF保存</button>
        </div>
      </div>
      ${summaryHtml}
      ${subjectHtml}
      ${trendHtml}
    `;
    root.appendChild(content);

    /* ---- 出力用構造化データの構築（Phase10-C1追加） ----
       画面表示に使った計算済み変数（actRev/actExp/actPrf/planRev/
       planExp/planPrf/pyRev/pyExp/pyPrf、および科目別・月別ループ内の
       actual/planV/pyV）をそのまま再利用する。Dataset/planDataからの
       再集計は一切行わない。 */
    const exportSummaryRows = [
      ['営業収益', planRev, toK(actRev), toK(numDiff(actRev, planRev != null ? planRev * 1000 : null)), numRatio(actRev, planRev != null ? planRev * 1000 : null), toK(pyRev), toK(numDiff(actRev, pyRev)), yoyRatioForExcel(actRev, pyRev)],
      ['営業費用', planExp, toK(actExp), toK(numDiff(actExp, planExp != null ? planExp * 1000 : null)), numRatio(actExp, planExp != null ? planExp * 1000 : null), toK(pyExp), toK(numDiff(actExp, pyExp)), yoyRatioForExcel(actExp, pyExp)],
      ['営業利益', planPrf, toK(actPrf), toK(numDiff(actPrf, planPrf != null ? planPrf * 1000 : null)), numRatio(actPrf, planPrf != null ? planPrf * 1000 : null), toK(pyPrf), toK(numDiff(actPrf, pyPrf)), yoyRatioForExcel(actPrf, pyPrf)],
    ];
    const exportSubjectRows = groupDefs().map(def => {
      const actual = valueFromRows(ds, def.keys);
      const planV = planGroupValue(planRows, def.label, def.keys, mm);
      const pyV = py ? valueFromRows(py, def.keys) : null;
      return [def.label, planV, toK(actual), toK(numDiff(actual, planV != null ? planV * 1000 : null)), numRatio(actual, planV != null ? planV * 1000 : null), toK(pyV), toK(numDiff(actual, pyV)), yoyRatioForExcel(actual, pyV)];
    });
    exportSubjectRows.push(['営業費用合計', planExp, toK(actExp), toK(numDiff(actExp, planExp != null ? planExp * 1000 : null)), numRatio(actExp, planExp != null ? planExp * 1000 : null), toK(pyExp), toK(numDiff(actExp, pyExp)), yoyRatioForExcel(actExp, pyExp)]);
    exportSubjectRows.push(['営業利益', planPrf, toK(actPrf), toK(numDiff(actPrf, planPrf != null ? planPrf * 1000 : null)), numRatio(actPrf, planPrf != null ? planPrf * 1000 : null), toK(pyPrf), toK(numDiff(actPrf, pyPrf)), yoyRatioForExcel(actPrf, pyPrf)]);

    const exportTrendRows = months.map(monthYm => {
      const monthDs = activeRealCsvDatasetByYM(monthYm);
      const monthMm = monthYm.slice(4, 6);
      const monthActRev = monthDs ? actualRevenue(monthDs) : null;
      const monthActPrf = monthDs ? actualProfit(monthDs) : null;
      const monthPlanRev = planGroupValue(planRows, '営業収益', revDef?.keys || CONFIG.INCOME_KEYS, monthMm);
      const monthPlanPrf = planGroupValue(planRows, '営業利益', [], monthMm);
      return [ymLabelLocal(monthYm), monthPlanRev, toK(monthActRev), monthPlanPrf, toK(monthActPrf)];
    });

    window.BUDGET_ACTUAL_UI._lastExportData = {
      title: '予実差異分析',
      center: (typeof CENTER !== 'undefined' && CENTER?.name) ? CENTER.name : '',
      period: ymLabelLocal(ds.ym) + '　単位：千円',
      filename: (typeof EXPORT_SERVICE !== 'undefined' && EXPORT_SERVICE.buildFilename)
        ? EXPORT_SERVICE.buildFilename([(typeof CENTER !== 'undefined' && CENTER?.name) || '', '予実差異分析', ds.ym], 'xlsx')
        : null,
      sheets: [{
        name: '予実差異分析',
        summary: [{
          label: 'サマリー',
          columns: ['項目', '予算', '実績', '予実差', '予算比', '前年実績', '前年差', '前年比'],
          rows: exportSummaryRows,
        }],
        columns: ['科目', '予算', '実績', '予実差', '予算比', '前年実績', '前年差', '前年比'],
        rows: exportSubjectRows,
      }, {
        name: '月別推移',
        columns: ['月', '営業収益予算', '営業収益実績', '営業利益予算', '営業利益実績'],
        rows: exportTrendRows,
      }],
    };

    if (window.UI?.updateTopbar) UI.updateTopbar('budget-actual');
  }

  function exportExcel() {
    const data = window.BUDGET_ACTUAL_UI._lastExportData;
    if (!data) { if (window.UI?.toast) UI.toast('出力するデータがありません', 'warn'); return; }
    if (!window.EXPORT_SERVICE) { if (window.UI?.toast) UI.toast('出力機能を読み込めませんでした', 'error'); return; }
    EXPORT_SERVICE.toExcel(data).catch(e => {
      console.error('[BUDGET_ACTUAL_UI.exportExcel]', e);
      if (window.UI?.toast) UI.toast('Excel出力に失敗しました: ' + e.message, 'error');
    });
  }

  function printReport() {
    const data = window.BUDGET_ACTUAL_UI._lastExportData;
    if (!data) { if (window.UI?.toast) UI.toast('印刷するデータがありません', 'warn'); return; }
    if (!window.EXPORT_SERVICE) { if (window.UI?.toast) UI.toast('出力機能を読み込めませんでした', 'error'); return; }
    EXPORT_SERVICE.toPrint(data);
  }

  window.BUDGET_ACTUAL_UI = { render, exportExcel, printReport, _lastExportData: null };
})();
