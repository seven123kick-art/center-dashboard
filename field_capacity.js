/* field_capacity.js : disabled after integration into app.js
   2026-05-03
   キャパ分析は app.js の CAPACITY_UI に統合済み。
   二重描画とメモリ負荷を避けるため、このファイルは何もしません。
*/
'use strict';
(function(){
  window.FIELD_CAPACITY_UI = window.FIELD_CAPACITY_UI || { render(){ if (window.CAPACITY_UI) CAPACITY_UI.render(); } };
})();
