/* Version6 Startup Readiness Gate
   数値画面は、起動時の主要Cloud同期が正常完了した後だけ表示する。
   キャッシュ値を先に見せて後から差し替える動作は禁止する。 */
(function(){
  'use strict';

  const STAGE_LABELS = {
    MANIFEST:'クラウド登録状態', FULL_STATE:'主要状態データ', DATASET:'月次収支データ',
    PLAN:'予算データ', CAPACITY:'キャパデータ', DAILY_RECORDS:'日次データ', BOOT:'起動処理'
  };

  function el(id){ return document.getElementById(id); }
  function setProgress(step, message, detail){
    if (message && el('app-loading-message')) el('app-loading-message').textContent = message;
    if (detail && el('app-loading-detail')) el('app-loading-detail').textContent = detail;
    for(let i=1;i<=4;i++) el('app-loading-step-'+i)?.classList.toggle('active', i <= step);
  }
  function formatTime(iso){
    if(!iso) return '';
    try { return new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(iso)); }
    catch(e){ return ''; }
  }
  function ensureDialog(){
    let host=el('startup-readiness-dialog');
    if(host) return host;
    host=document.createElement('div');
    host.id='startup-readiness-dialog';
    host.className='startup-readiness-dialog';
    host.hidden=true;
    host.innerHTML=`<div class="startup-readiness-panel" role="alertdialog" aria-modal="true" aria-labelledby="startup-readiness-title">
      <div class="startup-readiness-mark">!</div>
      <h2 id="startup-readiness-title">最新データを確認できませんでした</h2>
      <p id="startup-readiness-message"></p>
      <div class="startup-readiness-facts" id="startup-readiness-facts"></div>
      <p class="startup-readiness-note">最新性を保証できないため、経営数値は表示していません。</p>
      <div class="startup-readiness-actions">
        <button type="button" class="btn btn-primary" id="startup-readiness-retry">再読み込み</button>
        <button type="button" class="btn btn-secondary" id="startup-readiness-back">センター選択へ戻る</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    el('startup-readiness-retry').onclick=()=>location.reload();
    el('startup-readiness-back').onclick=()=>location.href='index.html';
    return host;
  }
  function showFailure(result){
    const host=ensureDialog();
    const stage=STAGE_LABELS[result?.stage] || '主要データ';
    const state=result?.readiness || 'LOAD_FAILED';
    const msg = state === 'MISSING'
      ? `${stage}がクラウド上で確認できません。`
      : `${stage}の読み込みを正常に完了できませんでした。`;
    el('startup-readiness-message').textContent=msg;
    const detail=result?.error ? String(result.error) : '原因を確認できませんでした。';
    const ym=result?.ym ? `<div><span>対象月</span><strong>${String(result.ym).replace(/^(\d{4})(\d{2})$/,'$1/$2')}</strong></div>` : '';
    el('startup-readiness-facts').innerHTML=`<div><span>状態</span><strong>${state}</strong></div><div><span>確認箇所</span><strong>${stage}</strong></div>${ym}<div class="startup-readiness-error"><span>詳細</span><strong></strong></div>`;
    const strong=el('startup-readiness-facts').querySelector('.startup-readiness-error strong');
    if(strong) strong.textContent=detail;
    host.hidden=false;
    setProgress(4,'データ確認に失敗しました','内容を確認して再読み込みしてください。');
  }
  function markVerified(iso){
    const at=iso || new Date().toISOString();
    window.APP_BOOT_STATE = window.APP_BOOT_STATE || {};
    window.APP_BOOT_STATE.displayVerified = true;
    window.APP_BOOT_STATE.displaySnapshotAt = at;
    const badge=el('data-readiness-badge');
    if(badge){
      badge.hidden=false;
      badge.classList.add('is-ready');
      badge.textContent=`● データ確認済 ${formatTime(at)}`;
      badge.title='起動時の主要クラウドデータを正常に読み込み、この表示スナップショットを確定しました。';
    }
  }
  async function withTimeout(factory, ms=45000){
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(factory),
        new Promise(resolve=>{ timer=setTimeout(()=>resolve({ok:false,stage:'BOOT',readiness:'LOAD_FAILED',error:`${Math.round(ms/1000)}秒以内に主要データの確認が完了しませんでした`}),ms); })
      ]);
    } finally { if(timer) clearTimeout(timer); }
  }
  function manifestFingerprint(manifest){
    if(!manifest || typeof manifest !== 'object') return '';
    const datasets=(Array.isArray(manifest.datasets)?manifest.datasets:[])
      .filter(x=>x&&x.ym)
      .map(x=>({ym:String(x.ym),type:String(x.type||'confirmed'),importedAt:x.importedAt||x.updatedAt||null}))
      .sort((a,b)=>(a.ym+a.type).localeCompare(b.ym+b.type));
    const workers=(Array.isArray(manifest.workerCsvData)?manifest.workerCsvData:[])
      .filter(x=>x&&x.ym).map(x=>({ym:String(x.ym),importedAt:x.importedAt||x.updatedAt||x.savedAt||null}))
      .sort((a,b)=>a.ym.localeCompare(b.ym));
    const products=(Array.isArray(manifest.productAddressData)?manifest.productAddressData:[])
      .filter(x=>x&&x.ym).map(x=>({ym:String(x.ym),importedAt:x.importedAt||x.updatedAt||x.savedAt||null}))
      .sort((a,b)=>a.ym.localeCompare(b.ym));
    return JSON.stringify({
      // 通常manifest(v33+)はsavedAt自体がCloud更新Revision。
      // DBフォールバックmanifest(v32)はsavedAtが再構築時刻なので使用せず、
      // DB rowのupdated_atから作った各Revisionを使う。
      version:manifest.version||null,
      manifestRevision:Number(manifest.version||0)>=33 ? (manifest.savedAt||null) : null,
      fullStateUpdatedAt:manifest.fullStateUpdatedAt||null,
      datasets, workers, products,
      hasPlanData:!!manifest.hasPlanData, planDataUpdatedAt:manifest.planDataUpdatedAt||null,
      hasCapacity:!!manifest.hasCapacity, capacityUpdatedAt:manifest.capacityUpdatedAt||null,
      hasDailyRecords:!!manifest.hasDailyRecords
    });
  }
  function localMatchesManifest(manifest){
    if(!manifest || !window.STATE) return false;
    const ds=Array.isArray(STATE.datasets)?STATE.datasets:[];
    const num=v=>Number.isFinite(Number(v))?Number(v):0;
    for(const m of (Array.isArray(manifest.datasets)?manifest.datasets:[])){
      if(!m?.ym) continue;
      const type=m.type||'confirmed';
      const local=ds.find(x=>x&&x.ym===m.ym&&(x.type||'confirmed')===type);
      if(!local) return false;
      // DB由来Manifestではrow.updated_atとSOURCE内importedAtが異なる場合がある。
      // importedAtの大小だけで再取得判定せず、Manifestにある会計サマリーと
      // ローカル実体が一致することを検証する。これにより確定済み月の無駄な再取得を防ぐ。
      if ('totalIncome' in m && num(local.totalIncome)!==num(m.totalIncome)) return false;
      if ('totalExpense' in m && num(local.totalExpense)!==num(m.totalExpense)) return false;
      if ('profit' in m && num(local.profit)!==num(m.profit)) return false;
    }
    if(manifest.hasPlanData && !(STATE.planData && Object.keys(STATE.planData).length)) return false;
    if(manifest.hasCapacity && !STATE.capacity) return false;
    if(manifest.hasDailyRecords && !(Array.isArray(STATE.dailyRecords)&&STATE.dailyRecords.length)) return false;
    return true;
  }
  async function getVerifiedMarker(){
    if(!window.IDB_CACHE?.get) return null;
    return IDB_CACHE.get('startup','verified_manifest');
  }
  async function saveVerifiedMarker(manifest, verifiedAt){
    if(!window.IDB_CACHE?.set) return false;
    return IDB_CACHE.set('startup','verified_manifest',{
      centerId:window.CENTER?.id||null,
      fingerprint:manifestFingerprint(manifest),
      verifiedAt:verifiedAt||new Date().toISOString()
    });
  }
  async function canUseVerifiedLocal(manifest){
    const marker=await getVerifiedMarker();
    if(!marker || marker.centerId!==window.CENTER?.id) return false;
    if(marker.fingerprint!==manifestFingerprint(manifest)) return false;
    return localMatchesManifest(manifest);
  }
  window.STARTUP_READINESS={ setProgress, showFailure, markVerified, withTimeout,
    manifestFingerprint, localMatchesManifest, getVerifiedMarker, saveVerifiedMarker, canUseVerifiedLocal };
})();
