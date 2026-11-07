// Адаптер настоящего API — docs/API_CONTRACT.md (владелец контракта: Участник 1).
// Сырые ответы сервера приводятся здесь к типам UI (types.ts). Если контракт меняется —
// правится только этот файл.
import {
  ApiError,
  type Appeal,
  type AudioInfo,
  type Batch,
  type BatchItem,
  type ChecklistVersion,
  type Conversation,
  type ConversationSummary,
  type CqaApi,
  type CriterionResult,
  type Evaluation,
  type ImportReport,
  type JobStatus,
  type ResultValue,
} from './types';

/** Базовый адрес API. По контракту — http://localhost:8000/api; при раздаче UI самим FastAPI можно задать «/api». */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8000/api').replace(/\/+$/, '');

const enc = encodeURIComponent;
const ROUTES = {
  health: () => `/health`,
  importOrganizer: () => `/import/organizer`,
  importJson: () => `/import/json`,
  conversations: () => `/conversations`,
  conversation: (id: string) => `/conversations/${enc(id)}`,
  audio: (id: string) => `/conversations/${enc(id)}/audio`,
  checklists: () => `/checklists`,
  evaluations: () => `/evaluations`,
  evaluationsBatch: () => `/evaluations/batch`,
  evaluation: (id: number) => `/evaluations/${id}`,
  evaluationAppeals: (id: number) => `/evaluations/${id}/appeals`,
  batch: (id: string) => `/batches/${enc(id)}`,
  batchRetry: (id: string) => `/batches/${enc(id)}/retry`,
  batchCancel: (id: string) => `/batches/${enc(id)}/cancel`,
  appeals: () => `/appeals`,
  decision: (id: number) => `/appeals/${id}/decision`,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

async function request<T = Raw>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: init?.method ?? 'GET',
      headers: { Accept: 'application/json', ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError(0, `Сервер недоступен (${API_BASE}). Запущен ли uvicorn на :8000?`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      const d = body?.detail ?? body?.error ?? body;
      message = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: Raw) => x.msg ?? JSON.stringify(x)).join('; ') : JSON.stringify(d);
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Параллельно, но не больше n запросов одновременно. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ---------- Версии чек-листа (кеш: нужен номер версии по version_id) ----------

let versions: ChecklistVersion[] | null = null;
async function loadVersions(force = false): Promise<ChecklistVersion[]> {
  if (!versions || force) {
    const raw = await request<ChecklistVersion[]>(ROUTES.checklists());
    versions = [...raw].sort((a, b) => a.version - b.version); // сервер отдаёт новые сверху
  }
  return versions;
}
const versionNo = (vs: ChecklistVersion[], id: number | null | undefined) => vs.find((v) => v.version_id === id)?.version ?? id ?? 0;

// ---------- Приведение ответов ----------

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof (v as Raw).message === 'string' ? (v as Raw).message : JSON.stringify(v));

function toAppeal(a: Raw, ev: { evaluation_id?: number; conversation_id?: string; ai_results?: CriterionResult[] }): Appeal {
  const ai = ev.ai_results?.find((r) => r.criterion_id === a.criterion_id);
  const decided = a.status && a.status !== 'open';
  const action: 'confirm' | 'change' = a.action === 'change' || a.status === 'changed' ? 'change' : 'confirm';
  const before: ResultValue = {
    status: a.old_status ?? ai?.status ?? 'applicable',
    answer: a.old_answer !== undefined ? a.old_answer : (ai?.answer ?? null),
  };
  const after: ResultValue =
    action === 'change'
      ? { status: a.new_status ?? before.status, answer: a.new_answer !== undefined ? a.new_answer : before.answer }
      : before;
  return {
    appeal_id: a.appeal_id,
    evaluation_id: a.evaluation_id ?? ev.evaluation_id,
    conversation_id: a.conversation_id ?? ev.conversation_id ?? '',
    criterion_id: a.criterion_id,
    criterion_title: a.criterion_title,
    comment: a.comment ?? '',
    status: decided ? 'decided' : 'open',
    created_at: a.created_at ?? null,
    decision: decided
      ? {
          action,
          reason: a.decision_reason ?? a.reason ?? '',
          new_status: action === 'change' ? after.status : null,
          new_answer: action === 'change' ? after.answer : null,
          decided_at: a.decided_at ?? null,
          before,
          after,
          total_before: num(a.old_total),
          total_after: num(a.new_total),
        }
      : null,
  };
}

