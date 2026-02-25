/**
 * ============================================
 * ГОЛОВНИЙ ФАЙЛ СЕРВЕРА - TestHub
 * ============================================
 * Точка входу в додаток
 */

// Завантажуємо змінні середовища з .env файлу
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Імпортуємо наші модулі
const { initDatabase, closeDatabase } = require('./database/connection');

// Створюємо Express додаток
const app = express();

// ============================================
// БЕЗПЕКА - Helmet.js
// ============================================
// Встановлює безпечні HTTP заголовки
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://api.anthropic.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// ============================================
// БЕЗПЕКА - Rate Limiting
// ============================================
// Загальний ліміт для всіх запитів
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 хвилин
    max: 500, // максимум 500 запитів з одного IP
    message: { error: 'Забагато запитів. Спробуйте пізніше.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Суворий ліміт для авторизації (захист від brute force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 хвилин
    max: 10, // максимум 10 спроб входу
    message: { error: 'Забагато спроб входу. Спробуйте через 15 хвилин.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // не рахуємо успішні входи
});

// Ліміт для завантаження файлів
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 година
    max: 50, // максимум 50 завантажень
    message: { error: 'Забагато завантажень. Спробуйте пізніше.' }
});

// Застосовуємо загальний ліміт
app.use(generalLimiter);

// ============================================
// MIDDLEWARE (проміжні обробники)
// ============================================

// Дозволяємо запити з інших доменів (для React)
app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
}));

// Парсимо JSON в тілі запитів
app.use(express.json());

// Парсимо URL-encoded дані (форми)
app.use(express.urlencoded({ extended: true }));

// Статичні файли (для завантажених PDF)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Логування запитів (простий варіант)
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Експортуємо лімітери для використання в роутах
app.set('authLimiter', authLimiter);
app.set('uploadLimiter', uploadLimiter);

// ============================================
// МАРШРУТИ API
// ============================================

// Перевірка що сервер працює
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'TestHub сервер працює!',
        timestamp: new Date().toISOString()
    });
});

// Підключаємо маршрути (після ініціалізації БД)
function setupRoutes() {
    const authRoutes = require('./routes/auth');
    const disciplinesRoutes = require('./routes/disciplines');
    const testsRoutes = require('./routes/tests');
    const submissionsRoutes = require('./routes/submissions');
    const reportsRoutes = require('./routes/reports');
    const batchRoutes = require('./routes/batch');
    const templatesRoutes = require('./routes/templates');

    app.use('/api/auth', authRoutes);
    app.use('/api/disciplines', disciplinesRoutes);
    app.use('/api/tests', testsRoutes);
    app.use('/api/submissions', submissionsRoutes);
    app.use('/api/reports', reportsRoutes);
    app.use('/api/batch', batchRoutes);
    app.use('/api/templates', templatesRoutes);
    
    // ============================================
    // СТАТИЧНІ ФАЙЛИ КЛІЄНТА (Production)
    // ============================================
    const clientDistPath = path.join(__dirname, '../client/dist');
    
    // Роздаємо статичні файли
    app.use(express.static(clientDistPath));
    
    // Всі інші запити (не API) → index.html (для React Router)
    app.get('*', (req, res, next) => {
        // Пропускаємо API запити
        if (req.path.startsWith('/api/')) {
            return next();
        }
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });
}

// ============================================
// ОБРОБКА ПОМИЛОК
// ============================================

