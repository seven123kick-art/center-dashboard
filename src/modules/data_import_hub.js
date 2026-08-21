/* Version6 D3-16: Data Catalog unified import hub */
'use strict';
(function(){
  if(window.__DATA_IMPORT_HUB_LOADED_20260817__)return; window.__DATA_IMPORT_HUB_LOADED_20260817__=true;
  const DOCS=[
    {id:'PLAN_BUDGET',label:'年度予算',code:'SKFL0001',scope:'年度',action:'plan'},
    {id:'PL_DAILY_ACTUAL',label:'日次収支・着地予測実績',code:'SKDL0001',scope:'年月',action:'daily'},
    {id:'PL_PRELIMINARY',repo:'PL_ACTUAL',label:'月次収支 速報',code:'SKDL0002',scope:'年月',state:'PRELIMINARY',action:'prelim'},
    {id:'PL_CONFIRMED',repo:'PL_ACTUAL',label:'月次収支 確定',code:'SKDL0003',scope:'年月',state:'CONFIRMED',action:'confirmed'},
    {id:'WORKER_SALES',label:'作業者別売上明細',code:'WORKER_SALES',scope:'年月',action:'worker'},
    {id:'SHIPPER_AREA',label:'荷主別配送エリア物量',code:'SHIPPER_AREA',scope:'年月',action:'shipper'},
    {id:'DELIVERY_LIST',label:'配達持出予定リスト',code:'DELIVERY_LIST',scope:'配達日',action:'delivery'},
    {id:'ROUTE_PAYMENT',label:'配達ヘッド傭車料確認',code:'ROUTE_PAYMENT',scope:'年月',action:'payment'}
  ];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const period=v=>String(v||'').replace('-','');
  function fyOf(p){const y=+p.slice(0,4),m=+p.slice(4);return String(m>=4?y:y-1)}

  const CONTENT_SIGNATURES=[
    {source:'PL_CONFIRMED',label:'月次収支 確定',required:['計上会社','計上本部','計上支店','計上日','収支科目','金額'],reason:'計上会社・計上本部・計上支店・計上日・収支科目・金額'},
    {source:'WORKER_SALES',label:'作業者別売上明細',required:['配達完了日','原票番号','協力会社名','作業者','作業内容','単価','数量','金額'],reason:'配達完了日・原票番号・協力会社名・作業者・作業内容・単価・数量・金額'},
    {source:'SHIPPER_AREA',label:'荷主別配送エリア物量',required:['配達完了日','荷主コード','配達支店'],any:['住所','郵便番号','お届け先'],reason:'配達完了日・荷主コード・配達支店＋住所系列'}
  ];
  function contentClassify(t){const s=String(t||'');for(const x of CONTENT_SIGNATURES){if(x.required.every(k=>s.includes(k))&&(!x.any||x.any.some(k=>s.includes(k))))return {...x,confidence:'HIGH'};}return {source:'UNKNOWN',label:'判別不能',reason:'既知SOURCEの必須列構成に一致しない',confidence:'LOW'};}
  function contentPeriods(t){const s=String(t||'').replace(/\r/g,''),out=new Set(),rx=/(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/g;let m;while((m=rx.exec(s))){const mm=String(+m[2]).padStart(2,'0');if(+mm>=1&&+mm<=12)out.add(`${m[1]}${mm}`);}return [...out].sort();}
  function contentCenter(t){const s=String(t||'');if(/110203|北埼玉Ｃ|北埼玉C|北埼玉センター/.test(s))return '北埼玉センター';if(/戸田Ｃ|戸田C|戸田センター/.test(s))return '戸田センター';return '判定不能';}
  async function contentRegistered(source,ym){if(!ym||!Repository?.NormalizedSource?.loadManifest)return false;const type=source==='PL_CONFIRMED'?'PL_ACTUAL':source;try{const r=await Repository.NormalizedSource.loadManifest(type,ym);return !!r?.manifest?.current_batch_id;}catch(e){return false;}}
  async function analyzeInitialFiles(files){
    const arr=Array.from(files||[]);if(!arr.length)return;const result=document.getElementById('dih-content-result');if(result)result.innerHTML='<div class="dih-empty">内容を解析中…</div>';const rows=[];
    for(const f of arr){
      if(!/\.csv$/i.test(f.name)){rows.push({file:f.name,source:'PENDING_PARSER',label:'非CSV',periods:[],center:'—',confidence:'—',status:'要追加解析',reason:'PDF・XLS・XLSX・ZIPは次Phaseで既存専用パーサーへ接続'});continue;}
      try{
        const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV,body=csv?.read?await csv.read(f):await f.text();let daily=false;
        try{const bridge=window.DAILY_ACCOUNTING_IMPORT_BRIDGE;if(bridge?.normalizeCsvText){const dr=bridge.normalizeCsvText(body,{file_name:''}),days=new Set((dr||[]).map(r=>r.accounting_date).filter(Boolean));if(dr?.length&&days.size>1&&contentClassify(body).source==='UNKNOWN')daily=true;}}catch(e){}
        if(daily){rows.push({file:f.name,source:'PL_DAILY_ACTUAL',label:'日次収支',periods:contentPeriods(body),center:contentCenter(body),confidence:'HIGH',status:'初期投入対象外',reason:'内容をSKDL0001日次構造として判定。当月運用SOURCEのため初期一括登録から除外'});continue;}
        const c=contentClassify(body),periods=contentPeriods(body),center=contentCenter(body);let status=c.source==='UNKNOWN'?'要確認':'判別';if(periods.length>1)status+='・複数月';let registered=0;for(const ym of periods)if(await contentRegistered(c.source,ym))registered++;if(registered)status+=`・登録済${registered}月`;
        rows.push({file:f.name,source:c.source,label:c.label,periods,center,confidence:c.confidence,status,reason:c.reason});
      }catch(e){rows.push({file:f.name,source:'ERROR',label:'読取エラー',periods:[],center:'—',confidence:'LOW',status:'要確認',reason:e?.message||String(e)});}
    }
    const unresolved=rows.filter(r=>['UNKNOWN','ERROR','PENDING_PARSER'].includes(r.source)).length,target=document.getElementById('dih-content-result');if(!target)return;
    target.innerHTML=`<div class="dih-summary"><div><span>選択</span><b>${rows.length}件</b></div><div><span>自動判別</span><b>${rows.length-unresolved}件</b></div><div><span>要確認/追加解析</span><b>${unresolved}件</b></div><div><span>保存</span><b>0件</b></div></div><div style="overflow:auto"><table class="data-table"><thead><tr><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th><th>信頼度</th><th>状態</th><th>判定根拠</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.file)}</td><td><b>${esc(r.source)}</b><br><small>${esc(r.label)}</small></td><td>${esc(r.periods.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—')}</td><td>${esc(r.center)}</td><td>${esc(r.confidence)}</td><td>${esc(r.status)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div><div class="dih-foot">診断専用です。CURRENT・STATE・Cloudへの保存は行いません。ファイル名は判定根拠に使用していません。</div>`;
  }
  function chooseInitialFiles(){const input=document.createElement('input');input.type='file';input.accept='.csv,.pdf,.xls,.xlsx,.zip';input.multiple=true;input.addEventListener('change',()=>analyzeInitialFiles(input.files),{once:true});input.click();}
  function contentDiagnosticHtml(){return `<section style="margin-bottom:16px;padding:14px;border:1px solid var(--border2);border-radius:12px;background:var(--surface1)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><b style="font-size:14px">初期データ 自動判別</b><div style="font-size:11px;color:var(--text3);margin-top:3px">中身から資料種別・年月・センターを診断します。まだ登録はしません。</div></div><button type="button" class="btn" onclick="DATA_IMPORT_HUB.chooseInitialFiles()">ファイルをまとめて選択</button></div><div id="dih-content-result" style="margin-top:12px"></div></section>`;}

  function syncLegacy(p){if(!/^\d{6}$/.test(p))return;const y=+p.slice(0,4),m=+p.slice(4),fy=m>=4?y:y-1;
    const pre=document.getElementById('preliminary-pl-month');if(pre)pre.value=`${p.slice(0,4)}-${p.slice(4)}`;
    [['field-worker-fy-select','field-worker-month-select'],['field-product-fy-select','field-product-month-select']].forEach(([a,b])=>{const A=document.getElementById(a),B=document.getElementById(b);if(A)A.value=String(fy);if(B)B.value=String(m);A?.dispatchEvent(new Event('change',{bubbles:true}));B?.dispatchEvent(new Event('change',{bubbles:true}));});
    const py=document.getElementById('plan-year-sel');if(py)py.value=String(fy);
  }
  async function importDaily(files,p){
    const arr=Array.from(files||[]).filter(f=>/\.csv$/i.test(f.name));
    if(!arr.length){window.UI?.toast?.('SKDL0001 CSVを選択してください','warn');return;}
    const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV;
    const bridge=window.DAILY_ACCOUNTING_IMPORT_BRIDGE;
    if(!csv?.read||!bridge?.normalizeCsvText||!bridge?.persistRecords){window.UI?.toast?.('日次SOURCE取込基盤を読み込めません','error');return;}
    const byYM=new Map(),names=new Map();let days=0;const logs=[];
    for(const f of arr){
      try{
        const text=await csv.read(f),rows=bridge.normalizeCsvText(text,{file_name:f.name});
        if(!rows.length)throw new Error('日別集計できる行がありません');
        const periods=[...new Set(rows.map(r=>r.year_month).filter(Boolean))];
        if(periods.some(x=>x!==p))throw new Error(`選択年月 ${p} とCSV対象年月 ${periods.join(',')} が一致しません`);
        rows.forEach(r=>{if(!byYM.has(r.year_month))byYM.set(r.year_month,[]);byYM.get(r.year_month).push(r);if(!names.has(r.year_month))names.set(r.year_month,new Set());names.get(r.year_month).add(f.name);});
        days+=new Set(rows.map(r=>r.accounting_date).filter(Boolean)).size;
        logs.push(`OK ${f.name}`);
      }catch(e){logs.push(`NG ${f.name}: ${e?.message||e}`);}
    }
    for(const [ym,rows] of byYM){
      const saved=await bridge.persistRecords(rows,{period:ym,source_file_names:[...(names.get(ym)||[])]});
      if(!saved?.ok)throw new Error(saved?.error||`${ym} の保存に失敗しました`);
    }
    await refresh();
    window.LANDING_FORECAST_UI?.render?.();
    window.UI?.toast?.(`SKDL0001を${days}日分取り込みました${logs.some(x=>x.startsWith('NG'))?'（一部NGあり）':''}`,logs.some(x=>x.startsWith('NG'))?'warn':undefined);
  }
  function choose(kind){
    const p=period(document.getElementById('data-import-hub-month')?.value);
    if(!/^\d{6}$/.test(p)){window.UI?.toast?.('対象年月を選択してください','warn');return;}
    syncLegacy(p);
    if(kind==='daily'){
      const input=document.createElement('input');input.type='file';input.accept='.csv';input.multiple=true;
      input.addEventListener('change',()=>importDaily(input.files,p),{once:true});input.click();return;
    }
    const ids={plan:'plan-pdf-file-input',prelim:'preliminary-pl-file',confirmed:'file-input',worker:'field-worker-file-input',shipper:'field-product-file-input',delivery:'route-pdf-file-input',payment:'route-head-payment-file-input'};
    const input=document.getElementById(ids[kind]); if(!input)return;
    input.value='';
    if(kind==='plan')input.addEventListener('change',async()=>{if(!input.files?.length)return;await window.PLAN_PDF_IMPORT?.importSelected?.();await refresh();},{once:true});
    else if(kind==='prelim')input.addEventListener('change',async()=>{if(!input.files?.length)return;await window.DATA_IMPORT_MANAGEMENT?.importPreliminary?.();await refresh();},{once:true});
    else if(kind==='confirmed')input.addEventListener('change',()=>{if(!input.files?.length)return;document.querySelectorAll('input[name="manual-import-type"]').forEach(r=>{r.checked=r.value==='confirmed';});},{once:true});
    input.click();
  }
  async function statusFor(d,p){
    if(d.id==='PLAN_BUDGET'){const fy=fyOf(p),x=window.STATE?.planData?.[fy];if(!x)return {status:'MISSING',text:'未登録',detail:`${fy}年度`};const cov=x.coverage||x.sourceMeta?.coverage||'UNKNOWN';return {status:'CURRENT',text:cov==='FIRST_HALF_ONLY'?'上期策定済':'登録済',detail:`${fy}年度 · ${x.sourceMeta?.source_type||'SOURCE'}`};}
    if(!window.Repository?.NormalizedSource?.loadManifest)return {status:'UNKNOWN',text:'確認不能',detail:'Repository未読込'};
    const type=d.repo||d.id,r=await Repository.NormalizedSource.loadManifest(type,p),m=r?.manifest||{},bs=Array.isArray(m.batches)?m.batches:[],cur=bs.find(x=>x.batch_id===m.current_batch_id);
    if(!cur)return {status:'MISSING',text:'未登録',detail:'CURRENTなし',revisions:bs.length};
    if(type==='PL_ACTUAL'){const c=await Repository.NormalizedSource.loadCurrent(type,p),st=c?.records?.[0]?.document_state||'UNKNOWN';if(d.state&&st!==d.state)return {status:d.state==='PRELIMINARY'&&st==='CONFIRMED'?'SUPERSEDED':'MISSING',text:st==='CONFIRMED'?'確定済':'未登録',detail:`CURRENT=${st}`,revisions:bs.length};return {status:'CURRENT',text:st,detail:`${cur.record_count??'—'}行`,revisions:bs.length};}
    return {status:'CURRENT',text:'CURRENT',detail:`${cur.record_count??'—'}行`,revisions:bs.length};
  }
  async function refresh(){const host=document.getElementById('data-import-hub-root');if(!host)return;const p=period(document.getElementById('data-import-hub-month')?.value);if(!/^\d{6}$/.test(p)){host.innerHTML='<div class="dih-empty">対象年月を選択してください。</div>';return;}syncLegacy(p);host.innerHTML='<div class="dih-empty">登録状態を確認中…</div>';const rows=[];for(const d of DOCS){try{rows.push([d,await statusFor(d,p)])}catch(e){rows.push([d,{status:'ERROR',text:'確認エラー',detail:e?.message||String(e)}])}}
    const missing=rows.filter(([,s])=>s.status==='MISSING').length,errors=rows.filter(([,s])=>s.status==='ERROR').length;
    host.innerHTML=contentDiagnosticHtml()+`<div class="dih-summary"><div><span>対象</span><b>${esc(p.slice(0,4))}年${esc(String(+p.slice(4)))}月</b></div><div><span>主要SOURCE</span><b>${DOCS.length}</b></div><div><span>未登録</span><b>${missing}</b></div><div><span>確認エラー</span><b>${errors}</b></div></div><div class="dih-grid">${rows.map(([d,s])=>`<article class="dih-source"><div class="dih-source-top"><div><small>${esc(d.code)}</small><h3>${esc(d.label)}</h3></div><span class="dih-status is-${esc(s.status.toLowerCase())}">${esc(s.text)}</span></div><div class="dih-meta"><span>単位：${esc(d.scope)}</span><span>${esc(s.detail||'')}</span>${s.revisions!=null?`<span>Revision ${esc(s.revisions)}</span>`:''}</div><div class="dih-actions"><button type="button" class="btn" onclick="DATA_IMPORT_HUB.choose('${esc(d.action)}')">${s.status==='MISSING'?'ファイルを選択':'差替・改訂を取込'}</button>${s.revisions>1?`<button type="button" class="btn dih-history-btn" onclick="DATA_IMPORT_HUB.showHistory('${esc(d.repo||d.id)}')">履歴</button>`:''}</div><div class="dih-history-panel" data-history-type="${esc(d.repo||d.id)}" hidden></div></article>`).join('')}</div><div class="dih-foot">CURRENT・RevisionはNormalized Source Repositoryを正本として表示します。SKDL0001は着地予測用の日次SOURCE、SKDL0003は後日確定する月次正本として別管理します。</div>`;
  }
  async function showHistory(type){const p=period(document.getElementById('data-import-hub-month')?.value),panel=document.querySelector(`[data-history-type="${CSS.escape(type)}"]`);if(!panel||!/^\d{6}$/.test(p))return;panel.hidden=!panel.hidden;if(panel.hidden)return;if(type==='PLAN_BUDGET'){panel.innerHTML='<div class="dih-history-empty">予算は現在の年度計画を表示しています。</div>';return;}try{const r=await Repository.NormalizedSource.loadManifest(type,p),bs=Array.isArray(r?.manifest?.batches)?r.manifest.batches.slice().reverse():[];panel.innerHTML=bs.length?bs.map(b=>`<div><b>${esc(b.revision_status||'—')}</b><span>${esc(b.record_count??'—')}行</span><span>${esc(b.saved_at||'')}</span></div>`).join(''):'<div class="dih-history-empty">履歴はありません。</div>';}catch(e){panel.innerHTML=`<div class="dih-history-empty">${esc(e?.message||String(e))}</div>`;}}
  function init(){const m=document.getElementById('data-import-hub-month');if(m&&!m.value){const now=new Date(),y=now.getFullYear(),mm=String(now.getMonth()+1).padStart(2,'0');m.value=`${y}-${mm}`;}m?.addEventListener('change',refresh);refresh();window.addEventListener('normalized-source-updated',refresh);}
  document.addEventListener('DOMContentLoaded',init);
  window.DATA_IMPORT_HUB=Object.freeze({refresh,choose,showHistory,chooseInitialFiles,analyzeInitialFiles});
})();
