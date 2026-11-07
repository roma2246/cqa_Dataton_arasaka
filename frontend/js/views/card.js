// Карточка диалога: транскрипт + оценка + доказательства + апелляция. Владелец: Участник 3.
import { api } from "../api.js";
import { root, esc, toast, fmt, pct, tone, chip, STATUS_LABEL, EVAL_STATUS, LANG, CHANNEL, SPEAKER, refreshAppealsCount } from "../app.js";

let pollTimer = null;

export async function renderCard(conversationId, selectedEvalId) {
  clearTimeout(pollTimer);
  const [conv, versions] = await Promise.all([api.conversation(conversationId), api.checklists()]);
  const evalId = selectedEvalId || conv.evaluations[0]?.evaluation_id;
  const ev = evalId ? await api.evaluation(evalId) : null;
  // защита от гонки: пользователь мог уйти на другой диалог
  if (location.hash !== "#/c/" + encodeURIComponent(conversationId)) return;
  const chk = ev ? versions.find((v) => v.version_id === ev.checklist_version_id) : null;
  const verName = (id) => { const v = versions.find((x) => x.version_id === id); return v ? `v${v.version}` : `#${id}`; };
  const isCall = conv.channel === "voice call";

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/">Диалоги</a> / ${esc(conv.conversation_id)}</div>
        <h1 class="mono" style="font-size:20px">${esc(conv.conversation_id)}</h1>
        <div class="row" style="margin-top:6px">
          ${chip(CHANNEL[conv.channel] || conv.channel, "accent plain")}
          ${chip(LANG[conv.language] || conv.language, "plain")}
          <span class="subtle">группа ${esc(conv.group_id)} · ${conv.messages.length} реплик</span>
        </div>
      </div>
      <div class="toolbar">
        ${conv.evaluations.length ? `<select id="evsel" aria-label="Оценка">${conv.evaluations.map((e) =>
          `<option value="${e.evaluation_id}" ${e.evaluation_id === evalId ? "selected" : ""}>Оценка #${e.evaluation_id} · ${verName(e.checklist_version_id)} · ${(EVAL_STATUS[e.status] || [e.status])[0]}</option>`).join("")}</select>` : ""}
        <select id="ver" aria-label="Версия чек-листа">${versions.map((v) => `<option value="${v.version_id}">v${v.version} · ${esc(v.name)}</option>`).join("")}</select>
        <button class="btn btn-primary" id="run">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          ${conv.evaluations.length ? "Новая оценка" : "Оценить"}</button>
      </div>
    </div>

    <div class="conv-grid">
      <section class="card sticky" aria-label="Транскрипт">
        <div class="card-head">
          <h2>Транскрипт</h2>
          <div class="row subtle">
            <span>Оператор справа</span>
            ${isCall ? '<button class="btn btn-sm" id="audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>Прослушать</button>' : ""}
          </div>
        </div>
        ${isCall ? '<div class="audio-box card-pad" id="audio-box" hidden></div>' : ""}
        <div class="chat" id="transcript">
          ${conv.messages.map((m) => `
            <div class="msg ${esc(m.speaker)}" id="msg-${esc(m.message_id)}" data-idx="${m.index}">
              <div class="meta"><span class="who">${esc(SPEAKER[m.speaker] || m.speaker)}</span>
                <span class="mono">${esc(m.message_id)}</span><span>${esc(shortTime(m.timestamp))}</span></div>
              <div class="bubble">${esc(m.text)}</div>
            </div>`).join("")}
        </div>
      </section>
      <section id="result" class="stack" style="gap:16px">${renderResult(ev, chk)}</section>
    </div>`;

  root.querySelector("#run").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api.startEvaluation(conversationId, Number(root.querySelector("#ver").value));
      toast("Оценка поставлена в очередь");
      renderCard(conversationId, r.evaluation_id);
    } catch (err) { toast(err.message, true); e.currentTarget.disabled = false; }
  };
  root.querySelector("#evsel")?.addEventListener("change", (e) => renderCard(conversationId, Number(e.target.value)));
  root.querySelector("#audio")?.addEventListener("click", (e) => loadAudio(conversationId, e.currentTarget));

  if (ev && (ev.status === "queued" || ev.status === "running")) {
    pollTimer = setTimeout(() => renderCard(conversationId, evalId), 1500);
    return;
  }
  bindResult(ev, conversationId);
}

function shortTime(ts) {
  // ISO у звонков -> ЧЧ:ММ:СС, у чатов оставляем MM:SS. Исходное значение — в title не нужно: показываем как есть, если не ISO.
  const m = /T(\d\d:\d\d:\d\d)/.exec(ts || "");
  return m ? m[1] : ts;
}

async function loadAudio(conversationId, btn) {
  // audio_url — HTML-страница плеера, НЕ аудиофайл. Сервер извлекает и проверяет media-источник.
  // Перемотку к реплике не делаем: начало записи (t0) не сверено с ISO-временем транскрипта.
  const box = root.querySelector("#audio-box");
  btn.disabled = true;
  box.hidden = false;
  box.innerHTML = '<div class="row subtle"><span class="spin"></span> Проверяем запись…</div>';
  try {
    const a = await api.audio(conversationId);
    const player = `<a href="${esc(a.player_url)}" target="_blank" rel="noopener noreferrer">штатный плеер ↗</a>`;
    if (a.media_url) {
      box.innerHTML = `<audio controls preload="metadata" src="${esc(a.media_url)}"></audio>
        <div class="subtle" style="margin-top:4px">${esc(a.media_type)} · ${player}</div>`;
      box.querySelector("audio").addEventListener("error", () => {
        box.insertAdjacentHTML("beforeend", `<div class="alert bad" style="margin-top:6px">Браузер не смог загрузить запись — откройте ${player}</div>`);
      });
    } else {
      box.innerHTML = `<div class="alert warn">${esc(a.error || "Запись недоступна")} · ${player}</div>`;
    }
  } catch (err) {
    box.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`;
    btn.disabled = false;
  }
}

