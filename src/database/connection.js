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
