/* field_product.js : 商品カテゴリ分析ビュー */
'use strict';
(function(){
  window.FIELD_PRODUCT_UI = {
    render(){
      if (window.FIELD_CSV_REBUILD && FIELD_CSV_REBUILD.refresh) FIELD_CSV_REBUILD.refresh();
    }
  };
})();
