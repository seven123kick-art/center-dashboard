/* =====================================================================
   経営管理システム shipper.js
   2026-05-01
   ・app.jsから荷主分析を安全分割
   ・STATE / STORE / CLOUD / CSV基礎処理はapp.js側を使用
   ・このファイルは荷主分析の描画、荷主CSV集計拡張、異常検知、比較表示のみ担当
===================================================================== */
'use strict';

(function(){
  if (window.__SHIPPER_MODULE_LOADED_20260501__) return;
  window.__SHIPPER_MODULE_LOADED_20260501__ = true;

/* ════════ §15 RENDER — Shipper ════════════════════════════════ */
function renderShipper() {
  renderCommonPeriodSelector('shipper');

  const ds = selectedDatasetInSelectedFiscalYear();
  const chartEl = document.getElementById('c-shipper-bar');
  const hasShippers = ds && ds.shippers && Object.keys(ds.shippers).length > 0;

  const noticeId = 'shipper-notice';
  let noticeEl = document.getElementById(noticeId);
  if (!noticeEl) {
    const view = document.getElementById('view-shipper');
    if (view) { noticeEl=document.createElement('div'); noticeEl.id=noticeId; view.prepend(noticeEl); }
  }
  if (!hasShippers && noticeEl) {
    noticeEl.innerHTML = '<div class="msg msg-info" style="margin-bottom:14px">選択月の荷主別データがありません。荷主コード付きCSVを取り込むと荷主分析が表示されます。</div>';
    return;
  }
  if (noticeEl) noticeEl.innerHTML = '';
  if (!ds) return;

  const items = Object.entries(ds.shippers||{}).sort((a,b)=>b[1].income-a[1].income);
  CHART_MGR.make('c-shipper-bar', {
    type:'bar',
    data:{labels:items.map(x=>x[0]), datasets:[{
      label:'売上（千円）',
      data:items.map(x=>x[1].income/1000),
      backgroundColor: items.map((_,i)=>CONFIG.COLORS[i%CONFIG.COLORS.length]),
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{title:{display:true,text:'千円'}}}}
  });
}


/* ════════════════════════════════════════════════════════════════
   2026-04-29 追補：荷主別／契約別 集計再設計（安全版）
   ・荷主別：Y列 荷主コードの頭3桁で統合
   ・契約別：Y列 荷主コード（フル）＋AA列 荷主名／契約名で集計
   ・件数：AB列をユニーク化してカウント
   ・売上：AB列ユニーク単位でU列金額を1回だけ合算
   ・列取得：ヘッダ名を優先、見つからない場合のみ列位置で補完
   ・契約別は＋ボタンで開閉表示
════════════════════════════════════════════════════════════════ */
(function(){
  if (window.__SHIPPER_CONTRACT_PATCH_SAFE_20260429__) return;
  window.__SHIPPER_CONTRACT_PATCH_SAFE_20260429__ = true;

  function _cleanText(v){
    return String(v ?? '')
      .replace(/[\u0000-\u001f]/g,'')
      .replace(/\uFEFF/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }
  function _normHeader(v){
    return _cleanText(v)
      .replace(/[\s　]/g,'')
      .replace(/[()（）［］\[\]「」]/g,'')
      .toLowerCase();
  }
  function _toNumber(v){
    const s = String(v ?? '')
      .replace(/,/g,'')
      .replace(/[円¥￥\s　]/g,'')
      .replace(/[^0-9.\-]/g,'');
    if (!s || s === '-' || s === '.') return 0;
    const num = Number(s);
    return Number.isFinite(num) ? num : 0;
  }
  function _code(v){ return _cleanText(v).replace(/\.0$/,''); }
  function _code3(v){ const c = _code(v); return c ? c.slice(0,3) : ''; }
  function _stripParen(name){ return _cleanText(name).replace(/（.*?）/g,'').replace(/\(.*?\)/g,'').trim(); }
  function _escLocal(v){ return typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _fmtLocal(v){ return typeof fmt === 'function' ? fmt(v) : Math.round(Number(v)||0).toLocaleString('ja-JP'); }
  function _fmtKLocal(v){ return typeof fmtK === 'function' ? fmtK(v) : Math.round((Number(v)||0)/1000).toLocaleString('ja-JP'); }
  function _yenPer(count, income){ return count > 0 ? Math.round((Number(income)||0) / count) : 0; }

  function _findColumn(headers, candidates, fallbackIndex){
    const normalized = (headers || []).map(_normHeader);
    const normalizedCandidates = candidates.map(_normHeader);

    for (const c of normalizedCandidates) {
      const idx = normalized.indexOf(c);
      if (idx >= 0) return idx;
    }
    for (const c of normalizedCandidates) {
      const idx = normalized.findIndex(h => h && (h.includes(c) || c.includes(h)));
      if (idx >= 0) return idx;
    }
    return fallbackIndex;
  }

  function _detectColumns(rows){
    const header = Array.isArray(rows) && rows.length ? rows[0] : [];
    return {
      shipperCode: _findColumn(header, ['荷主コード','荷主ＣＤ','荷主CD','荷主ｺｰﾄﾞ'], 24), // Y列
      shipperName: _findColumn(header, ['荷主名','契約名','荷主名称','契約名称'], 26),      // AA列
      detailKey:   _findColumn(header, ['明細キー','明細番号','伝票番号','原票番号','エスライン原票番号'], 27), // AB列
      amount:      _findColumn(header, ['金額','売上金額','請求金額','合計金額'], 20),       // U列
    };
  }

  function _simplifyNameByKnownWords(name){
    const n = _cleanText(name);
    if (/でんきち|デンキチ/.test(n)) return 'でんきち';
    if (/コジマ/.test(n)) return 'コジマ';
    if (/ビックカメラ|ビック/.test(n)) return 'ビックカメラ';
    if (/ジェイトップ/.test(n)) return 'ジェイトップ';
    if (/プラスカーゴ/.test(n)) return 'プラスカーゴサービス';
    if (/フジ医療器/.test(n)) return 'フジ医療器';
    if (/スリーエス/.test(n)) return 'スリーエスサンキ家具';
    return _stripParen(n) || n || '未設定';
  }

  function _simpleGroupName(names){
    const list = Array.from(names || []).map(_cleanText).filter(Boolean);
    const counts = new Map();
    list.forEach(n => {
      const simple = _simplifyNameByKnownWords(n);
      counts.set(simple, (counts.get(simple) || 0) + 1);
    });
    if (!counts.size) return '未設定';
    return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'ja'))[0][0];
  }

  function _contractName(name){ return _cleanText(name) || '未設定'; }

  function buildShipperAggregationFromCsvRows(csvRows){
    const rows = Array.isArray(csvRows) ? csvRows : [];
    if (!rows.length) return { groups:[], contracts:[], dashboardShippers:{}, columns:null };

    const columns = _detectColumns(rows);
    const body = rows.length > 1 ? rows.slice(1) : rows;
    const groups = new Map();
    const contracts = new Map();
    const usedByContract = new Set();
    const usedByGroup = new Set();

    body.forEach((row, idx)=>{
      if (!Array.isArray(row)) return;

      const fullCode = _code(row[columns.shipperCode]);
      const c3 = _code3(fullCode);
      const rawName = _contractName(row[columns.shipperName]);
      const detailKeyRaw = _cleanText(row[columns.detailKey]);
      const detailKey = detailKeyRaw || `__row_${idx}`;
      const amount = _toNumber(row[columns.amount]);

      if (!fullCode || !c3) return;

      const contractKey = fullCode;
      const contractDedupKey = `${contractKey}::${detailKey}`;
      const groupDedupKey = `${c3}::${detailKey}`;

      if (!contracts.has(contractKey)) {
        contracts.set(contractKey, {
          code: fullCode,
          groupCode: c3,
          name: rawName,
          names: new Set(),
          detailKeys: new Set(),
          count: 0,
          income: 0
        });
      }
      const contract = contracts.get(contractKey);
      if (rawName) contract.names.add(rawName);
      if (!contract.name || contract.name === '未設定') contract.name = rawName || contract.name;

      if (!groups.has(c3)) {
        groups.set(c3, {
          code3: c3,
          name: '',
          names: new Set(),
          detailKeys: new Set(),
          count: 0,
          income: 0,
          contracts: new Map()
        });
      }
      const group = groups.get(c3);
      if (rawName) group.names.add(rawName);
      group.contracts.set(contractKey, contract);

      if (!usedByContract.has(contractDedupKey)) {
        usedByContract.add(contractDedupKey);
        contract.detailKeys.add(detailKey);
        contract.count += 1;
        contract.income += amount;
      }
      if (!usedByGroup.has(groupDedupKey)) {
        usedByGroup.add(groupDedupKey);
        group.detailKeys.add(detailKey);
        group.count += 1;
        group.income += amount;
      }
    });

    const groupList = Array.from(groups.values()).map(g=>{
      const contracts = Array.from(g.contracts.values()).map(c=>({
        code: c.code,
        groupCode: c.groupCode,
        name: _contractName(c.name || Array.from(c.names)[0]),
        count: c.count,
        income: c.income,
        unit: _yenPer(c.count, c.income)
      })).sort((a,b)=>b.income-a.income || b.count-a.count || a.code.localeCompare(b.code,'ja'));

      return {
        code3: g.code3,
        name: _simpleGroupName(g.names),
        count: g.count,
        income: g.income,
        unit: _yenPer(g.count, g.income),
        contracts
      };
    }).sort((a,b)=>b.income-a.income || b.count-a.count || a.name.localeCompare(b.name,'ja'));

    const contractList = Array.from(contracts.values()).map(c=>({
      code: c.code,
      groupCode: c.groupCode,
      groupName: _simpleGroupName(groups.get(c.groupCode)?.names || []),
      name: _contractName(c.name || Array.from(c.names)[0]),
      count: c.count,
      income: c.income,
      unit: _yenPer(c.count, c.income)
    })).sort((a,b)=>b.income-a.income || b.count-a.count || a.code.localeCompare(b.code,'ja'));

    const dashboardShippers = {};
    groupList.forEach(g=>{
      dashboardShippers[g.name] = { income:g.income, count:g.count, code3:g.code3 };
    });

    return { groups:groupList, contracts:contractList, dashboardShippers, columns };
  }

  const originalParseSKDL = CSV.parseSKDL.bind(CSV);
  CSV.parseSKDL = function(text, monthCol){
    const result = originalParseSKDL(text, monthCol);
    if (!result) return result;
    try {
      const rows = this.toRows(text);
      const agg = buildShipperAggregationFromCsvRows(rows);
      result._shipperGroups = agg.groups;
      result._shipperContracts = agg.contracts;
      result._dashboardShippers = agg.dashboardShippers;
      result._shipperColumns = agg.columns;
      result._shipperSourceRule = 'Y列荷主コード／AA列契約名／AB列重複除外／U列金額（ヘッダ名優先・列位置補完）';
    } catch(e) {
      result._shipperGroups = [];
      result._shipperContracts = [];
      result._dashboardShippers = {};
      result._shipperError = e.message;
    }
    return result;
  };

  const originalProcessDataset = processDataset;
  processDataset = function(ym, type, rows){
    const ds = originalProcessDataset(ym, type, rows);
    if (rows && rows._dashboardShippers) ds.shippers = rows._dashboardShippers;
    if (rows && rows._shipperGroups) ds.shipperGroups = rows._shipperGroups;
    if (rows && rows._shipperContracts) ds.shipperContracts = rows._shipperContracts;
    if (rows && rows._shipperColumns) ds.shipperColumns = rows._shipperColumns;
    if (rows && rows._shipperSourceRule) ds.shipperSourceRule = rows._shipperSourceRule;
    if (rows && rows._shipperError) ds.shipperError = rows._shipperError;
    return ds;
  };

  const SHIPPER_DRILL = window.SHIPPER_DRILL || { openGroups:{} };
  window.SHIPPER_DRILL = SHIPPER_DRILL;
  SHIPPER_DRILL.toggle = function(code3){
    this.openGroups[code3] = !this.openGroups[code3];
    renderShipper();
  };

  function getShipperGroups(ds){
    if (ds && Array.isArray(ds.shipperGroups) && ds.shipperGroups.length) return ds.shipperGroups;
    if (ds && ds.shippers && Object.keys(ds.shippers).length) {
      return Object.entries(ds.shippers).map(([name,d])=>({
        code3: d.code3 || name,
        name,
        count: d.count || 0,
        income: d.income || 0,
        unit: _yenPer(d.count||0, d.income||0),
        contracts: []
      })).sort((a,b)=>b.income-a.income);
    }
    return [];
  }
  function getShipperContracts(ds){
    return (ds && Array.isArray(ds.shipperContracts)) ? ds.shipperContracts : [];
  }

  function setShipperTabs(mode){
    ['group','detail'].forEach(m=>{
      const btn = document.getElementById('shipper-tab-'+m);
      if (!btn) return;
      const active = m === mode;
      btn.style.background = active ? '#1a4d7c' : 'var(--surface)';
      btn.style.color = active ? '#fff' : 'var(--text2)';
      btn.classList.toggle('active-tab', active);
    });
  }

  function renderGroupTable(groups, totalIncome){
    const tbody = document.getElementById('shipper-group-tbody');
    if (!tbody) return;
    if (!groups.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text3)">荷主別データがありません</td></tr>';
      return;
    }
    const rows = [];
    groups.forEach(g=>{
      const open = !!SHIPPER_DRILL.openGroups[g.code3];
      const rate = totalIncome > 0 ? g.income / totalIncome * 100 : 0;
      rows.push(`<tr style="cursor:pointer;background:${open?'#f8fafc':'#fff'}" onclick="SHIPPER_DRILL.toggle('${_escLocal(g.code3)}')"><td><button class="btn" style="padding:2px 7px;margin-right:8px;font-weight:900">${open?'－':'＋'}</button><strong>${_escLocal(g.name)}</strong> <span style="color:var(--text3);font-size:11px">(${_escLocal(g.code3)})</span></td><td class="r"><strong>${_fmtLocal(g.count)}</strong></td><td class="r"><strong>${_fmtKLocal(g.income)}</strong></td><td class="r">${rate.toFixed(1)}%</td><td class="r">${_fmtLocal(g.unit)}</td><td class="c">${open?'表示中':'開く'}</td></tr>`);
      if (open) {
        rows.push('<tr class="row-h"><td>荷主コード</td><td>契約名</td><td class="r">件数</td><td class="r">売上（千円）</td><td class="r">構成比</td><td class="r">単価（円）</td></tr>');
        (g.contracts || []).forEach(c=>{
          const cr = totalIncome > 0 ? c.income / totalIncome * 100 : 0;
          rows.push(`<tr style="background:#fbfdff"><td style="padding-left:42px;font-family:monospace;color:#334155">${_escLocal(c.code)}</td><td>${_escLocal(c.name)}</td><td class="r">${_fmtLocal(c.count)}</td><td class="r">${_fmtKLocal(c.income)}</td><td class="r">${cr.toFixed(1)}%</td><td class="r">${_fmtLocal(c.unit)}</td></tr>`);
        });
      }
    });
    tbody.innerHTML = rows.join('');
  }

  function renderContractTable(contracts, totalIncome){
    const tbody = document.getElementById('shipper-detail-tbody');
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text3)">契約別データがありません</td></tr>';
      return;
    }
    tbody.innerHTML = contracts.map(c=>{
      const rate = totalIncome > 0 ? c.income / totalIncome * 100 : 0;
      return `<tr><td style="font-family:monospace;color:#334155">${_escLocal(c.code)}</td><td><strong>${_escLocal(c.name)}</strong><div style="font-size:10px;color:var(--text3)">${_escLocal(c.groupName || c.groupCode || '')}</div></td><td class="r">${_fmtLocal(c.count)}</td><td class="r">${_fmtKLocal(c.income)}</td><td class="r">${rate.toFixed(1)}%</td><td class="r">${_fmtLocal(c.unit)}</td></tr>`;
    }).join('');
  }

  renderShipper = function(){
    renderCommonPeriodSelector('shipper');
    const ds = selectedDatasetInSelectedFiscalYear();
    const mode = STATE.shipperMode || 'group';
    setShipperTabs(mode);

    let noticeEl = document.getElementById('shipper-notice');
    if (!noticeEl) {
      const view = document.getElementById('view-shipper');
      if (view) { noticeEl=document.createElement('div'); noticeEl.id='shipper-notice'; view.prepend(noticeEl); }
    }

    const groups = getShipperGroups(ds);
    const contracts = getShipperContracts(ds);
    const totalIncome = groups.reduce((s,g)=>s+(Number(g.income)||0),0) || (ds ? ds.totalIncome : 0) || 0;
    const hasData = groups.length || contracts.length;

    if (!ds || !hasData) {
      if (noticeEl) noticeEl.innerHTML = '<div class="msg msg-info" style="margin-bottom:14px">選択月の荷主別データがありません。確定CSV／速報CSVを再取込してください。</div>';
      if (typeof CHART_MGR !== 'undefined') CHART_MGR.make('c-shipper-bar', {type:'bar', data:{labels:[], datasets:[{data:[]}]}, options:{responsive:true,maintainAspectRatio:false}});
      renderGroupTable([],0);
      renderContractTable([],0);
      return;
    }

    if (noticeEl) {
      const colText = ds.shipperColumns
        ? `取得列：荷主コード=${ds.shipperColumns.shipperCode+1}列目 / 契約名=${ds.shipperColumns.shipperName+1}列目 / 重複キー=${ds.shipperColumns.detailKey+1}列目 / 金額=${ds.shipperColumns.amount+1}列目`
        : '';
      noticeEl.innerHTML = colText ? `<div class="msg msg-info" style="margin-bottom:14px">${_escLocal(ds.shipperSourceRule || '')}　${_escLocal(colText)}</div>` : '';
    }

    const groupCard = document.getElementById('shipper-group-card');
    const detailCard = document.getElementById('shipper-detail-card');
    const title = document.getElementById('shipper-chart-title');
    const sub = document.getElementById('shipper-chart-sub');
    const chartItems = mode === 'detail' ? contracts.slice(0,10) : groups.slice(0,10);

    if (title) title.textContent = mode === 'detail' ? '契約別売上（荷主コード別）' : '荷主別売上（グループ統合）';
    if (sub) sub.textContent = mode === 'detail' ? 'Y列荷主コード別／AB列重複除外' : 'Y列荷主コード頭3桁でグループ化／AB列重複除外';

    if (typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make('c-shipper-bar', {
        type:'bar',
        data:{
          labels:chartItems.map(x => mode === 'detail' ? `${x.code} ${x.name}` : x.name),
          datasets:[{
            label:'売上（千円）',
            data:chartItems.map(x => (Number(x.income)||0)/1000),
            backgroundColor:chartItems.map((_,i)=>CONFIG.COLORS[i%CONFIG.COLORS.length])
          }]
        },
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'千円'}}}}
      });
    }

    if (mode === 'detail') {
      if (groupCard) groupCard.style.display = 'none';
      if (detailCard) detailCard.style.display = '';
      renderContractTable(contracts,totalIncome);
    } else {
      if (groupCard) groupCard.style.display = '';
      if (detailCard) detailCard.style.display = 'none';
      renderGroupTable(groups,totalIncome);
    }
  };

  const originalRenderDashboard = renderDashboard;
  renderDashboard = function(){
    originalRenderDashboard();
    const ds = selectedDashboardDS();
    const shipArea = document.getElementById('shipper-bars-area');
    if (!shipArea || !ds) return;
    const groups = getShipperGroups(ds);
    if (!groups.length) {
      shipArea.innerHTML = '<div class="empty">荷主データは確定CSV／速報CSVから取得します。対象月を再取込してください。</div>';
      return;
    }
    const items = groups.slice(0,8);
    const maxV = Math.max(...items.map(x=>x.income),1);
    shipArea.innerHTML = items.map((g,i)=>`<div class="mbar-row"><div class="mbar-label" title="${_escLocal(g.name)}">${_escLocal(g.name)}</div><div class="mbar-track"><div class="mbar-fill" style="width:${(g.income/maxV*100).toFixed(1)}%;background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div></div><div class="mbar-val">${_fmtKLocal(g.income)}千</div></div>`).join('');
  };
})();



