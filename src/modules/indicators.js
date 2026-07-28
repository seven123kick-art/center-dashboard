/*
==============================================================================
Module
    Indicators

責務
    経営指標一覧の表示
    年間推移表の表示
    アラート一覧の表示

依存
    STATE
    CONFIG
    activeDatasets
    latestDS
    esc / fmtK / pct / ymLabel
    document

公開API
    window.INDICATORS

互換API
    window.renderIndicators
    window.renderAnnual
    window.renderAlerts

更新日
    2026-07-25

TODO(V3)
    互換API削除
    app.js依存解消（STATE/CONFIG参照の整理）
==============================================================================
*/
'use strict';

(function () {
    if (window.__INDICATORS_MODULE_LOADED__) {
        console.warn('[Indicators] already loaded.');
        return;
    }
    window.__INDICATORS_MODULE_LOADED__ = true;

/* ════════ §16 RENDER — Indicators ════════════════════════════ */
function renderIndicators() {
  const view = document.getElementById('view-indicators');
  if (!view) return;

  const fyList = datasetsForSelectedFiscalYear();
  const ds = fyList.length ? fyList[fyList.length - 1] : null;

  if (!ds || !fyList.length) {
    view.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
    renderCommonPeriodSelector('indicators', {useMonth:false});
    return;
  }

  const T = CONFIG.TARGETS;
  const laborOk   = ds.pseudoLaborRate <= T.pseudoLaborRate;
  const varOk     = ds.variableRate    <= T.variableRateMax;
  const smRate    = ds.totalIncome > 0 ? (ds.profit / ds.totalIncome * 100) : 0;
  const smOk      = smRate >= T.safetyMarginOk;
  const smWarn    = smRate >= T.safetyMarginWarn;

  function gauge(val, target, low, unit='%', reverse=false) {
    const ok = reverse ? val<=target : val>=target;
    const warn = reverse ? val<=low : val>=low;
    const color = ok ? '#16a34a' : warn ? '#d97706' : '#dc2626';
    return `<div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:13px;font-weight:700;color:${color}">${pct(val)}</span>
        <span style="font-size:11px;color:var(--text3)">目標: ${target}${unit}${reverse?'以内':'以上'}</span>
      </div>
      <div style="height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden">
        <div style="width:${Math.min(100,Math.abs(val)).toFixed(1)}%;height:100%;background:${color};border-radius:999px;transition:width .5s"></div>
      </div>
    </div>`;
  }

  view.innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:16px">
      <div class="kpi-card ${laborOk?'accent-green':'accent-red'}">
        <div class="kpi-label">みなし人件費率（${ymLabel(ds.ym)}）</div>
        <div class="kpi-value ${laborOk?'green':'red'}">${pct(ds.pseudoLaborRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${laborOk?'up':'down'}">${laborOk?'✓ 達成':'⚠ 超過'} 目標${T.pseudoLaborRate}%</span></div>
      </div>
      <div class="kpi-card ${varOk?'accent-green':'accent-amber'}">
        <div class="kpi-label">変動費率（${ymLabel(ds.ym)}）</div>
        <div class="kpi-value ${varOk?'green':'amber'}">${pct(ds.variableRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${varOk?'up':'flat'}">${varOk?'✓ 正常':'⚠ 高め'} 目標${T.variableRateMax}%以内</span></div>
      </div>
      <div class="kpi-card ${smOk?'accent-green':smWarn?'accent-amber':'accent-red'}">
        <div class="kpi-label">利益率（安全余裕率）</div>
        <div class="kpi-value ${smOk?'green':smWarn?'':'red'}">${pct(smRate)}</div>
        <div class="kpi-sub-row"><span class="pill ${smOk?'up':smWarn?'flat':'down'}">${smOk?'✓ 安全':smWarn?'△ 要注意':'⚠ 危険'}</span></div>
      </div>
    </div>

    <div class="grid2" style="margin-bottom:14px">
      <div class="card"><div class="card-header"><span class="card-title">固定費 / 変動費　構成（年度最新月）</span></div>
        <div class="card-body">
          ${gauge(ds.fixedRate, 50, 65, '%', true)}
          ${gauge(ds.variableRate, T.variableRateMax, 90, '%', true)}
          <div style="font-size:12px;color:var(--text2);line-height:1.8">
            固定費：${fmtK(ds.fixedCost)}千円 / 変動費：${fmtK(ds.varCost)}千円
          </div>
        </div></div>
      <div class="card"><div class="card-header"><span class="card-title">損益分岐点　簡易判定（年度最新月）</span></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text2);line-height:1.9">
            営業収益：${fmtK(ds.totalIncome)}千円<br>
            費用合計：${fmtK(ds.totalExpense)}千円<br>
            粗利益：${fmtK(ds.profit)}千円<br>
            利益率：${pct(ds.profitRate)}
          </div>
        </div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><span class="card-title">各指標　月次推移（選択年度内）</span></div>
      <div class="card-body"><div class="chart-wrap" style="height:220px"><canvas id="c-ind-trend"></canvas></div></div>
    </div>`;

  renderCommonPeriodSelector('indicators', {useMonth:false});

  CHART_MGR.make('c-ind-trend', {
    type:'line',
    data:{
      labels: fyList.map(d=>ymLabel(d.ym)),
      datasets:[
        {label:'みなし人件費率(%)',data:fyList.map(d=>+d.pseudoLaborRate.toFixed(1)),borderColor:'#1a4d7c',fill:false,tension:.3,pointRadius:3},
        {label:'変動費率(%)',      data:fyList.map(d=>+d.variableRate.toFixed(1)),   borderColor:'#e05b4d',fill:false,tension:.3,pointRadius:3},
        {label:'利益率(%)',        data:fyList.map(d=>+d.profitRate.toFixed(1)),      borderColor:'#16a34a',fill:false,tension:.3,pointRadius:3},
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top'}},
      scales:{y:{title:{display:true,text:'%'},grid:{color:'#f0f0f0'}}}}
  });
}

/* ════════ §17 RENDER — Annual ═════════════════════════════════ */
function renderAnnual() {
  const kpi  = document.getElementById('annual-kpi');
  const tbody = document.getElementById('annual-tbody');
  if (!tbody) return;

  renderCommonPeriodSelector('annual', {useMonth:false});

  const fy = dashboardSelectedFiscalYear();
  const list = datasetsForSelectedFiscalYear();

  const annualCanvas = document.getElementById('c-annual-trend');
  function showAnnualNoDataMessage(show) {
    const msgId = 'annual-chart-empty-message';
    const oldMsg = document.getElementById(msgId);
    if (oldMsg) oldMsg.remove();
    if (!annualCanvas) return;
    if (show) {
      if (STATE._charts && STATE._charts['c-annual-trend']) {
        try { STATE._charts['c-annual-trend'].destroy(); } catch(e) {}
        delete STATE._charts['c-annual-trend'];
      }
      annualCanvas.style.display = 'none';
      const msg = document.createElement('div');
      msg.id = msgId;
      msg.style.cssText = 'min-height:240px;display:flex;align-items:center;justify-content:center;color:var(--text3);font-weight:700';
      msg.textContent = `${fy}年度のデータがありません`;
      annualCanvas.parentElement.appendChild(msg);
    } else {
      annualCanvas.style.display = '';
    }
  }

  if (!list.length) {
    if (kpi) kpi.innerHTML = `<div style="grid-column:1/-1" class="msg msg-info">${fy}年度のデータがありません</div>`;
    showAnnualNoDataMessage(true);
    tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:var(--text3);text-align:center">${fy}年度のデータがありません</td></tr>`;
    return;
  }

  showAnnualNoDataMessage(false);

  const inc = list.reduce((s,d)=>s+d.totalIncome,0);
  const exp = list.reduce((s,d)=>s+d.totalExpense,0);
  const prf = list.reduce((s,d)=>s+d.profit,0);

  if (kpi) {
    kpi.innerHTML = `
      <div class="kpi-card accent-navy"><div class="kpi-label">年度累計収入（${fy}年度）</div>
        <div class="kpi-value navy">${fmtK(inc)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub">${list.length}ヶ月分</div></div>
      <div class="kpi-card accent-red"><div class="kpi-label">年度累計費用</div>
        <div class="kpi-value red">${fmtK(exp)}<span style="font-size:13px;font-weight:400">千円</span></div></div>
      <div class="kpi-card ${prf>=0?'accent-green':'accent-red'}"><div class="kpi-label">年度累計利益</div>
        <div class="kpi-value ${prf>=0?'green':'red'}">${fmtK(prf)}<span style="font-size:13px;font-weight:400">千円</span></div>
        <div class="kpi-sub-row"><span class="pill ${prf>=0?'up':'down'}">${pct(prf/inc*100)} 利益率</span></div></div>`;
  }

  CHART_MGR.make('c-annual-trend', {
    type:'bar',
    data:{labels:list.map(d=>ymLabel(d.ym)), datasets:[
      {label:'収入',data:list.map(d=>d.totalIncome/1000),backgroundColor:'rgba(26,77,124,.7)'},
      {label:'費用',data:list.map(d=>d.totalExpense/1000),backgroundColor:'rgba(224,91,77,.7)'},
      {label:'利益',data:list.map(d=>d.profit/1000),type:'line',borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',fill:false,tension:.3},
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{title:{display:true,text:'千円'}}}}
  });

  tbody.innerHTML = [...list].reverse().map(d=>`
    <tr>
      <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
      <td class="r">${fmtK(d.totalIncome)}</td>
      <td class="r">${fmtK(d.totalExpense)}</td>
      <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
      <td class="r">${pct(d.profitRate)}</td>
      <td class="r">—</td>
      <td class="r">${ratio(d.totalIncome, prevDS(d.ym)?.totalIncome)}</td>
      <td class="r">${ratio(d.totalIncome, sameMonthLastYear(d.ym)?.totalIncome)}</td>
    </tr>`).join('');
}

/* ════════ §18 RENDER — Alerts ═════════════════════════════════ */
function renderAlerts() {
  const box = document.getElementById('alerts-container');
  if (!box) return;
  if (!STATE.datasets.length) {
    box.innerHTML = '<div class="msg msg-info">データがありません</div>';
    const badge = document.getElementById('alert-badge');
    if (badge) badge.style.display='none';
    return;
  }

  const ds = latestDS();
  const T = CONFIG.TARGETS;
  const alerts = [];

  if (ds.pseudoLaborRate > T.pseudoLaborRate)
    alerts.push({level:'warn', title:`みなし人件費率 超過`, msg:`${pct(ds.pseudoLaborRate)}（目標: ${T.pseudoLaborRate}%以内）— ${ymLabel(ds.ym)}`});
  if (ds.variableRate > T.variableRateMax)
    alerts.push({level:'warn', title:`変動費率 高め`, msg:`${pct(ds.variableRate)}（目安: ${T.variableRateMax}%以内）— ${ymLabel(ds.ym)}`});
  if (ds.profit < 0)
    alerts.push({level:'ng', title:`赤字`, msg:`${fmtK(ds.profit)}千円（${ymLabel(ds.ym)}）`});
  else if (ds.profitRate < T.safetyMarginWarn)
    alerts.push({level:'warn', title:`利益率 低水準`, msg:`${pct(ds.profitRate)}（要注意ライン: ${T.safetyMarginWarn}%）`});

  // 連続前月比低下チェック
  const last3 = activeDatasets().slice(-3);
  if (last3.length===3 && last3[0].totalIncome>last3[1].totalIncome && last3[1].totalIncome>last3[2].totalIncome)
    /* skip - already reversed above */;
  if (last3.length===3 && last3[2].totalIncome<last3[1].totalIncome && last3[1].totalIncome<last3[0].totalIncome)
    alerts.push({level:'warn', title:'収入3ヶ月連続減少', msg:`${ymLabel(last3[0].ym)}〜${ymLabel(last3[2].ym)}`});

  const badge = document.getElementById('alert-badge');
  if (badge) { badge.textContent=alerts.length; badge.style.display=alerts.length?'inline':'none'; }

  if (!alerts.length) {
    box.innerHTML = '<div class="msg msg-ok">現在、アラートはありません。すべての指標が正常範囲内です。</div>';
    return;
  }
  box.innerHTML = alerts.map(a=>`
    <div class="msg msg-${a.level}" style="margin-bottom:10px">
      <strong>${esc(a.title)}</strong><br>${esc(a.msg)}
    </div>`).join('');
}

  // 正式API：責務単位オブジェクト
  window.INDICATORS = {
    renderIndicators,
    renderAnnual,
    renderAlerts
  };

  // 互換API（app.js NAVからのbare関数呼び出し維持のため）
  // TODO(V3)
  // app.js移行完了後に削除予定
  window.renderIndicators = function () {
    return window.INDICATORS.renderIndicators();
  };
  window.renderAnnual = function () {
    return window.INDICATORS.renderAnnual();
  };
  window.renderAlerts = function () {
    return window.INDICATORS.renderAlerts();
  };
})();
