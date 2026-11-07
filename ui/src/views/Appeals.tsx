// Очередь апелляций: проверяющий видит спорную оценку, комментарий и фрагмент диалога. Владелец: Участник 3.
import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, Gavel, Inbox, MessageSquareWarning, ShieldAlert, ShieldCheck, User } from 'lucide-react';
import { api, type Appeal, type ChecklistVersion, type Conversation, type Evaluation } from '../api';
import { Alert, Button, Card, Empty, PageHeader, Segmented, Skeleton, Tag } from '../components/ui';
import { cn, dateTime, offset, shortTime, SPEAKER } from '../lib/format';
import { cardPath, go, useApp, useAsync } from '../lib/hooks';
import { DecisionForm, DecisionSummary, ResultValue } from './card/Appeal';

export function AppealsView({ params }: { params: URLSearchParams }) {
  const { role, setRole } = useApp();
  const [tab, setTab] = useState<'open' | 'decided'>(params.get('tab') === 'decided' ? 'decided' : 'open');
  const list = useAsync(() => api.appeals(), []);
  const lists = useAsync(() => api.checklists(), []);
  const [expanded, setExpanded] = useState<number | null>(null);

  const all = list.data ?? [];
  const openList = all.filter((a) => a.status === 'open');
  const decided = all.filter((a) => a.status === 'decided');
  const shown = tab === 'open' ? openList : decided;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Апелляции"
        description="Пользователь оспаривает критерий в карточке, проверяющий подтверждает или меняет оценку с причиной. Исходник ИИ сохраняется."
        actions={
          <Segmented
            label="Вкладка"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'open', label: `Открытые · ${openList.length}` },
              { value: 'decided', label: `Решённые · ${decided.length}` },
            ]}
          />
        }
      />

      {role !== 'reviewer' && openList.length > 0 && tab === 'open' && (
        <Alert tone="accent" icon={User} action={<Button size="sm" icon={Gavel} onClick={() => setRole('reviewer')}>Стать проверяющим</Button>}>
          Сейчас роль «Пользователь» — решения принимает проверяющий. Переключите демо-роль, чтобы рассмотреть апелляции.
        </Alert>
      )}

      {list.error ? (
        <Alert tone="bad" title="Апелляции не загружены">{list.error.message}</Alert>
      ) : list.loading && !list.data ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !shown.length ? (
        <Card>
          <Empty icon={tab === 'open' ? ShieldCheck : Inbox} title={tab === 'open' ? 'Открытых апелляций нет' : 'Решений пока нет'}>
            {tab === 'open' ? 'Оспорить критерий можно в карточке диалога (роль «Пользователь»).' : 'Решённые апелляции появятся здесь с исходной оценкой и причиной.'}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((a) => (
            <AppealRow
              key={a.appeal_id}
              appeal={a}
              versions={lists.data ?? []}
              expanded={expanded === a.appeal_id}
              onToggle={() => setExpanded((x) => (x === a.appeal_id ? null : a.appeal_id))}
              onDecided={() => {
                setExpanded(null);
                void list.reload(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppealRow({ appeal: listed, versions, expanded, onToggle, onDecided }: { appeal: Appeal; versions: ChecklistVersion[]; expanded: boolean; onToggle: () => void; onDecided: () => void }) {
  const { role } = useApp();
  // Оценка (GET /evaluations/{id}) даёт исходник ИИ, revision, название критерия и полные данные апелляции
  const ctx = useAsync(async () => {
    const ev = await api.evaluation(listed.evaluation_id);
    const conv = await api.conversation(listed.conversation_id || ev.conversation_id);
    return [ev, conv] as const;
  }, [listed.evaluation_id, listed.conversation_id, listed.status]);
  const [evaluation, conversation] = (ctx.data ?? [null, null]) as readonly [Evaluation | null, Conversation | null];
  const a: Appeal = { ...listed, ...(evaluation?.appeals.find((x) => x.appeal_id === listed.appeal_id) ?? {}), conversation_id: listed.conversation_id || evaluation?.conversation_id || '' };
  const open = a.status === 'open';
  const checklist = versions.find((v) => v.version_id === evaluation?.checklist_version_id);
  const criterion = checklist?.criteria.find((c) => c.criterion_id === a.criterion_id);
  const result = evaluation?.results.find((r) => r.criterion_id === a.criterion_id);
  const ai = evaluation?.ai_results.find((r) => r.criterion_id === a.criterion_id);

  const fragment = useMemo(() => {
    if (!conversation || !result) return [];
    const msgs = conversation.messages;
    const ids = new Set(result.evidence_message_ids);
    let idx = msgs.map((m, i) => (ids.has(m.message_id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length && result.checked_range) {
      const s = msgs.findIndex((m) => m.message_id === result.checked_range!.from_message_id);
      const e = msgs.findIndex((m) => m.message_id === result.checked_range!.to_message_id);
      if (s >= 0 && e >= 0) idx = Array.from({ length: e - s + 1 }, (_, k) => s + k);
    }
    // ± одна реплика контекста вокруг доказательств
    const keep = new Set<number>();
    idx.forEach((i) => [i - 1, i, i + 1].forEach((j) => j >= 0 && j < msgs.length && keep.add(j)));
    return [...keep].sort((x, y) => x - y).slice(0, 10).map((i) => ({ m: msgs[i], evidence: ids.has(msgs[i].message_id), gap: false }));
  }, [conversation, result]);

  return (
    <Card className={cn('overflow-hidden transition', expanded && 'ring-4 ring-accent/10')}>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', open ? 'bg-warn-weak text-warn' : 'bg-ok-weak text-ok')}>
          {open ? <ShieldAlert className="h-[18px] w-[18px]" /> : <ShieldCheck className="h-[18px] w-[18px]" />}
        </div>
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{a.criterion_title ?? criterion?.title ?? a.criterion_id}</span>
            <Tag mono>{a.conversation_id}</Tag>
            <span className="text-xs text-fg-3">оценка #{a.evaluation_id}{a.created_at ? ` · ${dateTime(a.created_at)}` : ''}</span>
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-[13.5px] text-fg-2">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
            <span>«{a.comment}»</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => go(cardPath(a.conversation_id, { e: a.evaluation_id, crit: a.criterion_id }))}>
            В карточке
          </Button>
          {open && (
            <Button size="sm" variant={role === 'reviewer' ? 'primary' : 'secondary'} icon={role === 'reviewer' ? Gavel : ChevronDown} onClick={onToggle} aria-expanded={expanded}>
              {expanded ? 'Свернуть' : role === 'reviewer' ? 'Рассмотреть' : 'Подробнее'}
            </Button>
          )}
        </div>
      </div>

      {!open && (
        <div className="border-t border-line px-5 py-4">
          {ctx.loading && !ctx.data ? <Skeleton className="h-24" /> : <DecisionSummary appeal={a} criterion={criterion} />}
        </div>
      )}

      {open && expanded && (
        <div className="grid animate-fade-in gap-5 border-t border-line bg-surface-2/50 px-5 py-5 lg:grid-cols-2">
          {ctx.loading && !ctx.data ? (
            <>
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </>
          ) : ctx.error || !evaluation || !criterion || !result ? (
            <Alert tone="bad" className="lg:col-span-2">Не удалось загрузить оценку или диалог: {ctx.error?.message ?? 'данных нет'}</Alert>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px] font-medium text-fg-3">Спорная оценка ИИ</span>
                    <ResultValue c={criterion} r={ai ?? result} />
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{(ai ?? result).explanation}</p>
                  <p className="mt-2 text-[11.5px] text-fg-3">Критерий: {criterion.instruction}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface">
                  <div className="border-b border-line px-4 py-2.5 text-[12.5px] font-medium text-fg-3">Фрагмент диалога</div>
                  <div className="space-y-2 p-3">
                    {fragment.length ? (
                      fragment.map(({ m, evidence }) => (
                        <div key={m.message_id} className={cn('rounded-lg border-l-[3px] px-3 py-2 text-[13px]', evidence ? 'border-hl bg-hl/10' : m.speaker === 'operator' ? 'border-accent/40 bg-surface-2' : m.speaker === 'bot' ? 'border-bot/40 bg-surface-2' : 'border-line-strong bg-surface-2')}>
                          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-fg-3">
                            <b className="font-semibold text-fg-2">{SPEAKER[m.speaker]}</b>
                            <span className="font-mono">{conversation!.channel === 'voice call' ? `+${offset(m.timestamp, conversation!.messages[0].timestamp)}` : shortTime(m.timestamp)}</span>
                            <span className="font-mono">#{m.message_id}</span>
                            {evidence && <span className="font-semibold uppercase text-warn">доказательство</span>}
                          </div>
                          {m.text}
                        </div>
                      ))
                    ) : (
                      <p className="px-1 py-2 text-sm text-fg-3">У оценки нет ссылок на реплики.</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                {role === 'reviewer' ? (
                  <DecisionForm appeal={a} evaluation={evaluation} criterion={criterion} current={result} onDecided={onDecided} onReload={() => void ctx.reload()} />
                ) : (
                  <Alert tone="accent" icon={User}>
                    Решение принимает проверяющий. Переключите демо-роль в меню слева.
                  </Alert>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
