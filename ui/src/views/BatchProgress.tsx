// Прогресс пакетной оценки: сам опрашивает GET /batches/{batch_id}, пока в пакете есть queued/running.
import { useEffect, useRef, useState } from 'react';
import { CircleDollarSign, Gauge, Loader2, Repeat, RotateCcw, Square, X } from 'lucide-react';
import { api, type Batch } from '../api';
import { Button, Card, Chip } from '../components/ui';
import { cn, JOB_LABEL, money } from '../lib/format';
import { cardPath, go, useApp } from '../lib/hooks';

const POLL_MS = 1500;

export function BatchProgress({ batchId, onUpdate, onClose }: { batchId: string; onUpdate?: (b: Batch) => void; onClose: () => void }) {
  const { toast } = useApp();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onUpdate);
  cb.current = onUpdate;

  // Опрос: сразу, затем каждые POLL_MS, пока пакет идёт. Ошибка сети не останавливает опрос.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const b = await api.batch(batchId);
        if (!alive) return;
        setBatch(b);
        setError(null);
        cb.current?.(b);
        if (b.status === 'running') timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [batchId, batch?.status === 'running' ? 'running' : batch ? 'idle' : 'init']);

  const act = async (fn: () => Promise<Batch>, msg: string) => {
    setBusy(true);
    try {
      const b = await fn();
      setBatch(b);
      cb.current?.(b);
      toast(msg);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!batch)
    return (
      <Card className="flex items-center gap-3 px-5 py-4 text-sm text-fg-2">
        {error ? <span className="text-bad">Пакет {batchId}: {error}</span> : <><Loader2 className="h-4 w-4 animate-spin text-accent" /> Загружаем пакет {batchId}…</>}
      </Card>
    );

  const running = batch.status === 'running';
  const p = batch.total ? Math.round((batch.finished / batch.total) * 100) : 0;
  const failed = batch.items.filter((i) => i.status === 'failed');
  const c = batch.counts;

  return (
    <Card className="animate-fade-in overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', running ? 'bg-accent-weak text-accent' : failed.length ? 'bg-warn-weak text-warn' : 'bg-ok-weak text-ok')}>
            {running ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Gauge className="h-[18px] w-[18px]" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Пакетная оценка{batch.checklist_version ? ` · чек-лист v${batch.checklist_version}` : ''}</span>
              <Chip tone={running ? 'accent' : batch.status === 'canceled' ? 'neutral' : failed.length ? 'warn' : 'ok'} dot>
                {running ? 'Идёт' : batch.status === 'canceled' ? 'Остановлена' : 'Завершена'}
              </Chip>
            </div>
            <div className="font-mono text-[11.5px] text-fg-3">batch {batch.batch_id}</div>
          </div>
        </div>

        <dl className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-3">Готово</dt>
            <dd className="font-semibold tabular-nums">
              {batch.done} <span className="font-normal text-fg-3">/ {batch.total}</span>
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-3">
              <CircleDollarSign className="h-3 w-3" /> Стоимость
            </dt>
            <dd className="font-semibold tabular-nums" title="cost_usd по всем вызовам пакета; null — неизвестно">
              {money(batch.cost_usd)}
            </dd>
          </div>
          {batch.attempts !== null && (
            <div>
              <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-3">
                <Repeat className="h-3 w-3" /> Попыток
              </dt>
              <dd className="font-semibold tabular-nums">{batch.attempts}</dd>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(['running', 'queued', 'failed', 'canceled'] as const).map((s) =>
              c[s] ? (
                <Chip key={s} tone={s === 'failed' ? 'bad' : s === 'canceled' ? 'neutral' : 'accent'}>
                  {JOB_LABEL[s]}: {c[s]}
                </Chip>
              ) : null,
            )}
          </div>
        </dl>

        <div className="flex gap-2">
          {running && (
            <Button size="sm" icon={Square} loading={busy} onClick={() => void act(() => api.cancelBatch(batch.batch_id), 'Очередь остановлена: не начатые оценки отменены')}>
              Остановить очередь
            </Button>
          )}
          {!running && failed.length > 0 && (
            <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => void act(() => api.retryBatch(batch.batch_id), `Повтор ${failed.length} неуспешных`)}>
              Повторить неуспешные ({failed.length})
            </Button>
          )}
          {!running && <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Скрыть" />}
        </div>
      </div>

      <div className="h-1.5 bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.finished}>
        <div className={cn('h-full transition-all duration-500', failed.length ? 'bg-warn' : running ? 'bg-accent' : 'bg-ok')} style={{ width: `${p}%` }} />
      </div>

      {error && <div className="border-t border-line px-5 py-2 text-xs text-warn">Связь с сервером прерывалась: {error}. Опрос продолжается.</div>}

      {failed.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto border-t border-line bg-bad-weak/40 px-5 py-2.5 text-xs scroll-thin">
          {failed.map((f) => (
            <li key={f.conversation_id} className="flex gap-2 text-bad">
              <button type="button" className="font-mono font-medium underline-offset-2 hover:underline" onClick={() => go(cardPath(f.conversation_id))}>
                {f.conversation_id}
              </button>
              <span className="min-w-0 truncate">— {f.error ?? 'ошибка оценки'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
