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

// Імпортуємо наші модулі
const { initDatabase, closeDatabase } = require('./database/connection');

// Створюємо Express додаток
const app = express();

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

    app.use('/api/auth', authRoutes);
    app.use('/api/disciplines', disciplinesRoutes);
    app.use('/api/tests', testsRoutes);
    app.use('/api/submissions', submissionsRoutes);
    app.use('/api/reports', reportsRoutes);
    app.use('/api/batch', batchRoutes);
    
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
// ЗАПУСК СЕРВЕРА
// ============================================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Ініціалізуємо базу даних
        console.log('⏳ Ініціалізація бази даних...');
        await initDatabase();
        
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
