/* たした — メインロジック(「私のあゆみ」) */
(() => {
  "use strict";

  const APP_VERSION = "0.3.1";
  const STORAGE_KEY = "tashita-progress-v1";
  const LAST_BACKUP_KEY = "tashita-last-backup-at";
  const INSTALL_HINT_KEY = "tashita-install-hint-dismissed";

  const PALETTE = ["#0a84ff", "#ff9f0a", "#bf5af2", "#30d158", "#64d2ff", "#ff453a", "#ffd60a", "#5e5ce6"];
  const MS_DAY = 86400000;

  /* ---------- ユーティリティ ---------- */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dayOf(date) {
    return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
  }

  function dayHyphenOf(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function timeOf(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function isoWithOffset(date) {
    const tzMin = -date.getTimezoneOffset();
    const sign = tzMin >= 0 ? "+" : "-";
    const abs = Math.abs(tzMin);
    const hh = pad2(Math.floor(abs / 60));
    const mm = pad2(abs % 60);
    return (
      `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
      `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${hh}:${mm}`
    );
  }

  function formatHM(minutesTotal) {
    const h = Math.floor(minutesTotal / 60);
    const m = Math.round(minutesTotal % 60);
    return { h, m };
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else node[k] = v;
      }
    }
    if (children) {
      for (const c of children) if (c) node.appendChild(c);
    }
    return node;
  }

  /* ---------- 永続化 ---------- */

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("load failed", e);
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return true;
    } catch (e) {
      console.error("save failed", e);
      showToast("保存に失敗しました(容量不足の可能性があります)");
      return false;
    }
  }

  const state = { history: loadHistory() };
  let lastDeleted = null; // {entry, index}

  function persist() {
    saveHistory(state.history);
  }

  /* ---------- 集計 ---------- */

  function aggregateCategories(history) {
    const map = new Map();
    for (const h of history) {
      let c = map.get(h.category);
      if (!c) {
        c = { name: h.category, minutes: 0, count: 0, firstAt: h.at, lastAt: h.at };
        map.set(h.category, c);
      }
      c.minutes += h.minutes;
      c.count += 1;
      c.firstAt = Math.min(c.firstAt, h.at);
      c.lastAt = Math.max(c.lastAt, h.at);
    }
    const ordered = [...map.values()].sort((a, b) => a.firstAt - b.firstAt);
    ordered.forEach((c, i) => (c.color = PALETTE[i % PALETTE.length]));
    return ordered;
  }

  function computeStats(history) {
    const now = Date.now();
    let totalMinutes = 0;
    let last7Minutes = 0;
    const daysThisWeek = new Set();
    for (const h of history) {
      totalMinutes += h.minutes;
      if (now - h.at <= 7 * MS_DAY) {
        last7Minutes += h.minutes;
        daysThisWeek.add(h.day);
      }
    }
    return {
      totalMinutes,
      count: history.length,
      last7Minutes,
      daysActiveThisWeek: Math.min(daysThisWeek.size, 7),
    };
  }

  function progressFromMinutes(totalMinutes) {
    return 1 - Math.exp(-totalMinutes / (60 * 40));
  }

  /* ---------- 操作 ---------- */

  function addTime(category, minutes) {
    const trimmed = (category || "").trim();
    if (!trimmed || !(minutes > 0)) return false;
    const now = new Date();
    const entry = {
      id: uuid(),
      at: now.getTime(),
      day: dayOf(now),
      category: trimmed,
      minutes: Math.round(minutes),
    };
    state.history.unshift(entry);
    persist();
    renderAll();
    return true;
  }

  function deleteHistoryEntry(id) {
    const idx = state.history.findIndex((h) => h.id === id);
    if (idx === -1) return;
    const [removed] = state.history.splice(idx, 1);
    persist();
    renderAll();
    lastDeleted = { entry: removed, index: idx };
    showToast("削除しました", {
      actionLabel: "元に戻す",
      onAction: undoDelete,
      duration: 5000,
    });
  }

  function undoDelete() {
    if (!lastDeleted) return;
    const { entry, index } = lastDeleted;
    const pos = Math.min(index, state.history.length);
    state.history.splice(pos, 0, entry);
    lastDeleted = null;
    persist();
    renderAll();
    hideToast();
  }

  function deleteAll() {
    state.history = [];
    persist();
    renderAll();
  }

  function suggestedCategory() {
    if (state.history.length > 0) return state.history[0].category;
    return null;
  }

  /* ---------- 描画 ---------- */

  let scene = null;

  function renderHero() {
    const stats = computeStats(state.history);
    const progress = progressFromMinutes(stats.totalMinutes);

    const total = formatHM(stats.totalMinutes);
    document.getElementById("stat-total").innerHTML =
      `${total.h}<span class="unit">時間</span>${total.m}<span class="unit">分</span>`;
    document.getElementById("stat-count").innerHTML = `${stats.count}<span class="unit">件</span>`;
    const week = formatHM(stats.last7Minutes);
    document.getElementById("stat-week").innerHTML =
      `${week.h}<span class="unit">時間</span>${week.m}<span class="unit">分</span>`;

    const caption = document.getElementById("week-caption");
    caption.textContent =
      stats.count === 0
        ? "今日はまだ空。ぽいっとでいい。"
        : `今週は${stats.daysActiveThisWeek}日、記録がありました。`;

    const glow = document.getElementById("hero-glow");
    const glowColor = `rgba(150, 140, 255, ${0.25 + 0.35 * progress})`;
    glow.style.setProperty("--glow-color", glowColor);
    glow.style.setProperty("--glow-opacity", String(0.15 + 0.55 * progress));

    if (scene) scene.setProgress(progress);
  }

  function renderCatBarAndLegend() {
    const cats = aggregateCategories(state.history);
    const bar = document.getElementById("cat-bar");
    const legend = document.getElementById("cat-legend");
    bar.innerHTML = "";
    legend.innerHTML = "";

    const total = cats.reduce((sum, c) => sum + c.minutes, 0);
    if (total === 0) return;

    const sorted = [...cats].sort((a, b) => b.minutes - a.minutes);
    for (const c of sorted) {
      const pct = (c.minutes / total) * 100;
      bar.appendChild(
        el("div", { class: "cat-bar-seg", style: `width:${pct}%;background:${c.color}` })
      );
      legend.appendChild(
        el("div", { class: "cat-legend-item" }, [
          el("span", { class: "cat-legend-dot", style: `background:${c.color}` }),
          el("span", { text: `${c.name} ${pct.toFixed(1)}%` }),
        ])
      );
    }
  }

  function renderHistoryList() {
    const container = document.getElementById("history-list");
    container.innerHTML = "";
    const cats = aggregateCategories(state.history);
    const colorByName = new Map(cats.map((c) => [c.name, c.color]));

    const items = state.history.slice(0, 30);
    if (items.length === 0) {
      container.appendChild(el("div", { class: "empty-state", text: "まだ何も足していません。「＋」から、はじめての一歩を。" }));
      return;
    }
    for (const h of items) {
      const d = new Date(h.at);
      const row = el("div", { class: "history-row" }, [
        el("span", { class: "history-dot", style: `background:${colorByName.get(h.category) || "#888"}` }),
        el("span", { class: "history-name", text: h.category }),
        el("span", { class: "history-minutes", text: `+${h.minutes}分` }),
        el("span", { class: "history-time", text: `${dayOf(d) === dayOf(new Date()) ? "" : h.day + " "}${timeOf(d)}` }),
        el("button", { class: "history-del", text: "消す", type: "button", "data-action": "delete-history", "data-id": h.id }),
      ]);
      container.appendChild(row);
    }
  }

  function renderQuickAdd() {
    const btn = document.getElementById("quick-add-btn");
    const suggested = suggestedCategory();
    btn.textContent = suggested ? `＋ ${suggested}を30分たす` : "＋ 30分たす";
  }

  function renderCategoryDatalist() {
    const datalist = document.getElementById("category-options");
    datalist.innerHTML = "";
    const cats = aggregateCategories(state.history);
    for (const c of cats) {
      datalist.appendChild(el("option", { value: c.name }));
    }
  }

  function renderAll() {
    renderHero();
    renderCatBarAndLegend();
    renderHistoryList();
    renderQuickAdd();
    renderCategoryDatalist();
  }

  /* ---------- 書き出し ---------- */

  function exportJSON() {
    const now = new Date();
    const payload = {
      version: 2,
      exportedAt: isoWithOffset(now),
      items: state.history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tashita-${dayHyphenOf(now)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    try {
      localStorage.setItem(LAST_BACKUP_KEY, String(now.getTime()));
    } catch (e) {
      /* noop */
    }
    renderSettingsBackupInfo();
    showToast("バックアップを書き出しました");
  }

  function importJSONFile(file, mode) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        showToast("JSONを読み込めませんでした");
        return;
      }
      const items = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(items)) {
        showToast("形式が正しくありません");
        return;
      }
      const ok = window.confirm(
        `${items.length}件のレコードを読み込みます。\n` +
          (mode === "replace" ? "既存データはすべて置き換えられます。" : "既存データに追記マージします。") +
          "\n\nよろしいですか？"
      );
      if (!ok) return;

      if (mode === "replace") {
        state.history = items;
      } else {
        const existingIds = new Set(state.history.map((h) => h.id));
        const toAdd = items.filter((it) => it && it.id && !existingIds.has(it.id));
        state.history = [...toAdd, ...state.history];
      }
      persist();
      renderAll();
      showToast("読み込みが完了しました");
    };
    reader.readAsText(file);
  }

  /* ---------- トースト ---------- */

  let toastTimer = null;

  function showToast(message, opts) {
    opts = opts || {};
    const toast = document.getElementById("toast");
    toast.innerHTML = "";
    toast.appendChild(el("span", { text: message }));
    if (opts.actionLabel) {
      const btn = el("button", { text: opts.actionLabel, type: "button" });
      btn.addEventListener("click", () => {
        if (opts.onAction) opts.onAction();
      });
      toast.appendChild(btn);
    }
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(), opts.duration || 3200);
  }

  function hideToast() {
    document.getElementById("toast").classList.remove("show");
  }

  /* ---------- 設定モーダル ---------- */

  function renderSettingsBackupInfo() {
    const infoEl = document.getElementById("last-backup-info");
    let raw = null;
    try {
      raw = localStorage.getItem(LAST_BACKUP_KEY);
    } catch (e) {
      /* noop */
    }
    if (!raw) {
      infoEl.textContent = "まだバックアップしていません";
      return;
    }
    const d = new Date(Number(raw));
    infoEl.textContent = `最終バックアップ: ${dayOf(d)} ${timeOf(d)}`;
  }

  function openSettings() {
    document.getElementById("settings-overlay").classList.add("show");
    renderSettingsBackupInfo();
    document.getElementById("version-label").textContent = `バージョン v${APP_VERSION}`;
  }

  function closeSettings() {
    document.getElementById("settings-overlay").classList.remove("show");
    resetDeleteAllArm();
  }

  let deleteAllArmed = false;
  let deleteAllTimer = null;

  function resetDeleteAllArm() {
    deleteAllArmed = false;
    clearTimeout(deleteAllTimer);
    const btn = document.getElementById("delete-all-btn");
    if (btn) btn.textContent = "すべて削除";
  }

  function handleDeleteAllClick() {
    const btn = document.getElementById("delete-all-btn");
    if (!deleteAllArmed) {
      deleteAllArmed = true;
      btn.textContent = "本当に全部消す(もう一度押す)";
      deleteAllTimer = setTimeout(resetDeleteAllArm, 4000);
      return;
    }
    deleteAll();
    resetDeleteAllArm();
    closeSettings();
    showToast("すべて削除しました");
  }

  /* ---------- 追加モーダル ---------- */

  let selectedMinutes = 30;

  function openAddModal() {
    document.getElementById("add-overlay").classList.add("show");
    const input = document.getElementById("add-category");
    const suggested = suggestedCategory();
    input.value = suggested || "";
    document.getElementById("add-minutes").value = String(selectedMinutes);
    setTimeout(() => input.focus(), 50);
  }

  function closeAddModal() {
    document.getElementById("add-overlay").classList.remove("show");
  }

  function initAddModal() {
    document.getElementById("open-add-modal").addEventListener("click", openAddModal);
    document.getElementById("close-add").addEventListener("click", closeAddModal);
    document.getElementById("add-overlay").addEventListener("click", (e) => {
      if (e.target.id === "add-overlay") closeAddModal();
    });

    const chips = document.querySelectorAll("#minute-chips .chip-btn");
    const minutesInput = document.getElementById("add-minutes");
    for (const chip of chips) {
      chip.addEventListener("click", () => {
        for (const c of chips) c.classList.remove("active");
        chip.classList.add("active");
        selectedMinutes = Number(chip.dataset.minutes);
        minutesInput.value = String(selectedMinutes);
      });
    }
    minutesInput.addEventListener("input", () => {
      for (const c of chips) c.classList.remove("active");
    });

    document.getElementById("submit-add").addEventListener("click", () => {
      const category = document.getElementById("add-category").value;
      const minutes = Number(minutesInput.value);
      if (!category.trim()) {
        showToast("カテゴリを入力してください");
        return;
      }
      if (!(minutes > 0)) {
        showToast("時間を正しく入力してください");
        return;
      }
      if (addTime(category, minutes)) {
        closeAddModal();
        showToast(`${category.trim()}に${minutes}分、たした。`);
      }
    });
  }

  function initQuickAdd() {
    document.getElementById("quick-add-btn").addEventListener("click", () => {
      const suggested = suggestedCategory();
      if (!suggested) {
        openAddModal();
        return;
      }
      addTime(suggested, 30);
      showToast(`${suggested}に30分、たした。`);
    });
  }

  /* ---------- 履歴の削除委譲 ---------- */

  function initHistoryDelegation() {
    document.getElementById("history-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='delete-history']");
      if (!btn) return;
      deleteHistoryEntry(btn.dataset.id);
    });
  }

  /* ---------- 設定 init ---------- */

  function initSettings() {
    document.getElementById("settings-btn").addEventListener("click", openSettings);
    document.getElementById("close-settings").addEventListener("click", closeSettings);
    document.getElementById("settings-overlay").addEventListener("click", (e) => {
      if (e.target.id === "settings-overlay") closeSettings();
    });
    document.getElementById("export-json-btn").addEventListener("click", exportJSON);
    document.getElementById("import-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const mode = document.querySelector('input[name="import-mode"]:checked').value;
      importJSONFile(file, mode);
      e.target.value = "";
    });
    document.getElementById("delete-all-btn").addEventListener("click", handleDeleteAllClick);
  }

  /* ---------- ヒーローシーン ---------- */

  function initScene() {
    const canvas = document.getElementById("hero-canvas");
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stats = computeStats(state.history);
    const progress = progressFromMinutes(stats.totalMinutes);

    scene = window.TashitaScene && window.TashitaScene.init(canvas, {
      initialProgress: progress,
      initialPaused: reduceMotion,
    });

    const pauseBtn = document.getElementById("pause-btn");
    function syncPauseLabel() {
      const paused = scene ? scene.isPaused() : reduceMotion;
      pauseBtn.textContent = paused ? "▶ 動きを再開する" : "⏸ 動きを止める";
    }
    if (scene) {
      syncPauseLabel();
      pauseBtn.addEventListener("click", () => {
        scene.setPaused(!scene.isPaused());
        syncPauseLabel();
      });
    } else {
      pauseBtn.hidden = true;
    }
  }

  /* ---------- Service Worker & 更新通知 ---------- */

  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                showUpdateBanner(reg);
              }
            });
          });
        })
        .catch((e) => console.error("SW登録失敗", e));

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  function showUpdateBanner(reg) {
    const banner = document.getElementById("update-banner");
    banner.classList.add("show");
    document.getElementById("update-reload-btn").onclick = () => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    };
  }

  /* ---------- インストール案内 ---------- */

  function initInstallHint() {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch (e) {
      /* noop */
    }
    if (dismissed) return;

    const hint = document.getElementById("install-hint");
    let deferredPrompt = null;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      hint.hidden = false;
    });

    hint.querySelector(".install-action").addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hint.hidden = true;
      try {
        localStorage.setItem(INSTALL_HINT_KEY, "1");
      } catch (e) {
        /* noop */
      }
    });

    hint.querySelector(".dismiss").addEventListener("click", () => {
      hint.hidden = true;
      try {
        localStorage.setItem(INSTALL_HINT_KEY, "1");
      } catch (e) {
        /* noop */
      }
    });
  }

  /* ---------- ストレージ健全性チェック ---------- */

  function checkStorageHealth() {
    try {
      const testKey = "__tashita_test__";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
    } catch (e) {
      showToast("この環境ではデータが保存されない場合があります(シークレットモードなど)");
    }
  }

  /* ---------- 起動 ---------- */

  function init() {
    initScene();
    initQuickAdd();
    initAddModal();
    initHistoryDelegation();
    initSettings();
    initInstallHint();
    initServiceWorker();
    checkStorageHealth();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
