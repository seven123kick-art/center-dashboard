/* =====================================================================
   経営管理システム storage_audit.js
   2026-07-24
   ・データ保管場所対応表・保存経路監査（§20A）をapp.jsから分離
   ・storageFiscalYear() 等の関数は src/field/field_core.js からも
     呼ばれる共通ヘルパーのため、IIFEで囲わずグローバル関数のまま維持
   ・STATE / STORE / CLOUD / UI / esc / ymLabel等はapp.js側を使用
===================================================================== */
'use strict';

function storageFiscalYear() {
  const sel = document.getElementById('storage-fy-select');
  if (sel && sel.value) return String(sel.value);
  const plan = document.getElementById('plan-year-sel');
  if (plan && plan.value) return String(plan.value);
  return STATE.fiscalYear || getDefaultFiscalYear();
}
function storageFiscalMonths(fy) { return monthsOfFiscalYear(String(fy)); }
function storageRowsForFY(fy) {
  const months = storageFiscalMonths(fy);
  return (STATE.datasets || []).filter(d => months.includes(d.ym));
}
function storageIsHistory(ds) { return ds && ds.source === 'history'; }
function storageAmountK(ds, key) {
  if (!ds) return 0;
  // CSVは円、収支補完は千円。表示は千円で統一。
  if (storageIsHistory(ds) || String(ds.unit || '').includes('千円')) return n(ds[key]);
  return n(ds[key]) / 1000;
}
function storageLatestAt(rows) { return rows.map(r=>r.importedAt).filter(Boolean).sort().pop() || ''; }
function storagePlanPack(fy) { return getPlanPackForFiscalYear(String(fy)); }
function storagePlanRows(fy) { const p = storagePlanPack(fy); return p ? p.rows : null; }
function storagePlanAllTotal(plan) {
  if (!plan) return 0;
  let total = 0;
  Object.values(plan).forEach(row => {
    if (!row || typeof row !== 'object') return;
    Object.values(row).forEach(v => total += n(v));
  });
  return total;
}
function storageBadge(text, kind) {
  const bg = kind === 'ok' ? '#d1fae5' : kind === 'warn' ? '#fef3c7' : '#fee2e2';
  const fg = kind === 'ok' ? '#065f46' : kind === 'warn' ? '#92400e' : '#991b1b';
  return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${fg};font-weight:900;font-size:11px;white-space:nowrap">${text}</span>`;
}
function storageWarnings(fy) {
  const warnings = [];
  const rows = storageRowsForFY(fy);
  const keyCount = {};
  rows.forEach(d => {
    const key = `${d.ym}_${d.type || 'confirmed'}_${d.source || 'csv'}`;
    keyCount[key] = (keyCount[key] || 0) + 1;
  });
  if (Object.values(keyCount).some(c => c > 1)) warnings.push('同じ年月・区分・種別のデータが二重に残っている可能性があります。');
  const converted = rows.filter(d => storageIsHistory(d) && String(d.unit || '').includes('変換'));
  if (converted.length) warnings.push(`収支補完に古い「千円→円変換」表記のデータが ${converted.length}件 残っています。再取込を推奨します。`);
  const plan = storagePlanRows(fy);
  if (plan && Object.keys(plan).length && storagePlanAllTotal(plan) === 0) warnings.push('計画データは登録済みですが、数値合計が0です。貼付範囲を確認してください。');
  return warnings;
}

function storageMonthState(fy, ym) {
  const rows = (STATE.datasets || []).filter(d => d && d.ym === ym);
  const csvRows = rows.filter(d => !storageIsHistory(d));
  const histRows = rows.filter(d => storageIsHistory(d));
  const confirmed = csvRows.filter(d => (d.type || 'confirmed') === 'confirmed');
  const daily = csvRows.filter(d => d.type === 'daily');
  const converted = histRows.filter(d => String(d.unit || '').includes('変換'));
  const dupMap = {};
  rows.forEach(d => {
    const key = `${d.ym}_${d.type || 'confirmed'}_${d.source || 'csv'}`;
    dupMap[key] = (dupMap[key] || 0) + 1;
  });
  const duplicated = Object.values(dupMap).some(c => c > 1);
  const plan = storagePlanRows(fy);

  let judge = '漏れ';
  let kind = 'danger';
  let note = '';
  if (converted.length || duplicated) {
    judge = '異常';
    kind = 'danger';
    note = converted.length ? '旧変換データあり' : '二重データ疑い';
  } else if (confirmed.length) {
    judge = 'OK';
    kind = 'ok';
    note = daily.length ? '速報も保持・表示は確定優先' : '確定あり';
  } else if (daily.length) {
    judge = '注意';
    kind = 'warn';
    note = '速報のみ・確定待ち';
  } else if (histRows.length) {
    judge = '補完のみ';
    kind = 'warn';
    note = 'CSV未登録';
  } else {
    note = 'CSV・補完なし';
  }

  const csvLabel = confirmed.length && daily.length ? '確定＋速報' : confirmed.length ? '確定' : daily.length ? '速報のみ' : '未登録';
  const csvKind = confirmed.length ? 'ok' : daily.length ? 'warn' : 'danger';
  const histLabel = histRows.length ? 'あり' : 'なし';
  const histKind = histRows.length ? (converted.length ? 'danger' : 'ok') : 'warn';
  const planLabel = plan ? '登録済' : '未登録';
  const planKind = plan ? 'ok' : 'warn';

  return { ym, confirmed, daily, histRows, converted, duplicated, csvLabel, csvKind, histLabel, histKind, planLabel, planKind, judge, kind, note };
}


