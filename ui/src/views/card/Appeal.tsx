// Апелляция (пользователь) и решение (проверяющий). Используется в карточке и в разделе «Апелляции».
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Gavel, MessageSquareWarning, RefreshCw, Send, ShieldAlert } from 'lucide-react';
import { api, ApiError, type Appeal, type Criterion, type CriterionResult, type CriterionStatus, type Evaluation } from '../../api';
import { Alert, Button, Chip, NABadge, Segmented } from '../../components/ui';
import { answerChoices, answerLabel, cn, dateTime, pct, qFor, STATUS_LABEL, toneOfQ } from '../../lib/format';
import { useApp } from '../../lib/hooks';

/** Компактное значение результата: ответ / N/A / нужна проверка. */
export function ResultValue({ c, r, size = 'md', struck }: { c: Criterion | undefined; r: Pick<CriterionResult, 'status' | 'answer'>; size?: 'sm' | 'md'; struck?: boolean }) {
  // Исходник ИИ, заменённый решением проверяющего: зачёркнут и приглушён
  if (struck)
    return (
      <span className="inline-flex shrink-0 items-center rounded-md bg-surface-3 px-1.5 text-xs font-semibold tabular-nums text-fg-3 line-through decoration-fg-3/80 decoration-[1.5px]" title="Исходная оценка ИИ">
        {r.status === 'not_applicable' ? 'N/A' : r.status === 'needs_review' ? 'нужна проверка' : answerLabel(c, r.answer)}
      </span>
    );
  if (r.status === 'not_applicable') return <NABadge size={size} />;
  if (r.status === 'needs_review') return <Chip tone="warn" dot>Нужна проверка</Chip>;
  const tone = c ? toneOfQ(qFor(c, r.answer)) : 'neutral';
  const cls = { ok: 'bg-ok-weak text-ok', warn: 'bg-warn-weak text-warn', bad: 'bg-bad-weak text-bad', na: 'bg-na-weak text-na', accent: 'bg-accent-weak text-accent', neutral: 'bg-surface-3 text-fg' }[tone];
  return <span className={cn('inline-flex shrink-0 items-center rounded-md font-semibold tabular-nums', size === 'md' ? 'h-7 px-2.5 text-sm' : 'h-5 px-1.5 text-xs', cls)}>{answerLabel(c, r.answer)}</span>;
}

export function AppealForm({ evaluation, criterion, onCreated }: { evaluation: Evaluation; criterion: Criterion; onCreated: (a: Appeal) => void }) {
  const { toast, bumpAppeals } = useApp();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <Button size="sm" icon={MessageSquareWarning} onClick={() => setOpen(true)}>
        Оспорить
      </Button>
    );

  const submit = async () => {
    if (!comment.trim()) return setError('Опишите, с чем вы не согласны.');
    setBusy(true);
    setError(null);
    try {
      const a = await api.createAppeal(evaluation.evaluation_id, { criterion_id: criterion.criterion_id, comment: comment.trim() });
      toast('Апелляция отправлена проверяющему');
      bumpAppeals();
      onCreated(a);
      setOpen(false);
      setComment('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full animate-fade-in rounded-xl border border-line bg-surface-2 p-3.5">
      <label htmlFor={`ap-${criterion.criterion_id}`} className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2">
        <MessageSquareWarning className="h-3.5 w-3.5" /> Апелляция по критерию «{criterion.title}»
      </label>
      <textarea
        id={`ap-${criterion.criterion_id}`}
        autoFocus
        rows={3}
        className={cn('input resize-y', error && 'input-invalid')}
        placeholder="С чем вы не согласны и почему? Укажите реплику, если можно."
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setError(null);
        }}
      />
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
        <Button size="sm" variant="primary" icon={Send} loading={busy} onClick={() => void submit()}>
          Отправить
        </Button>
      </div>
    </div>
  );
}

