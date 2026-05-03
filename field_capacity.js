/* field_capacity.js : 緊急停止版
   2026-05-03
   目的：Out of Memory 回避のため、キャパ分析の追加処理を完全停止。
   ページを正常に開くことを最優先にする。
*/
'use strict';

(function(){
  console.log('[field_capacity] emergency disabled');
  window.FIELD_CAPACITY_UI = {
    render(){
      console.log('[field_capacity] disabled');
    }
  };
})();
