/* =====================================================================
   経営管理システム format.js
   2026-07-25（Phase3-3-4：年度計算ロジックをCONFIG_UTILSとして追加）
   ・数値・日付・文字列の表示整形関数をapp.jsから分離
   ・fmt/fmtK/pct/diff/ratio/ymLabel/dt/esc のみ担当（副作用なし）
   ・データセット選定・計画データマージ等の業務ロジックは
     app.js側に残しています（クラウド同期に絡むため分離は見送り）
   ・CONFIG_UTILS.fiscalYearFromYM / CONFIG_UTILS.getDefaultFiscalYear は
     CONFIG.FISCAL_START に依存する「年度計算」という単一責務のロジックを
     一元管理する。app.js側の fiscalYearFromYM() / getDefaultFiscalYear()
     はこのCONFIG_UTILSを呼ぶだけの互換ラッパーとなっている
     （年度計算ロジックの実装はここ1箇所のみ）。
===================================================================== */
'use strict';

function fmt(v,d=0) {
  if (v==null||isNaN(v)) return '—';
  return new Intl.NumberFormat('ja-JP',{maximumFractionDigits:d,minimumFractionDigits:d}).format(Math.round(v));
}
function fmtK(v,d=0) { // 千円単位
  if (v==null||isNaN(v)) return '—';
  return fmt(v/1000,d);
}
function pct(v,d=1) { return (v==null||isNaN(v)||!isFinite(v)) ? '—' : fmt(v,d)+'%'; }
function diff(a,b) { if(!a||!b) return '—'; const d=a-b; return (d>=0?'+':'')+fmtK(d); }
function ratio(a,b) { if(!a||!b) return '—'; return pct((a/b-1)*100); }
function ymLabel(ym) { return ym ? `${ym.slice(0,4)}年${parseInt(ym.slice(4,6))}月` : '—'; }
function dt() { return new Date().toISOString().slice(0,10); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ════════ CONFIG_UTILS（Phase3-3-4：年度計算ロジックの単一実装元） ════════
   年度計算（fiscalYearFromYM / getDefaultFiscalYear）はCONFIG.FISCAL_START
   （現在4月始まり）に依存する。この計算式は、app.js旧実装（1457-1468行に
   あったもの）をそのまま移設しており、ロジック自体は一切変更していない。
   CONFIGはapp.js側で定義されているが、これらの関数は実際に呼ばれる
   タイミング（起動完了後・ユーザー操作後）まではCONFIGへアクセスしない
   ため、script読込順（app.js→format.jsの順）に問題はない。 */
window.CONFIG_UTILS = {
  getDefaultFiscalYear() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return String(m >= CONFIG.FISCAL_START ? y : y - 1);
  },
  fiscalYearFromYM(ym) {
    if (!ym || String(ym).length < 6) return this.getDefaultFiscalYear();
    const y = parseInt(String(ym).slice(0,4),10);
    const m = parseInt(String(ym).slice(4,6),10);
    return String(m >= CONFIG.FISCAL_START ? y : y - 1);
  }
};
