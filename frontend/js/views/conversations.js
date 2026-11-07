// Список диалогов + импорт + пакетная оценка. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast } from "../app.js";

export async function renderConversations() {
  const [list, versions] = await Promise.all([api.conversations(), api.checklists()]);
  root.innerHTML = `
    <div class="panel">
      <h2>Импорт</h2>
      <div class="row">
        <input id="gid" placeholder="group_id (например DEV)" value="DEV">
        <button id="imp-api">Загрузить из API организаторов</button>
        <span class="muted">или</span>
        <input type="file" id="imp-file" accept=".json">
      </div>
    </div>
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2>Диалоги (${list.length})</h2>
        <div class="row">
          <select id="f-lang"><option value="">Все языки</option><option>RU</option><option>KZ</option><option>EN</option></select>
          <select id="f-chan"><option value="">Все каналы</option><option>agent chat</option><option>voice call</option></select>
          <select id="batch-ver">${versions.map((v) => `<option value="${v.version_id}">v${v.version} — ${esc(v.name)}</option>`).join("")}</select>
          <button id="batch" class="secondary">Оценить показанные</button>
        </div>
      </div>
      <table>
        <thead><tr><th>ID</th><th>Группа</th><th>Канал</th><th>Язык</th><th>Реплик</th><th>Последняя оценка</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>`;

  const draw = () => {
    const lang = root.querySelector("#f-lang").value, chan = root.querySelector("#f-chan").value;
    const shown = list.filter((c) => (!lang || c.language === lang) && (!chan || c.channel === chan));
    root.querySelector("#rows").innerHTML = shown.map((c) => `
      <tr class="clickable" data-id="${esc(c.conversation_id)}">
        <td>${esc(c.conversation_id)}</td><td>${esc(c.group_id)}</td><td>${esc(c.channel)}</td>
        <td>${esc(c.language)}</td><td>${c.message_count}</td>
        <td>${c.last_evaluation_id ? "#" + c.last_evaluation_id : '<span class="muted">нет</span>'}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted">Нет диалогов — импортируйте набор</td></tr>`;
    root.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => (location.hash = "#/c/" + encodeURIComponent(tr.dataset.id))));
    return shown;
  };
  let shown = draw();
  root.querySelector("#f-lang").onchange = root.querySelector("#f-chan").onchange = () => (shown = draw());

  root.querySelector("#imp-api").onclick = async () => {
    try {
      const r = await api.importOrganizer(root.querySelector("#gid").value.trim());
      toast(`Импорт: всего ${r.total}, новых ${r.new}, обновлено ${r.updated}, без изменений ${r.unchanged}`);
      renderConversations();
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector("#imp-file").onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const r = await api.importJson(JSON.parse(await f.text()));
      toast(`Импорт файла: всего ${r.total}, новых ${r.new}`);
      renderConversations();
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector("#batch").onclick = async (ev) => {
    if (!shown.length) return toast("Нет диалогов для оценки", true);
    if (!confirm(`Запустить оценку ${shown.length} диалогов? Каждая оценка — вызов модели.`)) return;
    ev.target.disabled = true;
    try {
      const r = await api.startBatch({
        checklist_version_id: Number(root.querySelector("#batch-ver").value),
        conversation_ids: shown.map((c) => c.conversation_id),
      });
      try { localStorage.setItem("cqa-batch", r.batch_id); } catch {}
      toast(`Пакет ${r.batch_id}: ${r.evaluation_ids.length} оценок в очереди`);
      drawBatch(r.batch_id);
    } catch (e) { toast(e.message, true); }
    ev.target.disabled = false;
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
  let box = root.querySelector("#batch-panel");
  if (!box) {
    box = document.createElement("div");
    box.id = "batch-panel";
    box.className = "panel";
    root.insertBefore(box, root.children[1] || null);
  }
  let st;
  try { st = await api.batch(batchId); }
  catch (e) { box.remove(); return; }
  if (location.hash && location.hash !== "#/") return; // ушли со страницы
  const c = st.counts, done = (c.completed || 0) + (c.failed || 0) + (c.canceled || 0);
  box.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h3>Пакет ${esc(batchId)} — ${done}/${st.total}${st.done ? " (завершён)" : ""}</h3>
      <div class="row">
        ${st.failed.length ? `<button class="secondary" id="b-retry">Повторить неуспешные (${st.failed.length})</button>` : ""}
        ${!st.done ? '<button class="secondary" id="b-cancel">Остановить новые задачи</button>' : ""}
        <button class="secondary" id="b-hide">Скрыть</button>
      </div>
    </div>
    <progress max="${st.total}" value="${done}" style="width:100%"></progress>
    <div class="muted">${Object.entries(c).map(([k, v]) => `${ST[k] || k}: ${v}`).join(" · ")}
      · попыток: ${st.attempts} · стоимость: ${st.cost_usd == null ? "—" : "$" + Number(st.cost_usd).toFixed(4)}</div>
    ${st.failed.map((f) => `<div class="st-failed"><a href="#/c/${encodeURIComponent(f.conversation_id)}">${esc(f.conversation_id)}</a>: ${esc(f.error)}</div>`).join("")}`;
  box.querySelector("#b-retry")?.addEventListener("click", async () => {
    try { const r = await api.batchRetry(batchId); toast(`Повтор: ${r.retried}`); drawBatch(batchId); }
    catch (e) { toast(e.message, true); }
  });
  box.querySelector("#b-cancel")?.addEventListener("click", async () => {
    try { const r = await api.batchCancel(batchId); toast(`Отменено задач в очереди: ${r.canceled}`); drawBatch(batchId); }
    catch (e) { toast(e.message, true); }
  });
  box.querySelector("#b-hide").addEventListener("click", () => {
    try { localStorage.removeItem("cqa-batch"); } catch {}
    box.remove();
  });
  if (!st.done) batchTimer = setTimeout(() => drawBatch(batchId), 2000);
}
