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
  // M2-5N: period detection is source-schema based. Never scan unrelated cells for date-like numbers.
  function parseCsvRows(text){
    const s=String(text||'').replace(/^\uFEFF/,''),rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<s.length;i++){
      const ch=s[i];
      if(quoted){if(ch==='"'&&s[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;continue;}
      if(ch==='"'){quoted=true;continue;}if(ch===','){row.push(cell);cell='';continue;}
      if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue;}cell+=ch;
    }
    if(cell!==''||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows;
  }
  function periodFromDateValue(v){
    const s=String(v??'').trim();if(!s)return null;let m;
    if((m=s.match(/^(20\d{2})(0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/)))return `${m[1]}${m[2]}`;
    if((m=s.match(/^(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/))){const mm=String(+m[2]).padStart(2,'0'),dd=+m[3];if(+mm>=1&&+mm<=12&&dd>=1&&dd<=31)return `${m[1]}${mm}`;}
    return null;
  }
  function filenamePeriod(name){const s=String(name||'');let m;if((m=s.match(/(?:^|\D)(20\d{2})[._\-]?(0[1-9]|1[0-2])(?:\D|$)/)))return `${m[1]}${m[2]}`;return null;}
  const DATE_COLUMNS={PL_CONFIRMED:['計上日'],WORKER_SALES:['配達完了日'],SHIPPER_AREA:['配達完了日'],ROUTE_PAYMENT:['配達日']};
  function periodsFromRows(rows,source){
    const h=(rows?.[0]||[]).map(v=>String(v??'').replace(/[\s　]/g,'')),names=DATE_COLUMNS[source]||[],i=h.findIndex(x=>names.includes(x));
    if(i<0)return [];
    const out=new Set();for(const r of (rows||[]).slice(1)){const p=periodFromDateValue(r?.[i]);if(p)out.add(p);}return [...out].sort();
  }
  function centerNameFromValues(vals){const s=(vals||[]).map(v=>String(v??'')).join('\n');if(/110203|北埼玉Ｃ|北埼玉C|北埼玉センター/.test(s))return '北埼玉センター';if(/戸田Ｃ|戸田C|戸田センター/.test(s))return '戸田センター';return '判定不能';}
  function centerFromText(t){return centerNameFromValues([t]);}
  function centerFromRows(rows,source){
    const h=(rows?.[0]||[]).map(v=>String(v??'').replace(/[\s　]/g,''));
    const names=source==='PL_CONFIRMED'?['計上支店コード','計上支店名']:source==='SHIPPER_AREA'?['配達支店コード','配達支店名']:source==='ROUTE_PAYMENT'?['配達支店コード','配達支店名','センターコード','センター名']:[];
    if(!names.length)return '判定不能';
    const idx=h.map((x,i)=>names.includes(x)?i:-1).filter(i=>i>=0),vals=[];for(const r of (rows||[]).slice(1,1000))for(const i of idx)vals.push(r?.[i]);return centerNameFromValues(vals);
  }
  function periodAudit(periods,fileName){const fp=filenamePeriod(fileName);if(!fp||periods.length!==1)return '';return fp===periods[0]?' / ファイル名年月と内部日付一致':` / 注意: ファイル名年月 ${fp.slice(0,4)}/${fp.slice(4)} と内部日付 ${periods[0].slice(0,4)}/${periods[0].slice(4)} が不一致`;}
  async function ensureXlsx(){if(window.XLSX)return window.XLSX;if(window.EXPORT_SERVICE?.ensureXLSX)await EXPORT_SERVICE.ensureXLSX();else if(window.ASSETS?.xlsx)await ASSETS.xlsx();if(!window.XLSX)throw new Error('XLSXライブラリを読み込めませんでした');return window.XLSX;}
  function routePaymentSignature(rows){const h=(rows?.[0]||[]).map(v=>String(v??'').replace(/[\s　]/g,''));return ['ヘッド番号','配達日','傭車料'].every(k=>h.some(x=>x.includes(k)));}
  async function analyzeExcelFile(f){const XLSX=await ensureXlsx(),wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:false}),found=[];for(const sheetName of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});if(!routePaymentSignature(rows))continue;found.push({rows,sheetName});}if(!found.length)return {source:'UNKNOWN',label:'判別不能',periods:[],center:'判定不能',confidence:'LOW',reason:'Excel内に既知SOURCEの列構成を確認できない'};const periods=new Set();found.forEach(x=>periodsFromRows(x.rows,'ROUTE_PAYMENT').forEach(p=>periods.add(p)));const ps=[...periods].sort(),center=centerFromRows(found[0].rows,'ROUTE_PAYMENT');return {source:'ROUTE_PAYMENT',label:'配達ヘッド傭車料確認',periods:ps,center,confidence:ps.length?'HIGH':'MEDIUM',reason:'Excel内部列 ヘッド番号・配達日・傭車料'+periodAudit(ps,f.name)};}
  async function analyzePdfFile(f){if(window.PLAN_PDF_IMPORT?.parseFile){try{const r=await PLAN_PDF_IMPORT.parseFile(f);return {source:'PLAN_BUDGET',label:'年度予算',periods:[],fiscalYear:String(r.fiscalYear),center:r.centerName||centerFromText(`${r.centerCode||''}`),confidence:'HIGH',reason:'PDF内部の年度・支店・主要予算科目をSKFL0001パーサーで確認'};}catch(e){}}return {source:'UNKNOWN',label:'判別不能PDF',periods:[],center:'判定不能',confidence:'LOW',reason:'既存PDFパーサーで既知SOURCEを確定できない'};}
  async function contentRegistered(source,ym){if(!ym||!Repository?.NormalizedSource?.loadManifest)return false;const type=source==='PL_CONFIRMED'?'PL_ACTUAL':source;try{const r=await Repository.NormalizedSource.loadManifest(type,ym);return !!r?.manifest?.current_batch_id;}catch(e){return false;}}
  function duplicateKey(r){if(!r||['UNKNOWN','ERROR','PENDING_PARSER','PL_DAILY_ACTUAL'].includes(r.source))return null;const ps=r.periods?.length===1?r.periods[0]:(r.fiscalYear?`FY${r.fiscalYear}`:null);return ps&&r.center&&r.center!=='判定不能'&&r.center!=='—'?`${r.source}|${ps}|${r.center}`:null;}
  // M2-5O: center supplementation uses only explicit evidence inside the same selected batch and same internal period.
  const INITIAL_MONTHLY_SOURCES=['PL_CONFIRMED','WORKER_SALES','SHIPPER_AREA','ROUTE_PAYMENT'];
  function supplementCenters(rows){
    const evidence=new Map();
    for(const r of rows){
      if(r.center==='判定不能'||r.center==='—'||r.periods?.length!==1||r.confidence!=='HIGH')continue;
      const ym=r.periods[0];if(!evidence.has(ym))evidence.set(ym,new Set());evidence.get(ym).add(r.center);
    }
    for(const r of rows){
      if(r.center!=='判定不能'||r.periods?.length!==1||['UNKNOWN','ERROR','PENDING_PARSER','PL_DAILY_ACTUAL'].includes(r.source))continue;
      const centers=[...(evidence.get(r.periods[0])||[])];
      if(centers.length!==1)continue;
      r.center=centers[0];r.centerSupplemented=true;
      r.status=String(r.status||'').replace(/・センター要確認/g,'');
      r.reason+=` / 同一投入バッチ・同一内部期間の明示センターから補完: ${centers[0]}`;
      if(r.confidence==='MEDIUM')r.confidence='HIGH';
    }
  }
  function monthlySetDiagnosis(rows){
    const months=[...new Set(rows.flatMap(r=>r.periods?.length===1?r.periods:[]))].sort(),out=[];
    for(const ym of months){
      const rs=rows.filter(r=>r.periods?.length===1&&r.periods[0]===ym),present=new Set(rs.map(r=>r.source));
      const missing=INITIAL_MONTHLY_SOURCES.filter(x=>!present.has(x));
      const centers=[...new Set(rs.map(r=>r.center).filter(x=>x&&x!=='判定不能'&&x!=='—'))];
      const duplicate=INITIAL_MONTHLY_SOURCES.filter(src=>rs.filter(r=>r.source===src).length>1);
      out.push({ym,present:[...present].filter(x=>INITIAL_MONTHLY_SOURCES.includes(x)),missing,centers,duplicate});
    }
    return out;
  }
  function monthlySetHtml(diag){
    if(!diag.length)return '';
    return `<div class="dih-foot"><b>月別資料セット診断</b> — 初期履歴用4SOURCE（PL_CONFIRMED / WORKER_SALES / SHIPPER_AREA / ROUTE_PAYMENT）の充足・重複を診断します。</div><div style="overflow:auto"><table class="data-table"><thead><tr><th>内部期間</th><th>センター</th><th>充足</th><th>不足SOURCE</th><th>重複候補</th></tr></thead><tbody>${diag.map(d=>`<tr><td>${esc(d.ym.slice(0,4)+'/'+d.ym.slice(4))}</td><td>${esc(d.centers.length===1?d.centers[0]:(d.centers.length?'複数センター':'判定不能'))}</td><td>${esc(d.present.length+'/'+INITIAL_MONTHLY_SOURCES.length)}</td><td>${esc(d.missing.length?d.missing.join(', '):'なし')}</td><td>${esc(d.duplicate.length?d.duplicate.join(', '):'なし')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  // M2-5P: registration readiness preview only. No persistence is performed.
  function registrationReadiness(rows){
    return rows.map(r=>{
      const reasons=[];
      const onePeriod=r.periods?.length===1;
      if(['UNKNOWN','ERROR','PENDING_PARSER','PL_DAILY_ACTUAL'].includes(r.source))reasons.push(r.source==='PL_DAILY_ACTUAL'?'初期履歴対象外SOURCE':'SOURCE未確定');
      if(!r.fiscalYear&&!onePeriod)reasons.push(r.periods?.length>1?'複数月':'内部期間不明');
      if(!r.fiscalYear&&(r.center==='判定不能'||r.center==='—'))reasons.push('センター未確定');
      if(String(r.status||'').includes('重複候補'))reasons.push('同一投入内の重複候補');
      if(String(r.status||'').includes('登録済'))reasons.push('既存CURRENTあり');
      if(r.confidence!=='HIGH')reasons.push('信頼度HIGH未満');
      return {...r,ready:reasons.length===0,blockReasons:reasons};
    });
  }
  function registrationPreviewHtml(items){
    const ready=items.filter(x=>x.ready),hold=items.filter(x=>!x.ready);
    return `<div class="dih-foot"><b>登録前プレビュー</b> — 自動登録可能候補と、人の確認が必要なファイルを分離します。ここでは保存しません。</div>
      <div class="dih-summary"><div><span>登録候補</span><b>${ready.length}件</b></div><div><span>要確認/除外</span><b>${hold.length}件</b></div><div><span>保存実行</span><b>0件</b></div><div><span>判定</span><b>PREVIEW</b></div></div>
      <div style="overflow:auto"><table class="data-table"><thead><tr><th>判定</th><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th><th>理由</th></tr></thead><tbody>${items.map(r=>`<tr><td><b>${r.ready?'登録候補':'要確認'}</b></td><td>${esc(r.file)}</td><td>${esc(r.source)}</td><td>${esc(r.fiscalYear?r.fiscalYear+'年度':(r.periods?.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—'))}</td><td>${esc(r.center)}${r.centerSupplemented?'（補完）':''}</td><td>${esc(r.ready?'SOURCE・期間・センター・信頼度・重複・既存CURRENTを確認済':r.blockReasons.join(' / '))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function analyzeInitialFiles(files){
    const arr=Array.from(files||[]);if(!arr.length)return;const result=document.getElementById('dih-content-result');if(result)result.innerHTML='<div class="dih-empty">内容を解析中…</div>';const rows=[];
    for(const f of arr){try{
      if(/\.(xls|xlsx)$/i.test(f.name)){const x=await analyzeExcelFile(f);rows.push({file:f.name,...x,status:x.source==='UNKNOWN'?'要確認':'判別'});continue;}
      if(/\.pdf$/i.test(f.name)){const x=await analyzePdfFile(f);rows.push({file:f.name,...x,status:x.source==='UNKNOWN'?'要確認':'判別'});continue;}
      if(/\.zip$/i.test(f.name)){rows.push({file:f.name,source:'PENDING_PARSER',label:'ZIP',periods:[],center:'—',confidence:'—',status:'要追加解析',reason:'ZIPは展開前のため内容SOURCEを確定しない'});continue;}
      if(!/\.csv$/i.test(f.name)){rows.push({file:f.name,source:'PENDING_PARSER',label:'未対応形式',periods:[],center:'—',confidence:'—',status:'要追加解析',reason:'対応形式外'});continue;}
      const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV,body=csv?.read?await csv.read(f):await f.text();let daily=false;
      try{const bridge=window.DAILY_ACCOUNTING_IMPORT_BRIDGE;if(bridge?.normalizeCsvText){const dr=bridge.normalizeCsvText(body,{file_name:''}),days=new Set((dr||[]).map(r=>r.accounting_date).filter(Boolean));if(dr?.length&&days.size>1&&contentClassify(body).source==='UNKNOWN')daily=true;}}catch(e){}
      if(daily){rows.push({file:f.name,source:'PL_DAILY_ACTUAL',label:'日次収支',periods:[...new Set((dr||[]).map(r=>r.year_month).filter(x=>/^\d{6}$/.test(x)))].sort(),center:'判定不能',confidence:'HIGH',status:'初期投入対象外',reason:'内容をSKDL0001日次構造として判定。当月運用SOURCEのため初期一括登録から除外'});continue;}
      const c=contentClassify(body),table=parseCsvRows(body),periods=periodsFromRows(table,c.source),center=centerFromRows(table,c.source);let status=c.source==='UNKNOWN'?'要確認':'判別';
      if(c.source!=='UNKNOWN'&&!periods.length)status+='・期間不明';if(periods.length>1)status+='・複数月';if(c.source!=='UNKNOWN'&&center==='判定不能')status+='・センター要確認';
      let registered=0;for(const ym of periods)if(await contentRegistered(c.source,ym))registered++;if(registered)status+=`・登録済${registered}月`;
      rows.push({file:f.name,source:c.source,label:c.label,periods,center,confidence:c.source!=='UNKNOWN'&&(!periods.length||center==='判定不能')?'MEDIUM':c.confidence,status,reason:c.reason+periodAudit(periods,f.name)});
    }catch(e){rows.push({file:f.name,source:'ERROR',label:'読取エラー',periods:[],center:'—',confidence:'LOW',status:'要確認',reason:e?.message||String(e)});}}
    supplementCenters(rows);
    const groups=new Map();for(const r of rows){const k=duplicateKey(r);if(k){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}}for(const g of groups.values())if(g.length>1)g.forEach(r=>{r.status+=(r.status?'・':'')+'重複候補';r.reason+=` / 同一SOURCE・期間・センター ${g.length}件`;});
    const diag=monthlySetDiagnosis(rows),preview=registrationReadiness(rows),unresolved=rows.filter(r=>['UNKNOWN','ERROR','PENDING_PARSER'].includes(r.source)).length,target=document.getElementById('dih-content-result');if(!target)return;
    target.innerHTML=`<div class="dih-summary"><div><span>選択</span><b>${rows.length}件</b></div><div><span>自動判別</span><b>${rows.length-unresolved}件</b></div><div><span>要確認/追加解析</span><b>${unresolved}件</b></div><div><span>保存</span><b>0件</b></div></div><div style="overflow:auto"><table class="data-table"><thead><tr><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th><th>信頼度</th><th>状態</th><th>判定根拠</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.file)}</td><td><b>${esc(r.source)}</b><br><small>${esc(r.label)}</small></td><td>${esc(r.fiscalYear?r.fiscalYear+'年度':(r.periods.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—'))}</td><td>${esc(r.center)}${r.centerSupplemented?'（補完）':''}</td><td>${esc(r.confidence)}</td><td>${esc(r.status)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div>${monthlySetHtml(diag)}${registrationPreviewHtml(preview)}<div class="dih-foot">診断・登録前プレビュー専用です。CURRENT・STATE・Cloudへの保存は行いません。ファイル名は判定根拠に使用していません。センター補完は同一投入バッチ・同一内部期間に明示センターが1種類だけ存在する場合に限定します。</div>`;
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
