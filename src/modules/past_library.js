/* =====================================================================
   経営管理システム past_library.js
   2026-07-23
   ・過去ライブラリ（§24 PAST_LIBRARY）をapp.jsから分離
   ・ファイル本体はStorage、台帳はfull_stateに保存する仕様は変更なし
   ・fmtFileSizeはこのモジュール内でのみ使用するローカル関数として同梱
   ・STATE / STORE / CLOUD / UI / esc等の共通関数はapp.js側を使用
===================================================================== */
'use strict';

(function(){
  if (window.__PAST_LIBRARY_MODULE_LOADED_20260723__) return;
  window.__PAST_LIBRARY_MODULE_LOADED_20260723__ = true;

window.PAST_LIBRARY = {
  _selectedFile: null,
  _bulkFiles: [],

  handleBulkFiles(files) {
    this._bulkFiles = Array.from(files || []);
    const msg = document.getElementById('library-bulk-msg');
    const prev = document.getElementById('library-bulk-preview');
    if (msg) msg.textContent = `${this._bulkFiles.length}件選択しました`;
    if (prev) {
      prev.style.display = this._bulkFiles.length ? 'block' : 'none';
      prev.innerHTML = this._bulkFiles.map((f, idx) => `
        <div style="padding:7px 10px;border-bottom:1px solid var(--border,#d9dee8);font-size:12px">
          ${idx+1}. ${esc(f.name)} <span style="color:var(--text3)">(${fmtFileSize(f.size)})</span>
        </div>
      `).join('');
    }
  },

  async saveBulkSelected() {
    if (!this._bulkFiles.length) { UI.toast('一括登録するファイルを選択してください','warn'); return; }

    const cat = document.getElementById('library-bulk-category')?.value || 'その他';
    const fy  = document.getElementById('library-bulk-fy')?.value || getDefaultFiscalYear();
    const mm  = document.getElementById('library-bulk-month')?.value || '';
    const autoTitle = document.getElementById('library-bulk-auto-title')?.checked !== false;

    let saved = 0;
    for (const file of this._bulkFiles) {
      try {
        const storagePath = CLOUD.libraryFileKey(file.name, fy);
        await CLOUD_REPOSITORY.uploadFile(storagePath, file);

        STATE.library.push({
          id: Date.now() + saved,
          title: autoTitle ? file.name.replace(/\.[^.]+$/, '') : file.name,
          category: cat,
          fiscalYear: fy,
          month: mm,
          memo: '',
          content: '',
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || '',
          storagePath,
          savedAt: new Date().toISOString()
        });
        saved++;
      } catch(e) {
        UI.toast(`${file.name} のアップロードに失敗: ${e.message}`, 'error');
      }
    }

    if (saved) {
      Repository.Storage.save();
      this.renderList();
      UI.toast(`${saved}件の過去資料を保存しました`);
    }
    this.clearBulk();
  },

  clearBulk() {
    this._bulkFiles = [];
    const input = document.getElementById('library-bulk-file-input');
    if (input) input.value = '';
    const msg = document.getElementById('library-bulk-msg');
    if (msg) msg.textContent = '';
    const prev = document.getElementById('library-bulk-preview');
    if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
  },

  handleFile(file) {
    this._selectedFile = file || null;
    const st = document.getElementById('library-file-status');
    if (st) {
      st.textContent = file
        ? `選択: ${file.name}（${fmtFileSize(file.size)}） ※本体はStorage、台帳はfull_stateに保存`
        : '';
    }

    const title = document.getElementById('library-title');
    if (file && title && !title.value) title.value = file.name.replace(/\.[^.]+$/, '');
  },

  async save() {
    const title = document.getElementById('library-title')?.value;
    const cat   = document.getElementById('library-category')?.value;
    const fy    = document.getElementById('library-fy')?.value || getDefaultFiscalYear();
    const mm    = document.getElementById('library-month')?.value || '';
    const memo  = document.getElementById('library-memo')?.value;
    const content = document.getElementById('library-content')?.value;

    if (!title) { UI.toast('資料名を入力してください','warn'); return; }

    let fileMeta = {};
    if (this._selectedFile) {
      try {
        const file = this._selectedFile;
        const storagePath = CLOUD.libraryFileKey(file.name, fy);
        await CLOUD_REPOSITORY.uploadFile(storagePath, file);
        fileMeta = {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || '',
          storagePath
        };
      } catch(e) {
        UI.toast('ファイル本体のアップロードに失敗しました: ' + e.message, 'error');
        return;
      }
    }

    STATE.library.push({
      id: Date.now(),
      title,
      category: cat,
      fiscalYear: fy,
      month: mm,
      memo,
      content,
      ...fileMeta,
      savedAt: new Date().toISOString()
    });

    Repository.Storage.save();
    this.renderList();
    UI.toast('過去資料を保存しました');
    this.clearForm();
  },

  clearForm() {
    ['library-title','library-memo','library-content'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    this._selectedFile = null;
    const input = document.getElementById('library-file-input');
    if (input) input.value = '';
    const st = document.getElementById('library-file-status');
    if (st) st.textContent = '';
  },

  renderList() {
    const list = document.getElementById('library-list');
    const filter = document.getElementById('library-filter-category')?.value||'';
    if (!list) return;
    const items = STATE.library.filter(i=>!filter||i.category===filter);
    if (!items.length) {
      list.innerHTML='<div style="padding:12px 16px;font-size:12px;color:var(--text3)">まだ過去資料がありません</div>';
      return;
    }

    list.innerHTML = items.map(i=>`
      <div class="data-item">
        <span class="badge badge-info">${esc(i.category||'—')}</span>
        <span style="flex:1">
          ${esc(i.title)}
          ${i.fileName ? `<span style="font-size:10px;color:var(--text3);margin-left:6px">📎 ${esc(i.fileName)} / ${fmtFileSize(i.fileSize)}</span>` : ''}
        </span>
        <span style="font-size:10px;color:var(--text3)">${(i.savedAt||'').slice(0,10)}</span>
        ${i.storagePath ? `<button class="btn" onclick="PAST_LIBRARY.openFile(${i.id})" style="font-size:11px;padding:2px 8px">開く</button>` : ''}
        <button class="btn btn-danger" onclick="PAST_LIBRARY.delete(${i.id})" style="font-size:11px;padding:2px 8px">削除</button>
      </div>`).join('');
  },

  async openFile(id) {
    const item = STATE.library.find(i => i.id === id);
    if (!item || !item.storagePath) { UI.toast('ファイル本体がありません','warn'); return; }

    const url = await CLOUD_REPOSITORY.createSignedUrl(item.storagePath);
    if (!url) { UI.toast('ファイルURLを作成できませんでした','error'); return; }
    window.open(url, '_blank');
  },

  async delete(id) {
    const item = STATE.library.find(i => i.id === id);
    if (!item) return;

    if (!confirm(`過去資料「${item.title}」を削除しますか？`)) return;

    if (item.storagePath) {
      await CLOUD_REPOSITORY.deleteFile(item.storagePath).catch(()=>{});
    }

    STATE.library=STATE.library.filter(i=>i.id!==id);
    Repository.Storage.save();
    this.renderList();
  },

  exportJSON() { STORE.exportJSON(); },

  clearAll() {
    if(confirm('全過去資料を削除しますか？\n※Storage上のファイル本体も削除を試行します。')){
      const paths = (STATE.library || []).map(i=>i.storagePath).filter(Boolean);
      paths.forEach(p => CLOUD_REPOSITORY.deleteFile(p).catch(()=>{}));
      STATE.library=[];
      Repository.Storage.save();
      this.renderList();
    }
  },
};

function fmtFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0B';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)}KB`;
  return `${(n/1024/1024).toFixed(1)}MB`;
}

})();