function toEvaluation(r: Raw, vs: ChecklistVersion[]): Evaluation {
  const ai: CriterionResult[] = r.ai_results ?? [];
  const calls: Raw[] = Array.isArray(r.usage?.calls) ? r.usage.calls : [];
  const sum = (keys: string[]) => {
    let total = 0;
    let seen = false;
    for (const c of calls)
      for (const k of keys)
        if (num(c[k]) !== null) {
          total += c[k];
          seen = true;
          break;
        }
    return seen ? total : null;
  };
  const ev: Evaluation = {
    evaluation_id: r.evaluation_id,
    conversation_id: r.conversation_id,
    checklist_version_id: r.checklist_version_id,
    checklist_version: versionNo(vs, r.checklist_version_id),
    status: (r.status ?? 'queued') as JobStatus,
    error: r.error ?? null,
    mode: r.mode === 'mock' ? 'mock' : 'real',
    created_at: r.created_at ?? null,
    completed_at: r.completed_at ?? r.finished_at ?? null,
    revision: r.revision ?? 0,
    ai_results: ai,
    results: r.final_results ?? ai,
    ai_score: r.ai_score ?? null,
    score: r.final_score ?? r.ai_score ?? null,
    usage:
      r.status === 'completed' || r.status === 'failed' || calls.length
        ? {
            model: r.model ?? calls[0]?.model ?? '—',
            prompt_version: r.prompt_version ?? null,
            calls: calls.length,
            input_tokens: sum(['input_tokens', 'prompt_tokens']),
            output_tokens: sum(['output_tokens', 'completion_tokens']),
            cost_usd: num(r.cost_usd),
            duration_ms: sum(['duration_ms', 'latency_ms', 'elapsed_ms']),
            problems: (Array.isArray(r.usage?.problems) ? r.usage.problems : []).map(text),
          }
        : null,
    appeals: [],
  };
  ev.appeals = (r.appeals ?? []).map((a: Raw) => toAppeal(a, ev));
  return ev;
}

function toConversation(r: Raw): Conversation {
  return {
    conversation_id: r.conversation_id,
    group_id: r.group_id ?? '',
    channel: r.channel,
    language: r.language,
    audio_url: r.audio_url ?? null,
    content_hash: r.content_hash ?? '',
    messages: r.messages ?? [],
  };
}

function toImport(r: Raw, groupId: string): ImportReport {
  return {
    group_id: r.group_id ?? groupId,
    total: r.total ?? 0,
    created: r.new ?? 0,
    updated: r.updated ?? 0,
    unchanged: r.unchanged ?? 0,
    errors: (r.errors ?? []).map(text),
  };
}

const ACTIVE: JobStatus[] = ['queued', 'running'];
const FINAL: JobStatus[] = ['completed', 'failed', 'canceled'];

