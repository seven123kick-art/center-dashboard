/* route_analysis.js : 配達持出PDF × 作業者売上CSV × SKDL0001 の便別採算分析 */
'use strict';
(function(){
  if (window.ROUTE_ANALYSIS_UI) return;

  const norm = v => String(v ?? '').normalize('NFKC').replace(/[\s　]+/g,'').trim();
  const fmt = v => Math.round(Number(v||0)).toLocaleString('ja-JP');
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const ymOfDate = d => String(d||'').replace(/\D/g,'').slice(0,6);

  async function pdfjs(){
    if (window.pdfjsLib) return window.pdfjsLib;
    const mod = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    return mod;
  }

  function pdfTextLines(items){
    const rows=[];
    for(const it of (items||[])){
      const text=String(it?.str||'').normalize('NFKC').replace(/\u0000/g,' ').trim();
      if(!text) continue;
      const tr=Array.isArray(it?.transform)?it.transform:[];
      const x=Number(tr[4]||0), y=Number(tr[5]||0);
      let row=rows.find(r=>Math.abs(r.y-y)<=3.2);
      if(!row){ row={y,parts:[]}; rows.push(row); }
      row.parts.push({x,text});
    }
    return rows
      .sort((a,b)=>b.y-a.y)
      .map(r=>r.parts.sort((a,b)=>a.x-b.x).map(v=>v.text).join(' ').replace(/\s+/g,' ').trim())
      .filter(Boolean);
  }

  function parsePageText(text, items){
    // 配達持出リスト実帳票向けの堅牢抽出。
    // PDF.js はラベルと値を視覚順とは異なる順序で返すことがあるため、
    // 「ラベル直後」だけに依存せず、ページ全体の候補から確定する。
    const rawItems=(items||[]).map(it=>String(it?.str||'').normalize('NFKC').replace(/\u0000/g,' ').trim()).filter(Boolean);
    const clean=String(text||rawItems.join(' ')).normalize('NFKC').replace(/\u0000/g,' ').replace(/[　\t]+/g,' ');
    const spaced=clean.replace(/\s+/g,' ').trim();
    const dense=rawItems.join('').replace(/\s+/g,'') || clean.replace(/\s+/g,'');
    const lines=pdfTextLines(items);

    // ヘッド番号：実帳票は 38 で始まる10桁。まずページ全体から直接取得。
    // 数字がPDF itemで分割されても rawItems.join('') なら復元できる。
    let head='';
    let hm=dense.match(/38\d{8}/);
    if(!hm) hm=spaced.match(/(?:^|\D)(\d{8,12})(?=\D|$)/);
    if(hm) head=(hm[1]||hm[0]||'').replace(/\D/g,'');

    // 配達日：ページには右上の印刷日時もあるため、全日付候補のうち
    // 「配達日」近傍を最優先。それでも取れなければ最後の日付を採用する。
    const datePattern=/(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/g;
    let date='';
    let dateSource='';
    const labelPos=dense.indexOf('配達日');
    if(labelPos>=0){
      const near=dense.slice(labelPos, labelPos+160);
      const m=[...near.matchAll(datePattern)][0];
      if(m){ dateSource='label'; date=`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`; }
    }
    if(!date){
      const all=[...dense.matchAll(datePattern)];
      const m=all.length ? all[all.length-1] : null;
      if(m){ dateSource='last'; date=`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`; }
    }

    let worker='';
    const workerLine=lines.find(v=>/作業者(?!TEL)/.test(v))||'';
    let wm=workerLine.match(/作業者\s*[:：]?\s*(.+?)(?=\s+配達持出リスト|\s+作業者TEL|\s+支店|$)/);
    if(!wm) wm=spaced.match(/作業者\s*[:：]?\s*(.+?)(?=\s+配達持出リスト|\s+作業者TEL|\s+支店)/);
    if(wm) worker=wm[1].replace(/^[:：]\s*/,'').trim();

    const slips=[...new Set((spaced.match(/(?:^|\D)([59]\d{11})(?=\D|$)/g)||[])
      .map(v=>(v.match(/[59]\d{11}/)||[])[0]).filter(Boolean))];
    return {headNumber:head,date,worker,slips,_debug:{dateSource,itemCount:rawItems.length,denseHead:dense.slice(0,220)}};
  }

  async function parsePdf(file){
    const lib=await pdfjs();
    const data=await file.arrayBuffer();
    const pdf=await lib.getDocument({
      data,
      // 配達持出リストは UniJIS-UCS2-HW-H を使用する旧式PDF。
      // CMapを明示しないとChrome上のPDF.jsではページを開けても
      // getTextContent() が0件になるため、Adobe CMapを明示する。
      cMapUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/cmaps/',
      cMapPacked:true,
      standardFontDataUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/standard_fonts/'
    }).promise;
    const map=new Map();
    const diagnostics=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const tc=await page.getTextContent();
      const text=tc.items.map(x=>x.str).join(' ');
      const r=parsePageText(text,tc.items);
      diagnostics.push({page:p,head:r.headNumber,date:r.date,items:tc.items.length});
      if(!r.headNumber||!r.date) continue;
      const key=`${r.date}|${r.headNumber}`;
      const old=map.get(key)||{...r,slips:[]};
      if(!old.worker&&r.worker) old.worker=r.worker;
      old.slips=[...new Set([...(old.slips||[]),...(r.slips||[])])];
      map.set(key,old);
    }
    const routes=[...map.values()];
    routes._diagnostics=diagnostics;
    return routes;
  }

  function joinedRows(ym){
    if (!window.LEDGER?.buildMonth) return [];
    return LEDGER.buildMonth(ym).routes;
  }

  async function importFiles(files){
    const arr=[...files].filter(f=>/\.pdf$/i.test(f.name));
    const msg=document.getElementById('route-import-msg');
    if (!arr.length) return;
    try{
      if(msg) msg.innerHTML='<span style="color:#334155;font-weight:700">PDFを解析中です…</span>';
      const byYm=new Map();
      let parsedRouteCount = 0;
      const allDiagnostics=[];
      for(const f of arr){
        const routes=await parsePdf(f);
        parsedRouteCount += routes.length;
        allDiagnostics.push({file:f.name,pages:routes._diagnostics||[]});
        for(const r of routes){
          const ym=ymOfDate(r.date);
          if(!ym) continue;
          if(!byYm.has(ym)) byYm.set(ym,[]);
          byYm.get(ym).push(r);
        }
      }
      STATE.routeData = Array.isArray(STATE.routeData) ? STATE.routeData : [];
      for(const [ym,routes] of byYm){
        const merged=new Map();
        const old=(STATE.routeData.find(x=>x.ym===ym)?.routes || []);
        [...old,...routes].forEach(r=>{
          const key=`${r.date}|${r.headNumber}`;
          const prev=merged.get(key)||{...r,slips:[]};
          prev.worker=r.worker||prev.worker;
          prev.slips=[...new Set([...(prev.slips||[]),...(r.slips||[])])];
          merged.set(key,prev);
        });
        STATE.routeData=STATE.routeData.filter(x=>x.ym!==ym);
        STATE.routeData.push({ym,routes:[...merged.values()],importedAt:new Date().toISOString(),source:'delivery_list_pdf'});
      }
      STATE.routeData.sort((a,b)=>a.ym.localeCompare(b.ym));
      Repository.Storage.save();
      if(window.CLOUD?.pushAll) SYNC_COORDINATOR.syncPush({onlyChanged:true}).catch(()=>{});
      if (!parsedRouteCount) {
        const d=allDiagnostics.flatMap(x=>x.pages).slice(0,3).map(x=>`P${x.page}:日付=${x.date||'×'} / ヘッド=${x.head||'×'} / 文字=${x.items}`).join('、');
        if(msg) msg.innerHTML=`<span style="color:#991b1b;font-weight:700">PDFは読み込みましたが便を確定できませんでした。</span><br><span style="font-size:12px;color:#64748b">診断: ${esc(d||'PDF文字情報なし')}</span>`;
        return;
      }
      if(msg) msg.innerHTML=`<span style="color:#065f46;font-weight:700">${arr.length}ファイルから${parsedRouteCount}便を取り込みました。</span>`;
      render();
    }catch(e){
      console.error(e);
      if(msg) msg.innerHTML=`<span style="color:#991b1b;font-weight:700">取込エラー：${esc(e.message)}</span>`;
    }
  }

  function setup(){
    const zone=document.getElementById('route-pdf-upload-zone');
    const input=document.getElementById('route-pdf-file-input');
    if(!zone||!input||zone.dataset.bound) return;
    zone.dataset.bound='1';
    input.addEventListener('change',()=>{ importFiles(input.files); input.value=''; });
    ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('dragover');}));
    ['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('dragover');}));
    zone.addEventListener('drop',e=>importFiles(e.dataTransfer.files));
  }

  let viewMode = 'table';
  let currentRows = [];

  function statusClass(status){
    return status === '原票一致' ? 'ok' : 'warn';
  }

  function marginRate(r){
    return Number(r.sales) ? Number(r.margin) / Number(r.sales) * 100 : 0;
  }

  function setOptions(select, values, selected, allLabel='すべて'){
    if(!select) return;
    select.innerHTML = `<option value="">${esc(allLabel)}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value = values.includes(selected) ? selected : '';
  }


  function resolveWorkerMaster(workerName, date=''){
    const name=String(workerName||'');
    if(!name) return null;
    const direct=window.WORKERS?.find ? WORKERS.find(name,date) : null;
    if(direct) return direct;
    const key=norm(name);
    if(!key || !window.WORKERS?.all) return null;
    return WORKERS.all().find(r=>norm(r?.workerName)===key) || null;
  }

  function enrichRouteRows(rows){
    return (Array.isArray(rows)?rows:[]).map(r=>{
      if(r?.companyName && r?.operationType) return r;
      const master=resolveWorkerMaster(r?.worker,r?.date);
      if(!master) return r;
      return {
        ...r,
        companyName:r.companyName || master.companyName || '',
        operationType:r.operationType || master.operationType || '',
        workerRegistered:r.workerRegistered || !!master
      };
    });
  }

  function filteredRowsFromCurrentControls(){
    const ym=document.getElementById('route-ym-select')?.value || '';
    const ledger=window.LEDGER?.buildMonth ? LEDGER.buildMonth(ym) : {routes:joinedRows(ym)};
    const allRows=enrichRouteRows(ledger.routes || []);
    const company=document.getElementById('route-company-select')?.value || '';
    const type=document.getElementById('route-type-select')?.value || '';
    const q=String(document.getElementById('route-search')?.value || '').trim().toLowerCase();
    return allRows.filter(r=>(!company||r.companyName===company)&&(!type||r.operationType===type)&&(!q||`${r.worker} ${r.headNumber} ${r.companyName}`.toLowerCase().includes(q)));
  }

  function setView(mode){
    viewMode = mode === 'card' ? 'card' : 'table';
    document.getElementById('route-view-table')?.classList.toggle('active', viewMode==='table');
    document.getElementById('route-view-card')?.classList.toggle('active', viewMode==='card');
    const table=document.getElementById('route-table-wrap');
    const cards=document.getElementById('route-card-grid');
    if(table) table.style.display=viewMode==='table'?'block':'none';
    if(cards) cards.style.display=viewMode==='card'?'grid':'none';
  }

  function openDetail(routeId){
    const r=currentRows.find(x=>x.routeId===routeId);
    const root=document.getElementById('route-detail-modal');
    if(!r||!root) return;
    const rate=marginRate(r);
    const slips=(r.slipRows||[]);
    root.innerHTML=`<div class="route-detail-overlay" onclick="if(event.target===this)ROUTE_ANALYSIS_UI.closeDetail()">
      <section class="route-detail-panel" role="dialog" aria-modal="true" aria-label="便詳細">
        <div class="route-detail-head">
          <div><div class="saas-eyebrow">ROUTE DETAIL</div><h2>${esc(r.date)} / ${esc(r.headNumber)}</h2><div style="font-size:11px;color:var(--text2)">${esc(r.companyName||'未設定')}　${esc(r.worker||'未取得')}　${esc(r.operationType||'')}</div></div>
          <button class="route-detail-close" onclick="ROUTE_ANALYSIS_UI.closeDetail()">×</button>
        </div>
        <div class="route-detail-body">
          <div class="route-detail-kpis">
            <div class="route-detail-kpi"><span>配送件数</span><strong>${fmt(r.count)}件</strong></div>
            <div class="route-detail-kpi"><span>売上</span><strong>${fmt(r.sales)}円</strong></div>
            <div class="route-detail-kpi"><span>傭車支払</span><strong>${fmt(r.payment)}円</strong></div>
            <div class="route-detail-kpi"><span>一次利益 / 利益率</span><strong class="${r.margin>=0?'profit-positive':'profit-negative'}">${fmt(r.margin)}円 / ${rate.toFixed(1)}%</strong></div>
          </div>
          <div class="saas-content-card" style="box-shadow:none">
            <div class="saas-content-head"><div><strong>原票明細</strong><span>${fmt(slips.length)}件</span></div><span class="route-status ${statusClass(r.status)}">${esc(r.status)}</span></div>
            <div class="scroll-x"><table class="tbl saas-table"><thead><tr><th>原票番号</th><th>荷主</th><th>商品・カテゴリ</th><th>エリア</th><th class="r">売上</th><th>照合</th></tr></thead><tbody>
              ${slips.length?slips.map(x=>`<tr><td><strong>${esc(x.slip)}</strong></td><td>${esc(x.shipperName||x.shipperCode||'未取得')}</td><td>${esc(x.product||x.category||'未取得')}</td><td>${esc(x.city||x.area||'未取得')}</td><td class="r">${fmt(x.sales)}円</td><td><span class="route-status ${x.workerMatched?'ok':'warn'}">${x.workerMatched?'一致':'未一致'}</span></td></tr>`).join(''):`<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text3)">原票明細を取得できませんでした。</td></tr>`}
            </tbody></table></div>
          </div>
        </div>
      </section>
    </div>`;
  }

  function closeDetail(){
    const root=document.getElementById('route-detail-modal');
    if(root) root.innerHTML='';
  }

  function exportContext(){
    const ym=document.getElementById('route-ym-select')?.value || '';
    const company=document.getElementById('route-company-select')?.value || '';
    const type=document.getElementById('route-type-select')?.value || '';
    const q=String(document.getElementById('route-search')?.value || '').trim();
    const period=ym && ym.length===6 ? `${ym.slice(0,4)}年${Number(ym.slice(4,6))}月` : ym;
    const filters=[company && `所属会社:${company}`, type && `運行区分:${type}`, q && `検索:${q}`].filter(Boolean).join(' / ');
    return {ym,period,filters};
  }

  function buildExportData(){
    const ctx=exportContext();
    const exportRows=filteredRowsFromCurrentControls();
    const rows=exportRows.map(r=>[
      r.date || '',
      r.headNumber || '',
      r.worker || '未取得',
      r.companyName || '未設定',
      r.operationType || '',
      Number(r.count)||0,
      Number(r.sales)||0,
      Number(r.payment)||0,
      Number(r.margin)||0,
      marginRate(r),
      r.status || ''
    ]);
    const totalCount=exportRows.reduce((s,r)=>s+(Number(r.count)||0),0);
    const totalSales=exportRows.reduce((s,r)=>s+(Number(r.sales)||0),0);
    const totalPay=exportRows.reduce((s,r)=>s+(Number(r.payment)||0),0);
    const totalMargin=totalSales-totalPay;
    return {
      title:'便別採算',
      center:(typeof CENTER !== 'undefined' && CENTER?.name) || '',
      period:ctx.period,
      filters:ctx.filters,
      filename:(window.EXPORT_SERVICE?.buildFilename)
        ? EXPORT_SERVICE.buildFilename([(typeof CENTER !== 'undefined' && CENTER?.name) || '', '便別採算', ctx.ym], 'xlsx')
        : undefined,
      sheets:[{
        name:'便別採算',
        summary:[{
          label:'集計',
          columns:['対象便数','配送件数','売上','傭車支払','一次利益','利益率'],
          rows:[[exportRows.length,totalCount,totalSales,totalPay,totalMargin,totalSales ? totalMargin/totalSales*100 : 0]]
        }],
        columns:['配達日','便・ヘッドNo','作業者','所属会社','運行区分','件数','売上','傭車支払','一次利益','利益率(%)','状態'],
        rows
      }]
    };
  }

  function exportExcel(){
    if(!window.EXPORT_SERVICE){ if(window.UI?.toast) window.UI.toast('出力機能を読み込めませんでした','error'); return; }
    EXPORT_SERVICE.toExcel(buildExportData()).catch(e=>{
      console.error('[route_analysis export]',e);
      if(window.UI?.toast) window.UI.toast('Excel出力に失敗しました','error');
    });
  }

  function printView(){
    if(!window.EXPORT_SERVICE){ if(window.UI?.toast) window.UI.toast('出力機能を読み込めませんでした','error'); return; }
    const ctx=exportContext();
    EXPORT_SERVICE.toPrint({
      title:'便別採算',
      center:(typeof CENTER !== 'undefined' && CENTER?.name) || '',
      period:[ctx.period,ctx.filters].filter(Boolean).join(' / ')
    });
  }

  function render(){
    setup();
    const sel=document.getElementById('route-ym-select');
    const yms=window.LEDGER?.availableMonths ? LEDGER.availableMonths() : [...new Set([...(STATE.routeData||[]).map(x=>x.ym), ...(STATE.workerCsvData||[]).map(x=>x.ym), ...(STATE.datasets||[]).map(x=>x.ym)])].filter(Boolean).sort();
    if(sel){
      const cur=sel.value;
      sel.innerHTML=yms.map(ym=>`<option value="${ym}">${ym.slice(0,4)}年${Number(ym.slice(4,6))}月</option>`).join('');
      sel.value=yms.includes(cur)?cur:(STATE.selYM&&yms.includes(STATE.selYM)?STATE.selYM:(yms.at(-1)||''));
    }
    const ym=sel?.value||'';
    const ledger=window.LEDGER?.buildMonth ? LEDGER.buildMonth(ym) : {routes:joinedRows(ym),diagnostics:null};
    const allRows=enrichRouteRows(ledger.routes || []);
    const diag=ledger.diagnostics;

    const companySel=document.getElementById('route-company-select');
    const typeSel=document.getElementById('route-type-select');
    const prevCompany=companySel?.value||'';
    const prevType=typeSel?.value||'';
    const companies=[...new Set(allRows.map(r=>r.companyName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
    const types=[...new Set(allRows.map(r=>r.operationType).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
    setOptions(companySel,companies,prevCompany);
    setOptions(typeSel,types,prevType);
    const company=companySel?.value||'';
    const type=typeSel?.value||'';
    const q=String(document.getElementById('route-search')?.value||'').trim().toLowerCase();
    const rows=allRows.filter(r=>(!company||r.companyName===company)&&(!type||r.operationType===type)&&(!q||`${r.worker} ${r.headNumber} ${r.companyName}`.toLowerCase().includes(q)));
    currentRows=rows;

    const totalCount=rows.reduce((s,r)=>s+r.count,0), totalSales=rows.reduce((s,r)=>s+r.sales,0), totalPay=rows.reduce((s,r)=>s+r.payment,0), totalMargin=totalSales-totalPay;
    const kpi=document.getElementById('route-kpi');
    if(kpi) kpi.innerHTML=`
      <div class="kpi-card"><div class="kpi-label">対象便数</div><div class="kpi-value">${fmt(rows.length)}<small style="font-size:11px;margin-left:4px">便</small></div><div style="font-size:10px;color:var(--text3);margin-top:7px">配送 ${fmt(totalCount)}件</div></div>
      <div class="kpi-card"><div class="kpi-label">売上</div><div class="kpi-value">${fmt(totalSales)}<small style="font-size:11px;margin-left:4px">円</small></div><div style="font-size:10px;color:var(--text3);margin-top:7px">1件平均 ${fmt(totalCount?totalSales/totalCount:0)}円</div></div>
      <div class="kpi-card"><div class="kpi-label">傭車支払</div><div class="kpi-value">${fmt(totalPay)}<small style="font-size:11px;margin-left:4px">円</small></div><div style="font-size:10px;color:var(--text3);margin-top:7px">売上比 ${totalSales?(totalPay/totalSales*100).toFixed(1):'0.0'}%</div></div>
      <div class="kpi-card"><div class="kpi-label">一次利益</div><div class="kpi-value ${totalMargin>=0?'profit-positive':'profit-negative'}">${fmt(totalMargin)}<small style="font-size:11px;margin-left:4px">円</small></div><div style="font-size:10px;color:var(--text3);margin-top:7px">利益率 ${totalSales?(totalMargin/totalSales*100).toFixed(1):'0.0'}%</div></div>`;

    const diagnostic=document.getElementById('route-diagnostic');
    if(diagnostic && diag){
      const missing=[];
      if(!diag.sourceStatus.routePdf) missing.push('配達持出リストPDF');
      if(!diag.sourceStatus.workerCsv) missing.push('作業者別CSV');
      if(!diag.sourceStatus.productCsv) missing.push('荷主別CSV');
      if(!diag.sourceStatus.skdl0001) missing.push('SKDL0001');
      const notices=[];
      if(missing.length) notices.push(`<div class="msg msg-warn">不足データ：${missing.map(esc).join('、')}。データ管理から取り込んでください。</div>`);
      else notices.push(`<div class="msg msg-info">統合率 <strong>${Number(diag.integrationRate||0).toFixed(1)}%</strong>　未一致原票 ${fmt(diag.unmatchedRouteSlipCount)}件　作業者未一致便 ${fmt(diag.routesWithoutWorker)}便　傭車費未一致便 ${fmt(diag.routesWithoutPayment)}便</div>`);
      if((diag.unregisteredWorkers||[]).length) notices.push(`<div class="msg msg-warn">マスタ未登録：${diag.unregisteredWorkers.map(esc).join('、')}。マスタ管理から所属会社を登録してください。</div>`);
      diagnostic.innerHTML=notices.join('');
    }

    const count=document.getElementById('route-result-count');
    if(count) count.textContent=`${fmt(rows.length)}件`;
    const body=document.getElementById('route-tbody');
    if(body) body.innerHTML=rows.length?rows.map(r=>{const rate=marginRate(r);return `<tr onclick="ROUTE_ANALYSIS_UI.openDetail('${esc(r.routeId)}')">
      <td>${esc(r.date)}</td><td><strong>${esc(r.headNumber)}</strong></td><td>${esc(r.worker||'未取得')}</td><td>${r.workerRegistered?`${esc(r.companyName||'未設定')}<div style="font-size:10px;color:var(--text3);margin-top:2px">${esc(r.operationType||'')}</div>`:'<span class="route-status warn">未登録</span>'}</td>
      <td class="r">${fmt(r.count)}件</td><td class="r">${fmt(r.sales)}円</td><td class="r">${fmt(r.payment)}円</td><td class="r"><strong class="${r.margin>=0?'profit-positive':'profit-negative'}">${fmt(r.margin)}円</strong></td><td class="r">${rate.toFixed(1)}%</td><td><span class="route-status ${statusClass(r.status)}">${esc(r.status)}</span></td>
    </tr>`}).join(''):`<tr><td colspan="10" style="padding:38px;text-align:center;color:var(--text3)">条件に一致する便がありません。</td></tr>`;

    const cards=document.getElementById('route-card-grid');
    if(cards) cards.innerHTML=rows.length?rows.map(r=>{const rate=marginRate(r);return `<article class="route-profit-card" onclick="ROUTE_ANALYSIS_UI.openDetail('${esc(r.routeId)}')"><div class="route-card-top"><div><div class="route-card-date">${esc(r.date)}</div><div class="route-card-title">${esc(r.headNumber)}</div><div class="route-card-worker">${esc(r.companyName||'未設定')} / ${esc(r.worker||'未取得')}</div></div><div><div class="route-card-profit-label">一次利益</div><div class="route-card-profit ${r.margin>=0?'profit-positive':'profit-negative'}">${fmt(r.margin)}円</div><div style="text-align:right;margin-top:5px"><span class="route-status ${statusClass(r.status)}">${esc(r.status)}</span></div></div></div><div class="route-card-metrics"><div>売上<strong>${fmt(r.sales)}円</strong></div><div>傭車支払<strong>${fmt(r.payment)}円</strong></div><div>利益率<strong>${rate.toFixed(1)}%</strong></div></div></article>`}).join(''):`<div style="grid-column:1/-1;padding:38px;text-align:center;color:var(--text3)">条件に一致する便がありません。</div>`;
    setView(viewMode);
  }

  window.ROUTE_ANALYSIS_UI={render,setup,importFiles,joinedRows,setView,openDetail,closeDetail,exportExcel,printView};
})();
