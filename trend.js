/* =====================================================================
   経営管理システム trend.js
   2026-05-01
   ・app.jsから売上推移を安全分割
   ・STATE / CHART_MGR / 期間選択 / 共通関数はapp.js側を使用
===================================================================== */
'use strict';

(function(){
  if (window.__TREND_MODULE_LOADED_20260501__) return;
  window.__TREND_MODULE_LOADED_20260501__ = true;

/* ════════ §14 RENDER — Trend ══════════════════════════════════ */
function renderTrend() {
  const notice = document.getElementById('trend-notice');
  renderCommonPeriodSelector('trend');

  const list = datasetsForSelectedFiscalYear();
  if (!list.length) {
    if (notice) notice.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
    return;
  }
  if (notice) notice.innerHTML = '';

  const labels = list.map(d=>ymLabel(d.ym));
  const inc = list.map(d=>d.totalIncome/1000);
  const exp = list.map(d=>d.totalExpense/1000);
  const prf = list.map(d=>d.profit/1000);

  CHART_MGR.make('c-trend-main', {
    type:'bar', data:{labels,
      datasets:[
        {label:'収入（千円）',data:inc,backgroundColor:'rgba(26,77,124,.7)',order:2},
        {label:'費用（千円）',data:exp,backgroundColor:'rgba(224,91,77,.7)',order:2},
        {label:'利益（千円）',data:prf,type:'line',borderColor:'#16a34a',
          backgroundColor:'rgba(22,163,74,.1)',fill:false,tension:.3,pointRadius:4,order:1},
      ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top'},tooltip:{mode:'index'}},
      scales:{y:{title:{display:true,text:'千円'},grid:{color:'#f0f0f0'}}}}
  });

  const tbody = document.getElementById('trend-tbody');
  if (tbody) {
    const rows = [...list].reverse().map((d,i,arr)=>{
      const prev = i<arr.length-1 ? arr[i+1] : null;
      return `<tr>
        <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
        <td class="r">${fmtK(d.totalIncome)}</td><td class="r">${fmtK(d.totalExpense)}</td>
        <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
        <td class="r">${pct(d.profitRate)}</td>
        <td class="r">—</td>
        <td class="r">${ratio(d.totalIncome,prev?.totalIncome)}</td>
        <td class="r">${ratio(d.totalIncome,sameMonthLastYear(d.ym)?.totalIncome)}</td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');
  }
}



  window.renderTrend = renderTrend;
})();
