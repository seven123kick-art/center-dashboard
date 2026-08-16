/* ============================================================
   D1: Data Quality 中央定義
   src/core/data_catalog/quality.js

   目的：
   品質ステータス・Link Statusを、将来のCanonical層で共通利用
   できるよう中央定義する。既存のマスタ未登録判定等（例：
   src/core/ledger.jsのworkerRegistered判定）を、本モジュールの
   値へ今回置換することはしない（参照可能な定義を用意するだけ）。

   重要な原則（ご指示7番）：
   0（ゼロという確定値）と UNKNOWN/NULL（未確定・不明）を
   同一視してはならない。売上不明を0円として扱うようなdefault
   処理は、本モジュール自体には一切含まれていない
   （本モジュールは定数定義のみで、値の変換・補完処理を持たない）。
============================================================ */
'use strict';
(function(){
  if (window.__DATA_QUALITY_MODULE_LOADED_20260816__) return;
  window.__DATA_QUALITY_MODULE_LOADED_20260816__ = true;

  /* ---------- Data Quality Status ---------- */
  const QUALITY_STATUS = Object.freeze({
    OK: 'OK',
    PROVISIONAL: 'PROVISIONAL',
    PARTIAL: 'PARTIAL',
    UNMATCHED: 'UNMATCHED',
    CONFLICT: 'CONFLICT',
    MISSING_SOURCE: 'MISSING_SOURCE',
    STALE: 'STALE',
    ERROR: 'ERROR',
  });

  const QUALITY_STATUS_DESCRIPTIONS = Object.freeze({
    OK: '照合・検証とも完了し、信頼できる状態',
    PROVISIONAL: '速報等、確定前の暫定データである状態',
    PARTIAL: '一部の項目・一部の行のみ確定している状態',
    UNMATCHED: 'マスタ等との照合が取れていない状態',
    CONFLICT: '複数のソース間で値が矛盾している状態',
    MISSING_SOURCE: '参照すべきソースデータ自体が存在しない状態（0や確定値と同一視しない）',
    STALE: '取得済みだが鮮度が古く、再取得・再確認が必要な状態',
    ERROR: '取込・解析・照合のいずれかの過程でエラーが発生した状態',
  });

  /* ---------- Link Status ---------- */
  const LINK_STATUS = Object.freeze({
    FULL: 'FULL',
    PARTIAL: 'PARTIAL',
    HEAD_ONLY: 'HEAD_ONLY',
    UNMATCHED: 'UNMATCHED',
  });

  const LINK_STATUS_DESCRIPTIONS = Object.freeze({
    FULL: '関連する全てのソース（例：配達持出リスト・傭車料確認・売上明細）が揃って連動している状態',
    PARTIAL: '一部のソースのみ連動している状態',
    HEAD_ONLY: '配達ヘッド（便自体）の情報のみが存在し、売上等の連動情報がまだない状態（既存の便別採算画面における「配達ヘッド」区分に相当すると考えられるが、既存判定ロジックとの対応関係は本モジュールでは断定しない）',
    UNMATCHED: 'どのソースとも連動できていない状態',
  });

  /* ---------- 明示的な区別のためのヘルパー ----------
     「値が0であること」と「値が未確定/不明であること」を
     取り違えないための、判定専用の軽量関数。
     値の補完・デフォルト化は一切行わない（常に事実をそのまま返す）。 */
  function isKnownZero(value) {
    return value === 0;
  }
  function isUnknown(value) {
    return value === null || value === undefined;
  }
  function describeValue(value) {
    if (isUnknown(value)) return 'UNKNOWN_OR_NULL';
    if (isKnownZero(value)) return 'KNOWN_ZERO';
    return 'KNOWN_VALUE';
  }

  const DATA_QUALITY = {
    STATUS: QUALITY_STATUS,
    STATUS_DESCRIPTIONS: QUALITY_STATUS_DESCRIPTIONS,
    LINK_STATUS,
    LINK_STATUS_DESCRIPTIONS,
    isKnownZero,
    isUnknown,
    describeValue,
    listStatuses() { return Object.values(QUALITY_STATUS); },
    listLinkStatuses() { return Object.values(LINK_STATUS); },
  };

  window.DATA_QUALITY = DATA_QUALITY;
})();
