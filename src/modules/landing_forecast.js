/* =====================================================================
   経営管理システム landing_forecast.js
   2026-06-12
   ・日別実績CSV（SKDL0001）から着地予測を作成
   ・BtoC家電配送向けに土日祝・月末偏重を補正
   ・月次収支表、現場明細、集計ロジックは変更しない
===================================================================== */
'use strict';

(function(){
  if (window.__LANDING_FORECAST_MODULE_LOADED_20260612__) return;
  window.__LANDING_FORECAST_MODULE_LOADED_20260612__ = true;

  const UI_ID = 'landing-forecast-root';
  const IMPORT_ID = 'daily-forecast-import-root';

  function escLocal(v){
    if (typeof esc === 'function') return esc(v);
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function num(v){ return Number(v || 0) || 0; }
  function fmtLocal(v){ return typeof fmt === 'function' ? fmt(v) : Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtKLocal(v){ return typeof fmtK === 'function' ? fmtK(v) : Math.round(num(v)/1000).toLocaleString('ja-JP'); }
  function pctLocal(v){ return typeof pct === 'function' ? pct(v) : (num(v).toFixed(1) + '%'); }
  function ymLabelLocal(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : String(ym || ''); }
  function toDateStr(v){
    const s = String(v || '').replace(/[^0-9]/g,'');
    if (s.length >= 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    const m = String(v || '').match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
    if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
    return '';
  }
  function ymFromDate(date){ return String(date || '').slice(0,7).replace('-',''); }
  function daysInMonth(ym){ return new Date(Number(ym.slice(0,4)), Number(ym.slice(4,6)), 0).getDate(); }
  function dateAt(ym, day){ return `${ym.slice(0,4)}-${ym.slice(4,6)}-${String(day).padStart(2,'0')}`; }
  function dayOfWeek(date){ return new Date(date + 'T00:00:00').getDay(); }
  function isMonthEnd(date){
    const ym = ymFromDate(date);
    const d = Number(date.slice(8,10));
    return d >= Math.max(1, daysInMonth(ym) - 4);
  }

  // 2026〜2027の祝日を初期値として保持。将来は設定画面で上書きできる構造にする。
  const DEFAULT_JP_HOLIDAYS = new Set([
    '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23',
    '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03','2027-11-23'
  ]);
  function isHoliday(date){ return DEFAULT_JP_HOLIDAYS.has(date); }
  function dayWeight(date){
    const dow = dayOfWeek(date);
    let w = 1.0;
    if (dow === 0) w = 1.38;       // 日曜
    else if (dow === 6) w = 1.45;  // 土曜
    else if (dow === 5) w = 1.12;  // 金曜
    else if (dow === 1) w = 0.95;  // 月曜
    else if (dow === 2) w = 0.86;  // 火曜
    else if (dow === 3) w = 0.88;  // 水曜
    else if (dow === 4) w = 0.96;  // 木曜
    if (isHoliday(date)) w = Math.max(w, 1.55);
    if (isMonthEnd(date)) w *= 1.18;
    return w;
  }
  function dayLabel(date){
    const dow = ['日','月','火','水','木','金','土'][dayOfWeek(date)] || '';
    const red = dayOfWeek(date) === 0 || isHoliday(date);
    const sat = dayOfWeek(date) === 6;
    return `<span style="color:${red ? '#dc2626' : sat ? '#2563eb' : 'inherit'}">${date.replace(/-/g,'/')}（${dow}）${isHoliday(date) ? ' 祝' : ''}</span>`;
  }

  function categoryFor(label){
    const s = String(label || '').replace(/[\s　\u3000]/g,'');
    if ((CONFIG.INCOME_KEYS || []).includes(s) || (CONFIG.INCOME_SUB_KEYS || []).includes(s)) return 'revenue';
    if ((CONFIG.LABOR_KEYS || []).includes(s) || s === '運行旅費') return 'labor';
    if ((CONFIG.YOSHA_KEYS || []).includes(s)) return 'yosha';
    if ((CONFIG.EXPENSE_KEYS || []).includes(s)) return 'other';
    return '';
  }
  function amountOf(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円千]/g,'').replace(/[^\d.\-]/g,'');
    if (!s || s === '-' || s === '.') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function parseDailyText(text, fileName=''){
    const rows = CSV.toRows(text || '');
    if (!rows.length) return [];
    const header = rows[0].map(v => String(v || '').replace(/[\s　\u3000]/g,''));
    const dateCol = header.findIndex(v => v === '計上日');
    const labelCol = header.findIndex(v => v === '収支科目名' || v === '経費計上先収支科目名');
    const amountCol = header.findIndex(v => v === '金額');
    if (dateCol < 0 || labelCol < 0 || amountCol < 0) throw new Error('計上日・収支科目名・金額列が見つかりません');

    const byDate = new Map();
    for (let i=1; i<rows.length; i++) {
      const row = rows[i];
      const date = toDateStr(row[dateCol]);
      if (!date) continue;
      const label = String(row[labelCol] || '').replace(/[\s　\u3000]/g,'');
      const cat = categoryFor(label);
      if (!cat) continue;
      const val = amountOf(row[amountCol]);
      if (!byDate.has(date)) byDate.set(date, { date, ym:ymFromDate(date), revenue:0, labor:0, yosha:0, other:0, profit:0, rowCount:0, sourceFile:fileName });
      const rec = byDate.get(date);
      rec[cat] += val;
      rec.rowCount += 1;
    }
    const importedAt = new Date().toISOString();
    const out = [];
    for (const rec of byDate.values()) {
      rec.profit = rec.revenue - rec.labor - rec.yosha - rec.other;
      rec.importedAt = importedAt;
      out.push(rec);
    }
    return out.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }
  function upsertDaily(records){
    if (!Array.isArray(STATE.dailyRecords)) STATE.dailyRecords = [];
    const map = new Map(STATE.dailyRecords.map(r => [r.date, r]));
    records.forEach(r => map.set(r.date, r));
    STATE.dailyRecords = Array.from(map.values()).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }
  function yms(){
    const set = new Set((STATE.dailyRecords || []).map(r=>r.ym).filter(Boolean));
    (STATE.datasets || []).forEach(d=>d?.ym && set.add(d.ym));
    return Array.from(set).sort().reverse();
  }
  function selectedYM(){
    const sel = document.getElementById('landing-forecast-ym');
    return sel?.value || yms()[0] || STATE.selYM || '';
  }
  function recordsForYM(ym){ return (STATE.dailyRecords || []).filter(r=>r && r.ym === ym).sort((a,b)=>String(a.date).localeCompare(String(b.date))); }
  function sum(records, key){ return records.reduce((s,r)=>s+num(r[key]),0); }
  function currentTotals(records){
    const revenue = sum(records,'revenue');
    const labor = sum(records,'labor');
    const yosha = sum(records,'yosha');
    const other = sum(records,'other');
    const profit = revenue - labor - yosha - other;
    return { revenue, labor, yosha, other, profit, profitRate: revenue ? profit/revenue*100 : 0 };
  }
  function forecastByWeights(records, ym){
    if (!records.length || !ym) return null;
    const actualDays = new Set(records.map(r=>r.date));
    const lastDay = Math.max(...records.map(r=>Number(String(r.date).slice(8,10))).filter(Number.isFinite));
    const dim = daysInMonth(ym);
    const actualWeight = Array.from(actualDays).reduce((s,d)=>s+dayWeight(d),0);
    let totalWeight = 0;
    for (let d=1; d<=dim; d++) totalWeight += dayWeight(dateAt(ym,d));
    const progress = totalWeight ? actualWeight / totalWeight : (lastDay / dim);
    const factor = progress ? 1 / progress : 1;
    const cur = currentTotals(records);
    return {
      progress, factor,
      revenue: cur.revenue * factor,
      labor: cur.labor * factor,
      yosha: cur.yosha * factor,
      other: cur.other * factor,
      profit: cur.profit * factor,
      profitRate: cur.revenue ? cur.profit / cur.revenue * 100 : 0
    };
  }
  function simpleForecast(records, ym){
    if (!records.length || !ym) return null;
    const dim = daysInMonth(ym);
    const lastDay = Math.max(...records.map(r=>Number(String(r.date).slice(8,10))).filter(Number.isFinite));
    const factor = lastDay ? dim / lastDay : 1;
    const cur = currentTotals(records);
    return {
      progress:lastDay/dim, factor,
      revenue:cur.revenue*factor, labor:cur.labor*factor, yosha:cur.yosha*factor, other:cur.other*factor, profit:cur.profit*factor,
      profitRate: cur.revenue ? cur.profit / cur.revenue * 100 : 0
    };
  }
  function planForYM(ym, label){
    if (!ym || typeof getPlanRowsForFiscalYear !== 'function') return null;
    const rows = getPlanRowsForFiscalYear(fiscalYearFromYM(ym));
    if (!rows || !rows.length) return null;
    const mm = ym.slice(4,6);
    if (label === '営業収益') return getPlanValueK(rows, '営業収益', mm, CONFIG.INCOME_KEYS) || null;
    if (label === '粗利益') return getPlanValueK(rows, '粗利益', mm, []) || null;
    return null;
  }
  function kpi(label, current, forecast, planK, type='money'){
    const fK = forecast / 1000;
    const cK = current / 1000;
    const planText = planK ? `${fmtLocal(planK)}千円` : '未登録';
    const rate = planK ? (fK / planK * 100) : 0;
    return `<div class="kpi-card">
      <div class="kpi-label">${escLocal(label)}</div>
      <div class="kpi-value">${fmtLocal(Math.round(fK))}<span style="font-size:13px;font-weight:600">千円</span></div>
      <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-top:6px">
        現在 ${fmtLocal(Math.round(cK))}千円<br>
        計画 ${planText}${planK ? `<br>達成率予測 ${pctLocal(rate)}` : ''}
      </div>
    </div>`;
  }
  function importSummary(){
    const byYm = new Map();
    (STATE.dailyRecords || []).forEach(r=>{
      if (!byYm.has(r.ym)) byYm.set(r.ym,{days:0,revenue:0,profit:0});
      const o=byYm.get(r.ym); o.days++; o.revenue+=num(r.revenue); o.profit+=num(r.profit);
    });
    const rows = Array.from(byYm.entries()).sort((a,b)=>String(b[0]).localeCompare(String(a[0]))).map(([ym,o])=>`
      <tr><td>${ymLabelLocal(ym)}</td><td class="r">${fmtLocal(o.days)}日</td><td class="r">${fmtKLocal(o.revenue)}千円</td><td class="r">${fmtKLocal(o.profit)}千円</td><td class="r"><button class="btn btn-danger" style="font-size:11px;padding:2px 8px" onclick="LANDING_FORECAST_UI.deleteYM('${ym}')">削除</button></td></tr>
    `).join('');
    return rows || '<tr><td colspan="5" style="color:var(--text3);padding:10px">日別実績はまだありません</td></tr>';
  }

  const api = window.LANDING_FORECAST_UI = {
    async importFiles(files){
      const arr = Array.from(files || []).filter(f=>/\.csv$/i.test(f.name));
      const msg = document.getElementById('daily-forecast-import-msg');
      if (!arr.length) { if(msg) msg.textContent='CSVを選択してください'; return; }
      let imported = 0;
      const logs = [];
      for (const f of arr) {
        try {
          const text = await CSV.read(f);
          const records = parseDailyText(text, f.name);
          if (!records.length) throw new Error('日別集計できる行がありません');
          upsertDaily(records);
          imported += records.length;
          const ymSet = Array.from(new Set(records.map(r=>r.ym))).join(', ');
          logs.push(`OK ${f.name}：${records.length}日分（${ymSet}）`);
        } catch(e) {
          logs.push(`NG ${f.name}：${e.message}`);
        }
      }
      STORE.save();
      if (CLOUD?.pushAll) CLOUD.pushAll({ onlyChanged:true }).catch(()=>{});
      this.renderImportPanel();
      this.render();
      if (msg) msg.innerHTML = `<div style="white-space:pre-wrap;font-size:12px;font-weight:700;color:#065f46">${escLocal(`日別実績取込：${imported}日分\n` + logs.join('\n'))}</div>`;
      UI.toast(`日別実績を${imported}日分取り込みました`);
    },
    deleteYM(ym){
      if (!confirm(`${ymLabelLocal(ym)}の日別実績を削除しますか？`)) return;
      STATE.dailyRecords = (STATE.dailyRecords || []).filter(r=>r.ym !== ym);
      STORE.save();
      if (CLOUD?.pushAll) CLOUD.pushAll({ onlyChanged:true }).catch(()=>{});
      this.renderImportPanel();
      this.render();
      UI.toast(`${ymLabelLocal(ym)}の日別実績を削除しました`);
    },
    renderImportPanel(){
      const root = document.getElementById(IMPORT_ID);
      if (!root) return;
      root.innerHTML = `<details class="card" style="margin-bottom:14px;border:2px solid #f59e0b;background:#fffbeb" open>
        <summary class="card-header" style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #fde68a">
          <div style="display:flex;align-items:center;gap:8px"><span class="card-title">📈 日別実績取込（着地予測用）</span><span class="badge badge-warn">SKDL0001</span></div>
          <span style="font-size:11px;color:var(--text3)">▼ 展開</span>
        </summary>
        <div class="card-body" style="font-size:12px;color:var(--text2);line-height:1.8">
          SKDL0001（日報）CSVから、計上日別に営業収益・人件費・傭車費・その他経費・粗利益を作成します。<br>
          月次収支表の確定値は変更しません。着地予測画面だけで使用します。
          <div class="upload-zone no-print" style="margin-top:10px;padding:18px;border-radius:8px;border:2px dashed #f59e0b;background:#fff;text-align:center;cursor:pointer"
               onclick="document.getElementById('daily-forecast-file-input').click()"
               ondragover="event.preventDefault();this.classList.add('drag')"
               ondragleave="this.classList.remove('drag')"
               ondrop="this.classList.remove('drag');event.preventDefault();LANDING_FORECAST_UI.importFiles(event.dataTransfer.files)">
            <input type="file" id="daily-forecast-file-input" accept=".csv" multiple style="display:none" onchange="LANDING_FORECAST_UI.importFiles(this.files);this.value=''">
            <div style="font-size:24px;color:#f59e0b;margin-bottom:6px">⬆</div>
            <div style="font-size:13px;font-weight:900;color:var(--text)">SKDL0001を選択またはドロップ</div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">赤日・土日・月末補正の着地予測に使用します</div>
          </div>
          <div id="daily-forecast-import-msg" style="margin-top:8px"></div>
          <div style="margin-top:12px;overflow:auto">
            <table class="data-table"><thead><tr><th>年月</th><th class="r">登録日数</th><th class="r">営業収益</th><th class="r">粗利益</th><th></th></tr></thead><tbody>${importSummary()}</tbody></table>
          </div>
        </div>
      </details>`;
    },
    render(){
      const root = document.getElementById(UI_ID);
      if (!root) return;
      const months = yms();
      if (!months.length) {
        root.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">着地予測</span></div><div class="card-body" style="color:var(--text2)">日別実績データが未登録です。データ取込画面からSKDL0001を取り込んでください。</div></div>`;
        return;
      }
      const ym = selectedYM();
      const records = recordsForYM(ym);
      const cur = currentTotals(records);
      const simple = simpleForecast(records, ym);
      const b2c = forecastByWeights(records, ym) || simple;
      const lastDate = records.length ? records[records.length-1].date : '';
      const planRevenue = planForYM(ym, '営業収益');
      const planProfit = planForYM(ym, '粗利益');
      const forecast = b2c || { revenue:0,labor:0,yosha:0,other:0,profit:0,profitRate:0,progress:0 };
      const simpleRevenueK = simple ? Math.round(simple.revenue/1000) : 0;
      const b2cRevenueK = Math.round(forecast.revenue/1000);
      const diffText = simple ? `${fmtLocal(b2cRevenueK - simpleRevenueK)}千円` : '-';
      const dailyRows = records.map(r => `<tr>
        <td>${dayLabel(r.date)}</td><td class="r">${fmtKLocal(r.revenue)}</td><td class="r">${fmtKLocal(r.labor)}</td><td class="r">${fmtKLocal(r.yosha)}</td><td class="r">${fmtKLocal(r.other)}</td><td class="r ${r.profit>=0?'cell-up':'cell-down'}">${fmtKLocal(r.profit)}</td>
      </tr>`).join('');
      const warn = forecast.profit < 0 ? '粗利益が赤字予測です。傭車費・人件費・高単価案件の確認が必要です。' : (planProfit && forecast.profit/1000 < planProfit ? '粗利益が計画未達予測です。月末の高単価案件・傭車使用を確認してください。' : '現時点では大きな異常はありません。');
      root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:12px">
        <div><h2 style="font-size:20px;margin:0;color:var(--text)">着地予測</h2><div style="font-size:12px;color:var(--text2);margin-top:4px">日別実績をもとに、BtoC家電配送向けの土日祝・月末補正で着地を予測します。</div></div>
        <div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;font-weight:700;color:var(--text2)">対象月</label><select id="landing-forecast-ym" onchange="LANDING_FORECAST_UI.render()" style="font-size:12px;padding:6px 10px;border:1px solid var(--border2);border-radius:8px">${months.map(m=>`<option value="${m}" ${m===ym?'selected':''}>${ymLabelLocal(m)}</option>`).join('')}</select></div>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        ${kpi('営業収益 着地予測', cur.revenue, forecast.revenue, planRevenue)}
        ${kpi('粗利益 着地予測', cur.profit, forecast.profit, planProfit)}
        <div class="kpi-card"><div class="kpi-label">粗利率予測</div><div class="kpi-value">${pctLocal(forecast.profitRate)}</div><div style="font-size:11px;color:var(--text2);line-height:1.7;margin-top:6px">現在 ${pctLocal(cur.profitRate)}<br>最終入力 ${lastDate ? lastDate.replace(/-/g,'/') : '-'}</div></div>
        <div class="kpi-card"><div class="kpi-label">進捗率（BtoC補正）</div><div class="kpi-value">${pctLocal(forecast.progress*100)}</div><div style="font-size:11px;color:var(--text2);line-height:1.7;margin-top:6px">単純予測との差 ${diffText}<br>赤日・土日・月末を加味</div></div>
      </div>
      <div class="card" style="margin-bottom:14px;border-left:4px solid ${forecast.profit < 0 ? '#dc2626' : '#1a4d7c'}"><div class="card-header"><span class="card-title">判断メモ</span></div><div class="card-body" style="font-size:13px;line-height:1.9;color:var(--text)">${escLocal(warn)}<br><span style="font-size:12px;color:var(--text2)">単純日割ではなく、BtoC配送で伸びやすい土日祝・月末の残り日数を補正しています。</span></div></div>
      <div class="card" style="margin-bottom:14px"><div class="card-header"><span class="card-title">予測内訳</span></div><div class="card-body" style="overflow:auto"><table class="data-table"><thead><tr><th>区分</th><th class="r">現在</th><th class="r">単純予測</th><th class="r">BtoC補正予測</th></tr></thead><tbody>
        ${['revenue','labor','yosha','other','profit'].map(k=>{ const labels={revenue:'営業収益',labor:'人件費',yosha:'傭車費',other:'その他経費',profit:'粗利益'}; return `<tr><td>${labels[k]}</td><td class="r">${fmtKLocal(cur[k])}</td><td class="r">${fmtKLocal(simple ? simple[k] : 0)}</td><td class="r">${fmtKLocal(forecast[k])}</td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="card"><div class="card-header"><span class="card-title">日別実績</span></div><div class="card-body" style="overflow:auto"><table class="data-table"><thead><tr><th>日付</th><th class="r">営業収益</th><th class="r">人件費</th><th class="r">傭車費</th><th class="r">その他経費</th><th class="r">粗利益</th></tr></thead><tbody>${dailyRows}</tbody></table></div></div>`;
    }
  };
})();
