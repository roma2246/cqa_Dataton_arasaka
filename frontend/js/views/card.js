// Карточка диалога: транскрипт + оценка + доказательства + апелляция. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, fmt, STATUS_LABEL } from "../app.js";

let pollTimer = null;

export async function renderCard(conversationId, selectedEvalId) {
  clearTimeout(pollTimer);
  const [conv, versions] = await Promise.all([api.conversation(conversationId), api.checklists()]);
  const evalId = selectedEvalId || conv.evaluations[0]?.evaluation_id;
  const ev = evalId ? await api.evaluation(evalId) : null;
  // защита от гонки: пользователь мог уйти на другой диалог
  if (location.hash !== "#/c/" + encodeURIComponent(conversationId)) return;
  const chk = ev ? versions.find((v) => v.version_id === ev.checklist_version_id) : null;

  root.innerHTML = `
    <p><a href="#/">← к списку</a></p>
    <div class="panel row" style="justify-content:space-between">
      <div>
        <h2>${esc(conv.conversation_id)}</h2>
        <span class="muted">${esc(conv.channel)} · ${esc(conv.language)} · группа ${esc(conv.group_id)} · ${conv.messages.length} реплик</span>
        ${conv.audio_url ? ' · <button class="secondary" id="audio">Прослушать запись</button>' : ""}
        <div id="audio-box"></div>
      </div>
      <div class="row">
        <select id="ver">${versions.map((v) => `<option value="${v.version_id}">v${v.version} — ${esc(v.name)}</option>`).join("")}</select>
        <button id="run">Запустить оценку</button>
        ${conv.evaluations.length ? `<select id="evsel">${conv.evaluations.map((e) =>
          `<option value="${e.evaluation_id}" ${e.evaluation_id === evalId ? "selected" : ""}>Оценка #${e.evaluation_id} · v-id ${e.checklist_version_id} · ${e.status}</option>`).join("")}</select>` : ""}
      </div>
    </div>
    <div class="card-grid">
      <div class="panel transcript" id="transcript">
        <h3>Транскрипт</h3>
        ${conv.messages.map((m) => `
          <div class="msg ${esc(m.speaker)}" id="msg-${esc(m.message_id)}" data-idx="${m.index}">
            <div class="meta">${esc(m.message_id)} · ${esc(m.timestamp)} · <b>${esc(m.speaker)}</b></div>
            <div>${esc(m.text)}</div>
          </div>`).join("")}
      </div>
      <div id="result">${renderResult(ev, chk)}</div>
    </div>`;

  root.querySelector("#run").onclick = async () => {
    try {
      const r = await api.startEvaluation(conversationId, Number(root.querySelector("#ver").value));
      toast("Оценка поставлена в очередь #" + r.evaluation_id);
      renderCard(conversationId, r.evaluation_id);
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector("#evsel")?.addEventListener("change", (e) => renderCard(conversationId, Number(e.target.value)));
  root.querySelector("#audio")?.addEventListener("click", async (e) => {
    // audio_url — HTML-страница плеера, НЕ аудиофайл. Сервер извлекает и проверяет media-источник.
    // Перемотку к реплике не делаем: начало записи (t0) не сверено с ISO-временем транскрипта.
    const box = root.querySelector("#audio-box");
    e.target.disabled = true;
    box.innerHTML = '<span class="muted">Проверяем запись…</span>';
    try {
      const a = await api.audio(conversationId);
      const player = `<a href="${esc(a.player_url)}" target="_blank" rel="noopener noreferrer">штатный плеер ↗</a>`;
      if (a.media_url) {
        box.innerHTML = `<audio controls preload="metadata" style="width:100%;margin-top:6px" src="${esc(a.media_url)}"></audio>
          <div class="muted">Тип: ${esc(a.media_type)} · ${player}</div>`;
        box.querySelector("audio").addEventListener("error", () => {
          box.insertAdjacentHTML("beforeend", `<div class="st-failed">Браузер не смог загрузить запись — откройте ${player}</div>`);
        });
      } else {
        box.innerHTML = `<div class="st-failed">${esc(a.error || "Запись недоступна")}</div><div>${player}</div>`;
      }
    } catch (err) {
      box.innerHTML = `<div class="st-failed">${esc(err.message)}</div>`;
      e.target.disabled = false;
    }
  });

  if (ev && (ev.status === "queued" || ev.status === "running")) {
    pollTimer = setTimeout(() => renderCard(conversationId, evalId), 1500);
    return;
  }
  bindResult(ev, conversationId);
}

function renderResult(ev, chk) {
  if (!ev) return `<div class="panel muted">Оценок ещё нет. Выберите версию чек-листа и запустите оценку.</div>`;
  if (ev.status === "queued" || ev.status === "running") return `<div class="panel">Оценка #${ev.evaluation_id}: ${ev.status}…</div>`;
  if (ev.status === "failed") return `<div class="panel st-failed">Оценка не удалась: ${esc(ev.error)}</div>`;
  if (ev.status === "canceled") return `<div class="panel muted">Оценка #${ev.evaluation_id} отменена до запуска.</div>`;

  const crit = Object.fromEntries((chk?.criteria || []).map((c) => [c.criterion_id, c]));
  const fin = ev.final_score, ai = ev.ai_score;
  const finRes = Object.fromEntries(ev.final_results.map((r) => [r.criterion_id, r]));
  const aiRes = Object.fromEntries(ev.ai_results.map((r) => [r.criterion_id, r]));
  const appealsBy = {};
  ev.appeals.forEach((a) => (appealsBy[a.criterion_id] ||= []).push(a));

  const head = `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="muted">Итог (финальный)</div>
          <div class="total">${fin.total === null ? "не определён" : fmt(fin.total) + "%"}</div>
          ${fin.incomplete_reason ? `<div class="st-needs_review">${esc(fin.incomplete_reason)}</div>` : ""}
          ${fin.critical_error ? `<div class="critical">Грубая ошибка: ${esc(fin.critical_criteria.join(", "))}</div>` : ""}
        </div>
        <div class="muted" style="text-align:right">
          ИИ: ${ai.total === null ? "—" : fmt(ai.total) + "%"} · revision ${ev.revision}<br>
          <span class="badge ${ev.mode === "mock" ? "mock" : "real"}">${ev.mode === "mock" ? "ТЕСТОВЫЙ ответ" : esc(ev.model)}</span>
          · промпт ${esc(ev.prompt_version)} · стоимость ${ev.cost_usd === null ? "неизвестна" : "$" + ev.cost_usd}<br>
          Чек-лист: ${chk ? `v${chk.version} ${esc(chk.name)}` : "#" + ev.checklist_version_id}
        </div>
      </div>
      ${fin.sections.length ? `<div class="row muted">${fin.sections.map((s) => `${esc(s.section_id)}: ${fmt(s.total)}`).join(" · ")}</div>` : ""}
    </div>`;

  const rows = fin.criteria.map((s) => {
    const c = crit[s.criterion_id] || { title: s.criterion_id };
    const r = finRes[s.criterion_id], orig = aiRes[s.criterion_id];
    const changed = orig && (orig.status !== r.status || orig.answer !== r.answer);
    const label = c.options?.find((o) => o.value === s.answer)?.label ?? s.answer;
    return `
      <div class="crit" data-cid="${esc(s.criterion_id)}">
        <div class="row" style="justify-content:space-between">
          <b>${esc(c.title)}</b>
          <span class="st-${s.status}">${STATUS_LABEL[s.status]}${s.status === "applicable" ? ": " + esc(label) : ""}</span>
        </div>
        <div class="muted">вес ${s.weight} · эфф. вес ${fmt(s.effective_weight, 4)} · q ${fmt(s.q)} · вклад ${fmt(s.contribution)}
          ${s.is_critical_hit ? ' · <span class="critical">грубая ошибка</span>' : ""}</div>
        <div>${esc(r.explanation)}</div>
        ${r.na_reason ? `<div class="st-not_applicable">N/A: ${esc(r.na_reason)}</div>` : ""}
        ${r.review_reason ? `<div class="st-needs_review">Причина проверки: ${esc(r.review_reason)}</div>` : ""}
        <div>
          ${r.evidence_message_ids.map((id) => `<span class="ev-link" data-msg="${esc(id)}">→ ${esc(id)}</span>`).join("")}
          ${r.checked_range ? `<span class="ev-link" data-from="${esc(r.checked_range.from_message_id)}" data-to="${esc(r.checked_range.to_message_id)}">проверено ${esc(r.checked_range.from_message_id)}–${esc(r.checked_range.to_message_id)}</span>` : ""}
        </div>
        ${changed ? `<div class="muted">ИИ: ${esc(STATUS_LABEL[orig.status])} ${esc(orig.answer ?? "")} → после пересмотра: ${esc(STATUS_LABEL[r.status])} ${esc(r.answer ?? "")}</div>` : ""}
        ${(appealsBy[s.criterion_id] || []).map((a) => `
          <div class="muted">Апелляция #${a.appeal_id} (${esc(a.status)}): «${esc(a.comment)}»
            ${a.action ? ` — проверяющий: ${a.action === "confirm" ? "подтвердил" : "изменил"}, причина: «${esc(a.decision_reason)}»` : ""}</div>`).join("")}
        <button class="secondary appeal-btn" data-cid="${esc(s.criterion_id)}">Оспорить</button>
        <div class="appeal-form" hidden>
          <textarea placeholder="Комментарий к апелляции"></textarea>
          <button class="send-appeal">Сохранить апелляцию</button>
        </div>
      </div>`;
  }).join("");

  return head + `<div class="panel"><h3>Критерии</h3>${rows}</div>`;
}

function clearHl() {
  document.querySelectorAll(".msg.hl, .msg.in-range").forEach((m) => m.classList.remove("hl", "in-range"));
}

function bindResult(ev, conversationId) {
  if (!ev || ev.status !== "completed") return;
  root.querySelectorAll(".ev-link").forEach((a) => a.addEventListener("click", () => {
    clearHl();
    if (a.dataset.msg) {
      const el = document.getElementById("msg-" + a.dataset.msg);
      el?.classList.add("hl");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const from = Number(document.getElementById("msg-" + a.dataset.from)?.dataset.idx);
      const to = Number(document.getElementById("msg-" + a.dataset.to)?.dataset.idx);
      document.querySelectorAll(".msg").forEach((m) => {
        const i = Number(m.dataset.idx);
        if (i >= from && i <= to) m.classList.add("in-range");
      });
      document.getElementById("msg-" + a.dataset.from)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }));
  root.querySelectorAll(".appeal-btn").forEach((b) => b.addEventListener("click", () => {
    b.nextElementSibling.hidden = !b.nextElementSibling.hidden;
  }));
  root.querySelectorAll(".send-appeal").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest(".crit"), text = box.querySelector("textarea").value.trim();
    if (!text) return toast("Добавьте комментарий", true);
    b.disabled = true;
    try {
      const r = await api.createAppeal(ev.evaluation_id, box.dataset.cid, text);
      toast("Апелляция #" + r.appeal_id + " сохранена");
      renderCard(conversationId, ev.evaluation_id);
    } catch (e) { toast(e.message, true); b.disabled = false; } // текст комментария не теряется
  }));
}
