// Карточка критерия: ответ, вес, объяснение, доказательства, N/A / нужна проверка, апелляция.
import { forwardRef } from 'react';
import { AlertOctagon, ArrowRight, AudioLines, Crosshair, Eye, EyeOff, ScanSearch, UserCheck } from 'lucide-react';
import type { Appeal, Criterion, CriterionResult, CriterionScore, Evaluation, Message } from '../../api';
import { Chip, Tag } from '../../components/ui';
import { cn, SPEAKER } from '../../lib/format';
import type { Role } from '../../lib/hooks';
import { AppealForm, DecisionForm, DecisionSummary, OpenAppealNote, ResultValue } from './Appeal';
import type { Focus } from './Transcript';

interface Props {
  criterion: Criterion;
  result: CriterionResult;
  aiResult: CriterionResult | undefined;
  score: CriterionScore | undefined;
  evaluation: Evaluation;
  messages: Map<string, Message>;
  timeOf: (m: Message) => string;
  appeals: Appeal[];
  role: Role;
  focus: Focus | null;
  canAppeal: boolean;
  onFocus: (f: { all?: boolean; single?: string; range?: boolean }) => void;
  onAppealCreated: (a: Appeal) => void;
  onDecided: (r: { appeal: Appeal; evaluation: Evaluation }) => void;
  onReload: () => void;
}

