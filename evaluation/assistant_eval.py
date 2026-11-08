"""Проверка ассистента поддержки: вопросы (в т.ч. многоходовые, с опечатками, на трёх языках) и что должно быть в ответе.

Запуск:  .venv/bin/python evaluation/assistant_eval.py
Ответ засчитывается, если handoff совпал с ожидаемым и (для ответа по существу) встретилась хотя бы одна ключевая фраза.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from cqa import assistant  # noqa: E402

C = lambda *t: [{"role": "client", "text": x} if i % 2 == 0 else {"role": "assistant", "text": x} for i, x in enumerate(t)]  # noqa: E731

CASES = [
    # (диалог, ожидается передача специалисту?, ключевые фразы — хотя бы одна)
    (C("где посмотрнть про тариф"), False, ["кабинет", "отчёт", "веб", "приложени"]),
    (C("где посмотреть тариф", "Вы смотрите в приложении или в веб-версии?", "я в вебе"), False, ["кабинет"]),
    (C("Где скачать отчёт брокера за прошлый год?"), False, ["отчёты и документы", "отчёт брокера"]),
    (C("как пополнить счёт через банк"), False, ["реквизит"]),
    (C("пишет обновите анкету, где это сделать"), False, ["изменение сведений", "персональные данные"]),
    (C("логин занят хотя старый счёт закрыт"), False, ["другой логин", "остаётся"]),
    (C("как убрать маржу в заявке"), False, ["маржу", "настройки приказа"]),
    (C("можно ли покупать акции с D-счёта"), False, ["торгов"]),
    (C("как найти облигации в приложении"), False, ["котировк"]),
    (C("на каком языке форма 1042-S"), False, ["англий"]),
    (C("где финансовая отчётность Freedom Holding"), False, ["investors", "financial information"]),
    (C("не могу войти на сайте, нет кнопки входа"), False, ["tradernet"]),
    (C("чем отличается насдак от нью-йоркской биржи"), False, ["разные", "nasdaq", "nyse"]),
    (C("Почему заблокирован вывод денег?"), True, []),
    (C("пополнил счёт вчера, деньги не пришли"), True, []),
    (C("позовите оператора"), True, []),
    (C("что купить чтобы заработать?"), False, ["не дае", "не могу", "рекомендац", "консультац"]),
    (C("Брокер есебін қайдан жүктеймін?"), False, ["отчёты и документы", "отчёт брокера"]),
    (C("Where can I see my plan? I'm on the website"), False, ["кабинет", "account area", "under your name"]),
    (C("How do I switch off Use Margin?"), False, ["order settings", "untick", "margin"]),
    (C("привет"), False, ["тариф", "отчёт", "помочь", "помог"]),
]


def main() -> int:
    ok = 0
    t0 = time.time()
    for msgs, want_handoff, keys in CASES:
        r = assistant.reply(msgs)
        text = r["reply"].lower()
        good = r["handoff"] == want_handoff and (want_handoff or any(k.lower() in text for k in keys))
        ok += good
        print(f"{'OK ' if good else 'XX '} [{r['language']}{' → спец.' if r['handoff'] else ''}] {msgs[-1]['text'][:50]}  ⇒  {r['reply'][:110]}")
    print(f"\nИТОГО {ok}/{len(CASES)} ({100 * ok / len(CASES):.0f}%), {time.time() - t0:.0f} с")
    return 0


if __name__ == "__main__":
    sys.exit(main())
