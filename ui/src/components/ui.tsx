// Базовые компоненты интерфейса. Цвета — только семантические токены (см. tailwind.config.js).
import React, { useEffect, useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CircleSlash, Loader2, TriangleAlert, X } from 'lucide-react';
import { cn, type Tone } from '../lib/format';

// ---------- Кнопки ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const BTN: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover border border-accent hover:border-accent-hover',
  secondary: 'bg-surface text-fg border border-line-strong shadow-sm hover:bg-surface-2',
  ghost: 'text-fg-2 border border-transparent hover:bg-surface-3/70 hover:text-fg',
  danger: 'text-bad border border-transparent hover:bg-bad-weak',
  dark: 'bg-fg text-surface border border-fg shadow-sm hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        BTN[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

// ---------- Чипы и бейджи ----------

const CHIP: Record<Tone, string> = {
  ok: 'bg-ok-weak text-ok',
  warn: 'bg-warn-weak text-warn',
  bad: 'bg-bad-weak text-bad',
  na: 'bg-na-weak text-na',
  accent: 'bg-accent-weak text-accent',
  neutral: 'bg-surface-3 text-fg-2',
};

/** Цвет + текст (не только цвет). */
export function Chip({ tone = 'neutral', icon: Icon, dot, className, children, title }: { tone?: Tone; icon?: LucideIcon; dot?: boolean; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold', CHIP[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function NABadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border border-na/30 bg-na-weak font-bold uppercase tracking-wide text-na', size === 'md' ? 'h-7 px-2.5 text-[11px]' : 'h-5 px-1.5 text-[10px]')}>
      <CircleSlash className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} /> N/A
    </span>
  );
}

export function Tag({ children, className, mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return <span className={cn('inline-flex h-5 items-center rounded-[5px] bg-surface-3 px-1.5 text-[11px] font-semibold text-fg-2', mono && 'font-mono font-medium', className)}>{children}</span>;
}

// ---------- Карточки ----------

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('rounded-xl border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: LucideIcon; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-fg-3" />}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ crumbs, title, description, actions }: { crumbs?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && <div className="mb-1 text-[13px] text-fg-3">{crumbs}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone = 'accent' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: LucideIcon; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-fg-2">{label}</span>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', CHIP[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-1.5 text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-fg-3">{hint}</div>}
    </Card>
  );
}

// ---------- Формы ----------

export function Field({ label, hint, error, children, className, required, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; required?: boolean; htmlFor?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-fg-2">
        {label}
        {required && <span className="ml-0.5 text-bad">*</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-xs text-bad">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; disabled?: boolean; title?: string }>;
  size?: 'sm' | 'md';
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={o.disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-w-0 flex-auto truncate whitespace-nowrap rounded-[7px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
            o.value === value ? 'bg-surface text-fg shadow-card' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Итог ----------

const RING: Record<Tone, string> = { ok: 'stroke-ok', warn: 'stroke-warn', bad: 'stroke-bad', na: 'stroke-na', accent: 'stroke-accent', neutral: 'stroke-fg-3' };
const TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', na: 'text-na', accent: 'text-accent', neutral: 'text-fg-2' };
export const toneText = (t: Tone) => TEXT[t];
const BAR: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', na: 'bg-na', accent: 'bg-accent', neutral: 'bg-fg-3' };
export const toneBar = (t: Tone) => BAR[t];

export function ScoreRing({ value, tone, size = 104, label = 'итог' }: { value: number | null; tone: Tone; size?: number; label?: string }) {
  const stroke = size > 80 ? 9 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = value === null ? c : c - (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className={cn(RING[tone], 'transition-[stroke-dashoffset] duration-700 ease-out')} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <b className={cn('font-bold leading-none tracking-tight tabular-nums', size > 80 ? 'text-[22px]' : 'text-sm', value === null ? 'text-fg-3' : TEXT[tone])}>{value === null ? '—' : `${Number(value.toFixed(2))}`}</b>
        {size > 80 && <small className="mt-1 text-[11px] text-fg-3">{value === null ? 'не определён' : `% · ${label}`}</small>}
      </div>
    </div>
  );
}

export function Bar({ value, tone, className }: { value: number | null; tone: Tone; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-3', className)}>
      {value !== null && <div className={cn('h-full rounded-full transition-all duration-500', BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
    </div>
  );
}

// ---------- Состояния ----------

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-fg-3">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-fg-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'accent', icon: Icon, title, children, action, className }: { tone?: Tone; icon?: LucideIcon; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const border: Record<Tone, string> = { ok: 'border-ok/25', warn: 'border-warn/30', bad: 'border-bad/30', na: 'border-na/25', accent: 'border-accent/25', neutral: 'border-line' };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', CHIP[tone], border[tone], className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(!!title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-accent', className)} />;
}

// ---------- Модальное окно ----------

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-side/50 p-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={cn('w-full animate-fade-in rounded-2xl border border-line bg-surface shadow-pop', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
