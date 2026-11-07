"""ОТЛОЖЕННЫЙ набор по официальному чек-листу: другие темы и формулировки, только для замера.
Владелец: Участник 4.

Запуск:  .venv/bin/python evaluation/datasets/build_official_holdout.py
Выход:   data/testsets/official_holdout_v1.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_synthetic import LANGS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "testsets" / "official_holdout_v1.json"

P = {
    "bot": ("bot", "Добрый день! Это помощник Freedom Broker. Напишите ваш вопрос.",
            "Қайырлы күн! Бұл Freedom Broker көмекшісі. Сұрағыңызды жазыңыз.",
            "Good afternoon! This is the Freedom Broker assistant. Please type your question."),
    "sys": ("system", "Оператор подключился", "Оператор қосылды", "An agent joined"),
    "sys_closed": ("system", "Чат закрыт оператором", "Чатты оператор жапты", "Chat closed by the agent"),
    "sys_left": ("system", "Клиент отключился", "Клиент ажыратылды", "The client disconnected"),
    "c_balance": ("client", "Подскажите, какой у меня сейчас баланс на брокерском счёте?",
                  "Брокерлік шотымда қазір қанша қаражат бар екенін айтып жібересіз бе?",
                  "Could you tell me my current balance on my brokerage account?"),
    "op_hi": ("operator", "Добрый день! Я Данияр из службы поддержки.", "Қайырлы күн! Мен қолдау қызметінен Данияр.",
              "Good afternoon! I'm Daniyar from customer support."),
    "op_balance": ("operator", "На вашем счёте 3 480 долларов и 12 акций Apple.", "Шотыңызда 3 480 доллар және Apple-дың 12 акциясы бар.",
                   "Your account holds 3,480 dollars and 12 Apple shares."),
    "op_sms": ("operator", "Для доступа к данным счёта я отправил вам SMS-код. Назовите его, пожалуйста.",
               "Шот деректеріне қол жеткізу үшін сізге SMS-код жібердім. Соны айтыңызшы.",
               "To access your account data I've sent you an SMS code. Please tell me the code."),
    "c_code": ("client", "Код 5521.", "Код 5521.", "The code is 5521."),
    "op_ok_balance": ("operator", "Спасибо, код верный. На вашем счёте 3 480 долларов и 12 акций Apple.",
                      "Рақмет, код дұрыс. Шотыңызда 3 480 доллар және Apple-дың 12 акциясы бар.",
                      "Thank you, the code is correct. Your account holds 3,480 dollars and 12 Apple shares."),
    "c_thx": ("client", "Благодарю!", "Көп рақмет!", "Much appreciated!"),
    "op_anything": ("operator", "Рад помочь. Остались ещё вопросы? Если нет — всего доброго!",
                    "Көмектескеніме қуаныштымын. Тағы сұрақтарыңыз бар ма? Болмаса — сау болыңыз!",
                    "Happy to help. Any other questions? If not — have a good day!"),
    "c_fee": ("client", "Сколько стоит вывод денег на карту?", "Картаға ақша шығару қанша тұрады?",
              "How much does a withdrawal to a card cost?"),
    "op_fee": ("operator", "Вывод на карту бесплатный, деньги приходят в течение одного рабочего дня.",
               "Картаға шығару тегін, ақша бір жұмыс күні ішінде түседі.",
               "Withdrawals to a card are free; the money arrives within one business day."),
    "c_advice": ("client", "Посоветуйте, во что вложить деньги?", "Ақшаны неге салған дұрыс, кеңес бересіз бе?",
                 "Can you advise me what to invest in?"),
    "op_private": ("operator", "Здесь не могу. Дайте ваш личный номер — проконсультирую частно, всего 50 долларов за час.",
                   "Мұнда болмайды. Жеке нөміріңізді беріңіз — жеке кеңес беремін, сағатына небәрі 50 доллар.",
                   "I can't here. Give me your personal number — I'll consult you privately, just 50 dollars an hour."),
    "c_slow": ("client", "Почему ордер на покупку не исполняется уже час? Это безобразие!",
               "Неге сатып алу ордері бір сағаттан бері орындалмай тұр? Бұл сұмдық!",
               "Why hasn't my buy order been executed for an hour? This is outrageous!"),
    "op_idiot": ("operator", "Потому что вы бестолковый и поставили цену ниже рынка.",
                 "Себебі сіз ақылсызсыз және бағаны нарықтан төмен қойдыңыз.",
                 "Because you're clueless and set the price below market."),
    "c_q_vague": ("client", "Здравствуйте, вопрос по приложению", "Сәлеметсіз бе, қосымша бойынша сұрақ бар",
                  "Hello, I have a question about the app"),
    "op_what": ("operator", "Добрый день! Я Данияр из поддержки. Опишите, пожалуйста, что случилось?",
                "Қайырлы күн! Мен қолдаудан Данияр. Не болғанын сипаттап беріңізші?",
                "Good afternoon! I'm Daniyar from support. Could you describe what happened?"),
}

YES = {"status": "applicable", "answers": ["yes"]}
NO = {"status": "applicable", "answers": ["no"]}
NA = {"status": "not_applicable"}
GOOD = {"status": "applicable", "answers": ["15", "20"]}

SCENARIOS = {
    "balance_no_id": {"what": "Баланс счёта назван без проверки личности",
                      "turns": ["bot", "c_balance", "sys", "op_hi", "op_balance", "c_thx", "op_anything"],
                      "expected": {"contact": YES, "identification": NO, "critical": YES, "closure": YES}},
    "balance_sms": {"what": "Проверка SMS-кодом, затем баланс",
                    "turns": ["bot", "c_balance", "sys", "op_hi", "op_sms", "c_code", "op_ok_balance", "c_thx", "op_anything"],
                    "expected": {"contact": YES, "identification": YES, "critical": NO, "consultation": GOOD, "closure": YES}},
    "fee_general": {"what": "Общий вопрос о комиссии — идентификация N/A",
                    "turns": ["bot", "c_fee", "sys", "op_hi", "op_fee", "c_thx", "op_anything"],
                    "expected": {"contact": YES, "identification": NA, "consultation": GOOD, "closure": YES, "critical": NO}},
    "private_paid": {"what": "Просит личный номер для платной частной консультации — грубая ошибка",
                     "turns": ["bot", "c_advice", "sys", "op_hi", "op_private"],
                     "expected": {"contact": YES, "critical": YES}},
    "insult": {"what": "Оскорбление клиента — грубая ошибка, эмпатия «Нет»",
               "turns": ["bot", "c_slow", "sys", "op_hi", "op_idiot", "sys_closed"],
               "expected": {"contact": YES, "empathy": NO, "critical": YES, "closure": NO}},
    "client_gone": {"what": "Клиент отключился до формулировки запроса — консультация и завершение N/A",
                    "turns": ["bot", "c_q_vague", "sys", "op_what", "sys_left"],
                    "expected": {"contact": YES, "consultation": NA, "closure": NA, "critical": NO}},
}


def build() -> dict:
    records, expected, meta = [], {}, {}
    for s_i, (name, sc) in enumerate(SCENARIOS.items(), 1):
        for lang, col in LANGS.items():
            cid = f"offh-{lang.lower()}-{s_i:02d}-{name}"
            records.append({"conversation_id": cid, "channel": "agent chat", "language": lang, "audio_url": None,
                            "transcript": [{"timestamp": f"{(i * 33) // 60:02d}:{(i * 33) % 60:02d}",
                                            "speaker": P[k][0], "text": P[k][col]} for i, k in enumerate(sc["turns"])]})
            expected[cid] = sc["expected"]
            meta[cid] = {"scenario": name, "what": sc["what"], "language": lang}
    return {"name": "official_holdout_v1", "checklist": "data/checklists/official_v3.json",
            "note": "ОТЛОЖЕННЫЙ набор по официальному чек-листу: не использовать для настройки.",
            "dataset": {"error": "", "isSuccess": True,
                        "data": {"dataset_group_id": "OFFHOLD", "total_records": len(records), "records": records}},
            "expected": expected, "meta": meta}


if __name__ == "__main__":
    d = build()
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(d['expected'])} диалогов, {sum(len(v) for v in d['expected'].values())} эталонов")
