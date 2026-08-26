# Finance Control v4 — AI Import

Личный mobile-first трекер финансов и долгов. v4 добавляет массовый импорт банковского CSV и AI-категоризацию через **Supabase Edge Function → OpenAI API**.

## Что нового в v4

- массовый импорт CSV/TXT за несколько месяцев;
- автоопределение разделителя CSV (`;`, `,`, TAB, `|`);
- автоматическая попытка определить колонки Date / Description / Amount / Debit / Credit;
- поддержка европейского формата чисел `1.234,56` и `1234,56`;
- очистка IBAN, длинных номеров карт/ID и e-mail до отправки в AI;
- AI классифицирует расходы, доходы, переводы, возвраты и платежи по долгам;
- AI выбирает категорию и короткое имя merchant;
- confidence + флаг «нужно проверить»;
- экран review: можно изменить тип/категорию и исключить отдельные строки;
- массовое подтверждение импорта;
- защита от повторного импорта тех же операций через `externalId`;
- исторический импорт **не меняет текущий доступный баланс**: стартовый баланс автоматически корректируется на чистый поток импортированной истории;
- переводы между своими счетами не считаются доходом/расходом;
- возвраты уменьшают обычные расходы в месячной статистике;
- OpenAI API key никогда не попадает в GitHub Pages или localStorage.

## Архитектура

```text
GitHub Pages / iPhone
        |
        | date + signed amount + redacted description
        v
Supabase Edge Function
        |
        | OPENAI_API_KEY (Supabase secret)
        v
OpenAI Responses API
        |
        v
Structured JSON classification
        |
        v
Review -> localStorage Finance Control
```

Само приложение и финансовая база по-прежнему локальные. В сеть данные уходят только после нажатия **«Разобрать с AI»**.

---

# 1. Обнови GitHub Pages

Загрузи содержимое этой папки в корень своего GitHub репозитория, заменив старые файлы.

Важно загрузить новые файлы:

- `index.html`
- `styles.css`
- `ai-import.css`
- `app.js`
- `ai-import.js`
- `sw.js`
- `manifest.webmanifest`
- icons

Папку `supabase/` тоже можно оставить в репозитории — секретов внутри неё нет.

После обновления GitHub Pages полностью закрой установленное PWA на iPhone и открой снова. v4 использует новый Service Worker cache.

---

# 2. Создай Supabase Edge Function

Название функции должно быть:

```text
classify-transactions
```

Код уже готов:

```text
supabase/functions/classify-transactions/index.ts
```

Функция должна быть доступна без стандартной Supabase JWT-проверки, потому что личное приложение использует собственный заголовок `X-Finance-Access`.

В проекте уже есть:

```text
supabase/config.toml
```

с:

```toml
[functions.classify-transactions]
verify_jwt = false
```

## Через Supabase CLI

Из папки проекта:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy classify-transactions --no-verify-jwt
```

---

# 3. Добавь Secrets в Supabase

Нужны минимум два секрета.

### OPENAI_API_KEY

Твой OpenAI API key:

```text
OPENAI_API_KEY=sk-...
```

### FINANCE_ACCESS_TOKEN

Придумай длинный случайный пароль, например 32–64+ символа:

```text
FINANCE_ACCESS_TOKEN=your-long-random-private-token
```

Этот token нужен для того, чтобы посторонний человек не мог просто вызвать твою Edge Function и тратить твой OpenAI API budget.

Не записывай его в исходный код GitHub.

### Необязательно

Модель по умолчанию:

```text
OPENAI_MODEL=gpt-5.6-luna
```

Можно заменить через secret `OPENAI_MODEL`, не изменяя код функции.

Для ограничения CORS только своим GitHub Pages доменом можно добавить:

```text
ALLOWED_ORIGIN=https://YOUR_USERNAME.github.io
```

Если secret не задан, функция отвечает с `Access-Control-Allow-Origin: *`.

CLI-вариант:

```bash
npx supabase secrets set OPENAI_API_KEY=sk-...
npx supabase secrets set FINANCE_ACCESS_TOKEN=YOUR_LONG_TOKEN
npx supabase secrets set OPENAI_MODEL=gpt-5.6-luna
```

**Никогда не коммить `.env` с секретами в GitHub.**

---

# 4. Подключи Finance Control

После деплоя URL функции будет выглядеть примерно так:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/classify-transactions
```

В приложении:

