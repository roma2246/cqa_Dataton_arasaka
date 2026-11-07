// Роутер и общие утилиты. Владелец: Участник 3.
import { api } from "./api.js";
import { renderConversations } from "./views/conversations.js";
import { renderCard } from "./views/card.js";
import { renderChecklist } from "./views/checklist.js";
import { renderAppeals } from "./views/appeals.js";

export const root = document.getElementById("app");

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), 4000);
}

export const STATUS_LABEL = { applicable: "Оценён", not_applicable: "N/A", needs_review: "Нужна проверка" };

// null -> "—", никогда не 0
export const fmt = (v, digits = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));

export function role() {
  return document.getElementById("role").value;
}

const roleSel = document.getElementById("role");
try { roleSel.value = localStorage.getItem("cqa-role") || "operator"; } catch {}
roleSel.addEventListener("change", () => {
  try { localStorage.setItem("cqa-role", roleSel.value); } catch {}
  route();
});

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  try {
    if (hash.startsWith("/c/")) return await renderCard(decodeURIComponent(hash.slice(3)));
    if (hash === "/checklist") return await renderChecklist();
    if (hash === "/appeals") return await renderAppeals();
    return await renderConversations();
  } catch (e) {
    root.innerHTML = `<div class="panel st-failed">Ошибка: ${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", route);
api.health().then((h) => {
  const b = document.getElementById("mode-badge");
  b.textContent = h.evaluator_mode === "mock" ? "ТЕСТОВЫЙ режим оценщика (mock)" : "Модель: " + h.model;
  b.className = "badge " + (h.evaluator_mode === "mock" ? "mock" : "real");
}).catch(() => toast("Сервер недоступен", true));
route();
