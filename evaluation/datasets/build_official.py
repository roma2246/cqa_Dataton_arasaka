"""Тест-сет с известными ответами по ОФИЦИАЛЬНЫМ 8 критериям (contact, discovery, identification,
consultation, empathy, dialogue, closure, critical). Владелец: Участник 4.

Размечены только однозначные критерии; для шкал — допустимый диапазон соседних баллов.
Метки соответствуют формулировкам data/checklists/official_v1.json (трактовка команды).

Запуск:  .venv/bin/python evaluation/datasets/build_official.py
Выход:   data/testsets/official_synth_v1.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_synthetic import LANGS, P as BASE  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "testsets" / "official_synth_v1.json"

P = dict(BASE)
P.update({
    "op_more_help": ("operator", "Могу ещё чем-нибудь помочь?", "Тағы бір нәрсеге көмектесе аламын ба?",
                     "Is there anything else I can help you with?"),
    "client_no_more": ("client", "Нет, это всё, спасибо.", "Жоқ, болды, рақмет.", "No, that's all, thanks."),
    "client_withdraw_blocked": ("client", "Почему у меня заблокирован вывод денег со счёта?",
                                "Неге шотымнан ақша шығару бұғатталған?", "Why are withdrawals from my account blocked?"),
    "op_disclose": ("operator",
                    "Вижу, на вашем счёте ограничение на вывод: не загружено подтверждение адреса. Баланс — 1 250 долларов.",
                    "Көріп тұрмын, шотыңызда шығаруға шектеу бар: мекенжайды растайтын құжат жүктелмеген. Балансыңыз — 1 250 доллар.",
                    "I can see a withdrawal restriction on your account: proof of address hasn't been uploaded. Your balance is 1,250 dollars."),
    "op_verify_ask": ("operator",
                      "Чтобы посмотреть данные счёта, подтвердите, пожалуйста, личность: назовите номер счёта и кодовое слово.",
                      "Шот деректерін көру үшін жеке басыңызды растаңыз: шот нөмірі мен кодтық сөзді айтыңыз.",
                      "To look at your account details, please verify your identity: tell me your account number and code word."),
    "client_verify": ("client", "Счёт 4012-7781, кодовое слово — «Алатау».", "Шот 4012-7781, кодтық сөз — «Алатау».",
                      "Account 4012-7781, code word “Alatau”."),
    "op_verified_disclose": ("operator",
                             "Спасибо, личность подтверждена. На счёте ограничение на вывод: не загружено подтверждение адреса. Загрузите его в разделе Профиль → Документы, проверка займёт до 24 часов.",
                             "Рақмет, жеке басыңыз расталды. Шотта шығаруға шектеу бар: мекенжайды растайтын құжат жүктелмеген. Оны Профиль → Құжаттар бөліміне жүктеңіз, тексеру 24 сағатқа дейін созылады.",
                             "Thank you, your identity is verified. There is a withdrawal restriction: proof of address hasn't been uploaded. Upload it in Profile → Documents; the check takes up to 24 hours."),
    "sys_client_left": ("system", "Клиент покинул чат", "Клиент чаттан шықты", "The client left the chat"),
    "client_upset": ("client", "Приложение постоянно вылетает, я уже час не могу зайти, это ужасно!",
                     "Қосымша үнемі жабылып қалады, бір сағаттан бері кіре алмай жүрмін, бұл сұмдық!",
                     "The app keeps crashing, I haven't been able to log in for an hour, this is awful!"),
    "op_empathy": ("operator", "Понимаю, как это неприятно, сожалею о неудобствах. Давайте разберёмся.",
                   "Бұның қаншалықты жағымсыз екенін түсінемін, қолайсыздық үшін кешірім сұраймын. Бірге шешейік.",
                   "I understand how frustrating this is, and I'm sorry for the inconvenience. Let's sort it out."),
    "op_device": ("operator", "Подскажите, у вас iPhone или Android?", "Айтыңызшы, сізде iPhone ба, әлде Android па?",
                  "Could you tell me whether you have an iPhone or Android?"),
    "client_android": ("client", "Android.", "Android.", "Android."),
    "op_fix": ("operator", "Обновите, пожалуйста, приложение до последней версии в Google Play — в ней этот сбой исправлен.",
               "Қосымшаны Google Play-дағы соңғы нұсқаға жаңартыңыз — онда бұл ақау түзетілген.",
               "Please update the app to the latest version in Google Play — this crash is fixed there."),
    "client_works": ("client", "Обновил, теперь работает!", "Жаңарттым, енді жұмыс істейді!", "Updated it, it works now!"),
})

YES = {"status": "applicable", "answers": ["yes"]}
NO = {"status": "applicable", "answers": ["no"]}
NA = {"status": "not_applicable"}
GOOD_CONS = {"status": "applicable", "answers": ["15", "20"]}
BAD_CONS = {"status": "applicable", "answers": ["0", "5"]}
OPEN = ["bot_hello"]
TRANSFER = ["bot_transfer", "sys_transfer"]
CLOSE = ["client_thanks", "op_more_help", "client_no_more", "op_bye"]

SCENARIOS = {
    "good_full": {
        "what": "Приветствие с представлением, уточнение, решение, следующий шаг, предложение помощи и прощание",
        "turns": OPEN + ["client_q_report"] + TRANSFER + ["op_greet", "op_clarify", "client_app", "op_explain", "op_next_step"] + CLOSE,
        "expected": {"contact": YES, "discovery": YES, "identification": NA, "consultation": GOOD_CONS,
                     "empathy": YES, "closure": YES, "critical": NO,
                     "dialogue": {"status": "applicable", "answers": ["7", "10"]}}},
    "bot_only_hello": {
        "what": "Поздоровался только бот — контакт оператора «Нет»",
        "turns": OPEN + ["client_q_report"] + TRANSFER + ["op_clarify", "client_app", "op_explain", "op_next_step"] + CLOSE,
        "expected": {"contact": NO, "discovery": YES, "closure": YES, "critical": NO}},
    "id_disclosed": {
        "what": "Данные счёта раскрыты без идентификации — идентификация «Нет», грубая ошибка",
        "turns": OPEN + ["client_withdraw_blocked"] + TRANSFER + ["op_greet", "op_disclose"] + CLOSE,
        "expected": {"contact": YES, "identification": NO, "critical": YES, "closure": YES}},
    "id_verified": {
        "what": "Идентификация перед раскрытием данных счёта",
        "turns": OPEN + ["client_withdraw_blocked"] + TRANSFER + ["op_greet", "op_verify_ask", "client_verify",
                                                                  "op_verified_disclose"] + CLOSE,
        "expected": {"contact": YES, "identification": YES, "critical": NO, "consultation": GOOD_CONS, "closure": YES}},
    "general_na": {
        "what": "Общий вопрос о тарифе — идентификация N/A",
        "turns": OPEN + ["client_simple_q"] + TRANSFER + ["op_greet", "op_tariff", "client_found", "op_more_help",
                                                          "client_no_more", "op_bye"],
        "expected": {"contact": YES, "identification": NA, "consultation": GOOD_CONS, "closure": YES, "critical": NO,
                     "empathy": YES}},
    "rude": {
        "what": "Грубый оператор, вопрос не решён, разговор оборван",
        "turns": OPEN + ["client_q_report"] + TRANSFER + ["op_greet", "op_rude", "client_still", "op_end_unresolved"],
        "expected": {"contact": YES, "empathy": NO, "critical": YES, "consultation": BAD_CONS, "closure": NO,
                     "dialogue": {"status": "applicable", "answers": ["0", "4"]}}},
    "client_left": {
        "what": "Клиент ушёл после первого вопроса оператора — консультация и завершение N/A",
        "turns": OPEN + ["client_problem_vague"] + TRANSFER + ["op_greet", "op_clarify", "sys_client_left"],
        "expected": {"contact": YES, "consultation": NA, "closure": NA, "critical": NO}},
    "empathy": {
        "what": "Расстроенный клиент: оператор сочувствует, уточняет, решает",
        "turns": OPEN + ["client_upset"] + TRANSFER + ["op_greet", "op_empathy", "op_device", "client_android", "op_fix",
                                                       "client_works", "op_more_help", "client_no_more", "op_bye"],
        "expected": {"contact": YES, "discovery": YES, "identification": NA, "consultation": GOOD_CONS,
                     "empathy": YES, "closure": YES, "critical": NO}},
    "injection": {
        "what": "Инъекция в тексте клиента; оператор без приветствия, не помог, оборвал разговор",
        "turns": OPEN + ["client_injection"] + TRANSFER + ["op_end_unresolved", "client_still", "op_end_unresolved"],
        "expected": {"contact": NO, "consultation": BAD_CONS, "closure": NO}},
}


def build() -> dict:
    records, expected, meta = [], {}, {}
    for s_i, (name, sc) in enumerate(SCENARIOS.items(), 1):
        for lang, col in LANGS.items():
            cid = f"off-{lang.lower()}-{s_i:02d}-{name}"
            transcript = [{"timestamp": f"{(i * 27) // 60:02d}:{(i * 27) % 60:02d}", "speaker": P[k][0], "text": P[k][col]}
                          for i, k in enumerate(sc["turns"])]
            records.append({"conversation_id": cid, "channel": "agent chat", "language": lang,
                            "transcript": transcript, "audio_url": None})
            expected[cid] = sc["expected"]
            meta[cid] = {"scenario": name, "what": sc["what"], "language": lang}
    return {"name": "official_synth_v1", "checklist": "data/checklists/official_v1.json",
            "note": "Синтетика по официальным кодам критериев; метки — по трактовке команды (official_v1.json).",
            "dataset": {"error": "", "isSuccess": True,
                        "data": {"dataset_group_id": "OFFSYNTH", "total_records": len(records), "records": records}},
            "expected": expected, "meta": meta}


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(data['expected'])} диалогов, "
          f"{sum(len(v) for v in data['expected'].values())} эталонов")
