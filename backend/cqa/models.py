"""Общие модели данных (контракт). Владелец: Участник 1.

Любое изменение здесь синхронизируется с frontend/js/contracts.js (Участник 3),
проверяется Участником 2 (ответ оценщика) и Участником 4 (представимость правил).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------- Диалоги ----------

Speaker = Literal["client", "operator", "bot", "system"]
Channel = Literal["agent chat", "voice call"]
Language = Literal["RU", "KZ", "EN"]


class Message(BaseModel):
    message_id: str            # стабильный ID внутри диалога: m001, m002, ...
    index: int                 # порядковый номер (0..n-1)
    timestamp: str             # ИСХОДНАЯ метка времени (MM:SS у чатов, ISO 8601 у звонков)
    speaker: Speaker
    text: str


class Conversation(BaseModel):
    conversation_id: str
    group_id: str
    channel: str
    language: str
    audio_url: Optional[str] = None
    content_hash: str
    messages: list[Message] = []


# ---------- Чек-лист ----------

AnswerType = Literal["yes_no", "single_choice", "scale"]


class AnswerOption(BaseModel):
    value: str                 # машинное значение: "yes", "partial", "no"
    label: str                 # подпись в UI
    score: float = Field(ge=0, le=1)  # нормализованный балл q (0..1)


class Scale(BaseModel):
    min: int = 1
    max: int = 5
    step: int = 1
    # Явное отображение значение -> q. Если не задано, q = (v - min) / (max - min).
    # ВНИМАНИЕ: уточнить по официальному PDF, не предполагать молча.
    map: Optional[dict[str, float]] = None


class Criterion(BaseModel):
    criterion_id: str
    title: str
    instruction: str           # инструкция оценщику (что искать, критерий успеха)
    section_id: Optional[str] = None
    weight: float = Field(ge=0)
    answer_type: AnswerType
    options: list[AnswerOption] = []   # для yes_no / single_choice
    scale: Optional[Scale] = None      # для scale
    na_allowed: bool = False
    na_rule: Optional[str] = None      # когда допустим N/A
    is_critical: bool = False          # грубая ошибка
    critical_values: list[str] = []    # ответы, означающие грубую ошибку
    required_evidence: Literal["text", "audio"] = "text"


class Section(BaseModel):
    section_id: str
    title: str
    weight: Optional[float] = None


class ScoringRules(BaseModel):
    rounding_digits: int = 2
    # flag_only - грубая ошибка только помечается; zero_total - итог = 0.
    # Реальное правило берётся из официального PDF (задача Q01).
    critical_policy: Literal["flag_only", "zero_total"] = "flag_only"
    # flat - один взвешенный итог по всем критериям; weighted_sections - итог по весам секций
    aggregation: Literal["flat", "weighted_sections"] = "flat"


class ChecklistDraft(BaseModel):
    """Тело запроса на сохранение новой версии."""
    checklist_id: str = "main"
    name: str
    is_official: bool = False
    rules: ScoringRules = ScoringRules()
    sections: list[Section] = []
    criteria: list[Criterion]


class ChecklistVersion(ChecklistDraft):
    version_id: int
    version: int
    created_at: str


# ---------- Ответ ИИ (без общего балла!) ----------

CriterionStatus = Literal["applicable", "not_applicable", "needs_review"]


class CheckedRange(BaseModel):
    from_message_id: str
    to_message_id: str


class CriterionResult(BaseModel):
    criterion_id: str
    status: CriterionStatus
    answer: Optional[str] = None        # value варианта или число шкалы строкой; null при N/A и needs_review
    explanation: str
    evidence_message_ids: list[str] = []   # подтверждающие реплики
    checked_range: Optional[CheckedRange] = None  # для пропущенного действия
    na_reason: Optional[str] = None
    review_reason: Optional[str] = None


class AIEvaluation(BaseModel):
    results: list[CriterionResult]


# ---------- Итог (считает калькулятор, Участник 4) ----------

class CriterionScore(BaseModel):
    criterion_id: str
    status: CriterionStatus
    answer: Optional[str]
    weight: float
    q: Optional[float]                 # нормализованный балл, null если не применим / не оценён
    effective_weight: Optional[float]  # вес после перераспределения N/A
    contribution: Optional[float]      # вклад в итог, в процентных пунктах
    is_critical_hit: bool = False


class SectionScore(BaseModel):
    section_id: str
    total: Optional[float]


class ScoreResult(BaseModel):
    total: Optional[float]              # null != 0 ! null = итог не определён
    incomplete_reason: Optional[str] = None
    critical_error: bool = False
    critical_criteria: list[str] = []
    criteria: list[CriterionScore]
    sections: list[SectionScore] = []


# ---------- Оценка, апелляции ----------

JobStatus = Literal["queued", "running", "completed", "failed"]


class EvaluationRequest(BaseModel):
    conversation_id: str
    checklist_version_id: int


class AppealCreate(BaseModel):
    criterion_id: str
    comment: str = Field(min_length=1)


class DecisionCreate(BaseModel):
    action: Literal["confirm", "change"]
    reason: str = Field(min_length=1)
    expected_revision: int             # защита от решения по устаревшей версии
    # Для action=change:
    new_status: Optional[CriterionStatus] = None
    new_answer: Optional[str] = None
