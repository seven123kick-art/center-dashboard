/* workers.js : 作業者・所属会社・運行区分マスタ */
'use strict';
(function(){
  if (window.WORKERS) return;

  const list = () => Array.isArray(STATE.workerMaster) ? STATE.workerMaster : (STATE.workerMaster = []);
  const exact = v => String(v ?? '');
  const esc = v => exact(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types = ['自社','傭車','M&S','他センター','その他'];

  function normalizeRecord(rec={}){
    return {
      workerName: exact(rec.workerName),
      companyName: exact(rec.companyName),
      operationType: types.includes(rec.operationType) ? rec.operationType : '自社',
      validFrom: exact(rec.validFrom),
      validTo: exact(rec.validTo),
      updatedAt: rec.updatedAt || new Date().toISOString()
    };
  }

  function all(){
    return list().map(normalizeRecord).sort((a,b)=>a.companyName.localeCompare(b.companyName,'ja') || a.workerName.localeCompare(b.workerName,'ja'));
  }

  function find(workerName, date=''){
    const name = exact(workerName);
    if (!name) return null;
    const d = exact(date).replace(/\D/g,'').slice(0,8);
    const candidates = list().filter(r => exact(r?.workerName) === name);
    if (!candidates.length) return null;
    if (!d) return normalizeRecord(candidates[0]);
    return normalizeRecord(candidates.find(r => {
      const from = exact(r.validFrom).replace(/\D/g,'').slice(0,8);
      const to = exact(r.validTo).replace(/\D/g,'').slice(0,8);
      return (!from || from <= d) && (!to || d <= to);
    }) || candidates[0]);
  }

  function detectedNames(){
    const names = new Set();
    for (const month of (STATE.workerCsvData || [])) {
      for (const worker of Object.values(month?.workers || {})) {
        const name = exact(worker?.name);
        if (name) names.add(name);
      }
    }
    for (const month of (STATE.routeData || [])) {
      for (const route of (month?.routes || [])) {
        const name = exact(route?.worker);
        if (name) names.add(name);
      }
    }
    return [...names].sort((a,b)=>a.localeCompare(b,'ja'));
  }

  function unregisteredNames(){
    return detectedNames().filter(name => !list().some(r => exact(r?.workerName) === name));
  }

  function save(records){
    const cleaned = (Array.isArray(records) ? records : [])
      .map(normalizeRecord)
      .filter(r => r.workerName);
    const seen = new Set();
    for (const r of cleaned) {
      const key = `${r.workerName}|${r.validFrom}|${r.validTo}`;
      if (seen.has(key)) throw new Error(`作業者「${r.workerName}」の有効期間が重複しています。`);
      seen.add(key);
    }
    STATE.workerMaster = cleaned;
    STORE.save();
    if (window.LEDGER?.invalidate) LEDGER.invalidate();
    return cleaned;
  }

  window.WORKERS = { all, find, detectedNames, unregisteredNames, save, types };

  window.WORKER_MASTER_UI = {
    render(){
      const root=document.getElementById('worker-master-root');
      if(!root) return;
      const records=WORKERS.all();
      const missing=WORKERS.unregisteredNames();
      root.innerHTML=`
        <div class="card" style="margin-bottom:14px;border:2px solid #60a5fa;background:#eff6ff">
          <div class="card-header"><span class="card-title">👤 作業者マスタ</span><span class="badge badge-info">${records.length}名登録</span></div>
          <div class="card-body" style="font-size:12px;line-height:1.8;color:var(--text2)">
            作業者名を基準に、所属会社と運行区分を管理します。作業者名は登録済みの正式名称をそのまま使用し、文字列の自動変換や表記補正は行いません。<br>
            分析は「所属会社 → 作業者 → 便 → 原票」の順で集計します。
          </div>
        </div>
        ${missing.length ? `<div class="card" style="margin-bottom:14px;border-left:4px solid #f59e0b"><div class="card-body" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><strong>未登録の作業者 ${missing.length}名</strong><div style="font-size:11px;color:var(--text3);margin-top:4px">${missing.slice(0,10).map(esc).join('、')}${missing.length>10?' ほか':''}</div></div><button class="btn btn-primary" onclick="WORKER_MASTER_UI.addDetected()">未登録者を追加</button></div></div>` : ''}
        <div class="card">
          <div class="card-header"><span class="card-title">登録内容</span><div style="display:flex;gap:8px"><button class="btn" onclick="WORKER_MASTER_UI.addRow()">＋ 作業者追加</button><button class="btn btn-primary" onclick="WORKER_MASTER_UI.save()">保存</button></div></div>
          <div class="scroll-x"><table class="tbl" id="worker-master-table">
            <thead><tr><th>作業者名</th><th>所属会社</th><th>運行区分</th><th>有効開始</th><th>有効終了</th><th></th></tr></thead>
            <tbody>${records.length ? records.map((r,i)=>this.rowHtml(r,i)).join('') : `<tr data-empty><td colspan="6" style="padding:24px;text-align:center;color:var(--text3)">作業者が未登録です。「未登録者を追加」または「作業者追加」から登録してください。</td></tr>`}</tbody>
          </table></div>
          <div class="card-body" style="font-size:11px;color:var(--text3)">同じ作業者が所属変更した場合は、有効期間を分けて複数行登録できます。</div>
        </div>`;
    },
    rowHtml(r={},i=0){
      const opts=WORKERS.types.map(t=>`<option value="${esc(t)}" ${r.operationType===t?'selected':''}>${esc(t)}</option>`).join('');
      return `<tr data-worker-row><td><input class="input wm-name" value="${esc(r.workerName||'')}" style="min-width:150px"></td><td><input class="input wm-company" value="${esc(r.companyName||'')}" placeholder="例：エスラインギフ／ソルビーナ" style="min-width:190px"></td><td><select class="input wm-type">${opts}</select></td><td><input type="date" class="input wm-from" value="${esc(r.validFrom||'')}"></td><td><input type="date" class="input wm-to" value="${esc(r.validTo||'')}"></td><td><button class="btn" onclick="WORKER_MASTER_UI.removeRow(this)" style="font-size:11px">削除</button></td></tr>`;
    },
    addRow(record={}){
      const tbody=document.querySelector('#worker-master-table tbody');
      if(!tbody) return;
      tbody.querySelector('[data-empty]')?.remove();
      tbody.insertAdjacentHTML('beforeend',this.rowHtml(record,tbody.children.length));
    },
    addDetected(){
      const missing=WORKERS.unregisteredNames();
      missing.forEach(name=>this.addRow({workerName:name,companyName:'',operationType:'自社'}));
      document.querySelector('.card[style*="border-left:4px"]')?.remove();
    },
    removeRow(btn){ btn.closest('tr')?.remove(); },
    save(){
      try{
        const rows=[...document.querySelectorAll('#worker-master-table tbody tr[data-worker-row]')].map(tr=>({
          workerName:tr.querySelector('.wm-name')?.value || '',
          companyName:tr.querySelector('.wm-company')?.value || '',
          operationType:tr.querySelector('.wm-type')?.value || '自社',
          validFrom:tr.querySelector('.wm-from')?.value || '',
          validTo:tr.querySelector('.wm-to')?.value || ''
        }));
        WORKERS.save(rows);
        UI.toast('作業者マスタを保存しました');
        this.render();
      }catch(e){ UI.toast(e.message || String(e),'error'); }
    }
  };
})();