function renderResult(ev, chk) {
  if (!ev) return `<div class="card empty">
      <h2>Оценок ещё нет</h2>
      <p class="muted">Выберите версию чек-листа вверху и нажмите «Оценить».</p></div>`;
  if (ev.status === "queued" || ev.status === "running") return `<div class="card card-pad stack">
      <div class="row"><span class="spin"></span><h2>${ev.status === "queued" ? "Оценка в очереди" : "Модель оценивает диалог"}</h2></div>
      <div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:85%"></div><div class="skeleton" style="width:40%"></div></div>`;
  if (ev.status === "failed") return `<div class="card card-pad stack"><h2>Оценка не удалась</h2>
      <div class="alert bad">${esc(ev.error)}</div><div class="subtle">Попробуйте «Новая оценка». Ошибка не превращается в баллы.</div></div>`;
  if (ev.status === "canceled") return `<div class="card card-pad muted">Оценка #${ev.evaluation_id} отменена до запуска.</div>`;

  const crit = Object.fromEntries((chk?.criteria || []).map((c) => [c.criterion_id, c]));
  const sections = Object.fromEntries((chk?.sections || []).map((s) => [s.section_id, s.title]));
  const fin = ev.final_score, ai = ev.ai_score;
  const finRes = Object.fromEntries(ev.final_results.map((r) => [r.criterion_id, r]));
  const aiRes = Object.fromEntries(ev.ai_results.map((r) => [r.criterion_id, r]));
  const appealsBy = {};
  ev.appeals.forEach((a) => (appealsBy[a.criterion_id] ||= []).push(a));
  const agree = (ev.usage && ev.usage.agreement) || {};
  const t = tone(fin.total);
  const ringColor = t === "good" ? "var(--ok)" : t === "mid" ? "var(--warn)" : "var(--bad)";
  const changedTotal = ai.total !== fin.total;

  const head = `
    <div class="card card-pad stack" style="gap:14px">
      <div class="summary">
        <div class="ring ${fin.total === null ? "none" : ""}" style="--v:${fin.total ?? 0};--c:${ringColor}" role="img" aria-label="Итог ${fin.total === null ? "не определён" : pct(fin.total)}">
          <div><div><b>${fin.total === null ? "—" : pct(fin.total)}</b><br><small>${changedTotal ? "финал" : "итог"}</small></div></div>
        </div>
        <div class="stack" style="gap:6px">
          <div class="row">
            ${fin.total === null ? chip(fin.incomplete_reason || "Итог не определён", "warn") : ""}
            ${fin.critical_error ? chip("Грубая ошибка: " + fin.critical_criteria.join(", "), "bad") : ""}
            ${changedTotal ? chip(`ИИ: ${ai.total === null ? "—" : pct(ai.total)} → ${fin.total === null ? "—" : pct(fin.total)}`, "accent") : ""}
            ${ev.mode === "mock" ? chip("Тестовый ответ (mock)", "warn") : ""}
          </div>
          ${fin.sections.length ? `<div class="row">${fin.sections.map((s) =>
            `<span class="tag">${esc(sections[s.section_id] || s.section_id)}: ${s.total === null ? "—" : pct(s.total)}</span>`).join("")}</div>` : ""}
          <dl class="meta-grid">
            <div><dt>Чек-лист</dt><dd>${chk ? `v${chk.version} · ${esc(chk.name)}` : "#" + ev.checklist_version_id}</dd></div>
            <div><dt>Модель</dt><dd>${esc(ev.model)}</dd></div>
            <div><dt>Стоимость</dt><dd>${ev.cost_usd === null ? "неизвестна" : "$" + Number(ev.cost_usd).toFixed(4)}</dd></div>
            <div><dt>Ревизия</dt><dd>${ev.revision} · промпт ${esc(ev.prompt_version)}</dd></div>
          </dl>
        </div>
      </div>
    </div>`;

  const rows = fin.criteria.map((s) => {
    const c = crit[s.criterion_id] || { title: s.criterion_id };
    const r = finRes[s.criterion_id], orig = aiRes[s.criterion_id];
    const changed = orig && (orig.status !== r.status || orig.answer !== r.answer);
    const label = c.options?.find((o) => o.value === s.answer)?.label
      ?? (c.answer_type === "scale" && s.answer ? `${s.answer} из ${c.scale?.max}` : s.answer);
    const qTone = s.q === null ? "" : s.q >= 0.8 ? "good" : s.q >= 0.5 ? "mid" : "low";
    const stChip = s.status === "applicable"
      ? chip(label, qTone === "good" ? "ok" : qTone === "mid" ? "warn" : "bad")
      : chip(STATUS_LABEL[s.status], s.status === "needs_review" ? "warn" : "");
    const fmtAns = (x) => (x.status === "applicable" ? (crit[x.criterion_id]?.options?.find((o) => o.value === x.answer)?.label ?? x.answer) : STATUS_LABEL[x.status]);
    return `
      <article class="crit ${s.status} ${qTone}" data-cid="${esc(s.criterion_id)}">
        <div class="crit-top">
          <div class="stack" style="gap:2px">
            <div class="crit-title">${esc(c.title)}</div>
            <div class="crit-nums">
              <span>вес <b>${s.weight}</b></span>
              <span>эфф. вес <b>${s.effective_weight === null ? "—" : pct(s.effective_weight * 100)}</b></span>
              <span>вклад <b>${s.contribution === null ? "—" : fmt(s.contribution) + " п."}</b></span>
              ${s.is_critical_hit ? '<span class="chip bad plain">грубая ошибка</span>' : ""}
              ${agree[s.criterion_id] !== undefined && agree[s.criterion_id] < 1
                ? `<span class="chip warn plain" title="Доля независимых оценок с этим ответом">согласие ${Math.round(agree[s.criterion_id] * 100)}%</span>`
                : agree[s.criterion_id] === 1 ? '<span class="subtle" title="Все независимые оценки совпали">✓ единогласно</span>' : ""}
            </div>
          </div>
          ${stChip}
        </div>
        ${r.explanation ? `<div>${esc(r.explanation)}</div>` : ""}
        ${r.na_reason ? `<div class="note na"><b>N/A:</b> ${esc(r.na_reason)}</div>` : ""}
        ${r.review_reason ? `<div class="note review"><b>Нужна проверка:</b> ${esc(r.review_reason)}</div>` : ""}
        ${r.evidence_message_ids.length || r.checked_range ? `<div class="ev-row">
          ${r.evidence_message_ids.map((id) => `<button class="ev-link" data-msg="${esc(id)}" title="Перейти к реплике">↳ ${esc(id)}</button>`).join("")}
          ${r.checked_range ? `<button class="ev-link range" data-from="${esc(r.checked_range.from_message_id)}" data-to="${esc(r.checked_range.to_message_id)}" title="Показать проверенный участок">проверено ${esc(r.checked_range.from_message_id)}–${esc(r.checked_range.to_message_id)}</button>` : ""}
        </div>` : ""}
        ${changed ? `<dl class="diff"><dt>ИИ</dt><dd>${esc(fmtAns(orig))}</dd><dt>Проверяющий</dt><dd>${esc(fmtAns(r))}</dd></dl>` : ""}
        ${(appealsBy[s.criterion_id] || []).map((a) => `
          <div class="appeal-item">
            <div class="row">${chip(a.status === "open" ? "Апелляция открыта" : a.status === "changed" ? "Оценка изменена" : "Оценка подтверждена", a.status === "open" ? "warn" : a.status === "changed" ? "accent" : "ok")}
              <span class="subtle">#${a.appeal_id}</span></div>
            <div style="margin-top:4px">«${esc(a.comment)}»</div>
            ${a.action ? `<div class="subtle" style="margin-top:2px">Причина решения: «${esc(a.decision_reason)}»</div>` : ""}
          </div>`).join("")}
        <div class="crit-actions"><button class="btn btn-ghost btn-sm appeal-btn" aria-expanded="false">Оспорить</button></div>
        <div class="appeal-form" hidden>
          <textarea placeholder="Почему вы не согласны с оценкой? Комментарий увидит проверяющий."></textarea>
          <div class="row" style="justify-content:flex-end">
            <button class="btn btn-sm cancel-appeal">Отмена</button>
            <button class="btn btn-primary btn-sm send-appeal">Подать апелляцию</button>
          </div>
        </div>
      </article>`;
  }).join("");

  return head + `<div class="card"><div class="card-head"><h2>Критерии</h2>
      <span class="subtle">Нажмите на номер реплики, чтобы перейти к доказательству</span></div>
      <div class="card-pad stack" style="gap:10px">${rows}</div></div>`;
}

