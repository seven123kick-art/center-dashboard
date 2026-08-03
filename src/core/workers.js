/* workers.js : 作業者マスタ（作業者コード＋会社コード） */
'use strict';
(function(){
  if (window.WORKERS) return;

  const exact=v=>String(v??'');
  const esc=v=>exact(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list=()=>Array.isArray(STATE.workerMaster)?STATE.workerMaster:(STATE.workerMaster=[]);

  const DEFAULTS=[
    // 1302 ソルビーナ
    ['1302777','クレーン','1302',false],['1302997','習志野リサイクル','1302',false],['1302998','戸田共同','1302',false],['1302999','内田','1302',true],
    ['9000070','ソルビーナ','1302',false],['9000571','加藤　優也','1302',true],['9000572','秋元　巧','1302',true],['9000579','寺内　大輔','1302',true],['9000580','長谷川　修士','1302',true],['9000581','小磯　樹生','1302',true],['9000582','庄司　竜一','1302',true],['9000583','青木　翔太','1302',true],['9000584','荒木　光','1302',true],['9000585','田沼　基樹','1302',true],['9000586','小磯　有輝','1302',true],['9000587','清水　剛','1302',true],['9000588','エディオン配送','1302',false],['9000589','唐橋　裕希','1302',true],['9000600','関根　太郎','1302',true],['9000601','天野　十夢','1302',true],['9000602','戸塚　慧斗','1302',true],['9000603','松村　稜太','1302',true],['9000800','岡本　壮大','1302',true],
    // 0839 ウェザーリポート（画像で確認できた分）
    ['9000555','廃番','0839',false],['9000556','廃番','0839',false],['9000560','廃番','0839',false],['9000590','根岸　大輔','0839',true],['9000591','内田　広道','0839',true],['9000592','伊東　代樹','0839',true],['9000593','関根　迅人','0839',true],['9000594','廃番','0839',false],['9000595','廃番','0839',false],['9000596','廃番','0839',false],['9000597','廃番','0839',false],['9000598','松尾　青木','0839',true],['9000599','名古谷　翔太','0839',true],['9000604','武村　知','0839',true],['9000607','渡井　政光','0839',true],
    // 0054 今村運送
    ['9000050','ソノベ','0054',true],['9000051','寺西　陽水','0054',true],['9000052','矢吹　謙一','0054',true],['9000053','我孫子　将佳','0054',true],['9000054','鈴木　大和','0054',true],
    // 0052 ケーズシステム
    ['9000250','金子　直樹','0052',true],['9000252','丸山　慧','0052',true],['9000253','小島　和幸','0052',true],['9000254','髙橋　正樹','0052',true],['9000255','鈴木　正樹','0052',true],['9000260','塩原　光耶','0052',true],['9000261','久米　健太','0052',true],['9000262','加藤　澄也','0052',true],['9000263','冨田　雄介','0052',true],['9000264','鈴木　良樹','0052',true],['9000265','岩村　直也','0052',true],['9000266','鈴木　雄大','0052',true],['9000267','梅澤　隼','0052',true],['9000268','奴田原','0052',true],['9000270','佐野　晃史','0052',true],['9000271','近藤　輝','0052',true],['9000272','内山　慎也','0052',true],['9000273','柿島　敏広','0052',true],['9000274','前野　彼方','0052',true],['9000275','加藤','0052',true],['9000276','梅津　翔','0052',true],['900250','廃番','0052',false],['900252','廃番','0052',false],['900255','廃番','0052',false],['900260','廃番','0052',false],['900261','廃番','0052',false],['900265','冨永　裕貴','0052',true],['900266','畠山　真成','0052',true],
    // 0226 M&S
    ['9000001','M&S','0226',false],
    // 0448 TriValue
    ['0488001','ＴｒｉＶａｌｕｅ','0448',false],
    // 0000 自社（画像で確認できた分）
    ['0040126','長嶺　雄一','0000',true],['0082104','でんきちチャーター','0000',false],['0082422','竹上　正人','0000',true],['0083194','加藤　伸明','0000',true],['0084506','返品','0000',false],['0084638','未完了処理','0000',false],['0093394','リサ券店舗返却済み','0000',false],['0101524','金子　貴行','0000',true],['0101532','でんきち返品','0000',false],['0102318','中野　典明','0000',true],['0102326','助手','0000',false],['0102989','大沼　智裕','0000',true],['0104639','北さいたまセンター','0000',false],['0112623','榎本　明子','0000',true],['0112682','エアコン　岡戸','0000',false],['0113158','長谷川　翔','0000',true],['0113166','M&Sエディオン','0000',false],['0113174','染谷　タカシ','0000',true],['0114987','浅川　健','0000',true],['0120308','エアコン　AKI','0000',false],['0120472','塩坂　智穂','0000',true],['0122866','エアコン　西神','0000',false],['0133285','エアコン　日伸','0000',false],['0134945','橋本（群馬）','0000',true],['0143545','エアコン　小宮','0000',false],['0152552','田村　美弥子','0000',true],['0152579','ビック返品','0000',false],['0153524','廃盤','0000',false],['0160539','三浦　浩一','0000',true],['0160598','フジトラリサイクル','0000',false],['0171646','梅野　峻男','0000',true],['0171654','石井　秀雄','0000',true],['0171662','吉田　達臣','0000',true],['0171689','木村　圭太','0000',true],['0171697','藤本　隼也','0000',true],['0171719','神田　義貴','0000',true],['0180343','梅山　一也','0000',true],['0193518','関口　透','0000',true],['0194336','河本　龍哉','0000',true],['0231401','高橋　康子','0000',true],['0232092','岩崎　早紀','0000',true],['0241008','田澤　秀行','0000',true],['0242063','菊池　悠介','0000',true],['0391638','舘野　慶信','0000',true],
    // 1337 スリーエス・サンキュウ
    ['9000998','ＳＳＳ（ロイヤル）','1337',false],['9000999','ＳＳＳ（でんきち）','1337',false]
  ].map(([workerCode,workerName,companyCode,analysisTarget])=>({workerCode,workerName,companyCode,analysisTarget}));

  function normalize(rec={}){
    const company=window.COMPANIES?.find?COMPANIES.find(rec.companyCode):null;
    return {
      workerCode:exact(rec.workerCode),
      workerName:exact(rec.workerName),
      companyCode:exact(rec.companyCode).padStart(4,'0'),
      companyName:company?.companyName||exact(rec.companyName),
      operationType:company?.operationType||exact(rec.operationType)||'自社',
      analysisTarget:rec.analysisTarget!==false,
      validFrom:exact(rec.validFrom), validTo:exact(rec.validTo),
      updatedAt:rec.updatedAt||new Date().toISOString()
    };
  }

  function ensureDefaults(){
    window.COMPANIES?.ensureDefaults?.();
    const arr=list(); let changed=false;
    for(const seed of DEFAULTS){
      if(!arr.some(r=>(seed.workerCode&&exact(r.workerCode)===seed.workerCode)||exact(r.workerName)===seed.workerName)){
        arr.push(normalize(seed)); changed=true;
      }
    }
    return changed;
  }

  function all(){ensureDefaults();return list().map(normalize).sort((a,b)=>a.companyCode.localeCompare(b.companyCode)||a.workerName.localeCompare(b.workerName,'ja'));}
  function find(workerName,date=''){
    ensureDefaults(); const name=exact(workerName); if(!name)return null;
    const d=exact(date).replace(/\D/g,'').slice(0,8);
    const candidates=list().filter(r=>exact(r.workerName)===name);
    if(!candidates.length)return null;
    const rec=!d?candidates[0]:(candidates.find(r=>{const f=exact(r.validFrom).replace(/\D/g,'').slice(0,8),t=exact(r.validTo).replace(/\D/g,'').slice(0,8);return(!f||f<=d)&&(!t||d<=t);})||candidates[0]);
    return normalize(rec);
  }
  function findByCode(workerCode){ensureDefaults();const r=list().find(x=>exact(x.workerCode)===exact(workerCode));return r?normalize(r):null;}
  function detectedNames(){const names=new Set();for(const m of(STATE.workerCsvData||[]))for(const w of Object.values(m?.workers||{})){const n=exact(w?.name);if(n)names.add(n);}for(const m of(STATE.routeData||[]))for(const r of(m?.routes||[])){const n=exact(r?.worker);if(n)names.add(n);}return[...names].sort((a,b)=>a.localeCompare(b,'ja'));}
  function unregisteredNames(){ensureDefaults();return detectedNames().filter(name=>!list().some(r=>exact(r.workerName)===name));}
  function save(records){const cleaned=(Array.isArray(records)?records:[]).map(normalize).filter(r=>r.workerName);const codeSeen=new Set();for(const r of cleaned){if(r.workerCode&&codeSeen.has(r.workerCode))throw new Error(`作業者コード「${r.workerCode}」が重複しています。`);if(r.workerCode)codeSeen.add(r.workerCode);}STATE.workerMaster=cleaned;ensureDefaults();Repository.Storage.save();window.LEDGER?.invalidate?.();return all();}

  window.WORKERS={DEFAULTS,all,find,findByCode,detectedNames,unregisteredNames,save,ensureDefaults};

  window.WORKER_MASTER_UI={
    render(){const root=document.getElementById('worker-master-root');if(!root)return;window.COMPANIES?.ensureDefaults?.();ensureDefaults();const records=WORKERS.all(),missing=WORKERS.unregisteredNames(),companies=window.COMPANIES?.all?.()||[];root.innerHTML=`
      <div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn btn-primary" onclick="WORKER_MASTER_UI.showTab('worker')">作業者</button><button class="btn" onclick="WORKER_MASTER_UI.showTab('company')">会社・協力会社</button></div>
      <div id="master-worker-panel"><div class="card" style="margin-bottom:14px;border:2px solid #60a5fa;background:#eff6ff"><div class="card-header"><span class="card-title">👤 作業者マスタ</span><span class="badge badge-info">${records.length}件登録</span></div><div class="card-body" style="font-size:12px;line-height:1.8;color:var(--text2)">作業者コードを主キー、会社コードを所属先キーとして管理します。会社を選択すると運行区分は会社マスタから自動決定されます。</div></div>
      ${missing.length?`<div class="card" style="margin-bottom:14px;border-left:4px solid #f59e0b"><div class="card-body"><strong>未登録の作業者 ${missing.length}名</strong><div style="font-size:11px;color:var(--text3);margin:4px 0 8px">${missing.slice(0,15).map(esc).join('、')}${missing.length>15?' ほか':''}</div><button class="btn btn-primary" onclick="WORKER_MASTER_UI.addDetected()">未登録者を追加</button></div></div>`:''}
      <div class="card"><div class="card-header"><span class="card-title">登録内容</span><div style="display:flex;gap:8px"><button class="btn" onclick="WORKER_MASTER_UI.addRow()">＋ 作業者追加</button><button class="btn btn-primary" onclick="WORKER_MASTER_UI.save()">保存</button></div></div><div class="scroll-x"><table class="tbl" id="worker-master-table"><thead><tr><th>作業者CD</th><th>作業者名</th><th>所属会社</th><th>区分</th><th>分析対象</th><th>有効開始</th><th>有効終了</th><th></th></tr></thead><tbody>${records.map(r=>this.rowHtml(r,companies)).join('')}</tbody></table></div></div></div>
      <div id="master-company-panel" style="display:none"><div id="company-master-root"></div></div>`;
      window.COMPANY_MASTER_UI?.render?.();},
    showTab(tab){const w=document.getElementById('master-worker-panel'),c=document.getElementById('master-company-panel');if(w)w.style.display=tab==='worker'?'block':'none';if(c)c.style.display=tab==='company'?'block':'none';},
    rowHtml(r={},companies=window.COMPANIES?.all?.()||[]){const opts=companies.map(c=>`<option value="${esc(c.companyCode)}" ${r.companyCode===c.companyCode?'selected':''}>${esc(c.companyCode)} ${esc(c.companyName)}</option>`).join('');return `<tr data-worker-row><td><input class="input wm-code" value="${esc(r.workerCode||'')}" style="width:100px"></td><td><input class="input wm-name" value="${esc(r.workerName||'')}" style="min-width:160px"></td><td><select class="input wm-company" onchange="WORKER_MASTER_UI.syncType(this)" style="min-width:240px"><option value="">未設定</option>${opts}</select></td><td class="wm-type-label">${esc(r.operationType||'未設定')}</td><td><input type="checkbox" class="wm-target" ${r.analysisTarget!==false?'checked':''}></td><td><input type="date" class="input wm-from" value="${esc(r.validFrom||'')}"></td><td><input type="date" class="input wm-to" value="${esc(r.validTo||'')}"></td><td><button class="btn" onclick="WORKER_MASTER_UI.removeRow(this)">削除</button></td></tr>`;},
    syncType(sel){const c=window.COMPANIES?.find?.(sel.value);const cell=sel.closest('tr')?.querySelector('.wm-type-label');if(cell)cell.textContent=c?.operationType||'未設定';},
    addRow(record={}){document.querySelector('#worker-master-table tbody')?.insertAdjacentHTML('beforeend',this.rowHtml(record));},
    addDetected(){WORKERS.unregisteredNames().forEach(n=>this.addRow({workerName:n,companyCode:'',analysisTarget:true}));},
    removeRow(btn){btn.closest('tr')?.remove();},
    save(){try{const rows=[...document.querySelectorAll('#worker-master-table tr[data-worker-row]')].map(tr=>({workerCode:tr.querySelector('.wm-code')?.value||'',workerName:tr.querySelector('.wm-name')?.value||'',companyCode:tr.querySelector('.wm-company')?.value||'',analysisTarget:!!tr.querySelector('.wm-target')?.checked,validFrom:tr.querySelector('.wm-from')?.value||'',validTo:tr.querySelector('.wm-to')?.value||''}));WORKERS.save(rows);UI.toast('作業者マスタを保存しました');this.render();}catch(e){UI.toast(e.message||String(e),'error');}}
  };
})();
