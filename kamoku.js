'use strict';
/* ════════ 科目別分析（kamoku.js） ════════════════════════════════
   STATE.datasets の rows を使って収支科目を詳細表示する。
   依存: CONFIG（app.js）, STATE（app.js）, Chart.js
================================================================== */
const KAMOKU_UI = (() => {

  // ─── 収入科目の定義（補助科目含む） ───
  const INCOME_GROUPS = [
    {
      label: '家電収入', key: '家電収入',
      subs: ['配達収入','着店収入','集荷収入','リサイクル収入','中継収入','工事収入','社内中継手数料']
    },
    { label: '委託収入',  key: '委託収入',  subs: [] },
    { label: '特積収入',  key: '特積収入',  subs: [] },
    { label: '一般収入',  key: '一般収入',  subs: [] },
    { label: 'その他収入', key: 'その他収入', subs: [] },
    { label: '保管料収入', key: '保管料収入', subs: [] },
    { label: '加工収入',  key: '加工収入',  subs: [] },
    { label: 'コンピュータ収入', key: 'コンピュータ収入', subs: [] },
  ];

  const EXPENSE_GROUPS = [
    { label: '給与手当',   key: '給与手当',   group: '人件費' },
    { label: '人材派遣料', key: '人材派遣料', group: '人件費' },
    { label: 'その他人件費', key: 'その他人件費', group: '人件費' },
    { label: '委託費',    key: '委託費',    group: '外注費' },
    { label: '集配傭車',  key: '集配傭車',  group: '外注費' },
    { label: '路線傭車',  key: '路線傭車',  group: '外注費' },
    { label: '社内外注費', key: '社内外注費', group: '外注費' },
    { label: '軽油費',    key: '軽油費',    group: '燃料費' },
    { label: 'ガソリン費', key: 'ガソリン費', group: '燃料費' },
    { label: '車両修繕費', key: '車両修繕費', group: '車両費' },
    { label: '車両償却費', key: '車両償却費', group: '車両費' },
    { label: '自賠責保険料', key: '自賠責保険料', group: '保険料' },
    { label: '任意保険料', key: '任意保険料', group: '保険料' },
    { label: '借地借家料', key: '借地借家料', group: '施設費' },
    { label: 'その他施設費', key: 'その他施設費', group: '施設費' },
    { label: '水道光熱費', key: '水道光熱費', group: 'その他経費' },
    { label: '重量税',    key: '重量税',    group: 'その他経費' },
    { label: '旅費',      key: '旅費',      group: 'その他経費' },
    { label: '備消品費',  key: '備消品費',  group: 'その他経費' },
    { label: '通信運搬費', key: '通信運搬費', group: 'その他経費' },
  ];

  const COLORS = {
    income:  '#1a6fc4',
    expense: '#e05a5a',
    sub: ['#2ea8c4','#4db87a','#e8a030','#9b59c6','#e05a8a','#5ab8e0'],
    group: { '人件費':'#e05a5a','外注費':'#e87830','燃料費':'#e8a030','車両費':'#4db87a','保険料':'#2ea8c4','施設費':'#9b59c6','その他経費':'#607d9a' }
  };

  let _chart = null;
  let _chartExp = null;

  function n(v) { return Number(v)||0; }
  function fmt(v) { return v===0 ? '—' : (v<0?'-':'') + '¥' + Math.abs(Math.round(v)).toLocaleString(); }
  function fmtK(v) { return v===0 ? '—' : (v<0?'-':'') + Math.round(Math.abs(v)/1000).toLocaleString() + '千円'; }

  // ─── 月リストを取得 ───
  function getMonths() {
    if (!STATE.datasets || !STATE.datasets.length) return [];
    return [...new Set(STATE.datasets.map(d => d.ym))].sort().reverse();
  }

  // ─── 対象月のrows（複数データセットをマージ） ───
  function getRows(ym) {
    const datasets = STATE.datasets.filter(d => d.ym === ym);
    const merged = {};
    for (const ds of datasets) {
      for (const [k, v] of Object.entries(ds.rows || {})) {
        merged[k] = (merged[k] || 0) + n(v);
      }
    }
    return merged;  // 値は千円単位
  }

  // ─── メイン描画 ───
  function render() {
    const root = document.getElementById('kamoku-root');
    if (!root) return;

    const months = getMonths();
    if (!months.length) {
      root.innerHTML = '<div style="color:var(--text3);padding:40px;text-align:center">データがありません。CSVを取込んでください。</div>';
      return;
    }

    const saved = root.querySelector('#kamoku-ym-sel')?.value || months[0];

    root.innerHTML = `
<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
  <h2 style="margin:0;font-size:18px;color:var(--text1);font-weight:700">📊 収支科目 詳細分析</h2>
  <select id="kamoku-ym-sel" onchange="KAMOKU_UI.render()"
    style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text1);font-size:13px;cursor:pointer">
    ${months.map(m => `<option value="${m}" ${m===saved?'selected':''}>${m.slice(0,4)}年${m.slice(4)}月</option>`).join('')}
  </select>
</div>
<div id="kamoku-body"></div>`;

    const ym = root.querySelector('#kamoku-ym-sel').value;
    _renderBody(root.querySelector('#kamoku-body'), ym);
  }

  function _renderBody(el, ym) {
    const rows = getRows(ym);

    // ─ 集計 ─
    const totalIncome  = INCOME_GROUPS.reduce((s,g) => s + n(rows[g.key]), 0);
    const totalExpense = EXPENSE_GROUPS.reduce((s,g) => s + n(rows[g.key]), 0);
    const profit = totalIncome - totalExpense;
    const margin = totalIncome ? (profit / totalIncome * 100) : 0;

    el.innerHTML = `
<!-- サマリーカード -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
  ${_card('総収入',   totalIncome,  COLORS.income)}
  ${_card('総費用',   totalExpense, COLORS.expense)}
  ${_card('営業利益', profit,       profit>=0?'#16a34a':'#dc2626')}
  ${_card('利益率',   null,         profit>=0?'#16a34a':'#dc2626', margin.toFixed(1)+'%')}
</div>

<!-- 2カラム: 収入詳細 | 費用詳細 -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
  <div class="card">
    <div class="card-title">💰 収入内訳</div>
    <div class="card-body" style="padding:0">
      ${_incomeTable(rows, totalIncome)}
    </div>
  </div>
  <div class="card">
    <div class="card-title">💸 費用内訳</div>
    <div class="card-body" style="padding:0">
      ${_expenseTable(rows, totalExpense)}
    </div>
  </div>
</div>

<!-- 家電収入の補助科目内訳 -->
${_kaden(rows)}

<!-- グラフ -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
  <div class="card">
    <div class="card-title">収入構成</div>
    <div class="card-body" style="height:220px;position:relative"><canvas id="kamoku-chart-inc"></canvas></div>
  </div>
  <div class="card">
    <div class="card-title">費用構成</div>
    <div class="card-body" style="height:220px;position:relative"><canvas id="kamoku-chart-exp"></canvas></div>
  </div>
</div>`;

    _renderCharts(rows);
  }

  function _card(label, val, color, override=null) {
    const display = override !== null ? override : fmtK(val * 1000);
    return `<div class="card" style="padding:14px 16px;border-top:3px solid ${color}">
      <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color}">${display}</div>
    </div>`;
  }

  function _incomeTable(rows, total) {
    const items = INCOME_GROUPS.map(g => ({ label: g.key, val: n(rows[g.key]) }))
      .filter(x => x.val !== 0).sort((a,b) => b.val - a.val);
    if (!items.length) return '<div style="padding:12px;color:var(--text3);font-size:12px">データなし</div>';
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      ${items.map(x => {
        const pct = total ? (x.val / total * 100) : 0;
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px 12px;color:var(--text1)">${x.label}</td>
          <td style="padding:8px 12px;text-align:right;color:${COLORS.income};font-weight:600">${fmtK(x.val*1000)}</td>
          <td style="padding:8px 12px;width:60px">
            <div style="background:var(--border);border-radius:2px;height:6px;overflow:hidden">
              <div style="background:${COLORS.income};height:100%;width:${Math.min(pct,100).toFixed(1)}%"></div>
            </div>
          </td>
        </tr>`;
      }).join('')}
      <tr style="background:var(--surface2,#f5f7fa);font-weight:700">
        <td style="padding:8px 12px">合計</td>
        <td style="padding:8px 12px;text-align:right;color:${COLORS.income}">${fmtK(total*1000)}</td>
        <td></td>
      </tr>
    </table>`;
  }

  function _expenseTable(rows, total) {
    // グループ別に集計
    const groups = {};
    for (const g of EXPENSE_GROUPS) {
      const v = n(rows[g.key]);
      if (!v) continue;
      if (!groups[g.group]) groups[g.group] = { total: 0, items: [] };
      groups[g.group].total += v;
      groups[g.group].items.push({ label: g.label, val: v });
    }
    if (!Object.keys(groups).length) return '<div style="padding:12px;color:var(--text3);font-size:12px">データなし</div>';

    const sorted = Object.entries(groups).sort((a,b) => b[1].total - a[1].total);
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      ${sorted.map(([grp, data]) => {
        const pct = total ? (data.total / total * 100) : 0;
        const color = COLORS.group[grp] || '#607d9a';
        return `<tr style="background:var(--surface2,#f5f7fa)">
            <td style="padding:7px 12px;font-weight:600;color:${color}" colspan="3">${grp}</td>
          </tr>
          ${data.items.sort((a,b)=>b.val-a.val).map(item => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 12px 6px 20px;color:var(--text2)">└ ${item.label}</td>
            <td style="padding:6px 12px;text-align:right;color:${COLORS.expense};font-weight:600">${fmtK(item.val*1000)}</td>
            <td style="padding:6px 8px;width:60px">
              <div style="background:var(--border);border-radius:2px;height:5px;overflow:hidden">
                <div style="background:${color};height:100%;width:${total?(item.val/total*100).toFixed(1):0}%"></div>
              </div>
            </td>
          </tr>`).join('')}`;
      }).join('')}
      <tr style="background:var(--surface2,#f5f7fa);font-weight:700">
        <td style="padding:8px 12px">合計</td>
        <td style="padding:8px 12px;text-align:right;color:${COLORS.expense}">${fmtK(total*1000)}</td>
        <td></td>
      </tr>
    </table>`;
  }

  function _kaden(rows) {
    const kadenTotal = n(rows['家電収入']);
    if (!kadenTotal) return '';
    const subs = [
      { label: '配達収入',    key: '配達収入' },
      { label: '着店収入',    key: '着店収入' },
      { label: '集荷収入',    key: '集荷収入' },
      { label: 'リサイクル収入', key: 'リサイクル収入' },
      { label: '中継収入',    key: '中継収入' },
      { label: '社内中継手数料', key: '社内中継手数料' },
    ].map(s => ({ ...s, val: n(rows[s.key]) })).filter(s => s.val > 0);

    if (!subs.length) return '';

    const subTotal = subs.reduce((s,x) => s+x.val, 0);

    return `<div class="card" style="margin-bottom:24px">
      <div class="card-title">🏠 家電収入 補助科目内訳</div>
      <div class="card-body" style="padding:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
          ${subs.map((s,i) => {
            const pct = kadenTotal ? (s.val/kadenTotal*100) : 0;
            return `<div style="background:var(--surface2,#f5f7fa);border-radius:8px;padding:12px;border-left:3px solid ${COLORS.sub[i%COLORS.sub.length]}">
              <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${s.label}</div>
              <div style="font-size:14px;font-weight:700;color:${COLORS.sub[i%COLORS.sub.length]}">${fmtK(s.val*1000)}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${pct.toFixed(1)}%</div>
            </div>`;
          }).join('')}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">科目別構成比</div>
        <div style="display:flex;height:20px;border-radius:4px;overflow:hidden;background:var(--border)">
          ${subs.map((s,i) => {
            const w = kadenTotal ? (s.val/kadenTotal*100).toFixed(1) : 0;
            return `<div title="${s.label}: ${fmtK(s.val*1000)} (${w}%)"
              style="width:${w}%;background:${COLORS.sub[i%COLORS.sub.length]};transition:width .3s"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">
          ${subs.map((s,i) => `<span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:4px">
            <span style="width:8px;height:8px;background:${COLORS.sub[i%COLORS.sub.length]};border-radius:2px;display:inline-block"></span>${s.label}
          </span>`).join('')}
        </div>
      </div>
    </div>`;
  }

  function _renderCharts(rows) {
    // 収入グラフ
    const incItems = INCOME_GROUPS.map(g => ({ label: g.label, val: n(rows[g.key]) })).filter(x => x.val > 0);
    const expGroups = {};
    for (const g of EXPENSE_GROUPS) {
      const v = n(rows[g.key]);
      if (!v) continue;
      expGroups[g.group] = (expGroups[g.group] || 0) + v;
    }

    // destroy old charts
    if (_chart) { try { _chart.destroy(); } catch(e){} _chart = null; }
    if (_chartExp) { try { _chartExp.destroy(); } catch(e){} _chartExp = null; }

    const incCtx = document.getElementById('kamoku-chart-inc');
    const expCtx = document.getElementById('kamoku-chart-exp');

    const chartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ¥${Math.round(ctx.raw*1000).toLocaleString()}`
          }
        }
      }
    };

    if (incCtx && incItems.length) {
      _chart = new Chart(incCtx, {
        type: 'doughnut',
        data: {
          labels: incItems.map(x => x.label),
          datasets: [{ data: incItems.map(x => x.val), backgroundColor: Object.values(COLORS.sub).concat([COLORS.income,'#e8a030','#9b59c6']), borderWidth: 1 }]
        },
        options: chartOpts
      });
    }

    if (expCtx && Object.keys(expGroups).length) {
      _chartExp = new Chart(expCtx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(expGroups),
          datasets: [{ data: Object.values(expGroups), backgroundColor: Object.keys(expGroups).map(k => COLORS.group[k]||'#607d9a'), borderWidth: 1 }]
        },
        options: chartOpts
      });
    }
  }

  return { render };
})();

window.KAMOKU_UI = KAMOKU_UI;
