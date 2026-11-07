// Редактор чек-листа: каждое сохранение — новая неизменяемая версия. Владелец: Участник 3.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Copy,
  History,
  Layers,
  ListChecks,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { api, type AnswerOption, type AnswerType, type ChecklistDraft, type ChecklistVersion, type Criterion, type Section } from '../api';
import { Alert, Button, Card, CardHeader, Chip, Field, PageHeader, Segmented, Skeleton, Switch, Tag } from '../components/ui';
import { ANSWER_TYPE_LABEL, answerChoices, cn, dateTime } from '../lib/format';
import { go, useApp, useAsync } from '../lib/hooks';

interface Row {
  uid: string;
  c: Criterion;
  isNew: boolean;
}

let uidSeq = 0;
const uid = () => `r${++uidSeq}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const DEFAULT_OPTIONS: Record<Exclude<AnswerType, 'scale'>, AnswerOption[]> = {
  yes_no: [
    { value: 'yes', label: 'Да', score: 1 },
    { value: 'no', label: 'Нет', score: 0 },
  ],
  single_choice: [
    { value: 'yes', label: 'Да', score: 1 },
    { value: 'partial', label: 'Частично', score: 0.5 },
    { value: 'no', label: 'Нет', score: 0 },
  ],
};

const PALETTE = ['bg-accent', 'bg-client', 'bg-bot', 'bg-warn', 'bg-bad', 'bg-ok', 'bg-sys', 'bg-na'];

function blankCriterion(id: string, sectionId: string | null): Criterion {
  return {
    criterion_id: id,
    title: '',
    instruction: '',
    section_id: sectionId,
    weight: 10,
    answer_type: 'yes_no',
    options: clone(DEFAULT_OPTIONS.yes_no),
    scale: null,
    na_allowed: false,
    na_rule: null,
    is_critical: false,
    critical_values: [],
    required_evidence: 'text',
  };
}

type Errors = Record<string, string>;

function validate(name: string, rules: ChecklistDraft['rules'], sections: Section[], rows: Row[]): Errors {
  const e: Errors = {};
  if (!name.trim()) e['name'] = 'Укажите название.';
  const secIds = new Set<string>();
  sections.forEach((s, i) => {
    if (!s.section_id.trim()) e[`sec.${i}.id`] = 'Нужен ID.';
    else if (secIds.has(s.section_id)) e[`sec.${i}.id`] = 'ID повторяется.';
    secIds.add(s.section_id);
    if (!s.title.trim()) e[`sec.${i}.title`] = 'Нужно название.';
    if (rules.aggregation === 'weighted_sections' && (s.weight === null || !(s.weight >= 0))) e[`sec.${i}.weight`] = 'Нужен вес секции.';
  });
  const ids = new Set<string>();
  rows.forEach(({ uid: u, c }) => {
    const k = (f: string) => `${u}.${f}`;
    if (!/^[a-z0-9_-]+$/i.test(c.criterion_id)) e[k('id')] = 'Латиница, цифры, «_» или «-».';
    else if (ids.has(c.criterion_id)) e[k('id')] = 'ID повторяется.';
    ids.add(c.criterion_id);
    if (!c.title.trim()) e[k('title')] = 'Нужно название.';
    if (c.instruction.trim().length < 10) e[k('instruction')] = 'Инструкция для оценщика — минимум 10 символов.';
    if (!Number.isFinite(c.weight) || c.weight < 0) e[k('weight')] = 'Вес — число ≥ 0.';
    if (c.section_id && !secIds.has(c.section_id)) e[k('section')] = 'Секция не найдена.';
    if (c.answer_type === 'scale') {
      const s = c.scale;
      if (!s || !(s.max > s.min)) e[k('scale')] = 'Максимум шкалы должен быть больше минимума.';
      else if (!(s.step > 0) || Math.abs(((s.max - s.min) / s.step) % 1) > 1e-9) e[k('scale')] = 'Шаг должен делить диапазон без остатка.';
    } else {
      const vals = new Set<string>();
      if (c.options.length < 2) e[k('options')] = 'Нужно минимум два варианта.';
      c.options.forEach((o) => {
        if (!o.value.trim() || !o.label.trim()) e[k('options')] = 'У каждого варианта нужны значение и подпись.';
        else if (vals.has(o.value)) e[k('options')] = `Значение «${o.value}» повторяется.`;
        else if (!(o.score >= 0 && o.score <= 1)) e[k('options')] = 'Балл варианта — от 0 до 1.';
        vals.add(o.value);
      });
    }
    if (c.na_allowed && !c.na_rule?.trim()) e[k('na')] = 'Опишите, когда допустим N/A.';
    if (c.is_critical && !c.critical_values.length) e[k('critical')] = 'Отметьте ответы, означающие грубую ошибку.';
  });
  if (!rows.length) e['rows'] = 'Добавьте хотя бы один критерий.';
  else if (rows.reduce((a, r) => a + (Number.isFinite(r.c.weight) ? r.c.weight : 0), 0) <= 0) e['rows'] = 'Сумма весов должна быть больше 0.';
  return e;
}

const strip = (v: ChecklistVersion): ChecklistDraft => ({ checklist_id: v.checklist_id, name: v.name, is_official: v.is_official, rules: v.rules, sections: v.sections, criteria: v.criteria });

export function ChecklistView() {
  const { toast } = useApp();
  const lists = useAsync(() => api.checklists(), []);
  const versions = lists.data ?? [];
  const [baseId, setBaseId] = useState<number | null>(null);
  const base = versions.find((v) => v.version_id === baseId) ?? versions[versions.length - 1] ?? null;

  const [name, setName] = useState('');
  const [isOfficial, setIsOfficial] = useState(false);
  const [rules, setRules] = useState<ChecklistDraft['rules']>({ rounding_digits: 2, critical_policy: 'flag_only', aggregation: 'flat' });
  const [sections, setSections] = useState<Section[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ChecklistVersion | null>(null);

  const reset = (v: ChecklistVersion) => {
    setName(v.name);
    setIsOfficial(v.is_official);
    setRules(clone(v.rules));
    setSections(clone(v.sections));
    setRows(v.criteria.map((c) => ({ uid: uid(), c: clone(c), isNew: false })));
    setOpen(new Set());
    setShowErrors(false);
  };
  useEffect(() => {
    if (base) reset(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.version_id]);

  const draft: ChecklistDraft | null = base ? { checklist_id: base.checklist_id, name: name.trim(), is_official: isOfficial, rules, sections, criteria: rows.map((r) => r.c) } : null;
  const dirty = !!base && !!draft && JSON.stringify(draft) !== JSON.stringify(strip(base));
  const errors = useMemo(() => validate(name, rules, sections, rows), [name, rules, sections, rows]);
  const errCount = Object.keys(errors).length;
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const totalWeight = rows.reduce((a, r) => a + (Number.isFinite(r.c.weight) ? r.c.weight : 0), 0);

  const update = (u: string, patch: Partial<Criterion>) => setRows((rs) => rs.map((r) => (r.uid === u ? { ...r, c: { ...r.c, ...patch } } : r)));
  const toggleOpen = (u: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  const nextId = () => {
    const taken = new Set([...rows.map((r) => r.c.criterion_id), ...versions.flatMap((v) => v.criteria.map((c) => c.criterion_id))]);
    let i = rows.length + 1;
    while (taken.has(`criterion_${i}`)) i++;
    return `criterion_${i}`;
  };
  const addCriterion = () => {
    const r: Row = { uid: uid(), c: blankCriterion(nextId(), sections[0]?.section_id ?? null), isNew: true };
    setRows((rs) => [...rs, r]);
    setOpen((s) => new Set(s).add(r.uid));
    setTimeout(() => document.getElementById(`row-${r.uid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const duplicate = (r: Row) => {
    const n: Row = { uid: uid(), c: { ...clone(r.c), criterion_id: nextId(), title: `${r.c.title} (копия)` }, isNew: true };
    setRows((rs) => {
      const i = rs.findIndex((x) => x.uid === r.uid);
      return [...rs.slice(0, i + 1), n, ...rs.slice(i + 1)];
    });
    setOpen((s) => new Set(s).add(n.uid));
  };
  const move = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const n = [...rs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const save = async () => {
    setShowErrors(true);
    if (!draft || errCount) {
      const first = Object.keys(errors).find((k) => k.startsWith('r'));
      if (first) setOpen((s) => new Set(s).add(first.split('.')[0]));
      toast(`Исправьте ошибки (${errCount}) перед сохранением`, 'error');
      return;
    }
    setSaving(true);
    try {
      const v = await api.saveChecklist(draft);
      setSaved(v);
      await lists.reload(true);
      setBaseId(v.version_id);
      toast(`Сохранена версия v${v.version}. Старые оценки не изменились.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (lists.error) return <Alert tone="bad" title="Чек-листы не загружены">{lists.error.message}</Alert>;
  if (!base)
    return (
      <div className="space-y-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-64" />
      </div>
    );

  const latest = versions[versions.length - 1];
  const nextVersion = latest.version + 1;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <PageHeader
        title="Чек-лист"
        description="Критерии, веса, шкалы и правила N/A. Сохранение создаёт новую версию — уже сохранённые оценки не меняются."
        actions={
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            Основа
            <select className="input h-9 w-auto py-0" value={base.version_id} onChange={(e) => setBaseId(Number(e.target.value))} aria-label="Версия-основа">
              {[...versions].reverse().map((v) => (
                <option key={v.version_id} value={v.version_id}>
                  v{v.version} · {v.name}
                  {v.version_id === latest.version_id ? ' (последняя)' : ''}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {saved && (
        <Alert
          tone="ok"
          icon={CheckCircle2}
          title={`Версия v${saved.version} сохранена`}
          action={
            <Button size="sm" variant="primary" icon={Play} onClick={() => go(`/?apply=${saved.version_id}`)}>
              Применить к диалогам
            </Button>
          }
        >
          {saved.criteria.length} критериев. Запустите оценку по новой версии — она станет новым запуском рядом со старыми.
        </Alert>
      )}
      {!isOfficial && (
        <Alert tone="warn" icon={TriangleAlert}>
          Версия помечена как <b>неофициальная</b> (демо). Отметьте «Официальный», когда перенесёте правила из PDF организаторов.
        </Alert>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* ---------- Параметры ---------- */}
          <Card>
            <CardHeader icon={Settings2} title="Параметры версии" subtitle={`Основа: v${base.version} от ${dateTime(base.created_at)}`} />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Название" required error={err('name')} className="sm:col-span-2" htmlFor="cl-name">
                <input id="cl-name" className={cn('input', err('name') && 'input-invalid')} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Статус" hint="Из PDF организаторов?">
                <label className="flex h-[38px] items-center gap-2.5 rounded-lg border border-line-strong px-3 text-sm">
                  <Switch checked={isOfficial} onChange={setIsOfficial} label="Официальный" />
                  {isOfficial ? 'Официальный' : 'Демо'}
                </label>
              </Field>
              <Field label="Округление" hint="Знаков после запятой" htmlFor="cl-round">
                <input id="cl-round" type="number" min={0} max={4} className="input" value={rules.rounding_digits} onChange={(e) => setRules({ ...rules, rounding_digits: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
              </Field>
              <Field label="Грубая ошибка" className="sm:col-span-2">
                <Segmented
                  label="Грубая ошибка"
                  value={rules.critical_policy}
                  onChange={(v) => setRules({ ...rules, critical_policy: v })}
                  options={[
                    { value: 'flag_only', label: 'Только отметить' },
                    { value: 'zero_total', label: 'Обнулить итог' },
                  ]}
                />
              </Field>
              <Field label="Итог" className="sm:col-span-2">
                <Segmented
                  label="Агрегация"
                  value={rules.aggregation}
                  onChange={(v) => setRules({ ...rules, aggregation: v })}
                  options={[
                    { value: 'flat', label: 'По весам критериев' },
                    { value: 'weighted_sections', label: 'По весам секций', disabled: !sections.length },
                  ]}
                />
              </Field>
            </div>
          </Card>

          {/* ---------- Секции ---------- */}
          <Card>
            <CardHeader
              icon={Layers}
              title="Секции"
              subtitle={sections.length ? `${sections.length} · итоги секций показываются в карточке` : 'Необязательно'}
              actions={
                <Button size="sm" icon={Plus} onClick={() => setSections((s) => [...s, { section_id: `section_${s.length + 1}`, title: '', weight: rules.aggregation === 'weighted_sections' ? 0 : null }])}>
                  Секция
                </Button>
              }
            />
            {sections.length ? (
              <div className="divide-y divide-line">
                {sections.map((s, i) => {
                  const count = rows.filter((r) => r.c.section_id === s.section_id).length;
                  return (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_90px_auto] items-start gap-2.5 px-5 py-3">
                      <div>
                        <input aria-label="ID секции" className={cn('input font-mono text-[13px]', err(`sec.${i}.id`) && 'input-invalid')} value={s.section_id} onChange={(e) => setSections((ss) => ss.map((x, j) => (j === i ? { ...x, section_id: e.target.value } : x)))} />
                        {err(`sec.${i}.id`) && <p className="mt-1 text-xs text-bad">{err(`sec.${i}.id`)}</p>}
                      </div>
                      <div>
                        <input aria-label="Название секции" placeholder="Название" className={cn('input', err(`sec.${i}.title`) && 'input-invalid')} value={s.title} onChange={(e) => setSections((ss) => ss.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                        <p className="mt-1 text-[11.5px] text-fg-3">{count} критери{count === 1 ? 'й' : count > 1 && count < 5 ? 'я' : 'ев'}</p>
                      </div>
                      <input
                        aria-label="Вес секции"
                        type="number"
                        min={0}
                        placeholder="вес"
                        disabled={rules.aggregation !== 'weighted_sections'}
                        title={rules.aggregation !== 'weighted_sections' ? 'Используется при итоге «по весам секций»' : undefined}
                        className={cn('input text-right', err(`sec.${i}.weight`) && 'input-invalid')}
                        value={s.weight ?? ''}
                        onChange={(e) => setSections((ss) => ss.map((x, j) => (j === i ? { ...x, weight: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        aria-label="Удалить секцию"
                        onClick={() => {
                          setSections((ss) => ss.filter((_, j) => j !== i));
                          setRows((rs) => rs.map((r) => (r.c.section_id === s.section_id ? { ...r, c: { ...r.c, section_id: null } } : r)));
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-fg-3">Без секций итог считается по весам критериев.</p>
            )}
          </Card>

          {/* ---------- Критерии ---------- */}
          <Card>
            <CardHeader
              icon={ListChecks}
              title={`Критерии · ${rows.length}`}
              subtitle="Новый критерий применяется без правки кода — промпт строится из сохранённой версии."
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(rows.map((r) => r.uid)))}>
                    {open.size ? 'Свернуть все' : 'Развернуть все'}
                  </Button>
                  <Button size="sm" variant="primary" icon={Plus} onClick={addCriterion}>
                    Критерий
                  </Button>
                </>
              }
            />
            {err('rows') && <p className="px-5 pt-3 text-sm text-bad">{err('rows')}</p>}
            <ol className="divide-y divide-line">
              {rows.map((r, i) => (
                <CriterionRow
                  key={r.uid}
                  row={r}
                  index={i}
                  count={rows.length}
                  open={open.has(r.uid)}
                  sections={sections}
                  totalWeight={totalWeight}
                  errors={showErrors ? errors : {}}
                  onToggle={() => toggleOpen(r.uid)}
                  onChange={(p) => update(r.uid, p)}
                  onMove={(d) => move(i, d)}
                  onDuplicate={() => duplicate(r)}
                  onRemove={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                />
              ))}
            </ol>
            <div className="border-t border-line p-3">
              <button type="button" onClick={addCriterion} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong py-2.5 text-sm font-medium text-fg-2 transition hover:border-accent hover:bg-accent-weak/40 hover:text-accent">
                <Plus className="h-4 w-4" /> Добавить критерий
              </button>
            </div>
          </Card>
        </div>

        {/* ---------- Правая колонка ---------- */}
        <div className="flex flex-col gap-5 xl:sticky xl:top-4">
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Распределение весов</h2>
              <span className="text-sm font-semibold tabular-nums text-fg-2">Σ {Number(totalWeight.toFixed(2))}</span>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-3">
              {rows.map((r, i) => (
                <div key={r.uid} title={`${r.c.title || r.c.criterion_id}: ${r.c.weight}`} className={cn('h-full border-r-2 border-surface last:border-0', PALETTE[i % PALETTE.length])} style={{ width: totalWeight > 0 ? `${(Math.max(0, r.c.weight) / totalWeight) * 100}%` : 0 }} />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {rows.map((r, i) => (
                <li key={r.uid} className="flex items-center gap-2 text-[12.5px]">
                  <span className={cn('h-2 w-2 shrink-0 rounded-sm', PALETTE[i % PALETTE.length])} />
                  <span className="min-w-0 flex-1 truncate text-fg-2">{r.c.title || <i className="text-fg-3">без названия</i>}</span>
                  <span className="tabular-nums text-fg-3">{totalWeight > 0 ? `${Number(((Math.max(0, r.c.weight) / totalWeight) * 100).toFixed(1))}%` : '—'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">Доли — до N/A. Если критерий N/A, его вес перераспределяется между применимыми.</p>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader icon={History} title="Версии" />
            <ol className="max-h-[320px] overflow-y-auto scroll-thin px-5 py-4">
              {[...versions].reverse().map((v, i, arr) => (
                <li key={v.version_id} className="relative pb-4 pl-5 last:pb-0">
                  {i < arr.length - 1 && <span className="absolute left-[4px] top-3 h-full w-px bg-line" />}
                  <span className={cn('absolute left-0 top-1.5 h-[9px] w-[9px] rounded-full ring-4 ring-surface', i === 0 ? 'bg-accent' : 'bg-line-strong')} />
                  <button type="button" onClick={() => setBaseId(v.version_id)} className="block w-full text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">v{v.version}</span>
                      {i === 0 && <Tag className="bg-accent-weak text-accent">последняя</Tag>}
                      {v.is_official ? <Tag className="bg-ok-weak text-ok">офиц.</Tag> : <Tag>демо</Tag>}
                      {v.version_id === base.version_id && <span className="ml-auto text-[11px] text-accent">основа</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-3">
                      {dateTime(v.created_at)} · {v.criteria.length} крит. · Σ {v.criteria.reduce((a, c) => a + c.weight, 0)}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* ---------- Панель сохранения ---------- */}
      <div className="sticky bottom-4 z-10 mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur">
        <div className="min-w-0 flex-1 text-[13px]">
          {dirty ? (
            <span className="flex items-center gap-2 font-medium text-warn">
              <span className="h-2 w-2 rounded-full bg-warn" /> Есть несохранённые изменения относительно v{base.version}
            </span>
          ) : (
            <span className="text-fg-3">Изменений нет · основа v{base.version}</span>
          )}
          {showErrors && errCount > 0 && <span className="mt-0.5 block text-bad">Ошибок: {errCount} — поля подсвечены.</span>}
        </div>
        {dirty && (
          <Button variant="ghost" icon={RotateCcw} onClick={() => reset(base)}>
            Отменить
          </Button>
        )}
        <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={() => void save()}>
          Сохранить версию v{nextVersion}
        </Button>
      </div>
    </div>
  );
}

// ---------- Строка критерия ----------

function CriterionRow({
  row,
  index,
  count,
  open,
  sections,
  totalWeight,
  errors,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  row: Row;
  index: number;
  count: number;
  open: boolean;
  sections: Section[];
  totalWeight: number;
  errors: Errors;
  onToggle: () => void;
  onChange: (p: Partial<Criterion>) => void;
  onMove: (d: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { c, uid: u, isNew } = row;
  const e = (f: string) => errors[`${u}.${f}`];
  const hasErr = Object.keys(errors).some((k) => k.startsWith(u + '.'));
  const sec = sections.find((s) => s.section_id === c.section_id);

  const setType = (t: AnswerType) =>
    onChange({
      answer_type: t,
      options: t === 'scale' ? [] : clone(DEFAULT_OPTIONS[t]),
      scale: t === 'scale' ? { min: 1, max: 5, step: 1, map: null } : null,
      critical_values: [],
    });

  return (
    <li id={`row-${u}`} className={cn('scroll-m-24', open && 'bg-surface-2/60')}>
      <div className="flex items-center gap-3 px-5 py-3">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold', hasErr ? 'bg-bad-weak text-bad' : 'bg-surface-3 text-fg-2')}>{index + 1}</span>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('truncate font-semibold', !c.title && 'italic text-fg-3')}>{c.title || 'Без названия'}</span>
              {isNew && <Tag className="bg-ok-weak text-ok">новый</Tag>}
              {c.na_allowed && <Tag className="bg-na-weak text-na">N/A</Tag>}
              {c.is_critical && <Tag className="bg-bad-weak text-bad">грубая</Tag>}
              {c.required_evidence === 'audio' && <Tag className="bg-accent-weak text-accent">звук</Tag>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-fg-3">
              <span className="font-mono">{c.criterion_id}</span>
              <span>· {ANSWER_TYPE_LABEL[c.answer_type]}</span>
              {sec && <span>· {sec.title}</span>}
            </div>
          </div>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums">{c.weight}</span>
            <span className="block text-[11px] tabular-nums text-fg-3">{totalWeight > 0 ? `${Number(((Math.max(0, c.weight) / totalWeight) * 100).toFixed(1))}%` : ''}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
        </button>
        <div className="hidden shrink-0 items-center sm:flex">
          <Button size="sm" variant="ghost" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Выше" />
          <Button size="sm" variant="ghost" icon={ArrowDown} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Ниже" />
          <Button size="sm" variant="ghost" icon={Copy} onClick={onDuplicate} aria-label="Дублировать" />
          <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove} aria-label="Удалить" />
        </div>
      </div>

      {open && (
        <div className="grid animate-fade-in grid-cols-1 gap-4 border-t border-line px-5 pb-5 pt-4 sm:grid-cols-12">
          <Field label="Название" required error={e('title')} className="sm:col-span-6" htmlFor={`t-${u}`}>
            <input id={`t-${u}`} className={cn('input', e('title') && 'input-invalid')} value={c.title} placeholder="Например: Удержание клиента" onChange={(ev) => onChange({ title: ev.target.value })} />
          </Field>
          <Field label="ID" required error={e('id')} hint={isNew ? 'Можно изменить до сохранения' : 'ID существующего критерия не меняется'} className="sm:col-span-3" htmlFor={`id-${u}`}>
            <input id={`id-${u}`} className={cn('input font-mono text-[13px]', e('id') && 'input-invalid')} value={c.criterion_id} disabled={!isNew} onChange={(ev) => onChange({ criterion_id: ev.target.value.trim() })} />
          </Field>
          <Field label="Вес" required error={e('weight')} className="sm:col-span-3" htmlFor={`w-${u}`}>
            <input id={`w-${u}`} type="number" min={0} step="any" className={cn('input text-right', e('weight') && 'input-invalid')} value={Number.isFinite(c.weight) ? c.weight : ''} onChange={(ev) => onChange({ weight: ev.target.value === '' ? NaN : Number(ev.target.value) })} />
          </Field>

          <Field label="Инструкция оценщику" required error={e('instruction')} hint="Что искать и когда критерий выполнен. Попадает в промпт модели." className="sm:col-span-12" htmlFor={`in-${u}`}>
            <textarea id={`in-${u}`} rows={3} className={cn('input resize-y', e('instruction') && 'input-invalid')} value={c.instruction} onChange={(ev) => onChange({ instruction: ev.target.value })} />
          </Field>

          <Field label="Секция" error={e('section')} className="sm:col-span-4" htmlFor={`s-${u}`}>
            <select id={`s-${u}`} className="input" value={c.section_id ?? ''} onChange={(ev) => onChange({ section_id: ev.target.value || null })}>
              <option value="">— без секции —</option>
              {sections.map((s) => (
                <option key={s.section_id} value={s.section_id}>
                  {s.title || s.section_id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тип ответа" className="sm:col-span-5">
            <Segmented label="Тип ответа" value={c.answer_type} onChange={setType} options={(['yes_no', 'single_choice', 'scale'] as AnswerType[]).map((t) => ({ value: t, label: { yes_no: 'Да / Нет', single_choice: 'Варианты', scale: 'Шкала' }[t] }))} />
          </Field>
          <Field label="Основание" hint={c.required_evidence === 'audio' ? 'Без звука → «Нужна проверка»' : undefined} className="sm:col-span-3">
            <Segmented
              label="Основание"
              value={c.required_evidence}
              onChange={(v) => onChange({ required_evidence: v })}
              options={[
                { value: 'text', label: 'Текст' },
                { value: 'audio', label: 'Звук' },
              ]}
            />
          </Field>

          {/* Варианты / шкала */}
          <div className="sm:col-span-12">
            {c.answer_type === 'scale' ? (
              <ScaleEditor c={c} error={e('scale')} onChange={onChange} />
            ) : (
              <OptionsEditor c={c} error={e('options')} onChange={onChange} />
            )}
          </div>

          {/* N/A и грубая ошибка */}
          <div className="rounded-xl border border-line bg-surface p-3.5 sm:col-span-6">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Switch checked={c.na_allowed} onChange={(v) => onChange({ na_allowed: v, na_rule: v ? c.na_rule : null })} label="Допускает N/A" />
              <CircleSlash className="h-4 w-4 text-na" /> Допускает N/A
            </label>
            {c.na_allowed && (
              <Field label="Когда допустим N/A" required error={e('na')} className="mt-3" htmlFor={`na-${u}`}>
                <input id={`na-${u}`} className={cn('input', e('na') && 'input-invalid')} value={c.na_rule ?? ''} placeholder="Например: клиент уже идентифицирован ботом" onChange={(ev) => onChange({ na_rule: ev.target.value })} />
              </Field>
            )}
            {!c.na_allowed && <p className="mt-2 text-xs text-fg-3">Если оценить нельзя — статус «Нужна проверка», а не N/A.</p>}
          </div>
          <div className="rounded-xl border border-line bg-surface p-3.5 sm:col-span-6">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Switch checked={c.is_critical} onChange={(v) => onChange({ is_critical: v, critical_values: v ? c.critical_values : [] })} label="Грубая ошибка" />
              <AlertOctagon className="h-4 w-4 text-bad" /> Грубая ошибка
            </label>
            {c.is_critical && (
              <div className="mt-3">
                <div className="mb-1.5 text-[12.5px] font-medium text-fg-2">Ответы, означающие грубую ошибку</div>
                <div className="flex flex-wrap gap-1.5">
                  {answerChoices(c).map((o) => {
                    const on = c.critical_values.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange({ critical_values: on ? c.critical_values.filter((x) => x !== o.value) : [...c.critical_values, o.value] })}
                        className={cn('h-7 rounded-md border px-2.5 text-[12.5px] font-medium transition', on ? 'border-bad bg-bad text-white' : 'border-line-strong bg-surface text-fg-2 hover:border-bad hover:text-bad')}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {e('critical') && <p className="mt-1.5 text-xs text-bad">{e('critical')}</p>}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-1 sm:hidden">
            <Button size="sm" variant="ghost" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Выше" />
            <Button size="sm" variant="ghost" icon={ArrowDown} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Ниже" />
            <Button size="sm" variant="ghost" icon={Copy} onClick={onDuplicate} aria-label="Дублировать" />
            <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove}>
              Удалить
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function OptionsEditor({ c, error, onChange }: { c: Criterion; error?: string; onChange: (p: Partial<Criterion>) => void }) {
  const fixed = c.answer_type === 'yes_no';
  const set = (i: number, p: Partial<AnswerOption>) => {
    const prev = c.options[i];
    const options = c.options.map((o, j) => (j === i ? { ...o, ...p } : o));
    const critical_values = p.value !== undefined ? c.critical_values.map((v) => (v === prev.value ? p.value! : v)) : c.critical_values;
    onChange({ options, critical_values });
  };
  return (
    <div className={cn('rounded-xl border bg-surface p-3.5', error ? 'border-bad/50' : 'border-line')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-2">Варианты ответа и нормализованный балл q (0–1)</span>
        {!fixed && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange({ options: [...c.options, { value: `option_${c.options.length + 1}`, label: '', score: 0 }] })}>
            Вариант
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_90px_32px] gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-3">
          <span>Значение</span>
          <span>Подпись</span>
          <span className="text-right">Балл q</span>
          <span />
        </div>
        {c.options.map((o, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_90px_32px] items-center gap-2">
            <input aria-label="Значение" className="input font-mono text-[13px]" value={o.value} disabled={fixed} onChange={(e) => set(i, { value: e.target.value.trim() })} />
            <input aria-label="Подпись" className="input" value={o.label} onChange={(e) => set(i, { label: e.target.value })} />
            <input aria-label="Балл" type="number" min={0} max={1} step={0.05} className="input text-right" value={o.score} onChange={(e) => set(i, { score: Number(e.target.value) })} />
            {!fixed && c.options.length > 2 ? (
              <Button size="sm" variant="danger" icon={Trash2} aria-label="Удалить вариант" onClick={() => onChange({ options: c.options.filter((_, j) => j !== i), critical_values: c.critical_values.filter((v) => v !== o.value) })} />
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}

function ScaleEditor({ c, error, onChange }: { c: Criterion; error?: string; onChange: (p: Partial<Criterion>) => void }) {
  const s = c.scale ?? { min: 1, max: 5, step: 1, map: null };
  const set = (p: Partial<typeof s>) => onChange({ scale: { ...s, ...p }, critical_values: [] });
  const preview = !error && s.max > s.min && s.step > 0 ? answerChoices({ ...c, scale: s }) : [];
  return (
    <div className={cn('rounded-xl border bg-surface p-3.5', error ? 'border-bad/50' : 'border-line')}>
      <div className="mb-2 text-[12.5px] font-medium text-fg-2">Шкала</div>
      <div className="grid grid-cols-3 gap-2 sm:max-w-sm">
        {(['min', 'max', 'step'] as const).map((k) => (
          <label key={k} className="text-[11px] font-medium uppercase tracking-wide text-fg-3">
            {k === 'min' ? 'Мин.' : k === 'max' ? 'Макс.' : 'Шаг'}
            <input type="number" className="input mt-1 text-right" value={s[k]} onChange={(e) => set({ [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      {preview.length > 0 && preview.length <= 21 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {preview.map((p) => (
            <span key={p.value} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
              {p.value}→{Number(((Number(p.value) - s.min) / (s.max - s.min)).toFixed(2))}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-fg-3">q = (значение − мин) / (макс − мин). Если в PDF другая нормализация — её задаёт калькулятор (scale.map).</p>
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
      {c.scale?.map && (
        <Chip tone="accent" className="mt-2">
          Задано явное отображение scale.map
        </Chip>
      )}
    </div>
  );
}
