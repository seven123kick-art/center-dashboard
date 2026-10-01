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
  let initialImportSession=null;
  let initialImportSaving=false;
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
  async function analyzePdfFile(f){
    // 配達持出予定リストは便別採算と同じ実績パーサーを共通利用する。
    // ファイル名や画面の対象年月では判定せず、PDF内部の配達日・ヘッド番号を根拠にする。
    if(window.ROUTE_ANALYSIS_UI?.parseDeliveryPdf){
      try{
        const routes=await ROUTE_ANALYSIS_UI.parseDeliveryPdf(f);
        const periods=[...new Set((routes||[]).map(r=>datePeriod(r?.date)).filter(x=>/^\d{6}$/.test(x)))].sort();
        const valid=(routes||[]).filter(r=>r?.date&&r?.headNumber);
        if(valid.length&&periods.length){
          return {source:'DELIVERY_LIST',label:'配達持出予定リスト',periods,center:'判定不能',confidence:'HIGH',reason:`PDF内部の配達日・ヘッド番号を確認（${valid.length}便）`};
        }
      }catch(e){}
    }
    if(window.PLAN_PDF_IMPORT?.parseFile){try{const r=await PLAN_PDF_IMPORT.parseFile(f);return {source:'PLAN_BUDGET',label:'年度予算',periods:[],fiscalYear:String(r.fiscalYear),center:r.centerName||centerFromText(`${r.centerCode||''}`),confidence:'HIGH',reason:'PDF内部の年度・支店・主要予算科目をSKFL0001パーサーで確認'};}catch(e){}}
    return {source:'UNKNOWN',label:'判別不能PDF',periods:[],center:'判定不能',confidence:'LOW',reason:'既存PDFパーサーで既知SOURCEを確定できない'};
  }
  async function contentRegistered(source,ym){if(!ym||!Repository?.NormalizedSource?.loadManifest)return false;const type=source==='PL_CONFIRMED'?'PL_ACTUAL':source;try{const r=await Repository.NormalizedSource.loadManifest(type,ym);return !!r?.manifest?.current_batch_id;}catch(e){return false;}}
  function duplicateKey(r){if(!r||['UNKNOWN','ERROR','PENDING_PARSER','PL_DAILY_ACTUAL','DELIVERY_LIST'].includes(r.source))return null;const ps=r.periods?.length===1?r.periods[0]:(r.fiscalYear?`FY${r.fiscalYear}`:null);return ps&&r.center&&r.center!=='判定不能'&&r.center!=='—'?`${r.source}|${ps}|${r.center}`:null;}
  // M2-5O: center supplementation uses only explicit evidence inside the same selected batch and same internal period.
  const INITIAL_MONTHLY_SOURCES=['PL_CONFIRMED','WORKER_SALES','SHIPPER_AREA','DELIVERY_LIST','ROUTE_PAYMENT'];
  function supplementCenters(rows){
    const activeCenter=String(window.CENTER?.name||'').trim();
    if(!activeCenter)return rows;

    for(const r of rows){
      const detected=String(r.center||'').trim();
      const unresolved=!detected||detected==='判定不能'||detected==='—';

      // ファイル内部でセンターが判定できている場合は、それを最優先する。
      if(!unresolved){
        if(detected!==activeCenter){
          r.centerConflict=true;
          r.status=`${r.status||''}・センター不一致`;
          r.reason=`${r.reason||''} / ファイル内センター ${detected} と選択中センター ${activeCenter} が不一致`;
        }
        continue;
      }

      // センター列を持たない月次SOURCEは、このセンター画面の選択値を登録先にする。
      // UNKNOWN/ERROR/PENDING_PARSERには適用しない。
      if(INITIAL_MONTHLY_SOURCES.includes(r.source)){
        r.center=activeCenter;
        r.centerConfidence='SELECTED_CENTER';
        r.centerFallback=true;
        if(r.confidence==='MEDIUM' && Array.isArray(r.periods) && r.periods.length)r.confidence='HIGH';
        r.status=`${r.status||''}・選択センター`;
        r.reason=`${r.reason||''} / ファイル内センター情報なし→選択中センター ${activeCenter} を使用`;
      }
    }
    return rows;
  }
  function expandMonthlyRegistrationCandidates(rows){
    const expanded=[];
    for(const r of rows){
      if(!INITIAL_MONTHLY_SOURCES.includes(r.source)||!Array.isArray(r.periods)||!r.periods.length){
        expanded.push({...r});
        continue;
      }
      for(const ym of r.periods){
        expanded.push({
          ...r,
          periods:[ym],
          sourcePeriods:[...r.periods],
          splitFromMultiMonth:r.periods.length>1,
          status:`${r.status||''}${r.periods.length>1?'・月別分割':''}`,
          reason:`${r.reason||''}${r.periods.length>1?` / 内部日付から ${ym.slice(0,4)}/${ym.slice(4)} を月別登録候補化`:''}`
        });
      }
    }
    supplementCenters(expanded);
    // DELIVERY_LISTは日別PDFが複数ファイルになるため、同一月・同一センターを
    // 1つの月次SOURCE候補へ統合する。重複排除は保存時に配達日+ヘッド番号で行う。
    const deliveryGroups=new Map(),out=[];
    for(const r of expanded){
      if(r.source!=='DELIVERY_LIST'){out.push(r);continue;}
      const ym=r.periods?.[0],key=`${ym}|${r.center||''}`;
      if(!deliveryGroups.has(key)){
        deliveryGroups.set(key,{...r,_files:[],files:[],file:''});
      }
      const g=deliveryGroups.get(key);
      if(r._file)g._files.push(r._file);
      if(r.file)g.files.push(r.file);
    }
    for(const g of deliveryGroups.values()){
      g.file=g.files.join('、');
      g.status=`${g.status||''}・月次統合`;
      g.reason=`${g.reason||''} / DELIVERY_LIST ${g.files.length}ファイルを同月SOURCEへ統合`;
      out.push(g);
    }
    return out;
  }

  function monthlySetDiagnosis(rows){
    const byMonth=new Map();
    for(const r of rows||[]){
      if(!INITIAL_MONTHLY_SOURCES.includes(r.source))continue;
      for(const ym of (r.periods||[])){
        if(!/^\d{6}$/.test(String(ym)))continue;
        if(!byMonth.has(ym))byMonth.set(ym,{ym,items:[],present:[],missing:[],duplicate:[],centers:[]});
        byMonth.get(ym).items.push(r);
      }
    }
    const out=[];
    for(const d of byMonth.values()){
      const sourceCounts=new Map();
      const centers=new Set();
      for(const r of d.items){
        sourceCounts.set(r.source,(sourceCounts.get(r.source)||0)+1);
        if(r.center&&r.center!=='判定不能'&&r.center!=='—')centers.add(r.center);
      }
      d.present=INITIAL_MONTHLY_SOURCES.filter(x=>sourceCounts.has(x));
      d.missing=INITIAL_MONTHLY_SOURCES.filter(x=>!sourceCounts.has(x));
      d.duplicate=[...sourceCounts.entries()].filter(([,n])=>n>1).map(([x])=>x);
      d.centers=[...centers];
      out.push(d);
    }
    return out.sort((a,b)=>a.ym.localeCompare(b.ym));
  }

  function monthlySetHtml(diag){
    if(!diag?.length)return '';
    const incomplete=diag.filter(x=>x.missing?.length||x.duplicate?.length);
    const duplicates=diag.filter(x=>x.duplicate?.length);
    const cards=diag.map(x=>`<div class="dih-month-card ${x.duplicate?.length?'is-warn':''}"><b>${esc(x.ym.slice(0,4)+'/'+x.ym.slice(4))}</b><span>${esc(x.centers?.join(' / ')||'センター未確定')}</span><small>${x.present.length}/${INITIAL_MONTHLY_SOURCES.length}・不足 ${x.missing.length}・重複 ${x.duplicate.length}</small></div>`).join('');
    return `<section class="dih-month-set"><div class="dih-result-heading"><b>月別資料セット</b><span>${duplicates.length?'重複あり '+duplicates.length+'か月':('対象 '+diag.length+'か月 / 資料不足は参考表示')}</span></div><div class="dih-month-grid">${cards}</div>${incomplete.length?`<details class="dih-detail-toggle"><summary>資料不足・重複の詳細 ${incomplete.length}か月</summary><div class="dih-detail-body">${incomplete.map(x=>`<div class="dih-month-detail"><b>${esc(x.ym.slice(0,4)+'/'+x.ym.slice(4))}</b><span>不足: ${esc(x.missing.join(', ')||'なし')}</span><span>重複: ${esc(x.duplicate.join(', ')||'なし')}</span></div>`).join('')}</div></details>`:''}</section>`;
  }

  function registrationReadiness(rows){
    const activeCenter=String(window.CENTER?.name||'').trim();
    return rows.map(r=>{
      const reasons=[];
      const onePeriod=r.periods?.length===1;
      if(!INITIAL_MONTHLY_SOURCES.includes(r.source))reasons.push(r.source==='PL_DAILY_ACTUAL'?'初期履歴対象外SOURCE':'初期履歴一括登録対象外SOURCE');
      if(['UNKNOWN','ERROR','PENDING_PARSER'].includes(r.source))reasons.push('SOURCE未確定');
      if(!r.fiscalYear&&!onePeriod)reasons.push('内部期間不明');
      if(r.centerConflict)reasons.push(`選択中センター不一致（${activeCenter}）`);
      else if(!r.fiscalYear&&(r.center==='判定不能'||r.center==='—'))reasons.push('センター未確定');
      if(!r.centerConflict&&onePeriod&&activeCenter&&r.center!=='判定不能'&&r.center!=='—'&&r.center!==activeCenter)reasons.push(`選択中センター不一致（${activeCenter}）`);
      if(String(r.status||'').includes('重複候補'))reasons.push('同一投入内の重複候補');
      // 既存CURRENTは登録時にその月だけSKIPし、他月の一括登録は止めない。
      if(r.confidence!=='HIGH')reasons.push('信頼度HIGH未満');
      return {...r,ready:reasons.length===0,blockReasons:[...new Set(reasons)]};
    });
  }
  async function enrichDeliveryPreview(items){
    for(const item of items||[]){
      if(item.source!=='DELIVERY_LIST'||!item.ready)continue;
      try{
        const records=await buildInitialRecords(item);
        item.previewRouteCount=records.length;
        item.previewSlipCount=new Set(records.flatMap(r=>r.slip_numbers||r.slips||[]).filter(Boolean)).size;
        item.previewFileCount=item._files?.length||item.files?.length||1;
      }catch(e){item.previewError=e?.message||String(e);}
    }
    return items;
  }
  function previewExtra(r){
    if(r.source!=='DELIVERY_LIST')return '';
    if(r.previewError)return `<br><small>事前集計エラー: ${esc(r.previewError)}</small>`;
    return `<br><small>${fmt(r.previewFileCount||0)}ファイル / 解析便数 ${fmt(r.previewRouteCount||0)}便 / 原票数 ${fmt(r.previewSlipCount||0)}件</small>`;
  }

  function registrationPreviewHtml(items){
    const ready=items.filter(x=>x.ready),hold=items.filter(x=>!x.ready);
    const action=ready.length?`<div class="dih-register-action"><div><strong>${ready.length}件の月別SOURCEを登録できます</strong><span>複数月ファイルは内部日付で月別分割します。既存CURRENTはその月だけスキップし、他の未登録月は続けて保存します。</span></div><button type="button" class="btn btn-primary" id="dih-initial-register-btn" onclick="DATA_IMPORT_HUB.registerInitialReady()">この登録候補を保存する</button></div>`:'';
    return `<section class="dih-result-section"><div class="dih-result-heading"><b>登録前プレビュー</b><span>実行ボタンを押すまで保存しません</span></div><div class="dih-summary"><div><span>登録候補</span><b>${ready.length}件</b></div><div><span>要確認/除外</span><b>${hold.length}件</b></div><div><span>保存実行</span><b>0件</b></div><div><span>判定</span><b>PREVIEW</b></div></div>${action}<div id="dih-initial-register-status" class="dih-register-status"></div>${hold.length?`<div class="dih-result-scroll"><table class="data-table"><thead><tr><th>判定</th><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th><th>理由</th></tr></thead><tbody>${hold.map(r=>`<tr><td><span class="dih-result-badge is-hold">要確認</span></td><td>${esc(r.file)}</td><td>${esc(r.source)}</td><td>${esc(r.fiscalYear?r.fiscalYear+'年度':(r.periods?.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—'))}</td><td>${esc(r.center)}${r.centerSupplemented?'（補完）':''}</td><td>${esc(r.blockReasons.join(' / '))}</td></tr>`).join('')}</tbody></table></div>`:`<div class="dih-empty">要確認ファイルはありません。</div>`}<details class="dih-detail-toggle"><summary>登録候補 ${ready.length}件を確認</summary><div class="dih-detail-body"><div class="dih-result-scroll"><table class="data-table"><thead><tr><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th></tr></thead><tbody>${ready.map(r=>`<tr><td>${esc(r.file)}${previewExtra(r)}</td><td>${esc(r.source)}</td><td>${esc(r.fiscalYear?r.fiscalYear+'年度':(r.periods?.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—'))}</td><td>${esc(r.center)}${r.centerSupplemented?'（補完）':''}</td></tr>`).join('')}</tbody></table></div></div></details></section>`;
  }

  function initialBatchId(documentType,ym){
    const suffix=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')
      ?globalThis.crypto.randomUUID().replace(/-/g,'')
      :`${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    return `${String(documentType||'SOURCE').toUpperCase()}_${ym}_${suffix}`;
  }
  function datePeriod(v){
    const s=String(v||'').replace(/\D/g,'');
    return s.length>=6?s.slice(0,6):'';
  }
  async function readCsvText(file){
    const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV;
    return csv?.read?await csv.read(file):await file.text();
  }
  async function buildInitialRecords(item){
    const file=item?._file,ym=item?.periods?.[0],centerId=window.CENTER?.id||null;
    if(!file)throw new Error('選択ファイルの参照を保持できません。もう一度ファイルを選択してください。');
    if(!/^\d{6}$/.test(String(ym||'')))throw new Error('対象年月を確定できません。');
    if(!centerId)throw new Error('選択中センターIDを確認できません。');
    if(item.center!==window.CENTER?.name)throw new Error(`選択中センターと診断センターが一致しません（${item.center||'未確定'}）。`);
    let records=[];
    if(item.source==='PL_CONFIRMED'){
      if(!window.ACCOUNTING_IMPORT_BRIDGE?.normalizeCsvText)throw new Error('月次収支の正規化基盤を読み込めません。');
      const text=await readCsvText(file);
      records=ACCOUNTING_IMPORT_BRIDGE.normalizeCsvText(text,{period:ym,document_state:'CONFIRMED',file_name:file.name});
    }else if(item.source==='WORKER_SALES'||item.source==='SHIPPER_AREA'){
      const normalizer=item.source==='WORKER_SALES'?window.SOURCE_NORMALIZER?.normalizeWorkerSalesRows:window.SOURCE_NORMALIZER?.normalizeShipperAreaRows;
      if(!normalizer)throw new Error(`${item.source} の正規化基盤を読み込めません。`);
      const text=await readCsvText(file),csv=(typeof CSV!=='undefined'&&CSV)||window.CSV;
      if(!csv?.toRows)throw new Error('CSV行解析基盤を読み込めません。');
      records=normalizer(csv.toRows(text),{file_name:file.name,year_month:null,center_id:centerId});
    }else if(item.source==='DELIVERY_LIST'){
      if(!window.ROUTE_ANALYSIS_UI?.parseDeliveryPdf||!window.SOURCE_NORMALIZER?.normalizeDeliveryListRoutes)throw new Error('DELIVERY_LISTのPDF解析基盤を読み込めません。');
      const files=(item._files?.length?item._files:[file]).filter(Boolean);
      const merged=new Map();
      for(const pdf of files){
        const routes=await ROUTE_ANALYSIS_UI.parseDeliveryPdf(pdf);
        const normalized=SOURCE_NORMALIZER.normalizeDeliveryListRoutes(routes,{file_name:pdf.name,center_id:centerId});
        for(const rec of normalized){
          const key=`${rec.delivery_date||''}|${rec.head_number||rec.headNumber||''}`;
          if(!merged.has(key))merged.set(key,rec);
          else{
            const prev=merged.get(key);
            const slips=[...new Set([...(prev.slip_numbers||prev.slips||[]),...(rec.slip_numbers||rec.slips||[])])];
            merged.set(key,{...prev,...rec,slip_numbers:slips});
          }
        }
      }
      records=[...merged.values()];
    }else if(item.source==='ROUTE_PAYMENT'){
      if(!window.SOURCE_NORMALIZER?.normalizeRoutePaymentRows)throw new Error('ROUTE_PAYMENTの正規化基盤を読み込めません。');
      const XLSX=await ensureXlsx(),wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
      for(const sheetName of wb.SheetNames){
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});
        if(!routePaymentSignature(rows))continue;
        records.push(...SOURCE_NORMALIZER.normalizeRoutePaymentRows(rows,{file_name:`${file.name}#${sheetName}`,year_month:null,center_id:centerId}));
      }
    }else throw new Error(`初期履歴一括登録の対象外SOURCEです: ${item.source}`);
    if(!records.length)throw new Error('正規化レコードを1件も作成できませんでした。');
    const wrongType=records.find(r=>item.source==='PL_CONFIRMED'?r?.document_type!=='PL_ACTUAL':r?.document_type!==item.source);
    if(wrongType)throw new Error('正規化後のdocument_typeが診断結果と一致しません。');
    const dateKey=item.source==='PL_CONFIRMED'?'accounting_date':'delivery_date';

    if(item.source!=='PL_CONFIRMED'){
      const dated=records.filter(r=>datePeriod(r?.[dateKey]));
      const selected=dated.filter(r=>datePeriod(r[dateKey])===ym).map(r=>({...r,year_month:ym}));
      if(!selected.length)throw new Error(`内部日付に ${ym.slice(0,4)}年${Number(ym.slice(4))}月 のレコードがありません。`);
      return selected;
    }

    const wrongYm=records.find(r=>r?.year_month&&r.year_month!==ym);
    if(wrongYm)throw new Error(`正規化後の対象年月が一致しません（${wrongYm.year_month}）。`);
    const wrongDate=records.find(r=>r?.[dateKey]&&datePeriod(r[dateKey])&&datePeriod(r[dateKey])!==ym);
    if(wrongDate)throw new Error(`内部日付が対象年月と一致しません（${wrongDate[dateKey]}）。`);
    return records;
  }
  async function persistInitialCandidate(item){
    const ym=item?.periods?.[0],repoType=item.source==='PL_CONFIRMED'?'PL_ACTUAL':item.source;
    if(!window.Repository?.NormalizedSource?.loadManifest||!window.Repository?.NormalizedSource?.saveBatch)throw new Error('Normalized Source Repositoryを読み込めません。');
    const records=await buildInitialRecords(item);
    const before=await Repository.NormalizedSource.loadManifest(repoType,ym);
    if(before?.manifest?.current_batch_id)return {ok:false,skipped:true,error:'CURRENT_ALREADY_EXISTS',current_batch_id:before.manifest.current_batch_id};
    if(item.source==='PL_CONFIRMED'){
      if(!window.ACCOUNTING_IMPORT_BRIDGE?.persistRecords)throw new Error('月次収支の保存基盤を読み込めません。');
      return ACCOUNTING_IMPORT_BRIDGE.persistRecords(records,{period:ym,document_state:'CONFIRMED',source_file_names:[item.file]});
    }
    return Repository.NormalizedSource.saveBatch({
      document_type:repoType,period:ym,batch_id:initialBatchId(repoType,ym),
      source_file_id:null,source_file_name:item.source==='DELIVERY_LIST'?'DELIVERY_LIST_MONTHLY_MERGED':item.file,records,
      meta:{source_file_names:item.files?.length?item.files:[item.file],imported_at:new Date().toISOString(),usage:'INITIAL_HISTORY_IMPORT'}
    });
  }
  function setInitialRegisterStatus(html,cls=''){
    const el=document.getElementById('dih-initial-register-status');
    if(el){el.className=`dih-register-status ${cls}`;el.innerHTML=html||'';}
  }
  async function runBounded(items,limit,worker,onProgress){
    const rows=Array.isArray(items)?items:[],out=new Array(rows.length);
    let cursor=0,done=0;
    const runners=Array.from({length:Math.min(Math.max(1,limit||1),rows.length)},async()=>{
      while(true){
        const idx=cursor++;
        if(idx>=rows.length)return;
        try{out[idx]=await worker(rows[idx],idx);}catch(error){out[idx]={kind:'failed',error};}
        done++;try{onProgress?.(done,rows.length,out[idx],idx);}catch(_e){}
      }
    });
    await Promise.all(runners);return out;
  }
  async function registerInitialReady(){
    if(initialImportSaving)return;
    const session=initialImportSession,items=(session?.preview||[]).filter(x=>x.ready);
    if(!session||!items.length){window.UI?.toast?.('登録候補がありません。もう一度ファイルを解析してください。','warn');return;}
    const activeCenter=window.CENTER?.name||'';
    if(items.some(x=>x.center!==activeCenter)){window.UI?.toast?.('選択中センターと一致しない登録候補があります。登録を中止しました。','error');return;}
    if(!window.confirm(`${activeCenter}の初期履歴 ${items.length}件を登録します。\n既存CURRENTは上書きしません。\nNormalized Source Repository / Cloudへ保存します。よろしいですか？`))return;
    initialImportSaving=true;
    const btn=document.getElementById('dih-initial-register-btn');if(btn)btn.disabled=true;
    showImportProgress(`初期履歴 ${items.length}件`,'','保存前の最終検証をしています…');
    const results=[],affected=new Set();let saved=0,skipped=0,failed=0;
    try{
      // PREVIEW時点で内容・SOURCE・期間・センターを検証済み。
      // 保存直前に全ファイルを再正規化すると大容量CSVを二重解析するため、
      // ここではセッション/センター整合性だけを確認し、各候補は保存処理内で1回だけ正規化する。
      if(session.center_id!==(window.CENTER?.id||null)||session.center_name!==(window.CENTER?.name||null)){
        throw new Error('解析後に選択中センターが変更されています。もう一度ファイルを解析してください。');
      }
      updateImportProgress('Normalized Source / Cloudへ登録しています…');
      const saveResults=await runBounded(items,3,async(item)=>{
        const r=await persistInitialCandidate(item);
        if(r?.ok)return {kind:'saved',item,result:r};
        if(r?.error==='CURRENT_ALREADY_EXISTS')return {kind:'skipped',item,result:r};
        return {kind:'failed',item,error:new Error(r?.error||'保存結果を確認できません')};
      },(done,total,r)=>{
        const item=r?.item;
        setInitialRegisterStatus('<strong>'+done+'/'+total+'</strong> '+esc(item?.periods?.[0]||'')+' '+esc(item?.source||'')+' Cloud登録完了','is-running');
        updateImportProgress('Cloud登録 '+done+'/'+total+'件 完了…');
      });
      saveResults.forEach((r,idx)=>{
        const item=r?.item||items[idx];
        if(r?.kind==='saved'){saved++;affected.add(item.periods[0]);results.push({item,status:'保存済',detail:(r.result?.record_count??'—')+'行'});}
        else if(r?.kind==='skipped'){skipped++;results.push({item,status:'スキップ',detail:'実行時点で既存CURRENTを確認'});}
        else{failed++;results.push({item,status:'失敗',detail:r?.error?.message||String(r?.error||'保存結果を確認できません')});}
      });
      const materializeErrors=[];
      if(window.CANONICAL_MATERIALIZER?.materialize){
        for(const ym of [...affected].sort()){
          try{await CANONICAL_MATERIALIZER.materialize({period:ym});}
          catch(e){materializeErrors.push(`${ym}: ${e?.message||e}`);}
        }
      }else if(affected.size){
        materializeErrors.push('Canonical再構築基盤を読み込めません。SOURCE保存済みデータはデータ確認画面で再構築してください。');
      }
      const resultHtml=`<div class="dih-register-result"><strong>初期履歴登録結果</strong><span>保存 ${saved}件 / スキップ ${skipped}件 / 失敗 ${failed}件${materializeErrors.length?` / 再構築エラー ${materializeErrors.length}か月`:''}</span></div>${(failed||skipped||materializeErrors.length)?`<details class="dih-detail-toggle" open><summary>登録結果の詳細</summary><div class="dih-detail-body"><div class="dih-result-scroll"><table class="data-table"><thead><tr><th>結果</th><th>年月</th><th>SOURCE</th><th>ファイル</th><th>詳細</th></tr></thead><tbody>${results.filter(x=>x.status!=='保存済').map(x=>`<tr><td>${esc(x.status)}</td><td>${esc(x.item.periods?.[0]||'')}</td><td>${esc(x.item.source)}</td><td>${esc(x.item.file)}</td><td>${esc(x.detail)}</td></tr>`).join('')}${materializeErrors.map(x=>`<tr><td>再構築</td><td colspan="4">${esc(x)}</td></tr>`).join('')}</tbody></table></div></div></details>`:''}`;
      setInitialRegisterStatus(resultHtml,failed?'is-error':'is-ok');
      const savedMonths=[...new Set(results.filter(x=>x.status==='保存済').map(x=>x.item?.periods?.[0]).filter(Boolean))].sort();
      const skippedMonths=[...new Set(results.filter(x=>x.status==='スキップ').map(x=>x.item?.periods?.[0]).filter(Boolean))].sort();
      const monthText=a=>a.map(x=>`${x.slice(0,4)}/${x.slice(4)}`).join('、');
      if(failed)finishImportProgress(false,`一括取込：保存 ${saved}月SOURCE / 既存CURRENTスキップ ${skipped}件 / 失敗 ${failed}件。詳細は画面内の登録結果を確認してください。`);
      else finishImportProgress(true,`一括取込完了：保存 ${saved}月SOURCE${savedMonths.length?`（${monthText(savedMonths)}）`:''} / 既存CURRENTスキップ ${skipped}件${skippedMonths.length?`（${monthText(skippedMonths)}）`:''} / 失敗 0件`);
      await refresh();
    }catch(e){
      setInitialRegisterStatus(`<div class="dih-register-result"><strong>登録中止</strong><span>${esc(e?.message||String(e))}</span></div>`,'is-error');
      finishImportProgress(false,e?.message||String(e));
    }finally{
      initialImportSaving=false;
      const nextBtn=document.getElementById('dih-initial-register-btn');if(nextBtn)nextBtn.disabled=false;
    }
  }

  async function analyzeInitialFiles(files){
    const arr=Array.from(files||[]);if(!arr.length)return;
    showImportProgress(`まとめて選択 ${arr.length}ファイル`,'','ファイル内容・資料種別・内部期間を解析しています…');
    const result=document.getElementById('dih-content-result');if(result)result.innerHTML='<div class="dih-empty">内容を解析中…</div>';const rows=[];
    for(const f of arr){try{
      if(/\.(xls|xlsx)$/i.test(f.name)){const x=await analyzeExcelFile(f);rows.push({_file:f,file:f.name,...x,status:x.source==='UNKNOWN'?'要確認':'判別'});continue;}
      if(/\.pdf$/i.test(f.name)){const x=await analyzePdfFile(f);rows.push({_file:f,file:f.name,...x,status:x.source==='UNKNOWN'?'要確認':'判別'});continue;}
      if(/\.zip$/i.test(f.name)){rows.push({_file:f,file:f.name,source:'PENDING_PARSER',label:'ZIP',periods:[],center:'—',confidence:'—',status:'要追加解析',reason:'ZIPは展開前のため内容SOURCEを確定しない'});continue;}
      if(!/\.csv$/i.test(f.name)){rows.push({_file:f,file:f.name,source:'PENDING_PARSER',label:'未対応形式',periods:[],center:'—',confidence:'—',status:'要追加解析',reason:'対応形式外'});continue;}
      const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV,body=csv?.read?await csv.read(f):await f.text();
      const c=contentClassify(body);
      // 既知SOURCEはここで確定する。日次収支パーサーはUNKNOWN時だけfallback実行し、
      // WORKER_SALES等の大容量CSVを二重正規化しない。
      if(c.source==='UNKNOWN'){
        let dr=null,daily=false;
        try{
          const bridge=window.DAILY_ACCOUNTING_IMPORT_BRIDGE;
          if(bridge?.normalizeCsvText){
            dr=bridge.normalizeCsvText(body,{file_name:''});
            const days=new Set((dr||[]).map(r=>r.accounting_date).filter(Boolean));
            daily=!!(dr?.length&&days.size>1);
          }
        }catch(e){}
        if(daily){rows.push({_file:f,file:f.name,source:'PL_DAILY_ACTUAL',label:'日次収支',periods:[...new Set((dr||[]).map(r=>r.year_month).filter(x=>/^\d{6}$/.test(x)))].sort(),center:'判定不能',confidence:'HIGH',status:'初期投入対象外',reason:'内容をSKDL0001日次構造として判定。当月運用SOURCEのため初期一括登録から除外'});continue;}
      }
      const table=parseCsvRows(body),periods=periodsFromRows(table,c.source),center=centerFromRows(table,c.source);let status=c.source==='UNKNOWN'?'要確認':'判別';
      if(c.source!=='UNKNOWN'&&!periods.length)status+='・期間不明';if(periods.length>1)status+='・複数月';if(c.source!=='UNKNOWN'&&center==='判定不能')status+='・センター要確認';
      rows.push({_file:f,file:f.name,source:c.source,label:c.label,periods,center,confidence:c.source!=='UNKNOWN'&&(!periods.length||center==='判定不能')?'MEDIUM':c.confidence,status,reason:c.reason+periodAudit(periods,f.name)});
    }catch(e){rows.push({_file:f,file:f.name,source:'ERROR',label:'読取エラー',periods:[],center:'—',confidence:'LOW',status:'要確認',reason:e?.message||String(e)});}}
    supplementCenters(rows);
    const groups=new Map();for(const r of rows){const k=duplicateKey(r);if(k){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}}for(const g of groups.values())if(g.length>1)g.forEach(r=>{r.status+=(r.status?'・':'')+'重複候補';r.reason+=` / 同一SOURCE・期間・センター ${g.length}件`;});
    const diag=monthlySetDiagnosis(rows),expanded=expandMonthlyRegistrationCandidates(rows),preview=registrationReadiness(expanded);await enrichDeliveryPreview(preview);const unresolved=rows.filter(r=>['UNKNOWN','ERROR','PENDING_PARSER'].includes(r.source)).length,target=document.getElementById('dih-content-result');if(!target)return;
    initialImportSession={files:arr,rows,expanded,preview,analyzed_at:new Date().toISOString(),center_id:window.CENTER?.id||null,center_name:window.CENTER?.name||null};
    target.innerHTML=`<div class="dih-summary"><div><span>選択</span><b>${rows.length}件</b></div><div><span>自動判別</span><b>${rows.length-unresolved}件</b></div><div><span>要確認/追加解析</span><b>${unresolved}件</b></div><div><span>保存</span><b>0件</b></div></div>${monthlySetHtml(diag)}${registrationPreviewHtml(preview)}<details class="dih-detail-toggle"><summary>全ファイルの技術判定 ${rows.length}件</summary><div class="dih-detail-body"><div class="dih-result-scroll dih-technical-table"><table class="data-table"><thead><tr><th>元ファイル</th><th>SOURCE</th><th>内部期間</th><th>センター</th><th>信頼度</th><th>状態</th><th>判定根拠</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.file)}</td><td><b>${esc(r.source)}</b><small>${esc(r.label)}</small></td><td>${esc(r.fiscalYear?r.fiscalYear+'年度':(r.periods.length?r.periods.map(x=>x.slice(0,4)+'/'+x.slice(4)).join(', '):'—'))}</td><td>${esc(r.center)}${r.centerSupplemented?'（補完）':''}</td><td>${esc(r.confidence)}</td><td>${esc(r.status)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div></div></details><div class="dih-foot">診断・登録前プレビュー専用です。CURRENT・STATE・Cloudへの保存は行いません。ファイル名は判定根拠に使用していません。センター情報がない月次SOURCEは選択中センターを使用し、ファイル内部に別センターが明示されている場合は不一致として停止します。</div>`;
    const ready=preview.filter(x=>x.ready).length,hold=preview.length-ready;
    const deliverySummary=preview.filter(x=>x.ready&&x.source==='DELIVERY_LIST').map(x=>`DELIVERY_LIST ${x.periods?.[0]?.slice(0,4)}/${x.periods?.[0]?.slice(4)}：${fmt(x.previewFileCount||0)}ファイル / 解析便数 ${fmt(x.previewRouteCount||0)}便 / 原票数 ${fmt(x.previewSlipCount||0)}件`).join('\n');
    finishInitialAnalysis(`選択 ${rows.length}件 / 自動判別 ${rows.length-unresolved}件 / 登録候補 ${ready}件 / 要確認・除外 ${hold+unresolved}件${deliverySummary?'\n'+deliverySummary:''}\nまだ保存していません。`,ready);
  }
  function chooseInitialFiles(){const input=document.createElement('input');input.type='file';input.accept='.csv,.pdf,.xls,.xlsx,.zip';input.multiple=true;input.addEventListener('change',()=>analyzeInitialFiles(input.files).catch(e=>finishImportProgress(false,e?.message||String(e))),{once:true});input.click();}
  function contentDiagnosticHtml(){return `<section style="margin-bottom:16px;padding:14px;border:1px solid var(--border2);border-radius:12px;background:var(--surface1)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><b style="font-size:14px">まとめて投入（自動仕分け）</b><div style="font-size:11px;color:var(--text3);margin-top:3px">資料種類を自動判別し、複数月ファイルは内部日付で月別に分割します。下の各カードは対象月への個別投入です。</div></div><button type="button" class="btn" onclick="DATA_IMPORT_HUB.chooseInitialFiles()">ファイルをまとめて選択</button></div><div id="dih-content-result" style="margin-top:12px"></div></section>`;}

  function syncLegacy(p){if(!/^\d{6}$/.test(p))return;const y=+p.slice(0,4),m=+p.slice(4),fy=m>=4?y:y-1,mm=String(m).padStart(2,'0');
    const pre=document.getElementById('preliminary-pl-month');if(pre)pre.value=`${p.slice(0,4)}-${p.slice(4)}`;
    [['field-worker-fy-select','field-worker-month-select'],['field-product-fy-select','field-product-month-select']].forEach(([a,b])=>{const A=document.getElementById(a),B=document.getElementById(b);if(A)A.value=String(fy);if(B)B.value=mm;A?.dispatchEvent(new Event('change',{bubbles:true}));B?.dispatchEvent(new Event('change',{bubbles:true}));});
    const py=document.getElementById('plan-year-sel');if(py)py.value=String(fy);
  }
  async function importDaily(files,p){
    const arr=Array.from(files||[]).filter(f=>/\.csv$/i.test(f.name));
    if(!arr.length)throw new Error('SKDL0001 CSVを選択してください');
    const csv=(typeof CSV!=='undefined'&&CSV)||window.CSV,bridge=window.DAILY_ACCOUNTING_IMPORT_BRIDGE;
    if(!csv?.read||!bridge?.normalizeCsvText||!bridge?.persistRecords)throw new Error('日次SOURCE取込基盤を読み込めません');
    const validated=[],byYM=new Map(),names=new Map();let days=0;
    for(const f of arr){
      const text=await csv.read(f),rows=bridge.normalizeCsvText(text,{file_name:f.name});
      if(!rows.length)throw new Error(`${f.name}: 日別集計できる行がありません`);
      const periods=[...new Set(rows.map(r=>r.year_month).filter(Boolean))].sort();
      if(periods.length!==1||periods[0]!==p){
        const actual=periods.length?periods.map(x=>`${x.slice(0,4)}年${Number(x.slice(4))}月`).join('、'):'判定不能';
        throw new Error(`${f.name}: CSV内部日付は ${actual} です。画面の対象年月 ${p.slice(0,4)}年${Number(p.slice(4))}月 と一致しないため保存を中止しました。`);
      }
      validated.push({f,rows});
    }
    for(const {f,rows} of validated){
      rows.forEach(r=>{if(!byYM.has(r.year_month))byYM.set(r.year_month,[]);byYM.get(r.year_month).push(r);if(!names.has(r.year_month))names.set(r.year_month,new Set());names.get(r.year_month).add(f.name);});
      days+=new Set(rows.map(r=>r.accounting_date).filter(Boolean)).size;
    }
    for(const [ym,rows] of byYM){
      const saved=await bridge.persistRecords(rows,{period:ym,source_file_names:[...(names.get(ym)||[])]});
      if(!saved?.ok)throw new Error(saved?.error||`${ym} の保存に失敗しました`);
    }
    await refresh();window.LANDING_FORECAST_UI?.render?.();
    return {ok:true,count:arr.length,days};
  }

  let importBusy=false;
  function importProgressEl(){
    let el=document.getElementById('data-import-progress');
    if(el)return el;
    el=document.createElement('div');el.id='data-import-progress';el.className='data-import-progress';el.hidden=true;
    el.innerHTML=`<div class="data-import-progress__panel" role="status" aria-live="polite">
      <div class="data-import-progress__spinner"></div>
      <div class="data-import-progress__result-icon" aria-hidden="true"></div>
      <div class="data-import-progress__title">データを読み込んでいます</div>
      <div class="data-import-progress__source"></div>
      <div class="data-import-progress__month"></div>
      <div class="data-import-progress__bar"><span></span></div>
      <div class="data-import-progress__step">ファイルを確認しています…</div>
      <div class="data-import-progress__result"></div>
      <div class="data-import-progress__note">完了するまでこの画面のままお待ちください。</div>
      <button type="button" class="data-import-progress__close">確認</button>
    </div>`;
    el.querySelector('.data-import-progress__close').addEventListener('click',()=>{
      const btn=el.querySelector('.data-import-progress__close');
      const action=btn?.dataset?.action||'close';
      if(action==='register-initial'){
        hideImportProgress(true);
        btn.dataset.action='close';
        btn.textContent='確認';
        window.setTimeout(()=>registerInitialReady(),0);
        return;
      }
      hideImportProgress(true);
    });
    document.body.appendChild(el);return el;
  }
  function showImportProgress(label,p,step){
    const el=importProgressEl();importBusy=true;
    el.classList.remove('is-success','is-error');
    const closeBtn=el.querySelector('.data-import-progress__close');if(closeBtn){closeBtn.dataset.action='close';closeBtn.textContent='確認';}
    el.querySelector('.data-import-progress__title').textContent='データを読み込んでいます';
    el.querySelector('.data-import-progress__source').textContent=label;
    el.querySelector('.data-import-progress__month').textContent=/^\d{6}$/.test(p)?`${p.slice(0,4)}年${Number(p.slice(4))}月`:/^\d{4}$/.test(String(p||''))?`${p}年度`:'';
    el.querySelector('.data-import-progress__step').textContent=step||'ファイルを読み込んでいます…';
    el.querySelector('.data-import-progress__result').textContent='';
    el.querySelector('.data-import-progress__note').textContent='完了するまでこの画面のままお待ちください。';
    el.hidden=false;document.documentElement.classList.add('data-import-busy');
  }
  function updateImportProgress(step){const el=document.getElementById('data-import-progress');if(el&&!el.hidden)el.querySelector('.data-import-progress__step').textContent=step;}
  function finishImportProgress(ok,message){
    const el=importProgressEl();importBusy=false;
    el.classList.add(ok?'is-success':'is-error');
    el.classList.remove(ok?'is-error':'is-success');
    el.querySelector('.data-import-progress__title').textContent=ok?'データ取込が完了しました':'データを取り込めませんでした';
    el.querySelector('.data-import-progress__step').textContent=ok?'登録状態を更新しました':'取込処理を完了できませんでした';
    el.querySelector('.data-import-progress__result').textContent=message||'';
    el.querySelector('.data-import-progress__note').textContent=ok?'内容を確認して「確認」を押してください。':'内容を確認してから再度お試しください。';
    document.documentElement.classList.remove('data-import-busy');
  }
  function finishInitialAnalysis(message,readyCount){
    const el=importProgressEl();importBusy=false;
    el.classList.add('is-success');el.classList.remove('is-error');
    el.querySelector('.data-import-progress__title').textContent='登録前の解析が完了しました';
    el.querySelector('.data-import-progress__step').textContent=`登録候補 ${readyCount}件を確認しました`;
    el.querySelector('.data-import-progress__result').textContent=message||'';
    el.querySelector('.data-import-progress__note').textContent=readyCount?'下のボタンを押すとNormalized Source Repository / Cloudへ保存します。':'登録できる候補はありません。';
    const btn=el.querySelector('.data-import-progress__close');
    if(btn){
      btn.dataset.action=readyCount?'register-initial':'close';
      btn.textContent=readyCount?`${readyCount}件を登録する`:'確認';
    }
    document.documentElement.classList.remove('data-import-busy');
  }
  function hideImportProgress(force){
    if(importBusy&&!force)return;
    importBusy=false;const el=document.getElementById('data-import-progress');if(el)el.hidden=true;
    document.documentElement.classList.remove('data-import-busy');
  }
  function choose(kind){
    const p=period(document.getElementById('data-import-hub-month')?.value);
    if(!/^\d{6}$/.test(p)){window.UI?.toast?.('対象年月を選択してください','warn');return;}
    syncLegacy(p);
    if(kind==='daily'){
      const input=document.createElement('input');input.type='file';input.accept='.csv';input.multiple=true;
      input.addEventListener('change',async()=>{if(!input.files?.length)return;showImportProgress('日次収支・着地予測実績',p,'CSV内部日付を確認しています…');try{const r=await importDaily(input.files,p);finishImportProgress(true,`日次収支 / ${p.slice(0,4)}年${Number(p.slice(4))}月 / ${r.days}日分を登録しました`);}catch(e){finishImportProgress(false,e?.message||String(e));}},{once:true});input.click();return;
    }
    if(kind==='worker'||kind==='shipper'){
      const input=document.createElement('input');input.type='file';input.accept='.csv';input.multiple=true;
      input.addEventListener('change',async()=>{
        if(!input.files?.length)return;
        if(importBusy){window.UI?.toast?.('データ取込処理中です','warn');return;}
        const label=kind==='worker'?'作業者別売上明細':'荷主別配送エリア物量';
        showImportProgress(label,p,'ファイルを読み込んでいます…');
        window.DATA_IMPORT_HUB_MODAL_ACTIVE=true;
        try{
          updateImportProgress('ファイル内容と対象年月を確認しています…');
          if(kind==='worker'){
            if(!window.FIELD_WORKER_IMPORT2?.handleFilesForYM)throw new Error('作業者別CSV取込基盤を読み込めません');
            await FIELD_WORKER_IMPORT2.handleFilesForYM(input.files,p);
          }else{
            if(!window.FIELD_PRODUCT_IMPORT2?.handleFilesForYM)throw new Error('荷主別配送エリア物量取込基盤を読み込めません');
            await FIELD_PRODUCT_IMPORT2.handleFilesForYM(input.files,p);
          }
          updateImportProgress('登録状態を更新しています…');
          await refresh();
          finishImportProgress(true,`${label} / ${/^\d{6}$/.test(p)?`${p.slice(0,4)}年${Number(p.slice(4))}月`:p} / クラウド・正規化SOURCEの登録状態を更新しました`);
        }catch(e){
          const msg=e?.message||String(e);
          finishImportProgress(false,msg);
        }finally{
          window.DATA_IMPORT_HUB_MODAL_ACTIVE=false;
        }
      },{once:true});
      input.click();return;
    }
    if(kind==='plan'){
      const fy=fyOf(p);
      window.DATA_MANAGEMENT_NAV?.go?.('import');
      window.setTimeout(()=>{
        const area=document.getElementById('plan-paste-area');
        const details=area?.closest('details');if(details)details.open=true;
        const year=document.getElementById('plan-year-sel');if(year)year.value=fy;
        area?.scrollIntoView?.({behavior:'smooth',block:'center'});area?.focus?.();
      },80);
      return;
    }
    if(kind==='prelim'){
      const input=document.getElementById('preliminary-pl-file');if(!input)return;input.value='';
      input.addEventListener('change',async()=>{if(!input.files?.length)return;showImportProgress('月次収支 速報',p,'CSV内部の計上日と対象年月を確認しています…');try{if(!window.DATA_IMPORT_MANAGEMENT?.importPreliminary)throw new Error('月次収支速報の取込基盤を読み込めません');const r=await DATA_IMPORT_MANAGEMENT.importPreliminary();if(!r?.ok)throw new Error(r?.error||'月次収支速報を登録できませんでした');const cur=await Repository.NormalizedSource.loadCurrent('PL_ACTUAL',p);const states=[...new Set((cur?.records||[]).map(x=>x?.document_state).filter(Boolean))];if(!states.includes('PRELIMINARY'))throw new Error(`速報の保存後確認に失敗しました（CURRENT=${states.join(',')||'なし'}）。保存状態を再確認してください。`);await refresh();const suffix=r.canonical_ok===false?` / SOURCE登録済み・表示再構築は要確認（${r.canonical_error||'詳細不明'}）`:` / ${r.record_count||cur?.records?.length||0}行`;finishImportProgress(true,`月次収支 速報 / ${p.slice(0,4)}年${Number(p.slice(4))}月 / PRELIMINARY CURRENT登録済み${suffix}`);}catch(e){finishImportProgress(false,e?.message||String(e));}},{once:true});input.click();return;
    }
    if(kind==='confirmed'){
      const input=document.createElement('input');input.type='file';input.accept='.csv';input.multiple=true;
      input.addEventListener('change',async()=>{if(!input.files?.length)return;document.querySelectorAll('input[name="manual-import-type"]').forEach(r=>{r.checked=r.value==='confirmed';});showImportProgress('月次収支 確定',p,'CSV内部の計上日と対象年月を確認しています…');try{await IMPORT.processCSV(input.files,p,{replace:true,awaitCloud:true,strict:true});await refresh();finishImportProgress(true,`月次収支 確定 / ${p.slice(0,4)}年${Number(p.slice(4))}月 / ${input.files.length}ファイルを登録しました`);}catch(e){finishImportProgress(false,e?.message||String(e));}},{once:true});input.click();return;
    }
    if(kind==='delivery'||kind==='payment'){
      const input=document.createElement('input');input.type='file';input.multiple=true;input.accept=kind==='delivery'?'.pdf':'.xls,.xlsx';
      input.addEventListener('change',async()=>{if(!input.files?.length)return;const label=kind==='delivery'?'配達持出予定リスト':'配達ヘッド傭車料確認';showImportProgress(label,p,'ファイル内部の配達日と対象年月を確認しています…');try{const r=kind==='delivery'?await window.ROUTE_ANALYSIS_UI?.importFiles?.(input.files,p):await window.ROUTE_ANALYSIS_UI?.importHeadPaymentFiles?.(input.files,p);if(!r?.ok)throw new Error(r?.error||`${label}の正規化SOURCE保存を確認できませんでした`);await refresh();finishImportProgress(true,`${label} / ${p.slice(0,4)}年${Number(p.slice(4))}月 / ${r.count}件を登録しました`);}catch(e){finishImportProgress(false,e?.message||String(e));}},{once:true});input.click();return;
    }
  }
  function legacySourcePresence(type,p){
    const ym=String(p||'');
    if(type==='WORKER_SALES'){
      const rows=window.FIELD_DATA_ACCESS?.getWorkerRecords?.() || window.STATE?.workerCsvData || [];
      const rec=(Array.isArray(rows)?rows:[]).find(x=>String(x?.ym||'')===ym);
      if(rec)return {exists:true,detail:`旧登録データあり · ${Number(rec.rowCount||rec.uniqueSlipCount||0).toLocaleString('ja-JP')}件`};
    }
    if(type==='SHIPPER_AREA'){
      const rows=window.FIELD_DATA_ACCESS?.getProductRecords?.() || window.STATE?.productAddressData || [];
      const rec=(Array.isArray(rows)?rows:[]).find(x=>String(x?.ym||'')===ym);
      if(rec)return {exists:true,detail:`旧登録データあり · ${Number(rec.uniqueCount||rec.detailRows||0).toLocaleString('ja-JP')}件`};
    }
    return {exists:false,detail:''};
  }

  async function statusFor(d,p){
    if(d.id==='PLAN_BUDGET'){const fy=fyOf(p),x=window.STATE?.planData?.[fy];if(!x)return {status:'MISSING',text:'未登録',detail:`${fy}年度`};const cov=x.coverage||x.sourceMeta?.coverage||'UNKNOWN';return {status:'CURRENT',text:cov==='FIRST_HALF_ONLY'?'上期策定済':'登録済',detail:`${fy}年度 · ${x.sourceMeta?.source_type||'SOURCE'}`};}
    if(!window.Repository?.NormalizedSource?.loadManifest)return {status:'UNKNOWN',text:'確認不能',detail:'Repository未読込'};
    const type=d.repo||d.id,r=await Repository.NormalizedSource.loadManifest(type,p),m=r?.manifest||{},bs=Array.isArray(m.batches)?m.batches:[],cur=bs.find(x=>x.batch_id===m.current_batch_id);
    if(!cur){
      const legacy=legacySourcePresence(type,p);
      return {status:'MISSING',text:'未登録',detail:legacy.exists?`CURRENTなし · ${legacy.detail}（旧集計はSOURCE未登録）`:'CURRENTなし',revisions:bs.length};
    }
    if(type==='PL_ACTUAL'){const c=await Repository.NormalizedSource.loadCurrent(type,p),st=c?.records?.[0]?.document_state||'UNKNOWN';if(d.state&&st!==d.state)return {status:d.state==='PRELIMINARY'&&st==='CONFIRMED'?'SUPERSEDED':'MISSING',text:st==='CONFIRMED'?'確定済':'未登録',detail:`CURRENT=${st}`,revisions:bs.length};return {status:'CURRENT',text:st,detail:`${cur.record_count??'—'}行`,revisions:bs.length};}
    return {status:'CURRENT',text:'CURRENT',detail:`${cur.record_count??'—'}行`,revisions:bs.length};
  }
  async function refresh(){const host=document.getElementById('data-import-hub-root');if(!host)return;const p=period(document.getElementById('data-import-hub-month')?.value);if(!/^\d{6}$/.test(p)){host.innerHTML='<div class="dih-empty">対象年月を選択してください。</div>';return;}syncLegacy(p);host.innerHTML='<div class="dih-empty">登録状態を確認中…</div>';const rows=[];for(const d of DOCS){try{rows.push([d,await statusFor(d,p)])}catch(e){rows.push([d,{status:'ERROR',text:'確認エラー',detail:e?.message||String(e)}])}}
    const missing=rows.filter(([,s])=>s.status==='MISSING').length,errors=rows.filter(([,s])=>s.status==='ERROR').length;
    host.innerHTML=contentDiagnosticHtml()+`<div class="dih-summary"><div><span>対象</span><b>${esc(p.slice(0,4))}年${esc(String(+p.slice(4)))}月</b><small>${esc(fyOf(p))}年度</small></div><div><span>主要SOURCE</span><b>${DOCS.length}</b></div><div><span>未登録</span><b>${missing}</b></div><div><span>確認エラー</span><b>${errors}</b></div></div><div class="dih-grid">${rows.map(([d,s])=>`<article class="dih-source"><div class="dih-source-top"><div><small>${esc(d.code)}</small><h3>${esc(d.label)}</h3></div><span class="dih-status is-${esc(s.status.toLowerCase())}">${esc(s.text)}</span></div><div class="dih-meta"><span>単位：${esc(d.scope)}</span><span>${esc(s.detail||'')}</span>${s.revisions!=null?`<span>Revision ${esc(s.revisions)}</span>`:''}</div><div class="dih-actions"><button type="button" class="btn" onclick="DATA_IMPORT_HUB.choose('${esc(d.action)}')">${d.action==='plan'?(s.status==='MISSING'?'コピー＆ペーストで登録':'コピー＆ペーストで差替'):(s.status==='MISSING'?'ファイルを選択':'差替・改訂を取込')}</button>${s.revisions>1?`<button type="button" class="btn dih-history-btn" onclick="DATA_IMPORT_HUB.showHistory('${esc(d.repo||d.id)}')">履歴</button>`:''}</div><div class="dih-history-panel" data-history-type="${esc(d.repo||d.id)}" hidden></div></article>`).join('')}</div><div class="dih-foot">CURRENT・RevisionはNormalized Source Repositoryだけを正本として表示します。旧集計データが残っていてもNormalized CURRENTがない月はSOURCE未登録です。元CSVを投入すると正式SOURCEとして登録します。年度は4月始まり（4月～翌3月）です。SKDL0001は着地予測用の日次SOURCE、SKDL0003は後日確定する月次正本として別管理します。</div>`;
  }
  async function showHistory(type){const p=period(document.getElementById('data-import-hub-month')?.value),panel=document.querySelector(`[data-history-type="${CSS.escape(type)}"]`);if(!panel||!/^\d{6}$/.test(p))return;panel.hidden=!panel.hidden;if(panel.hidden)return;if(type==='PLAN_BUDGET'){panel.innerHTML='<div class="dih-history-empty">予算は現在の年度計画を表示しています。</div>';return;}try{const r=await Repository.NormalizedSource.loadManifest(type,p),bs=Array.isArray(r?.manifest?.batches)?r.manifest.batches.slice().reverse():[];panel.innerHTML=bs.length?bs.map(b=>`<div><b>${esc(b.revision_status||'—')}</b><span>${esc(b.record_count??'—')}行</span><span>${esc(b.saved_at||'')}</span></div>`).join(''):'<div class="dih-history-empty">履歴はありません。</div>';}catch(e){panel.innerHTML=`<div class="dih-history-empty">${esc(e?.message||String(e))}</div>`;}}
  function init(){const m=document.getElementById('data-import-hub-month');if(m&&!m.value){const now=new Date(),y=now.getFullYear(),mm=String(now.getMonth()+1).padStart(2,'0');m.value=`${y}-${mm}`;}m?.addEventListener('change',refresh);refresh();window.addEventListener('normalized-source-updated',()=>{if(!initialImportSaving)refresh();});}
  document.addEventListener('DOMContentLoaded',init);
  window.DATA_IMPORT_HUB=Object.freeze({refresh,choose,showHistory,chooseInitialFiles,analyzeInitialFiles,registerInitialReady,showProgress:showImportProgress,finishProgress:finishImportProgress,updateProgress:updateImportProgress});
})();
