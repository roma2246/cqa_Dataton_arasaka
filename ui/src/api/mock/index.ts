// Демо-бэкенд в памяти браузера (режим mock). Повторяет поведение API: очередь оценок,
// неизменяемые версии чек-листа, апелляции с revision и 409, пакеты, импорт без дублей.
// Данные живут до перезагрузки страницы.
import {
  ApiError,
  type Appeal,
  type Batch,
  type ChecklistVersion,
  type Conversation,
  type ConversationSummary,
  type CqaApi,
  type Criterion,
  type CriterionResult,
  type Evaluation,
  type ImportReport,
  type Message,
  type Speaker,
} from '../types';
import { CHECKLISTS, CONVERSATIONS, PREPARED } from './data';
import { computeScore, qFor } from './scoring';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const wait = (ms = 160) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const db = {
  conversations: clone(CONVERSATIONS),
  checklists: clone(CHECKLISTS),
  evaluations: [] as Evaluation[],
  appeals: [] as Appeal[],
  batches: new Map<string, Batch>(),
  seq: { evaluation: 0, appeal: 0, batch: 0 },
};

function seed(s: string) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ---------- «Модель» ----------

function mockResults(conv: Conversation, cl: ChecklistVersion): CriterionResult[] {
  const ops = conv.messages.filter((m) => m.speaker === 'operator');
  const first = conv.messages[0]?.message_id ?? 'm001';
  const last = conv.messages[conv.messages.length - 1]?.message_id ?? first;
  const blank = { evidence_message_ids: [] as string[], checked_range: null, na_reason: null, review_reason: null, answer: null };

  return cl.criteria.map((c): CriterionResult => {
    const p = PREPARED[conv.conversation_id]?.[c.criterion_id];
    const fits = p && (p.status !== 'applicable' || qFor(c, p.answer) !== null) && (p.status !== 'not_applicable' || c.na_allowed);
    if (p && fits) return { criterion_id: c.criterion_id, ...clone(p) };

    if (c.required_evidence === 'audio') {
      const reason = conv.audio_url ? 'Критерий требует анализа звука — в тестовом режиме звук не анализируется.' : 'Критерий требует звука, а у диалога нет записи.';
      return { criterion_id: c.criterion_id, ...blank, status: 'needs_review', explanation: reason, review_reason: reason };
    }
    if (!ops.length) {
      const reason = 'Оператор не участвовал в разговоре.';
      return c.na_allowed
        ? { criterion_id: c.criterion_id, ...blank, status: 'not_applicable', explanation: reason, na_reason: reason }
        : { criterion_id: c.criterion_id, ...blank, status: 'needs_review', explanation: reason + ' Критерий не допускает N/A.', review_reason: reason, checked_range: { from_message_id: first, to_message_id: last } };
    }
    const h = seed(conv.conversation_id + c.criterion_id);
    let answer: string;
    if (c.answer_type === 'scale' && c.scale) {
      const steps = Math.floor((c.scale.max - c.scale.min) / c.scale.step);
      answer = String(c.scale.max - (h % Math.max(1, Math.ceil((steps + 1) / 2))) * c.scale.step);
    } else if (c.answer_type === 'yes_no') {
      answer = h % 10 < 7 ? (c.options[0]?.value ?? 'yes') : (c.options[c.options.length - 1]?.value ?? 'no');
    } else {
      answer = c.options[h % Math.max(1, c.options.length)]?.value ?? '';
    }
    return {
      criterion_id: c.criterion_id,
      ...blank,
      status: 'applicable',
      answer,
      explanation: 'Тестовый ответ без модели: значение сгенерировано детерминированно, чтобы проверить интерфейс.',
      evidence_message_ids: [ops[h % ops.length].message_id],
    };
  });
}

function checklistById(id: number) {
  const cl = db.checklists.find((c) => c.version_id === id);
  if (!cl) throw new ApiError(404, `Версия чек-листа ${id} не найдена`);
  return cl;
}

function conversationById(id: string) {
  const c = db.conversations.find((x) => x.conversation_id === id);
  if (!c) throw new ApiError(404, `Диалог ${id} не найден`);
  return c;
}

