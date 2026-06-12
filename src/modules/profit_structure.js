/* =====================================================================
   経営管理システム profit_structure.js
   2026-06-12
   ・月次収支表の既存データを使った利益構造分析
   ・取込、保存、集計元データは変更しない
===================================================================== */
'use strict';

(function(){
  if (window.__PROFIT_STRUCTURE_MODULE_LOADED_20260612__) return;
  window.__PROFIT_STRUCTURE_MODULE_LOADED_20260612__ = true;

  function escLocal(v){
    if (typeof esc === 'function') return esc(v);
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function num(v){ return Number(v || 0) || 0; }
  function yenK(v){ return typeof fmtK === 'function' ? fmtK(v) : Math.round(num(v)/1000).toLocaleString('ja-JP'); }
  function yen(v){ return typeof fmt === 'function' ? fmt(v) : Math.round(num(v)).toLocaleString('ja-JP'); }
  function pctLocal(v){ return typeof pct === 'function' ? pct(v) : ((num(v)).toFixed(1) + '%'); }
  function ymLabelLocal(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : String(ym || ''); }

  function valueFromRows(ds, keys){
    if (!ds || !ds.rows) return 0;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.reduce((sum, key) => sum + num(ds.rows[key]), 0);
  }

  function groupDefs(){
    return (CONFIG.PL_DEF || []).filter(d => d && d.type === 'group');
  }

  function groupValue(ds, def){
    if (!def) return 0;
    return valueFromRows(ds, def.keys || []);
  }

  function revenue(ds){
    return num(ds && ds.totalIncome) || groupValue(ds, groupDefs().find(d => d.id === 'revenue'));
  }

  function expense(ds){
    if (!ds) return 0;
    if (num(ds.totalExpense)) return num(ds.totalExpense);
    return groupDefs()
      .filter(d => d.id !== 'revenue')
      .reduce((sum, d) => sum + groupValue(ds, d), 0);
  }

  function profit(ds){
    if (!ds) return 0;
    if (typeof ds.profit === 'number') return num(ds.profit);
    return revenue(ds) - expense(ds);
  }

  function profitRate(ds){
    const r = revenue(ds);
    return r ? profit(ds) / r * 100 : 0;
  }

  function diffClass(v, reverse=false){
    const n = num(v);
    if (!n) return '';
    const good = reverse ? n < 0 : n > 0;
    return good ? 'ps-good' : 'ps-bad';
  }

  function signK(v){
    const n = Math.round(num(v) / 1000);
    if (!n) return '±0';
    return (n > 0 ? '+' : '') + n.toLocaleString('ja-JP');
  }

  function factorRows(ds, prev){
    if (!ds || !prev) return [];

    const rows = [];

    const revDiff = revenue(ds) - revenue(prev);
    rows.push({
      label:'営業収益',
      type:'収益',
      current: revenue(ds),
      prev: revenue(prev),
      diff: revDiff,
      impact: revDiff,
      note: revDiff >= 0 ? '売上増は利益改善要因' : '売上減は利益悪化要因'
    });

    groupDefs().filter(d => d.id !== 'revenue').forEach(def => {
      const cur = groupValue(ds, def);
      const pre = groupValue(prev, def);
      const diff = cur - pre;
      rows.push({
        label:def.label,
        type:'費用',
        current: cur,
        prev: pre,
        diff,
        impact: -diff,
        note: diff <= 0 ? '費用減は利益改善要因' : '費用増は利益悪化要因'
      });

      (def.children || []).forEach(child => {
        const childCur = valueFromRows(ds, child.keys || []);
        const childPre = valueFromRows(prev, child.keys || []);
        const childDiff = childCur - childPre;
        if (Math.abs(childDiff) >= 1) {
          rows.push({
            label:'└ ' + child.label,
            parent:def.label,
            type:'内訳',
            current: childCur,
            prev: childPre,
            diff: childDiff,
            impact: -childDiff,
            note: childDiff <= 0 ? '費用減' : '費用増'
          });
        }
      });
    });

    return rows;
  }

  function renderPeriodSelector(){
    const root = document.getElementById('profit-structure-root');
    if (!root) return;
    let box = document.getElementById('profit-structure-period-selector');
    if (!box) {
      box = document.createElement('div');
      box.id = 'profit-structure-period-selector';
      root.prepend(box);
    }
    if (window.PERIOD_UI?.render) {
      PERIOD_UI.render(box, {
        viewKey:'profit-structure',
        kind:'revenue',
        useMonth:true,
        subtitle:'年度順：4月 → 翌年3月 / 利益構造を確認',
        onChange: () => PROFIT_STRUCTURE_UI.render()
      });
    }
  }

  function ensureStyle(){
    if (document.getElementById('profit-structure-style')) return;
    const style = document.createElement('style');
    style.id = 'profit-structure-style';
    style.textContent = `
      #profit-structure-root .ps-kpi-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:14px}
      #profit-structure-root .ps-kpi{background:#fff;border:1px solid var(--border,#d9dee8);border-radius:14px;padding:16px;box-shadow:0 6px 18px rgba(15,23,42,.06)}
      #profit-structure-root .ps-kpi-label{font-size:12px;color:var(--text3,#8090a3);font-weight:800;margin-bottom:8px}
      #profit-structure-root .ps-kpi-value{font-size:26px;font-weight:900;color:var(--text,#102033)}
      #profit-structure-root .ps-kpi-sub{font-size:12px;color:var(--text3,#8090a3);margin-top:6px}
      #profit-structure-root .ps-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      #profit-structure-root .ps-card{background:#fff;border:1px solid var(--border,#d9dee8);border-radius:14px;box-shadow:0 6px 18px rgba(15,23,42,.06);overflow:hidden}
      #profit-structure-root .ps-card-header{padding:14px 16px;border-bottom:1px solid var(--border,#d9dee8);font-weight:900;color:var(--text,#102033);display:flex;justify-content:space-between;gap:10px;align-items:center}
      #profit-structure-root .ps-card-body{padding:14px 16px}
      #profit-structure-root .ps-factor{display:grid;grid-template-columns:minmax(130px,1fr) minmax(110px,160px) 72px;gap:10px;align-items:center;margin:9px 0}
      #profit-structure-root .ps-factor-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #profit-structure-root .ps-track{height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden}
      #profit-structure-root .ps-fill{height:100%;border-radius:999px;background:#2563eb}
      #profit-structure-root .ps-fill.bad{background:#dc2626}
      #profit-structure-root .ps-value{text-align:right;font-weight:900}
      #profit-structure-root .ps-good{color:#047857;font-weight:900}
      #profit-structure-root .ps-bad{color:#dc2626;font-weight:900}
      #profit-structure-root .ps-table{width:100%;border-collapse:collapse;font-size:13px}
      #profit-structure-root .ps-table th,#profit-structure-root .ps-table td{padding:9px 10px;border-bottom:1px solid var(--border,#d9dee8);vertical-align:middle}
      #profit-structure-root .ps-table th{background:#f8fafc;color:var(--text2,#52606d);font-size:12px;text-align:left}
      #profit-structure-root .ps-table .r{text-align:right}
      #profit-structure-root .ps-note{font-size:12px;color:var(--text3,#8090a3);line-height:1.6}
      @media(max-width:1100px){
        #profit-structure-root .ps-kpi-row{grid-template-columns:repeat(2,minmax(0,1fr))}
        #profit-structure-root .ps-grid{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function renderFactors(title, items, bad=false){
    const top = items.slice(0, 8);
    const max = Math.max(...top.map(x => Math.abs(x.impact)), 1);
    if (!top.length) return `<div class="ps-note">比較対象がないため表示できません。</div>`;
    return `
      <div class="ps-card">
        <div class="ps-card-header">${escLocal(title)}<span class="ps-note">単位：千円</span></div>
        <div class="ps-card-body">
          ${top.map(x => {
            const w = Math.max(4, Math.round(Math.abs(x.impact) / max * 100));
            return `<div class="ps-factor" title="${escLocal(x.note || '')}">
              <div class="ps-factor-name">${escLocal(x.label)}</div>
              <div class="ps-track"><div class="ps-fill ${bad ? 'bad' : ''}" style="width:${w}%"></div></div>
              <div class="ps-value ${bad ? 'ps-bad' : 'ps-good'}">${signK(x.impact)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderTable(rows){
    if (!rows.length) return '<div class="ps-note">比較対象データがありません。</div>';
    const main = rows
      .filter(r => !r.parent)
      .sort((a,b) => Math.abs(b.impact) - Math.abs(a.impact));
    return `
      <div class="ps-card">
        <div class="ps-card-header">科目別前年差・利益影響<span class="ps-note">利益影響＝収益増減、または費用増減を利益視点で換算</span></div>
        <div class="scroll-x">
          <table class="ps-table">
            <thead>
              <tr>
                <th>科目</th>
                <th class="r">当月</th>
                <th class="r">前年月</th>
                <th class="r">差異</th>
                <th class="r">利益影響</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              ${main.map(r => `<tr>
                <td><strong>${escLocal(r.label)}</strong></td>
                <td class="r">${yenK(r.current)}</td>
                <td class="r">${yenK(r.prev)}</td>
                <td class="r ${diffClass(r.diff, r.type !== '収益')}">${signK(r.diff)}</td>
                <td class="r ${r.impact >= 0 ? 'ps-good' : 'ps-bad'}">${signK(r.impact)}</td>
                <td>${escLocal(r.note)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function render(){
    ensureStyle();

    const root = document.getElementById('profit-structure-root');
    if (!root) return;

    renderPeriodSelector();

    const ds = selectedDashboardDS();
    if (!ds) {
      root.querySelectorAll('.profit-structure-content').forEach(el => el.remove());
      const box = document.createElement('div');
      box.className = 'profit-structure-content';
      box.innerHTML = '<div class="msg msg-info">選択月の収支データがありません。</div>';
      root.appendChild(box);
      return;
    }

    const prev = prevDS(ds.ym);
    const py = sameMonthLastYear(ds.ym);
    const base = py || prev;
    const baseLabel = py ? '前年同月' : (prev ? '前月' : '比較対象なし');

    const factors = factorRows(ds, base);
    const improve = factors.filter(x => x.impact > 0).sort((a,b)=>b.impact-a.impact);
    const worsen = factors.filter(x => x.impact < 0).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact));

    const rev = revenue(ds);
    const exp = expense(ds);
    const prf = profit(ds);
    const rate = profitRate(ds);
    const baseProfit = base ? profit(base) : null;
    const diffProfit = base ? prf - baseProfit : null;

    root.querySelectorAll('.profit-structure-content').forEach(el => el.remove());
    const content = document.createElement('div');
    content.className = 'profit-structure-content';
    content.innerHTML = `
      <div class="ps-kpi-row">
        <div class="ps-kpi"><div class="ps-kpi-label">営業収益</div><div class="ps-kpi-value">${yenK(rev)}<span style="font-size:13px;font-weight:600">千円</span></div><div class="ps-kpi-sub">${ymLabelLocal(ds.ym)}（${typeof datasetKindLabel === 'function' ? datasetKindLabel(ds) : ''}）</div></div>
        <div class="ps-kpi"><div class="ps-kpi-label">売上原価</div><div class="ps-kpi-value">${yenK(exp)}<span style="font-size:13px;font-weight:600">千円</span></div><div class="ps-kpi-sub">営業収益比 ${rev ? pctLocal(exp / rev * 100) : '—'}</div></div>
        <div class="ps-kpi"><div class="ps-kpi-label">粗利益</div><div class="ps-kpi-value ${prf >= 0 ? 'ps-good' : 'ps-bad'}">${yenK(prf)}<span style="font-size:13px;font-weight:600">千円</span></div><div class="ps-kpi-sub">粗利率 ${pctLocal(rate)}</div></div>
        <div class="ps-kpi"><div class="ps-kpi-label">${escLocal(baseLabel)}差</div><div class="ps-kpi-value ${diffProfit == null ? '' : (diffProfit >= 0 ? 'ps-good' : 'ps-bad')}">${diffProfit == null ? '—' : signK(diffProfit)}<span style="font-size:13px;font-weight:600">${diffProfit == null ? '' : '千円'}</span></div><div class="ps-kpi-sub">比較対象：${base ? ymLabelLocal(base.ym) : 'なし'}</div></div>
      </div>

      <div class="ps-grid">
        ${renderFactors('利益改善要因', improve, false)}
        ${renderFactors('利益悪化要因', worsen, true)}
      </div>

      ${renderTable(factors)}
    `;
    root.appendChild(content);

    if (window.UI?.updateTopbar) UI.updateTopbar('profit-structure');
  }

  window.PROFIT_STRUCTURE_UI = { render };
  window.renderProfitStructure = render;
})();
