// Редактор чек-листа: любое количество критериев, сохранение = новая неизменяемая версия. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, chip } from "../app.js";

let draft = null;
let dirty = false;

const TYPES = { yes_no: "Да / Нет", single_choice: "Выбор варианта", scale: "Шкала" };
const DEFAULT_OPTS = {
  yes_no: [{ value: "yes", label: "Да", score: 1 }, { value: "no", label: "Нет", score: 0 }],
  single_choice: [{ value: "yes", label: "Да", score: 1 }, { value: "partial", label: "Частично", score: 0.5 }, { value: "no", label: "Нет", score: 0 }],
};

export async function renderChecklist() {
  const versions = await api.checklists();
  if (!draft) { draft = structuredClone(versions[0] || { checklist_id: "main", name: "Новый чек-лист", rules: {}, sections: [], criteria: [] }); dirty = false; }
  const baseVersion = draft.version;
  ["version_id", "version", "created_at"].forEach((k) => delete draft[k]);
  draft.rules ||= {};

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Чек-лист</h1>
        <div class="muted">Сохранение создаёт новую версию — старые оценки остаются привязаны к своей</div>
      </div>
      <div class="toolbar">
        <select id="load" aria-label="Версия">${versions.map((v) => `<option value="${v.version_id}">v${v.version} · ${esc(v.name)} · ${v.criteria.length} крит.</option>`).join("")}</select>
        <button class="btn" id="load-btn">Открыть версию</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Общие настройки</h2>
        ${baseVersion ? chip(`основано на v${baseVersion}`, "plain") : ""}</div>
      <div class="crit-edit">
        <label class="field c6">Название<input id="name" value="${esc(draft.name)}"></label>
        <label class="field c2">Округление, знаков<input id="rd" type="number" min="0" max="6" value="${draft.rules.rounding_digits ?? 2}"></label>
        <label class="field c4">Грубая ошибка
          <select id="cp"><option value="flag_only">Только отметка</option><option value="zero_total">Итог = 0</option></select></label>
        <label class="check c12"><input type="checkbox" id="official" ${draft.is_official ? "checked" : ""}> Официальный чек-лист организаторов</label>
      </div>
    </div>

    <div id="crits" class="stack" style="gap:12px"></div>

    <div class="sticky-bar">
      <button class="btn" id="add">+ Критерий</button>
      <span class="subtle" id="sum"></span>
      <span class="spacer"></span>
      <span class="subtle" id="dirty-note"></span>
      <button class="btn btn-primary" id="save">Сохранить как новую версию</button>
    </div>`;
  root.querySelector("#cp").value = draft.rules.critical_policy || "flag_only";

  const markDirty = () => { dirty = true; updateBar(); };
  const updateBar = () => {
    const w = draft.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
    root.querySelector("#sum").innerHTML = `${draft.criteria.length} критериев · сумма весов <b class="weight-sum">${w}</b>`;
    root.querySelector("#dirty-note").textContent = dirty ? "Есть несохранённые изменения" : "";
  };

  const crits = root.querySelector("#crits");
  const draw = () => {
    crits.innerHTML = draft.criteria.map((c, i) => `
      <section class="card" data-i="${i}">
        <div class="crit-edit-head">
          <span class="idx">${i + 1}</span>
          <div class="stack" style="gap:0;min-width:0">
            <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title || "Без названия")}</b>
            <span class="subtle mono">${esc(c.criterion_id)}</span>
          </div>
          <span class="spacer"></span>
          ${c.is_critical ? chip("грубая ошибка", "bad plain") : ""}
          ${c.na_allowed ? chip("N/A", "plain") : ""}
          ${c.required_evidence === "audio" ? chip("нужен звук", "warn plain") : ""}
          <button class="btn btn-ghost btn-sm btn-danger del" aria-label="Удалить критерий ${i + 1}">Удалить</button>
        </div>
        <div class="crit-edit">
          <label class="field c3">ID критерия<input data-k="criterion_id" value="${esc(c.criterion_id)}" class="mono"></label>
          <label class="field c9" style="grid-column: span 9">Название<input data-k="title" value="${esc(c.title)}"></label>
          <label class="field c12">Инструкция оценщику — что считать выполнением, исключения
            <textarea data-k="instruction">${esc(c.instruction)}</textarea></label>
          <label class="field c2">Вес<input type="number" min="0" step="any" data-k="weight" value="${c.weight}"></label>
          <label class="field c3">Тип ответа<select data-k="answer_type">
            ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${c.answer_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label class="field c3">Секция<input data-k="section_id" value="${esc(c.section_id || "")}" placeholder="необязательно"></label>
          <label class="field c4">Доказательство<select data-k="required_evidence">
            <option value="text" ${c.required_evidence !== "audio" ? "selected" : ""}>Текст транскрипта</option>
            <option value="audio" ${c.required_evidence === "audio" ? "selected" : ""}>Нужен звук (дикция, интонация)</option></select></label>
          ${c.answer_type === "scale" ? `
            <label class="field c2">Шкала от<input type="number" data-k="scale.min" value="${c.scale?.min ?? 1}"></label>
            <label class="field c2">до<input type="number" data-k="scale.max" value="${c.scale?.max ?? 5}"></label>
            <div class="c8 subtle" style="grid-column: span 8;align-self:end">Балл = (ответ − мин) / (макс − мин). Если в официальных правилах иначе — уточнить.</div>`
          : `<div class="c12 stack" style="gap:6px">
              <div class="subtle">Варианты ответа: значение · подпись · балл от 0 до 1</div>
              ${(c.options || []).map((o, j) => `
                <div class="row" data-j="${j}">
                  <input data-o="value" value="${esc(o.value)}" class="mono" style="width:130px" aria-label="Значение">
                  <input data-o="label" value="${esc(o.label)}" style="flex:1;min-width:120px" aria-label="Подпись">
                  <input data-o="score" type="number" min="0" max="1" step="0.05" value="${o.score}" style="width:90px" aria-label="Балл">
                  <button class="btn btn-ghost btn-sm del-opt" aria-label="Удалить вариант">✕</button>
                </div>`).join("")}
              <div><button class="btn btn-sm add-opt">+ Вариант</button></div>
            </div>`}
          <div class="c12 row" style="gap:18px">
            <label class="check"><input type="checkbox" data-k="na_allowed" ${c.na_allowed ? "checked" : ""}> N/A разрешён</label>
            <label class="check"><input type="checkbox" data-k="is_critical" ${c.is_critical ? "checked" : ""}> Грубая ошибка</label>
          </div>
          ${c.na_allowed ? `<label class="field c6">Когда N/A допустим<input data-k="na_rule" value="${esc(c.na_rule || "")}"></label>` : ""}
          ${c.is_critical ? `<label class="field c6">Ответы, означающие грубую ошибку (через запятую)<input data-k="critical_values" value="${esc((c.critical_values || []).join(", "))}" class="mono"></label>` : ""}
        </div>
      </section>`).join("") || '<div class="card empty">Критериев нет — добавьте первый</div>';

    crits.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("change", () => {
      const c = draft.criteria[el.closest("[data-i]").dataset.i], k = el.dataset.k;
      const v = el.type === "checkbox" ? el.checked : el.value;
      if (k === "weight") c.weight = Number(v);
      else if (k === "scale.min" || k === "scale.max") { c.scale ||= { min: 1, max: 5, step: 1 }; c.scale[k.split(".")[1]] = Number(v); }
      else if (k === "critical_values") c.critical_values = v.split(",").map((s) => s.trim()).filter(Boolean);
      else if (k === "section_id") c.section_id = v || null;
      else c[k] = v;
      if (k === "answer_type") {
        if (v === "scale") c.scale ||= { min: 1, max: 5, step: 1 };
        else if (!c.options?.length || v === "yes_no") c.options = structuredClone(DEFAULT_OPTS[v]);
      }
      markDirty();
      if (["answer_type", "na_allowed", "is_critical", "title", "criterion_id", "required_evidence"].includes(k)) draw();
    }));
    crits.querySelectorAll("[data-o]").forEach((el) => el.addEventListener("change", () => {
      const c = draft.criteria[el.closest("[data-i]").dataset.i];
      const o = c.options[el.closest("[data-j]").dataset.j];
      o[el.dataset.o] = el.dataset.o === "score" ? Math.max(0, Math.min(1, Number(el.value))) : el.value.trim();
      markDirty();
    }));
    crits.querySelectorAll(".add-opt").forEach((b) => b.addEventListener("click", () => {
      const c = draft.criteria[b.closest("[data-i]").dataset.i];
      (c.options ||= []).push({ value: "opt" + (c.options.length + 1), label: "Вариант", score: 0 });
      markDirty(); draw();
    }));
    crits.querySelectorAll(".del-opt").forEach((b) => b.addEventListener("click", () => {
      const c = draft.criteria[b.closest("[data-i]").dataset.i];
      c.options.splice(Number(b.closest("[data-j]").dataset.j), 1);
      markDirty(); draw();
    }));
    crits.querySelectorAll(".del").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.closest("[data-i]").dataset.i);
      if (!confirm(`Удалить критерий «${draft.criteria[i].title}»? Это изменит только новую версию.`)) return;
      draft.criteria.splice(i, 1);
      markDirty(); draw();
    }));
    updateBar();
  };
  draw();

  root.querySelector("#name").onchange = (e) => { draft.name = e.target.value; markDirty(); };
  root.querySelector("#official").onchange = (e) => { draft.is_official = e.target.checked; markDirty(); };
  root.querySelector("#rd").onchange = (e) => { draft.rules.rounding_digits = Number(e.target.value); markDirty(); };
  root.querySelector("#cp").onchange = (e) => { draft.rules.critical_policy = e.target.value; markDirty(); };

  root.querySelector("#add").onclick = () => {
    let n = draft.criteria.length + 1;
    while (draft.criteria.some((c) => c.criterion_id === "criterion_" + n)) n++;
    draft.criteria.push({
      criterion_id: "criterion_" + n, title: "Новый критерий", instruction: "",
      weight: 10, answer_type: "yes_no", section_id: null, options: structuredClone(DEFAULT_OPTS.yes_no),
      na_allowed: false, is_critical: false, critical_values: [], required_evidence: "text",
    });
    markDirty(); draw();
    crits.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
    crits.lastElementChild?.querySelector('[data-k="title"]')?.select();
  };
  root.querySelector("#load-btn").onclick = () => {
    if (dirty && !confirm("Несохранённые изменения пропадут. Продолжить?")) return;
    draft = structuredClone(versions.find((v) => v.version_id === Number(root.querySelector("#load").value)));
    dirty = false;
    renderChecklist();
  };
  root.querySelector("#save").onclick = async (e) => {
    const ids = draft.criteria.map((c) => c.criterion_id.trim());
    if (!ids.length) return toast("Добавьте хотя бы один критерий", true);
    if (ids.some((x) => !x)) return toast("У каждого критерия должен быть ID", true);
    if (new Set(ids).size !== ids.length) return toast("ID критериев должны быть уникальны", true);
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const v = await api.saveChecklist(draft);
      toast(`Сохранена версия v${v.version}. Её можно выбрать при оценке.`);
      draft = null;
      renderChecklist();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}