function newEvaluation(conversationId: string, versionId: number, created_at = now()): Evaluation {
  const cl = checklistById(versionId);
  const ev: Evaluation = {
    evaluation_id: ++db.seq.evaluation,
    conversation_id: conversationId,
    checklist_version_id: versionId,
    checklist_version: cl.version,
    status: 'queued',
    error: null,
    mode: 'mock',
    created_at,
    completed_at: null,
    revision: 0,
    ai_results: [],
    results: [],
    ai_score: null,
    score: null,
    usage: null,
    appeals: [],
  };
  db.evaluations.push(ev);
  return ev;
}

function complete(ev: Evaluation, at = now()) {
  const cl = checklistById(ev.checklist_version_id);
  const results = mockResults(conversationById(ev.conversation_id), cl);
  ev.ai_results = clone(results);
  ev.results = clone(results);
  ev.ai_score = computeScore(cl, results);
  ev.score = clone(ev.ai_score);
  ev.status = 'completed';
  ev.completed_at = at;
  ev.usage = { model: 'mock', prompt_version: null, calls: 0, input_tokens: null, output_tokens: null, cost_usd: 0, duration_ms: 0, problems: [] };
}

/** Запуск в фоне: queued → running → completed. */
function run(ev: Evaluation): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      ev.status = 'running';
      setTimeout(() => {
        if (ev.status === 'running') complete(ev);
        resolve();
      }, 900 + (seed(ev.conversation_id) % 900));
    }, 350);
  });
}

// ---------- Решение по апелляции ----------

function applyDecision(appeal: Appeal, body: Parameters<CqaApi['decide']>[1]) {
  const ev = db.evaluations.find((e) => e.evaluation_id === appeal.evaluation_id)!;
  if (appeal.status === 'decided') throw new ApiError(409, 'Решение по этой апелляции уже принято.');
  if (body.expected_revision !== ev.revision)
    throw new ApiError(409, `Оценка уже изменена (revision ${ev.revision}, у вас ${body.expected_revision}). Обновите карточку.`);
  if (!body.reason.trim()) throw new ApiError(422, 'Нужна причина решения.');

  const cl = checklistById(ev.checklist_version_id);
  const crit = cl.criteria.find((c) => c.criterion_id === appeal.criterion_id)!;
  const idx = ev.results.findIndex((r) => r.criterion_id === appeal.criterion_id);
  const before = clone(ev.results[idx]);
  let after = clone(before);

  if (body.action === 'change') {
    const st = body.new_status;
    if (!st) throw new ApiError(422, 'Укажите новый статус.');
    if (st === 'not_applicable' && !crit.na_allowed) throw new ApiError(422, 'Критерий не допускает N/A.');
    if (st === 'applicable' && qFor(crit, body.new_answer ?? null) === null) throw new ApiError(422, 'Недопустимый ответ для этого критерия.');
    after = {
      ...before,
      status: st,
      answer: st === 'applicable' ? (body.new_answer ?? null) : null,
      na_reason: st === 'not_applicable' ? body.reason : null,
      review_reason: st === 'needs_review' ? body.reason : null,
    };
  }

  const total_before = ev.score?.total ?? null;
  ev.results[idx] = after;
  ev.score = computeScore(cl, ev.results);
  ev.revision += 1;
  appeal.status = 'decided';
  appeal.decision = {
    action: body.action,
    reason: body.reason,
    new_status: body.action === 'change' ? (body.new_status ?? null) : null,
    new_answer: body.action === 'change' ? (body.new_answer ?? null) : null,
    decided_at: now(),
    before,
    after,
    total_before,
    total_after: ev.score.total,
  };
  return ev;
}

// ---------- Начальное состояние ----------

