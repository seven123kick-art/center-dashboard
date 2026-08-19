/*
==============================================================================
Module
    Navigation

責務
    画面切替（NAV.go/NAV.refresh、表示中画面の管理）
    画面ごとの描画関数の呼び分け（NAV._render、switch-case）
    サイドメニューのグループ開閉（NAVGROUP）
    配送関連ハブのタブ切替（DELIVERY_NAV）
    データ管理ハブのタブ切替（DATA_MANAGEMENT_NAV）
    ※各画面の描画処理そのもの（renderDashboard, renderImport等）は
      対象外。app.js側に残置し、本モジュールからは呼び出すのみ。

依存
    STATE
    UI（公開API：updateTopbar, updateSaveStatus）
    document / sessionStorage
    各画面の描画関数（renderDashboard, renderPL, renderTrend,
      renderShipper, renderIndicators, renderAnnual, renderAlerts,
      renderMemo, renderImport, renderFieldViewAfterCloud 等、
      いずれもapp.js側の既存グローバル関数を呼び出すのみ）
    各モジュールの公開オブジェクト（CAPACITY_UI, PAST_LIBRARY,
      REPORT_UI, PROFIT_STRUCTURE_UI, LANDING_FORECAST_UI,
      WORKER_MASTER_UI, ROUTE_ANALYSIS_UI, FIELD_UI, FIELD_WORKER_UI,
      FIELD_CONTENT_UI, FIELD_PRODUCT_UI, FIELD_AREA_UI, FIELD_CSV_REBUILD,
      KAMOKU_UI）

公開API
    window.NAV
    window.NAVGROUP
    window.DELIVERY_NAV
    window.DATA_MANAGEMENT_NAV

互換API
    なし（呼び出し元は当初からすべて NAV.go() / NAV.refresh() 等の
    オブジェクト経由の呼び出しで、分離前後で呼び出し方法は変わらない）

更新日
    2026-07-25

注意（重要）
    src/field/field_content.js が、スクリプト読込直後（トップレベル、
    DOMContentLoaded等を待たない）に NAV.go を書き換える処理を持つため、
    本モジュールは必ず src/field/field_content.js より前に
    読み込まれる必要がある。center.html側のscript順序に注意。

TODO(V3)
    NAV._render内のswitch-caseが約20画面分に肥大化している点は
    将来的な整理候補（ただし今回は分離のみ、ロジック変更は行わない）
==============================================================================
*/
'use strict';

(function () {
    if (window.__NAVIGATION_MODULE_LOADED__) {
        console.warn('[Navigation] already loaded.');
        return;
    }
    window.__NAVIGATION_MODULE_LOADED__ = true;

window.NAVGROUP = {
  toggle(name, forceOpen) {
    const group = document.querySelector(`.nav-group[data-group="${name}"]`);
    if (!group) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !group.classList.contains('open');
    group.classList.toggle('open', open);
    const btn = group.querySelector('.nav-group-toggle');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  },
  sync(view) {
    document.querySelectorAll('.nav-group').forEach(group => {
      const has = !!group.querySelector(`.nav-item[data-view="${view}"]`);
      group.classList.toggle('has-active', has);
      if (has) this.toggle(group.dataset.group, true);
    });
  }
};


window.DELIVERY_NAV = {
  views: new Set(['route-analysis','field-worker','field-content','field-product','field-area','capacity']),
  go(view) {
    if (!this.views.has(view)) return;
    NAV.go(view);
  },
  sync(view) {
    const active = this.views.has(view);
    const hub = document.querySelector('[data-nav-hub="delivery"]');
    if (hub) hub.classList.toggle('active', active);
    const sharedTabs = document.getElementById('delivery-analysis-tabs');
    if (sharedTabs) sharedTabs.hidden = !active;

    // 作業者別・作業内容・商品カテゴリ・エリア別は同一の年度/月セレクターを共有する。
    // 各view間でDOMを移動させず、共通タブ直下の固定ホストで表示/非表示だけを切り替える。
    const fieldSelectorHost = document.getElementById('field-common-selector-host');
    if (fieldSelectorHost) {
      const usesFieldSelector = new Set(['field-worker','field-content','field-product','field-area']).has(view);
      fieldSelectorHost.hidden = !usesFieldSelector;
    }

    document.querySelectorAll('[data-delivery-tabs]').forEach(tabs => {
      tabs.querySelectorAll('[data-delivery-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.deliveryView === view);
      });
    });
  }
};

window.DATA_MANAGEMENT_NAV = {
  views: new Set(['csv-import','import','worker-master','library']),
  go(view) {
    if (!this.views.has(view)) return;
    NAV.go(view);
  },
  sync(view) {
    const active = this.views.has(view);
    const hub = document.querySelector('[data-nav-hub="data"]');
    if (hub) hub.classList.toggle('active', active);
    document.querySelectorAll('[data-management-tabs]').forEach(tabs => {
      tabs.querySelectorAll('[data-management-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.managementView === view);
      });
    });
  }
};

