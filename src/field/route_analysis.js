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

  function parsePageText(text){
    const clean = String(text || '').replace(/\u0000/g,' ').replace(/[　\t]+/g,' ');
    const compact = clean.replace(/\s+/g,' ');
    const head = (compact.match(/ヘッド番号[^0-9]{0,20}(\d{8,12})/) || compact.match(/(38\d{8})/) || [])[1] || '';
    const dm = compact.match(/(20\d{2})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})/);
    const date = dm ? `${dm[1]}-${String(dm[2]).padStart(2,'0')}-${String(dm[3]).padStart(2,'0')}` : '';
    let worker = '';
    const wm = compact.match(/作業者\s+(.+?)(?=\s+配達持出リスト|\s+作業者TEL|\s+支店)/);
    if (wm) worker = wm[1].replace(/^[:：]\s*/,'').trim();

    // 原票番号は主に5または9で始まる12桁。荷主伝票番号との混同を抑える。
    const slips = [...new Set((compact.match(/(?:^|\D)([59]\d{11})(?=\D|$)/g) || [])
      .map(v=>(v.match(/[59]\d{11}/)||[])[0]).filter(Boolean))];
    return { headNumber:head, date, worker, slips };
  }

  async function parsePdf(file){
    const lib = await pdfjs();
    const data = await file.arrayBuffer();
    const pdf = await lib.getDocument({data}).promise;
    const map = new Map();
    for (let p=1; p<=pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items.map(x=>x.str).join(' ');
      const r = parsePageText(text);
      if (!r.headNumber || !r.date) continue;
      const key = `${r.date}|${r.headNumber}`;
      const old = map.get(key) || { ...r, slips:[] };
      if (!old.worker && r.worker) old.worker = r.worker;
      old.slips = [...new Set([...(old.slips||[]), ...(r.slips||[])])];
      map.set(key, old);
    }
    return [...map.values()];
  }

  function workerMonth(ym){
    return (STATE.workerCsvData || []).find(x=>x && x.ym===ym) || null;
  }
  function monthRoutes(ym){
    const rec = (STATE.routeData || []).find(x=>x && x.ym===ym);
    return rec ? (rec.routes || []) : [];
  }
  function routePayments(ym){
    const ds = (STATE.datasets || []).filter(x=>x && x.ym===ym && Array.isArray(x.routePayments));
    const confirmed = ds.find(x=>(x.type||'confirmed')==='confirmed');
    const daily = ds.find(x=>(x.type||'confirmed')==='daily');
    return (confirmed || daily || {}).routePayments || [];
  }

  function joinedRows(ym){
    const rec = workerMonth(ym);
    const workers = rec?.workers || {};
    const workerEntries = Object.values(workers);
    const payments = routePayments(ym);
    return monthRoutes(ym).map(route=>{
      const w = workerEntries.find(x=>norm(x.name)===norm(route.worker));
      const allSlips = Object.values(w?.slips || {});
      let matched = allSlips.filter(s=>String(s.date||'').replace(/\D/g,'')===String(route.date||'').replace(/\D/g,''));
      let matchMode = '作業者＋日付';
      if ((route.slips||[]).length) {
        const set = new Set(route.slips.map(String));
        const exact = allSlips.filter(s=>set.has(String(s.slip||'')));
        if (exact.length) { matched=exact; matchMode='原票一致'; }
      }
      const count = new Set(matched.map(s=>String(s.slip||''))).size;
      const sales = matched.reduce((sum,s)=>sum+Number(s.amount||0),0);
      const payRows = payments.filter(p=>String(p.headNumber)===String(route.headNumber));
      const payment = payRows.reduce((sum,p)=>sum+Number(p.amount||0),0);
      const status = !w ? '作業者未一致' : !count ? '売上未一致' : !payRows.length ? '傭車費なし' : matchMode;
      return {...route,count,sales,payment,margin:sales-payment,avg:count?sales/count:0,status};
    }).sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.headNumber).localeCompare(String(b.headNumber)));
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
      STORE.save();
      if(window.CLOUD?.pushAll) CLOUD.pushAll({onlyChanged:true}).catch(()=>{});
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

  function render(){
    setup();
    const sel=document.getElementById('route-ym-select');
    const yms=[...new Set([...(STATE.routeData||[]).map(x=>x.ym), ...(STATE.workerCsvData||[]).map(x=>x.ym), ...(STATE.datasets||[]).map(x=>x.ym)])].filter(Boolean).sort();
    if(sel){
      const cur=sel.value;
      sel.innerHTML=yms.map(ym=>`<option value="${ym}">${ym.slice(0,4)}年${Number(ym.slice(4,6))}月</option>`).join('');
      sel.value=yms.includes(cur)?cur:(STATE.selYM&&yms.includes(STATE.selYM)?STATE.selYM:(yms.at(-1)||''));
    }
    const ym=sel?.value||'';
    const rows=joinedRows(ym);
    const totalCount=rows.reduce((s,r)=>s+r.count,0), totalSales=rows.reduce((s,r)=>s+r.sales,0), totalPay=rows.reduce((s,r)=>s+r.payment,0);
    const kpi=document.getElementById('route-kpi');
    if(kpi) kpi.innerHTML=`
      <div class="kpi-card accent-navy"><div class="kpi-label">便数</div><div class="kpi-value">${fmt(rows.length)}便</div></div>
      <div class="kpi-card accent-green"><div class="kpi-label">配送件数</div><div class="kpi-value">${fmt(totalCount)}件</div></div>
      <div class="kpi-card accent-navy"><div class="kpi-label">売上</div><div class="kpi-value">${fmt(totalSales)}円</div></div>
      <div class="kpi-card accent-amber"><div class="kpi-label">売上－傭車支払</div><div class="kpi-value">${fmt(totalSales-totalPay)}円</div></div>`;
    const body=document.getElementById('route-tbody');
    if(body) body.innerHTML=rows.length?rows.map(r=>`<tr>
      <td>${esc(r.date)}</td><td><strong>${esc(r.headNumber)}</strong></td><td>${esc(r.worker||'未取得')}</td>
      <td class="r">${fmt(r.count)}件</td><td class="r">${fmt(r.sales)}円</td><td class="r">${fmt(r.payment)}円</td>
      <td class="r"><strong>${fmt(r.margin)}円</strong></td><td class="r">${fmt(r.avg)}円</td>
      <td><span style="font-size:10px;font-weight:700;color:${r.status==='原票一致'?'#065f46':'#92400e'}">${esc(r.status)}</span></td>
    </tr>`).join(''):`<tr><td colspan="9" style="padding:30px;text-align:center;color:var(--text3)">配達持出PDF、作業者別CSV、SKDL0001を取り込んでください。</td></tr>`;
  }

  window.ROUTE_ANALYSIS_UI={render,setup,importFiles,joinedRows};
})();
