/* report.js : 会議報告書AI準備・過去資料管理 */

function normalizeReportKnowledge(raw) {
  const base = { policies:{}, references:[] };
  if (!raw || typeof raw !== 'object') return base;
  const policies = raw.policies && typeof raw.policies === 'object' ? raw.policies : {};
  const references = Array.isArray(raw.references) ? raw.references : [];
  return {
    policies,
    references: references.map(r => ({
      id: r.id || Date.now() + Math.random(),
      fiscalYear: String(r.fiscalYear || getDefaultFiscalYear()),
      half: r.half || '上期',
      ym: r.ym || '',
      scope: r.scope || (r.ym ? 'month' : 'half'),
      title: r.title || '無題',
      category: r.category || 'その他',
      priority: r.priority || '中',
      content: r.content || '',
      savedAt: r.savedAt || new Date().toISOString()
    }))
  };
}

function mergeReportKnowledge(localRaw, cloudRaw) {
  const local = normalizeReportKnowledge(localRaw);
  const cloud = normalizeReportKnowledge(cloudRaw);
  const policies = { ...local.policies };
  Object.entries(cloud.policies || {}).forEach(([key, val]) => {
    const old = policies[key];
    const nt = val && (val.savedAt || val.updatedAt || '');
    const ot = old && (old.savedAt || old.updatedAt || '');
    if (!old || String(nt) >= String(ot)) policies[key] = val;
  });
  const refMap = new Map();
  [...(local.references || []), ...(cloud.references || [])].forEach(r => {
    if (!r) return;
    const id = String(r.id || `${r.fiscalYear}_${r.half}_${r.ym}_${r.title}`);
    const old = refMap.get(id);
    if (!old || String(r.savedAt || '') >= String(old.savedAt || '')) refMap.set(id, r);
  });
  return { policies, references:[...refMap.values()].sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))) };
}

function reportPolicyKey(fy, half) {
  return `${String(fy || getDefaultFiscalYear())}_${half || '上期'}`;
}

function reportHalfFromYM(ym) {
  const mm = Number(String(ym || '').slice(4,6));
  return (mm >= 4 && mm <= 9) ? '上期' : '下期';
}

function reportFYFromYM(ym) {
  return ym ? fiscalYearFromYM(ym) : getDefaultFiscalYear();
}

