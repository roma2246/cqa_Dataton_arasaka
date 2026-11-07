// «Аналитика»: где проседает качество по набору + ИИ-аналитик (получает только агрегаты, без текстов переписок).
import { api } from "../api.js";
import { root, esc, chip, pct, scoreBar, toast, LANG, CHANNEL } from "../app.js";

const kpi = (label, value, sub = "") =>
  `<div class="card kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;

export async function renderAnalytics() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const group = params.get("group") || "DEV";
  root.innerHTML = '<div class="empty"><span class="spin" aria-hidden="true"></span> Считаю статистику…</div>';
  const a = await api.analytics(group);
  if (!location.hash.startsWith("#/analytics")) return;
  const crit = [...a.criteria].sort((x, y) => (x.score_pct ?? 101) - (y.score_pct ?? 101));
  const weakest = crit.find((c) => c.score_pct != null);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Аналитика</h1>
        <div class="muted">Набор ${esc(group)} · ${esc(a.checklist)} · по последней оценке каждого диалога с учётом решений проверяющего</div></div>
      <div class="seg" id="grp">${["DEV", "PROD"].map((g) => `<button type="button" data-v="${g}" aria-pressed="${g === group}">${g}</button>`).join("")}</div>
    </div>
    <div class="kpis">
      ${kpi("Оценено диалогов", a.evaluated)}
      ${kpi("Средний итог", pct(a.avg_total), "по 7 оцениваемым критериям")}
      ${kpi("Грубые ошибки", a.critical_count, a.evaluated ? `${pct((100 * a.critical_count) / a.evaluated)} диалогов` : "")}
      ${kpi("Слабое место", weakest ? esc(weakest.title) : "—", weakest ? `выполнено в ${pct(weakest.score_pct)} случаев` : "")}
    </div>
    <div class="card">
      <div class="card-head"><h2>По критериям</h2><span class="subtle">от худшего к лучшему</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Критерий</th><th>Вес</th><th>Выполнение</th><th>Не выполнено</th><th>N/A</th><th>Проверка</th></tr></thead>
        <tbody>${crit.map((c) => `<tr><td>${esc(c.title)}</td><td class="num">${c.weight || "флаг"}</td>
          <td>${scoreBar(c.score_pct)}</td><td class="num">${c.fails}</td><td class="num">${c.na}</td><td class="num">${c.needs_review}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="card"><div class="card-head"><h2>По языкам</h2></div><div class="table-wrap"><table><tbody>
        ${Object.entries(a.by_language).map(([k, v]) => `<tr><td>${esc(LANG[k] || k)}</td><td class="num">${v.n}</td><td>${scoreBar(v.avg)}</td></tr>`).join("") || '<tr><td class="empty">—</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>По каналам</h2></div><div class="table-wrap"><table><tbody>
        ${Object.entries(a.by_channel).map(([k, v]) => `<tr><td>${esc(CHANNEL[k] || k)}</td><td class="num">${v.n}</td><td>${scoreBar(v.avg)}</td></tr>`).join("") || '<tr><td class="empty">—</td></tr>'}
      </tbody></table></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Грубые ошибки</h2>${chip(String(a.critical_count), a.critical_count ? "bad" : "ok")}</div>
      <div class="table-wrap"><table><tbody>
        ${a.critical.map((c) => `<tr class="clickable" data-id="${esc(c.conversation_id)}"><td class="mono">${esc(c.conversation_id)}</td><td>${esc(c.language)}</td><td>${esc(c.reason)}</td></tr>`).join("") || '<tr><td class="empty">Нет</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Худшие диалоги</h2></div>
      <div class="table-wrap"><table><tbody>
        ${a.worst.map((w) => `<tr class="clickable" data-id="${esc(w.conversation_id)}"><td class="mono">${esc(w.conversation_id)}</td><td>${scoreBar(w.total)}</td></tr>`).join("") || '<tr><td class="empty">—</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>ИИ-аналитик</h2><span class="subtle">видит только цифры выше, тексты переписок не передаются</span></div>
      <div class="card-pad stack" style="gap:10px">
        <div class="row"><input id="q" class="input" style="flex:1" placeholder="Например: чему в первую очередь обучать операторов?">
          <button class="btn btn-primary" id="ask">Спросить ИИ-аналитика</button></div>
        <div id="ans"></div>
      </div>
    </div>`;
  root.querySelector("#grp").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (b) location.hash = "#/analytics?group=" + b.dataset.v;
  });
  root.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", () => (location.hash = "#/c/" + encodeURIComponent(tr.dataset.id))));
  const btn = root.querySelector("#ask"), out = root.querySelector("#ans");
  btn.addEventListener("click", async () => {
    btn.disabled = true; out.innerHTML = '<span class="spin" aria-hidden="true"></span> Модель анализирует статистику…';
    try {
      const r = await api.analyticsAsk(group, root.querySelector("#q").value);
      const list = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      out.innerHTML = `<h3>Выводы</h3>${list(r.insights)}<h3>Рекомендации</h3>${list(r.recommendations)}<div class="subtle">Модель: ${esc(r.model)}</div>`;
    } catch (e) { out.innerHTML = ""; toast(e.message, true); } finally { btn.disabled = false; }
  });
}
