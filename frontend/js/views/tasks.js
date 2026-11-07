// «Задачи»: что сейчас считается, сколько осталось, последние оценки, графики качества. Обновляется сама.
import { api } from "../api.js";
import { root, esc, chip, pct, EVAL_STATUS } from "../app.js";

let timer = null;
const ST = { queued: "в очереди", running: "выполняется", completed: "готово", failed: "ошибка", canceled: "отменено" };
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—");

function eta(b) {
  const c = b.counts, done = (c.completed || 0) + (c.failed || 0) + (c.canceled || 0);
  if (b.done || !done || !b.started || !b.last_finished) return "";
  const spent = (new Date(b.last_finished) - new Date(b.started)) / 1000;
  const left = Math.round(((spent / done) * (b.total - done)) / 60);
  return left > 0 ? ` · осталось ≈ ${left} мин` : "";
}

export async function renderTasks() {
  clearTimeout(timer);
  const r = await api.batches();
  if (location.hash !== "#/tasks") return;
  const active = r.batches.filter((b) => !b.done);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Задачи</h1>
        <div class="muted">Что сейчас оценивает модель. Страница обновляется сама каждые 3 секунды.
          ${r.serverless ? "На этом сервере пакеты считаются, пока открыт сайт — не закрывайте вкладку до конца пакета." : ""}</div></div>
      <div class="row">
        ${chip(r.evaluator.mode === "real" ? `Модель: ${r.evaluator.model}${r.evaluator.think ? "" : " · быстрый режим"}` : "Тестовый оценщик", r.evaluator.mode === "real" ? "ok" : "warn")}
        <a class="btn" href="/reports/progress_official.html" target="_blank" rel="noopener">График качества ↗</a>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Пакеты оценки</h2><span class="subtle">${active.length ? `идёт: ${active.length}` : "сейчас ничего не идёт"}</span></div>
      <div class="card-pad stack" style="gap:14px">
        ${r.batches.map((b) => {
          const c = b.counts, done = (c.completed || 0) + (c.failed || 0) + (c.canceled || 0);
          return `<div class="stack" style="gap:6px">
            <div class="row">
              ${b.done ? chip("завершён", "ok") : '<span class="spin" aria-hidden="true"></span>'}
              <b>${done} из ${b.total}</b><span class="subtle">старт ${t(b.started)}${eta(b)}</span>
              <span class="spacer"></span><span class="subtle mono">${esc(b.batch_id)}</span>
            </div>
            <div class="progress"><i style="width:${b.total ? (100 * done) / b.total : 0}%"></i></div>
            <div class="subtle">${esc(b.checklist)} · ${Object.entries(c).map(([k, v]) => `${ST[k] || k}: ${v}`).join(" · ")}</div>
          </div>`;
        }).join("") || '<div class="empty">Пакетов ещё не было</div>'}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Последние оценки</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Время</th><th>Диалог</th><th>Статус</th><th>Итог</th><th>Модель</th></tr></thead>
        <tbody>${r.recent.map((e) => {
          const st = EVAL_STATUS[e.status] || [e.status, ""];
          return `<tr class="clickable" data-id="${esc(e.conversation_id)}"><td class="num">${t(e.finished_at)}</td>
            <td class="mono">${esc(e.conversation_id)}</td><td>${chip(st[0], st[1])}${e.critical ? " " + chip("грубая ошибка", "bad") : ""}</td>
            <td class="num">${e.total == null ? "—" : pct(e.total)}</td><td class="subtle">${esc(e.error ? e.error.slice(0, 60) : e.model || "")}</td></tr>`;
        }).join("") || '<tr><td colspan="5" class="empty">Пока пусто</td></tr>'}</tbody>
      </table></div>
    </div>`;
  root.querySelectorAll("tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () => (location.hash = "#/c/" + encodeURIComponent(tr.dataset.id))));
  timer = setTimeout(renderTasks, 3000);
}