/* ════════ §23 REPORT_UI（会議報告書・AIプロンプト準備） ═════════════════════════════ */
const REPORT_UI = window.REPORT_UI = {
  _tab:'policy',

  getFY() {
    return document.getElementById('report-fy')?.value || dashboardSelectedFiscalYear() || getDefaultFiscalYear();
  },
  getHalf() {
    return document.getElementById('report-half')?.value || '上期';
  },
  getYM() {
    return document.getElementById('report-ym')?.value || dashboardSelectedYM() || latestDS()?.ym || '';
  },
  getPolicy() {
    STATE.reportKnowledge = normalizeReportKnowledge(STATE.reportKnowledge);
    return STATE.reportKnowledge.policies[reportPolicyKey(this.getFY(), this.getHalf())] || null;
  },

  switchTab(tab) {
    this._tab = tab || 'policy';
    document.querySelectorAll('.report-tab').forEach(b=>b.classList.toggle('active', b.dataset.reportTab === this._tab));
    document.querySelectorAll('.report-pane').forEach(p=>p.style.display='none');
    const pane = document.getElementById('report-pane-' + this._tab);
    if (pane) pane.style.display = '';
    this.refreshReferenceList();
  },

  refresh() {
    STATE.reportKnowledge = normalizeReportKnowledge(STATE.reportKnowledge);
    this.populateSelectors();
    this.loadPolicy();
    this.refreshReferenceList();
    this.refreshGenerateSummary();
    this.switchTab(this._tab || 'policy');
  },

  populateSelectors() {
    const fySel = document.getElementById('report-fy');
    const ymSel = document.getElementById('report-ym');
    const halfSel = document.getElementById('report-half');
    if (!fySel) return;

    const years = [...new Set([...dashboardAvailableFiscalYears(), getDefaultFiscalYear(), ...Object.keys(STATE.reportKnowledge.policies || {}).map(k=>k.slice(0,4))])]
      .filter(Boolean).sort((a,b)=>Number(b)-Number(a));
    const oldFY = fySel.value || dashboardSelectedFiscalYear() || getDefaultFiscalYear();
    fySel.innerHTML = years.map(y=>`<option value="${esc(y)}" ${String(y)===String(oldFY)?'selected':''}>${esc(y)}年度</option>`).join('');
    if (!fySel.value && years.length) fySel.value = years[0];

    const fym = monthsOfFiscalYear(fySel.value);
    const validYms = fym.filter(ym => activeDatasetByYM(ym) || (STATE.fieldData || []).some(d=>d.ym===ym) || (STATE.productAddressData || []).some(d=>d.ym===ym));
    const currentYM = ymSel?.value || dashboardSelectedYM() || validYms.at(-1) || fym[0] || '';
    if (ymSel) {
      ymSel.innerHTML = fym.map(ym=>{
        const has = validYms.includes(ym);
        return `<option value="${esc(ym)}" ${ym===currentYM?'selected':''}>${esc(ymLabel(ym))}${has?'':'（データなし）'}</option>`;
      }).join('');
      if (currentYM) ymSel.value = currentYM;
    }
    if (halfSel && ymSel?.value && !halfSel.dataset.manualChanged) halfSel.value = reportHalfFromYM(ymSel.value);
    if (halfSel) halfSel.onchange = () => { halfSel.dataset.manualChanged = '1'; this.refresh(); };
  },

  savePolicy() {
    STATE.reportKnowledge = normalizeReportKnowledge(STATE.reportKnowledge);
    const fy = this.getFY();
    const half = this.getHalf();
    const key = reportPolicyKey(fy, half);
    STATE.reportKnowledge.policies[key] = {
      fiscalYear: fy,
      half,
      direction: document.getElementById('report-policy-direction')?.value || '',
      actions: document.getElementById('report-policy-actions')?.value || '',
      targets: document.getElementById('report-policy-targets')?.value || '',
      issues: document.getElementById('report-policy-issues')?.value || '',
      savedAt: new Date().toISOString()
    };
    STORE.save();
    const msg = document.getElementById('report-policy-msg');
    if (msg) msg.textContent = `${fy}年度 ${half} 方針を保存しました`;
    UI.toast('年度・半期方針を保存しました');
    this.refreshGenerateSummary();
  },

  loadPolicy() {
    const p = this.getPolicy();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('report-policy-direction', p?.direction);
    set('report-policy-actions', p?.actions);
    set('report-policy-targets', p?.targets);
    set('report-policy-issues', p?.issues);
  },

  saveReference() {
    STATE.reportKnowledge = normalizeReportKnowledge(STATE.reportKnowledge);
    const title = document.getElementById('report-ref-title')?.value?.trim();
    const content = document.getElementById('report-ref-content')?.value?.trim();
    if (!title && !content) { UI.toast('資料名または内容を入力してください','warn'); return; }
    const fy = this.getFY();
    const half = this.getHalf();
    const scope = document.getElementById('report-ref-scope')?.value || 'month';
    const ym = scope === 'month' ? this.getYM() : '';
    STATE.reportKnowledge.references.push({
      id: Date.now(), fiscalYear: fy, half, ym, scope,
      title: title || '参考メモ',
      category: document.getElementById('report-ref-category')?.value || 'その他',
      priority: document.getElementById('report-ref-priority')?.value || '中',
      content: content || '',
      savedAt: new Date().toISOString()
    });
    STORE.save();
    this.clearReferenceForm();
    this.refreshReferenceList();
    UI.toast('参考資料メモを保存しました');
  },

  clearReferenceForm() {
    ['report-ref-title','report-ref-content'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    const msg=document.getElementById('report-ref-msg'); if(msg) msg.textContent='';
  },

  referenceMatches(ref) {
    const fy = this.getFY();
    const half = this.getHalf();
    const ym = this.getYM();
    if (String(ref.fiscalYear) !== String(fy)) return false;
    if (ref.scope === 'year') return true;
    if ((ref.half || half) !== half) return false;
    if (ref.scope === 'month') return !ref.ym || ref.ym === ym;
    return true;
  },

  selectedReferences() {
    STATE.reportKnowledge = normalizeReportKnowledge(STATE.reportKnowledge);
    const direct = (STATE.reportKnowledge.references || []).filter(r=>this.referenceMatches(r));
    const fy = this.getFY(), half = this.getHalf(), ym = this.getYM();
    const lib = (STATE.library || []).filter(item => {
      if (item.fiscalYear && String(item.fiscalYear) !== String(fy)) return false;
      const cat = String(item.category || '');
      const monthMatch = !item.month || (ym && item.month === ym.slice(4,6));
      const isPolicy = cat.includes('方針');
      const isMeeting = cat.includes('会議') || cat.includes('報告') || cat.includes('資料') || cat.includes('メモ') || cat.includes('スクショ');
      return monthMatch || isPolicy || isMeeting || !item.month;
    }).map(item => ({
      id:'lib_' + item.id,
      fiscalYear: item.fiscalYear || fy,
      half,
      ym: item.month ? `${fy}${item.month}` : '',
      scope: item.month ? 'month' : 'half',
      title: item.title || item.fileName || '過去資料',
      category: item.category || '過去資料',
      priority: item.category && String(item.category).includes('方針') ? '高' : '中',
      content: [item.memo, item.content, item.fileName ? `添付ファイル：${item.fileName}` : ''].filter(Boolean).join('\n'),
      savedAt: item.savedAt || ''
    }));
    return [...direct, ...lib].sort((a,b)=>{
      const rank = {高:3,中:2,低:1};
      return (rank[b.priority]||0)-(rank[a.priority]||0) || String(b.savedAt||'').localeCompare(String(a.savedAt||''));
    }).slice(0,20);
  },

  refreshReferenceList() {
    const box = document.getElementById('report-reference-list');
    const sum = document.getElementById('report-generate-summary');
    const refs = this.selectedReferences();
    if (box) {
      box.innerHTML = refs.length ? refs.map(r=>`
        <div style="border-bottom:1px solid var(--border);padding:8px 0">
          <div style="font-weight:800;color:var(--text)">${esc(r.title)} <span style="font-size:11px;color:var(--text3)">[${esc(r.category)} / ${esc(r.priority)}]</span></div>
          <div style="white-space:pre-wrap;color:var(--text2);font-size:12px">${esc((r.content || '').slice(0,500)) || '添付資料のみ。必要に応じて資料内容を確認してください。'}</div>
        </div>`).join('') : '対象期間に紐づく参考資料はまだありません';
    }
    if (sum) this.refreshGenerateSummary();
  },

  refreshGenerateSummary() {
    const sum = document.getElementById('report-generate-summary');
    if (!sum) return;
    const fy=this.getFY(), half=this.getHalf(), ym=this.getYM();
    const p=this.getPolicy();
    const refs=this.selectedReferences();
    const ds=ym ? activeDatasetByYM(ym) : null;
    sum.innerHTML = `対象：${esc(fy)}年度 ${esc(half)} / ${esc(ymLabel(ym))}<br>` +
      `方針：${p ? '登録済' : '未登録'} / 月次収支：${ds ? datasetKindLabel(ds) + 'あり' : 'なし'} / 参考資料：${refs.length}件`;
  },

  buildDataSummary(ym) {
    const ds = ym ? activeDatasetByYM(ym) : latestDS();
    const prev = ds ? prevDS(ds.ym) : null;
    const lastYear = ds ? sameMonthLastYear(ds.ym) : null;
    const lines = [];
    if (ds) {
      lines.push(`- 営業収益: ${fmtK(ds.totalIncome)}千円`);
      lines.push(`- 費用合計: ${fmtK(ds.totalExpense)}千円`);
      lines.push(`- センター利益: ${fmtK(ds.profit)}千円`);
      lines.push(`- 利益率: ${pct(ds.profitRate)}`);
      lines.push(`- みなし人件費率: ${pct(ds.pseudoLaborRate)}（目標: ${CONFIG.TARGETS.pseudoLaborRate}%以内）`);
      if (prev) lines.push(`- 前月比 営業収益: ${ratio(ds.totalIncome, prev.totalIncome)}`);
      if (lastYear) lines.push(`- 前年同月比 営業収益: ${ratio(ds.totalIncome, lastYear.totalIncome)}`);
    } else {
      lines.push('- 月次収支データなし');
    }
    const field = (STATE.productAddressData || []).find(r=>r.ym===ym);
    if (field) {
      lines.push(`- 商品・住所CSV: 原票${fmt(field.slipCount || field.uniqueSlips || field.tickets?.length || 0)}件 / 明細${fmt(field.detailRows || field.rows || 0)}行`);
    }
    return lines.join('\n');
  },

  generatePrompt() {
    const out = document.getElementById('report-prompt-output');
    if (!out) return;
    const fy = this.getFY();
    const half = this.getHalf();
    const ym = this.getYM();
    const type = document.getElementById('report-type')?.value || 'monthly';
    const style = document.getElementById('report-style')?.value || 'a4';
    const tone = document.getElementById('report-tone')?.value || '結論先出し・実務的・数字重視';
    const policy = this.getPolicy();
    const refs = this.selectedReferences();
    const refText = refs.length ? refs.map((r,i)=>`【参考資料${i+1}｜${r.category}｜重要度:${r.priority}】\n${r.title}\n${r.content || '添付資料あり。資料名・メモを参考にしてください。'}`).join('\n\n') : '参考資料なし';

    out.value = `# ${CENTER.name} 会議報告書 作成依頼\n\n` +
`## 作成条件\n` +
`- 作成タイプ: ${type}\n- 対象: ${fy}年度 ${half} / ${ymLabel(ym)}\n- 出力形式: ${style}\n- 文章トーン: ${tone}\n\n` +
`## 年度・半期方針\n` +
`- 運営方針: ${policy?.direction || '未登録'}\n- 重点施策: ${policy?.actions || '未登録'}\n- 数値目標・管理指標: ${policy?.targets || '未登録'}\n- 前期からの課題・振り返り: ${policy?.issues || '未登録'}\n\n` +
`## 月次実績データ\n${this.buildDataSummary(ym)}\n\n` +
`## 参考資料ストック\n${refText}\n\n` +
`## 作成ルール\n` +
`- 構成は「結論 → 数字結果 → 進捗評価 → 原因・課題 → 今月実施したこと → 来月以降の打ち手 → まとめ」。\n` +
`- 推測で書かず、数字・方針・参考資料に基づいて書く。確認できない内容は書かない。\n` +
`- 文章は管理者会議でそのまま読める社内向けの丁寧な文体にする。\n` +
`- 重点施策と月次実績のつながりを必ず書く。\n` +
`- 過剰な経営提案ではなく、現場判断に直結する打ち手に絞る。\n` +
`- A4 1枚想定で、見出し付きの本文として作成する。`;
    UI.toast('会議報告書用プロンプトを生成しました');
  },

  copyPrompt() {
    const out = document.getElementById('report-prompt-output');
    if (!out?.value) { UI.toast('先に「AI用プロンプト作成」ボタンを押してください','warn'); return; }
    navigator.clipboard.writeText(out.value).then(()=>UI.toast('クリップボードにコピーしました'));
  }
};

/* ════════ §24 PAST_LIBRARY（ファイル本体はStorage、台帳はfull_state） ══════════════════════════ */
const PAST_LIBRARY = window.PAST_LIBRARY = {
  _selectedFile: null,
  _bulkFiles: [],

  handlePaste(event, mode) {
    const files = Array.from(event?.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    if (mode === 'bulk') this.handleBulkFiles(files);
    else this.handleFile(files[0]);
  },

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
        const storagePath = CLOUD._libraryFileKey(file.name, fy);
        await CLOUD.uploadFile(storagePath, file);

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
      STORE.save();
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
        const storagePath = CLOUD._libraryFileKey(file.name, fy);
        await CLOUD.uploadFile(storagePath, file);
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

    STORE.save();
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

    const url = await CLOUD.createSignedUrl(item.storagePath);
    if (!url) { UI.toast('ファイルURLを作成できませんでした','error'); return; }
    window.open(url, '_blank');
  },

  async delete(id) {
    const item = STATE.library.find(i => i.id === id);
    if (!item) return;

    if (!confirm(`過去資料「${item.title}」を削除しますか？`)) return;

    if (item.storagePath) {
      await CLOUD.deleteFile(item.storagePath).catch(()=>{});
    }

    STATE.library=STATE.library.filter(i=>i.id!==id);
    STORE.save();
    this.renderList();
  },

  exportJSON() { STORE.exportJSON(); },

  clearAll() {
    if(confirm('全過去資料を削除しますか？\n※Storage上のファイル本体も削除を試行します。')){
      const paths = (STATE.library || []).map(i=>i.storagePath).filter(Boolean);
      paths.forEach(p => CLOUD.deleteFile(p).catch(()=>{}));
      STATE.library=[];
      STORE.save();
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

window.normalizeReportKnowledge = normalizeReportKnowledge;
window.mergeReportKnowledge = mergeReportKnowledge;
window.reportPolicyKey = reportPolicyKey;
window.reportHalfFromYM = reportHalfFromYM;
window.reportFYFromYM = reportFYFromYM;
window.fmtFileSize = fmtFileSize;
