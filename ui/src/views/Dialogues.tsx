// Список диалогов: фильтры, импорт, пакетная оценка. Владелец: Участник 3.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  AudioLines,
  ChevronRight,
  CircleDashed,
  FileUp,
  Gauge,
  Inbox,
  ListChecks,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Phone,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { api, type Batch, type ChecklistVersion, type ConversationSummary, type ImportReport } from '../api';
import { Alert, Bar, Button, Card, Chip, Empty, Field, Kpi, Modal, PageHeader, Segmented, Skeleton, toneText } from '../components/ui';
import { CHANNEL, JOB_LABEL, LANG, cn, pct, toneOf } from '../lib/format';
import { cardPath, go, useApp, useAsync, useLocal, usePoll } from '../lib/hooks';
import { BatchProgress } from './BatchProgress';

type StatusFilter = 'all' | 'none' | 'progress' | 'done' | 'incomplete' | 'critical' | 'failed' | 'appeals';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'none', label: 'Не оценены' },
  { value: 'progress', label: 'В работе' },
  { value: 'done', label: 'Оценены' },
  { value: 'incomplete', label: 'Итог не определён' },
  { value: 'critical', label: 'Грубая ошибка' },
  { value: 'failed', label: 'Ошибка оценки' },
  { value: 'appeals', label: 'Есть апелляции' },
];

function matches(s: ConversationSummary, f: StatusFilter) {
  const e = s.last_evaluation;
  switch (f) {
    case 'none':
      return !e;
    case 'progress':
      return e?.status === 'queued' || e?.status === 'running';
    case 'done':
      return e?.status === 'completed';
    case 'incomplete':
      return !!e?.incomplete;
    case 'critical':
      return !!e?.critical_error;
    case 'failed':
      return e?.status === 'failed';
    case 'appeals':
      return s.open_appeals > 0;
    default:
      return true;
  }
}

function EvalCell({ s }: { s: ConversationSummary }) {
  const e = s.last_evaluation;
  if (!e) return <span className="inline-flex items-center gap-1.5 text-xs text-fg-3"><CircleDashed className="h-3.5 w-3.5" /> Не оценён</span>;
  if (e.status === 'queued' || e.status === 'running')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {JOB_LABEL[e.status]}
      </span>
    );
  if (e.status === 'failed' || e.status === 'canceled') return <Chip tone={e.status === 'failed' ? 'bad' : 'neutral'} dot>{JOB_LABEL[e.status]}</Chip>;
  if (e.total === null) return <Chip tone="warn" dot title="Есть критерии «Нужна проверка» или все N/A">Итог не определён</Chip>;
  const t = toneOf(e.total);
  return (
    <div className="flex items-center gap-2.5">
      <Bar value={e.total} tone={t} className="w-16" />
      <span className={cn('w-14 font-semibold tabular-nums', toneText(t))}>{pct(e.total)}</span>
      {e.critical_error && <Chip tone="bad" icon={AlertOctagon}>Грубая</Chip>}
    </div>
  );
}