export function DecisionForm({
  appeal,
  evaluation,
  criterion,
  current,
  onDecided,
  onReload,
}: {
  appeal: Appeal;
  evaluation: Evaluation;
  criterion: Criterion;
  current: CriterionResult;
  onDecided: (r: { appeal: Appeal; evaluation: Evaluation }) => void;
  onReload: () => void;
}) {
  const { toast, bumpAppeals } = useApp();
  const [action, setAction] = useState<'confirm' | 'change'>('confirm');
  const [status, setStatus] = useState<CriterionStatus>(current.status);
  const [answer, setAnswer] = useState<string | null>(current.answer ?? answerChoices(criterion)[0]?.value ?? null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // После «Обновить» приходит свежая revision — конфликт снят, можно решать заново
  useEffect(() => setConflict(null), [evaluation.revision]);

  const unchanged = action === 'change' && status === current.status && (status !== 'applicable' || answer === current.answer);

  const submit = async () => {
    if (!reason.trim()) return setError('Укажите причину решения — она сохраняется в карточке.');
    if (unchanged) return setError('Новое значение совпадает с текущим. Выберите «Подтвердить» или измените ответ.');
    if (action === 'change' && status === 'applicable' && answer === null) return setError('Выберите ответ.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.decide(appeal, {
        action,
        reason: reason.trim(),
        expected_revision: evaluation.revision,
        new_status: action === 'change' ? status : null,
        new_answer: action === 'change' && status === 'applicable' ? answer : null,
      });
      toast(`Решение сохранено (revision ${res.evaluation.revision}). Итог сейчас: ${pct(res.evaluation.score?.total ?? null)}`);
      bumpAppeals();
      onDecided(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Устаревшая revision или решение уже принято: ничего не сохранено, нужна свежая карточка
        setConflict(e.message || 'Оценка уже изменилась — обновите карточку.');
        toast('Конфликт (409): решение не сохранено — оценка уже изменилась', 'error');
      }
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full animate-fade-in rounded-xl border border-warn/30 bg-warn-weak/40 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Gavel className="h-4 w-4 text-warn" /> Решение проверяющего
        </h4>
        <span className="text-[11px] text-fg-3">revision {evaluation.revision}</span>
      </div>

      {conflict ? (
        <Alert tone="bad" title="Оценка уже изменилась" action={<Button size="sm" icon={RefreshCw} onClick={onReload}>Обновить</Button>}>
          {conflict}
        </Alert>
      ) : (
        <>
          <Segmented
            label="Действие"
            value={action}
            onChange={setAction}
            className="w-full"
            options={[
              { value: 'confirm', label: 'Подтвердить оценку ИИ' },
              { value: 'change', label: 'Изменить' },
            ]}
          />

          {action === 'change' && (
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-fg-2">Статус</div>
                <Segmented
                  label="Статус"
                  value={status}
                  onChange={setStatus}
                  size="sm"
                  options={[
                    { value: 'applicable', label: 'Оценён' },
                    { value: 'not_applicable', label: 'N/A', disabled: !criterion.na_allowed, title: criterion.na_allowed ? criterion.na_rule ?? undefined : 'Критерий не допускает N/A' },
                    { value: 'needs_review', label: 'Нужна проверка' },
                  ]}
                />
                {status === 'not_applicable' && criterion.na_rule && <p className="mt-1 text-[11.5px] text-fg-3">Правило N/A: {criterion.na_rule}</p>}
              </div>
              {status === 'applicable' && (
                <div>
                  <div className="mb-1.5 text-[12px] font-medium text-fg-2">Ответ</div>
                  <div className="flex flex-wrap gap-1.5">
                    {answerChoices(criterion).map((o) => {
                      const sel = o.value === answer;
                      const t = toneOfQ(qFor(criterion, o.value));
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={sel}
                          onClick={() => setAnswer(o.value)}
                          className={cn(
                            'h-8 min-w-[36px] rounded-lg border px-2.5 text-[13px] font-semibold tabular-nums transition',
                            sel
                              ? t === 'ok'
                                ? 'border-ok bg-ok text-white'
                                : t === 'warn'
                                  ? 'border-warn bg-warn text-white'
                                  : 'border-bad bg-bad text-white'
                              : 'border-line-strong bg-surface text-fg-2 hover:bg-surface-2',
                          )}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-3">
            <label htmlFor={`dec-${appeal.appeal_id}`} className="mb-1.5 block text-[12px] font-medium text-fg-2">
              Причина <span className="text-bad">*</span>
            </label>
            <textarea
              id={`dec-${appeal.appeal_id}`}
              rows={2}
              className={cn('input resize-y', error && 'input-invalid')}
              placeholder={action === 'confirm' ? 'Почему оценка ИИ верна' : 'Почему оценка меняется (регламент, реплика)'}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
            {error && <p className="mt-1 text-xs text-bad">{error}</p>}
          </div>

          <div className="mt-3 flex justify-end">
            <Button variant="dark" icon={CheckCircle2} loading={busy} onClick={() => void submit()}>
              {action === 'confirm' ? 'Подтвердить' : 'Сохранить изменение'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** «ИИ: … / Проверяющий: … / Причина: … / Итог: …» — как требует F04. */
export function DecisionSummary({ appeal, criterion }: { appeal: Appeal; criterion: Criterion | undefined }) {
  const d = appeal.decision;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[13px]">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <Gavel className="h-4 w-4 text-fg-3" /> {d.action === 'confirm' ? 'Оценка подтверждена' : 'Оценка изменена'}
        </span>
        {d.decided_at && <span className="text-[11.5px] text-fg-3">{dateTime(d.decided_at)}</span>}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        <dt className="text-fg-3">Апелляция</dt>
        <dd className="text-fg-2">«{appeal.comment}»</dd>
        <dt className="text-fg-3">ИИ</dt>
        <dd>
          <ResultValue c={criterion} r={d.before} size="sm" struck={d.action === 'change'} />
        </dd>
        <dt className="text-fg-3">Проверяющий</dt>
        <dd className="flex items-center gap-2">
          <ResultValue c={criterion} r={d.after} size="sm" />
          {d.action === 'change' && d.before.status !== d.after.status && <span className="text-[11.5px] text-fg-3">{STATUS_LABEL[d.before.status]} → {STATUS_LABEL[d.after.status]}</span>}
        </dd>
        <dt className="text-fg-3">Причина</dt>
        <dd className="text-fg">{d.reason}</dd>
        {(d.total_before !== null || d.total_after !== null) && (
          <>
            <dt className="text-fg-3">Итог</dt>
            <dd className="flex items-center gap-1.5 font-semibold tabular-nums">
              <span className="text-fg-3 line-through decoration-fg-3/60">{pct(d.total_before)}</span>
              <ArrowRight className="h-3.5 w-3.5 text-fg-3" />
              <span>{pct(d.total_after)}</span>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function OpenAppealNote({ appeal }: { appeal: Appeal }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-weak/50 px-3.5 py-2.5 text-[13px]">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div className="min-w-0">
        <div className="font-medium text-warn">Апелляция на рассмотрении{appeal.created_at ? ` · ${dateTime(appeal.created_at)}` : ''}</div>
        <div className="mt-0.5 text-fg-2">«{appeal.comment}»</div>
      </div>
    </div>
  );
}
