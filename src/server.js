/**
 * ============================================
 * ГОЛОВНИЙ ФАЙЛ СЕРВЕРА - TestHub
 * ============================================
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase, closeDatabase } = require('./database/connection');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// МАРШРУТИ API
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'TestHub сервер працює!',
        timestamp: new Date().toISOString()
    });
});

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
    
    app.use(express.static(clientDistPath));
    
    app.get('*', (req, res, next) => {
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
    app.use((req, res) => {
        res.status(404).json({ 
            error: 'Маршрут не знайдено',
            path: req.path 
        });
    });

    app.use((err, req, res, next) => {
        console.error('Помилка сервера:', err);
        res.status(err.status || 500).json({
            error: err.message || 'Внутрішня помилка сервера',
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
        console.log('⏳ Ініціалізація бази даних...');
        await initDatabase();
        
        setupRoutes();
        setupErrorHandlers();
        
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

startServer();