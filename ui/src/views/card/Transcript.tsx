// Транскрипт с подсветкой доказательств и проверенного участка.
import { useEffect, useMemo, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRightLeft, Bot, ChevronDown, ChevronUp, Crosshair, Eye, Headset, ScanSearch, User, X } from 'lucide-react';
import type { CheckedRange, Conversation, Criterion, Message, Speaker } from '../../api';
import { cn, offset, shortTime, SPEAKER } from '../../lib/format';

export interface Focus {
  criterionId: string;
  title: string;
  ids: string[]; // доказательства, в порядке диалога
  range: CheckedRange | null;
  index: number; // текущее доказательство для навигации
  single?: string; // клик по одному доказательству
}

const STYLE: Record<Speaker, { icon: LucideIcon; avatar: string; bubble: string; side: 'left' | 'right' | 'center' }> = {
  client: { icon: User, avatar: 'bg-client-weak text-client ring-client/25', bubble: 'bg-surface text-fg border border-line shadow-card rounded-tl-[5px]', side: 'left' },
  operator: { icon: Headset, avatar: 'bg-accent-weak text-accent ring-accent/25', bubble: 'bg-accent text-accent-fg border border-accent rounded-tr-[5px] shadow-sm', side: 'right' },
  bot: { icon: Bot, avatar: 'bg-bot-weak text-bot ring-bot/25', bubble: 'bg-bot-weak text-fg border border-dashed border-bot/45 rounded-tr-[5px]', side: 'right' },
  system: { icon: ArrowRightLeft, avatar: '', bubble: 'bg-sys-weak text-sys border border-sys/25', side: 'center' },
};

export const LEGEND: Array<[Speaker, string]> = [
  ['client', 'bg-client'],
  ['operator', 'bg-accent'],
  ['bot', 'bg-bot'],
  ['system', 'bg-sys'],
];

