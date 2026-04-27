// ===== 取込区分 手動選択版 =====
'use strict';

// 取込区分を手動選択（速報/確定のみ）
function getImportType(){
  const val = document.querySelector('input[name="import-type"]:checked');
  return val ? val.value : 'confirmed';
}

// ポップ中央表示
function showImportModal(){
  let modal = document.getElementById('import-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'import-modal';
    modal.style = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.4);z-index:9999;
    `;
    modal.innerHTML = `
      <div style="background:#fff;padding:20px;border-radius:8px;width:300px;text-align:center">
        <h3>取込区分</h3>
        <label><input type="radio" name="import-type" value="confirmed" checked> 確定値</label><br>
        <label><input type="radio" name="import-type" value="daily"> 速報値</label><br><br>
        <button onclick="confirmImport()">OK</button>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display='flex';
  }
}

function closeImportModal(){
  const modal = document.getElementById('import-modal');
  if(modal) modal.style.display='none';
}

let _pendingFiles = null;
let _pendingYM = null;

// 元の処理をフック
const _origHandle = IMPORT.handleFiles;
IMPORT.handleFiles = function(files){
  const arr = Array.from(files).filter(f=>/\.csv$/i.test(f.name));
  if(!arr.length) return _origHandle(files);

  _pendingFiles = arr;
  _pendingYM = null;
  showImportModal();
};

window.confirmImport = function(){
  closeImportModal();
  IMPORT._pending = _pendingFiles;
  MODAL.openYM(_pendingFiles);
};

// YM確定後に区分反映
const _origProcess = IMPORT.processCSV;
IMPORT.processCSV = async function(files, ym, opt={}){
  const type = getImportType(); // ←ここが重要

  for (const f of files) {
    const text = await CSV.read(f);
    const rows = CSV.parseSKDL(text, null);
    if (!rows) continue;

    const ds = processDataset(ym, type, rows);
    ds.source = 'csv';
    ds.fileName = f.name;
    ds.fiscalYear = fiscalYearFromYM(ym);

    STATE.datasets = STATE.datasets.filter(d=>d.ym !== ym);
    upsertDataset(ds);
  }

  STORE.save();
  NAV.refresh();
};

// 年度別状況表示
function renderStatus(){
  const el = document.getElementById('import-status');
  if(!el) return;

  const map = {};

  (STATE.datasets||[]).forEach(d=>{
    const fy = d.fiscalYear || fiscalYearFromYM(d.ym);
    if(!map[fy]) map[fy] = {confirmed:0,daily:0};

    if(d.type==='confirmed') map[fy].confirmed++;
    if(d.type==='daily') map[fy].daily++;
  });

  el.innerHTML = Object.keys(map).sort().map(fy=>{
    return `
      <div>
        ${fy}年度：
        確定 ${map[fy].confirmed}ヶ月 /
        速報 ${map[fy].daily}ヶ月
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', ()=>{
  setTimeout(renderStatus,0);
});