// ---------- Импорт ----------

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [tab, setTab] = useState<'file' | 'api'>('file');
  const [groupId, setGroupId] = useState('DEV');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReport(null);
      setError(null);
    }
  }, [open]);

  const finish = (r: ImportReport) => {
    setReport(r);
    onDone();
    toast(`Импорт ${r.group_id}: новых ${r.created}, обновлено ${r.updated}, без изменений ${r.unchanged}`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const json = JSON.parse(await file.text());
      finish(await api.importFile(json));
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Файл не является корректным JSON.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onGroup = async () => {
    setBusy(true);
    setError(null);
    try {
      finish(await api.importGroup(groupId.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Импорт диалогов" footer={<Button onClick={onClose}>Закрыть</Button>}>
      <Segmented label="Источник" value={tab} onChange={setTab} options={[{ value: 'file', label: 'Файл JSON' }, { value: 'api', label: 'API организаторов' }]} className="mb-4 w-full" />
      {tab === 'file' ? (
        <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface-2 px-4 py-8 text-center transition hover:border-accent hover:bg-accent-weak/40', busy && 'pointer-events-none opacity-60')}>
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-accent" /> : <Upload className="h-6 w-6 text-fg-3" />}
          <span className="text-sm font-medium">Выберите файл в формате организаторов</span>
          <span className="text-xs text-fg-3">{'{ data: { dataset_group_id, records: [...] } }'} · повторный импорт без дублей</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      ) : (
        <div className="flex items-end gap-2">
          <Field label="group_id" hint="DEV — набор для разработки; контрольный group_id сообщат организаторы на T+23." className="flex-1">
            <input className="input font-mono" value={groupId} onChange={(e) => setGroupId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void onGroup()} />
          </Field>
          <Button variant="primary" icon={FileUp} loading={busy} disabled={!groupId.trim()} onClick={() => void onGroup()} className="mb-[22px]">
            Загрузить
          </Button>
        </div>
      )}
      {error && <Alert tone="bad" className="mt-4" title="Импорт не выполнен">{error}</Alert>}
      {report && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 text-sm font-semibold">Готово · <span className="font-mono">{report.group_id}</span></div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Новых', report.created, 'text-ok'],
              ['Обновлено', report.updated, 'text-accent'],
              ['Без изменений', report.unchanged, 'text-fg-2'],
            ].map(([l, n, c]) => (
              <div key={l as string} className="rounded-lg bg-surface p-2.5">
                <div className={cn('text-xl font-semibold tabular-nums', c as string)}>{n}</div>
                <div className="text-xs text-fg-3">{l}</div>
              </div>
            ))}
          </div>
          {report.updated > 0 && <p className="mt-3 text-xs text-fg-2">Изменённый текст при том же ID сохранён как обновление; прежние оценки остаются со своим хешем.</p>}
          {report.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-bad">
              {report.errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- Экран ----------

export function DialoguesView({ params }: { params: URLSearchParams }) {
  const { toast } = useApp();
  const list = useAsync(() => api.conversations(), []);
  const lists = useAsync(() => api.checklists(), []);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [batchId, setBatchId] = useLocal<string>('cqa-batch', '');
  const [batchRunning, setBatchRunning] = useState(false);
  const lastFinished = useRef(-1);
  const [versionId, setVersionId] = useState<number | null>(null);
  const applyId = params.get('apply');

  const versions: ChecklistVersion[] = lists.data ?? [];
  useEffect(() => {
    if (!versions.length) return;
    const fromApply = applyId ? versions.find((v) => v.version_id === Number(applyId)) : undefined;
    setVersionId((cur) => fromApply?.version_id ?? cur ?? versions[versions.length - 1].version_id);
  }, [versions, applyId]);

  // Пакет опрашивает BatchProgress; список обновляем, только когда завершился ещё один диалог
  const onBatchUpdate = (b: Batch) => {
    setBatchRunning(b.status === 'running');
    if (b.finished !== lastFinished.current) {
      lastFinished.current = b.finished;
      void list.reload(true);
    }
  };
  const anyRunning = (list.data ?? []).some((s) => s.last_evaluation && (s.last_evaluation.status === 'queued' || s.last_evaluation.status === 'running'));
  usePoll(() => void list.reload(true), anyRunning && !batchRunning, 3000);

  const rows = list.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (s) =>
        (!needle || s.conversation_id.toLowerCase().includes(needle) || s.preview.toLowerCase().includes(needle)) &&
        (lang === 'all' || s.language === lang) &&
        (channel === 'all' || s.channel === channel) &&
        matches(s, status),
    );
  }, [rows, q, lang, channel, status]);

  const kpi = useMemo(() => {
    const evaluated = rows.filter((r) => r.last_evaluation?.status === 'completed');
    const totals = evaluated.map((r) => r.last_evaluation!.total).filter((t): t is number => t !== null);
    return {
      evaluated: evaluated.length,
      avg: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
      incomplete: evaluated.filter((r) => r.last_evaluation!.total === null).length,
      critical: evaluated.filter((r) => r.last_evaluation!.critical_error).length,
      appeals: rows.reduce((a, r) => a + r.open_appeals, 0),
      langs: Object.entries(rows.reduce<Record<string, number>>((m, r) => ((m[r.language] = (m[r.language] ?? 0) + 1), m), {})),
    };
  }, [rows]);

  const langs = useMemo(() => [...new Set(rows.map((r) => r.language))], [rows]);
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel))], [rows]);
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.conversation_id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.conversation_id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const startBatch = async (ids: string[]) => {
    if (!versionId || !ids.length) return;
    try {
      const b = await api.startBatch(ids, versionId);
      lastFinished.current = -1;
      setBatchRunning(true);
      setBatchId(b.batch_id);
      setSelected(new Set());
      toast(`Запущена оценка ${ids.length} диалогов по чек-листу v${b.checklist_version}`);
      if (applyId) go('/');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const version = versions.find((v) => v.version_id === versionId);
  const targetIds = selected.size ? [...selected] : filtered.map((r) => r.conversation_id);
  const busy = batchRunning;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Диалоги"
        description="Импорт, оценка по выбранной версии чек-листа и переход к карточке."
        actions={
          <>
            <Button icon={RefreshCw} variant="ghost" onClick={() => void list.reload()} aria-label="Обновить" />
            <Button icon={Upload} onClick={() => setImportOpen(true)}>
              Импорт
            </Button>
          </>
        }
      />

      {applyId && version && (
        <Alert
          tone="accent"
          icon={ListChecks}
          title={`Чек-лист v${version.version} сохранён`}
          action={
            <Button size="sm" variant="primary" icon={Play} disabled={busy} onClick={() => void startBatch(targetIds)}>
              Оценить {selected.size ? `выбранные (${selected.size})` : `все (${filtered.length})`}
            </Button>
          }
        >
          Выберите диалоги (или оставьте все) и примените новую версию. Старые оценки не изменятся — появятся новые запуски.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi icon={MessagesSquare} label="Диалоги" value={rows.length} hint={kpi.langs.map(([l, n]) => `${l} ${n}`).join(' · ') || '—'} />
        <Kpi icon={Gauge} label="Оценено" value={`${kpi.evaluated}`} hint={`из ${rows.length}`} tone="ok" />
        <Kpi icon={Gauge} label="Средний итог" value={<span className={toneText(toneOf(kpi.avg))}>{pct(kpi.avg === null ? null : Math.round(kpi.avg * 10) / 10)}</span>} hint={`итог не определён: ${kpi.incomplete}`} tone="accent" />
        <Kpi icon={AlertOctagon} label="Грубые ошибки" value={kpi.critical} hint="в последних оценках" tone="bad" />
        <Kpi icon={ShieldAlert} label="Открытые апелляции" value={kpi.appeals} hint="ждут решения проверяющего" tone="warn" />
      </div>

      {batchId && (
        <BatchProgress
          key={batchId}
          batchId={batchId}
          onUpdate={onBatchUpdate}
          onClose={() => {
            setBatchId('');
            setBatchRunning(false);
          }}
        />
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
          <div className="relative min-w-[200px] flex-[2_1_220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <input className="input pl-9" placeholder="ID или текст первой реплики клиента" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto flex-[1_1_140px]" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Язык">
            <option value="all">Все языки</option>
            {langs.map((l) => (
              <option key={l} value={l}>
                {l} · {LANG[l] ?? l}
              </option>
            ))}
          </select>
          <select className="input w-auto flex-[1_1_130px]" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Канал">
            <option value="all">Все каналы</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {CHANNEL[c] ?? c}
              </option>
            ))}
          </select>
          <select className="input w-auto flex-[1_1_170px]" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Статус оценки">
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="text-[13px] text-fg-2">
            {selected.size ? (
              <>
                Выбрано <b className="text-fg">{selected.size}</b>
              </>
            ) : (
              <>Оценить все отфильтрованные ({filtered.length})</>
            )}
          </span>
          <span className="text-[13px] text-fg-3">по</span>
          <select className="input h-8 w-auto py-0 text-[13px]" value={versionId ?? ''} onChange={(e) => setVersionId(Number(e.target.value))} aria-label="Версия чек-листа">
            {[...versions].reverse().map((v) => (
              <option key={v.version_id} value={v.version_id}>
                v{v.version} · {v.name}
                {v.is_official ? '' : ' (демо)'}
                {v.version_id === versions[versions.length - 1]?.version_id ? ' — последняя' : ''}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" icon={Play} disabled={busy || !targetIds.length || !versionId} onClick={() => void startBatch(targetIds)}>
            Оценить
          </Button>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          )}
        </div>

        {list.error ? (
          <div className="p-5">
            <Alert tone="bad" title="Не удалось загрузить диалоги" action={<Button size="sm" onClick={() => void list.reload()}>Повторить</Button>}>
              {list.error.message}
            </Alert>
          </div>
        ) : list.loading && !list.data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !rows.length ? (
          <Empty icon={Inbox} title="Диалогов пока нет" action={<Button variant="primary" icon={Upload} onClick={() => setImportOpen(true)}>Импортировать</Button>}>
            Загрузите набор организаторов (DEV) из API или файла.
          </Empty>
        ) : !filtered.length ? (
          <Empty icon={Search} title="Ничего не найдено" action={<Button onClick={() => { setQ(''); setLang('all'); setChannel('all'); setStatus('all'); }}>Сбросить фильтры</Button>}>
            Измените запрос или фильтры.
          </Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-fg-3">
                  <th className="w-10 py-2.5 pl-4">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" className="h-4 w-4 accent-[rgb(var(--accent))]" />
                  </th>
                  <th className="px-3 py-2.5">Диалог</th>
                  <th className="px-3 py-2.5">Канал</th>
                  <th className="px-3 py-2.5">Язык</th>
                  <th className="px-3 py-2.5 text-right">Реплик</th>
                  <th className="px-3 py-2.5">Последняя оценка</th>
                  <th className="px-3 py-2.5">Версия</th>
                  <th className="px-3 py-2.5">Апелляции</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const sel = selected.has(s.conversation_id);
                  const open = () => go(cardPath(s.conversation_id));
                  return (
                    <tr
                      key={s.conversation_id}
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => e.key === 'Enter' && open()}
                      className={cn('group cursor-pointer border-b border-line last:border-0 transition-colors focus:outline-none focus-visible:bg-accent-weak/50', sel ? 'bg-accent-weak/40' : 'hover:bg-surface-2')}
                    >
                      <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel} onChange={() => toggle(s.conversation_id)} aria-label={`Выбрать ${s.conversation_id}`} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                      </td>
                      <td className="max-w-[340px] px-3 py-3">
                        <div className="font-mono text-[13px] font-medium">{s.conversation_id}</div>
                        <div className="truncate text-xs text-fg-3">{s.preview}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
                          {s.channel === 'voice call' ? <Phone className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                          {CHANNEL[s.channel] ?? s.channel}
                          {s.has_audio && <AudioLines className="h-3.5 w-3.5 text-accent" aria-label="есть запись" />}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex h-5 items-center rounded-[5px] bg-fg px-1.5 font-mono text-[10.5px] font-semibold text-surface">{s.language}</span>
                          <span className="text-xs text-fg-3">{LANG[s.language] ?? ''}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg-2">{s.message_count}</td>
                      <td className="px-3 py-3">
                        <EvalCell s={s} />
                      </td>
                      <td className="px-3 py-3 text-[13px] text-fg-2">{s.last_evaluation ? `v${s.last_evaluation.checklist_version}` : '—'}</td>
                      <td className="px-3 py-3">{s.open_appeals ? <Chip tone="warn" icon={ShieldAlert}>{s.open_appeals} открыт{s.open_appeals === 1 ? 'а' : 'о'}</Chip> : <span className="text-fg-3">—</span>}</td>
                      <td className="pr-3 text-fg-3 transition group-hover:translate-x-0.5 group-hover:text-fg-2">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => void list.reload(true)} />
    </div>
  );
}
