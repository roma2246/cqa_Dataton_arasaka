// Калькулятор ТОЛЬКО для демо-режима (mock). В реальном режиме итог приходит с сервера
// (backend/cqa/scoring.py, Decimal-округление) — UI ничего не пересчитывает сам.
import type { ChecklistDraft, CriterionResult, CriterionScore, ScoreResult } from '../types';
import { qFor } from '../../lib/format';
export { qFor };

const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function computeScore(checklist: ChecklistDraft, results: CriterionResult[]): ScoreResult {
  const d = checklist.rules.rounding_digits;
  const byId = new Map(results.map((r) => [r.criterion_id, r]));

  const rows = checklist.criteria.map((c) => {
    const r = byId.get(c.criterion_id);
    let status = r?.status ?? 'needs_review';
    const q = status === 'applicable' ? qFor(c, r?.answer ?? null) : null;
    if (status === 'applicable' && q === null) status = 'needs_review';
    const hit = c.is_critical && status === 'applicable' && !!r?.answer && c.critical_values.includes(r.answer);
    return { c, r, status, q, hit };
  });

  const needsReview = rows.some((x) => x.status === 'needs_review');
  const applicable = rows.filter((x) => x.status === 'applicable' && x.q !== null);

  // Эффективный вес (в % от итога) после перераспределения N/A
  const effective = new Map<string, number>();
  const sectionTotals = checklist.sections.map((s) => {
    const inSec = applicable.filter((x) => x.c.section_id === s.section_id);
    const w = inSec.reduce((a, x) => a + x.c.weight, 0);
    return { section_id: s.section_id, weight: s.weight ?? 0, w, total: w > 0 ? (inSec.reduce((a, x) => a + (x.q as number) * x.c.weight, 0) / w) * 100 : null };
  });

  if (checklist.rules.aggregation === 'weighted_sections' && checklist.sections.length) {
    const live = sectionTotals.filter((s) => s.total !== null && s.weight > 0);
    const sw = live.reduce((a, s) => a + s.weight, 0);
    for (const x of applicable) {
      const s = live.find((y) => y.section_id === x.c.section_id);
      if (s && sw > 0) effective.set(x.c.criterion_id, (x.c.weight / s.w) * (s.weight / sw) * 100);
    }
  } else {
    const W = applicable.reduce((a, x) => a + x.c.weight, 0);
    for (const x of applicable) if (W > 0) effective.set(x.c.criterion_id, (x.c.weight / W) * 100);
  }

  const criteria: CriterionScore[] = rows.map((x) => {
    const eff = effective.get(x.c.criterion_id) ?? null;
    return {
      criterion_id: x.c.criterion_id,
      status: x.status,
      answer: x.r?.answer ?? null,
      weight: x.c.weight,
      q: x.q,
      effective_weight: eff === null ? null : roundTo(eff, d),
      contribution: eff === null || x.q === null ? null : roundTo(eff * x.q, d),
      is_critical_hit: x.hit,
    };
  });

  const hits = rows.filter((x) => x.hit).map((x) => x.c.criterion_id);
  let total: number | null = null;
  let incomplete_reason: string | null = null;
  if (needsReview) incomplete_reason = 'Есть критерии со статусом «Нужна проверка» — итог не определён.';
  else if (effective.size === 0) incomplete_reason = 'Все критерии неприменимы (N/A) — итог не определён.';
  else total = roundTo([...effective.entries()].reduce((a, [id, eff]) => a + eff * (rows.find((x) => x.c.criterion_id === id)?.q ?? 0), 0), d);

  if (hits.length && checklist.rules.critical_policy === 'zero_total' && !needsReview) total = 0;

  return {
    total,
    incomplete_reason,
    critical_error: hits.length > 0,
    critical_criteria: hits,
    criteria,
    sections: sectionTotals.map((s) => ({ section_id: s.section_id, total: s.total === null ? null : roundTo(s.total, d) })),
  };
}
