// ===== 年度ガード対応 app.js =====
'use strict';

// ===== STATE =====
const STATE = {
  planData: {},
  fiscalYear: null
};

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  const yearSel = document.getElementById('plan-year-sel');
  const textarea = document.getElementById('plan-paste-area');

  if (!yearSel) return;

  // 初期年度
  STATE.fiscalYear = yearSel.value;

  loadPlan();

  // 年度変更
  yearSel.addEventListener('change', () => {
    STATE.fiscalYear = yearSel.value;
    textarea.value = ''; // ★ここが重要
    loadPlan();
    alert("年度変更：入力内容をリセットしました");
  });

  // 取込ボタン
  const btn = document.getElementById('plan-import-btn');
  if (btn) {
    btn.onclick = importPlan;
  }

  // クリアボタン
  const clearBtn = document.getElementById('plan-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = clearPlan;
  }
});

// ===== 保存キー =====
function key() {
  return "plan_" + STATE.fiscalYear;
}

// ===== 取込 =====
function importPlan() {
  const textarea = document.getElementById('plan-paste-area');
  const text = textarea.value;

  if (!text) {
    alert("空です");
    return;
  }

  const k = key();

  if (localStorage.getItem(k)) {
    if (!confirm("上書きしますか？")) return;
  }

  localStorage.setItem(k, text);
  loadPlan();
}

// ===== 表示 =====
function loadPlan() {
  const view = document.getElementById('plan-view');
  const data = localStorage.getItem(key());
  if (view) {
    view.textContent = data || "未登録";
  }
}

// ===== クリア =====
function clearPlan() {
  const k = key();
  if (!confirm("削除しますか？")) return;
  localStorage.removeItem(k);
  loadPlan();
}
