// Очередь апелляций и решение проверяющего. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, role, chip, pct, STATUS_LABEL, SPEAKER, refreshAppealsCount } from "../app.js";

let filter = "open";

export async function renderAppeals() {
  const all = await api.appeals();
  const isReviewer = role() === "reviewer";
  const counts = { open: 0, done: 0 };
  all.forEach((a) => (a.status === "open" ? counts.open++ : counts.done++));
  const list = all.filter((a) => (filter === "open" ? a.status === "open" : filter === "done" ? a.status !== "open" : true));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Апелляции</h1>
        <div class="muted">Проверяющий видит спорную оценку, комментарий и фрагмент диалога, затем подтверждает или меняет её</div>
      </div>
      <div class="seg" id="af" role="group" aria-label="Фильтр">
        <button data-v="open" aria-pressed="${filter === "open"}">Открытые · ${counts.open}</button>
        <button data-v="done" aria-pressed="${filter === "done"}">Решённые · ${counts.done}</button>
        <button data-v="all" aria-pressed="${filter === "all"}">Все</button>
      </div>
    </div>
    ${isReviewer ? "" : `<div class="alert info">Принимать решения может роль «Проверяющий» — переключатель в меню слева.
      <button class="btn btn-sm" id="to-reviewer" style="margin-left:auto">Стать проверяющим</button></div>`}
    <div id="items" class="stack" style="gap:16px">${list.length ? "" : `<div class="card empty">${filter === "open" ? "Открытых апелляций нет" : "Пусто"}</div>`}</div>`;

  root.querySelector("#af").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.v; renderAppeals();
  });
  root.querySelector("#to-reviewer")?.addEventListener("click", () => document.querySelector('#role [data-v="reviewer"]').click());

  const box = root.querySelector("#items");
  const cache = {};
  for (const a of list) {
    const ev = await api.evaluation(a.evaluation_id);
    const chk = cache[ev.checklist_version_id] ||= await api.checklist(ev.checklist_version_id);
    const conv = cache["c:" + a.conversation_id] ||= await api.conversation(a.conversation_id);
    if (!location.hash.startsWith("#/appeals")) return;
    const c = chk.criteria.find((x) => x.criterion_id === a.criterion_id) || { title: a.criterion_id, options: [] };
    const r = ev.final_results.find((x) => x.criterion_id === a.criterion_id);
    const ai = ev.ai_results.find((x) => x.criterion_id === a.criterion_id);
    const label = (x) => (x.status === "applicable" ? (c.options?.find((o) => o.value === x.answer)?.label ?? x.answer) : STATUS_LABEL[x.status]);
    const answers = c.answer_type === "scale"
      ? Array.from({ length: c.scale.max - c.scale.min + 1 }, (_, i) => ({ value: String(c.scale.min + i), label: String(c.scale.min + i) }))
      : c.options;
    // фрагменты-доказательства (или проверенный диапазон, не более 6 реплик)
    let ids = r.evidence_message_ids;
    if (!ids.length && r.checked_range) {
      const from = conv.messages.findIndex((m) => m.message_id === r.checked_range.from_message_id);
      const to = conv.messages.findIndex((m) => m.message_id === r.checked_range.to_message_id);
      ids = conv.messages.slice(from, Math.min(to + 1, from + 6)).map((m) => m.message_id);
    }
    const quotes = ids.map((id) => conv.messages.find((m) => m.message_id === id)).filter(Boolean);
    const decision = ev.appeals.find((x) => x.appeal_id === a.appeal_id);

    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <div class="card-head">
        <div class="stack" style="gap:2px">
          <div class="row"><h2>${esc(c.title)}</h2>
            ${chip(a.status === "open" ? "Открыта" : a.status === "changed" ? "Оценка изменена" : "Оценка подтверждена", a.status === "open" ? "warn" : a.status === "changed" ? "accent" : "ok")}</div>
          <div class="subtle">Апелляция #${a.appeal_id} · <a href="#/c/${encodeURIComponent(a.conversation_id)}" class="mono">${esc(a.conversation_id)}</a>
            · оценка #${a.evaluation_id} · итог ${ev.final_score.total === null ? "—" : pct(ev.final_score.total)}</div>
        </div>
      </div>
      <div class="appeal-grid">
        <div class="stack" style="gap:10px">
          <div><div class="subtle">Оценка ИИ</div>
            <div class="row" style="margin-top:2px">${chip(label(ai), ai.status === "needs_review" ? "warn" : "plain")}</div>
            <div style="margin-top:6px">${esc(ai.explanation)}</div></div>
          <div><div class="subtle">Комментарий пользователя</div><div class="quote">«${esc(a.comment)}»</div></div>
          <div><div class="subtle">${r.evidence_message_ids.length ? "Доказательства" : "Проверенный участок"}</div>
            <div class="stack" style="gap:6px;margin-top:4px">
              ${quotes.map((m) => `<div class="quote ${esc(m.speaker)}"><div class="meta">${esc(SPEAKER[m.speaker] || m.speaker)} · <span class="mono">${esc(m.message_id)}</span></div>${esc(m.text)}</div>`).join("")
                || '<span class="subtle">Нет ссылок на реплики</span>'}
            </div></div>
        </div>
        <div>
          ${a.status !== "open" ? `<div class="decision">
              <div class="subtle">Решение проверяющего</div>
              <dl class="diff"><dt>ИИ</dt><dd>${esc(label({ status: decision?.old_status, answer: decision?.old_answer }))}</dd>
                <dt>Итог</dt><dd>${esc(label(r))}</dd></dl>
              <div><b>Причина:</b> ${esc(decision?.decision_reason || "")}</div>
            </div>`
          : isReviewer ? `<form class="decision" novalidate>
              <div class="seg act" role="group" aria-label="Решение">
                <button type="button" data-v="confirm" aria-pressed="true">Подтвердить</button>
                <button type="button" data-v="change" aria-pressed="false">Изменить оценку</button>
              </div>
              <div class="row change-fields" hidden>
                <label class="field">Статус
                  <select class="new-status"><option value="applicable">Оценён</option>${c.na_allowed ? '<option value="not_applicable">N/A</option>' : ""}</select></label>
                <label class="field">Ответ
                  <select class="new-answer">${answers.map((o) => `<option value="${esc(o.value)}" ${o.value === r.answer ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
              </div>
              <label class="field">Причина решения (обязательно)<textarea class="reason" placeholder="Например: оператор назвал срок в m006"></textarea></label>
              <div class="row" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">Сохранить решение</button></div>
            </form>`
          : `<div class="decision"><span class="muted">Ожидает решения проверяющего.</span></div>`}
        </div>
      </div>`;
    box.appendChild(el);

    const form = el.querySelector("form");
    if (!form) continue;
    let action = "confirm";
    form.querySelector(".act").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      action = b.dataset.v;
      form.querySelectorAll(".act button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      form.querySelector(".change-fields").hidden = action !== "change";
    });
    form.querySelector(".new-status").addEventListener("change", (e) => {
      form.querySelector(".new-answer").disabled = e.target.value !== "applicable";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const reason = form.querySelector(".reason").value.trim();
      if (!reason) { form.querySelector(".reason").focus(); return toast("Укажите причину решения", true); }
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true; // защита от двойного клика
      const newStatus = form.querySelector(".new-status").value;
      try {
        const res = await api.decide(a.appeal_id, {
          action, reason, expected_revision: ev.revision,
          new_status: action === "change" ? newStatus : null,
          new_answer: action === "change" && newStatus === "applicable" ? form.querySelector(".new-answer").value : null,
        });
        toast(`Решение сохранено. Итог: ${res.final_score.total === null ? "не определён" : pct(res.final_score.total)}`);
        refreshAppealsCount();
        renderAppeals();
      } catch (err) {
        toast(err.status === 409 ? "Оценка уже изменилась — обновите страницу. " + err.message : err.message, true);
        btn.disabled = false;
      }
    });
  }
}
