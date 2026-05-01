/* field_worker.js : 作業者分析ビュー */
'use strict';
(function(){
  window.FIELD_WORKER_UI = {
    render(){
      if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh) FIELD_CSV_REBUILD.refresh();
    }
  };
})();
