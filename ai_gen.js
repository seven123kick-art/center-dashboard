'use strict';
/* ════ AI報告書生成（ai_gen.js v5）════════════════════════════════ */
const AI_GEN_UI = (() => {
  const LS_KEY = 'ai_gen_apikey_v4';
  const MODEL  = 'claude-sonnet-4-20250514';
  const TMPL   = { meeting: '家電物流事業部 管理者会議' };

  const INCOME_KEYS  = ['家電収入','委託収入','特積収入','一般収入','その他収入','保管料収入','加工収入','コンピュータ収入'];
  const EXPENSE_KEYS = ['給与手当','人材派遣料','その他人件費','委託費','集配傭車','路線傭車','社内外注費',
                        '軽油費','ガソリン費','車両修繕費','車両償却費','自賠責保険料','任意保険料',
                        '借地借家料','その他施設費','水道光熱費','備消品費','通信運搬費','旅費','雑費'];

  const n      = v => Number(v) || 0;
  const fmtM   = v => (Math.round(Math.abs(n(v))/100)/10).toFixed(1)+'百万円';
  const fmtK   = v => Math.round(Math.abs(n(v))).toLocaleString()+'千円';
  const ymLbl  = ym => ym ? ym.slice(0,4)+'年'+ym.slice(4)+'月' : '';
  const getKey = () => { try { return localStorage.getItem(LS_KEY)||''; } catch(e){ return ''; } };
  const setKey = k  => { try { localStorage.setItem(LS_KEY, k); } catch(e){}};
  const esc    = s  => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function gatherData() {
    const months = [...new Set((STATE.datasets||[]).map(d=>d.ym))].sort().reverse();
    function rows(ym) {
      const m={};
      (STATE.datasets||[]).filter(d=>d.ym===ym).forEach(ds=>{
        Object.entries(ds.rows||{}).forEach(([k,v])=>{ m[k]=(m[k]||0)+n(v); });
      });
      return m;
    }
    function summ(ym) {
      const r=rows(ym);
      const inc=INCOME_KEYS.reduce((s,k)=>s+n(r[k]),0);
      const exp=EXPENSE_KEYS.reduce((s,k)=>s+n(r[k]),0);
      return { ym, inc, exp, prf:inc-exp, rows:r };
    }
    const latest = months[0] ? summ(months[0]) : null;
    const prev   = months[1] ? summ(months[1]) : null;
    const memos  = Object.entries(STATE.memos||{})
      .sort(([a],[b])=>b.localeCompare(a)).slice(0,3)
      .map(([ym,m])=>'['+ymLbl(ym)+'] '+((m&&m.text)||m||'').slice(0,300));
    return { latest, prev, memos, center: CENTER.name };
  }

  function dataText(data) {
    const lines = [];
    if (data.latest) {
      const d = data.latest;
      lines.push('【最新月: '+ymLbl(d.ym)+'】');
      lines.push('収入: '+fmtM(d.inc)+'（'+fmtK(d.inc)+'）');
      lines.push('費用: '+fmtM(d.exp)+'（'+fmtK(d.exp)+'）');
      lines.push('利益: '+(d.prf>=0?'+':'')+fmtM(d.prf)+'（'+fmtK(d.prf)+'）');
      lines.push('利益率: '+(d.inc?((d.prf/d.inc)*100).toFixed(1):'0')+'%');
      const top = [...INCOME_KEYS,...EXPENSE_KEYS]
        .filter(k=>n(d.rows[k])>0).map(k=>({k,v:n(d.rows[k])}))
        .sort((a,b)=>b.v-a.v).slice(0,12);
      top.forEach(x=>lines.push('  '+x.k+': '+fmtK(x.v)));
    }
    if (data.prev) {
      const d=data.prev;
      lines.push('');
      lines.push('【前月: '+ymLbl(d.ym)+'】収入:'+fmtM(d.inc)+' 費用:'+fmtM(d.exp)+' 利益:'+(d.prf>=0?'+':'')+fmtM(d.prf));
    }
    if (data.memos.length) {
      lines.push(''); lines.push('【メモ】');
      data.memos.forEach(m=>lines.push(m));
    }
    if (!lines.length) lines.push('データなし');
    return lines.join('\n');
  }

  async function callClaude(key, prompt) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key':key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body:JSON.stringify({model:MODEL,max_tokens:3500,messages:[{role:'user',content:prompt}]}),
    });
    if (!res.ok) {
      const e=await res.json().catch(()=>({}));
      throw new Error(e?.error?.message||'API エラー HTTP '+res.status);
    }
    const d = await res.json();
    const text = d.content?.find(c=>c.type==='text')?.text||'';
    const m = text.match(/```json\n?([\s\S]+?)```/) || text.match(/(\{[\s\S]+\})/);
    if (!m) throw new Error('AIの返答がJSON形式ではありませんでした:\n'+text.slice(0,200));
    return JSON.parse((m[1]||m[0]).trim());
  }

  function buildPrompt(data, period, userMemo) {
    const prev = period==='上期'?'下半期':'上半期';
    return 'あなたは物流センターの経営管理報告書ライターです。\n'
      +data.center+'の経営会議報告書を以下のサンプルと同じ文体で作成してください。\n\n'
      +'【文体サンプル（この書き方に寄せること）】\n'
      +'振り返り例:\n'
      +'「下半期は、不採算業務の整理と新規売上の取り込みにより、利益が出る構造へ転換した期間となりました。営業収益は計画170.7百万円に対し実績180.3百万円（+9.6百万円）、粗利益は計画1.0百万円に対し実績12.1百万円（+11.1百万円）と、売上・利益ともに計画を達成しております。\n\n'
      +'一方で、その達成過程については課題も明確です。K&Bの時間指定や不採算エリアについては把握していたものの、荷主対応を優先する中で十分な見直しができていませんでした。その中で、10月の不祥事および人員減少を契機に、拘束時間が長く効率の悪い時間指定や秩父・群馬・さいたまCといった不採算エリアの見直しを実施し、キャパシティの圧縮を行っています。\n\n'
      +'これにより、「すべて受ける運営」から「条件を見て受ける運営」へ転換し…」\n\n'
      +'方針例（■見出し配下も箇条書きでなく文章）:\n'
      +'「■クレーンの進め方\nクレーンは最も利益インパクトが大きく、1件約40,000円に対し傭車では約60％が支払となるため、1件あたり約16,000円の差が出る。月40件の実施で売上は960千円を見込んでいる。\n\nまずは240千円程度を確実に取りにいく形で進めていく。今後は受注条件の見直しと配車ルールの整理を進めながら、利益が残る形で回す運用に切り替えていく。」\n\n'
      +'【絶対ルール】\n'
      +'- 箇条書き（・―リスト）は一切使わない\n'
      +'- 全て段落（流れる文章）で書く\n'
      +'- 数字は文中に埋め込む\n'
      +'- 接続詞「一方で」「その中で」「これにより」「また」を使う\n'
      +'- JSONのみ返す（他のテキスト不要）\n\n'
      +'【出力JSON形式】\n'
      +'```json\n'
      +'{\n'
      +'  "review": {\n'
      +'    "p1": "'+prev+'全体の概況と実績数値の段落（3〜5文）",\n'
      +'    "p2": "課題・背景・対応経緯の段落（3〜5文）",\n'
      +'    "p3": "取り組みの成果と構造変化の段落（3〜5文）",\n'
      +'    "p4": "評価と'+period+'への接続（2〜3文）"\n'
      +'  },\n'
      +'  "policy": {\n'
      +'    "intro": "'+period+'方針宣言の段落（2〜3文）",\n'
      +'    "items": [\n'
      +'      {"title":"■ 施策タイトル1","p1":"内容・数値根拠の段落（3〜5文）","p2":"実施方法・見通しの段落（2〜4文）"},\n'
      +'      {"title":"■ 施策タイトル2","p1":"説明段落","p2":"説明段落"},\n'
      +'      {"title":"■ まとめ","p1":"全体まとめ段落（2〜3文）","p2":""}\n'
      +'    ]\n'
      +'  }\n'
      +'}\n```\n\n'
      +'【実績データ】\n'+dataText(data)+'\n'
      +(userMemo?'\n【担当者からの追加情報】\n'+userMemo+'\n':'');
  }

  async function buildDocx(period, data, rpt) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel,
            AlignmentType, BorderStyle } = window.docx;
    const center   = data.center||CENTER.name;
    const dateStr  = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'});
    const prevPeri = period==='上期'?'下半期':'上半期';
    const NAVY='1A3E6F', GRAY='333333', BLUE='1A6FC4', LGRAY='666666';

    const sp  = (cnt) => Array.from({length:cnt||1},function(){
      return new Paragraph({spacing:{before:0,after:0},children:[new TextRun({text:'',size:10})]});
    });
    const hr  = function() { return new Paragraph({
      border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:1}},
      spacing:{before:80,after:100},children:[new TextRun({text:'',size:4})],
    }); };
    const h1  = function(t) { return new Paragraph({
      heading:HeadingLevel.HEADING_1,spacing:{before:440,after:100},
      children:[new TextRun({text:t,bold:true,size:30,color:NAVY,font:'游明朝'})],
    }); };
    const h2  = function(t) { return new Paragraph({
      heading:HeadingLevel.HEADING_2,spacing:{before:260,after:80},
      children:[new TextRun({text:t,bold:true,size:24,color:NAVY,font:'游明朝'})],
    }); };
    const para = function(t) {
      if (!t||!t.trim()) return null;
      return new Paragraph({
        spacing:{before:100,after:100},
        indent:{firstLine:440},
        children:[new TextRun({text:t,size:22,color:GRAY,font:'游明朝'})],
      });
    };

    const children = [
      new Paragraph({alignment:AlignmentType.RIGHT,spacing:{after:80},
        children:[new TextRun({text:dateStr,size:20,color:LGRAY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},
        children:[new TextRun({text:center,bold:true,size:26,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},
        children:[new TextRun({text:TMPL.meeting,bold:true,size:34,color:NAVY,font:'游明朝'})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:160},
        children:[new TextRun({text:prevPeri+'振り返り／'+period+'運営方針',size:22,color:LGRAY,font:'游明朝'})]}),
      hr(),
    ];
    children.push.apply(children, sp(1));

    var rv = rpt.review||{};
    children.push(h1('【'+prevPeri+' 振り返り】'), hr());
    ['p1','p2','p3','p4'].forEach(function(k){
      var p=para(rv[k]); if(p){ children.push(p); children.push.apply(children,sp(1)); }
    });

    var pl = rpt.policy||{};
    children.push.apply(children, sp(1));
    children.push(h1('【'+period+' 運営方針】'), hr());
    if (pl.intro) { var pi=para(pl.intro); if(pi){ children.push(pi); children.push.apply(children,sp(1)); } }
    (pl.items||[]).forEach(function(item){
      if (item.title) children.push(h2(item.title));
      ['p1','p2'].forEach(function(k){
        var p=para(item[k]); if(p){ children.push(p); children.push.apply(children,sp(1)); }
      });
    });

    var doc = new Document({
      styles:{
        default:{document:{run:{font:'游明朝',size:22,color:GRAY}}},
        paragraphStyles:[
          {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:30,bold:true,font:'游明朝',color:NAVY},
           paragraph:{spacing:{before:440,after:100},outlineLevel:0}},
          {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,
           run:{size:24,bold:true,font:'游明朝',color:NAVY},
           paragraph:{spacing:{before:260,after:80},outlineLevel:1}},
        ],
      },
      sections:[{
        properties:{page:{size:{width:11906,height:16838},margin:{top:1440,right:1440,bottom:1440,left:1440}}},
        children:children,
      }],
    });
    return Packer.toBlob(doc);
  }

  function prog(id,state,text){
    var el=document.getElementById(id); if(!el) return;
    el.className='prog-step '+state;
    el.textContent=(state==='done'?'✅':state==='active'?'🔄':state==='error'?'❌':'⬜')+' '+text;
  }

  /* ─ UI描画（addEventListener で確実にボタンを接続） ─ */
  function init() {
    var root=document.getElementById('ai-gen-root'); if(!root) return;
    var key=getKey(), data=gatherData();
    var prev=dataText(data), hasData=!!(data.latest||data.prev);

    root.innerHTML=''
      +'<style>'
      +'#ai-gen-root{padding:20px;padding-bottom:60px}'
      +'#ai-gen-root .step{margin-bottom:18px}'
      +'#ai-gen-root .slbl{font-size:12px;font-weight:700;color:var(--text2,#556);margin-bottom:7px;display:flex;align-items:center;gap:7px}'
      +'#ai-gen-root .snum{width:22px;height:22px;border-radius:50%;background:#1a4d7c;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
      +'#ai-gen-root .card{background:var(--surface,#fff);border:1px solid var(--border,#dde3f0);border-radius:12px;padding:14px}'
      +'#ai-gen-root .dprev{background:var(--surface2,#f5f7fa);border-radius:8px;padding:12px;font-size:11px;color:var(--text3);font-family:monospace;max-height:150px;overflow-y:auto;line-height:1.7;white-space:pre}'
      +'#ai-gen-root .gbtn{width:100%;padding:16px;border:none;border-radius:10px;background:linear-gradient(135deg,#1a4d7c,#1a6fc4);color:#fff;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-top:4px}'
      +'#ai-gen-root .gbtn:disabled{opacity:.5;cursor:not-allowed}'
      +'#ai-gen-root .prog-step{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:12px;color:var(--text3);border-bottom:1px solid var(--border,#eee)}'
      +'#ai-gen-root .prog-step.done{color:#16a34a}'
      +'#ai-gen-root .prog-step.active{color:#1a6fc4;font-weight:600}'
      +'#ai-gen-root .prog-step.error{color:#dc2626}'
      +'#ai-gen-root .sp{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}'
      +'</style>'
      /* STEP 1 */
      +'<div class="step">'
      +'<div class="slbl"><span class="snum">1</span>Claude APIキー</div>'
      +'<div class="card" style="display:flex;gap:8px;align-items:center;padding:10px 14px">'
      +'<input id="ag-key" type="password" value="'+esc(key)+'" placeholder="sk-ant-..." style="flex:1;padding:7px 10px;border-radius:7px;border:1px solid var(--border,#dde3f0);font-size:12px;font-family:monospace;background:var(--surface,#fff);color:var(--text1)">'
      +'<button id="ag-save-key-btn" style="padding:7px 14px;border-radius:7px;border:1px solid var(--border,#dde3f0);background:var(--surface,#fff);font-size:12px;cursor:pointer;white-space:nowrap">保存</button>'
      +'<a href="https://console.anthropic.com/settings/keys" target="_blank" style="font-size:11px;color:#1a6fc4;white-space:nowrap;text-decoration:none">取得↗</a>'
      +'</div>'
      +'<div id="ag-key-msg" style="font-size:11px;margin-top:4px;color:#8899aa;padding:0 2px">'+(key?'✅ APIキー設定済み':'⚠️ APIキーを入力してください')+'</div>'
      +'</div>'
      /* STEP 2 */
      +'<div class="step">'
      +'<div class="slbl"><span class="snum">2</span>レポート設定</div>'
      +'<div class="card" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
      +'<div><div style="font-size:11px;color:var(--text3);margin-bottom:4px">センター</div>'
      +'<div style="font-size:14px;font-weight:700;color:#1a4d7c">'+esc(data.center)+'</div></div>'
      +'<div><div style="font-size:11px;color:var(--text3);margin-bottom:4px">対象期間</div>'
      +'<select id="ag-period" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border,#dde3f0);background:var(--surface,#fff);color:var(--text1);font-size:12px">'
      +'<option value="上期">上期（4〜9月）</option><option value="下期">下期（10〜3月）</option>'
      +'</select></div>'
      +'<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--text3);margin-bottom:4px">追加情報・指示（任意）</div>'
      +'<textarea id="ag-memo" rows="3" placeholder="例: クレーン業務を4月から本格化。K&B時間指定を廃止した。エディオン新潟を継続受注中。" style="width:100%;padding:8px;border-radius:7px;border:1px solid var(--border,#dde3f0);font-size:12px;resize:vertical;box-sizing:border-box;background:var(--surface,#fff);color:var(--text1);font-family:メイリオ,sans-serif"></textarea>'
      +'</div></div></div>'
      /* STEP 3 */
      +'<div class="step">'
      +'<div class="slbl"><span class="snum">3</span>使用するデータ</div>'
      +'<div class="card">'
      +(hasData
        ?'<div class="dprev">'+esc(prev)+'</div><div style="font-size:11px;color:var(--text3);margin-top:6px">↑ このデータをもとに文章を生成します</div>'
        :'<div style="color:#e87830;font-size:13px;padding:8px">⚠️ データがありません。先にCSVを取込んでください。</div>')
      +'</div></div>'
      /* ボタン */
      +'<button id="ag-gen-btn" class="gbtn">🤖　Word報告書を自動生成</button>'
      /* 進捗 */
      +'<div id="ag-progress" style="display:none;margin-top:16px" class="card">'
      +'<div class="prog-step" id="pg-1">⬜ データを収集</div>'
      +'<div class="prog-step" id="pg-2">⬜ Claude AIが文章を生成（20〜40秒）</div>'
      +'<div class="prog-step" id="pg-3">⬜ Wordファイルを作成</div>'
      +'<div class="prog-step" id="pg-4">⬜ ダウンロード</div>'
      +'</div>';

    /* ── addEventListener で確実に接続 ── */
    var saveBtn = document.getElementById('ag-save-key-btn');
    if (saveBtn) saveBtn.addEventListener('click', function() {
      var k=document.getElementById('ag-key')?.value?.trim();
      setKey(k);
      var msg=document.getElementById('ag-key-msg');
      if (msg) msg.innerHTML=k?'<span style="color:#16a34a">✅ 保存しました</span>':'<span style="color:#e87830">⚠️ 空です</span>';
    });

    var genBtn = document.getElementById('ag-gen-btn');
    if (genBtn) genBtn.addEventListener('click', generate);
  }

  /* ─ 生成メイン ─ */
  async function generate() {
    // デバッグ: 関数が呼ばれたことを確認
    console.log('[AI_GEN] generate() 呼び出し');

    var key = getKey() || (document.getElementById('ag-key')?.value?.trim());
    if (!key) {
      alert('Claude APIキーを入力・保存してください。\n\nhttps://console.anthropic.com/settings/keys で取得できます。');
      return;
    }

    var btn  = document.getElementById('ag-gen-btn');
    var pgEl = document.getElementById('ag-progress');
    if (btn)  { btn.disabled=true; btn.innerHTML='<span class="sp"></span>　生成中...'; }
    if (pgEl) pgEl.style.display='';

    try {
      prog('pg-1','active','データを収集中...');
      var data   = gatherData();
      var period = document.getElementById('ag-period')?.value||'上期';
      var memo   = document.getElementById('ag-memo')?.value?.trim()||'';
      console.log('[AI_GEN] データ収集完了, センター:', data.center, 'データ件数:', data.latest?1:0);
      prog('pg-1','done','データ収集完了');

      prog('pg-2','active','Claude AIが文章を生成中（20〜40秒）...');
      var prompt = buildPrompt(data, period, memo);
      console.log('[AI_GEN] Claude APIを呼び出し中...');
      var rpt = await callClaude(key, prompt);
      console.log('[AI_GEN] 文章生成完了:', Object.keys(rpt));
      prog('pg-2','done','文章生成完了');

      prog('pg-3','active','Wordファイルを作成中...');
      if (!window.docx) throw new Error('docx.iife.jsが読み込まれていません。ファイルがプロジェクトにあるか確認してください。');
      var blob = await buildDocx(period, data, rpt);
      console.log('[AI_GEN] Wordファイル作成完了');
      prog('pg-3','done','Wordファイル作成完了');

      prog('pg-4','active','ダウンロード中...');
      var tag = new Date().toISOString().slice(0,10).replace(/-/g,'');
      var url = URL.createObjectURL(blob);
      var a   = document.createElement('a');
      a.href=url; a.download=data.center+'_報告書_'+tag+'.docx'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
      prog('pg-4','done','ダウンロード完了 ✨');

    } catch(e) {
      console.error('[AI_GEN] エラー:', e);
      // エラーを確実に表示
      ['pg-1','pg-2','pg-3','pg-4'].forEach(function(id){
        var el=document.getElementById(id);
        if (el && el.className.includes('active')) prog(id,'error','エラー: '+e.message);
      });
      // アラートでも表示（確実にユーザーに伝える）
      alert('エラーが発生しました:\n\n'+e.message+'\n\nブラウザのコンソール(F12)も確認してください。');
    } finally {
      if (btn) { btn.disabled=false; btn.innerHTML='🤖　Word報告書を自動生成'; }
    }
  }

  function saveApiKey() {
    var k=document.getElementById('ag-key')?.value?.trim();
    setKey(k);
    var msg=document.getElementById('ag-key-msg');
    if (msg) msg.innerHTML=k?'<span style="color:#16a34a">✅ 保存しました</span>':'<span style="color:#e87830">⚠️ 空です</span>';
  }

  return { init, saveApiKey, generate };
})();

window.AI_GEN_UI = AI_GEN_UI;
