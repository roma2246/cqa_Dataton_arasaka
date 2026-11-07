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
  root.querySelector("#batch").onclick = async () => {
    // TODO(F06): прогресс пакета, повтор неуспешных, отображение ошибок по диалогам
    try {
      const r = await api.startBatch({
        checklist_version_id: Number(root.querySelector("#batch-ver").value),
        conversation_ids: shown.map((c) => c.conversation_id),
      });
      toast(`Запущено оценок: ${r.evaluation_ids.length}`);
    } catch (e) { toast(e.message, true); }
  };
}
