// Синтетические демо-данные для режима mock. НЕ реальные транскрипты и НЕ официальный чек-лист.
import type { ChecklistVersion, Conversation, Criterion, CriterionResult, Message, Speaker } from '../types';

type Row = [string, Speaker, string];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** ISO-метка звонка: base + секунды, с исходным часовым поясом. */
function iso(base: string, plusSec: number) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(.*)$/.exec(base)!;
  const t = +m[2] * 3600 + +m[3] * 60 + +m[4] + plusSec;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${m[1]}T${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}${m[5]}`;
}

function conv(conversation_id: string, channel: string, language: string, rows: Row[], audio_url: string | null = null, group_id = 'DEV'): Conversation {
  const messages: Message[] = rows.map(([timestamp, speaker, text], index) => ({
    message_id: `m${String(index + 1).padStart(3, '0')}`,
    index,
    timestamp,
    speaker,
    text,
  }));
  return { conversation_id, group_id, channel, language, audio_url, content_hash: hash(JSON.stringify(messages)), messages };
}

const CALL_A = '2026-11-03T10:14:05+05:00';
const CALL_B = '2026-11-04T16:02:41+05:00';

export const CONVERSATIONS: Conversation[] = [
  conv('p1-ru-001', 'agent chat', 'RU', [
    ['00:02', 'bot', 'Здравствуйте! Чем могу помочь?'],
    ['00:38', 'system', 'Transfer to operator'],
    ['01:15', 'operator', 'Добрый день. Я подключился.'],
    ['01:20', 'client', 'У меня проблема со счетом.'],
    ['01:42', 'operator', 'Подскажите, пожалуйста, что именно произошло со счетом?'],
    ['02:05', 'client', 'Вчера списали 4 500 ₸ за обслуживание, хотя у меня бесплатный тариф.'],
    ['02:31', 'operator', 'Понимаю, ситуация неприятная. Сейчас проверю операции по вашему счету.'],
    ['03:10', 'operator', 'Вижу списание. Тариф автоматически изменился после окончания акционного периода 1 ноября.'],
    ['03:28', 'client', 'Меня никто об этом не предупредил.'],
    ['03:52', 'operator', 'Уведомление отправлялось в приложение, но я оформлю заявку на возврат комиссии в качестве исключения. Срок рассмотрения — до 3 рабочих дней.'],
    ['04:10', 'client', 'Хорошо, спасибо.'],
    ['04:18', 'operator', 'Могу ли я еще чем-то помочь? Хорошего дня!'],
    ['04:30', 'system', 'Conversation closed by operator'],
  ]),
  conv('p1-ru-002', 'agent chat', 'RU', [
    ['00:01', 'bot', 'Здравствуйте! Я виртуальный помощник. Опишите, пожалуйста, ваш вопрос.'],
    ['00:15', 'client', 'Потерял карту, нужно срочно заблокировать.'],
    ['00:22', 'bot', 'Для блокировки карты нужен специалист. Соединяю с оператором…'],
    ['00:24', 'system', 'Transfer to operator'],
    ['01:48', 'operator', 'Здравствуйте, меня зовут Алина. Назовите, пожалуйста, ФИО и кодовое слово.'],
    ['02:10', 'client', 'Иванов Сергей Петрович, кодовое слово — «север».'],
    ['02:34', 'operator', 'Спасибо, данные подтверждены. Карта, оканчивающаяся на 4417, заблокирована.'],
    ['02:41', 'client', 'А новую когда сделают?'],
    ['03:05', 'operator', 'Перевыпуск займет 5 рабочих дней, доставка бесплатная.'],
    ['03:20', 'system', 'Conversation closed by operator'],
  ]),
  conv(
    'p1-ru-c01',
    'voice call',
    'RU',
    [
      [iso(CALL_A, 0), 'system', 'Inbound call connected'],
      [iso(CALL_A, 3), 'operator', 'Добрый день, меня зовут Дмитрий. Чем могу помочь?'],
      [iso(CALL_A, 11), 'client', 'Не могу войти в приложение, пишет «ошибка авторизации».'],
      [iso(CALL_A, 20), 'operator', 'Назовите, пожалуйста, номер телефона, привязанный к аккаунту.'],
      [iso(CALL_A, 31), 'client', '+7 701 *** ** 12.'],
      [iso(CALL_A, 45), 'operator', 'Спасибо. Какая версия приложения у вас установлена?'],
      [iso(CALL_A, 62), 'client', 'Не знаю… Последний раз обновлял месяц назад.'],
      [iso(CALL_A, 80), 'operator', 'Пожалуйста, обновите приложение и попробуйте снова — в версии 5.2 мы исправили эту ошибку.'],
      [iso(CALL_A, 160), 'client', 'Обновил — заработало!'],
      [iso(CALL_A, 168), 'operator', 'Отлично! Спасибо за звонок, всего доброго.'],
    ],
    'https://example.com/demo-player/p1-ru-c01',
  ),
  conv('p1-en-004', 'agent chat', 'EN', [
    ['00:01', 'bot', "Hi! I'm the virtual assistant. How can I help you today?"],
    ['00:09', 'client', 'I was charged twice for my subscription.'],
    ['00:14', 'bot', "Sorry to hear that. I'll connect you with a billing specialist."],
    ['00:16', 'system', 'Transfer to operator'],
    ['02:42', 'operator', "Hi there, thanks for waiting. I'm Mark from Billing."],
    ['02:55', 'client', 'That took a while. I see two charges of $14.99 on Nov 3.'],
    ['03:20', 'operator', 'Apologies for the wait. I can confirm a duplicate charge — the second one was a processing error.'],
    ['03:41', 'operator', "I've issued a refund of $14.99. It should appear within 5–7 business days."],
    ['03:58', 'client', 'Ok. Will this happen again?'],
    ['04:30', 'operator', 'The issue was on our side and has been fixed. Is there anything else I can help with?'],
    ['04:41', 'client', "No, that's all."],
    ['04:45', 'operator', 'Have a great day!'],
  ]),
  conv('p1-ru-005', 'agent chat', 'RU', [
    ['00:00', 'bot', 'Здравствуйте! Чем могу помочь?'],
    ['00:06', 'client', 'Какой у вас лимит на переводы без комиссии?'],
    ['00:08', 'bot', 'Без комиссии можно переводить до 1 000 000 ₸ в месяц на карты других банков.'],
    ['00:21', 'client', 'А на карты вашего банка?'],
    ['00:23', 'bot', 'Переводы внутри банка бесплатны без ограничений по сумме.'],
    ['00:40', 'client', 'Понял, спасибо.'],
    ['00:41', 'bot', 'Рад был помочь! Хорошего дня.'],
    ['00:50', 'system', 'Conversation closed automatically'],
  ]),
  conv(
    'p1-en-c02',
    'voice call',
    'EN',
    [
      [iso(CALL_B, 0), 'system', 'Inbound call connected'],
      [iso(CALL_B, 4), 'operator', 'Support, go ahead.'],
      [iso(CALL_B, 9), 'client', 'Hi, my transfer to my landlord has been pending for three days.'],
      [iso(CALL_B, 18), 'operator', 'Transfers can take time.'],
      [iso(CALL_B, 30), 'client', 'Three days? The rent is due tomorrow. Can you check it?'],
      [iso(CALL_B, 52), 'operator', "What's your account number?"],
      [iso(CALL_B, 65), 'client', 'It ends in 2290.'],
      [iso(CALL_B, 100), 'operator', "It's under compliance review. I can't speed it up."],
      [iso(CALL_B, 115), 'client', 'Is there anything I can do?'],
      [iso(CALL_B, 140), 'operator', 'You can wait or cancel it.'],
      [iso(CALL_B, 146), 'system', 'Call ended by client'],
    ],
    'https://example.com/demo-player/p1-en-c02',
  ),
  conv('p1-kz-007', 'agent chat', 'KZ', [
    ['00:01', 'bot', 'Сәлеметсіз бе! Сізге қалай көмектесе аламын?'],
    ['00:12', 'client', 'Картамнан ақша екі рет алынып кетті.'],
    ['00:16', 'system', 'Transfer to operator'],
    ['01:05', 'operator', 'Сәлеметсіз бе! Менің атым Айгерім. Аты-жөніңізді және кодтық сөзді айтыңызшы.'],
    ['01:30', 'client', 'Сейтқали Ерлан, кодтық сөз — «таң».'],
    ['02:02', 'operator', 'Рахмет, тексердім. Иә, бір төлем қате қайталанған. Қаражат 3 жұмыс күні ішінде қайтарылады.'],
    ['02:20', 'client', 'Жақсы, рахмет.'],
    ['02:26', 'operator', 'Басқа сұрақтарыңыз бар ма? Күніңіз сәтті өтсін!'],
  ]),
];

// ---------- Чек-лист (ДЕМО, не официальный) ----------

const YES_NO = [
  { value: 'yes', label: 'Да', score: 1 },
  { value: 'no', label: 'Нет', score: 0 },
];
const YES_PARTIAL_NO = [
  { value: 'yes', label: 'Да', score: 1 },
  { value: 'partial', label: 'Частично', score: 0.5 },
  { value: 'no', label: 'Нет', score: 0 },
];
const SCALE_1_5 = { min: 1, max: 5, step: 1, map: null };

const base = (c: Partial<Criterion> & Pick<Criterion, 'criterion_id' | 'title' | 'instruction' | 'weight' | 'answer_type'>): Criterion => ({
  section_id: null,
  options: [],
  scale: null,
  na_allowed: false,
  na_rule: null,
  is_critical: false,
  critical_values: [],
  required_evidence: 'text',
  ...c,
});

const CRITERIA: Record<string, Criterion> = {
  greeting: base({ criterion_id: 'greeting', title: 'Приветствие', section_id: 'opening', weight: 10, answer_type: 'yes_no', options: YES_NO, instruction: 'Оператор здоровается и представляется в первой реплике после подключения. Приветствие бота оператору не засчитывается.' }),
  identification: base({ criterion_id: 'identification', title: 'Идентификация клиента', section_id: 'opening', weight: 20, answer_type: 'yes_no', options: YES_NO, na_allowed: true, na_rule: 'Клиент уже идентифицирован ботом/приложением или запрос не затрагивает данные счёта.', is_critical: true, critical_values: ['no'], instruction: 'Перед раскрытием или изменением данных счёта оператор проверяет ФИО и кодовое слово (или второй фактор).' }),
  discovery: base({ criterion_id: 'discovery', title: 'Выяснение потребности', section_id: 'solving', weight: 20, answer_type: 'single_choice', options: YES_PARTIAL_NO, instruction: 'Оператор задаёт уточняющие вопросы и подтверждает суть проблемы до того, как предлагает решение.' }),
  solution: base({ criterion_id: 'solution', title: 'Корректность решения', section_id: 'solving', weight: 30, answer_type: 'scale', scale: SCALE_1_5, instruction: 'Решение верное и полное, со сроками там, где они применимы. 5 — полностью, 1 — неверно или не дано.' }),
  politeness: base({ criterion_id: 'politeness', title: 'Вежливость и эмпатия', section_id: 'closing', weight: 10, answer_type: 'scale', scale: SCALE_1_5, na_allowed: true, na_rule: 'Оператор не участвовал в разговоре.', instruction: 'Оператор признаёт эмоции клиента, избегает оправданий и резких формулировок.' }),
  closing: base({ criterion_id: 'closing', title: 'Завершение', section_id: 'closing', weight: 10, answer_type: 'yes_no', options: YES_NO, instruction: 'Оператор предлагает дополнительную помощь и вежливо прощается.' }),
};

const SECTIONS = [
  { section_id: 'opening', title: 'Начало разговора', weight: 30 },
  { section_id: 'solving', title: 'Решение вопроса', weight: 50 },
  { section_id: 'closing', title: 'Завершение', weight: 20 },
];

const rules = { rounding_digits: 2, critical_policy: 'flag_only' as const, aggregation: 'flat' as const };

export const CHECKLISTS: ChecklistVersion[] = [
  {
    version_id: 1,
    version: 1,
    created_at: '2026-11-07T07:20:00Z',
    checklist_id: 'main',
    name: 'Демо-чек-лист',
    is_official: false,
    rules,
    sections: SECTIONS,
    criteria: [
      { ...CRITERIA.greeting },
      { ...CRITERIA.identification },
      { ...CRITERIA.discovery, weight: 25 },
      { ...CRITERIA.solution, weight: 35 },
      { ...CRITERIA.closing },
    ],
  },
  {
    version_id: 2,
    version: 2,
    created_at: '2026-11-07T09:05:00Z',
    checklist_id: 'main',
    name: 'Демо-чек-лист',
    is_official: false,
    rules,
    sections: SECTIONS,
    criteria: Object.values(CRITERIA),
  },
];

// ---------- Подготовленные ответы «модели» (по criterion_id) ----------

type R = Omit<CriterionResult, 'criterion_id'>;
const yes = (explanation: string, ev: string[]): R => ({ status: 'applicable', answer: 'yes', explanation, evidence_message_ids: ev, checked_range: null, na_reason: null, review_reason: null });
const ans = (answer: string, explanation: string, ev: string[], range?: [string, string]): R => ({ status: 'applicable', answer, explanation, evidence_message_ids: ev, checked_range: range ? { from_message_id: range[0], to_message_id: range[1] } : null, na_reason: null, review_reason: null });
const na = (reason: string): R => ({ status: 'not_applicable', answer: null, explanation: reason, evidence_message_ids: [], checked_range: null, na_reason: reason, review_reason: null });
const review = (reason: string, range: [string, string]): R => ({ status: 'needs_review', answer: null, explanation: reason, evidence_message_ids: [], checked_range: { from_message_id: range[0], to_message_id: range[1] }, na_reason: null, review_reason: reason });

export const PREPARED: Record<string, Record<string, R>> = {
  'p1-ru-001': {
    greeting: yes('Оператор поздоровался сразу после подключения («Добрый день»). Приветствие бота в m001 не учитывалось.', ['m003']),
    identification: na('Клиент идентифицирован ботом до перевода на оператора.'),
    discovery: yes('Задан открытый уточняющий вопрос, оператор подтвердил спорное списание до решения.', ['m005', 'm008']),
    solution: ans('4', 'Верно найдена причина (окончание акции) и оформлен возврат со сроком. Не предложены варианты тарифа на будущее.', ['m008', 'm010']),
    politeness: ans('3', 'Неудобство признано, но ответ на жалобу о неполученном уведомлении звучит как оправдание.', ['m007', 'm010']),
    closing: yes('Предложена дополнительная помощь и вежливое прощание.', ['m012']),
  },
  'p1-ru-002': {
    greeting: yes('Оператор поздоровался и представился по имени.', ['m005']),
    identification: yes('ФИО и кодовое слово проверены до блокировки карты.', ['m005', 'm006', 'm007']),
    discovery: ans('partial', 'Потребность ясна из перевода от бота; оператор не уточнил, были ли подозрительные операции после утери.', ['m002', 'm007']),
    solution: ans('5', 'Карта заблокирована сразу; назван срок перевыпуска и условия доставки.', ['m007', 'm009']),
    politeness: ans('3', 'Корректно, но сухо — без поддержки при срочном обращении клиента.', ['m007', 'm009']),
    closing: ans('no', 'В проверенном участке нет предложения помощи и прощания — разговор закрыт системой.', [], ['m007', 'm010']),
  },
  'p1-ru-c01': {
    greeting: yes('Приветствие и имя оператора в первой реплике.', ['m002']),
    identification: ans('no', 'Запрошен только номер телефона; второй фактор не проверен.', ['m004', 'm005']),
    discovery: yes('Оператор выяснил версию приложения, чтобы сузить причину.', ['m003', 'm006', 'm007']),
    solution: ans('5', 'Верное решение (обновление до 5.2); клиент подтвердил, что проблема решена.', ['m008', 'm009']),
    politeness: ans('4', 'Спокойно и вежливо; раздражение клиента явно не признано.', ['m008']),
    closing: yes('Поблагодарил и попрощался после подтверждения решения.', ['m010']),
  },
  'p1-en-004': {
    greeting: yes('Поздоровался и представился; ожидание признал только после реплики клиента.', ['m005', 'm007']),
    identification: na('Клиент аутентифицирован в сессии приложения до начала чата.'),
    discovery: yes('Подтвердил дубль списания по журналу операций.', ['m006', 'm007']),
    solution: ans('5', 'Возврат оформлен, срок назван, причина объяснена.', ['m007', 'm008', 'm010']),
    politeness: ans('5', 'Извинился за ожидание и признал ошибку компании.', ['m007']),
    closing: yes('Предложил помощь и тепло попрощался.', ['m010', 'm012']),
  },
  'p1-ru-005': {
    greeting: review('Оператор не участвовал; критерий не допускает N/A — нужно решение проверяющего.', ['m001', 'm008']),
    identification: na('Справочный запрос — данные счёта не затрагивались.'),
    discovery: review('Диалог провёл только бот; действий оператора нет.', ['m001', 'm008']),
    solution: review('Диалог провёл только бот; действий оператора нет.', ['m001', 'm008']),
    politeness: na('Оператор не участвовал в разговоре.'),
    closing: review('Диалог провёл только бот; действий оператора нет.', ['m001', 'm008']),
  },
  'p1-en-c02': {
    greeting: ans('no', 'Нет приветствия и представления — разговор начат с «Support, go ahead.»', ['m002']),
    identification: ans('no', 'Запрошены только последние цифры счёта; личность не подтверждена до раскрытия статуса перевода.', ['m006', 'm007', 'm008']),
    discovery: ans('partial', 'Проблему отмёл до проверки; статус проверил только после настойчивости клиента.', ['m004', 'm005']),
    solution: ans('2', 'Статус верный (комплаенс-проверка), но ни сроков, ни пути эскалации.', ['m008', 'm010']),
    politeness: ans('1', 'Пренебрежительный тон; срок оплаты аренды не признан.', ['m004', 'm008', 'm010']),
    closing: ans('no', 'Клиент сам завершил звонок; прощания и предложения помощи нет.', [], ['m009', 'm011']),
  },
  'p1-kz-007': {
    greeting: yes('Оператор поздоровался и представился (Айгерім).', ['m004']),
    identification: yes('Проверены ФИО и кодовое слово до раскрытия данных.', ['m004', 'm005', 'm006']),
    discovery: yes('Подтвердил дубль платежа после проверки.', ['m002', 'm006']),
    solution: ans('4', 'Названы причина и срок возврата; не уточнено, куда поступят средства.', ['m006']),
    politeness: ans('4', 'Вежливо и доброжелательно.', ['m006', 'm008']),
    closing: yes('Предложил помощь и попрощался.', ['m008']),
  },
};
