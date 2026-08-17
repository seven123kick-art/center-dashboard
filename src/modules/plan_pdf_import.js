/* Version6 D3-12: SKFL0001 budget-plan PDF importer */
'use strict';
(function(){
  if(window.__PLAN_PDF_IMPORT_LOADED_20260817__)return; window.__PLAN_PDF_IMPORT_LOADED_20260817__=true;
  const MONTHS_BY_PAGE=[['04','05','06','07','08','09'],['10','11','12','01','02','03']];
  const cleanLabel=v=>String(v??'').replace(/[\s　]/g,'').replace(/[：:]/g,'').trim();
  const num=v=>{const s=String(v??'').replace(/,/g,'').replace(/[^\d.\-]/g,'');if(!s||s==='-'||s==='.')return null;const n=Number(s);return Number.isFinite(n)?n:null;};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function pdfjs(){
    if(window.pdfjsLib)return window.pdfjsLib;
    const mod=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
    return mod;
  }
  function groupLines(items){
    const points=(items||[]).filter(x=>x?.str!=null&&x?.transform).map(x=>({x:Number(x.transform[4])||0,y:Number(x.transform[5])||0,t:String(x.str||'').trim()})).filter(x=>x.t&&x.x>=38);
    points.sort((a,b)=>b.y-a.y||a.x-b.x);
    const lines=[];
    for(const p of points){let line=lines.find(l=>Math.abs(l.y-p.y)<=1.8);if(!line){line={y:p.y,items:[]};lines.push(line);}line.items.push(p);}
    return lines.map(l=>({y:l.y,items:l.items.sort((a,b)=>a.x-b.x)}));
  }
  function parsePage(lines,pageIndex){
    const months=MONTHS_BY_PAGE[pageIndex]||[]; const out={};
    for(const line of lines){
      const label=cleanLabel(line.items.filter(i=>i.x<125).map(i=>i.t).join(''));
      if(!label||/^(項目|営業|収益|人件費|燃料費|修繕費|償却|保険料|施設|租税公課|傭車費|営業費)$/.test(label))continue;
      const values=line.items.filter(i=>i.x>=125&&i.x<485).map(i=>num(i.t)).filter(v=>v!==null);
      if(values.length<months.length)continue;
      const vals={}; months.forEach((m,idx)=>{vals[m]=values[idx];});
      if(!out[label])out[label]=vals;
      else{
        const oldTotal=Object.values(out[label]).reduce((a,b)=>a+(Number(b)||0),0),newTotal=Object.values(vals).reduce((a,b)=>a+(Number(b)||0),0);
        if(oldTotal===0&&newTotal!==0)out[label]=vals;
      }
    }
    return out;
  }
  async function parseFile(file){
    const lib=await pdfjs(),data=new Uint8Array(await file.arrayBuffer()),doc=await lib.getDocument({data}).promise;
    if(doc.numPages<2)throw new Error('SKFL0001は上期・下期の2ページを想定しています。2ページ未満のため取込できません。');
    let fy=null,centerCode=null,centerName=null; const plan={};
    for(let p=1;p<=Math.min(doc.numPages,2);p++){
      const page=await doc.getPage(p),content=await page.getTextContent({disableNormalization:false}),lines=groupLines(content.items);
      const all=content.items.map(x=>String(x.str||'')).join(' ');
      const fyMatch=all.match(/(20\d{2})\s*年度/); if(fyMatch)fy=fy||fyMatch[1];
      const centerMatch=all.match(/支店[：:]?\s*(\d{6})\s*([^\s]+)/); if(centerMatch){centerCode=centerCode||centerMatch[1];centerName=centerName||centerMatch[2];}
      const parsed=parsePage(lines,p-1);
      for(const [label,vals] of Object.entries(parsed)){plan[label]=Object.assign({},plan[label]||{},vals);}
    }
    if(!fy)throw new Error('PDFから年度を確認できませんでした。');
    const required=['営業収益計','人件費計','傭車費計','営業利益'];
    const missing=required.filter(k=>!plan[k]);
    if(missing.length)throw new Error(`SKFL0001の主要科目を確認できません: ${missing.join('、')}`);
    return {fiscalYear:fy,centerCode,centerName,rows:plan,itemCount:Object.keys(plan).length};
  }
  function setMsg(text,type=''){const el=document.getElementById('plan-pdf-import-msg');if(el){el.textContent=text||'';el.className=type==='error'?'text-danger':'';}}
  async function importSelected(){
    const file=document.getElementById('plan-pdf-file-input')?.files?.[0]; if(!file){setMsg('SKFL0001 PDFを選択してください。','error');return;}
    if(!/\.pdf$/i.test(file.name)){setMsg('PDFファイルを選択してください。','error');return;}
    setMsg('PDFを解析しています…');
    try{
      const r=await parseFile(file),selected=String(document.getElementById('plan-year-sel')?.value||'');
      if(selected&&selected!==String(r.fiscalYear)){throw new Error(`選択年度は${selected}年度ですが、PDFは${r.fiscalYear}年度です。年度を確認してください。`);}
      if(!window.PLAN?.importParsed)throw new Error('計画保存基盤を読み込めません。');
      const ok=await PLAN.importParsed(r.rows,r.fiscalYear,{source_type:'SKFL0001_PDF',file_name:file.name,center_code:r.centerCode,center_name:r.centerName,item_count:r.itemCount});
      if(ok!==false){setMsg(`${r.fiscalYear}年度 SKFL0001を取込みました（${r.itemCount}科目）`);const input=document.getElementById('plan-pdf-file-input');if(input)input.value='';}
    }catch(e){setMsg(e?.message||String(e),'error');}
  }
  document.addEventListener('DOMContentLoaded',()=>{const input=document.getElementById('plan-pdf-file-input');if(input)input.addEventListener('change',()=>{const n=document.getElementById('plan-pdf-file-name');if(n)n.textContent=input.files?.[0]?.name||'未選択';});});
  window.PLAN_PDF_IMPORT=Object.freeze({parseFile,importSelected});
})();
