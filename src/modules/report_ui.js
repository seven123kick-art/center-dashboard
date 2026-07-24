/* =====================================================================
   経営管理システム report_ui.js
   2026-07-24
   ・レポート出力（§23 REPORT_UI、Word資料自動生成）をapp.jsから分離
   ・STATE / STORE / CLOUD / UI / 共通フォーマット関数はapp.js側を使用
   ・Word生成部分は assets/libs/docx.iife.js (Document/Packer) に依存
===================================================================== */
'use strict';

(function(){
  if (window.__REPORT_UI_MODULE_LOADED_20260724__) return;
  window.__REPORT_UI_MODULE_LOADED_20260724__ = true;

window.REPORT_UI = {
  _OAI_KEY: 'report_oai_key_v1',

  getKey() { try { return localStorage.getItem(this._OAI_KEY)||''; } catch(e){ return ''; } },
  setKey(k) { try { localStorage.setItem(this._OAI_KEY, k); } catch(e){}},
  getFY()   { return document.getElementById('report-fy')?.value  || dashboardSelectedFiscalYear() || getDefaultFiscalYear(); },
  getYM()   { return document.getElementById('report-ym')?.value  || dashboardSelectedYM() || latestDS()?.ym || ''; },

  populateSelectors() {
    const fySel = document.getElementById('report-fy');
    const ymSel = document.getElementById('report-ym');
    if (!fySel) return;
    const years = [...new Set([...dashboardAvailableFiscalYears(), getDefaultFiscalYear()])]
      .filter(Boolean).sort((a,b)=>Number(b)-Number(a));
    const oldFY = fySel.value || getDefaultFiscalYear();
    fySel.innerHTML = years.map(y=>`<option value="${esc(y)}" ${String(y)===String(oldFY)?'selected':''}>${esc(y)}年度</option>`).join('');
    if (!fySel.value && years.length) fySel.value = years[0];
    const fym = monthsOfFiscalYear(fySel.value);
    const validYms = fym.filter(ym => activeDatasetByYM(ym));
    const currentYM = ymSel?.value || dashboardSelectedYM() || validYms.at(-1) || fym[0] || '';
    if (ymSel) {
      ymSel.innerHTML = fym.map(ym=>{
        const has = validYms.includes(ym);
        return `<option value="${esc(ym)}" ${ym===currentYM?'selected':''}>${esc(ymLabel(ym))}${has?'':'（データなし）'}</option>`;
      }).join('');
      if (currentYM) ymSel.value = currentYM;
    }
  },

  refresh() {
    this.populateSelectors();
    // APIキー表示
    const keyEl = document.getElementById('report-oai-key');
    const msg   = document.getElementById('report-key-msg');
    const k = this.getKey();
    if (keyEl && !keyEl.value) keyEl.value = k ? '●'.repeat(20) : '';
    if (msg) msg.textContent = k ? '✅ APIキー設定済み' : '⚠️ APIキーを入力してください';
    // ボタンにリスナーを接続
    const saveBtn = document.getElementById('report-save-key-btn');
    if (saveBtn && !saveBtn._bound) {
      saveBtn._bound = true;
      saveBtn.addEventListener('click', () => {
        const v = document.getElementById('report-oai-key')?.value?.trim();
        if (v && !v.startsWith('●')) this.setKey(v);
        const m = document.getElementById('report-key-msg');
        if (m) m.textContent = this.getKey() ? '✅ 保存しました' : '⚠️ 空です';
      });
    }
    const genBtn = document.getElementById('report-gen-btn');
    if (genBtn && !genBtn._bound) {
      genBtn._bound = true;
      genBtn.addEventListener('click', () => REPORT_UI.generate());
    }
  },

  prog(id, state, text) {
    const el = document.getElementById(id); if (!el) return;
    el.style.color = state==='done'?'#16a34a':state==='active'?'#1a6fc4':state==='error'?'#dc2626':'var(--text3)';
    el.textContent = (state==='done'?'✅':state==='active'?'🔄':state==='error'?'❌':'⬜') + ' ' + text;
  },

  buildDataSummary(ym) {
    const ds = ym ? activeDatasetByYM(ym) : latestDS();
    const prev = ds ? prevDS(ds.ym) : null;
    const lines = [];
    if (ds) {
      lines.push(`営業収益: ${fmtK(ds.totalIncome)}千円`);
      lines.push(`費用合計: ${fmtK(ds.totalExpense)}千円`);
      lines.push(`センター利益: ${fmtK(ds.profit)}千円`);
      lines.push(`利益率: ${pct(ds.profitRate)}`);
      lines.push(`みなし人件費率: ${pct(ds.pseudoLaborRate)}`);
      if (prev) lines.push(`前月比 営業収益: ${ratio(ds.totalIncome, prev.totalIncome)}`);
    } else {
      lines.push('月次収支データなし');
    }
    return lines.join('\n');
  },

  buildPrompt(type, fy, ym, extra) {
    const typeLabel = {monthly:'月次会議報告書', halfReview:'半期振り返り', policy:'半期方針'}[type]||type;
    const period    = reportHalfFromYM(ym);
    const prevPeri  = period==='上期'?'下半期':'上半期';
    const libs = (STATE.library||[]).slice(0,3)
      .map((item,i)=>`【資料${i+1}】${item.title||item.fileName||''}${item.memo?'\n'+item.memo:''}`).join('\n\n');

    return `${CENTER.name}の${typeLabel}を作成してください。

【絶対ルール】
・箇条書き（・や―）は一切使わない
・全て段落（流れる文章）で書く
・数字は必ず文中に具体的に入れる（百万円・千円単位）
・「一方で」「その中で」「これにより」「また」等の接続詞で段落をつなぐ
・「〜となりました」「〜しています」「〜で進めていく」等の語尾を使う
・JSONのみ返す（他のテキスト不要）

【文体サンプル（この書き方に寄せること）】
振り返り例:「下半期は、不採算業務の整理と新規売上の取り込みにより、利益が出る構造へ転換した期間となりました。営業収益は計画170.7百万円に対し実績180.3百万円（+9.6百万円）、粗利益は計画1.0百万円に対し実績12.1百万円（+11.1百万円）と、売上・利益ともに計画を達成しております。一方で、その達成過程については課題も明確です。」

方針例:「■クレーンの進め方\nクレーンは最も利益インパクトが大きく、1件約40,000円に対し傭車では約60％が支払となるため、1件あたり約16,000円の差が出る。月40件の実施で売上は960千円を見込んでいる。まずは240千円程度を確実に取りにいく形で進めていく。」

【出力JSON形式】
\`\`\`json
{
  "review": {
    "p1": "${prevPeri}全体の概況と実績数値の段落（3〜5文）",
    "p2": "課題・背景・対応経緯の段落（3〜5文）",
    "p3": "取り組みの成果と構造変化の段落（3〜5文）",
    "p4": "評価と${period}への接続（2〜3文）"
  },
  "policy": {
    "intro": "${period}方針宣言の段落（2〜3文）",
    "items": [
      {"title":"■ 施策タイトル1","p1":"内容・数値根拠（3〜5文）","p2":"実施方法・見通し（2〜4文）"},
      {"title":"■ 施策タイトル2","p1":"説明段落","p2":"説明段落"},
      {"title":"■ まとめ","p1":"全体まとめ（2〜3文）","p2":""}
    ]
  }
}
\`\`\`

【実績データ: ${ymLabel(ym)}】
${this.buildDataSummary(ym)}
${libs?'\n【過去資料参考情報】\n'+libs:''}
${extra?'\n【担当者からの追加情報】\n'+extra:''}`;
  },

  async generate() {
    const key = this.getKey();
    if (!key) { alert('ChatGPT APIキーを入力・保存してください。\nhttps://platform.openai.com/api-keys で取得できます。'); return; }
    const btn  = document.getElementById('report-gen-btn');
    const prog = document.getElementById('report-progress');
    if (btn)  { btn.disabled=true; btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></span>　生成中...'; }
    if (prog) prog.style.display='';

    try {
      // ① データ収集
      this.prog('rpg-1','active','データを収集中...');
      const ym    = this.getYM();
      const fy    = this.getFY();
      const type  = document.getElementById('report-type')?.value||'monthly';
      const extra = document.getElementById('report-extra')?.value?.trim()||'';
      const prompt = this.buildPrompt(type, fy, ym, extra);
      this.prog('rpg-1','done','データ収集完了');

      // ② ChatGPT API
      this.prog('rpg-2','active','ChatGPTが文章を生成中（20〜40秒）...');
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({
          model:'gpt-4o',
          max_tokens:3000,
          messages:[
            {role:'system', content:'あなたは物流センターの経営管理報告書ライターです。指示通りJSONのみ返してください。'},
            {role:'user', content:prompt}
          ]
        })
      });
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        throw new Error(e?.error?.message || 'OpenAI APIエラー HTTP ' + res.status);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const m = text.match(/```json\n?([\s\S]+?)```/) || text.match(/(\{[\s\S]+\})/);
      if (!m) throw new Error('ChatGPTの返答がJSON形式ではありませんでした:\n'+text.slice(0,200));
      const rpt = JSON.parse((m[1]||m[0]).trim());
      this.prog('rpg-2','done','文章生成完了');

      // ③ docx.iife.js を動的読み込み
      this.prog('rpg-3','active','Wordライブラリを読み込み中...');
      if (!window.docx) {
        await new Promise((resolve, reject) => {
          if (document.getElementById('docx-iife-script')) { resolve(); return; }
          const s = document.createElement('script');
          s.id = 'docx-iife-script'; s.src = 'assets/libs/docx.iife.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('assets/libs/docx.iife.js の読み込みに失敗。ファイルがサーバーに存在するか確認してください。'));
          document.head.appendChild(s);
        });
      }
      this.prog('rpg-3','done','Wordライブラリ読み込み完了');

      // ④ Word生成
      this.prog('rpg-4','active','Wordファイルを作成中...');
      const blob = await this._buildDocx(type, fy, ym, rpt);
      this.prog('rpg-4','done','Wordファイル作成完了');

      // ⑤ ダウンロード
      this.prog('rpg-5','active','ダウンロード中...');
      const tag = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const url2 = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url2; a.download=CENTER.name+'_報告書_'+tag+'.docx'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url2), 3000);
      this.prog('rpg-5','done','ダウンロード完了 ✨');

    } catch(e) {
      ['rpg-1','rpg-2','rpg-3','rpg-4','rpg-5'].forEach(id=>{
        const el=document.getElementById(id);
        if (el && el.textContent.includes('🔄')) this.prog(id,'error','エラー: '+e.message);
      });
      alert('エラーが発生しました:\n\n'+e.message);
      console.error('[REPORT_WORD]', e);
    } finally {
      if (btn) { btn.disabled=false; btn.innerHTML='📄　Word報告書を自動生成（ChatGPT + Word）'; }
    }
  },

  async _buildDocx(type, fy, ym, rpt) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, LevelFormat } = window.docx;
    const center   = CENTER.name;
    const dateStr  = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'});
    const period   = reportHalfFromYM(ym) || '上期';
    const prevPeri = period==='上期'?'下半期':'上半期';
    const NAVY='1A3E6F', GRAY='333333', BLUE='1A6FC4', LGRAY='666666';

    const sp  = (n=1) => Array.from({length:n},()=>new Paragraph({spacing:{before:0,after:0},children:[new TextRun({text:'',size:10})]}));
    const hr  = ()    => new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:1}},spacing:{before:80,after:100},children:[new TextRun({text:'',size:4})]});
    const h1  = t     => new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:440,after:100},children:[new TextRun({text:t,bold:true,size:30,color:NAVY,font:'游明朝'})]});
    const h2  = t     => new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:260,after:80},children:[new TextRun({text:t,bold:true,size:24,color:NAVY,font:'游明朝'})]});
    const para = t    => t&&t.trim() ? new Paragraph({spacing:{before:100,after:100},indent:{firstLine:440},children:[new TextRun({text:t,size:22,color:GRAY,font:'游明朝'})]}) : null;
    const kv   = (l,v)=> new Paragraph({spacing:{before:50,after:50},children:[new TextRun({text:l+'　',bold:true,size:21,color:NAVY,font:'游明朝'}),new TextRun({text:v,size:21,color:GRAY,font:'游明朝'})]});

    const ch = [
      new Paragraph({alignment:AlignmentType.RIGHT,spacing:{after:80},children:[new TextRun({text:dateStr,size:20,color:LGRAY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[new TextRun({text:center,bold:true,size:28,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[new TextRun({text:'家電物流事業部 管理者会議',bold:true,size:34,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:160},children:[new TextRun({text:prevPeri+'振り返り／'+period+'運営方針',size:22,color:LGRAY,font:'游明朝'})]}),
      hr(), ...sp(1),
    ];

    // 振り返り
    const rv = rpt.review||{};
    ch.push(h1('【'+prevPeri+' 振り返り】'), hr());
    const ds = activeDatasetByYM(ym);
    if (ds) {
      ch.push(h2('■ 実績サマリー'));
      ch.push(kv('収入合計', fmtK(ds.totalIncome)+'千円'));
      ch.push(kv('費用合計', fmtK(ds.totalExpense)+'千円'));
      ch.push(kv('営業利益', (ds.profit>=0?'+':'-')+fmtK(Math.abs(ds.profit))+'千円'));
      ch.push(...sp(1));
    }
    ['p1','p2','p3','p4'].forEach(k=>{ const p=para(rv[k]); if(p){ch.push(p);ch.push(...sp(1));} });

    // 方針
    const pl = rpt.policy||{};
    ch.push(...sp(1), h1('【'+period+' 運営方針】'), hr());
    const pi=para(pl.intro); if(pi){ch.push(pi);ch.push(...sp(1));}
    (pl.items||[]).forEach(item=>{
      if(item.title) ch.push(h2(item.title));
      ['p1','p2'].forEach(k=>{ const p=para(item[k]); if(p){ch.push(p);ch.push(...sp(1));} });
    });

    const doc = new Document({
      styles:{
        default:{document:{run:{font:'游明朝',size:22,color:GRAY}}},
        paragraphStyles:[
          {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:30,bold:true,font:'游明朝',color:NAVY},paragraph:{spacing:{before:440,after:100},outlineLevel:0}},
          {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:24,bold:true,font:'游明朝',color:NAVY},paragraph:{spacing:{before:260,after:80},outlineLevel:1}},
        ],
      },
      sections:[{
        properties:{page:{size:{width:11906,height:16838},margin:{top:1440,right:1440,bottom:1440,left:1440}}},
        children:ch,
      }],
    });
    return Packer.toBlob(doc);
  },
};

})();
