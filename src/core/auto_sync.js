/* ════════ §29-A AUTO SYNC（保存・更新時に自動クラウド同期） ════════
   運用方針：
   ・ページを開いた時は CLOUD.pull() でクラウド → ローカルを反映する
   ・CSV取込・削除・補完・計画更新などで STORE.save() が走ったら、自動でクラウドへ保存する
   ・自動保存では syncSmart（双方向同期）を使わない。保存のたびに pull すると重くなり、古いクラウド/ローカルとの再マージで復活事故が起きるため。
   ・自動保存は pushAll（ローカル → クラウド）のみ。削除済みマーカーも full_state/manifest に必ず入る。
*/
var AUTO_SYNC = window.AUTO_SYNC = {
  _timer: null,
  _installed: false,
  _suppress: false,
  _running: false,
  _pending: false,
  _lastError: '',
  delayMs: 1800,

  install() {
    if (this._installed) return;
    if (typeof STORE === 'undefined' || !STORE || STORE._autoSyncInstalled) return;

    const originalSave = STORE.save.bind(STORE);

    STORE.save = (...args) => {
      const result = originalSave(...args);

      // クラウド取得・復元中のローカル保存では、再アップロードを予約しない
      if (!AUTO_SYNC._suppress) {
        AUTO_SYNC.queue('STORE.save');
      }

      return result;
    };

    STORE._autoSyncInstalled = true;
    this._installed = true;
  },

  queue(reason='auto') {
    if (this._suppress) return;
    if (typeof CLOUD === 'undefined' || !CLOUD || typeof CLOUD.pushAll !== 'function') return;

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(reason), this.delayMs);
  },

  async flush(reason='auto') {
    if (this._suppress) return { ok:false, error:'suppress中' };
    if (this._running) {
      this._pending = true;
      return { ok:false, error:'同期中のため再予約' };
    }
    if (typeof CLOUD === 'undefined' || !CLOUD || typeof CLOUD.pushAll !== 'function') return { ok:false, error:'CLOUD未設定' };

    this._running = true;
    this._pending = false;
    this._lastError = '';

    try {
      UI.updateCloudBadge && UI.updateCloudBadge('configured');
      const r = await CLOUD.pushAll();
      if (r && r.ok) {
        UI.updateSaveStatus && UI.updateSaveStatus();
        UI.updateCloudBadge && UI.updateCloudBadge('ok');
        return r;
      }
      this._lastError = r?.error || '自動同期失敗';
      UI.updateCloudBadge && UI.updateCloudBadge('error');
      return r || { ok:false, error:this._lastError };
    } catch(e) {
      this._lastError = e?.message || String(e);
      UI.updateCloudBadge && UI.updateCloudBadge('error');
      return { ok:false, error:this._lastError };
    } finally {
      this._running = false;
      if (this._pending && !this._suppress) {
        this._pending = false;
        this.queue('pending');
      }
    }
  },

  withoutSync(fn) {
    this._suppress = true;
    try {
      return fn();
    } finally {
      this._suppress = false;
    }
  },

  async withoutSyncAsync(fn) {
    this._suppress = true;
    try {
      return await fn();
    } finally {
      this._suppress = false;
    }
  }
};
