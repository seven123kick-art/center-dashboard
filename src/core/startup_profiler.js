/* Version6 temporary startup profiler. Remove after bottleneck analysis. */
(function(){
'use strict';
const P={startAt:0,marks:[],active:new Map(),wrapped:false};
const enabled=()=>{try{return localStorage.getItem('v6_startup_profiler')==='1'||new URLSearchParams(location.search).get('startupProfile')==='1';}catch(_e){return false;}};
const now=()=>performance.now();
const round=n=>Math.round(n*10)/10;
function start(){P.startAt=now();P.marks=[];P.active.clear();}
function mark(name,extra){P.marks.push({name,ms:round(now()-P.startAt),duration:null,extra:extra||null});}
function begin(name){P.active.set(name,now());}
function end(name,extra){const st=P.active.get(name);if(st==null)return;P.active.delete(name);P.marks.push({name,ms:round(st-P.startAt),duration:round(now()-st),extra:extra||null});}
async function measure(name,fn){begin(name);try{return await fn();}finally{end(name);}}
function wrapCloudRepository(){
 if(P.wrapped||!window.CLOUD_REPOSITORY)return; P.wrapped=true;
 const cr=window.CLOUD_REPOSITORY;
 ['fetchManifestWithDbFallback','fetchManifest','fetchFullState','fetchDataset','fetchPlan','fetchCapacity'].forEach(k=>{
   if(typeof cr[k]!=='function'||cr[k].__startupProfileWrapped)return;
   const orig=cr[k].bind(cr);
   const wrapped=async function(...args){const label=`Cloud.${k}${args.length?' '+args.slice(0,2).join('/') : ''}`;begin(label);try{return await orig(...args);}finally{end(label);}};
   wrapped.__startupProfileWrapped=true; cr[k]=wrapped;
 });
}
function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function finish(meta){
 const total=round(now()-P.startAt); mark('READY');
 const durations=P.marks.filter(x=>x.duration!=null).sort((a,b)=>b.duration-a.duration);
 const measured=durations.filter(x=>!x.name.startsWith('Startup同期合計')).reduce((a,x)=>a+x.duration,0);
 const report={totalMs:total, measuredMs:round(measured), otherMs:round(Math.max(0,total-measured)), marks:P.marks, meta:meta||{}};
 window.__STARTUP_PROFILE__=report;
 if(enabled()){ console.group('[STARTUP PROFILE]'); console.table(P.marks); console.log(report); console.groupEnd(); show(report); }
}
function show(r){
 let host=document.getElementById('startup-profile-dialog'); if(host)host.remove();
 host=document.createElement('div'); host.id='startup-profile-dialog';
 host.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(34,38,42,.22);display:grid;place-items:center;padding:24px';
 const rows=r.marks.filter(x=>x.duration!=null).sort((a,b)=>b.duration-a.duration).map(x=>`<tr><td>${esc(x.name)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${x.duration.toLocaleString()} ms</td></tr>`).join('');
 host.innerHTML=`<div style="width:min(680px,94vw);max-height:84vh;overflow:auto;background:#fffdf9;border:1px solid #e7e1d8;border-radius:18px;box-shadow:0 20px 60px rgba(38,44,48,.18);padding:22px;color:#34383b;font-family:inherit"><div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><div><div style="font-size:12px;color:#777">一時診断モード</div><h2 style="margin:3px 0 0;font-size:20px">起動時間の内訳</h2></div><button id="startup-profile-close" style="border:0;background:#f1eee8;border-radius:10px;padding:8px 12px;cursor:pointer">閉じる</button></div><div style="display:flex;gap:12px;margin:18px 0"><div style="flex:1;background:#f5fbf8;border-radius:14px;padding:14px"><small>READYまで</small><strong style="display:block;font-size:26px">${(r.totalMs/1000).toFixed(2)}秒</strong></div><div style="flex:1;background:#faf7ff;border-radius:14px;padding:14px"><small>計測外/待機候補</small><strong style="display:block;font-size:26px">${(r.otherMs/1000).toFixed(2)}秒</strong></div></div><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">処理</th><th style="text-align:right;padding:8px;border-bottom:1px solid #ddd">時間</th></tr></thead><tbody>${rows}</tbody></table><p style="font-size:12px;color:#777;margin:14px 0 0">この画面はボトルネック特定用です。数値をそのまま教えてください。ブラウザの開発者コンソールにも同じ結果を出しています。</p></div>`;
 document.body.appendChild(host); document.getElementById('startup-profile-close').onclick=()=>host.remove();
}
window.STARTUP_PROFILER={start,mark,begin,end,measure,wrapCloudRepository,finish,enabled,setEnabled(v){try{localStorage.setItem('v6_startup_profiler',v?'1':'0');}catch(_e){} return !!v;}};
})();
