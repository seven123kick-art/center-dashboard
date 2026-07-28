/*
==============================================================================
Module
    RenderHooks

責務
    画面描画関数（renderDashboard / renderTrend / renderShipper）の
    実行完了後にコールバックを差し込むための受け皿。

    Version3で導入した NAV.onAfterGo / CLOUD.onAfterApplyFullState と
    同じ設計思想・同じ書き方で作成した。

    【重要】今回はHook Infrastructure（受け皿）のみを追加する。
    - renderDashboard() / renderTrend() / renderShipper() 自体は
      1文字も変更していない
    - 既存のモンキーパッチ（shipper.jsによるrenderDashboard/renderTrend/
      renderShipperの書き換え、3層分）も一切削除していない
    - 今回、このHookへ登録するコード（利用側）は追加していない
      （登録0件の状態）

依存
    なし（本ファイル単体で完結する）

公開API
    window.RENDER.onAfterDashboard(fn)
    window.RENDER.onAfterTrend(fn)
    window.RENDER.onAfterShipper(fn)

互換API
    なし（新規追加のため）

更新日
    2026-07-25

TODO(V4)
    - Monkey Patch Migration Design（Phase5-2）の移行順序に従い、
      renderTrend → renderDashboard → renderShipper の順で、
      既存モンキーパッチを本Hookへの登録に置き換えていく
    - 置き換えが完了するまで、既存モンキーパッチは削除しない
==============================================================================
*/
'use strict';

(function () {
    if (window.__RENDER_HOOKS_MODULE_LOADED__) {
        console.warn('[RenderHooks] already loaded.');
        return;
    }
    window.__RENDER_HOOKS_MODULE_LOADED__ = true;

    window.RENDER = {
        _afterDashboardHooks: [],
        _afterTrendHooks: [],
        _afterShipperHooks: [],

        onAfterDashboard(fn) {
            if (typeof fn === 'function') this._afterDashboardHooks.push(fn);
        },
        onAfterTrend(fn) {
            if (typeof fn === 'function') this._afterTrendHooks.push(fn);
        },
        onAfterShipper(fn) {
            if (typeof fn === 'function') this._afterShipperHooks.push(fn);
        },
    };

})();
