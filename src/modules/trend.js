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
    renderCommonPeriodSelector('trend', { useMonth:false });
    const periodBox = document.getElementById('trend-period-selector');
    const actions = document.querySelector('#view-trend .trend-card-actions');
    if (periodBox && actions && periodBox.parentElement !== actions) actions.prepend(periodBox);

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
          {label:'収入（千円）',data:inc,backgroundColor:'rgba(49,95,140,.78)',order:2},
          {label:'費用（千円）',data:exp,backgroundColor:'rgba(217,133,47,.72)',order:2},
          {label:'利益（千円）',data:prf,type:'line',borderColor:'#16966a',backgroundColor:'rgba(22,150,106,.08)',fill:false,tension:.3,pointRadius:4,order:1},
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
            backgroundColor:'rgba(49,95,140,.76)'
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

    /* ---- 出力用構造化データの構築（Phase10-C2追加） ----
       画面表示に使ったlist（4月～翌3月の昇順、datasetsForSelectedFiscalYear()
       が既に返す既存の並び）をそのまま再利用する。画面のtrend-tbodyは
       表示上reverse()して新しい月を上にしているが、データ自体の並びは
       listのまま4月始まりのため、Excelにはlist（reverse前）をそのまま
       使うことで「4月～翌3月」の並びと一致させる。Dataset欠落月は
       datasetsForSelectedFiscalYear()自体が対象月をfilter(Boolean)で
       除外するため、Excel側でも0円へ勝手に変換しない（欠落月はそもそも
       行として現れない、既存仕様通り）。 */
    const exportRows = list.map((d, i) => {
      const prevD = i > 0 ? list[i - 1] : null;
      const cnt = ticketCountOfTrend(d);
      const unitValue = cnt > 0 ? Math.round((Number(d.totalIncome) || 0) / cnt) : null;
      const inc = Number(d.totalIncome || 0);
      const exp = Number(d.totalExpense || 0);
      const prf = Number(d.profit || 0);
      const prevInc = prevD ? Number(prevD.totalIncome || 0) : null;
      const pyDs = sameMonthLastYear(d.ym);
      const pyInc = pyDs ? Number(pyDs.totalIncome || 0) : null;
      return [
        ymLabel(d.ym) + (d.type === 'daily' ? '（速報）' : ''),
        inc / 1000,
        exp / 1000,
        prf / 1000,
        d.profitRate != null ? d.profitRate / 100 : null,
        cnt,
        unitValue,
        (prevInc != null && prevInc !== 0) ? (inc / prevInc - 1) : null,
        (pyInc != null && pyInc !== 0) ? (inc / pyInc - 1) : null,
      ];
    });

    window.TREND_UI_EXPORT = window.TREND_UI_EXPORT || {};
    window.TREND_UI_EXPORT._lastExportData = {
      title: '月次実績推移',
      center: (typeof CENTER !== 'undefined' && CENTER?.name) ? CENTER.name : '',
      period: (typeof dashboardSelectedFiscalYear === 'function' ? dashboardSelectedFiscalYear() : '') + '年度　単位：千円',
      filename: (typeof EXPORT_SERVICE !== 'undefined' && EXPORT_SERVICE.buildFilename)
        ? EXPORT_SERVICE.buildFilename([(typeof CENTER !== 'undefined' && CENTER?.name) || '', 'Trend', (typeof dashboardSelectedFiscalYear === 'function' ? dashboardSelectedFiscalYear() + '年度' : '')], 'xlsx')
        : null,
      sheets: [{
        name: '月次実績推移',
        columns: ['年月', '収入', '費用', '利益', '利益率', '件数', '単価（円）', '前月比', '前年比'],
        rows: exportRows,
      }],
    };
  }

  function trendExportExcel() {
    const data = window.TREND_UI_EXPORT?._lastExportData;
    if (!data) { if (window.UI?.toast) UI.toast('出力するデータがありません', 'warn'); return; }
    if (!window.EXPORT_SERVICE) { if (window.UI?.toast) UI.toast('出力機能を読み込めませんでした', 'error'); return; }
    EXPORT_SERVICE.toExcel(data).catch(e => {
      console.error('[TREND_UI_EXPORT.exportExcel]', e);
      if (window.UI?.toast) UI.toast('Excel出力に失敗しました: ' + e.message, 'error');
    });
  }
  window.TREND_UI_EXPORT = window.TREND_UI_EXPORT || {};
  window.TREND_UI_EXPORT.exportExcel = trendExportExcel;

  window.renderTrend = renderTrend;
})();
