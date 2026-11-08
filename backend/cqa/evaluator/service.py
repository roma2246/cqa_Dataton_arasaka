"""Функция оценки. Владелец: Участник 2.

evaluate(conv, checklist) -> EvaluatorOutput
Режимы:
  - mock: детерминированный ТЕСТОВЫЙ ответ без модели (в UI помечается как тестовый);
  - real: настоящая модель через llm_client.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

from pydantic import ValidationError

from ..config import settings
from ..models import AIEvaluation, ChecklistDraft, CheckedRange, Conversation, CriterionResult
from . import llm_client, prompt_builder
from .validation import validate


@dataclass
class EvaluatorOutput:
    results: list[CriterionResult]
    problems: list[str]
    mode: str
    model: str
    prompt_version: str
    calls: list[dict] = field(default_factory=list)
    cost_usd: Optional[float] = None
    agreement: dict = field(default_factory=dict)   # criterion_id -> доля прогонов с победившим ответом


def evaluate(conv: Conversation, checklist: ChecklistDraft) -> EvaluatorOutput:
    if settings.evaluator_mode == "mock":
        return _mock(conv, checklist)
    if settings.llm_votes > 1:
        return _voted(conv, checklist, settings.llm_votes)
    return _real(conv, checklist)


def _key(r: CriterionResult) -> tuple:
    return (r.status, r.answer if r.status == "applicable" else None)


def _voted(conv: Conversation, checklist: ChecklistDraft, n: int) -> EvaluatorOutput:
    """N независимых оценок параллельно; по каждому критерию — ответ большинства.
    Нет большинства: для шкалы — медиана, иначе первый применимый ответ. Сбой части прогонов допустим."""
    from collections import Counter
    from concurrent.futures import ThreadPoolExecutor
    runs, errors = [], []
    with ThreadPoolExecutor(max_workers=n) as pool:
        for fut in [pool.submit(_real, conv, checklist) for _ in range(n)]:
            try:
                runs.append(fut.result())
            except llm_client.LLMError as e:
                errors.append(e)
    if not runs:
        err = errors[0]
        err.calls = [c for e in errors for c in e.calls]
        raise err
    results, agreement = [], {}
    for c in checklist.criteria:
        cands = [next(r for r in run.results if r.criterion_id == c.criterion_id) for run in runs]
        counts = Counter(_key(r) for r in cands)
        top, cnt = counts.most_common(1)[0]
        if cnt == 1 and len(cands) > 2:
            nums = sorted(int(r.answer) for r in cands if r.status == "applicable" and (r.answer or "").isdigit())
            if len(nums) == len(cands):  # шкала: медиана
                top = ("applicable", str(nums[len(nums) // 2]))
            else:
                top = next((_key(r) for r in cands if r.status == "applicable"), top)
            cnt = sum(1 for r in cands if _key(r) == top)
        chosen = next(r for r in cands if _key(r) == top) if cnt else cands[0]
        results.append(chosen)
        agreement[c.criterion_id] = round(cnt / len(runs), 2)
    calls = [c for run in runs for c in run.calls] + [c.__dict__ for e in errors for c in e.calls]
    costs = [run.cost_usd for run in runs]
    problems = [p for run in runs for p in run.problems] + [f"прогон не удался: {str(e)[:100]}" for e in errors]
    weak = [k for k, v in agreement.items() if v < 1]
    if weak:
        problems.append("нет единогласия: " + ", ".join(f"{k} {agreement[k]:.0%}" for k in weak))
    return EvaluatorOutput(
        results=results, problems=problems, mode="real", model=runs[0].model,
        prompt_version=runs[0].prompt_version + f"+vote{len(runs)}", calls=calls,
        cost_usd=round(sum(costs), 6) if all(x is not None for x in costs) else None, agreement=agreement)


def calibration_examples(conv: Conversation, checklist: ChecklistDraft) -> list[dict]:
    if not settings.calibration:
        return []
    from .. import storage
    fps = {c.criterion_id: storage.criterion_fingerprint(c) for c in checklist.criteria}
    return storage.calibration_for(fps, conv.conversation_id, settings.calibration_per_criterion)


def _real(conv: Conversation, checklist: ChecklistDraft) -> EvaluatorOutput:
    system = prompt_builder.system_prompt()
    examples = calibration_examples(conv, checklist)
    user = prompt_builder.user_prompt(checklist, conv, examples)
    schema = prompt_builder.output_schema(checklist)
    calls: list[llm_client.CallRecord] = []
    parsed: Optional[AIEvaluation] = None
    last_err = ""
    # Не более одного повтора при неверном формате; все вызовы учитываются в стоимости.
    for _attempt in range(2):
        try:
            resp = llm_client.chat_json(system, user, schema)
        except llm_client.LLMError as e:
            e.calls = calls + e.calls
            raise
        calls += resp.calls
        try:
            raw = json.loads(resp.text)
            if prompt_builder.ultra():
                raw = prompt_builder.expand_ultra(raw)
            elif prompt_builder.compact():
                raw = prompt_builder.expand_compact(raw)
            parsed = AIEvaluation.model_validate(raw)
            break
        except (json.JSONDecodeError, ValidationError) as e:
            last_err = str(e)[:300]
            user = (prompt_builder.user_prompt(checklist, conv, examples)
                    + f"\n\nПредыдущий ответ не прошёл проверку формата: {last_err}\nВерни корректный JSON.")
    if parsed is None:
        raise llm_client.LLMError(f"Неверный JSON от модели после повтора: {last_err}", calls)

    results, problems = validate(parsed.results, checklist, conv)
    results, problems = _guard_identification(results, problems, conv)
    results, problems = _guard_disclosure(results, problems)
    results, problems = _guard_discovery(results, problems, conv)
    results, problems = _resolve_needs_review(results, problems, checklist, conv, system, examples, schema, calls)
    models = sorted({c.model for c in calls if c.model})
    return EvaluatorOutput(
        results=results, problems=problems, mode="real", model=", ".join(models) or settings.llm_model,
        prompt_version=prompt_builder.PROMPT_VERSION + (f"+cal{len(examples)}" if examples else ""),
        calls=[c.__dict__ for c in calls], cost_usd=llm_client.cost_usd(calls),
    )


def _mock(conv: Conversation, checklist: ChecklistDraft) -> EvaluatorOutput:
    """Заглушка, чтобы UI и сервер работали до подключения модели. НЕ оценка!"""
    ops = [m for m in conv.messages if m.speaker == "operator"]
    first, last = conv.messages[0].message_id, conv.messages[-1].message_id
    results = []
    for i, c in enumerate(checklist.criteria):
        if c.required_evidence == "audio":
            results.append(CriterionResult(criterion_id=c.criterion_id, status="needs_review",
                                           explanation="[ТЕСТ] Требуется звук", review_reason="audio_required"))
        elif c.na_allowed and i % 4 == 3:
            results.append(CriterionResult(criterion_id=c.criterion_id, status="not_applicable",
                                           explanation="[ТЕСТ] Пример N/A", na_reason="Тестовая причина N/A"))
        elif c.answer_type == "scale" and c.scale:
            results.append(CriterionResult(
                criterion_id=c.criterion_id, status="applicable", answer=str(c.scale.max - 1),
                explanation="[ТЕСТ] Шкальная оценка",
                evidence_message_ids=[ops[0].message_id] if ops else []))
        else:
            best = max(c.options, key=lambda o: o.score)
            worst = min(c.options, key=lambda o: o.score)
            if ops and i % 3 != 2:
                results.append(CriterionResult(
                    criterion_id=c.criterion_id, status="applicable", answer=best.value,
                    explanation="[ТЕСТ] Действие найдено в реплике оператора",
                    evidence_message_ids=[ops[min(i, len(ops) - 1)].message_id]))
            else:
                results.append(CriterionResult(
                    criterion_id=c.criterion_id, status="applicable", answer=worst.value,
                    explanation="[ТЕСТ] Действие не найдено в проверенном диапазоне",
                    checked_range=CheckedRange(from_message_id=first, to_message_id=last)))
    results, problems = validate(results, checklist, conv)
    return EvaluatorOutput(results=results, problems=problems, mode="mock", model="mock",
                           prompt_version="mock", calls=[], cost_usd=0.0)


def _parse(text: str) -> AIEvaluation:
    raw = json.loads(text)
    if prompt_builder.ultra():
        raw = prompt_builder.expand_ultra(raw)
    elif prompt_builder.compact():
        raw = prompt_builder.expand_compact(raw)
    return AIEvaluation.model_validate(raw)


def _guard_identification(results, problems, conv):
    """«Да» по идентификации без единой реплики о проверке личности противоречит определению чек-листа.
    Такой ответ не подменяем сами, а отправляем на уточняющий запрос (решит N/A или «Нет»)."""
    if any(prompt_builder._VERIFY.search(m.text) for m in conv.messages):
        return results, problems
    out = []
    for r in results:
        if r.criterion_id == "identification" and r.status == "applicable" and r.answer == "yes":
            r = r.model_copy(update={"status": "needs_review", "answer": None,
                                     "review_reason": "«Да» без реплики о проверке личности — реши: N/A или «Нет»"})
            problems = problems + ["идентификация «Да» без проверки личности — отправлено на уточнение"]
        out.append(r)
    return out, problems


def _guard_discovery(results, problems, conv):
    """«Да» по выявлению потребности требует уточняющего вопроса оператора. Вопросов не было — на уточнение."""
    if prompt_builder.operator_questions(conv):
        return results, problems
    out = []
    for r in results:
        if r.criterion_id == "discovery" and r.status == "applicable" and r.answer == "yes":
            r = r.model_copy(update={"status": "needs_review", "answer": None, "review_reason":
                "Оператор не задал клиенту ни одного вопроса, значит «Да» невозможно. Реши: N/A — если слов клиента хватало "
                "для правильного ответа; «Нет» — если данных не хватало, а оператор ответил наугад или не учёл сказанное."})
            problems = problems + ["потребность «Да» без вопросов оператора — отправлено на уточнение"]
        out.append(r)
    return out, problems


def _guard_disclosure(results, problems):
    """Идентификация «Нет» по чек-листу значит: данные счёта названы без проверки — это и грубая ошибка (раскрытие).
    Если модель поставила «Нет» по идентификации, а грубую ошибку не отметила, — уточняющий запрос по грубой ошибке."""
    by = {r.criterion_id: r for r in results}
    ident, crit = by.get("identification"), by.get("critical")
    if not (ident and ident.status == "applicable" and ident.answer == "no"):
        return results, problems
    # «Нет» по идентификации всегда перепроверяем: по чек-листу оно значит, что данные счёта названы
    # (или сделано действие по счёту) без проверки. Если ничего такого не было — это N/A.
    ask_id = ("Подтверди «Нет»: назвал ли оператор данные КОНКРЕТНОГО счёта клиента (баланс, ограничение, операции, статус "
              "заявки) или сделал что-то со счётом без подтверждённой проверки? Если да — «Нет». Если оператор только "
              "объяснял, советовал или отвечал в общем — N/A.")
    results = [r.model_copy(update={"status": "needs_review", "answer": None, "review_reason": ask_id})
               if r.criterion_id == "identification" else r for r in results]
    problems = problems + ["идентификация «Нет» — отправлено на подтверждение"]
    if not (crit and crit.status == "applicable" and crit.answer == "no"):
        return results, problems
    why = ("Идентификация «Нет»: если оператор назвал данные конкретного счёта (баланс, ограничение, операции) "
           "без подтверждённой проверки — это раскрытие конфиденциальной информации, грубая ошибка «Да». "
           "«Нет» — только если данных счёта оператор не называл.")
    fixed = crit.model_copy(update={"status": "needs_review", "answer": None, "review_reason": why})
    return [fixed if r.criterion_id == "critical" else r for r in results], problems + [
        "идентификация «Нет» без флага грубой ошибки — отправлено на уточнение"]


def _resolve_needs_review(results, problems, checklist, conv, system, examples, schema, calls):
    """Один уточняющий запрос по критериям, которые модель оставила «нужна проверка».
    Если и после него решить нельзя — статус остаётся needs_review (ничего не подменяем)."""
    pending = [r for r in results if r.status == "needs_review" and r.review_reason != "missing"]
    if not pending or not settings.followup:
        return results, problems
    ids = {r.criterion_id for r in pending}
    sub = checklist.model_copy(update={"criteria": [c for c in checklist.criteria if c.criterion_id in ids]})
    ask = "\n".join(f"- {r.criterion_id}: {r.review_reason or r.explanation}" for r in pending)
    user = (prompt_builder.user_prompt(sub, conv, examples)
            + "\n\nВ прошлой оценке эти критерии остались без решения:\n" + ask
            + "\nРеши их сейчас по instruction и na_rule: выбери ответ, либо not_applicable, если выполнено условие N/A. "
              "needs_review допустим, только если в разговоре вообще нет материала для решения. "
              "Верни JSON только по этим критериям.")
    try:
        resp = llm_client.chat_json(system, user, prompt_builder.output_schema(sub))
        calls += resp.calls
        fixed, extra = validate(_parse(resp.text).results, sub, conv)
    except (llm_client.LLMError, json.JSONDecodeError, ValidationError) as e:
        calls += getattr(e, "calls", [])
        return results, problems + [f"уточнение не удалось: {str(e)[:120]}"]
    by = {r.criterion_id: r for r in fixed if r.status != "needs_review"}
    if by:
        problems = problems + [f"уточнено повторным запросом: {', '.join(sorted(by))}"] + extra
    return [by.get(r.criterion_id, r) for r in results], problems
