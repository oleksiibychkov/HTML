# 🎓 TestHub - Система автоматизованого тестування

Платформа для перевірки лабораторних, контрольних та іспитів з використанням Claude AI.

## 📋 Можливості

### Для викладачів:
- ✅ Створення дисциплін та тестів
- ✅ Налаштування критеріїв оцінювання
- ✅ Встановлення термінів здачі
- ✅ Автоматична перевірка через Claude AI
- ✅ Формування звітів (PDF, CSV)

### Для студентів:
- ✅ Перегляд доступних тестів
- ✅ Завантаження PDF з роботою
- ✅ Перегляд оцінок та відгуків AI

## 🚀 Швидкий старт

### 1. Встановлення залежностей

```bash
npm install
```

### 2. Налаштування

Скопіюйте файл конфігурації:
```bash
cp .env.example .env
```

Відкрийте `.env` та заповніть:
```env
# Обов'язково - ключ Claude API
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Опціонально
PORT=3000
SESSION_SECRET=your-random-secret-key
```

### 3. Ініціалізація бази даних

```bash
npm run init-db
```

Це створить базу даних та демо-користувачів.

### 4. Запуск сервера

**Для розробки** (з автоперезавантаженням):
```bash
npm run dev
```

**Для продакшену**:
```bash
npm start
```

Сервер буде доступний на `http://localhost:3000`

## 🔑 Демо-доступ

| Роль | Email | Пароль |
|------|-------|--------|
| Викладач | teacher@test.com | teacher123 |
| Студент | student@test.com | student123 |

## 📁 Структура проекту

```
testing-platform/
├── database/
│   ├── schema.sql      # Схема бази даних
│   └── testhub.db      # Файл бази (створюється автоматично)
├── src/
│   ├── server.js       # Головний файл сервера
│   ├── database/
│   │   ├── connection.js  # Підключення до SQLite
│   │   └── init.js        # Ініціалізація БД
│   ├── middleware/
│   │   └── auth.js     # Авторизація
│   └── routes/
│       ├── auth.js         # /api/auth/*
│       ├── disciplines.js  # /api/disciplines/*
│       ├── tests.js        # /api/tests/*
│       ├── submissions.js  # /api/submissions/*
│       └── reports.js      # /api/reports/*
├── uploads/            # Завантажені PDF (створюється автоматично)
├── .env.example        # Приклад конфігурації
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Авторизація
| Метод | URL | Опис |
|-------|-----|------|
| POST | /api/auth/register | Реєстрація |
| POST | /api/auth/login | Вхід |
| POST | /api/auth/logout | Вихід |
| GET | /api/auth/me | Поточний користувач |

### Дисципліни
| Метод | URL | Опис |
|-------|-----|------|
| GET | /api/disciplines | Список дисциплін |
| POST | /api/disciplines | Створити дисципліну |
| GET | /api/disciplines/:id | Деталі дисципліни |
| PUT | /api/disciplines/:id | Оновити |
| DELETE | /api/disciplines/:id | Видалити |

### Тести
| Метод | URL | Опис |
|-------|-----|------|
| POST | /api/tests | Створити тест |
| GET | /api/tests/:id | Деталі тесту |
| PUT | /api/tests/:id | Оновити |
| DELETE | /api/tests/:id | Видалити |

### Здача робіт
| Метод | URL | Опис |
|-------|-----|------|
| POST | /api/submissions | Здати роботу (PDF) |
| GET | /api/submissions | Список робіт |
| GET | /api/submissions/:id | Деталі роботи |
| POST | /api/submissions/:id/grade | Оцінити через AI |

### Звіти
| Метод | URL | Опис |
|-------|-----|------|
| GET | /api/reports/discipline/:id | Звіт по дисципліні |
| GET | /api/reports/test/:id | Звіт по тесту |
| GET | /api/reports/student/:id | Звіт по студенту |
| GET | /api/reports/export/test/:id | Експорт в CSV |

## 🔒 Авторизація API

Всі запити (крім login/register) потребують токен:

```
Authorization: Bearer <token>
```

Токен отримуєте після успішного логіну.

## 📝 Приклади запитів

### Логін
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher@test.com","password":"teacher123"}'
```

### Створення дисципліни
```bash
curl -X POST http://localhost:3000/api/disciplines \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"Програмування на Python","description":"Основи Python"}'
```

### Здача роботи
```bash
curl -X POST http://localhost:3000/api/submissions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "test_id=1" \
  -F "file=@my_work.pdf"
```

## ⚙️ Налаштування для продакшену

1. Змініть `SESSION_SECRET` на випадковий довгий рядок
2. Налаштуйте HTTPS (nginx/Let's Encrypt)
3. Використовуйте PM2 для процес-менеджменту:
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name testhub
   ```

## 🐛 Вирішення проблем

**Помилка "better-sqlite3"**
```bash
npm rebuild better-sqlite3
```

**Помилка "ANTHROPIC_API_KEY"**
Перевірте що ключ правильно вказаний в `.env`

**PDF не парситься**
Перевірте що PDF містить текст (не сканований образ)

## 📄 Ліцензія

MIT
