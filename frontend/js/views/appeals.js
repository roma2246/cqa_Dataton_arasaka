// Очередь апелляций и решение проверяющего. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, role, STATUS_LABEL } from "../app.js";

export async function renderAppeals() {
  const list = await api.appeals();
  const isReviewer = role() === "reviewer";
  root.innerHTML = `
    <div class="panel">
      <h2>Апелляции</h2>
      ${isReviewer ? "" : '<p class="muted">Принимать решения может роль «Проверяющий» (переключатель вверху).</p>'}
      <div id="items">${list.length ? "" : '<span class="muted">Апелляций нет</span>'}</div>
    </div>`;
  const box = root.querySelector("#items");

  for (const a of list) {
    const ev = await api.evaluation(a.evaluation_id);
    const chk = await api.checklist(ev.checklist_version_id);
    const c = chk.criteria.find((x) => x.criterion_id === a.criterion_id);
    const r = ev.final_results.find((x) => x.criterion_id === a.criterion_id);
    const ai = ev.ai_results.find((x) => x.criterion_id === a.criterion_id);
    const answers = c.answer_type === "scale"
      ? Array.from({ length: c.scale.max - c.scale.min + 1 }, (_, i) => String(c.scale.min + i))
      : c.options.map((o) => o.value);
    const div = document.createElement("div");
    div.className = "panel";
    div.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <b>#${a.appeal_id} · ${esc(c?.title || a.criterion_id)}</b>
        <span>${esc(a.status)}</span>
      </div>
      <div class="muted">Диалог <a href="#/c/${encodeURIComponent(a.conversation_id)}">${esc(a.conversation_id)}</a> · оценка #${a.evaluation_id} · revision ${ev.revision}</div>
      <div>ИИ: <span class="st-${ai.status}">${STATUS_LABEL[ai.status]} ${esc(ai.answer ?? "")}</span> — ${esc(ai.explanation)}</div>
      <div>Доказательства: ${esc(r.evidence_message_ids.join(", ") || (r.checked_range ? r.checked_range.from_message_id + "–" + r.checked_range.to_message_id : "нет"))}</div>
      <div>Комментарий: «${esc(a.comment)}»</div>
      ${a.status === "open" && isReviewer ? `
        <div class="row" style="margin-top:8px">
          <select class="action"><option value="confirm">Подтвердить оценку</option><option value="change">Изменить</option></select>
          <select class="new-status"><option value="applicable">Оценён</option>${c.na_allowed ? '<option value="not_applicable">N/A</option>' : ""}</select>
          <select class="new-answer">${answers.map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        </div>
        <textarea class="reason" placeholder="Причина решения (обязательно)"></textarea>
        <button class="decide">Сохранить решение</button>` : ""}`;
    box.appendChild(div);

    div.querySelector(".decide")?.addEventListener("click", async (e) => {
      const reason = div.querySelector(".reason").value.trim();
      if (!reason) return toast("Укажите причину", true);
      const action = div.querySelector(".action").value;
      e.target.disabled = true; // защита от двойного клика
      try {
        const res = await api.decide(a.appeal_id, {
          action, reason, expected_revision: ev.revision,
          new_status: action === "change" ? div.querySelector(".new-status").value : null,
          new_answer: action === "change" ? div.querySelector(".new-answer").value : null,
        });
        toast(`Решение сохранено. Новый итог: ${res.final_score.total ?? "не определён"}`);
        renderAppeals();
      } catch (err) {
        toast(err.status === 409 ? "Конфликт: оценка уже изменена, обновите страницу. " + err.message : err.message, true);
        e.target.disabled = false;
      }
    });
  }
}
