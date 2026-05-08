'use strict';
/* ════════ 収支科目 詳細分析（kamoku.js v2） ═══════════════════════
   - 科目別金額 詳細テーブル（補助科目まで展開）
   - 前月比較 / 特定月比較
   依存: CONFIG, STATE（app.js）, Chart.js
================================================================== */
const KAMOKU_UI = (() => {

  const INCOME_GROUPS = [
    { label:'家電収入',   key:'家電収入',
      subs:['配達収入','着店収入','集荷収入','リサイクル収入','中継収入','社内中継手数料','工事収入'] },
    { label:'委託収入',       key:'委託収入',       subs:[] },
    { label:'特積収入',       key:'特積収入',       subs:[] },
    { label:'一般収入',       key:'一般収入',       subs:[] },
    { label:'その他収入',     key:'その他収入',     subs:[] },
    { label:'保管料収入',     key:'保管料収入',     subs:[] },
    { label:'加工収入',       key:'加工収入',       subs:[] },
    { label:'コンピュータ収入', key:'コンピュータ収入', subs:[] },
    { label:'保険手数料',     key:'保険手数料',     subs:[] },
    { label:'売電収入',       key:'売電収入',       subs:[] },
    { label:'賃貸収入',       key:'賃貸収入',       subs:[] },
  ];

  const EXPENSE_GROUPS = [
    { group:'人件費', color:'#e05a5a', items:[
      {label:'給与手当', key:'給与手当'}, {label:'人材派遣料', key:'人材派遣料'},
      {label:'その他人件費', key:'その他人件費'}, {label:'運行旅費', key:'運行旅費'},
    ]},
    { group:'外注費', color:'#e87830', items:[
      {label:'委託費', key:'委託費'}, {label:'集配傭車', key:'集配傭車'},
      {label:'路線傭車', key:'路線傭車'}, {label:'路線備車', key:'路線備車'},
      {label:'社内外注費', key:'社内外注費'},
    ]},
    { group:'燃料費', color:'#e8a030', items:[
      {label:'軽油費', key:'軽油費'}, {label:'ガソリン費', key:'ガソリン費'},
      {label:'ガス費', key:'ガス費'}, {label:'油脂費', key:'油脂費'},
    ]},
    { group:'車両費', color:'#4db87a', items:[
      {label:'車両修繕費', key:'車両修繕費'}, {label:'タイヤ費', key:'タイヤ費'},
      {label:'車両償却費', key:'車両償却費'}, {label:'リース原価計', key:'リース原価計'},
    ]},
    { group:'保険料', color:'#2ea8c4', items:[
      {label:'自賠責保険料', key:'自賠責保険料'}, {label:'任意保険料', key:'任意保険料'},
      {label:'運送保険料', key:'運送保険料'},
    ]},
    { group:'施設費', color:'#9b59c6', items:[
      {label:'借地借家料', key:'借地借家料'}, {label:'その他施設費', key:'その他施設費'},
    ]},
    { group:'税', color:'#607d9a', items:[
      {label:'重量税', key:'重量税'}, {label:'自動車税', key:'自動車税'},
    ]},
    { group:'その他経費', color:'#8d9e7a', items:[
      {label:'水道光熱費', key:'水道光熱費'}, {label:'備消品費', key:'備消品費'},
      {label:'図書印刷費', key:'図書印刷費'}, {label:'通信運搬費', key:'通信運搬費'},
      {label:'電算関連費', key:'電算関連費'}, {label:'旅費', key:'旅費'},
      {label:'被服費', key:'被服費'}, {label:'会議費', key:'会議費'},
      {label:'交際費', key:'交際費'}, {label:'諸手数料', key:'諸手数料'},
      {label:'負担金', key:'負担金'}, {label:'環境衛生費', key:'環境衛生費'},
      {label:'経営指導料', key:'経営指導料'}, {label:'雑費', key:'雑費'},
    ]},
  ];

  const SUB_COLORS = ['#2ea8c4','#4db87a','#e8a030','#9b59c6','#e05a8a','#5ab8e0'];
  let _chart1 = null, _chart2 = null;

  const n = v => Number(v) || 0;
  const fmtK = v => {
    if (v === 0) return '\u2014';
    const abs = Math.abs(Math.round(v));
    return (v < 0 ? '-' : '') + abs.toLocaleString() + '\u5343\u5186';
  };
  const diffBadge = (cur, prev) => {
    if (prev == null || prev === 0) return '';
    const d = cur - prev;
    const pct = Math.abs(d / prev * 100).toFixed(1);
    const color = d >= 0 ? '#16a34a' : '#dc2626';
    return `<span style="font-size:10px;color:${color};margin-left:5px">${d>=0?'\u25b2':'\u25bc'}${pct}%</span>`;
  };
  const diffCell = (cur, prev) => {
    if (prev == null) return '<td></td>';
    const d = cur - prev;
    const color = d >= 0 ? '#16a34a' : '#dc2626';
    return `<td style="text-align:right;font-size:11px;color:${color};padding:6px 8px">${d>=0?'+':''}${fmtK(d)}</td>`;
  };

  function getMonths() {
    if (!STATE.datasets?.length) return [];
    return [...new Set(STATE.datasets.map(d => d.ym))].sort().reverse();
  }
  function getRows(ym) {
    if (!ym) return {};
    const merged = {};
    for (const ds of (STATE.datasets||[]).filter(d => d.ym === ym)) {
      for (const [k,v] of Object.entries(ds.rows||{})) {
        merged[k] = (merged[k]||0) + n(v);
      }
    }
    return merged;
  }
  function ymLabel(ym) {
    return ym ? `${ym.slice(0,4)}\u5e74${ym.slice(4)}\u6708` : '';
  }
  function prevYm(ym) {
    if (!ym) return null;
    const y = parseInt(ym.slice(0,4)), m = parseInt(ym.slice(4));
    const pm = m===1?12:m-1, py = m===1?y-1:y;
    return `${py}${String(pm).padStart(2,'0')}`;
  }

  function render() {
    const root = document.getElementById('kamoku-root');
    if (!root) return;
    const months = getMonths();
    if (!months.length) {
      root.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text3,#8899aa)">\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093\u3002CSV\u3092\u53d6\u8fbc\u3093\u3067\u304f\u3060\u3055\u3044\u3002</div>';
      return;
    }
    const selYm    = root.querySelector('#k-ym')?.value    || months[0];
    const cmpMode  = root.querySelector('#k-cmp')?.value   || 'prev';
    const selCmpYm = root.querySelector('#k-cmpym')?.value || (months[1]||months[0]);
    const cmpYm    = cmpMode==='prev' ? prevYm(selYm) : (cmpMode==='select' ? selCmpYm : null);
    const cmpAvail = cmpYm && months.includes(cmpYm);

    root.innerHTML = `
<style>
#kamoku-root{padding-bottom:40px}
#kamoku-root .kt{width:100%;border-collapse:collapse;font-size:12px}
#kamoku-root .kt th{background:var(--surface2,#f4f6fa);color:var(--text3,#8899aa);font-size:11px;font-weight:600;padding:6px 10px;text-align:right;border-bottom:2px solid var(--border,#dde3f0)}
#kamoku-root .kt th:first-child{text-align:left}
#kamoku-root .kt td{padding:6px 10px;border-bottom:1px solid var(--border,#dde3f0);vertical-align:middle}
#kamoku-root .kt .grp td{background:var(--surface2,#f4f6fa);font-weight:700}
#kamoku-root .kt .sub td:first-child{padding-left:24px;color:var(--text2,#556)}
#kamoku-root .kt .tot td{background:var(--surface2,#f4f6fa);font-weight:700;border-top:2px solid var(--border,#dde3f0)}
#kamoku-root .kbar{height:5px;background:var(--border,#dde3f0);border-radius:2px;overflow:hidden;min-width:40px}
#kamoku-root .kbar-f{height:100%;border-radius:2px;transition:width .3s}
</style>

<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
  <div style="display:flex;align-items:center;gap:6px">
    <span style="font-size:12px;color:var(--text3)">\u5bfe\u8c61\u6708</span>
    <select id="k-ym" onchange="KAMOKU_UI.render()" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border,#dde3f0);background:var(--surface,#fff);color:var(--text1);font-size:12px">
      ${months.map(m=>`<option value="${m}" ${m===selYm?'selected':''}>${ymLabel(m)}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    <span style="font-size:12px;color:var(--text3)">\u6bd4\u8f03</span>
    <select id="k-cmp" onchange="KAMOKU_UI.render()" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border,#dde3f0);background:var(--surface,#fff);color:var(--text1);font-size:12px">
      <option value="none"   ${cmpMode==='none'  ?'selected':''}>\u6bd4\u8f03\u306a\u3057</option>
      <option value="prev"   ${cmpMode==='prev'  ?'selected':''}>\u524d\u6708\u3068\u6bd4\u8f03</option>
      <option value="select" ${cmpMode==='select'?'selected':''}>\u6708\u3092\u6307\u5b9a</option>
    </select>
    ${cmpMode==='select'?`<select id="k-cmpym" onchange="KAMOKU_UI.render()" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border,#dde3f0);background:var(--surface,#fff);color:var(--text1);font-size:12px">
      ${months.filter(m=>m!==selYm).map(m=>`<option value="${m}" ${m===selCmpYm?'selected':''}>${ymLabel(m)}</option>`).join('')}
    </select>`:'<span id="k-cmpym" style="display:none"></span>'}
  </div>
  ${cmpAvail?`<span style="font-size:11px;color:var(--text3)">\u6bd4\u8f03: ${ymLabel(cmpYm)}</span>`
            :(cmpMode!=='none'?'<span style="font-size:11px;color:#e87830">\u6bd4\u8f03\u30c7\u30fc\u30bf\u306a\u3057</span>':'')}
</div>
<div id="k-body"></div>`;

    _renderBody(
      document.getElementById('k-body'),
      selYm,
      (cmpMode!=='none' && cmpAvail) ? cmpYm : null
    );
  }

  function _renderBody(el, ym, cmpYm) {
    const rows = getRows(ym);
    const cr   = cmpYm ? getRows(cmpYm) : null;
    const hasCmp = !!cr;

    const totInc  = INCOME_GROUPS.reduce((s,g)=>s+n(rows[g.key]),0);
    const totExp  = EXPENSE_GROUPS.reduce((s,g)=>s+g.items.reduce((ss,i)=>ss+n(rows[i.key]),0),0);
    const profit  = totInc - totExp;
    const margin  = totInc ? profit/totInc*100 : 0;
    const ctInc   = cr ? INCOME_GROUPS.reduce((s,g)=>s+n(cr[g.key]),0) : null;
    const ctExp   = cr ? EXPENSE_GROUPS.reduce((s,g)=>s+g.items.reduce((ss,i)=>ss+n(cr[i.key]),0),0) : null;
    const cProfit = ctInc!=null&&ctExp!=null ? ctInc-ctExp : null;
    const cMargin = ctInc ? cProfit/ctInc*100 : null;

    const cmpHdr = hasCmp ? `<th>${ymLabel(cmpYm)}</th><th>\u5dee\u5206</th>` : '';
    const cmpCols = hasCmp ? 5 : 3;

    el.innerHTML = `
<!-- サマリーカード -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px">
  ${_card('\u7dcf\u53ce\u5165',  totInc, ctInc,  '#1a6fc4')}
  ${_card('\u7dcf\u8cbb\u7528',  totExp, ctExp,  '#e05a5a')}
  ${_card('\u55b6\u696d\u5229\u76ca', profit, cProfit, profit>=0?'#16a34a':'#dc2626')}
  ${_cardPct('\u5229\u76ca\u7387', margin, cMargin)}
</div>

<!-- 2列テーブル -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;align-items:start">

  <!-- 収入 -->
  <div class="card" style="overflow:hidden">
    <div style="padding:10px 14px;border-bottom:1px solid var(--border,#dde3f0);font-size:13px;font-weight:700;color:var(--text1)">\uD83D\uDCB0 \u53ce\u5165\u5185\u8a33</div>
    <div style="overflow-x:auto">
      <table class="kt">
        <tr>
          <th style="text-align:left">\u79d1\u76ee</th>
          <th>${ymLabel(ym)}</th>
          ${cmpHdr}
          <th style="min-width:60px">\u69cb\u6210\u6bd4</th>
        </tr>
        ${_incRows(rows, cr, totInc, hasCmp, ymLabel(ym), ymLabel(cmpYm))}
        <tr class="tot"><td>\u5408\u8a08</td>
          <td style="text-align:right;color:#1a6fc4">${fmtK(totInc)}</td>
          ${hasCmp?`<td style="text-align:right;color:var(--text3)">${fmtK(ctInc)}</td>`:''}
          ${hasCmp?diffCell(totInc,ctInc):''}
          <td></td>
        </tr>
      </table>
    </div>
  </div>

  <!-- 費用 -->
  <div class="card" style="overflow:hidden">
    <div style="padding:10px 14px;border-bottom:1px solid var(--border,#dde3f0);font-size:13px;font-weight:700;color:var(--text1)">\uD83D\uDCB8 \u8cbb\u7528\u5185\u8a33</div>
    <div style="overflow-x:auto">
      <table class="kt">
        <tr>
          <th style="text-align:left">\u79d1\u76ee</th>
          <th>${ymLabel(ym)}</th>
          ${cmpHdr}
          <th style="min-width:60px">\u69cb\u6210\u6bd4</th>
        </tr>
        ${_expRows(rows, cr, totExp, hasCmp)}
        <tr class="tot"><td>\u5408\u8a08</td>
          <td style="text-align:right;color:#e05a5a">${fmtK(totExp)}</td>
          ${hasCmp?`<td style="text-align:right;color:var(--text3)">${fmtK(ctExp)}</td>`:''}
          ${hasCmp?diffCell(totExp,ctExp):''}
          <td></td>
        </tr>
      </table>
    </div>
  </div>
</div>

<!-- グラフ -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
  <div class="card">
    <div style="padding:10px 14px;font-size:12px;font-weight:700">\u53ce\u5165\u69cb\u6210</div>
    <div style="height:190px;padding:8px;position:relative"><canvas id="k-c1"></canvas></div>
  </div>
  <div class="card">
    <div style="padding:10px 14px;font-size:12px;font-weight:700">\u8cbb\u7528\u69cb\u6210</div>
    <div style="height:190px;padding:8px;position:relative"><canvas id="k-c2"></canvas></div>
  </div>
</div>

${hasCmp ? _barSection(rows, cr, totInc, totExp, ctInc, ctExp, ym, cmpYm) : ''}
`;

    // 補助科目の展開トグル
    el.querySelectorAll('tr[data-sub-for]').forEach(tr => { tr.style.display = 'none'; });
    el.querySelectorAll('.k-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        el.querySelectorAll(`tr[data-sub-for="${key}"]`).forEach(tr => {
          tr.style.display = tr.style.display==='none' ? '' : 'none';
        });
        btn.textContent = btn.textContent.includes('\u25bc') ? '\u25b6 ' : '\u25bc ';
      });
    });

    _drawCharts(rows);
  }

  function _incRows(rows, cr, totInc, hasCmp) {
    let html = '';
    for (const g of INCOME_GROUPS) {
      const v  = n(rows[g.key]);
      const cv = cr ? n(cr[g.key]) : null;
      if (!v && !cv) continue;
      const pct = totInc ? v/totInc*100 : 0;
      const activeSubs = g.subs.filter(s => n(rows[s]) || (cr&&n(cr[s])));
      const hasS = activeSubs.length > 0;
      html += `<tr>
        <td style="font-weight:600">
          ${hasS?`<span class="k-toggle" data-key="${g.key}" style="cursor:pointer;user-select:none">\u25b6 </span>`:'　'}${g.label}
        </td>
        <td style="text-align:right;color:#1a6fc4;font-weight:600">${fmtK(v)}${hasCmp&&cv!=null?diffBadge(v,cv):''}</td>
        ${hasCmp?`<td style="text-align:right;color:var(--text3)">${cv!=null?fmtK(cv):'\u2014'}</td>`:''}
        ${hasCmp?diffCell(v,cv):''}
        <td>
          <div class="kbar"><div class="kbar-f" style="width:${Math.min(pct,100).toFixed(1)}%;background:#1a6fc4"></div></div>
          <div style="font-size:10px;color:var(--text3);text-align:right">${pct.toFixed(1)}%</div>
        </td>
      </tr>`;
      activeSubs.forEach((s,si) => {
        const sv  = n(rows[s]);
        const scv = cr ? n(cr[s]) : null;
        const spct = v ? sv/v*100 : 0;
        const c = SUB_COLORS[si%SUB_COLORS.length];
        html += `<tr class="sub" data-sub-for="${g.key}">
          <td><span style="width:7px;height:7px;background:${c};border-radius:1px;display:inline-block;margin-right:4px"></span>${s}</td>
          <td style="text-align:right;color:${c};font-weight:600">${fmtK(sv)}</td>
          ${hasCmp?`<td style="text-align:right;color:var(--text3);font-size:11px">${scv!=null?fmtK(scv):'\u2014'}</td>`:''}
          ${hasCmp?diffCell(sv,scv):''}
          <td>
            <div class="kbar"><div class="kbar-f" style="width:${Math.min(spct,100).toFixed(1)}%;background:${c}"></div></div>
            <div style="font-size:10px;color:var(--text3);text-align:right">${spct.toFixed(1)}%</div>
          </td>
        </tr>`;
      });
    }
    return html;
  }

  function _expRows(rows, cr, totExp, hasCmp) {
    let html = '';
    for (const g of EXPENSE_GROUPS) {
      const activeItems = g.items.map(i=>({...i,v:n(rows[i.key]),cv:cr?n(cr[i.key]):null}))
                                  .filter(i=>i.v||i.cv);
      if (!activeItems.length) continue;
      html += `<tr class="grp"><td colspan="${hasCmp?5:3}" style="color:${g.color}">
        <span style="width:9px;height:9px;background:${g.color};border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle"></span>${g.group}
      </td></tr>`;
      for (const item of activeItems) {
        const pct = totExp ? item.v/totExp*100 : 0;
        html += `<tr>
          <td style="padding-left:20px;color:var(--text2)">\u2514 ${item.label}</td>
          <td style="text-align:right;color:#e05a5a;font-weight:600">${fmtK(item.v)}${hasCmp&&item.cv!=null?diffBadge(item.v,item.cv):''}</td>
          ${hasCmp?`<td style="text-align:right;color:var(--text3)">${item.cv!=null?fmtK(item.cv):'\u2014'}</td>`:''}
          ${hasCmp?diffCell(item.v,item.cv):''}
          <td>
            <div class="kbar"><div class="kbar-f" style="width:${Math.min(pct,100).toFixed(1)}%;background:${g.color}"></div></div>
            <div style="font-size:10px;color:var(--text3);text-align:right">${pct.toFixed(1)}%</div>
          </td>
        </tr>`;
      }
    }
    return html;
  }

  function _card(label, val, cval, color) {
    const db = cval!=null ? diffBadge(val,cval) : '';
    return `<div class="card" style="padding:12px 14px;border-top:3px solid ${color}">
      <div style="font-size:11px;color:var(--text3);margin-bottom:3px">${label}</div>
      <div style="font-size:15px;font-weight:700;color:${color}">${fmtK(val)}${db}</div>
      ${cval!=null?`<div style="font-size:10px;color:var(--text3);margin-top:1px">\u524d\u6708: ${fmtK(cval)}</div>`:''}
    </div>`;
  }
  function _cardPct(label, val, cval) {
    const color = val>=0 ? '#16a34a' : '#dc2626';
    const db = cval!=null ? diffBadge(val,cval) : '';
    return `<div class="card" style="padding:12px 14px;border-top:3px solid ${color}">
      <div style="font-size:11px;color:var(--text3);margin-bottom:3px">${label}</div>
      <div style="font-size:15px;font-weight:700;color:${color}">${val.toFixed(1)}%${db}</div>
      ${cval!=null?`<div style="font-size:10px;color:var(--text3);margin-top:1px">\u524d\u6708: ${cval.toFixed(1)}%</div>`:''}
    </div>`;
  }

  function _barSection(rows, cr, totInc, totExp, ctInc, ctExp, ym, cmpYm) {
    const items = [
      {label:'\u7dcf\u53ce\u5165',   cur:totInc,        prv:ctInc,        color:'#1a6fc4'},
      {label:'\u7dcf\u8cbb\u7528',   cur:totExp,        prv:ctExp,        color:'#e05a5a'},
      {label:'\u55b6\u696d\u5229\u76ca', cur:totInc-totExp, prv:ctInc-ctExp,  color:'#16a34a'},
    ];
    const max = Math.max(...items.flatMap(i=>[Math.abs(i.cur),Math.abs(i.prv)])) || 1;
    return `<div class="card" style="margin-bottom:18px">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border,#dde3f0);font-size:12px;font-weight:700">
        \uD83D\uDCCA ${ymLabel(ym)} vs ${ymLabel(cmpYm)} \u6bd4\u8f03
      </div>
      <div style="padding:14px 16px">
        ${items.map(item=>{
          const cw = (Math.abs(item.cur)/max*100).toFixed(1);
          const pw = (Math.abs(item.prv)/max*100).toFixed(1);
          const diff = item.cur - item.prv;
          const dc = diff>=0?'#16a34a':'#dc2626';
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
              <span style="font-weight:600">${item.label}</span>
              <span style="color:${dc};font-weight:600">${diff>=0?'+':''}${fmtK(diff)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:10px;color:var(--text3);width:44px;text-align:right">${ymLabel(ym).slice(5)}</span>
              <div style="flex:1;height:13px;background:var(--border,#dde3f0);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${cw}%;background:${item.color};border-radius:3px"></div>
              </div>
              <span style="font-size:11px;font-weight:600;color:${item.color};width:110px">${fmtK(item.cur)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:10px;color:var(--text3);width:44px;text-align:right">${ymLabel(cmpYm).slice(5)}</span>
              <div style="flex:1;height:13px;background:var(--border,#dde3f0);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pw}%;background:${item.color};opacity:.4;border-radius:3px"></div>
              </div>
              <span style="font-size:11px;color:var(--text3);width:110px">${fmtK(item.prv)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function _drawCharts(rows) {
    [_chart1,_chart2].forEach(c=>{ try{c?.destroy();}catch(e){} });
    _chart1=null; _chart2=null;
    const opts = {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:'right',labels:{font:{size:10},boxWidth:10,padding:6}},
        tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmtK(ctx.raw)}`}}
      }
    };
    const incItems = INCOME_GROUPS.map(g=>({label:g.label,v:n(rows[g.key])})).filter(i=>i.v>0);
    const expItems = EXPENSE_GROUPS.map(g=>({
      label:g.group,
      v:g.items.reduce((s,i)=>s+n(rows[i.key]),0),
      color:g.color
    })).filter(i=>i.v>0);
    const c1=document.getElementById('k-c1'), c2=document.getElementById('k-c2');
    if (c1&&incItems.length) _chart1=new Chart(c1,{type:'doughnut',data:{
      labels:incItems.map(i=>i.label),
      datasets:[{data:incItems.map(i=>i.v),backgroundColor:['#1a6fc4','#e87830','#2ea8c4','#4db87a','#9b59c6','#e05a8a','#607d9a','#8d9e7a'],borderWidth:1}]
    },options:opts});
    if (c2&&expItems.length) _chart2=new Chart(c2,{type:'doughnut',data:{
      labels:expItems.map(i=>i.label),
      datasets:[{data:expItems.map(i=>i.v),backgroundColor:expItems.map(i=>i.color),borderWidth:1}]
    },options:opts});
  }

  return { render };
})();

window.KAMOKU_UI = KAMOKU_UI;
