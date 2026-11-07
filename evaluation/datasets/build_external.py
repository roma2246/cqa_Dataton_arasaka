"""ВНЕШНИЙ тест-сет из реальных человеческих фраз открытых наборов. Только для замера, не для настройки.
Владелец: Участник 4.

Источники (скачиваются отдельно в data/external/, в Git не попадают):
  TyDiP (CC BY 4.0)            — вежливость, RU и EN (EN = Stanford Politeness Corpus)
  textdetox toxicity (OpenRAIL++) — токсичные фразы, RU и EN
  deepset prompt-injections (Apache-2.0) — попытки инъекций, в основном EN

Фраза подставляется как реплика оператора (вежливость/грубость) или клиента (инъекция)
в шаблонный диалог. Размечается только тот критерий, ответ на который следует из разметки источника.

Запуск (из корня проекта):
  .venv/bin/python -I evaluation/datasets/build_external.py data/external data/testsets/external_v1.json
"""
from __future__ import annotations

import csv
import json
import random
import sys
from pathlib import Path

SEED = 20261107
N_POLITE = 8      # на полюс и язык
N_TOXIC = 6       # на язык
N_INJECT = 10

TEMPLATE = {
    "RU": {"bot": "Здравствуйте! Я виртуальный помощник Freedom Broker. Чем могу помочь?",
           "client": "Подскажите, пожалуйста, по моему вопросу.",
           "system": "Диалог передан оператору",
           "op_plain": "Не знаю."},
    "EN": {"bot": "Hello! I'm the Freedom Broker virtual assistant. How can I help?",
           "client": "Could you help me with my question, please?",
           "system": "Chat transferred to an agent",
           "op_plain": "I don't know."},
}

SOURCES = [
    {"name": "TyDiP", "license": "CC BY 4.0", "url": "https://huggingface.co/datasets/Genius1237/TyDiP",
     "citation": "Srinivasan & Choi, TyDiP, Findings of EMNLP 2022; EN — Danescu-Niculescu-Mizil et al., 2013"},
    {"name": "textdetox/multilingual_toxicity_dataset", "license": "OpenRAIL++",
     "url": "https://huggingface.co/datasets/textdetox/multilingual_toxicity_dataset"},
    {"name": "deepset/prompt-injections", "license": "Apache-2.0",
     "url": "https://huggingface.co/datasets/deepset/prompt-injections"},
]


def dialog(cid: str, lang: str, turns: list[tuple[str, str]]) -> dict:
    return {"conversation_id": cid, "channel": "agent chat", "language": lang, "audio_url": None,
            "transcript": [{"timestamp": f"00:{10 * i:02d}", "speaker": s, "text": t} for i, (s, t) in enumerate(turns)]}


def clean(t: str) -> str:
    return " ".join(str(t).split())


def main(raw: Path, out: Path) -> None:
    import pyarrow.parquet as pq

    rnd = random.Random(SEED)
    records, expected, meta = [], {}, {}

    def add(cid, lang, turns, exp, kind, source, text):
        records.append(dialog(cid, lang, turns))
        expected[cid] = exp
        meta[cid] = {"scenario": kind, "language": lang, "source": source, "what": text[:120]}

    # 1. Вежливость (TyDiP): явные полюса по средней оценке разметчиков
    for lang in ("RU", "EN"):
        rows = list(csv.DictReader(open(raw / "tydip" / f"{lang.lower()}_test.csv", encoding="utf-8")))
        rows = [r for r in rows if 20 <= len(clean(r["sentence"])) <= 300]
        polite = [r for r in rows if float(r["score"]) >= 1.0]
        rude = [r for r in rows if float(r["score"]) <= -1.0]
        for kind, pool, answers in (("polite", polite, ["3", "4", "5"]), ("impolite", rude, ["1", "2", "3"])):
            for i, r in enumerate(rnd.sample(pool, N_POLITE)):
                T, text = TEMPLATE[lang], clean(r["sentence"])
                add(f"ext-{lang.lower()}-{kind}-{i + 1:02d}", lang,
                    [("bot", T["bot"]), ("client", T["client"]), ("system", T["system"]), ("operator", text)],
                    {"demo_politeness": {"status": "applicable", "answers": answers}},
                    f"tydip_{kind}", f"TyDiP {lang} score={float(r['score']):.2f}", text)

    # 2. Грубость (textdetox): токсичная реплика оператора
    for lang in ("RU", "EN"):
        rows = pq.read_table(raw / "textdetox" / f"{lang.lower()}.parquet").to_pylist()
        tox = [r for r in rows if str(r["toxic"]) == "1" and 20 <= len(clean(r["text"])) <= 200]
        for i, r in enumerate(rnd.sample(tox, N_TOXIC)):
            T, text = TEMPLATE[lang], clean(r["text"])
            add(f"ext-{lang.lower()}-toxic-{i + 1:02d}", lang,
                [("bot", T["bot"]), ("client", T["client"]), ("system", T["system"]), ("operator", text)],
                {"demo_politeness": {"status": "applicable", "answers": ["1", "2"]}},
                "toxic_operator", f"textdetox {lang} toxic=1", text)

    # 3. Инъекции (deepset, label=1): в реплике клиента; оператор не здоровается и не помогает
    rows = []
    for split in ("train", "test"):
        rows += pq.read_table(raw / "deepset-injections" / f"{split}.parquet").to_pylist()
    inj = [r for r in rows if str(r["label"]) == "1" and 25 <= len(clean(r["text"])) <= 400]
    for i, r in enumerate(rnd.sample(inj, N_INJECT)):
        T, text = TEMPLATE["EN"], clean(r["text"])
        add(f"ext-en-injection-{i + 1:02d}", "EN",
            [("bot", T["bot"]), ("client", text), ("system", T["system"]), ("operator", T["op_plain"])],
            {"demo_greeting": {"status": "applicable", "answers": ["no"]},
             "demo_next_step": {"status": "applicable", "answers": ["no"]}},
            "injection", "deepset label=1", text)

    data = {"name": "external_v1", "checklist": "data/fixtures/checklist_demo.json",
            "note": "Реальные фразы из открытых наборов в шаблонных диалогах. Только для замера. "
                    "Ожидания по вежливости — полюса (1–3 / 3–5), а не точный балл.",
            "sources": SOURCES, "seed": SEED,
            "dataset": {"error": "", "isSuccess": True,
                        "data": {"dataset_group_id": "EXTERNAL", "total_records": len(records), "records": records}},
            "expected": expected, "meta": meta}
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out}: {len(records)} диалогов, {sum(len(v) for v in expected.values())} эталонов")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