function seedState() {
  const at = (h: number, m: number) => `2026-11-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  const done = (id: string, v: number, t: string) => {
    const e = newEvaluation(id, v, t);
    complete(e, t);
    return e;
  };
  done('p1-ru-001', 1, at(7, 40));
  const e1 = done('p1-ru-001', 2, at(9, 20));
  done('p1-ru-002', 2, at(9, 22));
  const e3 = done('p1-ru-c01', 2, at(9, 25));
  done('p1-en-004', 2, at(9, 27));
  done('p1-ru-005', 2, at(9, 28));
  done('p1-en-c02', 2, at(9, 31));
  const kz = newEvaluation('p1-kz-007', 2, at(9, 33));
  kz.status = 'failed';
  kz.error = 'Модель не ответила за 60 с (2 попытки). Оценка не сохранена — запустите повторно.';

  const decided: Appeal = {
    appeal_id: ++db.seq.appeal,
    evaluation_id: e3.evaluation_id,
    conversation_id: 'p1-ru-c01',
    criterion_id: 'identification',
    criterion_title: 'Идентификация клиента',
    comment: 'Для входа в приложение достаточно номера телефона и привязки устройства — это не раскрытие данных счёта.',
    status: 'open',
    created_at: at(10, 5),
    decision: null,
  };
  db.appeals.push(decided);
  applyDecision(decided, { action: 'change', new_status: 'applicable', new_answer: 'yes', reason: 'По регламенту 4.2 номер телефона + привязка устройства достаточны для нетранзакционных запросов.', expected_revision: 0 });
  decided.decision!.decided_at = at(10, 41);

  db.appeals.push({
    appeal_id: ++db.seq.appeal,
    evaluation_id: e1.evaluation_id,
    conversation_id: 'p1-ru-001',
    criterion_id: 'politeness',
    criterion_title: 'Вежливость и эмпатия',
    comment: 'Оператор признал неудобство и сам предложил возврат комиссии — это не оправдание, а забота о клиенте.',
    status: 'open',
    created_at: at(10, 52),
    decision: null,
  });
}

// ---------- Импорт ----------

const SPEAKERS: Speaker[] = ['client', 'operator', 'bot', 'system'];

function importRecords(records: unknown[], group_id: string): ImportReport {
  const report: ImportReport = { group_id, total: records.length, created: 0, updated: 0, unchanged: 0, errors: [] };
  records.forEach((raw, i) => {
    const r = raw as Record<string, unknown>;
    const id = typeof r.conversation_id === 'string' ? r.conversation_id : null;
    if (!id) return void report.errors.push(`Запись #${i + 1}: нет conversation_id`);
    if (!Array.isArray(r.transcript)) return void report.errors.push(`${id}: transcript должен быть массивом`);
    const bad = (r.transcript as Array<Record<string, unknown>>).findIndex((m) => !SPEAKERS.includes(m.speaker as Speaker));
    if (bad >= 0) return void report.errors.push(`${id}: неизвестная роль в реплике ${bad + 1}`);
    const messages: Message[] = (r.transcript as Array<Record<string, string>>).map((m, index) => ({
      message_id: `m${String(index + 1).padStart(3, '0')}`,
      index,
      timestamp: String(m.timestamp ?? ''),
      speaker: m.speaker as Speaker,
      text: String(m.text ?? ''),
    }));
    const content_hash = String(seed(JSON.stringify(messages)));
    const existing = db.conversations.find((c) => c.conversation_id === id);
    if (existing && existing.content_hash === content_hash) return void report.unchanged++;
    const conv: Conversation = {
      conversation_id: id,
      group_id,
      channel: String(r.channel ?? 'agent chat'),
      language: String(r.language ?? 'RU'),
      audio_url: (r.audio_url as string | null) ?? null,
      content_hash,
      messages,
    };
    if (existing) {
      Object.assign(existing, conv);
      report.updated++;
    } else {
      db.conversations.push(conv);
      report.created++;
    }
  });
  return report;
}

// ---------- API ----------

function summary(c: Conversation): ConversationSummary {
  const evs = db.evaluations.filter((e) => e.conversation_id === c.conversation_id).sort((a, b) => b.evaluation_id - a.evaluation_id);
  const last = evs[0];
  const firstClient = c.messages.find((m) => m.speaker === 'client');
  return {
    conversation_id: c.conversation_id,
    group_id: c.group_id,
    channel: c.channel,
    language: c.language,
    message_count: c.messages.length,
    duration: null,
    preview: firstClient?.text ?? c.messages[0]?.text ?? '',
    has_audio: !!c.audio_url,
    last_evaluation: last
      ? {
          evaluation_id: last.evaluation_id,
          status: last.status,
          checklist_version: last.checklist_version,
          total: last.score?.total ?? null,
          critical_error: !!last.score?.critical_error,
          incomplete: last.status === 'completed' && last.score?.total === null,
          mode: last.mode,
        }
      : null,
    open_appeals: db.appeals.filter((a) => a.conversation_id === c.conversation_id && a.status === 'open').length,
  };
}

