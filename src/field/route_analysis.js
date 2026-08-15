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
    // 2026/06 実帳票で検証。
    // PDF.js の単純な items.join(' ') は、見た目では「配達日 2026/06/01」「ヘッド番号 381...」でも
    // 「配達日 ヘッド番号 381... 2026/06/01」のように返る場合がある。
    // まず座標から見た目上の行を復元し、失敗時のみ全文をラベル近傍検索する。
    const clean=String(text||'').normalize('NFKC').replace(/\u0000/g,' ').replace(/[　\t]+/g,' ');
    const spaced=clean.replace(/\s+/g,' ').trim();
    const dense=clean.replace(/\s+/g,'');
    const lines=pdfTextLines(items);

    const dateRe=/(20\d{2})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})日?/;
    const headRe=/(38\d{8}|\d{8,12})/;

    let date='';
    const dateLine=lines.find(v=>v.includes('配達日'))||'';
    let dm=dateLine.match(dateRe);
    if(!dm){
      // ラベル後にヘッド番号が割り込む抽出順も許容し、印刷日時(ページ右上)は拾わない。
      dm=(dense.match(/配達日(?:(?!連絡事項).){0,80}?(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/)||[]);
    }
    if(dm) date=`${dm[1]}-${String(dm[2]).padStart(2,'0')}-${String(dm[3]).padStart(2,'0')}`;

    let head='';
    const headLine=lines.find(v=>v.includes('ヘッド番号'))||'';
    let hm=headLine.match(/ヘッド番号\s*[:：]?\s*(\d{8,12})/);
    if(!hm) hm=dense.match(/ヘッド番号[:：]?(\d{8,12})/);
    if(!hm) hm=dense.match(/(?:^|\D)(38\d{8})(?=\D|$)/);
    if(hm) head=hm[1]||'';

    let worker='';
    const workerLine=lines.find(v=>/作業者(?!TEL)/.test(v))||'';
    let wm=workerLine.match(/作業者\s*[:：]?\s*(.+?)(?=\s+配達持出リスト|\s+作業者TEL|\s+支店|$)/);
    if(!wm) wm=spaced.match(/作業者\s*[:：]?\s*(.+?)(?=\s+配達持出リスト|\s+作業者TEL|\s+支店)/);
    if(wm) worker=wm[1].replace(/^[:：]\s*/,'').trim();

    // 原票番号は主に5または9で始まる12桁。荷主伝票番号との混同を抑える。
    const slips=[...new Set((spaced.match(/(?:^|\D)([59]\d{11})(?=\D|$)/g)||[])
      .map(v=>(v.match(/[59]\d{11}/)||[])[0]).filter(Boolean))];
    return {headNumber:head,date,worker,slips};
  }

  async function parsePdf(file){
    const lib=await pdfjs();
    const data=await file.arrayBuffer();
    const pdf=await lib.getDocument({data}).promise;
    const map=new Map();
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const tc=await page.getTextContent();
      const text=tc.items.map(x=>x.str).join(' ');
      const r=parsePageText(text,tc.items);
      if(!r.headNumber||!r.date) continue;
      const key=`${r.date}|${r.headNumber}`;
      const old=map.get(key)||{...r,slips:[]};
      if(!old.worker&&r.worker) old.worker=r.worker;
      old.slips=[...new Set([...(old.slips||[]),...(r.slips||[])])];
      map.set(key,old);
    }
    return [...map.values()];
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
      for(const f of arr){
        const routes=await parsePdf(f);
        parsedRouteCount += routes.length;
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
        if(msg) msg.innerHTML='<span style="color:#991b1b;font-weight:700">PDFは読み込みましたが、配達日・ヘッド番号を取得できませんでした。対象が「配達持出リスト」か確認してください。</span>';
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
