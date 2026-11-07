// Оболочка: боковое меню, роль, тема, режим оценщика, уведомления, маршрут. Владелец: Участник 3.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, ClipboardCheck, FlaskConical, Gavel, ListChecks, MessagesSquare, Moon, ShieldAlert, Sun, TriangleAlert, User, X } from 'lucide-react';
import { api, API_MODE, type Health } from './api';
import { cn } from './lib/format';
import { AppContext, cardPath, go, useLocal, useRoute, type AppCtx, type Role } from './lib/hooks';
import { DialoguesView } from './views/Dialogues';
import { CardView } from './views/card/CardView';
import { ChecklistView } from './views/Checklist';
import { AppealsView } from './views/Appeals';

interface ToastItem {
  id: number;
  msg: string;
  kind: 'ok' | 'error';
}

function useTheme() {
  const [theme, setTheme] = useLocal<'light' | 'dark' | ''>('cqa-theme', '');
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const cur = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  };
  const isDark = (theme || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  return { isDark, toggle };
}

export default function App() {
  const route = useRoute();
  const [role, setRole] = useLocal<Role>('cqa-role', 'operator');
  const [lastCard] = useLocal<string>('cqa-last-card', '');
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [openAppeals, setOpenAppeals] = useState<number | null>(null);
  const [appealsTick, setAppealsTick] = useState(0);
  const { isDark, toggle } = useTheme();

  useEffect(() => {
    api.health().then(setHealth, () => setHealthError(true));
  }, []);

  useEffect(() => {
    api.appeals({ status: 'open' }).then((a) => setOpenAppeals(a.length), () => setOpenAppeals(null));
  }, [appealsTick, route]);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 4200);
  }, []);

  const ctx: AppCtx = useMemo(() => ({ role, setRole, health, toast, bumpAppeals: () => setAppealsTick((n) => n + 1) }), [role, setRole, health, toast]);

  const cardTarget = route.name === 'card' ? route.id : lastCard;
  const nav: Array<{ key: string; label: string; icon: LucideIcon; href: string; active: boolean; badge?: number | null; disabled?: boolean }> = [
    { key: 'list', label: 'Диалоги', icon: MessagesSquare, href: '/', active: route.name === 'list' },
    { key: 'card', label: 'Карточка', icon: ClipboardCheck, href: cardTarget ? cardPath(cardTarget) : '/', active: route.name === 'card', disabled: !cardTarget },
    { key: 'checklist', label: 'Чек-лист', icon: ListChecks, href: '/checklist', active: route.name === 'checklist' },
    { key: 'appeals', label: 'Апелляции', icon: ShieldAlert, href: '/appeals', active: route.name === 'appeals', badge: openAppeals },
  ];

  const mock = health?.evaluator_mode === 'mock';

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        {/* ---------- Боковое меню ---------- */}
        <aside className="sticky top-0 flex h-screen w-[60px] shrink-0 flex-col bg-side text-side-muted lg:w-[236px]">
          <div className="flex h-16 items-center gap-3 px-3 lg:px-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-[13px] font-bold tracking-wide text-white shadow-lg shadow-accent/30">CQA</div>
            <div className="hidden min-w-0 lg:block">
              <div className="truncate text-sm font-semibold leading-tight text-side-fg">Качество диалогов</div>
              <div className="truncate text-xs text-side-muted">Freedom Broker</div>
            </div>
          </div>

          <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2 lg:px-3" aria-label="Разделы">
            {nav.map((n) => (
              <a
                key={n.key}
                href={'#' + n.href}
                title={n.label}
                aria-current={n.active ? 'page' : undefined}
                aria-disabled={n.disabled || undefined}
                onClick={(e) => n.disabled && e.preventDefault()}
                className={cn(
                  'group relative flex h-10 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium transition lg:justify-start',
                  n.active ? 'bg-side-2 text-side-fg' : 'hover:bg-side-2/60 hover:text-side-fg',
                  n.disabled && 'pointer-events-none opacity-40',
                )}
              >
                {n.active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />}
                <n.icon className={cn('h-[18px] w-[18px] shrink-0', n.active && 'text-white')} />
                <span className="hidden flex-1 truncate lg:inline">{n.label}</span>
                {!!n.badge && (
                  <span className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10.5px] font-bold leading-[18px] text-white lg:static lg:min-w-[20px]">{n.badge}</span>
                )}
              </a>
            ))}
          </nav>

          <div className="space-y-3 border-t border-white/5 p-2 lg:p-3">
            <div className="hidden lg:block">
              <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-widest text-side-muted/80">Демо-роль</div>
              <div className="flex rounded-[10px] bg-side-2 p-[3px]" role="group" aria-label="Демо-роль">
                {(['operator', 'reviewer'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                    className={cn('flex min-w-0 flex-1 items-center justify-center rounded-[7px] px-1 py-1.5 text-[11.5px] font-semibold transition', role === r ? 'bg-white/10 text-side-fg shadow' : 'hover:text-side-fg')}
                  >
                    {r === 'operator' ? 'Пользователь' : 'Проверяющий'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center rounded-lg hover:bg-side-2 lg:hidden"
              title={role === 'reviewer' ? 'Роль: проверяющий' : 'Роль: пользователь'}
              onClick={() => setRole(role === 'reviewer' ? 'operator' : 'reviewer')}
            >
              {role === 'reviewer' ? <Gavel className="h-[18px] w-[18px] text-warn" /> : <User className="h-[18px] w-[18px]" />}
            </button>

            <div className="flex items-center gap-2">
              <span
                title={healthError ? 'Сервер недоступен' : mock ? 'Оценки — тестовые ответы без модели' : health ? `Оценки выполняет модель ${health.model}` : ''}
                className={cn(
                  'hidden h-7 min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-2 text-xs font-semibold lg:inline-flex',
                  healthError ? 'bg-bad/15 text-bad' : mock ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok',
                )}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                <span className="truncate">{healthError ? 'Сервер недоступен' : !health ? '…' : mock ? 'Тестовый оценщик' : health.model}</span>
              </span>
              <button type="button" onClick={toggle} title="Сменить тему" aria-label="Сменить тему" className="mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-side-2 hover:text-side-fg lg:mx-0">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </aside>

        {/* ---------- Содержимое ---------- */}
        <main className="min-w-0 flex-1 overflow-y-auto scroll-thin" id="main">
          {API_MODE === 'mock' && (
            <div className="flex items-center gap-2 border-b border-warn/25 bg-warn-weak px-6 py-1.5 text-xs font-medium text-warn">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              Демо-режим: данные хранятся в браузере и сбрасываются при перезагрузке; оценщик тестовый.
            </div>
          )}
          {mock && API_MODE !== 'mock' && (
            <div className="flex items-center gap-2 border-b border-warn/25 bg-warn-weak px-6 py-1.5 text-xs font-medium text-warn">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              Тестовый оценщик (EVALUATOR_MODE=mock): оценки — не ответы модели.
            </div>
          )}
          <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
            {route.name === 'list' && <DialoguesView params={route.params} />}
            {route.name === 'card' && <CardView key={route.id} id={route.id} params={route.params} />}
            {route.name === 'checklist' && <ChecklistView />}
            {route.name === 'appeals' && <AppealsView params={route.params} />}
          </div>
        </main>
      </div>

      <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[min(400px,calc(100vw-40px))] flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn('pointer-events-auto flex animate-fade-in items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-pop', t.kind === 'error' ? 'bg-bad text-white' : 'bg-fg text-surface')}
          >
            {t.kind === 'error' ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />}
            <span className="min-w-0 flex-1">{t.msg}</span>
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="opacity-60 hover:opacity-100" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export { go };