1. `Настройки`
2. `AI Import → Supabase подключение`
3. вставь URL функции;
4. вставь тот же `FINANCE_ACCESS_TOKEN`;
5. `Сохранить`;
6. `Проверить соединение`.

**OpenAI API key в приложение вводить не нужно.**

URL и личный access token сохраняются только в localStorage на твоём устройстве и не включаются в JSON backup.

---

# 5. Массовый импорт

1. В банке экспортируй историю как CSV. Для проверки интерфейса в ZIP есть `sample-bank-statement.csv`.
2. Finance Control → `Операции` → `AI импорт`.
3. Выбери CSV.
4. Проверь распознанные колонки.
5. Если банк имеет одну signed-колонку, выбери `Сумма`.
6. Если банк даёт отдельные списания/зачисления — оставь `Сумма` пустой и выбери `Расход отдельно` + `Доход отдельно`.
7. Нажми `Подготовить операции`.
8. Нажми `Разобрать с AI`.
9. Проверь жёлтые строки с низкой уверенностью.
10. Нажми `Импортировать`.

AI работает пакетами, поэтому несколько сотен операций могут потребовать несколько запросов.

---

# Категории AI

- Зарплата
- Прочий доход
- Еда
- Рестораны
- Аренда/Жильё
- Коммунальные
- Транспорт
- Топливо
- Авто
- Покупки
- Развлечения
- Подписки
- Здоровье
- Спорт
- Путешествия
- Страхование
- Налоги/Сборы
- Переводы
- Возвраты
- Погашение долга
- Наличные
- Другое

## Важные правила

- `transfer` не считается доходом или расходом;
- `refund` возвращает деньги и уменьшает месячные обычные расходы;
- `debt_payment` считается отдельно от lifestyle-бюджета;
- AI может ошибаться, поэтому перед импортом всегда есть review screen;
- импорт не привязывает автоматически банковский платёж к конкретной карточке долга и не уменьшает её balance — для этого пока используется отдельная кнопка `Платёж` в разделе долгов.

---

# Приватность

Перед AI-анализом приложение и Edge Function дополнительно маскируют:

- IBAN-подобные строки;
- длинные номера карт/идентификаторов;
- e-mail адреса.

В OpenAI запросе используется `store: false`.

Не загружай в приложение CSV из ненадёжных источников и всегда просматривай preview перед импортом.

---

# Пока не реализовано

v4 импортирует **CSV/TXT**. XLSX и PDF специально не включены в первую AI-версию: CSV намного надёжнее для дат/сумм и позволяет не отправлять целый банковский документ в AI.

Следующие логичные функции:

- XLSX import;
- month-by-month analytics за 3/6/12 месяцев;
- recurring payments / subscriptions detection;
- локальные правила по merchant после твоих исправлений;
- AI financial assistant по уже импортированным данным;
- привязка debt-payment транзакций к конкретным долгам.

## v4.1 — Prepared Import без API

Добавлен второй путь массового импорта: **Finance Control Prepared Import JSON**. Он нужен для сценария, когда выписка была заранее разобрана ChatGPT или другим инструментом, а приложение должно только проверить и добавить уже готовые категории.

На странице **Операции → Импорт** теперь есть блок **Finance Control JSON**. Такой файл:

- обрабатывается полностью локально в браузере;
- не требует Supabase или OpenAI API;
- показывает экран проверки перед добавлением;
- поддерживает редактирование типа и категории;
- автоматически пропускает уже импортированные операции;
- сохраняет текущий доступный баланс при добавлении исторических операций.

### Формат файла

Корневой объект:

```json
{
  "format": "finance-control-prepared",
  "version": 1,
  "currency": "EUR",
  "transactions": []
}
```

Каждая транзакция:

```json
{
  "date": "2026-08-01",
  "amount": -63.74,
  "kind": "expense",
  "category": "Топливо",
  "merchant": "Shell",
  "description": "SHELL STATION",
  "confidence": 0.99,
  "needs_review": false,
  "external_id": "optional-stable-id"
}
```

`amount` — **знаковая сумма**: положительная для входящих денег и отрицательная для исходящих.

Допустимые `kind`: `income`, `expense`, `transfer`, `refund`, `debt_payment`.

Если `external_id` отсутствует, приложение создаст стабильный ID из даты, суммы и описания. В комплекте есть `prepared-import-template.json`, а шаблон также можно скачать прямо на экране импорта.