function toBatch(r: Raw, batchId: string, vs: ChecklistVersion[]): Batch {
  const items: BatchItem[] = (r.items ?? []).map((i: Raw) => ({
    conversation_id: i.conversation_id,
    evaluation_id: i.evaluation_id ?? null,
    status: (i.status ?? 'queued') as JobStatus,
    error: i.error ?? null,
  }));
  // failed[] — id диалогов или объекты {conversation_id, error}: дополняем ошибки в items
  for (const f of (r.failed ?? []) as Array<string | Raw>) {
    const id = typeof f === 'string' ? f : f.conversation_id;
    const it = items.find((x) => x.conversation_id === id);
    if (it && typeof f !== 'string' && f.error && !it.error) it.error = text(f.error);
    if (!it && id) items.push({ conversation_id: id, evaluation_id: typeof f === 'string' ? null : (f.evaluation_id ?? null), status: 'failed', error: typeof f === 'string' ? null : text(f.error) || null });
  }
  const counts: Partial<Record<JobStatus, number>> = { ...(r.counts ?? {}) };
  for (const s of [...ACTIVE, ...FINAL]) if (counts[s] === undefined && items.length) counts[s] = items.filter((i) => i.status === s).length;
  const total = r.total ?? items.length;
  const active = (counts.queued ?? 0) + (counts.running ?? 0);
  const finished = (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.canceled ?? 0);
  return {
    batch_id: String(r.batch_id ?? batchId),
    checklist_version_id: r.checklist_version_id ?? null,
    checklist_version: r.checklist_version_id ? versionNo(vs, r.checklist_version_id) : null,
    status: active > 0 ? 'running' : (counts.canceled ?? 0) > 0 && (counts.completed ?? 0) + (counts.failed ?? 0) < total ? 'canceled' : 'completed',
    total,
    done: r.done ?? counts.completed ?? 0,
    finished: Math.min(total, finished || Math.max(0, total - active)),
    failed: counts.failed ?? 0,
    counts,
    attempts: num(r.attempts),
    cost_usd: num(r.cost_usd),
    items,
  };
}

// ---------- API ----------

async function getEvaluation(id: number): Promise<Evaluation> {
  const [raw, vs] = await Promise.all([request(ROUTES.evaluation(id)), loadVersions()]);
  if (!vs.some((v) => v.version_id === raw.checklist_version_id)) return toEvaluation(raw, await loadVersions(true));
  return toEvaluation(raw, vs);
}

// GET /batches/{id} не возвращает версию чек-листа — запоминаем её при запуске (и между перезагрузками)
const batchVersion = (id: string, v?: number): number | null => {
  try {
    if (v !== undefined) localStorage.setItem(`cqa-batch-v:${id}`, String(v));
    const s = localStorage.getItem(`cqa-batch-v:${id}`);
    return s ? Number(s) : null;
  } catch {
    return v ?? null;
  }
};

async function getBatch(id: string): Promise<Batch> {
  const [raw, vs] = await Promise.all([request(ROUTES.batch(id)), loadVersions()]);
  return toBatch({ checklist_version_id: batchVersion(id), ...raw }, id, vs);
}