function clearHl() {
  document.querySelectorAll(".msg.hl, .msg.in-range").forEach((m) => m.classList.remove("hl", "in-range"));
}

function scrollChatTo(el, block = "center") {
  const chat = document.getElementById("transcript");
  if (!el || !chat) return;
  // прокручиваем только контейнер чата, а не всю страницу
  const top = el.offsetTop - chat.offsetTop - (block === "center" ? chat.clientHeight / 2 - el.clientHeight / 2 : 12);
  chat.scrollTo({ top, behavior: "smooth" });
  if (window.innerWidth <= 1100) el.scrollIntoView({ behavior: "smooth", block });
}

function bindResult(ev, conversationId) {
  if (!ev || ev.status !== "completed") return;
  root.querySelectorAll(".ev-link").forEach((a) => a.addEventListener("click", () => {
    clearHl();
    if (a.dataset.msg) {
      const el = document.getElementById("msg-" + a.dataset.msg);
      el?.classList.add("hl");
      scrollChatTo(el);
    } else {
      const from = Number(document.getElementById("msg-" + a.dataset.from)?.dataset.idx);
      const to = Number(document.getElementById("msg-" + a.dataset.to)?.dataset.idx);
      document.querySelectorAll(".msg").forEach((m) => {
        const i = Number(m.dataset.idx);
        if (i >= from && i <= to) m.classList.add("in-range");
      });
      scrollChatTo(document.getElementById("msg-" + a.dataset.from), "start");
    }
  }));
  root.querySelectorAll(".appeal-btn").forEach((b) => b.addEventListener("click", () => {
    const form = b.closest(".crit").querySelector(".appeal-form");
    form.hidden = !form.hidden;
    b.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) form.querySelector("textarea").focus();
  }));
  root.querySelectorAll(".cancel-appeal").forEach((b) => b.addEventListener("click", () => {
    const box = b.closest(".crit");
    box.querySelector(".appeal-form").hidden = true;
    box.querySelector(".appeal-btn").setAttribute("aria-expanded", "false");
  }));
  root.querySelectorAll(".send-appeal").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest(".crit"), text = box.querySelector("textarea").value.trim();
    if (!text) return toast("Добавьте комментарий", true);
    b.disabled = true;
    try {
      await api.createAppeal(ev.evaluation_id, box.dataset.cid, text);
      toast("Апелляция сохранена — она в очереди проверяющего");
      refreshAppealsCount();
      renderCard(conversationId, ev.evaluation_id);
    } catch (e) { toast(e.message, true); b.disabled = false; } // текст комментария не теряется
  }));
}
