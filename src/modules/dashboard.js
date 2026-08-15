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
  function homeCompareInfo(current, compare, isExpense, sameLabel){
    if (current == null || compare == null) return null;
    if (compare > 0) {
      const text = ratio(current, compare);
      if (text === '—') return { text, cls: '' };
      const raw = current - compare;
      if (raw === 0) return { text, cls: '' };
      const isGood = isExpense ? raw < 0 : raw > 0;
      return { text, cls: isGood ? 'up' : 'down' };
    }
    if (compare === 0) return { text: '—', cls: '' };
    // compare < 0（赤字比較。費用合計は通常マイナスにならないため、
    // 主に営業収益・センター利益で発生し得る分岐）
    if (current > 0) return { text: '黒字転換', cls: 'up' };
    if (current === 0) return { text: '黒字化', cls: 'up' };
    if (current === compare) return { text: sameLabel || '同水準', cls: '' };
    if (current > compare) return { text: '赤字縮小', cls: 'up' };
    return { text: '赤字拡大', cls: 'down' };
  }

  function compareRow(current, prevDs, pyDs, valueKey, isExpense){
    const prevInfo = prevDs ? homeCompareInfo(current, prevDs[valueKey], isExpense, '前月並み') : null;
    const pyInfo = pyDs ? homeCompareInfo(current, pyDs[valueKey], isExpense, '前年並み') : null;
    const parts = [];
    if (prevInfo) parts.push(`<span class="pill ${prevInfo.cls}">前月比 ${escLocal(prevInfo.text)}</span>`);
    if (pyInfo) parts.push(`<span class="pill ${pyInfo.cls}">前年比 ${escLocal(pyInfo.text)}</span>`);
    return parts.length ? `<div class="kpi-sub-row">${parts.join('')}</div>` : '';
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

  /* ---------- みなし人件費率：総額ベースの算出（今回追加） ----------
     既存の委託除外ベース（ds.pseudoLaborRate、processDataset()で
     算出済み・変更していない）とは別に、委託を除外しない総額ベースを
     算出する。新たな科目集計は行わず、既存のds計算済みプロパティ
     （laborCost=人件費+傭車費(委託費除く)、excludedConsignmentExpense
     =委託費、totalIncome=営業収益）の単純な算術演算のみで求める。
     laborCost + excludedConsignmentExpense
       = 人件費 + 傭車費(委託費除く) + 委託費
       = 人件費 + 傭車費全額（CONFIG.YOSHA_KEYS全体）
     という既存processDataset()のコメントに基づく既存科目区分と
     完全に一致する。 */
  const totalLaborCostFull = ds.laborCost + ds.excludedConsignmentExpense;
  const pseudoLaborRateFull = ds.totalIncome > 0 ? (totalLaborCostFull / ds.totalIncome * 100) : 0;

  /* ---------- 80%判定と表示の丸め不一致の修正（今回追加） ----------
     既存pct()（src/core/format.js）はfmt()経由でMath.round(v)により
     整数へ丸めてから表示するため、実質的な表示丸め単位は「整数」。
     判定側は生値のまま比較していたため、例えば80.04（生値）は
     「80.0%」と表示されるのに「超過」と判定される不一致があった。
     共通pct()/fmt()自体は他画面へ影響するため変更せず、ホーム画面
     側だけで表示と同じ丸め処理（Math.round、整数丸め）を判定にも
     適用し、表示値と判定を一致させる。 */
  const pseudoLaborRateRounded = Math.round(ds.pseudoLaborRate);
  const pseudoLaborAchieved = pseudoLaborRateRounded <= CONFIG.TARGETS.pseudoLaborRate;

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
          <div class="kpi-value ${pseudoLaborAchieved ? 'green' : 'red'}">${pct(ds.pseudoLaborRate)}</div>
        </div>
        <div class="home-labor-rate-item">
          <div class="home-labor-rate-label">委託関連を含む</div>
          <div class="kpi-value navy">${pct(pseudoLaborRateFull)}</div>
        </div>
      </div>
      <div class="kpi-sub-row home-labor-rate-target">
        <span class="kpi-sub">委託除外目標：${CONFIG.TARGETS.pseudoLaborRate}%以内</span>
        <span class="pill ${pseudoLaborAchieved ? 'up' : 'down'}">${pseudoLaborAchieved ? '✓ 達成' : '⚠ 超過'}</span>
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
        {label:'収入',data:inc,backgroundColor:'rgba(26,77,124,.7)',order:2},
        {label:'費用',data:exp,backgroundColor:'rgba(224,91,77,.7)',order:2},
        {label:'利益',data:prof,type:'line',borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',
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