/* ════════════════════════════════════════════════════════════════
   2026-04-30 追補：荷主・件数 集計安定版（CSV専用・収入/費用分離）
   ・収入判定：K列「収支科目名」に「収入」を含む行だけ対象
   ・売上：N列「金額」をそのまま合算（AB列は契約名のため金額重複除外には使わない）
   ・件数：X列「原票番号」のユニーク件数（荷主コードなしのその他収入は件数対象外）
   ・荷主別：Y列「荷主基本コード」を0補完し、左4桁で統合
   ・契約別：Y列「荷主基本コード」を0補完し、全桁で集計
   ・名称：AA列「荷主名」を荷主別表示、AB列「契約名」を契約別表示
   ・既存のダッシュボード・収支グラフは維持し、荷主/件数だけ上書き表示
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const FALLBACK_IDX = {
    accountName: 10,   // K列：収支科目名
    amount: 13,        // N列：金額
    slipNo: 23,        // X列：原票番号
    shipperCode: 24,   // Y列：荷主基本コード
    shipperName: 26,   // AA列：荷主名
    contractName: 27   // AB列：契約名
  };

  function s(v){
    return String(v ?? '')
      .replace(/\uFEFF/g,'')
      .replace(/[\u0000-\u001f]/g,'')
      .trim();
  }

  function esc2(v){
    return typeof esc === 'function'
      ? esc(v)
      : String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt2(v){
    return typeof fmt === 'function' ? fmt(v) : Math.round(Number(v)||0).toLocaleString('ja-JP');
  }

  function fmtK2(v){
    return typeof fmtK === 'function' ? fmtK(v) : Math.round((Number(v)||0)/1000).toLocaleString('ja-JP');
  }

  function yen(v){
    const t = s(v)
      .replace(/,/g,'')
      .replace(/[円¥￥\s　]/g,'')
      .replace(/[^0-9.\-]/g,'');
    if (!t || t === '-' || t === '.') return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  function headerIndex(header, names, fallback){
    if (!Array.isArray(header)) return fallback;
    const normalized = header.map(h => s(h).replace(/[\s　]/g,''));
    for (const name of names) {
      const key = s(name).replace(/[\s　]/g,'');
      const idx = normalized.findIndex(h => h === key);
      if (idx >= 0) return idx;
    }
    return fallback;
  }

  function makeIndexes(rows){
    const header = Array.isArray(rows) && rows.length ? rows[0] : [];
    return {
      accountName: headerIndex(header, ['収支科目名'], FALLBACK_IDX.accountName),
      amount: headerIndex(header, ['金額'], FALLBACK_IDX.amount),
      slipNo: headerIndex(header, ['原票番号'], FALLBACK_IDX.slipNo),
      shipperCode: headerIndex(header, ['荷主基本コード','荷主コード'], FALLBACK_IDX.shipperCode),
      shipperName: headerIndex(header, ['荷主名'], FALLBACK_IDX.shipperName),
      contractName: headerIndex(header, ['契約名'], FALLBACK_IDX.contractName)
    };
  }

  function normalizeCode(v){
    let c = s(v).replace(/\.0$/,'').replace(/[^0-9A-Za-z]/g,'');
    if (!c) return '';
    if (!c.startsWith('0')) c = '0' + c;
    return c;
  }

  function groupKeyFromCode(code){
    return normalizeCode(code).slice(0,4);
  }

  function simplifyName(name){
    const n = s(name).replace(/（.*?）/g,'').replace(/\(.*?\)/g,'').trim();
    if (/でんきち|デンキチ/i.test(n)) return 'でんきち';
    if (/コジマ/i.test(n)) return 'コジマ';
    if (/ビックカメラ|ビック/i.test(n)) return 'ビックカメラ';
    if (/ジェイトップ/i.test(n)) return 'ジェイトップ';
    if (/スリーエス/i.test(n)) return 'スリーエスサンキ家具';
    if (/プラスカーゴ/i.test(n)) return 'プラスカーゴサービス';
    if (/フジ医療器/i.test(n)) return 'フジ医療器';
    return n || '未設定';
  }

  function majorityName(names, simplify=true){
    const counts = new Map();
    Array.from(names || []).forEach(name=>{
      const n = simplify ? simplifyName(name) : (s(name) || '未設定');
      counts.set(n, (counts.get(n)||0)+1);
    });
    if (!counts.size) return '未設定';
    return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'ja'))[0][0];
  }

  function unit(count, income){
    return count > 0 ? Math.round((Number(income)||0) / count) : 0;
  }

  function isIncomeRow(row, idx){
    const account = s(row[idx.accountName]);
    return account.includes('収入');
  }

  function classifyOtherIncome(row, idx){
    const account = s(row[idx.accountName]);
    if (account.includes('雑')) return '雑収入';
    if (account.includes('調整')) return '調整';
    if (account.includes('値引')) return '値引戻し';
    if (account.includes('返品')) return '返品関連';
    if (account.includes('手数料')) return '手数料';
    if (account) return account;
    return 'その他';
  }

  function buildShipperAggregationV3(csvRows){
    const rows = Array.isArray(csvRows) ? csvRows : [];
    if (!rows.length) {
      return { groups:[], contracts:[], dashboardShippers:{}, ticketCount:0, totalIncome:0 };
    }

    const idx = makeIndexes(rows);
    const body = rows.length > 1 ? rows.slice(1) : rows;

    const groups = new Map();
    const contracts = new Map();
    const allSlipSet = new Set();

    let targetRows = 0;
    let skippedNoCode = 0;
    let totalIncome = 0;

    body.forEach((row, rowIndex)=>{
      if (!Array.isArray(row)) return;

      // 収入/費用の分離はK列（収支科目名）で行う。
      // 費用行、備車費、社宅・寮費などを荷主売上へ混入させない。
      if (!isIncomeRow(row, idx)) return;
      targetRows++;

      const rawCode = s(row[idx.shipperCode]);
      const hasCode = !!rawCode;
      const fullCode = hasCode ? normalizeCode(rawCode) : '9999';
      const gKey = hasCode ? groupKeyFromCode(fullCode) : '9999';
      if (!gKey) {
        skippedNoCode++;
        return;
      }

      if (!hasCode) skippedNoCode++;

      const shipperName = hasCode ? (s(row[idx.shipperName]) || '未設定') : 'その他収入（荷主未設定）';
      const otherClass = classifyOtherIncome(row, idx);
      const contractName = hasCode ? (s(row[idx.contractName]) || shipperName || '未設定') : otherClass;
      const contractKey = hasCode ? fullCode : `9999_${otherClass}`;
      const slip = s(row[idx.slipNo]) || `__row_slip_${rowIndex}`;
      const amount = yen(row[idx.amount]);

      totalIncome += amount;
      if (hasCode) {
        allSlipSet.add(slip);
      }

      if (!groups.has(gKey)) {
        groups.set(gKey, {
          code4:gKey,
          names:new Set(),
          slipSet:new Set(),
          income:0,
          contracts:new Map(),
          breakdown:new Map()
        });
      }

      const group = groups.get(gKey);
      group.names.add(shipperName);
      if (hasCode) {
        group.slipSet.add(slip);
      }
      group.income += amount;
      if (!hasCode) {
        // 荷主コードなしの「その他収入」は売上には含めるが、件数・単価・契約別には含めない。
        group.breakdown.set(otherClass, (group.breakdown.get(otherClass) || 0) + amount);
        return;
      }

      if (!contracts.has(contractKey)) {
        contracts.set(contractKey, {
          code:contractKey,
          groupCode:gKey,
          shipperNames:new Set(),
          contractNames:new Set(),
          slipSet:new Set(),
          income:0
        });
      }

      const contract = contracts.get(contractKey);
      contract.shipperNames.add(shipperName);
      contract.contractNames.add(contractName);
      contract.slipSet.add(slip);
      contract.income += amount;
      group.contracts.set(contractKey, contract);
    });

    const contractList = Array.from(contracts.values()).map(c=>{
      const displayName = majorityName(c.contractNames, false);
      return {
        code:c.code,
        groupCode:c.groupCode,
        name:displayName,
        shipperName:majorityName(c.shipperNames, true),
        contractName:displayName,
        count:c.slipSet.size,
        income:c.income,
        unit:unit(c.slipSet.size, c.income)
      };
    }).sort((a,b)=>b.income-a.income || b.count-a.count || a.code.localeCompare(b.code,'ja'));

    const groupList = Array.from(groups.values()).map(g=>{
      const contractsInGroup = Array.from(g.contracts.values()).map(c=>{
        const displayName = majorityName(c.contractNames, false);
        return {
          code:c.code,
          groupCode:c.groupCode,
          name:displayName,
          shipperName:majorityName(c.shipperNames, true),
          contractName:displayName,
          count:c.slipSet.size,
          income:c.income,
          unit:unit(c.slipSet.size, c.income)
        };
      }).sort((a,b)=>b.income-a.income || b.count-a.count || a.code.localeCompare(b.code,'ja'));

      return {
        code4:g.code4,
        code3:g.code4,
        name:majorityName(g.names, true),
        count:g.slipSet.size,
        income:g.income,
        unit:g.code4 === '9999' ? null : unit(g.slipSet.size, g.income),
        isOther:g.code4 === '9999',
        contracts:contractsInGroup,
        breakdown:Array.from((g.breakdown || new Map()).entries()).map(([name,income])=>({name,income})).sort((a,b)=>b.income-a.income)
      };
    }).sort((a,b)=>b.income-a.income || b.count-a.count || a.name.localeCompare(b.name,'ja'));

    const dashboardShippers = {};
    groupList.forEach(g=>{
      dashboardShippers[g.name] = {
        income:g.income,
        count:g.code4 === '9999' ? 0 : g.count,
        code4:g.code4,
        code3:g.code4,
        isOther:g.code4 === '9999'
      };
    });

    return {
      groups:groupList,
      contracts:contractList,
      dashboardShippers,
      ticketCount:allSlipSet.size,
      totalIncome,
      targetRows,
      skippedNoCode,
      sourceRule:'K列「収支科目名」に収入を含む行のみ / N列金額を合算 / X列原票番号で件数（その他収入は件数対象外） / Y列0補完左4桁で荷主統合 / Y列空欄はその他収入（荷主未設定）として内訳分解 / 契約別はY列全桁コード別 / AA列荷主名 / AB列契約名',
      columns:idx
    };
  }

  const prevParseSKDL = CSV.parseSKDL.bind(CSV);
  CSV.parseSKDL = function(text, monthCol){
    const result = prevParseSKDL(text, monthCol);
    if (!result) return result;

    try {
      const rows = this.toRows(text);
      const agg = buildShipperAggregationV3(rows);
      result._shipperGroups = agg.groups;
      result._shipperContracts = agg.contracts;
      result._dashboardShippers = agg.dashboardShippers;
      result._shipperTicketCount = agg.ticketCount;
      result._shipperIncomeTotal = agg.totalIncome;
      result._shipperTargetRows = agg.targetRows;
      result._shipperSkippedNoCode = agg.skippedNoCode;
      result._shipperSourceRule = agg.sourceRule;
      result._shipperColumns = agg.columns;
      result._shipperError = '';
    } catch(e) {
      result._shipperGroups = [];
      result._shipperContracts = [];
      result._dashboardShippers = {};
      result._shipperTicketCount = 0;
      result._shipperIncomeTotal = 0;
      result._shipperTargetRows = 0;
      result._shipperSkippedNoCode = 0;
      result._shipperError = e.message;
    }

    return result;
  };

  const prevProcessDataset = processDataset;
  processDataset = function(ym, type, rows){
    const ds = prevProcessDataset(ym, type, rows);
    if (rows && rows._dashboardShippers) ds.shippers = rows._dashboardShippers;
    if (rows && rows._shipperGroups) ds.shipperGroups = rows._shipperGroups;
    if (rows && rows._shipperContracts) ds.shipperContracts = rows._shipperContracts;
    if (rows && typeof rows._shipperTicketCount === 'number') ds.shipperTicketCount = rows._shipperTicketCount;
    if (rows && typeof rows._shipperIncomeTotal === 'number') ds.shipperIncomeTotal = rows._shipperIncomeTotal;
    if (rows && typeof rows._shipperTargetRows === 'number') ds.shipperTargetRows = rows._shipperTargetRows;
    if (rows && typeof rows._shipperSkippedNoCode === 'number') ds.shipperSkippedNoCode = rows._shipperSkippedNoCode;
    if (rows && rows._shipperSourceRule) ds.shipperSourceRule = rows._shipperSourceRule;
    if (rows && rows._shipperColumns) ds.shipperColumns = rows._shipperColumns;
    if (rows && rows._shipperError) ds.shipperError = rows._shipperError;
    return ds;
  };

  function groupsOf(ds){
    if (ds && Array.isArray(ds.shipperGroups)) return ds.shipperGroups;
    if (ds && ds.shippers) {
      return Object.entries(ds.shippers).map(([name,d])=>({
        name,
        income:Number(d.income)||0,
        count:Number(d.count)||0,
        code4:d.code4||d.code3||name,
        code3:d.code4||d.code3||name,
        contracts:[]
      }));
    }
    return [];
  }

  function contractsOf(ds){
    return ds && Array.isArray(ds.shipperContracts) ? ds.shipperContracts : [];
  }

  function ticketCountOf(ds){
    if (!ds) return 0;
    if (typeof ds.shipperTicketCount === 'number') return ds.shipperTicketCount;
    const gs = groupsOf(ds);
    return gs.reduce((sum,g)=>sum+(Number(g.count)||0),0);
  }

  const prevRenderDashboard = renderDashboard;
  renderDashboard = function(){
    prevRenderDashboard();

    const ds = selectedDashboardDS();
    const shipArea = document.getElementById('shipper-bars-area');
    if (!shipArea || !ds) return;

    const items = groupsOf(ds)
      .filter(g => Number(g.income) !== 0 || Number(g.count) !== 0)
      .slice(0,8);

    if (!items.length) {
      shipArea.innerHTML = '<div class="empty">荷主データなし。確定CSV／速報CSVを再取込してください。</div>';
      return;
    }

    const maxV = Math.max(...items.map(g=>Math.abs(Number(g.income)||0)),1);
    const shipperTotal = groupsOf(ds).reduce((sum,g)=>sum+(Number(g.income)||0),0);
    const revenueTotal = Number(ds.totalIncome)||0;
    const gap = revenueTotal - shipperTotal;
    const gapK = Math.round(gap/1000);
    const gapOk = Math.abs(gapK) <= 1;
    const verifyHtml = `
      <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;font-size:12px;color:var(--text2);margin:0 0 8px">
        <span>営業収益 ${fmtK2(revenueTotal)}千</span>
        <span>荷主合計 ${fmtK2(shipperTotal)}千</span>
        <span style="font-weight:900;color:${gapOk ? '#059669' : '#dc2626'}">差分 ${fmtK2(gap)}千</span>
      </div>`;
    shipArea.innerHTML = verifyHtml + items.map((g,i)=>`
      <div class="mbar-row">
        <div class="mbar-label" title="${esc2(g.name)}">${esc2(g.name)}</div>
        <div class="mbar-track">
          <div class="mbar-fill" style="width:${(Math.abs(Number(g.income)||0)/maxV*100).toFixed(1)}%;background:${CONFIG.COLORS[i%CONFIG.COLORS.length]}"></div>
        </div>
        <div class="mbar-val">${fmtK2(g.income)}千</div>
      </div>
    `).join('');
  };

  const prevRenderTrend = renderTrend;
  renderTrend = function(){
    prevRenderTrend();

    const list = datasetsForSelectedFiscalYear();
    if (!list || !list.length) return;
    const labels = list.map(d=>ymLabel(d.ym));

    if (document.getElementById('c-trend-cnt') && typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make('c-trend-cnt', {
        type:'bar',
        data:{
          labels,
          datasets:[{
            label:'件数',
            data:list.map(d=>ticketCountOf(d)),
            backgroundColor:'rgba(26,77,124,.72)'
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{legend:{display:false}},
          scales:{y:{title:{display:true,text:'件'}}}
        }
      });
    }

    if (document.getElementById('c-trend-shipper') && typeof CHART_MGR !== 'undefined') {
      const latest = selectedDatasetInSelectedFiscalYear() || list[list.length-1];
      const top = groupsOf(latest).slice(0,5);

      CHART_MGR.make('c-trend-shipper', {
        type:'line',
        data:{
          labels,
          datasets:top.map((g,i)=>({
            label:g.name,
            data:list.map(d=>{
              const found = groupsOf(d).find(x=>x.code4 === g.code4 || x.name === g.name);
              return found ? (Number(found.income)||0)/1000 : 0;
            }),
            borderColor:CONFIG.COLORS[i%CONFIG.COLORS.length],
            backgroundColor:CONFIG.COLORS[i%CONFIG.COLORS.length],
            tension:.25
          }))
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{legend:{position:'bottom'}},
          scales:{y:{title:{display:true,text:'千円'}}}
        }
      });
    }

    const tbl = document.getElementById('trend-table-body') || document.getElementById('trend-summary-body');
    if (tbl) {
      tbl.innerHTML = list.map(d=>{
        const cnt = ticketCountOf(d);
        const unitValue = cnt > 0 ? Math.round((Number(d.totalIncome)||0) / cnt) : 0;
        return `<tr>
          <td>${ymLabel(d.ym)}</td>
          <td class="r">${fmtK2(d.totalIncome)}</td>
          <td class="r">${fmtK2(d.totalExpense)}</td>
          <td class="r">${fmtK2(d.profit)}</td>
          <td class="r">${pct(d.profitRate || 0)}</td>
          <td class="r">${fmt2(cnt)}</td>
          <td class="r">${fmt2(unitValue)}</td>
        </tr>`;
      }).join('');
    }
  };

  const prevRenderShipper = renderShipper;
  renderShipper = function(){
    prevRenderShipper();

    const ds = selectedDatasetInSelectedFiscalYear() || selectedDashboardDS();
    const mode = STATE.shipperMode || 'group';
    const groups = groupsOf(ds);
    const contracts = contractsOf(ds);
    const totalIncome = groups.reduce((sum,g)=>sum+(Number(g.income)||0),0) || (ds ? Number(ds.totalIncome)||0 : 0);

    const noticeId = 'shipper-rule-notice';
    let noticeEl = document.getElementById(noticeId);
    if (!noticeEl) {
      const view = document.getElementById('view-shipper');
      if (view) {
        noticeEl = document.createElement('div');
        noticeEl.id = noticeId;
        view.prepend(noticeEl);
      }
    }

    if (noticeEl) {
      const rule = ds && ds.shipperSourceRule ? esc2(ds.shipperSourceRule) : '';
      const summary = ds ? ` / 対象収入行 ${fmt2(ds.shipperTargetRows || 0)}行 / 荷主売上 ${fmtK2(ds.shipperIncomeTotal || 0)}千円` : '';
      noticeEl.innerHTML = rule
        ? `<div class="msg msg-info" style="margin-bottom:14px">${rule}${summary}</div>`
        : '';
    }

    const chartItems = (mode === 'detail' ? contracts : groups).slice(0,10);
    if (typeof CHART_MGR !== 'undefined') {
      CHART_MGR.make('c-shipper-bar', {
        type:'bar',
        data:{
          labels:chartItems.map(x=>x.name),
          datasets:[{
            label:'売上（千円）',
            data:chartItems.map(x=>(Number(x.income)||0)/1000),
            backgroundColor:chartItems.map((_,i)=>CONFIG.COLORS[i%CONFIG.COLORS.length])
          }]
        },
        options:{
          indexAxis:'y',
          responsive:true,
          maintainAspectRatio:false,
          plugins:{legend:{display:false}},
          scales:{x:{title:{display:true,text:'千円'}}}
        }
      });
    }

    const groupCard = document.getElementById('shipper-group-card');
    const detailCard = document.getElementById('shipper-detail-card');

    if (mode === 'detail') {
      if (groupCard) groupCard.style.display = 'none';
      if (detailCard) detailCard.style.display = '';

      const tbody = document.getElementById('shipper-detail-tbody');
      if (tbody) {
        tbody.innerHTML = contracts.length ? contracts.map(c=>{
          const rate = totalIncome > 0 ? c.income/totalIncome*100 : 0;
          return `<tr>
            <td style="font-family:monospace">${String(c.code || '').startsWith('9999_') ? '—' : esc2(c.code)}</td>
            <td><strong>${esc2(c.name)}</strong></td>
            <td class="r">${String(c.code || '').startsWith('9999_') ? '—' : fmt2(c.count)}</td>
            <td class="r">${fmtK2(c.income)}</td>
            <td class="r">${rate.toFixed(1)}%</td>
            <td class="r">${String(c.code || '').startsWith('9999_') ? '—' : fmt2(c.unit)}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text3)">契約別データがありません</td></tr>';
      }
    } else {
      if (groupCard) groupCard.style.display = '';
      if (detailCard) detailCard.style.display = 'none';

      const tbody = document.getElementById('shipper-group-tbody');
      if (tbody) {
        const shipperTotal = groups.reduce((sum,g)=>sum+(Number(g.income)||0),0);
        const revenueTotal = ds ? (Number(ds.totalIncome)||0) : 0;
        const gap = revenueTotal - shipperTotal;
        const gapOk = Math.abs(Math.round(gap/1000)) <= 1;

        const verifyRow = `<tr style="background:${gapOk ? '#ecfdf5' : '#fef2f2'}">
          <td><strong>営業収益との差分チェック</strong></td>
          <td class="r">営業収益 ${fmtK2(revenueTotal)}千</td>
          <td class="r">荷主合計 ${fmtK2(shipperTotal)}千</td>
          <td class="r" style="font-weight:900;color:${gapOk ? '#059669' : '#dc2626'}">差分 ${fmtK2(gap)}千</td>
          <td class="r">${gapOk ? 'OK' : '要確認'}</td>
          <td></td>
        </tr>`;

        tbody.innerHTML = groups.length ? verifyRow + groups.map((g,gi)=>{
          const rate = totalIncome > 0 ? g.income/totalIncome*100 : 0;
          const detailId = `shipper-group-detail-${gi}`;
          const hasContracts = Array.isArray(g.contracts) && g.contracts.length;
          let html = `<tr>
            <td><strong>${esc2(g.name)}</strong></td>
            <td class="r"><strong>${g.code4 === '9999' ? '—' : fmt2(g.count)}</strong></td>
            <td class="r"><strong>${fmtK2(g.income)}</strong></td>
            <td class="r">${rate.toFixed(1)}%</td>
            <td class="r">${g.code4 === '9999' ? '—' : fmt2(g.unit)}</td>
            <td class="r">${hasContracts ? `<button type="button" class="btn-mini" data-shipper-toggle="${detailId}">＋</button>` : ''}</td>
          </tr>`;

          if (g.code4 === '9999' && Array.isArray(g.breakdown) && g.breakdown.length) {
            html += g.breakdown.map(b=>{
              const br = g.income > 0 ? (Number(b.income)||0) / g.income * 100 : 0;
              return `<tr style="background:#f8fafc">
                <td style="padding-left:28px;color:var(--text2)">└ ${esc2(b.name)}</td>
                <td class="r">—</td>
                <td class="r">${fmtK2(b.income)}</td>
                <td class="r">${br.toFixed(1)}%</td>
                <td class="r">—</td>
                <td></td>
              </tr>`;
            }).join('');
          }

          if (hasContracts) {
            const contractRows = g.contracts.map(c=>{
              const cr = g.income > 0 ? (Number(c.income)||0) / g.income * 100 : 0;
              const codeText = String(c.code || '').startsWith('9999_') ? '—' : esc2(c.code);
              return `<tr>
                <td style="font-family:monospace;color:var(--text2)">${codeText}</td>
                <td>${esc2(c.name)}</td>
                <td class="r">${String(c.code || '').startsWith('9999_') ? '—' : fmt2(c.count)}</td>
                <td class="r">${fmtK2(c.income)}</td>
                <td class="r">${cr.toFixed(1)}%</td>
                <td class="r">${String(c.code || '').startsWith('9999_') ? '—' : fmt2(c.unit)}</td>
              </tr>`;
            }).join('');
            html += `<tr id="${detailId}" style="display:none;background:#ffffff">
              <td colspan="6" style="padding:0">
                <div style="padding:12px 16px;background:#f8fafc;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
                  <div style="font-weight:900;margin-bottom:8px;color:var(--text)">${esc2(g.name)} 契約別内訳</div>
                  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden">
                    <thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:8px">荷主コード</th><th style="text-align:left;padding:8px">契約名</th><th style="text-align:right;padding:8px">件数</th><th style="text-align:right;padding:8px">売上（千円）</th><th style="text-align:right;padding:8px">構成比</th><th style="text-align:right;padding:8px">単価（円）</th></tr></thead>
                    <tbody>${contractRows}</tbody>
                  </table>
                </div>
              </td>
            </tr>`;
          }
          return html;
        }).join('') : '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text3)">荷主別データがありません</td></tr>';

        tbody.querySelectorAll('[data-shipper-toggle]').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const id = btn.getAttribute('data-shipper-toggle');
            const row = document.getElementById(id);
            if (!row) return;
            const open = row.style.display !== 'none';
            row.style.display = open ? 'none' : '';
            btn.textContent = open ? '＋' : '－';
          });
        });
      }
    }
  };
})();

/* ════════════════════════════════════════════════════════════════
   2026-04-30 追補：異常検知（単価・件数・売上）
   ・対象：荷主別グループ（その他収入は除外）
   ・単価：3,000円未満 / 20,000円超を検知（件数1件以下は除外）
   ・件数：前月比±50%以上を検知
   ・売上：前月比±30%以上を検知
   ・表示：荷主分析画面に詳細、ダッシュボードに簡易件数
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  const UNIT_MIN = 3000;
  const UNIT_MAX = 20000;
  const COUNT_RATE_LIMIT = 50;
  const SALES_RATE_LIMIT = 30;
  function fmtNum(v){ return Math.round(Number(v)||0).toLocaleString('ja-JP'); }
  function fmtKLocal(v){ return typeof fmtK === 'function' ? fmtK(v) : Math.round((Number(v)||0)/1000).toLocaleString('ja-JP'); }
  function escLocal(v){ const s=String(v??''); return typeof esc==='function'?esc(s):s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function ymPrev(ym){ if(!ym||ym.length<6)return null; let y=parseInt(ym.slice(0,4),10); let m=parseInt(ym.slice(4,6),10)-1; if(!y||!Number.isFinite(m))return null; if(m<=0){y-=1;m=12;} return String(y)+String(m).padStart(2,'0'); }
  function groupsOfLocal(ds){
    if(ds&&Array.isArray(ds.shipperGroups))return ds.shipperGroups;
    if(ds&&ds.shippers){return Object.entries(ds.shippers).map(([name,d])=>({name,code4:d.code4||d.code3||name,count:Number(d.count)||0,income:Number(d.income)||0,isOther:!!d.isOther}));}
    return [];
  }
  function groupKey(g){ return String(g.code4||g.code3||g.name||''); }
  function rateObj(cur,prev){ if(!prev)return null; const rate=(Number(cur)||0-Number(prev||0))/Math.abs(Number(prev)||1)*100; if(!Number.isFinite(rate))return null; return {rate,text:(rate>0?'+':'')+Math.round(rate)+'%'}; }
  function prevDatasetFor(ds){ if(!ds||!ds.ym||typeof activeDatasetByYM!=='function')return null; const p=ymPrev(ds.ym); return p?activeDatasetByYM(p):null; }
  function detectShipperAnomalies(ds){
    const groups=groupsOfLocal(ds).filter(g=>!g.isOther&&String(g.code4||'')!=='9999');
    const prevMap=new Map(groupsOfLocal(prevDatasetFor(ds)).map(g=>[groupKey(g),g]));
    const list=[];
    groups.forEach(g=>{
      const name=g.name||'未設定', key=groupKey(g), count=Number(g.count)||0, income=Number(g.income)||0, unit=count>0?Math.round(income/count):0;
      if(count>1){
        if(unit>UNIT_MAX)list.push({level:'high',type:'単価高',name,detail:`単価 ${fmtNum(unit)}円（基準 ${fmtNum(UNIT_MAX)}円超）`,amount:income,count,key});
        else if(unit>0&&unit<UNIT_MIN)list.push({level:'mid',type:'単価低',name,detail:`単価 ${fmtNum(unit)}円（基準 ${fmtNum(UNIT_MIN)}円未満）`,amount:income,count,key});
      }
      const pg=prevMap.get(key);
      if(pg){
        const cr=rateObj(count,Number(pg.count)||0);
        if(cr&&Math.abs(cr.rate)>=COUNT_RATE_LIMIT)list.push({level:'mid',type:'件数変動',name,detail:`前月比 ${cr.text}（${fmtNum(pg.count)}件 → ${fmtNum(count)}件）`,amount:income,count,key});
        const sr=rateObj(income,Number(pg.income)||0);
        if(sr&&Math.abs(sr.rate)>=SALES_RATE_LIMIT)list.push({level:'mid',type:'売上変動',name,detail:`前月比 ${sr.text}（${fmtKLocal(pg.income)}千 → ${fmtKLocal(income)}千）`,amount:income,count,key});
      }
    });
    return list.sort((a,b)=>(a.level==='high'?0:1)-(b.level==='high'?0:1)||Math.abs(Number(b.amount)||0)-Math.abs(Number(a.amount)||0));
  }
  function ensureAnomalyStyles(){
    if(document.getElementById('anomaly-style-v1'))return;
    const style=document.createElement('style'); style.id='anomaly-style-v1';
    style.textContent=`.anomaly-card{background:#fff;border:1px solid var(--border,#dbe3ee);border-radius:14px;box-shadow:0 2px 8px rgba(15,23,42,.08);margin:16px 0;overflow:hidden}.anomaly-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb);font-weight:900;color:var(--text,#0f172a)}.anomaly-sub{font-size:12px;color:var(--text3,#94a3b8);font-weight:700}.anomaly-body{padding:12px 16px}.anomaly-empty{padding:14px 16px;color:#059669;font-weight:900;background:#ecfdf5;border-radius:10px}.anomaly-list{display:grid;gap:8px}.anomaly-item{display:grid;grid-template-columns:110px 1fr 1.5fr 90px;gap:10px;align-items:center;padding:10px 12px;border:1px solid #fee2e2;border-radius:10px;background:#fff7ed;font-size:13px}.anomaly-badge{display:inline-flex;justify-content:center;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:900;background:#fee2e2;color:#b91c1c}.anomaly-badge.mid{background:#fef3c7;color:#92400e}.anomaly-name{font-weight:900;color:var(--text,#0f172a)}.anomaly-detail{color:var(--text2,#475569)}.anomaly-num{text-align:right;font-weight:900;color:var(--text,#0f172a)}.anomaly-mini{font-size:12px;margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-weight:900}@media(max-width:800px){.anomaly-item{grid-template-columns:1fr}.anomaly-num{text-align:left}}`;
    document.head.appendChild(style);
  }
  function anomalyHtml(list,ds){
    const month=ds&&ds.ym?ymLabel(ds.ym):'対象月';
    if(!list.length)return `<div class="anomaly-card"><div class="anomaly-head"><span>⚠ 異常検知</span><span class="anomaly-sub">${escLocal(month)} / 単価・件数・売上</span></div><div class="anomaly-body"><div class="anomaly-empty">異常なし</div></div></div>`;
    return `<div class="anomaly-card"><div class="anomaly-head"><span>⚠ 異常検知</span><span class="anomaly-sub">${escLocal(month)} / ${list.length}件</span></div><div class="anomaly-body"><div class="anomaly-list">${list.map(x=>`<div class="anomaly-item"><div><span class="anomaly-badge ${x.level==='high'?'':'mid'}">${escLocal(x.type)}</span></div><div class="anomaly-name">${escLocal(x.name)}</div><div class="anomaly-detail">${escLocal(x.detail)}</div><div class="anomaly-num">${fmtKLocal(x.amount)}千</div></div>`).join('')}</div></div></div>`;
  }
  function renderAnomalyPanel(){
    ensureAnomalyStyles();
    const ds=typeof selectedDatasetInSelectedFiscalYear==='function'?selectedDatasetInSelectedFiscalYear():(typeof selectedDashboardDS==='function'?selectedDashboardDS():null);
    const view=document.getElementById('view-shipper'); if(!view||!ds)return;
    let panel=document.getElementById('shipper-anomaly-panel');
    if(!panel){ panel=document.createElement('div'); panel.id='shipper-anomaly-panel'; const anchor=document.getElementById('shipper-group-card')||document.getElementById('shipper-detail-card'); if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(panel,anchor.nextSibling); else view.appendChild(panel); }
    panel.innerHTML=anomalyHtml(detectShipperAnomalies(ds),ds);
  }
  function renderDashboardAnomalyMini(){
    // 異常検知は荷主分析画面のみ表示。ダッシュボード側の簡易表示は出さない。
    const mini=document.getElementById('dashboard-anomaly-mini');
    if(mini) mini.remove();
  }
  const prevRenderShipperForAnomaly=renderShipper;
  renderShipper=function(){ prevRenderShipperForAnomaly(); renderAnomalyPanel(); };
  const prevRenderDashboardForAnomaly=renderDashboard;
  renderDashboard=function(){ prevRenderDashboardForAnomaly(); renderDashboardAnomalyMini(); };
})();

/* ════════════════════════════════════════════════════════════════
   2026-04-30 追補：荷主別 前月・前年比較 ＋ 件数×単価 分解
   ・対象：荷主別グループ（その他収入は除外）
   ・比較：前月、前年同月
   ・分解：売上 = 件数 × 平均単価
   ・表示：荷主分析画面に専用カード、ダッシュボードに簡易カード
════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  function escCmp(v){
    const s = String(v ?? '');
    return typeof esc === 'function'
      ? esc(s)
      : s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtCmp(v){
    const n = Number(v) || 0;
    return Math.round(n).toLocaleString('ja-JP');
  }

  function fmtKCmp(v){
    return typeof fmtK === 'function'
      ? fmtK(v)
      : Math.round((Number(v)||0)/1000).toLocaleString('ja-JP');
  }

  function ymLabelCmp(ym){
    return typeof ymLabel === 'function' ? ymLabel(ym) : (ym || '対象月');
  }

  function prevYM(ym){
    if (!ym || String(ym).length < 6) return null;
    let y = parseInt(String(ym).slice(0,4),10);
    let m = parseInt(String(ym).slice(4,6),10) - 1;
    if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
    if (m <= 0) { y -= 1; m = 12; }
    return String(y) + String(m).padStart(2,'0');
  }

  function lastYearYM(ym){
    if (!ym || String(ym).length < 6) return null;
    const y = parseInt(String(ym).slice(0,4),10) - 1;
    const m = String(ym).slice(4,6);
    if (!Number.isFinite(y)) return null;
    return String(y) + m;
  }

  function groupsFromDS(ds){
    if (!ds) return [];
    if (Array.isArray(ds.shipperGroups)) {
      return ds.shipperGroups
        .filter(g => g && !g.isOther && String(g.code4 || '') !== '9999')
        .map(g => ({
          key: String(g.code4 || g.code3 || g.name || ''),
          name: String(g.name || '未設定'),
          count: Number(g.count) || 0,
          income: Number(g.income) || 0,
          unit: Number(g.unit) || ((Number(g.count)||0) > 0 ? Math.round((Number(g.income)||0) / (Number(g.count)||1)) : 0)
        }));
    }
    if (ds.shippers && typeof ds.shippers === 'object') {
      return Object.entries(ds.shippers)
        .filter(([name,d]) => !(d && d.isOther) && String(d && (d.code4 || d.code3) || '') !== '9999')
        .map(([name,d]) => ({
          key: String((d && (d.code4 || d.code3)) || name),
          name: String(name || '未設定'),
          count: Number(d && d.count) || 0,
          income: Number(d && d.income) || 0,
          unit: (Number(d && d.count)||0) > 0 ? Math.round((Number(d && d.income)||0) / (Number(d && d.count)||1)) : 0
        }));
    }
    return [];
  }

  function dsByYM(ym){
    return ym && typeof activeDatasetByYM === 'function' ? activeDatasetByYM(ym) : null;
  }

  function pctDiff(cur, base){
    const c = Number(cur) || 0;
    const b = Number(base) || 0;
    if (!b) return null;
    return (c / b - 1) * 100;
  }

  function diffText(cur, base, unitLabel){
    const d = (Number(cur)||0) - (Number(base)||0);
    const p = pctDiff(cur, base);
    const sign = d >= 0 ? '+' : '';
    const value = unitLabel === '千円' ? `${sign}${fmtKCmp(d)}千円` : `${sign}${fmtCmp(d)}${unitLabel}`;
    const pctText = p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
    return `${value} / ${pctText}`;
  }

  function buildComparisonRows(ds){
    if (!ds || !ds.ym) return [];
    const curGroups = groupsFromDS(ds);
    const prevDS = dsByYM(prevYM(ds.ym));
    const lyDS = dsByYM(lastYearYM(ds.ym));
    const prevMap = new Map(groupsFromDS(prevDS).map(g => [g.key, g]));
    const lyMap = new Map(groupsFromDS(lyDS).map(g => [g.key, g]));

    return curGroups
      .sort((a,b)=>b.income-a.income || b.count-a.count || a.name.localeCompare(b.name,'ja'))
      .slice(0,12)
      .map(g => {
        const p = prevMap.get(g.key) || null;
        const y = lyMap.get(g.key) || null;
        const unit = g.count > 0 ? Math.round(g.income / g.count) : 0;

        // 前月差を「件数要因」と「単価要因」に分解。
        // 前月データがない場合は計算しない。
        let countEffect = null;
        let unitEffect = null;
        if (p && p.count > 0) {
          const pUnit = p.count > 0 ? p.income / p.count : 0;
          countEffect = (g.count - p.count) * pUnit;
          unitEffect = g.count * (unit - pUnit);
        }

        return {
          ...g,
          unit,
          prev:p,
          lastYear:y,
          countEffect,
          unitEffect
        };
      });
  }

  function ensureCompareStyles(){
    if (document.getElementById('shipper-compare-style-v1')) return;
    const style = document.createElement('style');
    style.id = 'shipper-compare-style-v1';
    style.textContent = `
      .shipper-compare-card{background:#fff;border:1px solid var(--border,#dbe3ee);border-radius:14px;box-shadow:0 2px 8px rgba(15,23,42,.08);margin:16px 0;overflow:hidden}
      .shipper-compare-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb);font-weight:900;color:var(--text,#0f172a)}
      .shipper-compare-sub{font-size:12px;color:var(--text3,#94a3b8);font-weight:700}
      .shipper-compare-body{padding:12px 16px;overflow-x:auto}
      .shipper-compare-table{width:100%;border-collapse:collapse;font-size:12px;min-width:980px}
      .shipper-compare-table th{background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#475569;text-align:left;padding:8px;white-space:nowrap}
      .shipper-compare-table td{border-bottom:1px solid #f1f5f9;padding:8px;vertical-align:middle}
      .shipper-compare-table .r{text-align:right;white-space:nowrap}
      .shipper-compare-name{font-weight:900;color:#0f172a;white-space:nowrap}
      .shipper-compare-formula{color:#64748b;font-size:11px;white-space:nowrap}
      .shipper-up{color:#059669;font-weight:900}
      .shipper-down{color:#dc2626;font-weight:900}
      .shipper-flat{color:#64748b;font-weight:800}
      .dashboard-compare-mini{margin-top:10px;padding:12px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px;font-size:12px;color:#1e3a8a;line-height:1.7}
      .dashboard-compare-mini strong{font-weight:900}
      .dashboard-unit-title{font-weight:900;margin-bottom:6px;color:#1e3a8a}
      .dashboard-unit-list{display:grid;gap:4px}
      .dashboard-unit-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dashboard-unit-rank{width:18px;height:18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#fff;background:#64748b;flex:0 0 auto}
      .dashboard-unit-rank.rank-1{background:#1a4d7c}
      .dashboard-unit-rank.rank-2{background:#e05b4d}
      .dashboard-unit-rank.rank-3{background:#1a7a52}
      .dashboard-unit-name{font-weight:900;color:#0f172a;min-width:86px}
      .dashboard-unit-formula{color:#1e3a8a}
    `;
    document.head.appendChild(style);
  }

  function diffClass(cur, base){
    const d = (Number(cur)||0) - (Number(base)||0);
    if (Math.abs(d) < 1) return 'shipper-flat';
    return d > 0 ? 'shipper-up' : 'shipper-down';
  }

  function renderComparePanel(){
    ensureCompareStyles();
    const ds = typeof selectedDatasetInSelectedFiscalYear === 'function'
      ? selectedDatasetInSelectedFiscalYear()
      : (typeof selectedDashboardDS === 'function' ? selectedDashboardDS() : null);
    const view = document.getElementById('view-shipper');
    if (!view || !ds) return;

    let panel = document.getElementById('shipper-compare-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'shipper-compare-panel';
      const anchor = document.getElementById('shipper-anomaly-panel') || document.getElementById('shipper-group-card') || document.getElementById('shipper-detail-card');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
      else view.appendChild(panel);
    }

    const rows = buildComparisonRows(ds);
    if (!rows.length) {
      panel.innerHTML = `<div class="shipper-compare-card"><div class="shipper-compare-head"><span>前月・前年比較／件数×単価分解</span><span class="shipper-compare-sub">${escCmp(ymLabelCmp(ds.ym))}</span></div><div class="shipper-compare-body">比較対象データがありません。</div></div>`;
      return;
    }

    panel.innerHTML = `
      <div class="shipper-compare-card">
        <div class="shipper-compare-head">
          <span>前月・前年比較／件数×単価分解</span>
          <span class="shipper-compare-sub">${escCmp(ymLabelCmp(ds.ym))} / 売上 = 件数 × 平均単価</span>
        </div>
        <div class="shipper-compare-body">
          <table class="shipper-compare-table">
            <thead>
              <tr>
                <th>荷主</th>
                <th class="r">件数</th>
                <th class="r">平均単価</th>
                <th class="r">売上</th>
                <th class="r">前月売上差</th>
                <th class="r">前年売上差</th>
                <th class="r">件数要因</th>
                <th class="r">単価要因</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r=>{
                const prevIncome = r.prev ? r.prev.income : null;
                const lyIncome = r.lastYear ? r.lastYear.income : null;
                return `<tr>
                  <td><div class="shipper-compare-name">${escCmp(r.name)}</div><div class="shipper-compare-formula">${fmtKCmp(r.income)}千円 = ${fmtCmp(r.count)}件 × ${fmtCmp(r.unit)}円</div></td>
                  <td class="r">${fmtCmp(r.count)}</td>
                  <td class="r">${fmtCmp(r.unit)}円</td>
                  <td class="r"><strong>${fmtKCmp(r.income)}千</strong></td>
                  <td class="r ${prevIncome == null ? 'shipper-flat' : diffClass(r.income, prevIncome)}">${prevIncome == null ? '—' : diffText(r.income, prevIncome, '千円')}</td>
                  <td class="r ${lyIncome == null ? 'shipper-flat' : diffClass(r.income, lyIncome)}">${lyIncome == null ? '—' : diffText(r.income, lyIncome, '千円')}</td>
                  <td class="r ${r.countEffect == null ? 'shipper-flat' : diffClass(r.countEffect, 0)}">${r.countEffect == null ? '—' : `${r.countEffect>=0?'+':''}${fmtKCmp(r.countEffect)}千`}</td>
                  <td class="r ${r.unitEffect == null ? 'shipper-flat' : diffClass(r.unitEffect, 0)}">${r.unitEffect == null ? '—' : `${r.unitEffect>=0?'+':''}${fmtKCmp(r.unitEffect)}千`}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderDashboardCompareMini(){
    ensureCompareStyles();
    const ds = typeof selectedDashboardDS === 'function' ? selectedDashboardDS() : null;
    const shipArea = document.getElementById('shipper-bars-area');
    if (!ds || !shipArea) return;
    const rows = buildComparisonRows(ds).slice(0,3);
    let mini = document.getElementById('dashboard-compare-mini');
    if (!mini) {
      mini = document.createElement('div');
      mini.id = 'dashboard-compare-mini';
      mini.className = 'dashboard-compare-mini';
      if (shipArea.parentNode) shipArea.parentNode.appendChild(mini);
    }
    if (!rows.length) {
      mini.innerHTML = '<div class="dashboard-unit-title">単価×件数</div><div class="dashboard-unit-list">表示対象なし</div>';
      return;
    }
    mini.innerHTML = `
      <div class="dashboard-unit-title">単価×件数</div>
      <div class="dashboard-unit-list">
        ${rows.map((r,i)=>`
          <div class="dashboard-unit-row">
            <span class="dashboard-unit-rank rank-${i+1}">${i+1}</span>
            <span class="dashboard-unit-name">${escCmp(r.name)}</span>
            <span class="dashboard-unit-formula">${fmtKCmp(r.income)}千 = ${fmtCmp(r.count)}件 × ${fmtCmp(r.unit)}円</span>
          </div>
        `).join('')}
      </div>`;
  }

  const prevRenderShipperForCompare = renderShipper;
  renderShipper = function(){
    prevRenderShipperForCompare();
    renderComparePanel();
  };

  const prevRenderDashboardForCompare = renderDashboard;
  renderDashboard = function(){
    prevRenderDashboardForCompare();
    renderDashboardCompareMini();
  };
})();

/* ════════════════════════════════════════════════════════════════
   UI表示ノイズ削除 2026-05-01
   ・各画面右上等に残る「データ取込からCSVを読み込んでください」を非表示
   ・荷主分析上部のK列/N列/X列/Y列などの説明ロジック文を非表示
   ・集計ロジック自体は変更しない
════════════════════════════════════════════════════════════════ */
(function(){
  function cleanTextNodePrompts(root){
    if (!root) return;
    const phrases = [
      'データ取込からCSVを読み込んでください',
      '左メニューの「データ取込」からCSVを読み込んでください'
    ];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = String(node.nodeValue || '');
      if (phrases.some(p => text.includes(p))) targets.push(node);
    }
    targets.forEach(node => {
      const parent = node.parentElement;
      if (parent && parent.textContent && parent.textContent.trim().length <= 80) {
        parent.style.display = 'none';
      } else {
        node.nodeValue = textWithoutPrompt(node.nodeValue);
      }
    });
  }

  function textWithoutPrompt(text){
    return String(text || '')
      .replace(/データ取込からCSVを読み込んでください/g, '')
      .replace(/左メニューの「データ取込」からCSVを読み込んでください/g, '');
  }

  function cleanShipperLogicNotes(){
    const view = document.getElementById('view-shipper');
    if (!view) return;

    ['shipper-rule-notice','shipper-notice'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '';
        el.style.display = 'none';
      }
    });

    view.querySelectorAll('.msg, .msg-info, [id*="notice"]').forEach(el => {
      const text = String(el.textContent || '');
      if (
        text.includes('K列') ||
        text.includes('N列') ||
        text.includes('X列') ||
        text.includes('Y列') ||
        text.includes('AA列') ||
        text.includes('AB列') ||
        text.includes('収支科目名') ||
        text.includes('取得列') ||
        text.includes('対象収入行') ||
        text.includes('荷主売上')
      ) {
        el.innerHTML = '';
        el.style.display = 'none';
      }
    });
  }

  function cleanUiNoise(){
    cleanTextNodePrompts(document.body);
    cleanShipperLogicNotes();
  }

  const prevUpdateTopbarForClean = UI.updateTopbar.bind(UI);
  UI.updateTopbar = function(view){
    prevUpdateTopbarForClean(view);
    cleanUiNoise();
    setTimeout(cleanUiNoise, 0);
  };

  const prevRenderShipperForClean = renderShipper;
  renderShipper = function(){
    prevRenderShipperForClean();
    cleanUiNoise();
  };

  const prevRenderDashboardForClean = renderDashboard;
  renderDashboard = function(){
    prevRenderDashboardForClean();
    cleanUiNoise();
  };

  document.addEventListener('DOMContentLoaded', () => {
    cleanUiNoise();
    setTimeout(cleanUiNoise, 50);
    setTimeout(cleanUiNoise, 300);
  });
})();


  window.SHIPPER_MODULE = {
    render: function(){ return renderShipper(); }
  };
  window.renderShipper = window.SHIPPER_MODULE.render;
})();
