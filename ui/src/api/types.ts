// Контракт данных — зеркало backend/cqa/models.py (владелец: Участник 1).
// Любое изменение models.py переносится сюда в том же коммите.

// ---------- Диалоги ----------

export type Speaker = 'client' | 'operator' | 'bot' | 'system';
export type Channel = 'agent chat' | 'voice call';
export type Language = 'RU' | 'KZ' | 'EN';

export interface Message {
  message_id: string; // m001, m002, …
  index: number;
  timestamp: string; // исходная метка: MM:SS у чатов, ISO 8601 у звонков
  speaker: Speaker;
  text: string;
}

export interface Conversation {
  conversation_id: string;
  group_id: string;
  channel: string;
  language: string;
  audio_url: string | null;
  content_hash: string;
  messages: Message[];
}

// ---------- Чек-лист ----------

export type AnswerType = 'yes_no' | 'single_choice' | 'scale';

export interface AnswerOption {
  value: string;
  label: string;
  score: number; // нормализованный балл q, 0..1
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  map?: Record<string, number> | null;
}

export interface Criterion {
  criterion_id: string;
  title: string;
  instruction: string;
  section_id: string | null;
  weight: number;
  answer_type: AnswerType;
  options: AnswerOption[];
  scale: Scale | null;
  na_allowed: boolean;
  na_rule: string | null;
  is_critical: boolean;
  critical_values: string[];
  required_evidence: 'text' | 'audio';
}

export interface Section {
  section_id: string;
  title: string;
  weight: number | null;
}

export interface ScoringRules {
  rounding_digits: number;
  critical_policy: 'flag_only' | 'zero_total';
  aggregation: 'flat' | 'weighted_sections';
}

export interface ChecklistDraft {
  checklist_id: string;
  name: string;
  is_official: boolean;
  rules: ScoringRules;
  sections: Section[];
  criteria: Criterion[];
}

export interface ChecklistVersion extends ChecklistDraft {
  version_id: number;
  version: number;
  created_at: string;
}

// ---------- Ответ ИИ ----------

export type CriterionStatus = 'applicable' | 'not_applicable' | 'needs_review';

export interface CheckedRange {
  from_message_id: string;
  to_message_id: string;
}

export interface CriterionResult {
  criterion_id: string;
  status: CriterionStatus;
  answer: string | null;
  explanation: string;
  evidence_message_ids: string[];
  checked_range: CheckedRange | null;
  na_reason: string | null;
  review_reason: string | null;
}

// ---------- Итог (калькулятор, Участник 4) ----------

export interface CriterionScore {
  criterion_id: string;
  status: CriterionStatus;
  answer: string | null;
  weight: number;
  q: number | null;
  effective_weight: number | null;
  contribution: number | null;
  is_critical_hit: boolean;
}

export interface SectionScore {
  section_id: string;
  total: number | null;
}

export interface ScoreResult {
  total: number | null; // null ≠ 0: итог не определён
  incomplete_reason: string | null;
  critical_error: boolean;
  critical_criteria: string[];
  criteria: CriterionScore[];
  sections: SectionScore[];
}

// ---------- Оценка, апелляции ----------

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface AppealCreate {
  criterion_id: string;
  comment: string;
}

export interface DecisionCreate {
  action: 'confirm' | 'change';
  reason: string;
  expected_revision: number;
  new_status?: CriterionStatus | null;
  new_answer?: string | null;
}

// =====================================================================
// Ниже — то, как UI видит ответы API. Сырые ответы (docs/API_CONTRACT.md)
// приводятся к этим типам в src/api/http.ts — менять UI при правке контракта не нужно.
// =====================================================================

export interface Health {
  evaluator_mode: 'mock' | 'real';
  model: string;
}

export interface Usage {
  model: string;
  prompt_version: string | null;
  calls: number; // число вызовов модели, включая повторы
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null; // null = неизвестно (≠ $0)
  duration_ms: number | null;
  problems: string[]; // usage.problems: повторы, невалидный JSON, таймауты
}

