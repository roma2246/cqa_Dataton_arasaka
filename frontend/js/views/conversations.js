// Список диалогов + импорт + пакетная оценка. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, chip, scoreBar, pct, EVAL_STATUS, CHANNEL } from "../app.js";

const state = { lang: "", chan: "", status: "", q: "" };

export async function renderConversations() {
  const [list, versions, openAppeals] = await Promise.all([api.conversations(), api.checklists(), api.appeals("open")]);
  const evaluated = list.filter((c) => c.last_status === "completed");
  const totals = evaluated.map((c) => c.last_total).filter((v) => v !== null && v !== undefined);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const langs = [...new Set(list.map((c) => c.language))].sort();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Диалоги</h1>
        <div class="muted">Импорт, оценка оператора по чек-листу и переход к результатам</div>
      </div>
      <div class="toolbar">
        <input id="gid" value="DEV" aria-label="group_id" style="width:110px" placeholder="group_id">
        <button class="btn" id="imp-api">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          Загрузить из API</button>
        <label class="btn file-btn">Из файла JSON<input type="file" id="imp-file" accept=".json,application/json"></label>
      </div>
    </div>

    <div class="kpis">
      <div class="card kpi"><div class="kpi-label">Диалогов</div><div class="kpi-value">${list.length}</div>
        <div class="kpi-sub">${list.filter((c) => c.channel === "voice call").length} звонков · ${langs.join(" / ") || "—"}</div></div>
      <div class="card kpi"><div class="kpi-label">Оценено</div><div class="kpi-value">${evaluated.length}</div>
        <div class="kpi-sub">${list.length ? Math.round((100 * evaluated.length) / list.length) : 0}% набора</div></div>
      <div class="card kpi"><div class="kpi-label">Средний итог</div><div class="kpi-value">${avg === null ? "—" : pct(avg)}</div>
        <div class="kpi-sub">по ${totals.length} оценкам с итогом</div></div>
      <div class="card kpi"><div class="kpi-label">Открытые апелляции</div><div class="kpi-value">${openAppeals.length}</div>
        <div class="kpi-sub"><a href="#/appeals">к очереди →</a></div></div>
    </div>

    <div id="batch-slot"></div>

    <div class="card">
      <div class="card-head">
        <div class="row">
          <div class="seg" id="f-lang" role="group" aria-label="Язык">
            <button data-v="" aria-pressed="true">Все</button>
            ${langs.map((l) => `<button data-v="${esc(l)}" aria-pressed="false">${esc(l)}</button>`).join("")}
          </div>
          <select id="f-chan" aria-label="Канал"><option value="">Все каналы</option><option value="agent chat">Чаты</option><option value="voice call">Звонки</option></select>
          <select id="f-status" aria-label="Статус оценки">
            <option value="">Любой статус</option><option value="none">Без оценки</option>
            <option value="completed">Оценены</option><option value="failed">С ошибкой</option><option value="appeal">С апелляцией</option>
          </select>
          <input id="f-q" type="search" placeholder="Поиск по ID" aria-label="Поиск по ID" style="width:150px">
        </div>
        <div class="row">
          <select id="batch-ver" aria-label="Версия чек-листа">${versions.map((v) => `<option value="${v.version_id}">v${v.version} · ${esc(v.name)}</option>`).join("")}</select>
          <button id="batch" class="btn btn-primary"><span id="shown-n">Оценить показанные</span></button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Диалог</th><th>Канал</th><th>Язык</th><th>Реплик</th><th>Итог</th><th>Статус</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>`;

  // восстановить фильтры
  root.querySelector("#f-chan").value = state.chan;
  root.querySelector("#f-status").value = state.status;
  root.querySelector("#f-q").value = state.q;
  root.querySelectorAll("#f-lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.lang)));

  let shown = [];
  const draw = () => {
    shown = list.filter((c) =>
      (!state.lang || c.language === state.lang) && (!state.chan || c.channel === state.chan)
      && (!state.q || c.conversation_id.toLowerCase().includes(state.q.toLowerCase()))
      && (!state.status || (state.status === "none" ? !c.last_status
        : state.status === "appeal" ? c.open_appeals > 0 : c.last_status === state.status)));
    root.querySelector("#shown-n").textContent = `Оценить показанные (${shown.length})`;
    root.querySelector("#rows").innerHTML = shown.map((c) => {
      const st = c.last_status ? EVAL_STATUS[c.last_status] : null;
      return `
      <tr class="clickable" data-id="${esc(c.conversation_id)}" tabindex="0">
        <td><span class="mono">${esc(c.conversation_id)}</span>
          ${c.last_mode === "mock" ? ' <span class="tag" title="Оценка тестовым оценщиком">ТЕСТ</span>' : ""}</td>
        <td>${esc(CHANNEL[c.channel] || c.channel)}</td>
        <td><span class="tag">${esc(c.language)}</span></td>
        <td class="num">${c.message_count}</td>
        <td>${c.last_status === "completed" ? scoreBar(c.last_total) : '<span class="subtle">—</span>'}
          ${c.last_critical ? ' <span class="chip bad plain" title="Грубая ошибка">!</span>' : ""}</td>
        <td>${st ? chip(st[0], st[1]) : '<span class="subtle">Не оценён</span>'}
          ${c.open_appeals ? chip(`Апелляций: ${c.open_appeals}`, "warn") : ""}</td>
        <td style="text-align:right;color:var(--text-3)">›</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="empty">${list.length ? "Ничего не найдено по фильтрам" : "Диалогов нет — загрузите набор из API или файла"}</td></tr>`;
    root.querySelectorAll("tr[data-id]").forEach((tr) => {
      const go = () => (location.hash = "#/c/" + encodeURIComponent(tr.dataset.id));
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
  };
  draw();

  root.querySelector("#f-lang").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.lang = b.dataset.v;
    root.querySelectorAll("#f-lang button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });
  root.querySelector("#f-chan").onchange = (e) => { state.chan = e.target.value; draw(); };
  root.querySelector("#f-status").onchange = (e) => { state.status = e.target.value; draw(); };
  root.querySelector("#f-q").oninput = (e) => { state.q = e.target.value.trim(); draw(); };

  root.querySelector("#imp-api").onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api.importOrganizer(root.querySelector("#gid").value.trim());
      toast(`Импорт: всего ${r.total}, новых ${r.new}, обновлено ${r.updated}, без изменений ${r.unchanged}`);
      renderConversations();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  root.querySelector("#imp-file").onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const r = await api.importJson(JSON.parse(await f.text()));
      toast(`Импорт файла: всего ${r.total}, новых ${r.new}, обновлено ${r.updated}`);
      renderConversations();
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector("#batch").onclick = async (ev) => {
    if (!shown.length) return toast("Нет диалогов для оценки", true);
    if (!confirm(`Запустить оценку ${shown.length} диалогов? Каждая оценка — вызов модели.`)) return;
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api.startBatch({
        checklist_version_id: Number(root.querySelector("#batch-ver").value),
        conversation_ids: shown.map((c) => c.conversation_id),
      });
      try { localStorage.setItem("cqa-batch", r.batch_id); } catch {}
      toast(`Пакет запущен: ${r.evaluation_ids.length} оценок в очереди`);
      drawBatch(r.batch_id);
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };

  let lastBatch = null;
  try { lastBatch = localStorage.getItem("cqa-batch"); } catch {}
  if (lastBatch) drawBatch(lastBatch);
}

// ---- Прогресс пакета (F06) ----
let batchTimer = null;
const ST = { queued: "в очереди", running: "выполняется", completed: "готово", failed: "ошибка", canceled: "отменено" };

async function drawBatch(batchId) {
  clearTimeout(batchTimer);
  const slot = root.querySelector("#batch-slot");
  if (!slot) return;
  let st;
  try { st = await api.batch(batchId); }
  catch { slot.innerHTML = ""; try { localStorage.removeItem("cqa-batch"); } catch {} return; }
  if (location.hash && location.hash !== "#/") return; // ушли со страницы
  const c = st.counts, done = (c.completed || 0) + (c.failed || 0) + (c.canceled || 0);
  slot.innerHTML = `
    <div class="card card-pad stack">
      <div class="row">
        ${st.done ? "" : '<span class="spin" aria-hidden="true"></span>'}
        <h2>${st.done ? "Пакет завершён" : "Идёт оценка пакета"}</h2>
        <span class="muted">${done} из ${st.total}</span>
        <span class="spacer"></span>
        ${st.failed.length ? `<button class="btn btn-sm" id="b-retry">Повторить неуспешные (${st.failed.length})</button>` : ""}
        ${!st.done ? '<button class="btn btn-sm" id="b-cancel">Остановить очередь</button>' : ""}
        <button class="btn btn-ghost btn-sm" id="b-hide">Скрыть</button>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${done}"><i style="width:${st.total ? (100 * done) / st.total : 0}%"></i></div>
      <div class="subtle">${Object.entries(c).map(([k, v]) => `${ST[k] || k}: ${v}`).join(" · ")}
        · попыток: ${st.attempts} · стоимость: ${st.cost_usd == null ? "—" : "$" + Number(st.cost_usd).toFixed(4)}</div>
      ${st.failed.map((f) => `<div class="alert bad"><a href="#/c/${encodeURIComponent(f.conversation_id)}" class="mono">${esc(f.conversation_id)}</a> ${esc(f.error)}</div>`).join("")}
    </div>`;
  slot.querySelector("#b-retry")?.addEventListener("click", async () => {
    try { const r = await api.batchRetry(batchId); toast(`Повтор: ${r.retried}`); drawBatch(batchId); }
    catch (e) { toast(e.message, true); }
  });
  slot.querySelector("#b-cancel")?.addEventListener("click", async () => {
    try { const r = await api.batchCancel(batchId); toast(`Отменено задач в очереди: ${r.canceled}`); drawBatch(batchId); }
    catch (e) { toast(e.message, true); }
  });
  slot.querySelector("#b-hide").addEventListener("click", () => {
    try { localStorage.removeItem("cqa-batch"); } catch {}
    slot.innerHTML = "";
  });
  if (!st.done) batchTimer = setTimeout(() => drawBatch(batchId), 2000);
  else if (done && st.items.some((i) => i.status === "completed")) {
    // обновить таблицу один раз после завершения
    if (!drawBatch._refreshed?.has(batchId)) { (drawBatch._refreshed ||= new Set()).add(batchId); renderConversations(); }
  }
}
