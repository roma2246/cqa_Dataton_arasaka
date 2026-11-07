// Карточка диалога: транскрипт ↔ результат оценки. Владелец: Участник 3.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  Cpu,
  ExternalLink,
  FlaskConical,
  Globe2,
  Hash,
  Info,
  ListChecks,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Phone,
  Play,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { api, type Appeal, type ChecklistVersion, type Conversation, type Criterion, type Evaluation } from '../../api';
import { Alert, Bar, Button, Card, Chip, Empty, Skeleton, ScoreRing, Tag, toneText } from '../../components/ui';
import { CHANNEL, cn, dateTime, duration, JOB_LABEL, LANG, money, offset, pct, SPEAKER, toneOf } from '../../lib/format';
import { cardPath, go, useApp, useAsync, useLocal, usePoll } from '../../lib/hooks';
import { CriterionCard } from './CriterionCard';
import { LEGEND, Transcript, type Focus } from './Transcript';

export function CardView({ id, params }: { id: string; params: URLSearchParams }) {
  const { role, toast } = useApp();
  const [, setLast] = useLocal<string>('cqa-last-card', '');
  useEffect(() => setLast(id), [id, setLast]);

  const conv = useAsync(() => api.conversation(id), [id]);
  const evals = useAsync(() => api.evaluations(id), [id]);
  const lists = useAsync(() => api.checklists(), []);
  const all = useAsync(() => api.conversations(), []);

  const wantedEval = params.get('e') ? Number(params.get('e')) : null;
  const [evalId, setEvalId] = useState<number | null>(wantedEval);
  useEffect(() => {
    if (!evals.data?.length) return;
    setEvalId((cur) => (cur && evals.data!.some((e) => e.evaluation_id === cur) ? cur : evals.data![0].evaluation_id));
  }, [evals.data]);

  const evaluation = evals.data?.find((e) => e.evaluation_id === evalId) ?? null;
  const checklist = lists.data?.find((v) => v.version_id === evaluation?.checklist_version_id) ?? null;
  const latest = lists.data?.[lists.data.length - 1] ?? null;

  // Апелляции приходят внутри GET /evaluations/{id}
  const appealList: Appeal[] = evaluation?.appeals ?? [];

  // Опрос, пока оценка в очереди / выполняется
  const pending = evaluation?.status === 'queued' || evaluation?.status === 'running';
  usePoll(
    () => {
      if (!evaluation) return;
      api.evaluation(evaluation.evaluation_id).then((e) => {
        if (e.status !== evaluation.status) void evals.reload(true);
      });
    },
    pending,
    1000,
  );

  // ---- Новый запуск ----
  const [runVersion, setRunVersion] = useState<number | null>(null);
  useEffect(() => {
    if (latest && runVersion === null) setRunVersion(latest.version_id);
  }, [latest, runVersion]);
  const [running, setRunning] = useState(false);
  const runEvaluation = async () => {
    if (!runVersion) return;
    setRunning(true);
    try {
      const e = await api.evaluate(id, runVersion);
      setEvalId(e.evaluation_id);
      await evals.reload(true);
      toast(`Новый запуск #${e.evaluation_id} поставлен в очередь`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  // ---- Доказательства ----
  const [focus, setFocus] = useState<Focus | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => setFocus(null), [evalId]);

  const order = useMemo(() => new Map((conv.data?.messages ?? []).map((m, i) => [m.message_id, i])), [conv.data]);
  const critMap = useMemo(() => new Map((checklist?.criteria ?? []).map((c) => [c.criterion_id, c])), [checklist]);
  const msgMap = useMemo(() => new Map((conv.data?.messages ?? []).map((m) => [m.message_id, m])), [conv.data]);

  const focusOn = useCallback(
    (criterionId: string, opts: { all?: boolean; single?: string; range?: boolean } = { all: true }) => {
      const r = evaluation?.results.find((x) => x.criterion_id === criterionId);
      const c = critMap.get(criterionId);
      if (!r || !c) return;
      const ids = [...r.evidence_message_ids].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
      setFocus((cur) => {
        const same = cur?.criterionId === criterionId;
        if (opts.single) return same && cur?.single === opts.single ? null : { criterionId, title: c.title, ids, range: r.checked_range, index: Math.max(0, ids.indexOf(opts.single)), single: opts.single };
        if (opts.range) return same && !cur?.ids.length ? null : { criterionId, title: c.title, ids: [], range: r.checked_range, index: 0 };
        return same && !cur?.single ? null : { criterionId, title: c.title, ids, range: r.checked_range, index: 0 };
      });
    },
    [evaluation, critMap, order],
  );

  // Переход из «Апелляций»: ?crit=…
  const wantedCrit = params.get('crit');
  const consumed = useRef(false);
  useEffect(() => {
    if (!wantedCrit || consumed.current || !evaluation || evaluation.status !== 'completed' || !checklist) return;
    consumed.current = true;
    focusOn(wantedCrit);
    setTimeout(() => cardRefs.current[wantedCrit]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [wantedCrit, evaluation, checklist, focusOn]);

  const references = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of evaluation?.results ?? []) for (const mid of r.evidence_message_ids) (map[mid] ??= []).push(r.criterion_id);
    return map;
  }, [evaluation]);

  const reloadAll = () => void evals.reload(true);

  // ---------- Состояния загрузки ----------
  if (conv.error)
    return (
      <Alert tone="bad" title="Диалог не открыт" action={<Button size="sm" onClick={() => go('/')}>К списку</Button>}>
        {conv.error.message}
      </Alert>
    );
  if (!conv.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[60vh]" />
          <Skeleton className="h-[60vh]" />
        </div>
      </div>
    );

  const c = conv.data;
  const siblings = all.data ?? [];
  const idx = siblings.findIndex((s) => s.conversation_id === id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const isCall = c.channel === 'voice call';
  const speakers = LEGEND.filter(([s]) => c.messages.some((m) => m.speaker === s));

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Шапка ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1 text-[13px] text-fg-3">
            <a href="#/" className="inline-flex items-center gap-1 hover:text-fg">
              <ArrowLeft className="h-3.5 w-3.5" /> Диалоги
            </a>
            <span>/</span>
            <span className="font-mono">{c.conversation_id}</span>
          </div>
          <h1 className="font-mono text-[22px] font-semibold tracking-tight">{c.conversation_id}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip icon={isCall ? Phone : MessageCircle}>{CHANNEL[c.channel] ?? c.channel}</Chip>
            <Chip icon={Globe2}>
              {c.language} · {LANG[c.language] ?? c.language}
            </Chip>
            <Chip icon={MessagesSquare}>{c.messages.length} реплик</Chip>
            {duration(c.messages) && <Chip icon={Clock}>{duration(c.messages)}</Chip>}
            <Chip icon={Hash} title={`content_hash ${c.content_hash}`}>
              {c.group_id}
            </Chip>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-card">
          <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={!prev} onClick={() => prev && go(cardPath(prev.conversation_id))} aria-label="Предыдущий диалог" />
          <span className="px-1 text-xs tabular-nums text-fg-3">{idx >= 0 ? `${idx + 1} / ${siblings.length}` : '…'}</span>
          <Button size="sm" variant="ghost" icon={ChevronRight} disabled={!next} onClick={() => next && go(cardPath(next.conversation_id))} aria-label="Следующий диалог" />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        {/* ---------- Слева: транскрипт ---------- */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          {c.audio_url && <AudioBox conversation={c} />}
          <Card className={cn('flex flex-col overflow-hidden', c.audio_url ? 'lg:h-[calc(100vh-262px)]' : 'lg:h-[calc(100vh-150px)]')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <MessagesSquare className="h-4 w-4 text-fg-3" /> Транскрипт
              </h2>
              <div className="flex flex-wrap gap-3">
                {speakers.map(([s, dot]) => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-xs text-fg-2">
                    <span className={cn('h-2 w-2 rounded-full', dot)} />
                    {SPEAKER[s]}
                  </span>
                ))}
              </div>
            </div>
            <Transcript
              conversation={c}
              focus={focus}
              onStep={(d) => setFocus((f) => (f && f.ids.length ? { ...f, single: undefined, index: (f.index + d + f.ids.length) % f.ids.length } : f))}
              onClear={() => setFocus(null)}
              references={references}
              criteria={critMap}
              onPickCriterion={(cid) => {
                focusOn(cid);
                cardRefs.current[cid]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
            />
          </Card>
        </div>

        {/* ---------- Справа: оценка ---------- */}
        <div className="flex min-w-0 flex-col gap-4">
          <RunBar
            evaluations={evals.data ?? []}
            evalId={evalId}
            onSelect={setEvalId}
            versions={lists.data ?? []}
            runVersion={runVersion}
            onRunVersion={setRunVersion}
            onRun={() => void runEvaluation()}
            running={running}
          />

          {evals.loading && !evals.data ? (
            <Skeleton className="h-48" />
          ) : !evaluation ? (
            <Card>
              <Empty icon={CircleDashed} title="Диалог ещё не оценён" action={<Button variant="primary" icon={Play} loading={running} onClick={() => void runEvaluation()}>Оценить по v{lists.data?.find((v) => v.version_id === runVersion)?.version ?? '…'}</Button>}>
                Выберите версию чек-листа и запустите оценку. Реплики бота и системные события — только контекст.
              </Empty>
            </Card>
          ) : pending ? (
            <Card className="flex items-center gap-4 p-6">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <div>
                <div className="font-semibold">{JOB_LABEL[evaluation.status]} · запуск #{evaluation.evaluation_id}</div>
                <div className="text-sm text-fg-2">Чек-лист v{evaluation.checklist_version}. Карточка обновится автоматически.</div>
              </div>
            </Card>
          ) : evaluation.status === 'failed' || evaluation.status === 'canceled' ? (
            <Alert tone="bad" icon={TriangleAlert} title={`Оценка #${evaluation.evaluation_id}: ${JOB_LABEL[evaluation.status]}`} action={<Button size="sm" icon={RefreshCw} loading={running} onClick={() => void runEvaluation()}>Запустить заново</Button>}>
              {evaluation.error ?? 'Причина не сообщена.'} Фиктивная оценка не создаётся.
            </Alert>
          ) : !checklist ? (
            <Alert tone="warn">Версия чек-листа #{evaluation.checklist_version_id} не найдена.</Alert>
          ) : (
            <>
              <Summary evaluation={evaluation} checklist={checklist} />
              {role === 'reviewer' && appealList.some((a) => a.status === 'open') && (
                <Alert tone="warn" icon={Info}>
                  Режим проверяющего: по {appealList.filter((a) => a.status === 'open').length} критериям ждут решения апелляции — форма решения внутри карточек.
                </Alert>
              )}
              <CriteriaList
                evaluation={evaluation}
                checklist={checklist}
                appeals={appealList}
                messages={msgMap}
                timeOf={(m) => (isCall ? `+${offset(m.timestamp, c.messages[0].timestamp)}` : m.timestamp)}
                focus={focus}
                onFocus={focusOn}
                cardRefs={cardRefs}
                onAppealCreated={reloadAll}
                onDecided={() => reloadAll()}
                onReload={reloadAll}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Выбор запуска ----------

function RunBar({
  evaluations,
  evalId,
  onSelect,
  versions,
  runVersion,
  onRunVersion,
  onRun,
  running,
}: {
  evaluations: Evaluation[];
  evalId: number | null;
  onSelect: (id: number) => void;
  versions: ChecklistVersion[];
  runVersion: number | null;
  onRunVersion: (id: number) => void;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3">
      <div className="flex min-w-0 flex-[1_1_260px] items-center gap-2">
        <span className="shrink-0 text-[12.5px] font-medium text-fg-2">Оценка</span>
        {evaluations.length ? (
          <select className="input h-8 py-0 text-[13px]" value={evalId ?? ''} onChange={(e) => onSelect(Number(e.target.value))} aria-label="Сохранённая оценка">
            {evaluations.map((e, i) => (
              <option key={e.evaluation_id} value={e.evaluation_id}>
                #{e.evaluation_id} · v{e.checklist_version} · {dateTime(e.created_at)} · {JOB_LABEL[e.status]}
                {e.status === 'completed' ? ` · ${pct(e.score?.total ?? null)}` : ''}
                {i === 0 ? ' (последняя)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-fg-3">нет сохранённых</span>
        )}
      </div>
      <div className="flex flex-[1_1_260px] items-center gap-2 sm:justify-end">
        <span className="shrink-0 text-[12.5px] font-medium text-fg-2">Новый запуск</span>
        <select className="input h-8 w-auto min-w-0 py-0 text-[13px]" value={runVersion ?? ''} onChange={(e) => onRunVersion(Number(e.target.value))} aria-label="Версия чек-листа для нового запуска">
          {[...versions].reverse().map((v) => (
            <option key={v.version_id} value={v.version_id}>
              v{v.version} · {v.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="primary" icon={Play} loading={running} disabled={!runVersion} onClick={onRun}>
          Оценить
        </Button>
      </div>
    </Card>
  );
}

// ---------- Итог ----------

function Summary({ evaluation: e, checklist }: { evaluation: Evaluation; checklist: ChecklistVersion }) {
  const s = e.score;
  const ai = e.ai_score;
  const total = s?.total ?? null;
  const tone = toneOf(total);
  const changed = ai && s && ai.total !== s.total;
  const titles = new Map(checklist.criteria.map((c) => [c.criterion_id, c.title]));
  const counts = { app: 0, na: 0, review: 0 };
  e.results.forEach((r) => (r.status === 'applicable' ? counts.app++ : r.status === 'not_applicable' ? counts.na++ : counts.review++));
  const u = e.usage;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-5 p-5">
        <ScoreRing value={total} tone={tone} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">Итог оценки</span>
            {e.revision > 0 && <Chip tone="warn">после пересмотра · rev {e.revision}</Chip>}
          </div>
          {changed && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-fg-3">ИИ</span>
              <s className="font-semibold tabular-nums text-fg-3 decoration-fg-3/80 decoration-[1.5px]" title="ai_score — исходный итог ИИ">
                {pct(ai!.total)}
              </s>
              <ArrowRight className="h-3.5 w-3.5 text-fg-3" />
              <span className="text-fg-3">после решений</span>
              <b className={cn('tabular-nums', toneText(tone))}>{pct(total)}</b>
            </div>
          )}
          {s?.incomplete_reason && <div className="text-[13px] text-warn">{s.incomplete_reason}</div>}
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="neutral">{counts.app} оценено</Chip>
            <Chip tone="na">{counts.na} N/A</Chip>
            {counts.review > 0 && <Chip tone="warn">{counts.review} нужна проверка</Chip>}
          </div>
        </div>
      </div>

      {s?.critical_error && (
        <div className="flex items-start gap-2.5 border-t border-bad/20 bg-bad-weak px-5 py-3 text-[13px] text-bad">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-semibold">Грубая ошибка:</b> {s.critical_criteria.map((id) => titles.get(id) ?? id).join(', ')}.{' '}
            {checklist.rules.critical_policy === 'zero_total' ? 'По правилам чек-листа итог обнуляется.' : 'По правилам чек-листа отмечается отдельно, итог не меняется.'}
          </div>
        </div>
      )}

      {checklist.sections.length > 0 && s && (
        <div className="grid gap-x-6 gap-y-2.5 border-t border-line px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {checklist.sections.map((sec) => {
            const v = s.sections.find((x) => x.section_id === sec.section_id)?.total ?? null;
            return (
              <div key={sec.section_id} className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-fg-2">{sec.title}</span>
                  <span className={cn('font-semibold tabular-nums', v === null ? 'text-fg-3' : toneText(toneOf(v)))}>{pct(v)}</span>
                </div>
                <Bar value={v} tone={toneOf(v)} />
              </div>
            );
          })}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line bg-surface-2 px-5 py-3 text-[12.5px] sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-fg-3">Чек-лист</dt>
          <dd className="flex items-center gap-1.5 truncate font-medium">
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-fg-3" /> v{checklist.version}
            {!checklist.is_official && <Tag className="bg-warn-weak text-warn">демо</Tag>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-3">Оценщик</dt>
          <dd className="flex items-center gap-1.5 truncate font-medium">
            {e.mode === 'mock' ? (
              <>
                <FlaskConical className="h-3.5 w-3.5 shrink-0 text-warn" /> <span className="text-warn">тестовый</span>
              </>
            ) : (
              <>
                <Cpu className="h-3.5 w-3.5 shrink-0 text-fg-3" /> {u?.model ?? '—'}
              </>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-3">Стоимость</dt>
          <dd className="truncate font-medium tabular-nums" title={u ? `${u.calls} вызов(а) · вход ${u.input_tokens ?? '?'} · выход ${u.output_tokens ?? '?'} токенов` : undefined}>
            {e.mode === 'mock' ? 'нет (тест)' : `${money(u?.cost_usd)} · ${u?.calls ?? 0} выз.`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-3">Запуск</dt>
          <dd className="truncate font-medium tabular-nums">
            #{e.evaluation_id} · {dateTime(e.completed_at ?? e.created_at)}
            {u?.duration_ms ? ` · ${(u.duration_ms / 1000).toFixed(1)} с` : ''}
          </dd>
        </div>
      </dl>
      {(u?.problems.length || u?.prompt_version) && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 text-[12px] text-fg-3">
          {u?.prompt_version && <span>Промпт: <span className="font-mono">{u.prompt_version}</span></span>}
          {u?.problems.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-warn">
              <TriangleAlert className="h-3.5 w-3.5" /> {p}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- Критерии по секциям ----------

function CriteriaList({
  evaluation,
  checklist,
  appeals,
  messages,
  timeOf,
  focus,
  onFocus,
  cardRefs,
  onAppealCreated,
  onDecided,
  onReload,
}: {
  evaluation: Evaluation;
  checklist: ChecklistVersion;
  appeals: Appeal[];
  messages: Map<string, import('../../api').Message>;
  timeOf: (m: import('../../api').Message) => string;
  focus: Focus | null;
  onFocus: (criterionId: string, opts?: { all?: boolean; single?: string; range?: boolean }) => void;
  cardRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  onAppealCreated: () => void;
  onDecided: () => void;
  onReload: () => void;
}) {
  const { role } = useApp();
  const groups = useMemo(() => {
    const secs: Array<{ id: string | null; title: string; items: Criterion[] }> = checklist.sections.map((s) => ({ id: s.section_id, title: s.title, items: [] }));
    const loose: Criterion[] = [];
    for (const c of checklist.criteria) {
      const g = secs.find((s) => s.id === c.section_id);
      if (g) g.items.push(c);
      else loose.push(c);
    }
    if (loose.length) secs.push({ id: null, title: checklist.sections.length ? 'Без секции' : 'Критерии', items: loose });
    return secs.filter((s) => s.items.length);
  }, [checklist]);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const secTotal = g.id ? evaluation.score?.sections.find((s) => s.section_id === g.id)?.total ?? null : null;
        return (
          <section key={g.id ?? 'none'} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 px-1">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-3">{g.title}</h3>
              <span className="h-px flex-1 bg-line" />
              {g.id && <span className={cn('text-xs font-semibold tabular-nums', secTotal === null ? 'text-fg-3' : toneText(toneOf(secTotal)))}>{pct(secTotal)}</span>}
            </div>
            {g.items.map((c) => {
              const r = evaluation.results.find((x) => x.criterion_id === c.criterion_id);
              if (!r)
                return (
                  <Alert key={c.criterion_id} tone="warn">
                    Нет результата по критерию «{c.title}» — ответ модели неполный.
                  </Alert>
                );
              return (
                <CriterionCard
                  key={c.criterion_id}
                  ref={(el) => (cardRefs.current[c.criterion_id] = el)}
                  criterion={c}
                  result={r}
                  aiResult={evaluation.ai_results.find((x) => x.criterion_id === c.criterion_id)}
                  score={evaluation.score?.criteria.find((x) => x.criterion_id === c.criterion_id)}
                  evaluation={evaluation}
                  messages={messages}
                  timeOf={timeOf}
                  appeals={appeals.filter((a) => a.criterion_id === c.criterion_id)}
                  role={role}
                  focus={focus}
                  canAppeal={evaluation.status === 'completed'}
                  onFocus={(o) => onFocus(c.criterion_id, o)}
                  onAppealCreated={onAppealCreated}
                  onDecided={onDecided}
                  onReload={onReload}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Запись звонка ----------

function AudioBox({ conversation }: { conversation: Conversation }) {
  // GET /conversations/{id}/audio: media_url есть, только если сервер проверил audio/*
  const info = useAsync(() => api.audio(conversation.conversation_id), [conversation.conversation_id]);
  const src = info.data?.media_url ?? null;
  const player = info.data?.player_url ?? conversation.audio_url;
  const [failed, setFailed] = useState(false);
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <AudioLines className="h-4 w-4 text-accent" /> Запись звонка
        </span>
        {player && (
          <a href={player} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            Открыть штатный плеер <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {info.loading && <p className="mt-2 text-xs text-fg-3">Проверяем запись…</p>}
      {!src && (info.data?.error || info.error) && <p className="mt-2 text-xs text-warn">Встроенный плеер недоступен: {info.data?.error ?? info.error?.message}</p>}
      {src && !failed && <audio className="mt-2.5 h-9 w-full" controls preload="none" src={src} onError={() => setFailed(true)} />}
      {src && failed && <p className="mt-2 text-xs text-bad">Не удалось загрузить запись во встроенный плеер — используйте штатный плеер.</p>}
      <p className="mt-1.5 text-[11.5px] text-fg-3">Перемотка к реплике не поддерживается: начало записи (t0) не сверено с временем реплик.</p>
    </Card>
  );
}