export interface Evaluation {
  evaluation_id: number;
  conversation_id: string;
  checklist_version_id: number;
  checklist_version: number;
  status: JobStatus;
  error: string | null;
  mode: 'mock' | 'real';
  created_at: string | null;
  completed_at: string | null;
  revision: number; // растёт с каждым решением проверяющего
  ai_results: CriterionResult[]; // исходник ИИ — не меняется
  results: CriterionResult[]; // final_results — после решений
  ai_score: ScoreResult | null;
  score: ScoreResult | null; // final_score
  usage: Usage | null;
  appeals: Appeal[];
}

export type ResultValue = Pick<CriterionResult, 'status' | 'answer'>;

export interface Decision {
  action: 'confirm' | 'change';
  reason: string;
  new_status: CriterionStatus | null;
  new_answer: string | null;
  decided_at: string | null;
  before: ResultValue;
  after: ResultValue;
  total_before: number | null;
  total_after: number | null;
}

export interface Appeal {
  appeal_id: number;
  evaluation_id: number;
  conversation_id: string;
  criterion_id: string;
  criterion_title?: string;
  comment: string;
  status: 'open' | 'decided'; // open | confirmed/changed
  created_at: string | null;
  decision: Decision | null;
}

export interface ConversationSummary {
  conversation_id: string;
  group_id: string;
  channel: string;
  language: string;
  message_count: number;
  duration: string | null;
  preview: string;
  has_audio: boolean;
  last_evaluation: {
    evaluation_id: number;
    status: JobStatus;
    checklist_version: number;
    total: number | null;
    critical_error: boolean;
    incomplete: boolean;
    mode: 'mock' | 'real';
  } | null;
  open_appeals: number;
}

export interface ImportReport {
  group_id: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export interface BatchItem {
  conversation_id: string;
  evaluation_id: number | null;
  status: JobStatus;
  error: string | null;
}

export interface Batch {
  batch_id: string;
  checklist_version_id: number | null;
  checklist_version: number | null;
  status: 'running' | 'completed' | 'canceled';
  total: number;
  done: number; // поле done из GET /batches/{id}
  finished: number; // завершено любым исходом (для полосы прогресса)
  failed: number;
  counts: Partial<Record<JobStatus, number>>;
  attempts: number | null;
  cost_usd: number | null;
  items: BatchItem[];
}

export interface AudioInfo {
  player_url: string | null;
  media_url: string | null; // только если сервер проверил audio/*
  media_type: string | null;
  error: string | null;
}

export interface AppealsQuery {
  status?: 'open' | 'decided';
  evaluation_id?: number;
}

/** Всё, что UI просит у сервера. Реализации: http.ts (настоящий API) и mock/ (демо). */
export interface CqaApi {
  health(): Promise<Health>;
  conversations(): Promise<ConversationSummary[]>;
  conversation(id: string): Promise<Conversation>;
  evaluations(conversationId: string): Promise<Evaluation[]>; // новые первыми
  evaluation(evaluationId: number): Promise<Evaluation>;
  evaluate(conversationId: string, checklistVersionId: number): Promise<Evaluation>;
  checklists(): Promise<ChecklistVersion[]>; // по возрастанию версии
  saveChecklist(draft: ChecklistDraft): Promise<ChecklistVersion>;
  appeals(query?: AppealsQuery): Promise<Appeal[]>;
  createAppeal(evaluationId: number, body: AppealCreate): Promise<Appeal>;
  decide(appeal: Appeal, body: DecisionCreate): Promise<{ appeal: Appeal; evaluation: Evaluation }>;
  importFile(payload: unknown): Promise<ImportReport>;
  importGroup(groupId: string): Promise<ImportReport>;
  startBatch(conversationIds: string[], checklistVersionId: number): Promise<Batch>;
  batch(batchId: string): Promise<Batch>;
  retryBatch(batchId: string): Promise<Batch>;
  cancelBatch(batchId: string): Promise<Batch>;
  audio(conversationId: string): Promise<AudioInfo>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
