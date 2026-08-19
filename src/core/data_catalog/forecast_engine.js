/* ============================================================================
   Version6 M2-4A: Forecast Engine
   ----------------------------------------------------------------------------
   着地予測の計算・履歴判定・バックテスト・採用モデル判定を行う純粋計算基盤。
   UI / STATE / Repository / Supabaseへ直接アクセスしない。

   原則
   - UNKNOWNを0へ変換しない。
   - 売上と費用を別metricとして予測可能にする。
   - 高度なモデルを優先せず、バックテスト誤差が小さいモデルを優先する。
   - 履歴不足時は既存固定ウェイトモデルを暫定採用する。
============================================================================ */
'use strict';
(function(){
  if(window.FORECAST_ENGINE) return;

  const VERSION=1;
  const METRICS=Object.freeze(['revenue','labor','yosha','other']);
  const MODEL=Object.freeze({
    LEGACY_WEIGHTED:'LEGACY_WEIGHTED',
    SIMPLE_RUN_RATE:'SIMPLE_RUN_RATE',
    HISTORICAL_PROGRESS:'HISTORICAL_PROGRESS',
    PRIOR_YEAR:'PRIOR_YEAR'
  });
  const clean=v=>String(v??'').trim();
  const arr=v=>Array.isArray(v)?v:[];
  const finite=v=>Number.isFinite(Number(v));
  const clone=v=>JSON.parse(JSON.stringify(v));

  function validateYM(ym){
    const s=clean(ym);
    if(!/^\d{6}$/.test(s)) throw new Error(`ym must be YYYYMM: ${s||'(empty)'}`);
    return s;
  }
  function daysInMonth(ym){return new Date(Number(ym.slice(0,4)),Number(ym.slice(4,6)),0).getDate();}
  function dateAt(ym,day){return `${ym.slice(0,4)}-${ym.slice(4,6)}-${String(day).padStart(2,'0')}`;}
  function dayOfWeek(date){return new Date(`${date}T00:00:00`).getDay();}
  function isMonthEnd(date){
    const ym=date.slice(0,7).replace('-',''),day=Number(date.slice(8,10));
    return day>=Math.max(1,daysInMonth(ym)-4);
  }
  function legacyWeightOfDate(date,options={}){
    const dow=dayOfWeek(date);
    let w=dow===0?1.38:dow===6?1.45:dow===5?1.12:dow===1?0.95:dow===2?0.86:dow===3?0.88:0.96;
    const holiday=typeof options.isHoliday==='function'&&options.isHoliday(date)===true;
    if(holiday) w=Math.max(w,1.55);
    if(isMonthEnd(date)) w*=1.18;
    return w;
  }
  function recordsThrough(records,cutoffDay){
    return arr(records).filter(r=>{
      const d=Number(String(r?.date||'').slice(8,10));
      return Number.isFinite(d)&&d<=cutoffDay;
    });
  }
  function hasUnknown(records,metric){
    return arr(records).some(r=>r?.hasUnknown===true&&(arr(r?.unknownCategories).includes(metric)||r?.[metric]==null));
  }
  function sumMetric(records,metric){
    if(hasUnknown(records,metric)) return null;
    let sum=0;
    for(const r of arr(records)){
      if(r?.[metric]==null||!finite(r[metric])) return null;
      sum+=Number(r[metric]);
    }
    return sum;
  }
  function lastObservedDay(records){
    const days=arr(records).map(r=>Number(String(r?.date||'').slice(8,10))).filter(Number.isFinite);
    return days.length?Math.max(...days):null;
  }
  function simpleRunRate(records,ym,metric,cutoffDay=null){
    validateYM(ym);
    const last=cutoffDay||lastObservedDay(records);
    if(!last) return null;
    const partial=recordsThrough(records,last),actual=sumMetric(partial,metric);
    if(actual==null) return null;
    const dim=daysInMonth(ym);
    return {model:MODEL.SIMPLE_RUN_RATE,metric,cutoff_day:last,actual,progress:last/dim,factor:dim/last,forecast:actual*(dim/last)};
  }
  function legacyWeighted(records,ym,metric,cutoffDay=null,options={}){
    validateYM(ym);
    const last=cutoffDay||lastObservedDay(records);
    if(!last) return null;
    const partial=recordsThrough(records,last),actual=sumMetric(partial,metric);
    if(actual==null) return null;
    const actualDates=new Set(partial.map(r=>String(r?.date||'')).filter(Boolean));
    let actualWeight=0,totalWeight=0;
    for(let d=1;d<=daysInMonth(ym);d++){
      const date=dateAt(ym,d),w=legacyWeightOfDate(date,options);
      totalWeight+=w;
      if(actualDates.has(date)) actualWeight+=w;
    }
    if(!(actualWeight>0&&totalWeight>0)) return null;
    const progress=actualWeight/totalWeight,factor=1/progress;
    return {model:MODEL.LEGACY_WEIGHTED,metric,cutoff_day:last,actual,progress,factor,forecast:actual*factor};
  }
  function monthTotal(records,metric){
    return sumMetric(records,metric);
  }
  function historicalProgress(history,metric,cutoffDay){
    const ratios=[];
    for(const h of arr(history)){
      if(h?.eligible===false||h?.confirmed===false) continue;
      const rows=arr(h?.records),total=monthTotal(rows,metric),partial=sumMetric(recordsThrough(rows,cutoffDay),metric);
      if(total==null||partial==null||total===0) continue;
      const ratio=partial/total;
      if(Number.isFinite(ratio)&&ratio>0) ratios.push({ym:h.ym,ratio});
    }
    if(!ratios.length) return null;
    const sorted=ratios.map(x=>x.ratio).sort((a,b)=>a-b);
    const mid=Math.floor(sorted.length/2);
    const median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
    return {sample_count:ratios.length,median_progress:median,samples:ratios};
  }
  function historicalProgressForecast(records,ym,metric,history,cutoffDay=null){
    validateYM(ym);
    const last=cutoffDay||lastObservedDay(records);
    if(!last) return null;
    const actual=sumMetric(recordsThrough(records,last),metric);
    if(actual==null) return null;
    const hp=historicalProgress(history,metric,last);
    if(!hp||!(hp.median_progress>0)) return null;
    return {model:MODEL.HISTORICAL_PROGRESS,metric,cutoff_day:last,actual,progress:hp.median_progress,factor:1/hp.median_progress,forecast:actual/hp.median_progress,sample_count:hp.sample_count,samples:hp.samples};
  }
  function priorYearForecast(records,ym,metric,priorYear,cutoffDay=null){
    validateYM(ym);
    const last=cutoffDay||lastObservedDay(records);
    if(!last||!priorYear||priorYear.confirmed===false) return null;
    const actual=sumMetric(recordsThrough(records,last),metric);
    const pyRows=arr(priorYear.records),pyTotal=monthTotal(pyRows,metric),pyPartial=sumMetric(recordsThrough(pyRows,last),metric);
    if(actual==null||pyTotal==null||pyPartial==null||pyTotal===0||pyPartial===0) return null;
    const progress=pyPartial/pyTotal;
    if(!(progress>0)) return null;
    return {model:MODEL.PRIOR_YEAR,metric,cutoff_day:last,actual,progress,factor:1/progress,forecast:actual/progress,reference_ym:priorYear.ym||null};
  }
  function absolutePctError(forecast,actual){
    if(!finite(forecast)||!finite(actual)||Number(actual)===0) return null;
    return Math.abs((Number(forecast)-Number(actual))/Number(actual))*100;
  }
  function backtestModel(model,history,metric,cutoffDays=[7,14,21],options={}){
    const errors=[],cases=[];
    for(let i=0;i<arr(history).length;i++){
      const target=history[i];
      if(target?.eligible===false||target?.confirmed===false) continue;
      const actual=monthTotal(target.records,metric);
      if(actual==null||actual===0) continue;
      const training=history.slice(0,i).filter(x=>x?.eligible!==false&&x?.confirmed!==false);
      for(const cutoffDay of cutoffDays){
        let result=null;
        if(model===MODEL.LEGACY_WEIGHTED) result=legacyWeighted(target.records,target.ym,metric,cutoffDay,options);
        else if(model===MODEL.SIMPLE_RUN_RATE) result=simpleRunRate(target.records,target.ym,metric,cutoffDay);
        else if(model===MODEL.HISTORICAL_PROGRESS) result=historicalProgressForecast(target.records,target.ym,metric,training,cutoffDay);
        else if(model===MODEL.PRIOR_YEAR){
          const py=history.find(x=>String(x?.ym||'')===String(Number(target.ym.slice(0,4))-1)+target.ym.slice(4,6));
          result=priorYearForecast(target.records,target.ym,metric,py,cutoffDay);
        }
        if(!result||!finite(result.forecast)) continue;
        const ape=absolutePctError(result.forecast,actual);
        if(ape==null) continue;
        errors.push(ape); cases.push({ym:target.ym,cutoff_day:cutoffDay,forecast:result.forecast,actual,ape});
      }
    }
    const mape=errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null;
    return {model,metric,case_count:errors.length,mape,cases};
  }
  function historyTier(sampleCount){
    if(sampleCount>=12) return {tier:'SEASONAL_READY',confidence:'HIGH'};
    if(sampleCount>=6) return {tier:'BACKTEST_READY',confidence:'MEDIUM'};
    if(sampleCount>=3) return {tier:'REFERENCE_ONLY',confidence:'LOW'};
    return {tier:'INSUFFICIENT',confidence:'LOW'};
  }
  function chooseModel(backtests,historyCount){
    const tier=historyTier(historyCount);
    const usable=arr(backtests).filter(x=>x&&x.mape!=null&&x.case_count>0);
    if(historyCount<6){
      return {model:MODEL.LEGACY_WEIGHTED,reason:historyCount<3?'履歴が3か月未満のため固定ウェイトを暫定採用':'履歴は参考可能だが6か月未満のため固定ウェイトを暫定採用',...tier};
    }
    const ranked=usable.sort((a,b)=>a.mape-b.mape);
    if(!ranked.length) return {model:MODEL.LEGACY_WEIGHTED,reason:'バックテスト可能ケースが不足しているため固定ウェイトを暫定採用',...tier};
    return {model:ranked[0].model,reason:`バックテストMAPE最小 ${ranked[0].mape.toFixed(2)}%`,mape:ranked[0].mape,...tier};
  }
  function evaluate({current,history=[],priorYear=null,metric='revenue',cutoffDay=null,cutoffDays=[7,14,21],calendar={}}={}){
    if(!current?.ym) throw new Error('current.ym is required');
    const eligibleHistory=arr(history).filter(x=>x?.eligible!==false&&x?.confirmed!==false);
    const candidates=[
      legacyWeighted(current.records,current.ym,metric,cutoffDay,calendar),
      simpleRunRate(current.records,current.ym,metric,cutoffDay),
      historicalProgressForecast(current.records,current.ym,metric,eligibleHistory,cutoffDay),
      priorYearForecast(current.records,current.ym,metric,priorYear,cutoffDay)
    ].filter(Boolean);
    const models=[MODEL.LEGACY_WEIGHTED,MODEL.SIMPLE_RUN_RATE,MODEL.HISTORICAL_PROGRESS,MODEL.PRIOR_YEAR];
    const backtests=models.map(m=>backtestModel(m,eligibleHistory,metric,cutoffDays,calendar));
    const selection=chooseModel(backtests,eligibleHistory.length);
    const selected=candidates.find(x=>x.model===selection.model)||candidates[0]||null;
    return {schema_version:VERSION,metric,history_count:eligibleHistory.length,selection,selected,candidates,backtests};
  }

  window.FORECAST_ENGINE=Object.freeze({
    VERSION,METRICS,MODEL,legacyWeightOfDate,simpleRunRate,legacyWeighted,
    historicalProgress,historicalProgressForecast,priorYearForecast,
    absolutePctError,backtestModel,historyTier,chooseModel,evaluate
  });
})();
