/* =====================================================================
   経営管理システム trend.js
   2026-05-01
   ・売上推移をapp.jsから分離
   ・月次収支推移／月次件数推移／主要荷主月別推移を描画
   ・選択年度にデータがない場合、前年度グラフを残さず空表示にする
===================================================================== */
'use strict';

(function(){
  if (window.__TREND_MODULE_LOADED_FIXED_20260501__) return;
  window.__TREND_MODULE_LOADED_FIXED_20260501__ = true;

  function destroyChart(id){
    try {
      if (STATE && STATE._charts && STATE._charts[id]) {
        STATE._charts[id].destroy();
        delete STATE._charts[id];
      }
    } catch(e) {}

    const canvas = document.getElementById(id);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
    }
  }

  function emptyBox(canvasId, message){
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const wrap = canvas.parentElement;
    if (!wrap) return;

    const msgId = canvasId + '-empty';
    const old = document.getElementById(msgId);
    if (old) old.remove();

    const msg = document.createElement('div');
    msg.id = msgId;
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;min-height:180px;color:var(--text3);font-size:13px;background:#fff;border-radius:10px';
    msg.textContent = message || '選択年度のデータがありません';
    canvas.style.display = 'none';
    wrap.appendChild(msg);
  }

  function showCanvas(canvasId){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = '';
    const msg = document.getElementById(canvasId + '-empty');
    if (msg) msg.remove();
  }

  function groupsOfTrend(ds){
    if (ds && Array.isArray(ds.shipperGroups)) return ds.shipperGroups;
    if (ds && ds.shippers && typeof ds.shippers === 'object') {
      return Object.entries(ds.shippers).map(([name,d])=>({
        name,
        income:Number(d && d.income)||0,
        count:Number(d && d.count)||0,
        code4:(d && (d.code4 || d.code3)) || name,
        code3:(d && (d.code4 || d.code3)) || name,
        isOther:false,
        contracts:[]
      }));
    }
    return [];
  }

  function ticketCountOfTrend(ds){
    if (!ds) return 0;
    if (typeof ds.shipperTicketCount === 'number') return ds.shipperTicketCount;
    return groupsOfTrend(ds).reduce((sum,g)=>sum+(Number(g.count)||0),0);
  }

  function groupKey(g){
    return String(g && (g.code4 || g.code3 || g.name) || '');
  }

  function renderTrend() {
    const notice = document.getElementById('trend-notice');
    renderCommonPeriodSelector('trend');

    const list = datasetsForSelectedFiscalYear();
    if (!list.length) {
      if (notice) notice.innerHTML = '<div class="msg msg-info">選択年度のデータがありません</div>';
      ['c-trend-main','c-trend-cnt','c-trend-shipper'].forEach(id=>emptyBox(id, '選択年度のデータがありません'));

      const tbody = document.getElementById('trend-tbody') || document.getElementById('trend-table-body') || document.getElementById('trend-summary-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">選択年度のデータがありません</td></tr>';
      return;
    }

    if (notice) notice.innerHTML = '';
    ['c-trend-main','c-trend-cnt','c-trend-shipper'].forEach(showCanvas);

    const labels = list.map(d=>ymLabel(d.ym));
    const inc = list.map(d=>Number(d.totalIncome||0)/1000);
    const exp = list.map(d=>Number(d.totalExpense||0)/1000);
    const prf = list.map(d=>Number(d.profit||0)/1000);

    CHART_MGR.make('c-trend-main', {
      type:'bar',
      data:{
        labels,
        datasets:[
          {label:'収入（千円）',data:inc,backgroundColor:'rgba(26,77,124,.7)',order:2},
          {label:'費用（千円）',data:exp,backgroundColor:'rgba(224,91,77,.7)',order:2},
          {label:'利益（千円）',data:prf,type:'line',borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',fill:false,tension:.3,pointRadius:4,order:1},
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{legend:{position:'top'},tooltip:{mode:'index'}},
        scales:{y:{title:{display:true,text:'千円'},grid:{color:'#f0f0f0'}}}
      }
    });

    if (document.getElementById('c-trend-cnt')) {
      CHART_MGR.make('c-trend-cnt', {
        type:'bar',
        data:{
          labels,
          datasets:[{
            label:'件数',
            data:list.map(d=>ticketCountOfTrend(d)),
            backgroundColor:'rgba(26,77,124,.72)'
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{legend:{display:false}},
          scales:{y:{title:{display:true,text:'件'}}}
        }
      });
    }

    if (document.getElementById('c-trend-shipper')) {
      const latest = selectedDatasetInSelectedFiscalYear() || list[list.length-1];
      const top = groupsOfTrend(latest)
        .filter(g => !g.isOther && String(g.code4 || g.code3 || '') !== '9999')
        .filter(g => Number(g.income || 0) !== 0)
        .slice(0,5);

      if (!top.length) {
        emptyBox('c-trend-shipper', '主要荷主データがありません');
      } else {
        showCanvas('c-trend-shipper');
        CHART_MGR.make('c-trend-shipper', {
          type:'line',
          data:{
            labels,
            datasets:top.map((g,i)=>({
              label:g.name,
              data:list.map(d=>{
                const found = groupsOfTrend(d).find(x=>groupKey(x) === groupKey(g) || x.name === g.name);
                return found ? (Number(found.income)||0)/1000 : 0;
              }),
              borderColor:CONFIG.COLORS[i%CONFIG.COLORS.length],
              backgroundColor:CONFIG.COLORS[i%CONFIG.COLORS.length],
              tension:.25,
              pointRadius:3
            }))
          },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            plugins:{legend:{position:'bottom'}},
            scales:{y:{title:{display:true,text:'千円'}}}
          }
        });
      }
    }

    const tbody = document.getElementById('trend-tbody') || document.getElementById('trend-table-body') || document.getElementById('trend-summary-body');
    if (tbody) {
      const rows = [...list].reverse().map((d,i,arr)=>{
        const prev = i<arr.length-1 ? arr[i+1] : null;
        const cnt = ticketCountOfTrend(d);
        const unitValue = cnt > 0 ? Math.round((Number(d.totalIncome)||0) / cnt) : 0;
        return `<tr>
          <td>${ymLabel(d.ym)} ${d.type==='daily'?'<span class="badge badge-warn" style="font-size:9px">速報</span>':''}</td>
          <td class="r">${fmtK(d.totalIncome)}</td>
          <td class="r">${fmtK(d.totalExpense)}</td>
          <td class="r ${d.profit>=0?'cell-up':'cell-down'}">${fmtK(d.profit)}</td>
          <td class="r">${pct(d.profitRate)}</td>
          <td class="r">${fmt(cnt)}</td>
          <td class="r">${unitValue ? fmt(unitValue) : '—'}</td>
          <td class="r">${ratio(d.totalIncome,prev?.totalIncome)}</td>
          <td class="r">${ratio(d.totalIncome,sameMonthLastYear(d.ym)?.totalIncome)}</td>
        </tr>`;
      });
      tbody.innerHTML = rows.join('');
    }
  }

  window.renderTrend = renderTrend;
})();
