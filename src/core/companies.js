/* companies.js : 会社マスタ（会社コードを内部キーに使用） */
'use strict';
(function(){
  if (window.COMPANIES) return;

  const TYPES = ['自社','傭車','委託','M&S','他センター','その他'];
  const DEFAULTS = [
    {companyCode:'0000', companyName:'エスラインギフ', operationType:'自社'},
    {companyCode:'0052', companyName:'㈱ケーズシステム', operationType:'傭車'},
    {companyCode:'0054', companyName:'今村運送㈱', operationType:'傭車'},
    {companyCode:'0152', companyName:'GAサポート', operationType:'委託'},
    {companyCode:'0226', companyName:'㈱M&Sコーポレーション', operationType:'M&S'},
    {companyCode:'0448', companyName:'ＴｒｉＶａｌｕｅ㈱', operationType:'傭車'},
    {companyCode:'0839', companyName:'㈲ウェザーリポート', operationType:'傭車'},
    {companyCode:'1302', companyName:'㈱ソルビーナ', operationType:'傭車'},
    {companyCode:'1337', companyName:'㈱スリーエス・サンキュウ 仙台営業所', operationType:'傭車'}
  ];

  const exact = v => String(v ?? '');
  const code = v => exact(v).padStart(4,'0');
  const esc = v => exact(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = () => Array.isArray(STATE.companyMaster) ? STATE.companyMaster : (STATE.companyMaster=[]);

  function normalize(rec={}){
    return {
      companyCode: code(rec.companyCode),
      companyName: exact(rec.companyName),
      operationType: TYPES.includes(rec.operationType) ? rec.operationType : '傭車',
      active: rec.active !== false,
      updatedAt: rec.updatedAt || new Date().toISOString()
    };
  }

  function ensureDefaults(){
    const arr=list();
    let changed=false;
    for(const seed of DEFAULTS){
      if(!arr.some(r=>code(r.companyCode)===seed.companyCode)){
        arr.push(normalize(seed)); changed=true;
      }
    }
    return changed;
  }

  function all(){ ensureDefaults(); return list().map(normalize).sort((a,b)=>a.companyCode.localeCompare(b.companyCode)); }
  function find(companyCode){ ensureDefaults(); const c=code(companyCode); const r=list().find(x=>code(x.companyCode)===c); return r?normalize(r):null; }
  function save(records){
    const cleaned=(Array.isArray(records)?records:[]).map(normalize).filter(r=>r.companyCode&&r.companyName);
    const seen=new Set();
    for(const r of cleaned){ if(seen.has(r.companyCode)) throw new Error(`会社コード「${r.companyCode}」が重複しています。`); seen.add(r.companyCode); }
    STATE.companyMaster=cleaned;
    ensureDefaults();
    STORE.save();
    if(window.LEDGER?.invalidate) LEDGER.invalidate();
    return all();
  }

  window.COMPANIES={TYPES,DEFAULTS,all,find,save,ensureDefaults};

  window.COMPANY_MASTER_UI={
    render(){
      const root=document.getElementById('company-master-root'); if(!root) return;
      const rows=COMPANIES.all();
      root.innerHTML=`<div class="card" style="margin-bottom:14px;border:2px solid #60a5fa;background:#eff6ff"><div class="card-header"><span class="card-title">🏢 会社マスタ</span><span class="badge badge-info">${rows.length}社登録</span></div><div class="card-body" style="font-size:12px;line-height:1.8;color:var(--text2)">会社コードを内部キーとして管理します。作業者はこの会社マスタから所属先を選択し、運行区分は会社側から自動設定されます。</div></div>
      <div class="card"><div class="card-header"><span class="card-title">登録内容</span><div style="display:flex;gap:8px"><button class="btn" onclick="COMPANY_MASTER_UI.addRow()">＋ 会社追加</button><button class="btn btn-primary" onclick="COMPANY_MASTER_UI.save()">保存</button></div></div><div class="scroll-x"><table class="tbl" id="company-master-table"><thead><tr><th>会社CD</th><th>会社名</th><th>区分</th><th>有効</th><th></th></tr></thead><tbody>${rows.map(r=>this.rowHtml(r)).join('')}</tbody></table></div></div>`;
    },
    rowHtml(r={}){ const opts=COMPANIES.TYPES.map(t=>`<option value="${esc(t)}" ${r.operationType===t?'selected':''}>${esc(t)}</option>`).join(''); return `<tr data-company-row><td><input class="input cm-code" value="${esc(r.companyCode||'')}" maxlength="4" style="width:90px"></td><td><input class="input cm-name" value="${esc(r.companyName||'')}" style="min-width:260px"></td><td><select class="input cm-type">${opts}</select></td><td><input type="checkbox" class="cm-active" ${r.active!==false?'checked':''}></td><td><button class="btn" onclick="COMPANY_MASTER_UI.removeRow(this)">削除</button></td></tr>`; },
    addRow(){ document.querySelector('#company-master-table tbody')?.insertAdjacentHTML('beforeend',this.rowHtml({companyCode:'',companyName:'',operationType:'傭車',active:true})); },
    removeRow(btn){ btn.closest('tr')?.remove(); },
    save(){ try{ const rows=[...document.querySelectorAll('#company-master-table tr[data-company-row]')].map(tr=>({companyCode:tr.querySelector('.cm-code')?.value||'',companyName:tr.querySelector('.cm-name')?.value||'',operationType:tr.querySelector('.cm-type')?.value||'傭車',active:!!tr.querySelector('.cm-active')?.checked})); COMPANIES.save(rows); UI.toast('会社マスタを保存しました'); this.render(); window.WORKER_MASTER_UI?.render(); }catch(e){UI.toast(e.message||String(e),'error');} }
  };
})();
