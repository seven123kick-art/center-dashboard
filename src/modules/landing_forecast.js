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
  let renderToken = 0;
  let lastForecastPeriods = [];

  function escLocal(v){
    if (typeof esc === 'function') return esc(v);
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function num(v){ return Number(v || 0) || 0; }
  function fmtLocal(v){ return typeof fmt === 'function' ? fmt(v) : Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtKLocal(v){ return typeof fmtK === 'function' ? fmtK(v) : Math.round(num(v)/1000).toLocaleString('ja-JP'); }
  function pctLocal(v){ return typeof pct === 'function' ? pct(v) : (num(v).toFixed(1) + '%'); }
  function ymLabelLocal(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : String(ym || ''); }
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

  function legacyYMs(){
    const set = new Set((STATE.dailyRecords || []).map(r=>r.ym).filter(Boolean));
    (STATE.datasets || []).forEach(d=>d?.ym && set.add(d.ym));
    return Array.from(set).sort().reverse();
  }
  async function forecastYMs(){
    const legacy=legacyYMs(),repo=window.Repository?.NormalizedSource;
    if(!repo?.listPeriods) return {periods:legacy,source:'LEGACY'};
    try{
      let listed=await repo.listPeriods('PL_DAILY_ACTUAL');
      let formal=Array.isArray(listed?.periods)?listed.periods:[];
      if(repo?.bootstrapPeriods&&legacy.some(ym=>!formal.includes(ym))){
        const boot=await repo.bootstrapPeriods('PL_DAILY_ACTUAL',legacy);
        if(boot?.ok) formal=Array.isArray(boot.periods)?boot.periods:formal;
      }
      const set=new Set(formal);
      legacy.forEach(ym=>{if(!set.has(ym))set.add(ym);});
      return {periods:Array.from(set).sort().reverse(),source:formal.length?'PERIOD_INDEX':'LEGACY',formalPeriods:new Set(formal)};
    }catch(e){
      console.warn('[M2-5B] period index unavailable',e);
      return {periods:legacy,source:'LEGACY'};
    }
  }
  function selectedYM(periods=lastForecastPeriods){
    const sel=document.getElementById('landing-forecast-ym');
    return sel?.value || periods[0] || STATE.selYM || '';
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
  async function engineForecast(records, ym){
    if (!window.FORECAST_ENGINE?.evaluate) return null;
    let context={history:[],priorYear:null};
    if (window.FORECAST_CONTEXT_LOADER?.load) {
      try { context=await FORECAST_CONTEXT_LOADER.load(ym,{months:24}); }
      catch(e){ console.warn('[M2-4B] forecast context unavailable',e); }
    }
    const evaluations={};
    for (const metric of ['revenue','labor','yosha','other']) evaluations[metric]=FORECAST_ENGINE.evaluate({current:{ym,records},history:context.history||[],priorYear:context.priorYear||null,metric,calendar:{isHoliday}});
    const value=metric=>evaluations[metric]?.selected?.forecast;
    if (['revenue','labor','yosha','other'].some(k=>!Number.isFinite(Number(value(k))))) return null;
    const revenue=Number(value('revenue')),labor=Number(value('labor')),yosha=Number(value('yosha')),other=Number(value('other')),profit=revenue-labor-yosha-other,re=evaluations.revenue;
    return {revenue,labor,yosha,other,profit,profitRate:revenue?profit/revenue*100:0,progress:Number(re?.selected?.progress||0),factor:Number(re?.selected?.factor||1),model:re?.selection?.model||'LEGACY_WEIGHTED',modelReason:re?.selection?.reason||'',confidence:re?.selection?.confidence||'LOW',historyCount:Number(re?.history_count||0),evaluations};
  }

  function planForYM(ym, label){
    if (!ym || typeof getPlanRowsForFiscalYear !== 'function') return null;
    const rows = getPlanRowsForFiscalYear(fiscalYearFromYM(ym));
    if (!rows) return null;
    const mm = ym.slice(4,6);
    if (label === '営業収益') return getPlanValueK(rows, '営業収益', mm, CONFIG.INCOME_KEYS);
    if (label === '粗利益') return getPlanValueK(rows, '粗利益', mm, []);
    return null;
  }

  /* ---------- 達成率予測の表示ロジック（今回追加） ----------
     既存の共通ratio()（src/core/format.js）は変更していない。
     予実差異分析（budget_actual.js）のyoyRatioLabel()と同じ考え方
     （比較対象がマイナスの場合に単純な%へ変換しない）を、着地予測
     固有の「計画 vs 着地予測」比較に合わせてこのファイル内だけで
     実装する。他画面・共通関数への影響はない。 */
  function achievementLabel(planK, fK){
    if (planK > 0) return pctLocal(fK / planK * 100);
    if (planK === 0) return '—';
    // planK < 0（赤字計画）
    if (fK > 0) return '黒字転換';
    if (fK === 0) return '黒字化';
    if (fK === planK) return '計画並み';
    if (fK > planK) return '赤字縮小';
    return '赤字拡大';
  }

  function kpi(label, current, forecast, planK, type='money'){
    const fK = forecast / 1000;
    const cK = current / 1000;
    const planText = planK != null ? `${fmtLocal(planK)}千円` : '未登録';
    const rateText = planK != null ? achievementLabel(planK, fK) : null;
    return `<div class="kpi-card">
      <div class="kpi-label">${escLocal(label)}</div>
      <div class="kpi-value">${fmtLocal(Math.round(fK))}<span style="font-size:13px;font-weight:600">千円</span></div>
      <div class="kpi-sub-row"><span class="kpi-sub">現在 ${fmtLocal(Math.round(cK))}千円</span></div>
      <div class="kpi-sub-row"><span class="kpi-sub">計画 ${planText}${rateText != null ? `／達成率予測 ${rateText}` : ''}</span></div>
    </div>`;
  }
  async function legacyAuditRows(){
    const legacyByYm=new Map();
    (STATE.dailyRecords||[]).forEach(r=>{
      if(!r?.ym)return;
      if(!legacyByYm.has(r.ym))legacyByYm.set(r.ym,{days:new Set(),revenue:0});
      const o=legacyByYm.get(r.ym); if(r.date)o.days.add(r.date); o.revenue+=num(r.revenue);
    });
    const repo=window.Repository?.NormalizedSource;
    let formal=[];
    if(repo?.listPeriods){try{const x=await repo.listPeriods('PL_DAILY_ACTUAL');formal=Array.isArray(x?.periods)?x.periods:[];}catch(e){console.warn('[M2-5E] period index audit failed',e);}}
    const months=Array.from(new Set([...formal,...legacyByYm.keys()])).sort().reverse();
    if(!months.length)return '<tr><td colspan="6" style="color:var(--text3);padding:10px">日別実績はまだありません</td></tr>';
    return months.map(ym=>{
      const legacy=legacyByYm.get(ym),hasFormal=formal.includes(ym);
      const status=hasFormal&&legacy?'正式SOURCEあり／Legacy整理可能':hasFormal?'正式SOURCEのみ':legacy?'Legacyのみ／要移行':'確認不能';
      const action=hasFormal&&legacy?`<button class="btn btn-danger" style="font-size:11px;padding:2px 8px" onclick="LANDING_FORECAST_UI.cleanupLegacyYM('${ym}')">Legacy整理</button>`:(!hasFormal&&legacy?`<button class="btn btn-danger" style="font-size:11px;padding:2px 8px" onclick="LANDING_FORECAST_UI.deleteYM('${ym}')">旧データ削除</button>`:'');
      return `<tr><td>${ymLabelLocal(ym)}</td><td>${hasFormal?'あり':'なし'}</td><td>${legacy?`${fmtLocal(legacy.days.size)}日`:'なし'}</td><td class="r">${legacy?`${fmtKLocal(legacy.revenue)}千円`:'—'}</td><td><span class="badge ${hasFormal?'badge-ok':'badge-warn'}">${status}</span></td><td class="r">${action}</td></tr>`;
    }).join('');
  }

  const api = window.LANDING_FORECAST_UI = {
    async importFiles(files){
      const arr = Array.from(files || []).filter(f=>/\.csv$/i.test(f.name));
      const msg = document.getElementById('daily-forecast-import-msg');
      if (!arr.length) { if(msg) msg.textContent='CSVを選択してください'; return; }
      if (!window.DAILY_ACCOUNTING_IMPORT_BRIDGE?.normalizeCsvText || !window.DAILY_ACCOUNTING_IMPORT_BRIDGE?.persistRecords) {
        if(msg) msg.textContent='Version6日別SOURCE取込基盤を読み込めません';
        UI.toast('Version6日別SOURCE取込基盤を読み込めません','error');
        return;
      }
      let imported = 0;
      const logs = [];
      const normalizedByYM = new Map();
      const normalizedFilesByYM = new Map();
      for (const f of arr) {
        try {
          const text = await CSV.read(f);
          const normalized = DAILY_ACCOUNTING_IMPORT_BRIDGE.normalizeCsvText(text,{file_name:f.name});
          if (!normalized.length) throw new Error('日別集計できる行がありません');
          normalized.forEach(r=>{
            if(!normalizedByYM.has(r.year_month)) normalizedByYM.set(r.year_month,[]);
            normalizedByYM.get(r.year_month).push(r);
            if(!normalizedFilesByYM.has(r.year_month)) normalizedFilesByYM.set(r.year_month,new Set());
            normalizedFilesByYM.get(r.year_month).add(f.name);
          });
          const dayKeys = new Set(normalized.map(r=>r.accounting_date).filter(Boolean));
          imported += dayKeys.size;
          const ymSet = Array.from(new Set(normalized.map(r=>r.year_month).filter(Boolean))).join(', ');
          logs.push(`OK ${f.name}：${dayKeys.size}日分（${ymSet}）`);
        } catch(e) {
          logs.push(`NG ${f.name}：${e.message}`);
        }
      }
      if (normalizedByYM.size) {
        for (const [period, rows] of normalizedByYM.entries()) {
          try {
            const saved = await DAILY_ACCOUNTING_IMPORT_BRIDGE.persistRecords(rows,{period,source_file_names:[...(normalizedFilesByYM.get(period)||[])]});
            if(!saved?.ok) logs.push(`WARN ${ymLabelLocal(period)}：Version6日別SOURCE保存 ${saved?.error||'失敗'}`);
          } catch(e) {
            logs.push(`WARN ${ymLabelLocal(period)}：Version6日別SOURCE保存 ${e.message||e}`);
          }
        }
      }
      this.renderImportPanel();
      this.render();
      if (msg) msg.innerHTML = `<div style="white-space:pre-wrap;font-size:12px;font-weight:700;color:#065f46">${escLocal(`日別実績取込：${imported}日分\n` + logs.join('\n'))}</div>`;
      UI.toast(`日別実績を${imported}日分取り込みました`);
    },
    async cleanupLegacyYM(ym){
      const repo=window.Repository?.NormalizedSource;
      if(!repo?.loadCurrent){UI.toast('正式SOURCEを確認できないため整理できません','warn');return;}
      try{const current=await repo.loadCurrent('PL_DAILY_ACTUAL',ym,{preferCache:true});if(!current?.ok||!current.batch){UI.toast('正式SOURCEが確認できないためLegacyを削除しません','warn');return;}}
      catch(e){UI.toast('正式SOURCE確認に失敗したためLegacyを削除しません','warn');return;}
      const count=(STATE.dailyRecords||[]).filter(r=>r?.ym===ym).length;
      if(!count){UI.toast('整理対象のLegacyデータはありません');return;}
      if(!confirm(`${ymLabelLocal(ym)}は正式SOURCE登録済みです。重複するLegacy日別実績 ${count}件を整理しますか？`))return;
      STATE.dailyRecords=(STATE.dailyRecords||[]).filter(r=>r?.ym!==ym);
      Repository.Storage.save();
      if(CLOUD?.pushAll)SYNC_COORDINATOR.syncPush({onlyChanged:true}).catch(e=>console.warn('[M2-5E] legacy cleanup cloud sync failed',e));
      await this.renderImportPanel(); this.render();
      UI.toast(`${ymLabelLocal(ym)}の重複Legacyデータを整理しました`);
    },
    async deleteYM(ym){
      if (window.Repository?.NormalizedSource?.loadCurrent) {
        try {
          const current = await Repository.NormalizedSource.loadCurrent('PL_DAILY_ACTUAL',ym);
          if (current?.ok && current.batch) {
            UI.toast('この月は正式SOURCE登録済みです。削除ではなく訂正版SKDL0001を再取込してください','warn');
            return;
          }
        } catch(_e){}
      }
      if (!confirm(`${ymLabelLocal(ym)}の日別実績を削除しますか？`)) return;
      STATE.dailyRecords = (STATE.dailyRecords || []).filter(r=>r.ym !== ym);
      Repository.Storage.save();
      if (CLOUD?.pushAll) SYNC_COORDINATOR.syncPush({ onlyChanged:true }).then(r=>{ if(!r?.ok) throw new Error(r?.error||'クラウド同期に失敗しました'); }).catch(e=>{ console.warn('[D4-16] landing forecast delete cloud sync failed',e); UI.toast('日別実績はローカル削除済みですが、クラウド同期に失敗しました','warn'); });
      this.renderImportPanel();
      this.render();
      UI.toast(`${ymLabelLocal(ym)}の日別実績を削除しました`);
    },
    printReport(){
      const ym = selectedYM();
      if (!window.EXPORT_SERVICE) { UI?.toast && UI.toast('出力機能を読み込めませんでした', 'error'); return; }
      EXPORT_SERVICE.toPrint({
        title: '着地予測',
        center: (typeof CENTER !== 'undefined' && CENTER?.name) ? CENTER.name : '',
        period: ymLabelLocal(ym),
      });
    },
    async renderImportPanel(){
      const root = document.getElementById(IMPORT_ID);
      if (!root) return;
      const auditRows=await legacyAuditRows();
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
            <table class="data-table"><thead><tr><th>年月</th><th>正式SOURCE</th><th>Legacy</th><th class="r">Legacy営業収益</th><th>移行監査</th><th></th></tr></thead><tbody>${auditRows}</tbody></table>
          </div>
        </div>
      </details>`;
    },
    async render(){
      const token = ++renderToken;
      const root = document.getElementById(UI_ID);
      if (!root) return;
      const monthInfo = await forecastYMs();
      if (token !== renderToken) return;
      const months = monthInfo.periods || [];
      lastForecastPeriods = months;
      if (!months.length) {
        root.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">着地予測</span></div><div class="card-body" style="color:var(--text2)">日別実績データが未登録です。データ取込画面からSKDL0001を取り込んでください。</div></div>`;
        return;
      }
      const ym = selectedYM(months);
      let read = null;
      if (window.DAILY_FORECAST_READ_MODEL?.loadMonth) read = await DAILY_FORECAST_READ_MODEL.loadMonth(ym);
      if (token !== renderToken) return;
      if (!read) read = {status:'LEGACY_FALLBACK',source:'LEGACY',records:recordsForYM(ym),issues:[]};
      if (read.status === 'ERROR') {
        root.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">着地予測</span></div><div class="card-body" style="color:#b91c1c">日別実績SOURCEを読み込めませんでした。データ確認画面でPL_DAILY_ACTUALの状態を確認してください。</div></div>`;
        return;
      }
      const records = read.records || [];
      if (read.status === 'PARTIAL') {
        root.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">着地予測</span><span class="badge badge-warn">未確定</span></div><div class="card-body" style="color:var(--text2);line-height:1.8">SKDL0001に金額UNKNOWNが${fmtLocal(read.issues?.length||0)}件あります。UNKNOWNを0として予測しないため、着地予測を停止しています。元データを確認してください。</div></div>`;
        return;
      }
      const cur = currentTotals(records);
      const simple = simpleForecast(records, ym);
      const legacyForecast = forecastByWeights(records, ym) || simple;
      const lastDate = records.length ? records[records.length-1].date : '';
      const planRevenue = planForYM(ym, '営業収益');
      const planProfit = planForYM(ym, '粗利益');
      const engineResult = await engineForecast(records, ym);
      if (token !== renderToken) return;
      const forecast = engineResult || legacyForecast || { revenue:0,labor:0,yosha:0,other:0,profit:0,profitRate:0,progress:0,model:'LEGACY_WEIGHTED',historyCount:0,confidence:'LOW',modelReason:'Forecast Engine未利用' };
      const simpleRevenueK = simple ? Math.round(simple.revenue/1000) : 0;
      const b2cRevenueK = Math.round(forecast.revenue/1000);
      const diffText = simple ? `${fmtLocal(b2cRevenueK - simpleRevenueK)}千円` : '-';
      const dailyRows = records.map(r => `<tr>
        <td>${dayLabel(r.date)}</td><td class="r">${fmtKLocal(r.revenue)}</td><td class="r">${fmtKLocal(r.labor)}</td><td class="r">${fmtKLocal(r.yosha)}</td><td class="r">${fmtKLocal(r.other)}</td><td class="r ${r.profit>=0?'cell-up':'cell-down'}">${fmtKLocal(r.profit)}</td>
      </tr>`).join('');
      const warn = forecast.profit < 0 ? '粗利益が赤字予測です。傭車費・人件費・高単価案件の確認が必要です。' : (planProfit && forecast.profit/1000 < planProfit ? '粗利益が計画未達予測です。月末の高単価案件・傭車使用を確認してください。' : '現時点では大きな異常はありません。');
      const memoAlertClass = forecast.profit < 0 ? 'is-alert' : (planProfit && forecast.profit/1000 < planProfit ? 'is-warn' : '');
      const memoBadge = forecast.profit < 0 ? '<span class="badge badge-warn">要確認</span>' : (planProfit && forecast.profit/1000 < planProfit ? '<span class="badge badge-warn">要確認</span>' : '<span class="badge badge-ok">正常</span>');
      root.innerHTML = `<div class="lf-commandbar">
        <div class="lf-command-title">日別実績をもとに着地を予測します。 <span class="badge ${read.source==='PL_DAILY_ACTUAL'?'badge-ok':'badge-warn'}">${read.source==='PL_DAILY_ACTUAL'?'正式SOURCE':'旧データ互換'}</span></div>
        <div class="lf-command-sub">予測モデル：${escLocal(forecast?.model||'LEGACY_WEIGHTED')}／有効履歴 ${fmtLocal(forecast?.historyCount||0)}か月／信頼度 ${escLocal(forecast?.confidence||'LOW')}${forecast?.modelReason?`　${escLocal(forecast.modelReason)}`:''}／月一覧 ${monthInfo.source==='PERIOD_INDEX'?'正式Index':'旧データ互換'}</div>
        <div class="lf-toolbar-inner">
          <div class="lf-filter">
            <span class="lf-filter-label">対象月</span>
            <select id="landing-forecast-ym" onchange="LANDING_FORECAST_UI.render()">${months.map(m=>`<option value="${m}" ${m===ym?'selected':''}>${ymLabelLocal(m)}</option>`).join('')}</select>
          </div>
          <div class="lf-command-actions no-print">
            <button class="btn" onclick="LANDING_FORECAST_UI.printReport()">印刷 / PDF保存</button>
          </div>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi('営業収益 着地予測', cur.revenue, forecast.revenue, planRevenue)}
        ${kpi('粗利益 着地予測', cur.profit, forecast.profit, planProfit)}
        <div class="kpi-card"><div class="kpi-label">粗利率予測</div><div class="kpi-value">${pctLocal(forecast.profitRate)}</div><div class="kpi-sub-row"><span class="kpi-sub">現在 ${pctLocal(cur.profitRate)}</span></div><div class="kpi-sub-row"><span class="kpi-sub">最終入力 ${lastDate ? lastDate.replace(/-/g,'/') : '-'}</span></div></div>
        <div class="kpi-card"><div class="kpi-label">進捗率（BtoC補正）</div><div class="kpi-value">${pctLocal(forecast.progress*100)}</div><div class="kpi-sub-row"><span class="kpi-sub">単純予測との差 ${diffText}</span></div><div class="kpi-sub-row"><span class="kpi-sub">赤日・土日・月末を加味</span></div></div>
      </div>
      <div class="card lf-memo-card ${memoAlertClass}"><div class="card-header"><span class="card-title">判断メモ</span>${memoBadge}</div><div class="card-body" style="font-size:13px;line-height:1.9;color:var(--text)">${escLocal(warn)}<br><span class="lf-memo-note">単純日割ではなく、BtoC配送で伸びやすい土日祝・月末の残り日数を補正しています。</span></div></div>
      <div class="card" style="margin-bottom:14px"><div class="card-header"><span class="card-title">予測内訳</span></div><div class="card-body" style="overflow:auto"><table class="tbl"><thead><tr><th>区分</th><th class="r">現在</th><th class="r">単純予測</th><th class="r">BtoC補正予測</th></tr></thead><tbody>
        ${['revenue','labor','yosha','other','profit'].map(k=>{ const labels={revenue:'営業収益',labor:'人件費',yosha:'傭車費',other:'その他経費',profit:'粗利益'}; return `<tr><td>${labels[k]}</td><td class="r">${fmtKLocal(cur[k])}</td><td class="r">${fmtKLocal(simple ? simple[k] : 0)}</td><td class="r">${fmtKLocal(forecast[k])}</td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="card"><div class="card-header"><span class="card-title">日別実績</span></div><div class="card-body" style="overflow:auto"><table class="tbl"><thead><tr><th>日付</th><th class="r">営業収益</th><th class="r">人件費</th><th class="r">傭車費</th><th class="r">その他経費</th><th class="r">粗利益</th></tr></thead><tbody>${dailyRows}</tbody></table></div></div>`;
    }
  };
})();
