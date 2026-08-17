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
  window.STARTUP_READINESS={ setProgress, showFailure, markVerified, withTimeout };
})();