function setupErrorHandlers() {
    // 404 - маршрут не знайдено
    app.use((req, res) => {
        res.status(404).json({ 
            error: 'Маршрут не знайдено',
            path: req.path 
        });
    });

    // Глобальний обробник помилок
    app.use((err, req, res, next) => {
        console.error('Помилка сервера:', err);
        
        res.status(err.status || 500).json({
            error: err.message || 'Внутрішня помилка сервера',
            // В продакшені не показуємо деталі помилки
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    });
}

// ============================================
// МІГРАЦІЇ БАЗИ ДАНИХ
// ============================================
async function runMigrations() {
    const { getDb, saveDatabase } = require('./database/connection');
    const db = getDb();
    
    console.log('🔄 Перевірка міграцій...');
    
    try {
        // Перевіряємо чи є test_id в таблиці
        let needsRecreate = false;
        try {
            const tableInfo = db.exec("PRAGMA table_info(resubmit_requests)");
            if (tableInfo.length > 0) {
                const columns = tableInfo[0].values.map(row => row[1]);
                if (!columns.includes('test_id')) {
                    needsRecreate = true;
                    console.log('⚠️ Таблиця resubmit_requests застаріла, перестворюю...');
                }
            }
        } catch (e) {
            // Таблиця не існує - це нормально
        }
        
        // Видаляємо стару таблицю якщо потрібно
        if (needsRecreate) {
            db.run('DROP TABLE IF EXISTS resubmit_requests');
        }
        
        // v23: Таблиця запитів на повторну здачу з test_id
        db.run(`
            CREATE TABLE IF NOT EXISTS resubmit_requests (
                id INTEGER PRIMARY KEY,
                submission_id INTEGER,
                student_id INTEGER NOT NULL,
                test_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                teacher_comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_submission ON resubmit_requests(submission_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_status ON resubmit_requests(status)');
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_test ON resubmit_requests(test_id)');
        
        // v27: Додаємо grading_method до tests
        try {
            const testsInfo = db.exec("PRAGMA table_info(tests)");
            if (testsInfo.length > 0) {
                const cols = testsInfo[0].values.map(row => row[1]);
                if (!cols.includes('grading_method')) {
                    db.run("ALTER TABLE tests ADD COLUMN grading_method TEXT DEFAULT 'ai'");
                    console.log('  + Додано tests.grading_method');
                }
            }
        } catch (e) {
            console.log('  ⚠️ grading_method:', e.message);
        }
        
        // v27: Таблиця математичних завдань з еталонними відповідями
        db.run(`
            CREATE TABLE IF NOT EXISTS math_tasks (
                id INTEGER PRIMARY KEY,
                test_id INTEGER NOT NULL,
                task_number INTEGER NOT NULL,
                description TEXT NOT NULL,
                reference_answer TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 10,
                config_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
                UNIQUE(test_id, task_number)
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_math_tasks_test ON math_tasks(test_id)');
        
        // v27: Таблиця результатів мат. перевірки
        db.run(`
            CREATE TABLE IF NOT EXISTS math_results (
                id INTEGER PRIMARY KEY,
                submission_id INTEGER NOT NULL,
                math_task_id INTEGER NOT NULL,
                student_answer TEXT,
                is_correct INTEGER DEFAULT 0,
                match_percentage REAL DEFAULT 0,
                points_earned INTEGER DEFAULT 0,
                details_json TEXT,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
                FOREIGN KEY (math_task_id) REFERENCES math_tasks(id) ON DELETE CASCADE,
                UNIQUE(submission_id, math_task_id)
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_math_results_submission ON math_results(submission_id)');

        // v28: Таблиця quiz-питань (парсяться з .md файлу)
        db.run(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id INTEGER PRIMARY KEY,
                test_id INTEGER NOT NULL,
                question_number TEXT NOT NULL,
                section_title TEXT,
                level_title TEXT,
                question_text TEXT NOT NULL,
                option_a TEXT,
                option_b TEXT,
                option_c TEXT,
                option_d TEXT,
                correct_answer TEXT,
                correct_explanation TEXT,
                points INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_quiz_questions_test ON quiz_questions(test_id)');

        // v28: Таблиця відповідей студентів на quiz
        db.run(`
            CREATE TABLE IF NOT EXISTS quiz_answers (
                id INTEGER PRIMARY KEY,
                submission_id INTEGER NOT NULL,
                quiz_question_id INTEGER NOT NULL,
                student_answer TEXT,
                is_correct INTEGER,
                points_earned INTEGER DEFAULT 0,
                ai_explanation TEXT,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
                FOREIGN KEY (quiz_question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
                UNIQUE(submission_id, quiz_question_id)
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_quiz_answers_submission ON quiz_answers(submission_id)');

        // v29: Додаємо quiz_question_count до tests (скільки питань показувати студенту)
        try {
            const testsInfo2 = db.exec("PRAGMA table_info(tests)");
            if (testsInfo2.length > 0) {
                const cols2 = testsInfo2[0].values.map(row => row[1]);
                if (!cols2.includes('quiz_question_count')) {
                    db.run("ALTER TABLE tests ADD COLUMN quiz_question_count INTEGER");
                    console.log('  + Додано tests.quiz_question_count');
                }
            }
        } catch (e) {
            console.log('  ⚠️ quiz_question_count:', e.message);
        }

        // v29: Таблиця персональних наборів quiz-питань для кожного студента
        db.run(`
            CREATE TABLE IF NOT EXISTS quiz_student_sets (
                id INTEGER PRIMARY KEY,
                test_id INTEGER NOT NULL,
                student_id INTEGER NOT NULL,
                question_ids_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(test_id, student_id)
            )
        `);
        db.run('CREATE INDEX IF NOT EXISTS idx_quiz_student_sets_test ON quiz_student_sets(test_id)');

        // v30: Додаємо student_explanation та explanation_score до quiz_answers
        try {
            const qaInfo = db.exec("PRAGMA table_info(quiz_answers)");
            if (qaInfo.length > 0) {
                const qaCols = qaInfo[0].values.map(row => row[1]);
                if (!qaCols.includes('student_explanation')) {
                    db.run("ALTER TABLE quiz_answers ADD COLUMN student_explanation TEXT");
                    console.log('  + Додано quiz_answers.student_explanation');
                }
                if (!qaCols.includes('explanation_score')) {
                    db.run("ALTER TABLE quiz_answers ADD COLUMN explanation_score INTEGER DEFAULT 0");
                    console.log('  + Додано quiz_answers.explanation_score');
                }
            }
        } catch (e) {
            console.log('  ⚠️ quiz_answers explanation columns:', e.message);
        }

        // v33: Додаємо роль admin до users
        try {
            const usersSchema = db.exec("SELECT sql FROM sqlite_master WHERE name='users'");
            if (usersSchema.length > 0) {
                const createSql = usersSchema[0].values[0][0];
                if (createSql && !createSql.includes("'admin'")) {
                    console.log('🔄 Міграція: додаю роль admin...');
                    db.run('PRAGMA foreign_keys = OFF');
                    db.run(`CREATE TABLE users_new (
                        id INTEGER PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL CHECK (role IN ('teacher', 'student', 'admin')),
                        student_group TEXT,
                        course INTEGER,
                        is_active INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`);
                    db.run('INSERT INTO users_new SELECT * FROM users');
                    db.run('DROP TABLE users');
                    db.run('ALTER TABLE users_new RENAME TO users');
                    db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
                    db.run('PRAGMA foreign_keys = ON');
                    console.log('  + Роль admin додано');
                }
            }
        } catch (e) {
            console.log('  ⚠️ admin migration:', e.message);
        }

        saveDatabase();
        console.log('✅ Міграції виконано');
    } catch (err) {
        console.log('⚠️ Міграції:', err.message);
    }
}

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Ініціалізуємо базу даних
        console.log('⏳ Ініціалізація бази даних...');
        await initDatabase();
        
        // Запускаємо міграції (створюємо нові таблиці якщо їх немає)
        await runMigrations();
        
        // Підключаємо маршрути
        setupRoutes();
        setupErrorHandlers();
        
        // Запускаємо сервер
        app.listen(PORT, () => {
            console.log('');
            console.log('╔════════════════════════════════════════════╗');
            console.log('║         🎓 TestHub Server Started          ║');
            console.log('╠════════════════════════════════════════════╣');
            console.log(`║  🌐 URL: http://localhost:${PORT}             ║`);
            console.log(`║  📊 API: http://localhost:${PORT}/api/health  ║`);
            console.log('║  🛑 Для зупинки: Ctrl+C                    ║');
            console.log('╚════════════════════════════════════════════╝');
            console.log('');
        });
        
    } catch (err) {
        console.error('❌ Не вдалося запустити сервер:', err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Зупинка сервера...');
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Зупинка сервера...');
    closeDatabase();
    process.exit(0);
});

// Запускаємо
startServer();
