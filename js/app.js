/* たした — メインロジック */
(() => {
  "use strict";

  const APP_VERSION = "0.2.0";
  const STORAGE_KEY = "tashita-logs-v1";
  const LAST_BACKUP_KEY = "tashita-last-backup-at";
  const INSTALL_HINT_KEY = "tashita-install-hint-dismissed";

  const KIND_ORDER = ["did", "task", "idea"];
  const KIND_LABEL = { did: "やった", task: "課題", idea: "芽" };
  const CAT_ORDER = ["仕事", "家庭", "創作", "生活", "その他"];

  const TASK_KEYWORDS = ["たい", "ねば", "課題", "あとで", "続き", "やらな", "しなきゃ", "次は", "TODO", "todo"];
  const IDEA_KEYWORDS = ["かも", "アイデア", "思う", "構想", "概念"];
  const DID_KEYWORDS = ["した", "やった", "終わ", "できた", "出した"];

  const CAT_DICT = {
    "仕事": ["仕事", "会社", "業務", "会議", "資料", "クライアント", "営業", "メール", "締切", "締め切り", "プロジェクト", "商談", "納期", "出社", "残業"],
    "家庭": ["家族", "子供", "子ども", "妻", "夫", "両親", "家事", "掃除", "洗濯", "料理", "買い物", "育児", "実家"],
    "創作": ["小説", "執筆", "作品", "イラスト", "曲", "音楽", "デザイン", "創作", "構想", "詩", "脚本", "漫画", "制作", "描い"],
    "生活": ["運動", "散歩", "睡眠", "健康", "食事", "読書", "趣味", "旅行", "部屋", "片付け"],
  };

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
      for (const c of children) {
        if (c) node.appendChild(c);
      }
    }
    return node;
  }

  /* ---------- 分割・分類 ---------- */

  function splitIntoSentences(raw) {
    const lines = raw.split(/\r\n|\r|\n/);
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/(?<=[。!!])/);
      for (const p of parts) {
        const t = p.trim();
        if (t) out.push(t);
      }
    }
    if (out.length === 0) {
      const t = raw.trim();
      if (t) out.push(t);
    }
    return out;
  }

  function classifyKind(text) {
    if (TASK_KEYWORDS.some((k) => text.includes(k))) return "task";
    const hasDid = DID_KEYWORDS.some((k) => text.includes(k));
    if (!hasDid && IDEA_KEYWORDS.some((k) => text.includes(k))) return "idea";
    return "did";
  }

  function classifyCat(text) {
    for (const cat of CAT_ORDER) {
      if (cat === "その他") continue;
      const dict = CAT_DICT[cat];
      if (dict && dict.some((k) => text.includes(k))) return cat;
    }
    return "その他";
  }

  /* ---------- 永続化 ---------- */

  let storageBroken = false;

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (e) {
      console.error("load failed", e);
      return [];
    }
  }

  function saveRecords(records) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      storageBroken = false;
      return true;
    } catch (e) {
      console.error("save failed", e);
      storageBroken = true;
      showToast("保存に失敗しました(容量不足の可能性があります)");
      return false;
    }
  }

  /* ---------- 状態 ---------- */

  const state = {
    records: loadRecords(),
    view: "today",
  };

  let lastDeleted = null; // {record, index}
  let deleteUndoTimer = null;

  function persist() {
    saveRecords(state.records);
  }

  function addFromRaw(raw) {
    const sentences = splitIntoSentences(raw);
    if (sentences.length === 0) return 0;
    const now = new Date();
    const created = sentences.map((text) => {
      const kind = classifyKind(text);
      return {
        id: uuid(),
        at: now.getTime(),
        day: dayOf(now),
        raw,
        text,
        kind,
        cat: classifyCat(text),
        stacked: kind === "task" || kind === "idea",
      };
    });
    // 新しい順で先頭に積む
    state.records = [...created.reverse(), ...state.records];
    persist();
    return created.length;
  }

  function findRecord(id) {
    return state.records.find((r) => r.id === id);
  }

  function toggleStacked(id) {
    const r = findRecord(id);
    if (!r) return;
    r.stacked = !r.stacked;
    persist();
    renderView();
  }

  function cycleKind(id) {
    const r = findRecord(id);
    if (!r) return;
    const idx = KIND_ORDER.indexOf(r.kind);
    r.kind = KIND_ORDER[(idx + 1) % KIND_ORDER.length];
    persist();
    renderView();
  }

  function deleteRecord(id) {
    const idx = state.records.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const [removed] = state.records.splice(idx, 1);
    persist();
    renderView();
    lastDeleted = { record: removed, index: idx };
    clearTimeout(deleteUndoTimer);
    showToast("削除しました", {
      actionLabel: "元に戻す",
      onAction: undoDelete,
      duration: 5000,
    });
    deleteUndoTimer = setTimeout(() => {
      lastDeleted = null;
    }, 5200);
  }

  function undoDelete() {
    if (!lastDeleted) return;
    const { record, index } = lastDeleted;
    const pos = Math.min(index, state.records.length);
    state.records.splice(pos, 0, record);
    lastDeleted = null;
    persist();
    renderView();
    hideToast();
  }

  function deleteAll() {
    state.records = [];
    persist();
    renderView();
  }

  /* ---------- 表示ヘルパー ---------- */

  function emptyMessageFor(view) {
    switch (view) {
      case "today":
        return "今日はまだ空。ぽいっとでいい。";
      case "task":
        return "まだ課題は入ってない。投げたら残る。";
      case "stack":
        return "まだ積もってない。課題と芽は自動で積む。";
      default:
        return "まだ何も投げていない。ぽいっと投げると、ここに残る。";
    }
  }

  function buildCard(record, opts) {
    opts = opts || {};
    const kindChip = el("span", {
      class: `chip chip-kind-${record.kind}`,
      text: KIND_LABEL[record.kind],
    });
    const catChip = el("span", { class: "chip chip-cat", text: record.cat });
    const chips = [kindChip, catChip];
    if (record.stacked) {
      chips.push(el("span", { class: "chip chip-stacked", text: "積" }));
    }

    const d = new Date(record.at);
    const timeLabel = opts.showDay ? `${record.day} ${timeOf(d)}` : timeOf(d);
    chips.push(el("span", { class: "card-time", text: timeLabel }));

    const top = el("div", { class: "card-top" }, chips);
    const textEl = el("p", { class: "card-text", text: record.text });

    const stackBtn = el("button", {
      class: record.stacked ? "on" : "",
      text: record.stacked ? "積みから外す" : "ノートに積む",
      type: "button",
      "data-action": "toggle-stack",
      "data-id": record.id,
    });
    const kindBtn = el("button", {
      text: "種類を変える",
      type: "button",
      "data-action": "cycle-kind",
      "data-id": record.id,
    });
    const delBtn = el("button", {
      class: "danger",
      text: "消す",
      type: "button",
      "data-action": "delete",
      "data-id": record.id,
    });
    const actions = el("div", { class: "card-actions" }, [stackBtn, kindBtn, delBtn]);

    return el("div", { class: "card" }, [top, textEl, actions]);
  }

  function renderEmpty(container, view) {
    container.appendChild(el("div", { class: "empty-state", text: emptyMessageFor(view) }));
  }

  function renderToday(container) {
    const today = dayOf(new Date());
    const items = state.records.filter((r) => r.day === today).sort((a, b) => b.at - a.at);
    if (items.length === 0) return renderEmpty(container, "today");
    for (const r of items) container.appendChild(buildCard(r));
  }

  function renderTask(container) {
    const items = state.records.filter((r) => r.kind === "task").sort((a, b) => b.at - a.at);
    if (items.length === 0) return renderEmpty(container, "task");
    for (const r of items) container.appendChild(buildCard(r, { showDay: true }));
  }

  function renderAll(container) {
    const items = [...state.records].sort((a, b) => b.at - a.at);
    if (items.length === 0) return renderEmpty(container, "all");
    for (const r of items) container.appendChild(buildCard(r, { showDay: true }));
  }

  function renderStack(container) {
    const items = state.records.filter((r) => r.stacked);
    if (items.length === 0) return renderEmpty(container, "stack");

    const byCat = new Map();
    for (const cat of CAT_ORDER) byCat.set(cat, []);
    for (const r of items) {
      if (!byCat.has(r.cat)) byCat.set(r.cat, []);
      byCat.get(r.cat).push(r);
    }

    for (const cat of byCat.keys()) {
      const list = byCat.get(cat);
      if (!list || list.length === 0) continue;
      list.sort((a, b) => a.at - b.at);

      const header = el("div", { class: "cat-group-header" }, [
        el("h2", { text: cat }),
        el("button", {
          class: "copy-btn",
          text: "束をコピー",
          type: "button",
          "data-action": "copy-cat",
          "data-cat": cat,
        }),
      ]);
      const group = el("div", { class: "cat-group" }, [header]);
      for (const r of list) group.appendChild(buildCard(r, { showDay: true }));
      container.appendChild(group);
    }
  }

  function renderView() {
    const container = document.getElementById("content");
    container.innerHTML = "";
    switch (state.view) {
      case "today":
        renderToday(container);
        break;
      case "stack":
        renderStack(container);
        break;
      case "task":
        renderTask(container);
        break;
      case "all":
        renderAll(container);
        break;
    }
    for (const btn of document.querySelectorAll(".tab-btn")) {
      btn.classList.toggle("active", btn.dataset.view === state.view);
    }
  }

  /* ---------- 書き出し ---------- */

  function bundleTextForCat(cat) {
    const list = state.records
      .filter((r) => r.stacked && r.cat === cat)
      .sort((a, b) => a.at - b.at);
    const lines = [`# ${cat}`];
    for (const r of list) {
      const d = new Date(r.at);
      lines.push(`- [${dayHyphenOf(d)}] ${KIND_LABEL[r.kind]} ${r.text}`);
    }
    return lines.join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function exportJSON() {
    const now = new Date();
    const payload = {
      version: 1,
      exportedAt: isoWithOffset(now),
      items: state.records,
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
        state.records = items;
      } else {
        const existingIds = new Set(state.records.map((r) => r.id));
        const toAdd = items.filter((it) => it && it.id && !existingIds.has(it.id));
        state.records = [...toAdd, ...state.records];
      }
      persist();
      renderView();
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
    const toast = document.getElementById("toast");
    toast.classList.remove("show");
  }

  /* ---------- 設定モーダル ---------- */

  function renderSettingsBackupInfo() {
    const infoEl = document.getElementById("last-backup-info");
    if (!infoEl) return;
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

  /* ---------- 入力 ---------- */

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
  }

  function initComposer() {
    const textarea = document.getElementById("composer-input");
    const sendBtn = document.getElementById("send-btn");

    function updateSendState() {
      sendBtn.disabled = textarea.value.trim().length === 0;
    }

    textarea.addEventListener("input", () => {
      autoGrow(textarea);
      updateSendState();
    });

    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    function submit() {
      const raw = textarea.value;
      if (raw.trim().length === 0) return;
      const count = addFromRaw(raw);
      textarea.value = "";
      autoGrow(textarea);
      updateSendState();
      textarea.focus();
      renderView();
      if (count > 0) showToast(count > 1 ? `${count}件、ぽいっと。` : "ぽいっと。");
    }

    sendBtn.addEventListener("click", submit);
    updateSendState();
  }

  /* ---------- 音声入力(対応ブラウザのみ) ---------- */

  function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.getElementById("mic-btn");
    if (!SpeechRecognition) {
      micBtn.remove();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let recording = false;

    recognition.addEventListener("result", (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      const textarea = document.getElementById("composer-input");
      textarea.value = (textarea.value ? textarea.value + "\n" : "") + text;
      autoGrow(textarea);
      document.getElementById("send-btn").disabled = textarea.value.trim().length === 0;
    });

    recognition.addEventListener("end", () => {
      recording = false;
      micBtn.classList.remove("recording");
    });

    recognition.addEventListener("error", () => {
      recording = false;
      micBtn.classList.remove("recording");
    });

    micBtn.addEventListener("click", () => {
      if (recording) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
        recording = true;
        micBtn.classList.add("recording");
      } catch (e) {
        /* noop */
      }
    });
  }

  /* ---------- タブ・アクション委譲 ---------- */

  function initTabs() {
    for (const btn of document.querySelectorAll(".tab-btn")) {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        renderView();
      });
    }
  }

  function initContentDelegation() {
    document.getElementById("content").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "toggle-stack") toggleStacked(btn.dataset.id);
      else if (action === "cycle-kind") cycleKind(btn.dataset.id);
      else if (action === "delete") deleteRecord(btn.dataset.id);
      else if (action === "copy-cat") {
        const text = bundleTextForCat(btn.dataset.cat);
        copyText(text).then((ok) => showToast(ok ? "コピーしました" : "コピーに失敗しました"));
      }
    });
  }

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
    initTabs();
    initComposer();
    initVoiceInput();
    initContentDelegation();
    initSettings();
    initInstallHint();
    initServiceWorker();
    checkStorageHealth();
    renderView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