export const CriterionCard = forwardRef<HTMLElement, Props>(function CriterionCard(
  { criterion: c, result: r, aiResult, score, evaluation, messages, timeOf, appeals, role, focus, canAppeal, onFocus, onAppealCreated, onDecided, onReload },
  ref,
) {
  const active = focus?.criterionId === c.criterion_id;
  const evidence = r.evidence_message_ids;
  const changed = aiResult && (aiResult.status !== r.status || aiResult.answer !== r.answer);
  const openAppeal = appeals.find((a) => a.status === 'open');
  const decided = appeals.filter((a) => a.status === 'decided');
  const isNA = r.status === 'not_applicable';
  const review = r.status === 'needs_review';

  const accent = isNA ? 'before:bg-na/50' : review ? 'before:bg-warn' : score?.is_critical_hit ? 'before:bg-bad' : score?.q === null || score?.q === undefined ? 'before:bg-na/50' : score.q >= 0.8 ? 'before:bg-ok' : score.q >= 0.5 ? 'before:bg-warn' : 'before:bg-bad';

  return (
    <article
      ref={ref}
      id={`crit-${c.criterion_id}`}
      className={cn(
        'relative scroll-m-24 overflow-hidden rounded-xl border bg-surface pl-1 transition-all',
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        accent,
        active ? 'border-hl shadow-card ring-4 ring-hl/25' : isNA ? 'border-dashed border-line-strong' : review ? 'border-warn/40' : 'border-line shadow-card',
      )}
    >
      <div className="px-4 py-3.5">
        {/* Заголовок */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-3">
              <Tag mono>{c.criterion_id}</Tag>
              <span>
                вес <b className="font-semibold text-fg-2 tabular-nums">{c.weight}</b>
                {score?.effective_weight !== null && score?.effective_weight !== undefined && (
                  <>
                    {' '}
                    → <b className="font-semibold text-fg-2 tabular-nums">{score.effective_weight}%</b> итога
                  </>
                )}
              </span>
              {c.required_evidence === 'audio' && <Chip tone="accent" icon={AudioLines}>нужен звук</Chip>}
              {c.is_critical && !score?.is_critical_hit && <span className="text-fg-3">· критичный</span>}
            </div>
            <h3 className={cn('mt-1 text-[15px] font-semibold leading-snug', isNA && 'text-fg-2')}>{c.title}</h3>
          </div>
          <div className="flex flex-col items-end gap-1">
            {changed && aiResult ? (
              <div className="flex items-center gap-1.5">
                <ResultValue c={c} r={aiResult} struck />
                <ArrowRight className="h-3.5 w-3.5 text-fg-3" />
                <ResultValue c={c} r={r} />
              </div>
            ) : (
              <ResultValue c={c} r={r} />
            )}
            {score?.contribution !== null && score?.contribution !== undefined && <span className="text-[11px] tabular-nums text-fg-3">+{score.contribution} п.</span>}
          </div>
        </div>

        {score?.is_critical_hit && (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-bad-weak px-3 py-2 text-[13px] font-medium text-bad">
            <AlertOctagon className="h-4 w-4 shrink-0" /> Грубая ошибка
          </div>
        )}

        <p className="mt-2.5 text-[13.5px] leading-relaxed text-fg-2">{r.explanation}</p>

        {isNA && r.na_reason && r.na_reason !== r.explanation && (
          <div className="mt-2 rounded-lg bg-na-weak px-3 py-2 text-[13px] text-na">
            <b className="font-semibold">Почему N/A:</b> {r.na_reason}
          </div>
        )}
        {isNA && <p className="mt-1.5 text-[11.5px] text-fg-3">Не входит в знаменатель — вес перераспределён между применимыми критериями.</p>}
        {review && r.review_reason && r.review_reason !== r.explanation && (
          <div className="mt-2 rounded-lg bg-warn-weak px-3 py-2 text-[13px] text-warn">
            <b className="font-semibold">Нужна проверка:</b> {r.review_reason}
          </div>
        )}

        {changed && aiResult && (
          <div className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-fg-3">
            <UserCheck className="mt-px h-3.5 w-3.5 shrink-0 text-warn" />
            <span>
              <b className="font-semibold text-warn">Изменено проверяющим.</b> Объяснение выше — исходное от ИИ; оценка ИИ сохранена и зачёркнута.
            </span>
          </div>
        )}

        {/* Доказательства */}
        {(evidence.length > 0 || r.checked_range) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {evidence.length > 0 && (
              <button
                type="button"
                onClick={() => onFocus({ all: true })}
                aria-pressed={active && !focus?.single && !!focus?.ids.length}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition',
                  active && !focus?.single ? 'border-hl bg-hl/20 text-fg' : 'border-line-strong bg-surface text-fg-2 hover:border-accent hover:text-accent',
                )}
              >
                {active && !focus?.single ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {active && !focus?.single ? 'Скрыть' : 'Показать в диалоге'}
              </button>
            )}
            {evidence.map((id) => {
              const m = messages.get(id);
              const on = active && focus?.single === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onFocus({ single: id })}
                  title={m ? m.text : 'Реплика не найдена в диалоге'}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-lg border px-2 font-mono text-[11.5px] transition',
                    !m ? 'border-bad/40 bg-bad-weak text-bad' : on ? 'border-hl bg-hl/20 text-fg' : 'border-line bg-surface-2 text-accent hover:border-accent',
                  )}
                >
                  <Crosshair className="h-3 w-3" />
                  {id}
                  {m && <span className="font-sans text-fg-3">· {SPEAKER[m.speaker]} {timeOf(m)}</span>}
                </button>
              );
            })}
            {r.checked_range && (
              <button
                type="button"
                onClick={() => onFocus({ range: true })}
                className={cn('inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11.5px] font-medium transition', active && focus?.range && !focus.ids.length ? 'border-warn bg-warn-weak text-warn' : 'border-warn/40 bg-surface text-warn hover:bg-warn-weak')}
                title="Участок, где оценщик искал действие и не нашёл"
              >
                <ScanSearch className="h-3.5 w-3.5" />
                Проверен участок <span className="font-mono">{r.checked_range.from_message_id}–{r.checked_range.to_message_id}</span>
              </button>
            )}
          </div>
        )}
        {!evidence.length && !r.checked_range && r.status === 'applicable' && <p className="mt-2 text-xs text-bad">Нет ссылки на реплику — оценку нужно проверить.</p>}

        {/* Апелляции */}
        {(openAppeal || decided.length > 0 || (role === 'operator' && canAppeal)) && (
          <div className="mt-3.5 space-y-2.5 border-t border-line pt-3.5">
            {decided.map((a) => (
              <DecisionSummary key={a.appeal_id} appeal={a} criterion={c} />
            ))}
            {openAppeal && <OpenAppealNote appeal={openAppeal} />}
            {openAppeal && role === 'reviewer' && <DecisionForm appeal={openAppeal} evaluation={evaluation} criterion={c} current={r} onDecided={onDecided} onReload={onReload} />}
            {!openAppeal && role === 'operator' && canAppeal && <AppealForm evaluation={evaluation} criterion={c} onCreated={onAppealCreated} />}
          </div>
        )}
      </div>
    </article>
  );
});
