// Роутер и общие утилиты. Владелец: Участник 3.
import { api } from "./api.js";
import { renderConversations } from "./views/conversations.js";
import { renderCard } from "./views/card.js";
import { renderChecklist } from "./views/checklist.js";
import { renderAppeals } from "./views/appeals.js";
import { renderTasks } from "./views/tasks.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderStart } from "./views/start.js";

export const root = document.getElementById("app");

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), 4200);
}

export const STATUS_LABEL = { applicable: "Оценён", not_applicable: "N/A", needs_review: "Нужна проверка" };
export const EVAL_STATUS = {
  queued: ["В очереди", "accent"], running: ["Оценивается", "accent"], completed: ["Готово", "ok"],
  failed: ["Ошибка", "bad"], canceled: ["Отменено", ""],
};
export const LANG = { RU: "Русский", KZ: "Қазақша", EN: "English" };
export const CHANNEL = { "agent chat": "Чат", "voice call": "Звонок" };
export const SPEAKER = { client: "Клиент", operator: "Оператор", bot: "Бот AIM", system: "Система" };

// null -> "—", никогда не 0
export const fmt = (v, digits = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));
export const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(Number(v) % 1 ? 1 : 0)}%`);
export const tone = (v) => (v === null || v === undefined ? "" : v >= 80 ? "good" : v >= 50 ? "mid" : "low");

export function scoreBar(v) {
  if (v === null || v === undefined) return '<span class="subtle">—</span>';
  const t = tone(v);
  return `<span class="score"><span class="bar ${t === "good" ? "" : t}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>${pct(v)}</span>`;
}

export function chip(text, kind = "") {
  return `<span class="chip ${kind}">${esc(text)}</span>`;
}

export function role() {
  return document.querySelector("#role [aria-pressed='true']")?.dataset.v || "operator";
}

// ---- Роль (демо) ----
const roleSeg = document.getElementById("role");
function setRole(v, rerender = true) {
  roleSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  try { localStorage.setItem("cqa-role", v); } catch {}
  if (rerender) route();
}
try { setRole(localStorage.getItem("cqa-role") || "operator", false); } catch { setRole("operator", false); }
roleSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setRole(b.dataset.v); });

// ---- Тема ----
document.getElementById("theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("cqa-theme", next); } catch {}
});

async function refreshTasksCount() {
  try {
    const r = await api.batches();
    const active = r.batches.filter((b) => !b.done).length;
    const el = document.getElementById("tasks-count");
    el.textContent = active; el.hidden = !active;
  } catch {}
}
setInterval(refreshTasksCount, 10000);
refreshTasksCount();

export async function refreshAppealsCount() {
  try {
    const n = (await api.appeals("open")).length;
    const el = document.getElementById("appeals-count");
    el.textContent = n;
    el.hidden = !n;
  } catch {}
}

function markNav(name) {
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
}

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  window.scrollTo(0, 0);
  try {
    if (hash.startsWith("/c/")) { markNav("list"); return await renderCard(decodeURIComponent(hash.slice(3))); }
    if (hash === "/checklist") { markNav("checklist"); return await renderChecklist(); }
    if (hash === "/appeals") { markNav("appeals"); return await renderAppeals(); }
    if (hash === "/start") { markNav("start"); return await renderStart(); }
    if (hash.startsWith("/analytics")) { markNav("analytics"); return await renderAnalytics(); }
    if (hash === "/tasks") { markNav("tasks"); return await renderTasks(); }
    markNav("list");
    return await renderConversations();
  } catch (e) {
    root.innerHTML = `<div class="alert bad">Ошибка: ${esc(e.message)}</div>`;
  } finally {
    refreshAppealsCount();
  }
}

window.addEventListener("hashchange", route);
if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/start");   // первый вход — «Старт»
// ---- Режим без фоновых процессов (Vercel): пока есть очередь, страница сама досчитывает её порциями ----
let pumping = false;
async function pump() {
  if (pumping) return;
  try {
    const r = await api.batches();
    if (!r.batches.some((b) => !b.done)) return;
    pumping = true;
    await api.work();
  } catch {} finally { pumping = false; }
}

api.health().then((h) => {
  if (h.serverless) setInterval(pump, 4000);
  const b = document.getElementById("mode-badge");
  b.textContent = h.evaluator_mode === "mock" ? "Тестовый оценщик" : h.model;
  b.className = "chip mode-pill " + (h.evaluator_mode === "mock" ? "warn" : "ok");
  b.title = h.evaluator_mode === "mock" ? "Оценки — тестовые ответы без модели" : "Оценки выполняет модель " + h.model;
}).catch(() => toast("Сервер недоступен", true));
route();