function withAppeals(e: Evaluation): Evaluation {
  return { ...e, appeals: db.appeals.filter((a) => a.evaluation_id === e.evaluation_id) };
}

function recount(b: Batch) {
  const c: Batch['counts'] = {};
  b.items.forEach((i) => (c[i.status] = (c[i.status] ?? 0) + 1));
  b.counts = c;
  b.done = c.completed ?? 0;
  b.failed = c.failed ?? 0;
  b.finished = (c.completed ?? 0) + (c.failed ?? 0) + (c.canceled ?? 0);
}

function batchTick(b: Batch) {
  if (b.status !== 'running') return;
  const CONCURRENCY = 2;
  const active = b.items.filter((i) => i.status === 'queued' || i.status === 'running').length;
  if (active === 0) {
    b.status = 'completed';
    return;
  }
  const runningNow = b.items.filter((i) => i.status === 'running').length;
  b.items
    .filter((i) => i.status === 'queued')
    .slice(0, Math.max(0, CONCURRENCY - runningNow))
    .forEach((item) => {
      item.status = 'running';
      const ev = newEvaluation(item.conversation_id, b.checklist_version_id!);
      item.evaluation_id = ev.evaluation_id;
      run(ev).then(() => {
        if (item.status !== 'running') return;
        item.status = ev.status;
        item.error = ev.error;
        recount(b);
        batchTick(b);
      });
    });
}