export function Transcript({
  conversation,
  focus,
  onStep,
  onClear,
  references,
  onPickCriterion,
  criteria,
}: {
  conversation: Conversation;
  focus: Focus | null;
  onStep: (delta: number) => void;
  onClear: () => void;
  references: Record<string, string[]>; // message_id → criterion_id[]
  onPickCriterion: (criterionId: string) => void;
  criteria: Map<string, Criterion>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const msgs = conversation.messages;
  const isCall = conversation.channel === 'voice call';
  const first = msgs[0]?.timestamp ?? '';

  const rangeIdx = useMemo(() => {
    if (!focus?.range) return null;
    const a = msgs.findIndex((m) => m.message_id === focus.range!.from_message_id);
    const b = msgs.findIndex((m) => m.message_id === focus.range!.to_message_id);
    return a < 0 || b < 0 ? null : [Math.min(a, b), Math.max(a, b)];
  }, [focus, msgs]);

  const hl = useMemo(() => new Set(focus ? (focus.single ? [focus.single] : focus.ids) : []), [focus]);
  const active = focus ? (focus.single ?? focus.ids[focus.index] ?? (rangeIdx ? msgs[rangeIdx[0]].message_id : null)) : null;
  const missing = focus ? focus.ids.filter((id) => !msgs.some((m) => m.message_id === id)) : [];

  // Прокрутка к текущему доказательству (внутри панели, если она скроллится; иначе страницы)
  useEffect(() => {
    if (!active) return;
    const el = refs.current[active];
    const box = scrollRef.current;
    if (!el) return;
    if (box && box.scrollHeight > box.clientHeight + 2) {
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + (r.top - b.top) - b.height / 2 + r.height / 2, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [active, focus]);

  const total = focus && !focus.single ? focus.ids.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {focus && (
        <div className="flex items-center gap-2.5 border-b border-hl/40 bg-hl/15 px-4 py-2 text-[13px] text-fg">
          <Crosshair className="h-4 w-4 shrink-0 text-warn" />
          <div className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{focus.title}</span>
            <span className="text-fg-2">
              {focus.single ? ` · реплика ${focus.single}` : total ? ` · ${total} ${total === 1 ? 'доказательство' : total < 5 ? 'доказательства' : 'доказательств'}` : ''}
              {focus.range && ` · проверен участок ${focus.range.from_message_id}–${focus.range.to_message_id}`}
            </span>
            {missing.length > 0 && <span className="ml-1 font-medium text-bad">· нет в диалоге: {missing.join(', ')}</span>}
          </div>
          {total > 1 && (
            <div className="flex items-center">
              <button type="button" className="rounded p-1 hover:bg-hl/25" onClick={() => onStep(-1)} aria-label="Предыдущее доказательство">
                <ChevronUp className="h-4 w-4" />
              </button>
              <span className="w-9 text-center text-xs tabular-nums">
                {focus.index + 1}/{total}
              </span>
              <button type="button" className="rounded p-1 hover:bg-hl/25" onClick={() => onStep(1)} aria-label="Следующее доказательство">
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}
          <button type="button" className="rounded p-1 hover:bg-hl/25" onClick={onClear} aria-label="Снять подсветку">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="scroll-thin flex flex-col gap-4 px-4 py-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto sm:px-5">
        {msgs.map((m, i) => {
          const inRange = !!rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
          return (
            <MessageRow
              key={m.message_id}
              m={m}
              isCall={isCall}
              first={first}
              highlighted={hl.has(m.message_id)}
              current={active === m.message_id}
              dimmed={!!focus && !hl.has(m.message_id) && !inRange}
              inRange={inRange}
              rangeEdge={inRange ? (i === rangeIdx![0] ? 'start' : i === rangeIdx![1] ? 'end' : null) : null}
              refs={references[m.message_id] ?? []}
              criteria={criteria}
              focusId={focus?.criterionId ?? null}
              onPick={onPickCriterion}
              register={(el) => (refs.current[m.message_id] = el)}
            />
          );
        })}
        <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-fg-3">
          <span className="h-px w-10 bg-line" /> конец диалога · {msgs.length} реплик <span className="h-px w-10 bg-line" />
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  isCall,
  first,
  highlighted,
  current,
  dimmed,
  inRange,
  rangeEdge,
  refs,
  criteria,
  focusId,
  onPick,
  register,
}: {
  m: Message;
  isCall: boolean;
  first: string;
  highlighted: boolean;
  current: boolean;
  dimmed: boolean;
  inRange: boolean;
  rangeEdge: 'start' | 'end' | null;
  refs: string[];
  criteria: Map<string, Criterion>;
  focusId: string | null;
  onPick: (id: string) => void;
  register: (el: HTMLDivElement | null) => void;
}) {
  const st = STYLE[m.speaker] ?? STYLE.system;
  const Icon = st.icon;
  const time = isCall ? `+${offset(m.timestamp, first) ?? shortTime(m.timestamp)}` : m.timestamp;
  const title = isCall ? `${m.timestamp} (смещение от начала звонка)` : m.timestamp;

  const rangeMark = rangeEdge && (
    <div className={cn('mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-warn', rangeEdge === 'end' && 'order-last mb-0 mt-1.5')}>
      <ScanSearch className="h-3 w-3" />
      {rangeEdge === 'start' ? 'Начало проверенного участка' : 'Конец проверенного участка'}
    </div>
  );

  const wrap = (children: React.ReactNode) => (
    <div ref={register} className={cn('relative flex flex-col scroll-m-24 transition-opacity duration-300', dimmed && 'opacity-40', inRange && 'border-l-2 border-warn/70 pl-3')}>
      {rangeEdge === 'start' && rangeMark}
      {children}
      {rangeEdge === 'end' && rangeMark}
    </div>
  );

  if (st.side === 'center') {
    return wrap(
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span
          title={title}
          className={cn('inline-flex max-w-[85%] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition', st.bubble, highlighted && 'ring-2 ring-hl ring-offset-2 ring-offset-bg', current && 'animate-pulse-hl')}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{m.text}</span>
          <span className="shrink-0 font-mono tabular-nums opacity-70">· {time}</span>
          <span className="shrink-0 font-mono opacity-50">#{m.message_id}</span>
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>,
    );
  }

  const right = st.side === 'right';
  return wrap(
    <div className={cn('flex gap-2.5', right && 'flex-row-reverse')}>
      <div className={cn('mt-[22px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1', st.avatar)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className={cn('flex min-w-0 max-w-[82%] flex-col', right ? 'items-end' : 'items-start')}>
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[11.5px] text-fg-3">
          <span className={cn('font-semibold', m.speaker === 'bot' ? 'text-bot' : m.speaker === 'operator' ? 'text-accent' : 'text-fg-2')}>{SPEAKER[m.speaker]}</span>
          <span className="font-mono tabular-nums" title={title}>
            {time}
          </span>
          <span className="font-mono opacity-70">#{m.message_id}</span>
          {highlighted && (
            <span className="inline-flex items-center gap-0.5 rounded bg-hl px-1 py-px text-[10px] font-bold uppercase tracking-wide text-black/80">
              <Eye className="h-3 w-3" /> доказательство
            </span>
          )}
        </div>
        <div
          className={cn(
            'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed transition-shadow',
            st.bubble,
            highlighted && 'ring-[3px] ring-hl ring-offset-2 ring-offset-bg',
            current && 'animate-pulse-hl',
          )}
        >
          {m.text}
        </div>
        {refs.length > 0 && (
          <div className={cn('mt-1.5 flex flex-wrap gap-1 px-1', right && 'justify-end')}>
            {refs.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                title="Показать оценку критерия"
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition',
                  focusId === id ? 'bg-hl/30 text-fg ring-1 ring-inset ring-hl' : 'bg-surface-3 text-fg-3 hover:bg-line hover:text-fg-2',
                )}
              >
                {criteria.get(id)?.title ?? id}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
  );
}
