/* =====================================================================
   経営管理システム dashboard.js
   2026-05-01
   ・app.jsからダッシュボード描画を安全分割
   ・STATE / STORE / CLOUD / CSV / 共通計算関数はapp.js側を使用
   ・このファイルはダッシュボードの期間選択、KPI、グラフ、費用内訳のみ担当
   ・読み込み順：app.js → dashboard.js → shipper.js
===================================================================== */
'use strict';

(function(){
  if (window.__DASHBOARD_MODULE_LOADED_20260501__) return;
  window.__DASHBOARD_MODULE_LOADED_20260501__ = true;

  /* ---------- ホーム画面専用：前月比/前年比の表示ロジック（今回追加） ----------
     既存の共通ratio()（src/core/format.js）は変更していない。
     予実差異分析（budget_actual.js）のyoyRatioLabel()・着地予測
     （landing_forecast.js）のachievementLabel()と同じ考え方
     （比較対象がマイナス/0の場合に単純な%へ変換しない）を、
     ホーム画面の前月比・前年比比較に合わせてこのファイル内だけで
     実装する。他画面・共通関数への影響はない。
     sameLabel引数は「同額」時の文言（前月比なら'前月並み'、
     前年比なら'前年並み'）を呼出元から渡す。 */
  function homeCompareInfo(current, compare, isExpense){
    if (current == null || compare == null || !Number.isFinite(Number(current)) || !Number.isFinite(Number(compare))) {
      return { text: '—', cls: '' };
    }
    const cur = Number(current);
    const cmp = Number(compare);
    if (cmp === 0) return { text: '—', cls: '' };

    // ホームKPIは前月比・前年比を通常の増減率で統一表示する。
    // 比較元が赤字の場合も符号逆転を避けるため、分母は絶対値を使用する。
    const rate = (cur - cmp) / Math.abs(cmp) * 100;
    const rounded = Math.round(rate * 10) / 10;
    const text = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
    if (rounded === 0) return { text, cls: '' };
    const isGood = isExpense ? rounded < 0 : rounded > 0;
    return { text, cls: isGood ? 'up' : 'down' };
  }

  function compareRow(current, prevDs, pyDs, valueKey, isExpense){
    const prevInfo = homeCompareInfo(current, prevDs ? prevDs[valueKey] : null, isExpense);
    const pyInfo = homeCompareInfo(current, pyDs ? pyDs[valueKey] : null, isExpense);
    return `<div class="kpi-sub-row"><span class="pill ${prevInfo.cls}">前月比 ${escLocal(prevInfo.text)}</span><span class="pill ${pyInfo.cls}">前年比 ${escLocal(pyInfo.text)}</span></div>`;
  }

  function escLocal(v){ return typeof esc === 'function' ? esc(v) : String(v ?? ''); }

function renderDashboardSelector() {
  const area = document.getElementById('kpi-area');
  if (!area || !area.parentNode) return;
  let box = document.getElementById('dashboard-period-selector');
  if (!box) {
    box = document.createElement('div');
    box.id = 'dashboard-period-selector';
    area.parentNode.insertBefore(box, area);
  }
  if (window.PERIOD_UI?.render) {
    PERIOD_UI.render(box, {
      viewKey: 'dashboard',
      kind: 'revenue',
      useMonth: true,
      subtitle: '年度順：4月 → 翌年3月 / ダッシュボードのみ切替',
      onChange: () => { renderDashboard(); UI.updateTopbar('dashboard'); }
    });
  }
}

window.renderDashboard = function renderDashboard() {
  const area = document.getElementById('kpi-area');
  if (!area) return;
  renderDashboardSelector();
  const ds = selectedDashboardDS();

  if (!ds) {
    area.innerHTML = `<div style="grid-column:1/-1" class="msg msg-info">データがありません。左メニューの「データ取込」からCSVを読み込んでください。</div>`;
    ['exp-bars-area','shipper-bars-area'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.innerHTML='<div style="padding:10px;font-size:12px;color:var(--text3)">データなし</div>';
    });
    CHART_MGR.destroyAll();
    return;
  }

  // KPI Cards
  const profitClass = ds.profit >= 0 ? 'green' : 'red';
  const profitAccent = ds.profit >= 0 ? 'accent-green' : 'accent-red';
  const prevDs = prevDS(ds.ym);
  const pyDs = typeof sameMonthLastYear === 'function' ? sameMonthLastYear(ds.ym) : null;

  /* ---------- みなし人件費率：委託除外／委託込み ----------
     保存済みデータの ds.laborCost / ds.pseudoLaborRate は、作成時期によって
     「委託費を含む／含まない」の定義差が残り得るため、ホーム表示では
     元データ ds.rows から同一基準で再計算する。

     委託除外 = (人件費 + 傭車費 - 委託費) / (営業収益 - 委託収入)
     委託込み = (人件費 + 傭車費)           / 営業収益

     ※ここでの「傭車費」は CONFIG.YOSHA_KEYS 全体。委託込み側で
       委託費を別途足し戻すのではなく、元科目を一度だけ集計する。 */
  const dashboardRows = ds.rows || {};
  const rowNum = key => {
    const v = Number(dashboardRows[key]);
    return Number.isFinite(v) ? v : 0;
  };
  const employeeLaborForRate = CONFIG.LABOR_KEYS.reduce((sum, key) => sum + rowNum(key), 0);
  const yoshaFullForRate = CONFIG.YOSHA_KEYS.reduce((sum, key) => sum + rowNum(key), 0);
  const consignmentExpenseForRate = rowNum('委託費');
  const consignmentIncomeForRate = rowNum('委託収入');
  const laborExcludingConsignment = employeeLaborForRate + yoshaFullForRate - consignmentExpenseForRate;
  const laborIncludingConsignment = employeeLaborForRate + yoshaFullForRate;
  const incomeExcludingConsignment = Math.max(0, ds.totalIncome - consignmentIncomeForRate);
  const pseudoLaborRateExcluded = incomeExcludingConsignment > 0
    ? (laborExcludingConsignment / incomeExcludingConsignment * 100)
    : null;
  const pseudoLaborRateFull = ds.totalIncome > 0
    ? (laborIncludingConsignment / ds.totalIncome * 100)
    : null;

  /* ---------- 80%判定と表示の丸め不一致の修正（今回追加） ----------
     既存pct()（src/core/format.js）はfmt()経由でMath.round(v)により
     整数へ丸めてから表示するため、実質的な表示丸め単位は「整数」。
     判定側は生値のまま比較していたため、例えば80.04（生値）は
     「80.0%」と表示されるのに「超過」と判定される不一致があった。
     共通pct()/fmt()自体は他画面へ影響するため変更せず、ホーム画面
     側だけで表示と同じ丸め処理（Math.round、整数丸め）を判定にも
     適用し、表示値と判定を一致させる。 */
  const pseudoLaborRateRounded = pseudoLaborRateExcluded == null ? null : Math.round(pseudoLaborRateExcluded);
  const pseudoLaborAchieved = pseudoLaborRateRounded != null && pseudoLaborRateRounded <= CONFIG.TARGETS.pseudoLaborRate;

  area.innerHTML = `
    <div class="kpi-card accent-navy">
      <div class="kpi-label">営業収益（当月）</div>
      <div class="kpi-value navy">${fmtK(ds.totalIncome)}<span style="font-size:13px;font-weight:400">千円</span></div>
      ${compareRow(ds.totalIncome, prevDs, pyDs, 'totalIncome', false)}
    </div>
    <div class="kpi-card accent-red">
      <div class="kpi-label">費用合計（当月）</div>
      <div class="kpi-value red">${fmtK(ds.totalExpense)}<span style="font-size:13px;font-weight:400">千円</span></div>
      ${compareRow(ds.totalExpense, prevDs, pyDs, 'totalExpense', true)}
    </div>
    <div class="kpi-card ${profitAccent}">
      <div class="kpi-label">センター利益（粗利）</div>
      <div class="kpi-value ${profitClass}">${fmtK(ds.profit)}<span style="font-size:13px;font-weight:400">千円</span></div>
      ${compareRow(ds.profit, prevDs, pyDs, 'profit', false)}
    </div>
    <div class="kpi-card accent-amber">
      <div class="kpi-label">みなし人件費率</div>
      <div class="home-labor-rate-breakdown">
        <div class="home-labor-rate-item is-primary">
          <div class="home-labor-rate-label">委託関連を除外</div>
          <div class="kpi-value ${pseudoLaborAchieved ? 'green' : 'red'}">${pseudoLaborRateExcluded == null ? '—' : pct(pseudoLaborRateExcluded)}</div>
        </div>
        <div class="home-labor-rate-item">
          <div class="home-labor-rate-label">委託関連を含む</div>
          <div class="kpi-value navy">${pseudoLaborRateFull == null ? '—' : pct(pseudoLaborRateFull)}</div>
        </div>
      </div>
      <div class="kpi-sub-row home-labor-rate-target">
        <span class="kpi-sub">委託除外目標：${CONFIG.TARGETS.pseudoLaborRate}%以内</span>
      </div>
    </div>`;

  // メインチャート（月次収支推移）
  const dashboardTrendList = dashboardDatasetsForSelectedFiscalYear();
  const labels = dashboardTrendList.map(d=>ymLabel(d.ym));
  const inc  = dashboardTrendList.map(d=>d.totalIncome/1000);
  const exp  = dashboardTrendList.map(d=>d.totalExpense/1000);
  const prof = dashboardTrendList.map(d=>d.profit/1000);

  CHART_MGR.make('c-main-trend', {
    type:'bar',
    data: {
      labels,
      datasets:[
        {label:'収入',data:inc,backgroundColor:'rgba(120,167,131,.72)',order:2},
        {label:'費用',data:exp,backgroundColor:'rgba(217,166,179,.72)',order:2},
        {label:'利益',data:prof,type:'line',borderColor:'#b08fc4',backgroundColor:'rgba(184,172,216,.12)',
          pointRadius:3,tension:.3,fill:false,order:1,yAxisID:'y2'},
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{mode:'index'}},
      scales:{
        y:{title:{display:true,text:'千円'},grid:{color:'#f0f0f0'}},
        y2:{position:'right',title:{display:true,text:'利益（千円）'},grid:{display:false}},
      }
    }
  });

  // 収入構成（当月）ドーナツ
  const incItems = CONFIG.INCOME_KEYS.filter(k=>n(ds.rows[k])>0);
  CHART_MGR.make('c-inc-donut', {
    type:'doughnut',
    data:{
      labels: incItems,
      datasets:[{data:incItems.map(k=>n(ds.rows[k])/1000), backgroundColor:CONFIG.COLORS, borderWidth:1}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}
  });
  const leg = document.getElementById('inc-donut-legend');
  if (leg) leg.innerHTML = incItems.map((k,i)=>`
    <div class="legend-item"><div class="legend-dot" style="background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div>${esc(k)}</div>`).join('');

  // 費用内訳（当月）
  // 確定CSV/速報CSV/収支補完に保存されている ds.rows をそのまま使用する。
  // 画面は既存カード内に「上位費用＋構成比」を整理表示するだけにし、不要な円グラフは出さない。
  const expArea = document.getElementById('exp-bars-area');
  if (expArea && ds && ds.rows) {
    if (STATE._charts && STATE._charts['c-exp-donut']) {
      try { STATE._charts['c-exp-donut'].destroy(); } catch(e) {}
      delete STATE._charts['c-exp-donut'];
    }

    const expenseGroups = (CONFIG.PL_DEF || [])
      .filter(def => def && def.type === 'group' && def.id !== 'revenue')
      .map(def => {
        const value = (def.keys || []).reduce((sum, key) => sum + n(ds.rows[key]), 0);
        return { label: def.label || def.id || '未設定', value };
      })
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);

    if (!expenseGroups.length) {
      expArea.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">費用内訳データがありません</div>';
    } else {
      const top = expenseGroups.slice(0, 8);
      const otherValue = expenseGroups.slice(8).reduce((sum, item) => sum + item.value, 0);
      const rows = otherValue > 0 ? [...top, { label:'その他', value: otherValue }] : top;
      const maxValue = Math.max(...rows.map(item => item.value), 1);
      const denominator = ds.totalExpense || rows.reduce((sum, item) => sum + item.value, 0) || 1;
      const totalRowsValue = rows.reduce((sum, item) => sum + item.value, 0);

      expArea.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;font-size:11px;color:var(--text3)">
          <span>データ元：${datasetKindLabel(ds)}CSV / ${ymLabel(ds.ym)}</span>
          <span>費用合計 ${fmtK(ds.totalExpense)}千円</span>
        </div>
        <div style="display:grid;gap:7px">
          ${rows.map((item, i) => {
            const width = (item.value / maxValue * 100).toFixed(1);
            const rate = denominator > 0 ? (item.value / denominator * 100) : 0;
            return `
              <div style="display:grid;grid-template-columns:120px 1fr 96px;gap:8px;align-items:center">
                <div style="font-size:12px;font-weight:700;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.label)}">${esc(item.label)}</div>
                <div style="height:14px;background:#e5e7eb;border-radius:999px;overflow:hidden">
                  <div style="height:100%;width:${width}%;background:${CONFIG.COLORS[(i+1)%CONFIG.COLORS.length]};border-radius:999px"></div>
                </div>
                <div style="font-size:12px;font-weight:800;text-align:right;white-space:nowrap">${fmtK(item.value)}千 <span style="color:var(--text3);font-weight:700">${rate.toFixed(1)}%</span></div>
              </div>`;
          }).join('')}
        </div>
        ${Math.abs(totalRowsValue - denominator) > 1 ? `<div style="margin-top:8px;font-size:11px;color:var(--text3)">※ 表示内訳 ${fmtK(totalRowsValue)}千円 / 費用合計 ${fmtK(denominator)}千円</div>` : ''}
      `;
    }
  }

  // 荷主バー（shippers存在時のみ）
  const shipArea = document.getElementById('shipper-bars-area');
  if (shipArea) {
    if (ds.shippers && Object.keys(ds.shippers).length) {
      const items = Object.entries(ds.shippers).sort((a,b)=>b[1].income-a[1].income).slice(0,8);
      const maxV = Math.max(...items.map(x=>x[1].income),1);
      shipArea.innerHTML = items.map(([name,d],i)=>`
        <div class="mbar-row">
          <div class="mbar-label" title="${esc(name)}">${esc(name)}</div>
          <div class="mbar-track"><div class="mbar-fill" style="width:${(d.income/maxV*100).toFixed(1)}%;background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div></div>
          <div class="mbar-val">${fmtK(d.income)}千</div>
        </div>`).join('');
    } else {
      shipArea.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text3)">荷主データは別途CSV取込が必要です</div>';
    }
  }
};
})();