window.NAV = {
  // メイン画面切替（同期なし、再描画のみ）
  go(el) {
    this._beforeGoHooks.forEach(fn => { try { fn(el); } catch(e) {} });
    let view = (el && el.dataset) ? el.dataset.view : (typeof el==='string' ? el : 'dashboard');
    if (!view || !document.getElementById('view-' + view)) view = 'dashboard';
    STATE.view = view;
    try { sessionStorage.setItem('lastView', view); } catch(e) {}

    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

    const viewEl = document.getElementById('view-'+view);
    if (viewEl) viewEl.classList.add('active');

    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');
    if (window.NAVGROUP) NAVGROUP.sync(view);
    DELIVERY_NAV.sync(view);
    DATA_MANAGEMENT_NAV.sync(view);

    UI.updateTopbar(view);
    this._render(view);
    this._afterGoHooks.forEach(fn => { try { fn(el, view); } catch(e) {} });
  },

  // 現在の画面だけ再描画（データ更新後に呼ぶ）
  refresh() {
    this._render(STATE.view);
    UI.updateTopbar(STATE.view);
    UI.updateSaveStatus();
  },

  _render(view) {
    switch(view) {
      case 'dashboard':  renderDashboard();   break;
      case 'pl':         renderPL();           break;
      case 'budget-actual': if (window.BUDGET_ACTUAL_UI?.render) BUDGET_ACTUAL_UI.render(); break;
      case 'profit-structure': if (window.PROFIT_STRUCTURE_UI?.render) PROFIT_STRUCTURE_UI.render(); break;
      case 'landing-forecast': if (window.LANDING_FORECAST_UI?.render) LANDING_FORECAST_UI.render(); if (window.LANDING_FORECAST_UI?.renderImportPanel) LANDING_FORECAST_UI.renderImportPanel(); break;
      case 'trend':      renderTrend();        break;
      case 'shipper':    renderShipper();      break;
      case 'indicators': renderIndicators();   break;
      case 'annual':     renderAnnual();       break;
      case 'alerts':     renderAlerts();       break;
      case 'memo':       renderMemo();         break;
      case 'capacity':   CAPACITY_UI.render(); CAPACITY_UI.populateYMSel(); break;
      case 'import':
        renderImport();
        if (window.ROUTE_ANALYSIS_UI?.setup) ROUTE_ANALYSIS_UI.setup();
        break;
      case 'worker-master':
        if (window.WORKER_MASTER_UI?.render) WORKER_MASTER_UI.render();
        break;
      case 'data-verification': if (window.DATA_VERIFICATION_UI?.render) DATA_VERIFICATION_UI.render(); break;
      case 'csv-import':
        renderFieldViewAfterCloud(view, () => {
          renderImport();
          if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh();
        });
        break;
      case 'library':    PAST_LIBRARY.renderList(); break;
      case 'field':
        renderFieldViewAfterCloud(view, () => { FIELD_UI.renderDataList(); FIELD_UI.updatePeriodBadge(); });
        break;
      case 'field-worker':
        renderFieldViewAfterCloud(view, () => { if (window.FIELD_WORKER_UI?.render) FIELD_WORKER_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); });
        break;
      case 'route-analysis':
        renderFieldViewAfterCloud(view, () => { if (window.ROUTE_ANALYSIS_UI?.render) ROUTE_ANALYSIS_UI.render(); });
        break;
      case 'field-content':
        renderFieldViewAfterCloud(view, () => { if (window.FIELD_CONTENT_UI?.render) FIELD_CONTENT_UI.render(); else if (window.FIELD_TASK_UI?.render) FIELD_TASK_UI.render(); else if (window.FIELD_CSV_REBUILD?.renderContent) FIELD_CSV_REBUILD.renderContent(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); });
        break;
      case 'field-product':
        renderFieldViewAfterCloud(view, () => { if (window.FIELD_PRODUCT_UI?.render) FIELD_PRODUCT_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); });
        break;
      case 'field-area':
        renderFieldViewAfterCloud(view, () => { if (window.FIELD_AREA_UI?.render) FIELD_AREA_UI.render(); else if (window.FIELD_CSV_REBUILD?.refresh) FIELD_CSV_REBUILD.refresh(); });
        break;
      case 'report':     REPORT_UI.refresh(); break;
      case 'kamoku':     if (window.KAMOKU_UI?.render) KAMOKU_UI.render(); break;
    }
  },

  /* ════════ Hook API（Version3 Phase3-1：追加のみ。既存処理は無変更）
     go() の実行前後にコールバックを差し込むための受け皿。
     登録0件の場合は forEach が何もしないため、既存動作と完全に一致する。 ════════ */
  _beforeGoHooks: [],
  _afterGoHooks: [],
  onBeforeGo(fn) {
    if (typeof fn === 'function') this._beforeGoHooks.push(fn);
  },
  onAfterGo(fn) {
    if (typeof fn === 'function') this._afterGoHooks.push(fn);
  },
};
})();