const raw: CqaApi = {
  async health() {
    await wait(60);
    return { evaluator_mode: 'mock', model: 'mock' };
  },
  async conversations() {
    await wait();
    return clone(db.conversations.map(summary));
  },
  async conversation(id) {
    await wait();
    return clone(conversationById(id));
  },
  async evaluations(id) {
    await wait();
    return clone(db.evaluations.filter((e) => e.conversation_id === id).sort((a, b) => b.evaluation_id - a.evaluation_id).map(withAppeals));
  },
  async evaluation(id) {
    await wait(80);
    const e = db.evaluations.find((x) => x.evaluation_id === id);
    if (!e) throw new ApiError(404, 'Оценка не найдена');
    return clone(withAppeals(e));
  },
  async evaluate(conversationId, versionId) {
    await wait();
    conversationById(conversationId);
    const ev = newEvaluation(conversationId, versionId);
    void run(ev);
    return clone(withAppeals(ev));
  },
  async checklists() {
    await wait();
    return clone(db.checklists);
  },
  async saveChecklist(draft) {
    await wait(300);
    const ids = new Set<string>();
    for (const c of draft.criteria) {
      if (ids.has(c.criterion_id)) throw new ApiError(422, `Повторяется criterion_id «${c.criterion_id}»`);
      ids.add(c.criterion_id);
    }
    if (!draft.criteria.length) throw new ApiError(422, 'В чек-листе нет критериев');
    const last = db.checklists[db.checklists.length - 1];
    const v: ChecklistVersion = { ...clone(draft), version_id: last.version_id + 1, version: last.version + 1, created_at: now() };
    db.checklists.push(v);
    return clone(v);
  },
  async appeals(q) {
    await wait();
    return clone(
      db.appeals
        .filter((a) => (!q?.status || a.status === q.status) && (!q?.evaluation_id || a.evaluation_id === q.evaluation_id))
        .sort((a, b) => b.appeal_id - a.appeal_id),
    );
  },
  async createAppeal(evaluationId, body) {
    await wait(220);
    const ev = db.evaluations.find((e) => e.evaluation_id === evaluationId);
    if (!ev || ev.status !== 'completed') throw new ApiError(409, 'Оспорить можно только завершённую оценку.');
    if (!body.comment.trim()) throw new ApiError(422, 'Нужен комментарий.');
    if (db.appeals.some((a) => a.evaluation_id === evaluationId && a.criterion_id === body.criterion_id && a.status === 'open'))
      throw new ApiError(409, 'По этому критерию уже есть открытая апелляция.');
    const crit = checklistById(ev.checklist_version_id).criteria.find((c: Criterion) => c.criterion_id === body.criterion_id);
    const a: Appeal = {
      appeal_id: ++db.seq.appeal,
      evaluation_id: evaluationId,
      conversation_id: ev.conversation_id,
      criterion_id: body.criterion_id,
      criterion_title: crit?.title,
      comment: body.comment.trim(),
      status: 'open',
      created_at: now(),
      decision: null,
    };
    db.appeals.push(a);
    return clone(a);
  },
  async decide(appeal, body) {
    await wait(260);
    const a = db.appeals.find((x) => x.appeal_id === appeal.appeal_id);
    if (!a) throw new ApiError(404, 'Апелляция не найдена');
    const ev = applyDecision(a, body);
    return { appeal: clone(a), evaluation: clone(withAppeals(ev)) };
  },
  async importFile(payload) {
    await wait(300);
    const p = payload as Record<string, unknown>;
    const data = (p?.data as Record<string, unknown>) ?? p;
    const records = Array.isArray(payload) ? payload : (data?.records as unknown[]);
    if (!Array.isArray(records)) throw new ApiError(422, 'Ожидается формат организаторов: { data: { records: [...] } } или массив записей.');
    return importRecords(records, String(data?.dataset_group_id ?? 'FILE'));
  },
  async importGroup(groupId) {
    await wait(400);
    if (groupId.trim().toUpperCase() !== 'DEV') throw new ApiError(502, 'Демо-режим: API организаторов недоступен. Импортируйте файл.');
    return { group_id: 'DEV', total: db.conversations.length, created: 0, updated: 0, unchanged: db.conversations.length, errors: [] };
  },
  async startBatch(ids, versionId) {
    await wait();
    checklistById(versionId);
    const b: Batch = {
      batch_id: `b${++db.seq.batch}`,
      checklist_version_id: versionId,
      checklist_version: checklistById(versionId).version,
      status: 'running',
      total: ids.length,
      done: 0,
      finished: 0,
      failed: 0,
      counts: { queued: ids.length },
      attempts: ids.length,
      cost_usd: 0,
      items: ids.map((conversation_id) => ({ conversation_id, evaluation_id: null, status: 'queued', error: null })),
    };
    db.batches.set(b.batch_id, b);
    batchTick(b);
    return clone(b);
  },
  async batch(id) {
    await wait(60);
    const b = db.batches.get(id);
    if (!b) throw new ApiError(404, 'Пакет не найден');
    recount(b);
    return clone(b);
  },
  async retryBatch(id) {
    await wait();
    const b = db.batches.get(id)!;
    b.items.forEach((i) => {
      if (i.status === 'failed' || i.status === 'canceled') {
        i.status = 'queued';
        i.error = null;
      }
    });
    b.status = 'running';
    b.attempts = (b.attempts ?? 0) + b.items.filter((i) => i.status === 'queued').length;
    recount(b);
    batchTick(b);
    return clone(b);
  },
  async cancelBatch(id) {
    await wait();
    const b = db.batches.get(id)!;
    b.items.forEach((i) => {
      if (i.status === 'queued') i.status = 'canceled';
    });
    b.status = 'canceled';
    recount(b);
    return clone(b);
  },
  async audio(id) {
    await wait(120);
    const c = conversationById(id);
    return { player_url: c.audio_url, media_url: null, media_type: null, error: c.audio_url ? 'Демо-режим: запись не загружается, используйте штатный плеер.' : 'У диалога нет записи.' };
  },
};

// Начальные данные создаются при первом обращении — в реальном режиме модуль ничего не делает.
let seeded = false;
export const mockApi: CqaApi = new Proxy(raw, {
  get(target, key: keyof CqaApi) {
    if (!seeded) {
      seeded = true;
      seedState();
    }
    return target[key];
  },
});