export const httpApi: CqaApi = {
  async health() {
    const r = await request(ROUTES.health());
    return { evaluator_mode: r.evaluator_mode === 'mock' ? 'mock' : 'real', model: r.model ?? '—' };
  },

  // Список не содержит итогов — подтягиваем последнюю оценку каждого диалога (до 6 запросов параллельно).
  async conversations() {
    const [list, vs] = await Promise.all([request<Raw[]>(ROUTES.conversations()), loadVersions()]);
    const lastEvals = await pool(list, 6, (c) => (c.last_evaluation_id ? getEvaluation(c.last_evaluation_id).catch(() => null) : Promise.resolve(null)));
    return list.map((c, i): ConversationSummary => {
      const e = lastEvals[i];
      return {
        conversation_id: c.conversation_id,
        group_id: c.group_id ?? '',
        channel: c.channel,
        language: c.language,
        message_count: c.message_count ?? 0,
        duration: null,
        preview: c.preview ?? '',
        has_audio: !!c.audio_url,
        last_evaluation: e
          ? {
              evaluation_id: e.evaluation_id,
              status: e.status,
              checklist_version: versionNo(vs, e.checklist_version_id),
              total: e.score?.total ?? null,
              critical_error: !!e.score?.critical_error,
              incomplete: e.status === 'completed' && (e.score?.total ?? null) === null,
              mode: e.mode,
            }
          : null,
        open_appeals: e ? e.appeals.filter((a) => a.status === 'open').length : 0,
      };
    });
  },

  async conversation(id) {
    return toConversation(await request(ROUTES.conversation(id)));
  },

  async evaluations(id) {
    const raw = await request(ROUTES.conversation(id));
    const ids: number[] = (raw.evaluations ?? []).map((e: Raw) => (typeof e === 'number' ? e : e.evaluation_id)).filter((x: unknown) => typeof x === 'number');
    const list = await pool(ids, 4, getEvaluation);
    return list.sort((a, b) => b.evaluation_id - a.evaluation_id);
  },

  evaluation: getEvaluation,

  async evaluate(conversation_id, checklist_version_id) {
    const r = await request(ROUTES.evaluations(), { method: 'POST', json: { conversation_id, checklist_version_id } });
    return getEvaluation(r.evaluation_id);
  },

  async checklists() {
    return [...(await loadVersions(true))];
  },

  async saveChecklist(draft) {
    const r = await request(ROUTES.checklists(), { method: 'POST', json: draft });
    const vs = await loadVersions(true);
    return vs.find((v) => v.version_id === r.version_id) ?? (r as ChecklistVersion);
  },

  async appeals(q) {
    if (q?.evaluation_id) {
      const e = await getEvaluation(q.evaluation_id);
      return e.appeals.filter((a) => !q.status || a.status === q.status);
    }
    const raw = await request<Raw[]>(ROUTES.appeals() + (q?.status === 'open' ? '?status=open' : ''));
    return raw
      .map((a) => toAppeal(a, {}))
      .filter((a) => !q?.status || a.status === q.status)
      .sort((a, b) => b.appeal_id - a.appeal_id);
  },

  async createAppeal(evaluationId, body) {
    const r = await request(ROUTES.evaluationAppeals(evaluationId), { method: 'POST', json: body });
    const e = await getEvaluation(evaluationId);
    return e.appeals.find((a) => a.appeal_id === r.appeal_id) ?? toAppeal({ ...body, ...r }, e);
  },

  // Ответ {revision, final_score}; 409 — устаревшая revision или повторное решение (ApiError.status === 409).
  async decide(appeal, body) {
    await request(ROUTES.decision(appeal.appeal_id), { method: 'POST', json: body });
    const evaluation = await getEvaluation(appeal.evaluation_id);
    const updated = evaluation.appeals.find((a) => a.appeal_id === appeal.appeal_id) ?? appeal;
    return { appeal: updated, evaluation };
  },

  async importFile(payload) {
    const groupId = String((payload as Raw)?.data?.dataset_group_id ?? 'FILE');
    return toImport(await request(ROUTES.importJson(), { method: 'POST', json: payload }), groupId);
  },

  async importGroup(group_id) {
    return toImport(await request(ROUTES.importOrganizer(), { method: 'POST', json: { group_id } }), group_id);
  },

  async startBatch(conversation_ids, checklist_version_id) {
    const r = await request(ROUTES.evaluationsBatch(), { method: 'POST', json: { checklist_version_id, conversation_ids } });
    batchVersion(String(r.batch_id), checklist_version_id);
    return getBatch(String(r.batch_id));
  },

  batch: getBatch,

  async retryBatch(id) {
    await request(ROUTES.batchRetry(id), { method: 'POST' });
    return getBatch(id);
  },

  async cancelBatch(id) {
    await request(ROUTES.batchCancel(id), { method: 'POST' });
    return getBatch(id);
  },

  async audio(id) {
    const r = await request<AudioInfo>(ROUTES.audio(id));
    return { player_url: r.player_url ?? null, media_url: r.media_url ?? null, media_type: r.media_type ?? null, error: r.error ?? null };
  },
};
