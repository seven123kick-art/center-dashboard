/* field_task.js : 作業内容分析ビュー */
'use strict';
(function(){
  window.FIELD_TASK_UI = {
    render(){
      if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh) FIELD_CSV_REBUILD.refresh();
    }
  };
})();
