import type { Criterion, CriterionStatus, JobStatus, Message } from '../api/types';

export const LANG: Record<string, string> = { RU: 'Русский', KZ: 'Қазақша', EN: 'English' };
export const CHANNEL: Record<string, string> = { 'agent chat': 'Чат', 'voice call': 'Звонок' };
export const SPEAKER: Record<string, string> = { client: 'Клиент', operator: 'Оператор', bot: 'Бот AIM', system: 'Система' };
export const STATUS_LABEL: Record<CriterionStatus, string> = { applicable: 'Оценён', not_applicable: 'N/A', needs_review: 'Нужна проверка' };
export const JOB_LABEL: Record<JobStatus, string> = { queued: 'В очереди', running: 'Оценивается', completed: 'Готово', failed: 'Ошибка', canceled: 'Отменено' };
export const ANSWER_TYPE_LABEL = { yes_no: 'Да / Нет', single_choice: 'Выбор варианта', scale: 'Шкала' } as const;

export type Tone = 'ok' | 'warn' | 'bad' | 'na' | 'accent' | 'neutral';

/** null → «—», никогда не 0. */
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v.toFixed(2))}%`);
export const toneOf = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'na' : v >= 80 ? 'ok' : v >= 50 ? 'warn' : 'bad');
export const toneOfQ = (q: number | null | undefined): Tone => toneOf(q === null || q === undefined ? null : q * 100);

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

/** Короткая метка для бабла: MM:SS у чатов, HH:MM:SS у звонков (в исходном поясе). */
export function shortTime(ts: string) {
  const m = ISO.exec(ts);
  return m ? m[2] : ts;
}

function seconds(ts: string): number | null {
  const iso = ISO.exec(ts);
  if (iso) return Date.parse(ts) / 1000;
  const mmss = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(ts);
  if (!mmss) return null;
  return mmss[3] !== undefined ? +mmss[1] * 3600 + +mmss[2] * 60 + +mmss[3] : +mmss[1] * 60 + +mmss[2];
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Смещение реплики от начала разговора (для звонков с ISO-временем). */
export function offset(ts: string, first: string) {
  const a = seconds(first);
  const b = seconds(ts);
  return a === null || b === null ? null : mmss(Math.max(0, b - a));
}

export function duration(messages: Message[]) {
  if (!messages.length) return null;
  const a = seconds(messages[0].timestamp);
  const b = seconds(messages[messages.length - 1].timestamp);
  if (a === null || b === null) return null;
  return ISO.test(messages[0].timestamp) ? mmss(b - a) : mmss(b);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function dateTime(iso: string | null | undefined, withYear = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Подпись ответа: «Да», «Частично», «4 из 5». */
export function answerLabel(c: Criterion | undefined, answer: string | null) {
  if (answer === null) return '—';
  if (!c) return answer;
  if (c.answer_type === 'scale' && c.scale) return `${answer} из ${c.scale.max}`;
  return c.options.find((o) => o.value === answer)?.label ?? answer;
}

/** Все допустимые ответы критерия (для формы решения и грубых ошибок). */
export function answerChoices(c: Criterion): Array<{ value: string; label: string }> {
  if (c.answer_type === 'scale' && c.scale) {
    const out: Array<{ value: string; label: string }> = [];
    const step = c.scale.step > 0 ? c.scale.step : 1;
    for (let v = c.scale.min; v <= c.scale.max + 1e-9 && out.length < 101; v += step) out.push({ value: String(v), label: String(v) });
    return out;
  }
  return c.options.map((o) => ({ value: o.value, label: o.label }));
}

export function money(v: number | null | undefined) {
  if (v === null || v === undefined) return 'неизвестно';
  return v === 0 ? '$0' : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
}

export const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Нормализованный балл ответа (для цвета в UI; итог считает сервер). */
export function qFor(c: Criterion, answer: string | null): number | null {
  if (answer === null || answer === undefined) return null;
  if (c.answer_type === 'scale' && c.scale) {
    if (c.scale.map && answer in c.scale.map) return c.scale.map[answer];
    const v = Number(answer);
    if (!Number.isFinite(v) || c.scale.max === c.scale.min) return null;
    return Math.min(1, Math.max(0, (v - c.scale.min) / (c.scale.max - c.scale.min)));
  }
  const o = c.options.find((x) => x.value === answer);
  return o ? o.score : null;
}

