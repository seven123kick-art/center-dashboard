/* field_content.js : 作業内容分析ビュー（大分類・中分類・小分類 整理版）
   2026-05-02
   ・商品・住所CSVの作業内容・金額をベースに、表記ゆれを整理して分析
   ・初期表示は大分類中心、詳細はトグルで展開
   ・グラフは横棒ベース（見やすさ優先）
   ・既存 field_core.js の renderContent を、画面表示後に上書きする安全追加モジュール
*/
'use strict';
(function(){
  if (window.__FIELD_CONTENT_ANALYSIS_FINAL_20260502__) return;
  window.__FIELD_CONTENT_ANALYSIS_FINAL_20260502__ = true;

  const MONTHS = ['04','05','06','07','08','09','10','11','12','01','02','03'];

  function safeArray(v){ return Array.isArray(v) ? v : []; }
  function num(v){ return Number(v || 0) || 0; }
  function yen(v){
    const s = String(v ?? '').replace(/,/g,'').replace(/[円¥\s　]/g,'').replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function esc(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmt(v){ return Math.round(num(v)).toLocaleString('ja-JP'); }
  function fmtK(v){ return Math.round(num(v) / 1000).toLocaleString('ja-JP'); }
  function fmt1(v){ return (Math.round(num(v) * 10) / 10).toLocaleString('ja-JP', { maximumFractionDigits:1, minimumFractionDigits:1 }); }
  function ymText(ym){ return typeof ymLabel === 'function' ? ymLabel(ym) : `${String(ym).slice(0,4)}年${Number(String(ym).slice(4,6))}月`; }
  function fiscalFromYM(ym){
    if (typeof fiscalYearFromYM === 'function') return fiscalYearFromYM(ym);
    const y = Number(String(ym).slice(0,4));
    const m = Number(String(ym).slice(4,6));
    return String(m <= 3 ? y - 1 : y);
  }

  function selectedYM(){
    const sel = document.getElementById('field-common-month-select');
    if (sel && sel.value) return sel.value;
    return STATE.selYM
      || safeArray(STATE.productAddressData).at(-1)?.ym
      || safeArray(STATE.workerCsvData).at(-1)?.ym
      || (typeof latestDS === 'function' ? latestDS()?.ym : '')
      || '';
  }
  function productRecord(ym){ return safeArray(STATE.productAddressData).find(d => d && d.ym === ym) || null; }
  function workerRecord(ym){ return safeArray(STATE.workerCsvData).find(d => d && d.ym === ym) || null; }

  function cleanWorkLabel(v){
    return String(v ?? '')
      .replace(/[\u0000-\u001f]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }
  function compact(v){ return String(v ?? '').replace(/[\s　]/g,''); }

  function sizeName(text){
    const s = compact(text);
    const m = s.match(/サイズ([①②③④⑤⑥⑦1-7])/);
    if (!m) return '';
    const map = { '①':'①','②':'②','③':'③','④':'④','⑤':'⑤','⑥':'⑥','⑦':'⑦','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦' };
    return `サイズ${map[m[1]] || m[1]}`;
  }

  function classifyWork(raw){
    const label = cleanWorkLabel(raw) || '未設定';
    const s = compact(label);
    const sz = sizeName(label);
    if (sz) return { major:'配送', middle:sz, minor:label, order:10 + ['サイズ①','サイズ②','サイズ③','サイズ④','サイズ⑤','サイズ⑥','サイズ⑦'].indexOf(sz) };
    if (/即日配送/.test(s)) return { major:'配送', middle:'即日配送', minor:label, order:18 };
    if (/幹線|中継/.test(s)) return { major:'配送', middle:'幹線料', minor:label, order:19 };

    if (/リサイクル/.test(s)) {
      if (/洗濯/.test(s)) return { major:'リサイクル', middle:'洗濯機リサイクル', minor:label, order:30 };
      if (/冷蔵/.test(s)) return { major:'リサイクル', middle:'冷蔵庫リサイクル', minor:label, order:31 };
      if (/テレビ|TV|ＴＶ/.test(s)) return { major:'リサイクル', middle:'テレビリサイクル', minor:label, order:32 };
      return { major:'リサイクル', middle:'その他リサイクル', minor:label, order:33 };
    }

    if (/廃材|廃材処理|廃材引取/.test(s)) return { major:'廃材', middle:'廃材', minor:label, order:40 };

    if (/クレーン/.test(s)) {
      if (/見積/.test(s)) return { major:'クレーン', middle:'クレーン見積', minor:label, order:50 };
      if (/搬入|入替|入れ|入レ/.test(s)) return { major:'クレーン', middle:'クレーン搬入・入替', minor:label, order:51 };
      return { major:'クレーン', middle:'クレーン作業', minor:label, order:52 };
    }

    if (/ニップル|ジョイント|マット|設置|取付|取付け|取り付け|部材|防振|ユニック/.test(s)) {
      if (/ニップル|ジョイント/.test(s)) return { major:'付帯作業', middle:'部材・ニップル', minor:label, order:60 };
      if (/マット|防振/.test(s)) return { major:'付帯作業', middle:'マット・防振', minor:label, order:61 };
      if (/設置|取付|取付け|取り付け/.test(s)) return { major:'付帯作業', middle:'取付・設置', minor:label, order:62 };
      return { major:'付帯作業', middle:'その他付帯', minor:label, order:63 };
    }

    if (/冷蔵庫|大型冷蔵庫|冷蔵/.test(s)) return { major:'家電作業', middle:'冷蔵庫', minor:label, order:70 };
    if (/洗濯|ドラム|全自動/.test(s)) return { major:'家電作業', middle:'洗濯機', minor:label, order:71 };
    if (/テレビ|TV|ＴＶ/.test(s)) return { major:'家電作業', middle:'テレビ', minor:label, order:72 };
    if (/レンジ|オーブン/.test(s)) return { major:'家電作業', middle:'レンジ', minor:label, order:73 };
    if (/照明|シーリング/.test(s)) return { major:'家電作業', middle:'照明', minor:label, order:74 };
    if (/食洗|食器洗/.test(s)) return { major:'家電作業', middle:'食洗機', minor:label, order:75 };
    if (/便座|洗浄便座/.test(s)) return { major:'家電作業', middle:'洗浄便座', minor:label, order:76 };

    if (/重量|特殊|大型/.test(s)) return { major:'特殊作業', middle:'特殊・重量物', minor:label, order:80 };
    return { major:'その他', middle:'その他', minor:label, order:999 };
  }

  function newBucket(label, order=999){
    return { label, count:0, amount:0, salesAmount:0, directAmount:0, children:new Map(), minors:new Map(), order };
  }
  function addToBucket(map, key, amount, count, order){
    if (!map.has(key)) map.set(key, newBucket(key, order));
    const b = map.get(key);
    b.count += count;
    b.amount += amount;
    if (order < b.order) b.order = order;
    return b;
  }

  function buildRowsFromProduct(rec){
    const major = new Map();
    const raw = [];
    safeArray(rec?.tickets).forEach(t => {
      const details = safeArray(t.workDetails).length
        ? safeArray(t.workDetails)
        : Object.entries(t.works || {}).map(([work, amount]) => ({ work, amount }));
      details.forEach(d => {
        const work = cleanWorkLabel(d.work || d.label || d[0]);
        const amount = yen(d.amount ?? d.value ?? d[1]);
        const meta = classifyWork(work);
        const majorB = addToBucket(major, meta.major, amount, 1, meta.order);
        const middleB = addToBucket(majorB.children, meta.middle, amount, 1, meta.order);
        addToBucket(middleB.children, meta.minor, amount, 1, meta.order);
        raw.push({ label:work, amount, count:1, major:meta.major, middle:meta.middle, minor:meta.minor, order:meta.order });
      });
    });
    return { major:[...major.values()].sort(sortRows), raw };
  }

  function buildDirectSummaryFromWorker(wrec){
    const sales = Number(wrec?.salesAmount || 0);
    const direct = Number(wrec?.directAmount || 0);
    const total = Number(wrec?.includedAmount || wrec?.amount || sales + direct || 0);
    return { sales, direct, total };
  }

  function sortRows(a,b){ return b.amount - a.amount || b.count - a.count || a.order - b.order || String(a.label).localeCompare(String(b.label),'ja'); }

  function percent(part,total){ return total > 0 ? part / total * 100 : 0; }

  function renderBarRows(rows, totalAmount, opts={}){
    const max = Math.max(...rows.map(r => num(r.amount)), 1);
    const limit = opts.limit || rows.length;
    return rows.slice(0, limit).map((r,idx)=>{
      const w = Math.max(2, num(r.amount) / max * 100);
      return `<div class="content-bar-row">
        <div class="content-bar-rank">${idx+1}</div>
        <div class="content-bar-name" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="content-bar-track"><div class="content-bar-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="content-bar-val"><strong>${fmtK(r.amount)}千</strong><span>${fmt(r.count)}件 / ${fmt1(percent(r.amount,totalAmount))}%</span></div>
      </div>`;
    }).join('');
  }

  function ensureStyles(){
    if (document.getElementById('field-content-analysis-style-20260502')) return;
    const style = document.createElement('style');
    style.id = 'field-content-analysis-style-20260502';
    style.textContent = `
      .content-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
      .content-kpi{border:1px solid var(--border);background:#fff;border-radius:16px;box-shadow:var(--shadow);padding:16px 18px;border-top:5px solid #1a4d7c;min-height:112px}
      .content-kpi.green{border-top-color:#059669}.content-kpi.amber{border-top-color:#f97316}.content-kpi.red{border-top-color:#dc2626}
      .content-kpi-label{font-size:12px;font-weight:900;color:#334155;margin-bottom:8px}.content-kpi-value{font-size:28px;font-weight:900;color:#0f172a;line-height:1.1;white-space:nowrap}.content-kpi-sub{font-size:12px;color:#8291a7;font-weight:800;margin-top:8px;line-height:1.5}
      .content-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.content-card{border:1px solid var(--border);background:#fff;border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.content-card-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}.content-title{font-size:15px;font-weight:900;color:#18324f}.content-sub{font-size:12px;color:#8291a7;font-weight:800}.content-card-body{padding:14px 16px}
      .content-bar-row{display:grid;grid-template-columns:28px minmax(110px,180px) minmax(160px,1fr) minmax(120px,150px);gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #edf2f7}.content-bar-rank{width:24px;height:24px;border-radius:999px;background:#e8f1fb;color:#1a4d7c;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px}.content-bar-name{font-size:13px;font-weight:900;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.content-bar-track{height:13px;border-radius:999px;background:#e5e7eb;overflow:hidden}.content-bar-fill{height:100%;background:#1a4d7c;border-radius:999px}.content-bar-val{text-align:right;font-size:12px;color:#0f172a;white-space:nowrap}.content-bar-val span{display:block;color:#8291a7;font-size:11px;font-weight:800;margin-top:2px}
      .content-detail details{border:1px solid var(--border);border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}.content-detail summary{cursor:pointer;list-style:none;padding:13px 16px;background:#f8fafc;display:flex;justify-content:space-between;gap:12px;align-items:center;font-weight:900;color:#0f172a}.content-detail summary::-webkit-details-marker{display:none}.content-detail-summary-left{display:flex;gap:10px;align-items:center}.content-pill{display:inline-flex;align-items:center;border:1px solid #dbe3ee;background:#fff;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;color:#334155}.content-detail-body{padding:12px 16px}.content-minor-table{width:100%;border-collapse:collapse}.content-minor-table th,.content-minor-table td{border-bottom:1px solid #edf2f7;padding:8px 8px;font-size:13px}.content-minor-table th{background:#f3f6fb;color:#334155;text-align:left;font-weight:900}.content-minor-table .r{text-align:right}.content-note{font-size:12px;color:#64748b;line-height:1.7;margin:0 0 12px 2px}
      @media(max-width:1200px){.content-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.content-grid{grid-template-columns:1fr}.content-bar-row{grid-template-columns:28px minmax(100px,160px) minmax(120px,1fr) minmax(90px,120px)}}
    `;
    document.head.appendChild(style);
  }

  function render(){
    ensureStyles();
    const pane = document.getElementById('fpane-content');
    if (!pane) return;
    const ym = selectedYM();
    const prec = productRecord(ym);
    const wrec = workerRecord(ym);

    if (!prec || !safeArray(prec.tickets).length) {
      pane.innerHTML = `<div class="content-note">商品・住所CSVを読み込むと、作業内容分析を表示します。</div><div class="content-card"><div class="content-card-body" style="padding:40px;text-align:center;color:var(--text3);font-weight:800">選択月の作業内容データがありません。</div></div>`;
      return;
    }

    const built = buildRowsFromProduct(prec);
    const majors = built.major;
    const totalAmount = majors.reduce((s,r)=>s+r.amount,0);
    const totalCount = majors.reduce((s,r)=>s+r.count,0);
    const direct = buildDirectSummaryFromWorker(wrec);
    const top = majors[0] || { label:'-', amount:0, count:0 };
    const avgUnit = totalCount > 0 ? totalAmount / totalCount : 0;
    const directRate = direct.total > 0 ? direct.direct / direct.total * 100 : 0;

    const topMiddle = majors.flatMap(m => [...m.children.values()].map(c => ({...c, label:`${c.label}`, major:m.label}))).sort(sortRows);

    pane.innerHTML = `
      <div class="content-note">作業内容は表記ゆれを整理し、大分類 → 中分類 → 小分類の順に集約しています。初期表示は大分類中心、詳細は下のトグルで確認します。</div>
      <div class="content-kpi-grid">
        <div class="content-kpi"><div class="content-kpi-label">対象月</div><div class="content-kpi-value">${esc(ymText(ym))}</div><div class="content-kpi-sub">作業内容分析</div></div>
        <div class="content-kpi green"><div class="content-kpi-label">作業内容売上</div><div class="content-kpi-value">${fmtK(totalAmount)}千円</div><div class="content-kpi-sub">商品・住所CSV 作業明細ベース</div></div>
        <div class="content-kpi"><div class="content-kpi-label">作業明細</div><div class="content-kpi-value">${fmt(totalCount)}</div><div class="content-kpi-sub">作業内容行数</div></div>
        <div class="content-kpi amber"><div class="content-kpi-label">平均単価</div><div class="content-kpi-value">${fmt(avgUnit)}円</div><div class="content-kpi-sub">作業内容売上 ÷ 作業明細</div></div>
        <div class="content-kpi ${direct.direct ? 'green' : ''}"><div class="content-kpi-label">直収比率</div><div class="content-kpi-value">${fmt1(directRate)}%</div><div class="content-kpi-sub">直収 ${fmtK(direct.direct)}千 / 合計 ${fmtK(direct.total)}千</div></div>
      </div>
      <div class="content-grid">
        <div class="content-card">
          <div class="content-card-head"><div><div class="content-title">大分類別 売上構成</div><div class="content-sub">まずここで全体構造を見る</div></div></div>
          <div class="content-card-body">${renderBarRows(majors, totalAmount)}</div>
        </div>
        <div class="content-card">
          <div class="content-card-head"><div><div class="content-title">中分類 上位</div><div class="content-sub">どの作業が金額を作っているか</div></div></div>
          <div class="content-card-body">${renderBarRows(topMiddle, totalAmount, {limit:12})}</div>
        </div>
      </div>
      <div class="content-card content-detail">
        <div class="content-card-head"><div><div class="content-title">大分類別 詳細</div><div class="content-sub">クリックして中分類・小分類を確認</div></div><span class="content-pill">上位カテゴリ：${esc(top.label)} ${fmtK(top.amount)}千円</span></div>
        <div class="content-card-body">
          ${majors.map((m,idx)=>{
            const mids = [...m.children.values()].sort(sortRows);
            return `<details ${idx < 3 ? 'open' : ''}>
              <summary><span class="content-detail-summary-left"><span>＋ ${esc(m.label)}</span><span class="content-pill">${fmtK(m.amount)}千円</span><span class="content-pill">${fmt(m.count)}件</span></span><span>${fmt1(percent(m.amount,totalAmount))}%</span></summary>
              <div class="content-detail-body">
                ${mids.map(mid=>{
                  const minors = [...mid.children.values()].sort(sortRows).slice(0,12);
                  return `<details style="margin-bottom:8px" ${mids.length <= 4 ? 'open' : ''}>
                    <summary><span class="content-detail-summary-left"><span>${esc(mid.label)}</span><span class="content-pill">${fmtK(mid.amount)}千円</span><span class="content-pill">${fmt(mid.count)}件</span></span><span>${fmt1(percent(mid.amount,totalAmount))}%</span></summary>
                    <div class="content-detail-body">
                      <table class="content-minor-table"><thead><tr><th>小分類・元表記</th><th class="r">件数</th><th class="r">売上</th><th class="r">構成比</th></tr></thead><tbody>
                      ${minors.map(mi=>`<tr><td>${esc(mi.label)}</td><td class="r">${fmt(mi.count)}</td><td class="r">${fmtK(mi.amount)}千円</td><td class="r">${fmt1(percent(mi.amount,totalAmount))}%</td></tr>`).join('')}
                      </tbody></table>
                    </div>
                  </details>`;
                }).join('')}
              </div>
            </details>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderSoon(){ clearTimeout(window.__fieldContentRenderTimer); window.__fieldContentRenderTimer = setTimeout(()=>{ try { render(); } catch(e){ console.error(e); } }, 60); }

  window.FIELD_CONTENT_UI = { render };

  // field_core側の既存描画後に、作業内容分析だけ新UIで上書きする
  if (window.FIELD_UI && typeof FIELD_UI.switchTab === 'function' && !FIELD_UI.__contentSwitchWrapped20260502) {
    const oldSwitch = FIELD_UI.switchTab.bind(FIELD_UI);
    FIELD_UI.switchTab = function(el){
      oldSwitch(el);
      if (el && el.dataset && el.dataset.ftab === 'content') renderSoon();
    };
    FIELD_UI.__contentSwitchWrapped20260502 = true;
  }

  if (window.FIELD_CSV_REBUILD && typeof FIELD_CSV_REBUILD.refresh === 'function' && !FIELD_CSV_REBUILD.__contentRefreshWrapped20260502) {
    const oldRefresh = FIELD_CSV_REBUILD.refresh.bind(FIELD_CSV_REBUILD);
    FIELD_CSV_REBUILD.refresh = function(...args){
      const res = oldRefresh(...args);
      renderSoon();
      return res;
    };
    FIELD_CSV_REBUILD.renderContent = render;
    FIELD_CSV_REBUILD.__contentRefreshWrapped20260502 = true;
  }

  document.addEventListener('change', (e)=>{
    const id = e.target && e.target.id;
    if (id === 'field-common-month-select' || id === 'field-common-fy-select') renderSoon();
  }, true);

  document.addEventListener('DOMContentLoaded', ()=>renderSoon());
  setTimeout(renderSoon, 300);
})();