function storageDataQualityRows(fy) {
  const months = storageFiscalMonths(fy);
  const rows = (STATE.datasets || []).filter(d => d && months.includes(d.ym));
  const out = [];

  const groups = {};
  rows.forEach(d => {
    const source = storageIsHistory(d) ? '収支補完' : '収支CSV';
    const type = d.type === 'daily' ? '速報' : '確定';
    const key = `${d.ym}_${source}_${type}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  Object.values(groups).forEach(list => {
    if (list.length > 1) {
      const d = list[0];
      out.push({level:'異常', ym:d.ym, item: storageIsHistory(d) ? '収支補完' : '収支CSV', detail:`同じ年月・同じ区分が ${list.length}件あります`, action:'不要な重複データを削除または年度再取込で整理'});
    }
  });

  rows.forEach(d => {
    const source = storageIsHistory(d) ? '収支補完' : '収支CSV';
    const unit = String(d.unit || '');
    const fyActual = String(d.fiscalYear || fiscalYearFromYM(d.ym));
    const incomeK = storageAmountK(d, 'totalIncome');
    const expenseK = storageAmountK(d, 'totalExpense');

    if (unit.includes('変換')) {
      out.push({level:'異常', ym:d.ym, item:source, detail:`単位表記が「${unit}」です`, action:'旧変換版データのため、該当年度の収支補完を削除して再取込'});
    }
    if (!storageIsHistory(d) && unit && unit !== '円') {
      out.push({level:'確認', ym:d.ym, item:source, detail:`CSVの元単位が「${unit}」になっています`, action:'SKDL CSVは円単位。取込元または過去データを確認'});
    }
    if (storageIsHistory(d) && unit && !unit.includes('千円')) {
      out.push({level:'確認', ym:d.ym, item:source, detail:`収支補完の元単位が「${unit}」になっています`, action:'収支補完は千円単位。再取込を推奨'});
    }
    if (fyActual !== String(fy)) {
      out.push({level:'異常', ym:d.ym, item:source, detail:`年度情報が ${fyActual}年度 になっています`, action:`${ymLabel(d.ym)}は${fiscalYearFromYM(d.ym)}年度扱い。年度ズレを確認`});
    }
    if ((incomeK > 0 && incomeK < 100) || (expenseK > 0 && expenseK < 100)) {
      out.push({level:'確認', ym:d.ym, item:source, detail:`金額が小さすぎる可能性があります（収入 ${fmt(incomeK)}千円 / 費用 ${fmt(expenseK)}千円）`, action:'千円データをさらに÷1000していないか確認'});
    }
  });

  return out.sort((a,b)=>a.ym.localeCompare(b.ym) || a.item.localeCompare(b.item,'ja'));
}
function renderDataQualityCheckTable() {
  const fy = storageFiscalYear();
  const rows = storageDataQualityRows(fy);
  const summary = rows.length ? storageBadge(`確認 ${rows.length}件`, 'danger') : storageBadge('異常なし', 'ok');
  return `
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-weight:900;font-size:14px">重複・異常データ確認</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">同じ年月＋同じ区分の重複、単位ズレ、年度ズレ、極端に小さい金額を確認</div>
        </div>
        <div>${summary}</div>
      </div>
      ${rows.length ? `
        <div class="scroll-x"><table class="tbl"><thead><tr><th>区分</th><th>月</th><th>データ</th><th>確認内容</th><th>対応</th></tr></thead><tbody>
          ${rows.map(r=>`<tr>
            <td>${storageBadge(r.level, r.level === '異常' ? 'danger' : 'warn')}</td>
            <td><strong>${ymLabel(r.ym)}</strong></td>
            <td>${esc(r.item)}</td>
            <td style="min-width:280px;color:var(--text2)">${esc(r.detail)}</td>
            <td style="min-width:280px;color:var(--text2)">${esc(r.action)}</td>
          </tr>`).join('')}
        </tbody></table></div>` : `
        <div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:10px;font-size:12px">この年度では、同一月・同一区分の重複や単位異常は見つかりません。</div>`}
    </div>`;
}

function renderStorageMapTable() {
  const fy = storageFiscalYear();
  const rows = storageRowsForFY(fy);
  const csvRows = rows.filter(d => !storageIsHistory(d));
  const histRows = rows.filter(d => storageIsHistory(d));
  const plan = storagePlanRows(fy);
  const planPack = storagePlanPack(fy);
  const monthsConfirmed = new Set(csvRows.filter(d => (d.type || 'confirmed') === 'confirmed').map(d=>d.ym)).size;
  const monthsDaily = new Set(csvRows.filter(d => d.type === 'daily').map(d=>d.ym)).size;
  const histMonths = new Set(histRows.map(d=>d.ym)).size;
  const workerRows = (STATE.workerCsvData || []).filter(d => d && storageFiscalMonths(fy).includes(d.ym));
  const productRows = (STATE.productAddressData || []).filter(d => d && storageFiscalMonths(fy).includes(d.ym));
  const warnings = storageWarnings(fy);

  const years = new Set([String(fy), getDefaultFiscalYear()]);
  (STATE.datasets || []).forEach(d => years.add(String(d.fiscalYear || fiscalYearFromYM(d.ym))));
  if (STATE.planData && typeof STATE.planData === 'object') {
    Object.keys(STATE.planData).forEach(y => /^\d{4}$/.test(y) && years.add(y));
  }
  const yearOptions = [...years].sort().reverse().map(y => `<option value="${y}" ${String(y)===String(fy)?'selected':''}>${y}年度</option>`).join('');

  const tableRows = [
    ['収支実績CSV', `${fy}年度`, (monthsConfirmed||monthsDaily)?storageBadge('登録済','ok'):storageBadge('未登録','warn'), `確定 ${monthsConfirmed}ヶ月 / 速報 ${monthsDaily}ヶ月`, '円', formatImportedAt(storageLatestAt(csvRows)), 'SKDL0001/0003。速報と確定は両方保持。表示は確定優先。', '月別チェック表から月単位で削除'],
    ['計画データ', `${fy}年度`, plan?storageBadge('登録済','ok'):storageBadge('未登録','warn'), plan?`${Object.keys(plan).length}科目 / 合計 ${fmt(storagePlanAllTotal(plan))}千円`:'0科目', '千円', formatImportedAt(planPack?.importedAt), '年度単位で完全独立。取込時は年度丸ごと入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deletePlan('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['収支補完', `${fy}年度`, histMonths?storageBadge('登録済','ok'):storageBadge('未登録','warn'), histMonths?`${histMonths}ヶ月 / 収入 ${fmt(histRows.reduce((s,d)=>s+storageAmountK(d,'totalIncome'),0))}千円`:'0ヶ月', '千円', formatImportedAt(storageLatestAt(histRows)), 'SKKS月次収支照会の貼付。年度単位で完全入替。', `<button class="btn btn-danger" onclick="DATA_STORAGE_TABLE.deleteHistory('${fy}')" style="font-size:11px;padding:3px 8px">年度削除</button>`],
    ['作業者CSV', `${fy}年度`, workerRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), workerRows.length?`${workerRows.length}ヶ月 / ${fmt(workerRows.reduce((s,d)=>s+n(d.rowCount),0))}行`:'0ヶ月', '件数', formatImportedAt(storageLatestAt(workerRows)), '作業者分析・作業内容分析の元データ。月単位で個別削除できます。', '月別チェック表から月単位で削除'],
    ['商品住所CSV', `${fy}年度`, productRows.length?storageBadge('登録済','ok'):storageBadge('未登録','warn'), productRows.length?`${productRows.length}ヶ月 / 原票${fmt(productRows.reduce((s,d)=>s+n(d.uniqueCount),0))}件`:'0ヶ月', '件数/円', formatImportedAt(storageLatestAt(productRows)), '商品カテゴリ・エリア・キャパ・荷主判定の元データ。顧客氏名・番地は保存しません。', '月別チェック表から月単位で削除'],
  ];

  return `
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-weight:900;font-size:14px">データ保管場所 対応表</div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px">
          <span style="color:var(--text2)">対象年度</span>
          <select id="storage-fy-select" onchange="DATA_STORAGE_TABLE.changeFY(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${yearOptions}</select>
        </div>
      </div>
      ${warnings.length ? `<div style="border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.7"><strong>確認が必要なデータがあります</strong><br>${warnings.map(w=>'・'+esc(w)).join('<br>')}</div>` : `<div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px">この年度の保管状況に大きな異常は見つかりません。</div>`}
      <div class="scroll-x"><table class="tbl"><thead><tr><th>保管区分</th><th>対象</th><th>登録状況</th><th>件数/月数</th><th>元単位</th><th>最終更新</th><th>説明</th><th>操作</th></tr></thead><tbody>
        ${tableRows.map(r=>`<tr><td><strong>${esc(r[0])}</strong></td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td style="min-width:260px;color:var(--text2)">${esc(r[6])}</td><td>${r[7]}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
}

function renderStorageRouteAuditPanel() {
  const fy = storageFiscalYear();
  const years = new Set([String(fy), getDefaultFiscalYear()]);
  (STATE.datasets || []).forEach(d => d && d.ym && years.add(String(d.fiscalYear || fiscalYearFromYM(d.ym))));
  (STATE.workerCsvData || []).forEach(d => d && d.ym && years.add(String(fiscalYearFromYM(d.ym))));
  (STATE.productAddressData || []).forEach(d => d && d.ym && years.add(String(fiscalYearFromYM(d.ym))));
  if (STATE.planData && typeof STATE.planData === 'object') Object.keys(STATE.planData).forEach(y => /^\d{4}$/.test(y) && years.add(y));
  const yearOptions = [...years].sort().reverse().map(y => `<option value="${esc(y)}" ${String(y)===String(fy)?'selected':''}>${esc(y)}年度</option>`).join('');
  return `
    <div style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div style="font-weight:900;font-size:14px">保存経路監査</div>
          <div style="font-size:11px;color:var(--text3);line-height:1.6">取込後のSTATE・DB保存・再読込状態を年度単位で確認します。北埼玉/戸田とも同じ基準で判定します。</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="storage-audit-fy-select" style="font-size:12px;padding:5px 8px;border:1px solid var(--border2);border-radius:8px">${yearOptions}</select>
          <button class="btn" onclick="DATA_STORAGE_AUDIT.run()" style="font-size:12px;padding:5px 10px">保存経路を確認</button>
          <button class="btn" onclick="DATA_STORAGE_AUDIT.loadField()" style="font-size:12px;padding:5px 10px">現場データを再読込</button>
        </div>
      </div>
      <div id="storage-audit-result" style="font-size:12px;color:var(--text2)">未確認です。必要に応じて「保存経路を確認」を押してください。</div>
    </div>`;
}

window.DATA_STORAGE_AUDIT = {
  _fy() {
    return String(document.getElementById('storage-audit-fy-select')?.value || storageFiscalYear() || getDefaultFiscalYear());
  },
  _label(ok, textOk='あり', textNg='なし') {
    return storageBadge(ok ? textOk : textNg, ok ? 'ok' : 'danger');
  },
  _warn(text) { return storageBadge(text, 'warn'); },
  _localDataset(ym) { return (STATE.datasets || []).some(d => d && d.ym === ym && d.source !== 'history'); },
  _localWorker(ym) { return (STATE.workerCsvData || []).some(d => d && d.ym === ym && !deletedAt('workerMonths', ym) && !deletedAt('fieldMonths', ym)); },
  _localProduct(ym) { return (STATE.productAddressData || []).some(d => d && d.ym === ym && !deletedAt('productMonths', ym) && !deletedAt('fieldMonths', ym)); },
  async _dbExists(key) {
    try {
      if (!CLOUD || !CLOUD.dbGetState || !CLOUD.dbStateKey) return false;
      const v = await CLOUD.dbGetState(CLOUD.dbStateKey(key));
      return !!v;
    } catch(e) { return false; }
  },
  _judge(local, db, manifest) {
    if (local && db) return { text:'OK', kind:'ok', note:'画面表示・DB保存とも確認' };
    if (!local && db) return { text:'未読込', kind:'warn', note:'DBにはあります。画面再読込または現場データ再読込で復元可能' };
    if (local && !db) return { text:'未保存', kind:'danger', note:'画面にはありますがDB保存が確認できません。今すぐ同期が必要' };
    if (manifest && !db) return { text:'台帳不整合', kind:'danger', note:'manifestにありますがDB本体がありません' };
    return { text:'未登録', kind:'warn', note:'この月のデータは未登録' };
  },
  async run() {
    const fy = this._fy();
    const el = document.getElementById('storage-audit-result');
    if (!el) return;
    el.innerHTML = '確認中...';
    try {
      const months = storageFiscalMonths(fy);
      const manifest = await CLOUD_REPOSITORY.fetchManifest().catch(e => null);
      const mDatasets = new Set((manifest?.datasets || []).map(m => m && m.ym).filter(Boolean));
      const mWorkers = new Set((manifest?.workerCsvData || []).map(m => m && m.ym).filter(Boolean));
      const mProducts = new Set((manifest?.productAddressData || []).map(m => m && m.ym).filter(Boolean));
      const rows = [];
      for (const ym of months) {
        const localFin = this._localDataset(ym);
        const localW = this._localWorker(ym);
        const localP = this._localProduct(ym);
        const dbFin = await this._dbExists(CLOUD.datasetKey(ym, 'confirmed')) || await this._dbExists(CLOUD.datasetKey(ym, 'daily'));
        const dbW = await this._dbExists(CLOUD.workerMonthKey(ym));
        const dbP = await this._dbExists(CLOUD.productMonthKey(ym));
        const jFin = this._judge(localFin, dbFin, mDatasets.has(ym));
        const jW = this._judge(localW, dbW, mWorkers.has(ym));
        const jP = this._judge(localP, dbP, mProducts.has(ym));
        const worst = [jFin,jW,jP].find(j => j.kind === 'danger') || [jFin,jW,jP].find(j => j.kind === 'warn') || jFin;
        rows.push({ ym, localFin, dbFin, localW, dbW, localP, dbP, jFin, jW, jP, worst });
      }
      const danger = rows.filter(r => r.worst.kind === 'danger').length;
      const warn = rows.filter(r => r.worst.kind === 'warn').length;
      const summary = danger ? storageBadge(`要対応 ${danger}ヶ月`, 'danger') : warn ? storageBadge(`確認 ${warn}ヶ月`, 'warn') : storageBadge('異常なし', 'ok');
      el.innerHTML = `
        <div style="margin:8px 0 10px">${summary}<span style="margin-left:8px;color:var(--text3)">center_key: ${esc(CENTER.id)} / ${esc(fy)}年度</span></div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>月</th><th>収支CSV</th><th>作業者CSV</th><th>商品住所CSV</th><th>判定</th><th>メモ</th></tr></thead><tbody>
          ${rows.map(r => `<tr>
            <td><strong>${esc(ymLabel(r.ym))}</strong></td>
            <td>画面 ${this._label(r.localFin).replace(/登録済|あり/g,'あり')} / DB ${this._label(r.dbFin).replace(/登録済|あり/g,'あり')}</td>
            <td>画面 ${this._label(r.localW).replace(/登録済|あり/g,'あり')} / DB ${this._label(r.dbW).replace(/登録済|あり/g,'あり')}</td>
            <td>画面 ${this._label(r.localP).replace(/登録済|あり/g,'あり')} / DB ${this._label(r.dbP).replace(/登録済|あり/g,'あり')}</td>
            <td>${storageBadge(r.worst.text, r.worst.kind)}</td>
            <td style="min-width:260px;color:var(--text2)">${esc(r.worst.note)}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } catch(e) {
      el.innerHTML = `<div class="msg msg-danger">保存経路監査に失敗しました: ${esc(e.message || e)}</div>`;
    }
  },
  async loadField() {
    const fy = this._fy();
    const el = document.getElementById('storage-audit-result');
    if (el) el.innerHTML = `${esc(fy)}年度の現場データをDBから再読込中...`;
    const r = await SYNC_COORDINATOR.syncFieldFiscalYear(fy);
    if (r && r.ok) {
      Repository.Storage.save();
      if (window.FIELD_DATA_ACCESS?.invalidate) FIELD_DATA_ACCESS.invalidate();
      UI.toast(`${fy}年度の現場データを再読込しました`);
      renderImport();
      setTimeout(() => DATA_STORAGE_AUDIT.run(), 50);
    } else {
      UI.toast('現場データ再読込失敗: ' + (r?.error || '不明'), 'error');
      if (el) el.innerHTML = `<div class="msg msg-danger">現場データ再読込失敗: ${esc(r?.error || '不明')}</div>`;
    }
  }
};

window.DATA_STORAGE_TABLE = {
  changeFY(fy){ STATE.fiscalYear = String(fy); renderImport(); },

  async _syncAfterDelete(label){
    Repository.Storage.save();
    try {
      if (CLOUD?.pushAll) await SYNC_COORDINATOR.syncPush({ onlyChanged:false, updateBadge:true });
    } catch(e) {
      UI.toast(`${label}はローカル削除済みですが、クラウド同期に失敗しました: ${e.message}`, 'warn');
    }
    NAV.refresh();
  },

  async deletePlan(fy){
    if (!STATE.planData || !STATE.planData[fy]) { UI.toast(`${fy}年度の計画データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の計画データを削除しますか？
他年度は削除しません。`)) return;
    markDataDeleted('planFiscalYears', fy);
    delete STATE.planData[fy];
    applyDeletionTombstonesToState(STATE);
    try { if (CLOUD?.deleteFile) await CLOUD_REPOSITORY.deleteFile(CLOUD.planKey()); } catch(e) {}
    await this._syncAfterDelete(`${fy}年度の計画データ`);
    UI.toast(`${fy}年度の計画データを削除しました`);
  },

  async deleteHistory(fy){
    const rows = (STATE.datasets || []).filter(d => storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy));
    if (!rows.length) { UI.toast(`${fy}年度の収支補完データは未登録です`,'warn'); return; }
    if (!confirm(`${fy}年度の収支補完データ ${rows.length}件を削除しますか？
通常CSV・計画データは削除しません。`)) return;
    markDataDeleted('historyFiscalYears', fy);
    STATE.datasets = (STATE.datasets || []).filter(d => !(storageIsHistory(d) && String(d.fiscalYear || fiscalYearFromYM(d.ym)) === String(fy)));
    applyDeletionTombstonesToState(STATE);
    await this._syncAfterDelete(`${fy}年度の収支補完データ`);
    UI.toast(`${fy}年度の収支補完データを削除しました`);
  },

  async deleteHistoryMonth(ym){
    const rows = (STATE.datasets || []).filter(d => storageIsHistory(d) && d.ym === ym);
    if (!rows.length) { UI.toast(`${ymLabel(ym)}の収支補完は未登録です`,'warn'); return; }
    if (!confirm(`${ymLabel(ym)}の収支補完データを削除しますか？
通常CSV・計画データは削除しません。`)) return;
    markDataDeleted('historyMonths', ym);
    STATE.datasets = (STATE.datasets || []).filter(d => !(storageIsHistory(d) && d.ym === ym));
    applyDeletionTombstonesToState(STATE);
    await this._syncAfterDelete(`${ymLabel(ym)}の収支補完データ`);
    UI.toast(`${ymLabel(ym)}の収支補完データを削除しました`);
  },

  async deleteCsvMonth(ym, type){
    const rows = (STATE.datasets || []).filter(d => d.ym === ym && d.source !== 'history' && (!type || (d.type || 'confirmed') === type));
    if (!rows.length) { UI.toast(`${ymLabel(ym)}の収支CSVは未登録です`, 'warn'); return; }
    const label = type === 'daily' ? '速報CSV' : type === 'confirmed' ? '確定CSV' : '収支CSV';
    if (!confirm(`${ymLabel(ym)}の${label} ${rows.length}件を削除しますか？
収支補完・計画データは削除しません。`)) return;
    rows.forEach(d => markDataDeleted('datasets', dataDeleteKey(d.ym, d.type || 'confirmed')));
    STATE.datasets = (STATE.datasets || []).filter(d => !(d.ym === ym && d.source !== 'history' && (!type || (d.type || 'confirmed') === type)));
    applyDeletionTombstonesToState(STATE);
    try {
      for (const d of rows) {
        if (window.IDB_CACHE?.remove) await IDB_CACHE.remove('dataset', `${d.ym}_${d.type || 'confirmed'}`);
      }
    } catch(e) {}
    try {
      for (const d of rows) {
        if (CLOUD?.deleteFile) await CLOUD_REPOSITORY.deleteFile(CLOUD.datasetKey(d.ym, d.type || 'confirmed'));
      }
    } catch(e) {}
    await this._syncAfterDelete(`${ymLabel(ym)}の${label}`);
    UI.toast(`${ymLabel(ym)}の${label}を削除しました`);
  }
};
