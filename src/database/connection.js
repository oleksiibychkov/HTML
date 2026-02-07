/**
 * ============================================
 * ПІДКЛЮЧЕННЯ ДО БАЗИ ДАНИХ (sql.js)
 * ============================================
 * sql.js - SQLite скомпільований в WebAssembly
 * Працює без нативних модулів на будь-якій версії Node.js
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Шлях до файлу бази даних
const dbPath = process.env.DATABASE_PATH || './database/testhub.db';
const fullPath = path.resolve(__dirname, '../../', dbPath);

// Глобальна змінна для бази
let db = null;
let SQL = null;

/**
 * Ініціалізація бази даних
 * Викликається один раз при старті сервера
 */
async function initDatabase() {
    if (db) return db;
    
    // Ініціалізуємо sql.js
    SQL = await initSqlJs();
    
    // Переконуємось, що папка існує
    const dbDir = path.dirname(fullPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`📁 Створено папку для бази даних: ${dbDir}`);
    }
    
    // Завантажуємо існуючу базу або створюємо нову
    if (fs.existsSync(fullPath)) {
        const fileBuffer = fs.readFileSync(fullPath);
        db = new SQL.Database(fileBuffer);
        console.log(`✅ Завантажено базу даних: ${fullPath}`);
    } else {
        db = new SQL.Database();
        console.log(`✅ Створено нову базу даних: ${fullPath}`);
    }
    
    // Вмикаємо foreign keys
    db.run('PRAGMA foreign_keys = ON');
    
    // ============================================
    // АВТОМАТИЧНІ МІГРАЦІЇ (виконуються при кожному старті)
    // ============================================
    console.log('🔄 Перевірка структури бази даних...');
    
    try {
        // Таблиця користувачів
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
                student_group TEXT,
                course INTEGER,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблиця дисциплін
        db.run(`
            CREATE TABLE IF NOT EXISTS disciplines (
                id INTEGER PRIMARY KEY,
                teacher_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Таблиця тестів
        db.run(`
            CREATE TABLE IF NOT EXISTS tests (
                id INTEGER PRIMARY KEY,
                discipline_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('lab', 'control', 'exam')),
                title TEXT NOT NULL,
                description TEXT,
                task_file TEXT,
                criteria_file TEXT,
                criteria_json TEXT,
                start_time DATETIME NOT NULL,
                end_time DATETIME NOT NULL,
                max_points INTEGER DEFAULT 100,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (discipline_id) REFERENCES disciplines(id) ON DELETE CASCADE
            )
        `);
        
        // Таблиця критеріїв
        db.run(`
            CREATE TABLE IF NOT EXISTS criteria (
                id INTEGER PRIMARY KEY,
                test_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                max_points INTEGER NOT NULL,
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
            )
        `);
        
        // Таблиця здач
        db.run(`
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY,
                student_id INTEGER NOT NULL,
                test_id INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                extracted_text TEXT,
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                total_grade INTEGER,
                ai_feedback TEXT,
                ai_grades_json TEXT,
                ai_info_json TEXT,
                graded_at DATETIME,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
                UNIQUE(student_id, test_id)
            )
        `);
        
        // Таблиця оцінок по критеріях
        db.run(`
            CREATE TABLE IF NOT EXISTS submission_grades (
                id INTEGER PRIMARY KEY,
                submission_id INTEGER NOT NULL,
                criterion_id INTEGER NOT NULL,
                points INTEGER NOT NULL,
                comment TEXT,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
                FOREIGN KEY (criterion_id) REFERENCES criteria(id) ON DELETE CASCADE,
                UNIQUE(submission_id, criterion_id)
            )
        `);
        
        // Таблиця сесій
        db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Таблиця batch результатів
        db.run(`
            CREATE TABLE IF NOT EXISTS batch_results (
                id INTEGER PRIMARY KEY,
                teacher_id INTEGER NOT NULL,
                discipline_name TEXT,
                test_name TEXT,
                result_file TEXT NOT NULL,
                template_file TEXT,
                works_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Таблиця запитів на повторну здачу (v19)
        db.run(`
            CREATE TABLE IF NOT EXISTS resubmit_requests (
                id INTEGER PRIMARY KEY,
                submission_id INTEGER NOT NULL,
                student_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                teacher_comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Індекси для швидкого пошуку
        db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        db.run('CREATE INDEX IF NOT EXISTS idx_disciplines_teacher ON disciplines(teacher_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_tests_discipline ON tests(discipline_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_criteria_test ON criteria(test_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_submissions_test ON submissions(test_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
        db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_batch_results_teacher ON batch_results(teacher_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_submission ON resubmit_requests(submission_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_student ON resubmit_requests(student_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_resubmit_requests_status ON resubmit_requests(status)');
        
        saveDatabase();
        console.log('✅ Структура бази даних готова');
        
        // Перевіряємо чи є користувачі, якщо ні - створюємо демо
        const userCount = db.exec('SELECT COUNT(*) FROM users');
        const count = userCount[0]?.values[0]?.[0] || 0;
        
        if (count === 0) {
            console.log('📝 Створюю демо-користувачів...');
            const bcrypt = require('bcryptjs');
            
            // Викладач
            const teacherHash = bcrypt.hashSync('teacher123', 10);
            db.run(`
                INSERT INTO users (email, password_hash, name, role)
                VALUES ('teacher@test.com', '${teacherHash}', 'Іван Петренко', 'teacher')
            `);
            
            // Студент
            const studentHash = bcrypt.hashSync('student123', 10);
            db.run(`
                INSERT INTO users (email, password_hash, name, role, student_group, course)
                VALUES ('student@test.com', '${studentHash}', 'Марія Коваленко', 'student', 'КН-21', 3)
            `);
            
            saveDatabase();
            console.log('✅ Демо-користувачі створені');
            console.log('   Викладач: teacher@test.com / teacher123');
            console.log('   Студент: student@test.com / student123');
        }
    } catch (err) {
        console.error('❌ Помилка міграції:', err.message);
    }
    
    return db;
}

/**
 * Зберігає базу на диск
 * Викликати після INSERT/UPDATE/DELETE
 */
function saveDatabase() {
    if (!db) return;
    
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(fullPath, buffer);
    } catch (err) {
        console.error('Помилка збереження бази:', err);
    }
}

/**
 * Отримати об'єкт бази
 */
function getDb() {
    if (!db) {
        throw new Error('База даних не ініціалізована. Викличте initDatabase() спочатку.');
    }
    return db;
}

/**
 * Виконує SELECT запит і повертає всі рядки
 * @param {string} sql - SQL запит з @параметрами
 * @param {object} params - Параметри запиту
 * @returns {Array} Масив результатів
 */
function queryAll(sql, params = {}) {
    const { query, values } = convertQuery(sql, params);
    const stmt = db.prepare(query);
    
    if (values.length > 0) {
        stmt.bind(values);
    }
    
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    
    return results;
}

/**
 * Виконує SELECT запит і повертає один рядок
 * @param {string} sql - SQL запит з @параметрами
 * @param {object} params - Параметри запиту
 * @returns {object|null} Один рядок або null
 */
function queryOne(sql, params = {}) {
    const { query, values } = convertQuery(sql, params);
    const stmt = db.prepare(query);
    
    if (values.length > 0) {
        stmt.bind(values);
    }
    
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
    }
    stmt.free();
    
    return result;
}

/**
 * Виконує INSERT/UPDATE/DELETE
 * @param {string} sql - SQL запит з @параметрами
 * @param {object} params - Параметри запиту
 * @returns {object} { changes, lastInsertRowid }
 */
function execute(sql, params = {}) {
    const { query, values } = convertQuery(sql, params);
    
    if (values.length > 0) {
        db.run(query, values);
    } else {
        db.run(query);
    }
    
    const changes = db.getRowsModified();
    
    // Отримуємо last_insert_rowid
    const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowid = lastIdResult.length > 0 && lastIdResult[0].values.length > 0 
        ? lastIdResult[0].values[0][0] 
        : 0;
    
    // Автоматично зберігаємо після змін
    saveDatabase();
    
    return {
        changes,
        lastInsertRowid
    };
}

/**
 * Виконує декілька SQL команд (для schema)
 * @param {string} sql - SQL команди
 */
function execMultiple(sql) {
    db.exec(sql);
    saveDatabase();
}

/**
 * Конвертує запит з @параметрами в запит з ? та масив значень
 * @param {string} sql - SQL з @param
 * @param {object} params - { param: value }
 * @returns {{ query: string, values: array }}
 */
function convertQuery(sql, params) {
    if (!params || Object.keys(params).length === 0) {
        return { query: sql, values: [] };
    }
    
    const values = [];
    
    // Знаходимо всі @параметри в порядку їх появи в SQL
    const regex = /@(\w+)/g;
    const query = sql.replace(regex, (match, paramName) => {
        if (paramName in params) {
            values.push(params[paramName]);
            return '?';
        }
        return match; // Залишаємо як є якщо параметр не знайдено
    });
    
    return { query, values };
}

/**
 * Закриває базу даних
 */
function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
        console.log('🔒 База даних закрита');
    }
}

module.exports = {
    initDatabase,
    getDb,
    saveDatabase,
    queryAll,
    queryOne,
    execute,
    execMultiple,
    closeDatabase
};
