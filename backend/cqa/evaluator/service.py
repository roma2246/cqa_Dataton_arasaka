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


def evaluate(conv: Conversation, checklist: ChecklistDraft) -> EvaluatorOutput:
    if settings.evaluator_mode == "mock":
        return _mock(conv, checklist)
    return _real(conv, checklist)


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
