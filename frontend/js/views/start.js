// «Старт»: что это за платформа, что нажимать, «проверь свой диалог» и чат с ИИ-ассистентом поддержки.
import { api } from "../api.js";
import { root, esc, toast } from "../app.js";

const EXAMPLE = `Клиент: Здравствуйте, где посмотреть мой тариф? Я в веб-версии.
Оператор: Здравствуйте, меня зовут Алина! В веб-версии откройте вкладку «Кабинет» — название тарифа под вашим ФИО.
Клиент: Нашла, спасибо!
Оператор: Рада помочь. Хорошего дня!`;

const ROLE = [
  [/^(клиент|client|клиенттің|к)\s*[:：-]/i, "client"],
  [/^(оператор|operator|agent|о)\s*[:：-]/i, "operator"],
  [/^(бот|bot)\s*[:：-]/i, "bot"],
  [/^(система|system)\s*[:：-]/i, "system"],
];

function parseDialog(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const hit = ROLE.find(([re]) => re.test(line));
    if (hit) out.push({ speaker: hit[1], text: line.replace(hit[0], "").trim() });
    else if (out.length) out[out.length - 1].text += " " + line;   // продолжение предыдущей реплики
  }
  return out.map((m, i) => ({ ...m, timestamp: `${String(Math.floor(i * 40 / 60)).padStart(2, "0")}:${String((i * 40) % 60).padStart(2, "0")}` }));
}

const step = (n, title, text, btn) =>
  `<div class="card start-step"><div class="start-n">${n}</div><h3>${title}</h3><p>${text}</p>${btn}</div>`;

export async function renderStart() {
  root.innerHTML = `
    <div class="start-hero card">
      <div>
        <div class="start-kicker">Добро пожаловать в CQA</div>
        <h1>ИИ проверяет переписку оператора по чек-листу Freedom</h1>
        <p class="muted">По каждому из 8 пунктов — ответ, объяснение и ссылка на реплику. Неприменимо — N/A, грубые ошибки — отдельным флагом.
          Ниже — что можно сделать прямо сейчас. Пароль не нужен.</p>
      </div>
      <button class="btn btn-primary" type="button" data-scroll>Проверить свой диалог ↓</button>
    </div>
    <div class="start-steps">
      ${step(1, "Посмотреть пример", "Готовый разбор настоящего чата: оператор назвал данные счёта без проверки личности. Нажмите на пункт — подсветится реплика.",
        '<a class="btn" href="#/c/p1-kz-015">Открыть разбор →</a>')}
      ${step(2, "Проверить свой диалог", "Напишите переписку клиента и оператора своими словами — модель оценит её за несколько секунд.",
        '<button class="btn" type="button" data-scroll>Написать диалог ↓</button>')}
      ${step(3, "Все диалоги и оценки", "65 чатов и звонков организаторов уже оценены. Фильтры по языку и статусу, любую оценку можно пересчитать.",
        '<a class="btn" href="#/">Список диалогов →</a>')}
      ${step(4, "Аналитика и апелляции", "Где проседает качество, ИИ-аналитик с советами. Внизу слева переключите роль на «Проверяющий», чтобы решать апелляции.",
        '<a class="btn" href="#/analytics">Аналитика →</a>')}
    </div>
    <div class="start-grid">
      <div class="card start-try" id="try">
        <div class="card-head"><h2>Проверь свой диалог</h2><span class="subtle">каждая строка: «Клиент: …» или «Оператор: …»</span></div>
        <div class="card-pad stack" style="gap:10px">
          <textarea id="dlg" rows="9" spellcheck="false">${esc(EXAMPLE)}</textarea>
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <select id="lang"><option value="RU">Русский</option><option value="KZ">Қазақша</option><option value="EN">English</option></select>
            <button class="btn" id="ex-bad" type="button">Пример с грубой ошибкой</button>
            <span class="spacer"></span>
            <button class="btn btn-primary" id="go" type="button">Оценить диалог</button>
          </div>
          <div id="go-st" class="subtle"></div>
        </div>
      </div>
      <div class="card start-chat">
        <div class="card-head"><h2>Чат с ИИ-ассистентом</h2><span class="subtle">как видит клиент · RU / KZ / EN</span></div>
        <div class="chat-log" id="ch-log"><div class="b a">Здравствуйте! Я ИИ-ассистент поддержки. Спросите про тариф, отчёт брокера, пополнение или приложение.
          Вопросы о выводе и вашем счёте передам специалисту.</div></div>
        <form class="chat-in" id="ch-form"><input id="ch-q" maxlength="500" placeholder="Например: где скачать отчёт брокера?" autocomplete="off"><button class="btn btn-primary">→</button></form>
      </div>
    </div>`;

  root.querySelectorAll("[data-scroll]").forEach((b) => b.addEventListener("click", () =>
    root.querySelector("#try").scrollIntoView({ behavior: "smooth", block: "start" })));

  // ---- Проверь свой диалог ----
  const ta = root.querySelector("#dlg"), st = root.querySelector("#go-st"), go = root.querySelector("#go");
  root.querySelector("#ex-bad").addEventListener("click", () => {
    ta.value = `Клиент: Почему у меня заблокирован вывод денег?\nОператор: Вижу, на вашем счёте ограничение на вывод.\nКлиент: Я ещё не подтверждал личность.\nОператор: Это не нужно. До свидания.`;
  });
  go.addEventListener("click", async () => {
    const transcript = parseDialog(ta.value);
    if (!transcript.some((m) => m.speaker === "operator")) { toast("Нужна хотя бы одна строка «Оператор: …»", true); return; }
    go.disabled = true;
    const cid = "sandbox-" + Date.now().toString(36);
    try {
      st.textContent = "Загружаю диалог…";
      await api.importJson({ isSuccess: true, data: { dataset_group_id: "SANDBOX", records: [
        { conversation_id: cid, channel: "agent chat", language: root.querySelector("#lang").value, transcript }] } });
      const vers = (await api.checklists()).filter((c) => c.checklist_id === "official");
      const vid = Math.max(...vers.map((c) => c.version_id));
      st.textContent = "Модель оценивает по 8 пунктам… (5–15 секунд)";
      const { evaluation_id } = await api.startEvaluation(cid, vid);
      for (let i = 0; i < 60; i++) {
        const ev = await api.evaluation(evaluation_id);
        if (ev.status === "completed") { location.hash = "#/c/" + encodeURIComponent(cid); return; }
        if (ev.status === "failed") throw new Error(ev.error || "Оценка не удалась");
        if (i % 2 === 0) { try { await api.work(); } catch {} }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Модель отвечает слишком долго, попробуйте ещё раз");
    } catch (e) { st.textContent = ""; toast(e.message, true); } finally { go.disabled = false; }
  });

  // ---- Чат с ассистентом ----
  const log = root.querySelector("#ch-log"), form = root.querySelector("#ch-form"), q = root.querySelector("#ch-q");
  const hist = [];
  const add = (cls, html) => { const d = document.createElement("div"); d.className = "b " + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = q.value.trim(); if (!text) return;
    q.value = ""; add("c", esc(text)); hist.push({ role: "client", text });
    const w = add("a", "…");
    try {
      const r = await fetch("/api/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: hist }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.detail || "Ошибка");
      w.innerHTML = esc(d.reply) + (d.sources && d.sources.length ? `<small>по ответам операторов: ${d.sources.map(esc).join(", ")}</small>` : "");
      hist.push({ role: "assistant", text: d.reply });
      if (d.handoff) add("sys", `Передано специалисту · ответ обычно до ${d.eta_min || 2} мин`);
    } catch (err) { w.textContent = err.message; }
  });
}
