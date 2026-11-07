// Редактор чек-листа: любое количество критериев, сохранение = новая версия. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast } from "../app.js";

let draft = null;

export async function renderChecklist() {
  const versions = await api.checklists();
  if (!draft) draft = structuredClone(versions[0] || { checklist_id: "main", name: "Новый", rules: {}, sections: [], criteria: [] });
  ["version_id", "version", "created_at"].forEach((k) => delete draft[k]);

  root.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2>Чек-лист</h2>
        <div class="row">
          <select id="load">${versions.map((v) => `<option value="${v.version_id}">v${v.version} — ${esc(v.name)} (${v.criteria.length} крит.)</option>`).join("")}</select>
          <button class="secondary" id="load-btn">Загрузить версию в редактор</button>
        </div>
      </div>
      <div class="row">
        <label>Название <input id="name" value="${esc(draft.name)}" size="50"></label>
        <label><input type="checkbox" id="official" ${draft.is_official ? "checked" : ""}> официальный</label>
        <label>Округление, знаков <input id="rd" type="number" min="0" max="6" value="${draft.rules?.rounding_digits ?? 2}" style="width:60px"></label>
        <label>Грубая ошибка
          <select id="cp"><option value="flag_only">только пометка</option><option value="zero_total">итог = 0</option></select></label>
      </div>
    </div>
    <div id="crits"></div>
    <div class="row">
      <button class="secondary" id="add">+ Добавить критерий</button>
      <button id="save">Сохранить как новую версию</button>
    </div>`;
  root.querySelector("#cp").value = draft.rules?.critical_policy || "flag_only";

  const crits = root.querySelector("#crits");
  const draw = () => {
    crits.innerHTML = draft.criteria.map((c, i) => `
      <div class="panel" data-i="${i}">
        <div class="crit-edit">
          <label>criterion_id <input data-k="criterion_id" value="${esc(c.criterion_id)}"></label>
          <label class="wide">Название <input data-k="title" value="${esc(c.title)}"></label>
          <label class="wide">Инструкция оценщику <textarea data-k="instruction">${esc(c.instruction)}</textarea></label>
          <label>Вес <input type="number" min="0" step="any" data-k="weight" value="${c.weight}"></label>
          <label>Секция <input data-k="section_id" value="${esc(c.section_id || "")}"></label>
          <label>Тип ответа <select data-k="answer_type">
            ${["yes_no", "single_choice", "scale"].map((t) => `<option ${c.answer_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          ${c.answer_type === "scale"
            ? `<label>Шкала мин <input type="number" data-k="scale.min" value="${c.scale?.min ?? 1}"></label>
               <label>Шкала макс <input type="number" data-k="scale.max" value="${c.scale?.max ?? 5}"></label>`
            : `<label class="wide">Варианты (value:подпись:балл 0..1, через ;)
                 <input data-k="options" value="${esc((c.options || []).map((o) => `${o.value}:${o.label}:${o.score}`).join("; "))}"></label>`}
          <label><span><input type="checkbox" data-k="na_allowed" ${c.na_allowed ? "checked" : ""}> N/A разрешён</span></label>
          <label class="wide">Правило N/A <input data-k="na_rule" value="${esc(c.na_rule || "")}"></label>
          <label><span><input type="checkbox" data-k="is_critical" ${c.is_critical ? "checked" : ""}> Грубая ошибка</span></label>
          <label>Ответы = грубая ошибка (через ,) <input data-k="critical_values" value="${esc((c.critical_values || []).join(","))}"></label>
          <label>Нужен звук <select data-k="required_evidence">
            <option value="text" ${c.required_evidence !== "audio" ? "selected" : ""}>нет (текст)</option>
            <option value="audio" ${c.required_evidence === "audio" ? "selected" : ""}>да (audio)</option></select></label>
        </div>
        <button class="secondary del">Удалить критерий</button>
      </div>`).join("");

    crits.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("change", () => {
      const c = draft.criteria[el.closest("[data-i]").dataset.i], k = el.dataset.k;
      const v = el.type === "checkbox" ? el.checked : el.value;
      if (k === "weight") c.weight = Number(v);
      else if (k === "scale.min" || k === "scale.max") { c.scale ||= { min: 1, max: 5, step: 1 }; c.scale[k.split(".")[1]] = Number(v); }
      else if (k === "options") c.options = v.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [value, label, score] = s.split(":").map((x) => x.trim());
        return { value, label: label || value, score: Number(score ?? 0) };
      });
      else if (k === "critical_values") c.critical_values = v.split(",").map((s) => s.trim()).filter(Boolean);
      else if (k === "section_id") c.section_id = v || null;
      else c[k] = v;
      if (k === "answer_type") {
        if (v === "scale") c.scale ||= { min: 1, max: 5, step: 1 };
        else if (!c.options?.length) c.options = [{ value: "yes", label: "Да", score: 1 }, { value: "no", label: "Нет", score: 0 }];
        draw();
      }
    }));
    crits.querySelectorAll(".del").forEach((b) => b.addEventListener("click", () => {
      draft.criteria.splice(Number(b.closest("[data-i]").dataset.i), 1);
      draw();
    }));
  };
  draw();

  root.querySelector("#add").onclick = () => {
    draft.criteria.push({
      criterion_id: "new_" + (draft.criteria.length + 1), title: "Новый критерий", instruction: "",
      weight: 10, answer_type: "yes_no", section_id: null,
      options: [{ value: "yes", label: "Да", score: 1 }, { value: "no", label: "Нет", score: 0 }],
      na_allowed: false, is_critical: false, critical_values: [], required_evidence: "text",
    });
    draw();
  };
  root.querySelector("#load-btn").onclick = () => {
    draft = structuredClone(versions.find((v) => v.version_id === Number(root.querySelector("#load").value)));
    renderChecklist();
  };
  root.querySelector("#save").onclick = async () => {
    draft.name = root.querySelector("#name").value;
    draft.is_official = root.querySelector("#official").checked;
    draft.rules = { ...(draft.rules || {}), rounding_digits: Number(root.querySelector("#rd").value),
                    critical_policy: root.querySelector("#cp").value };
    try {
      const v = await api.saveChecklist(draft);
      toast(`Сохранена версия v${v.version} (id ${v.version_id})`);
      draft = null;
      renderChecklist();
    } catch (e) { toast(e.message, true); }
  };
}
