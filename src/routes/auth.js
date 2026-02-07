/**
 * ============================================
 * МАРШРУТИ АВТОРИЗАЦІЇ
 * ============================================
 * POST /api/auth/register - реєстрація
 * POST /api/auth/login - вхід
 * POST /api/auth/logout - вихід
 * GET /api/auth/me - поточний користувач
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryOne, execute } = require('../database/connection');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Час життя сесії (в годинах)
const SESSION_HOURS = parseInt(process.env.SESSION_LIFETIME_HOURS) || 24;

// ============================================
// РЕЄСТРАЦІЯ
// ============================================
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, role, group, course } = req.body;
        
        // Валідація
        if (!email || !password || !name || !role) {
            return res.status(400).json({ 
                error: 'Заповніть всі обов\'язкові поля' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                error: 'Пароль має бути мінімум 6 символів' 
            });
        }
        
        if (!['teacher', 'student'].includes(role)) {
            return res.status(400).json({ 
                error: 'Невірна роль. Допустимі: teacher, student' 
            });
        }
        
        // Для студента обов'язкові група і курс
        if (role === 'student' && (!group || !course)) {
            return res.status(400).json({ 
                error: 'Для студента обов\'язкові група і курс' 
            });
        }
        
        // Перевіряємо чи email не зайнятий
        const existing = queryOne(
            'SELECT id FROM users WHERE email = @email',
            { email: email.toLowerCase() }
        );
        
        if (existing) {
            return res.status(409).json({ 
                error: 'Користувач з таким email вже існує' 
            });
        }
        
        // Хешуємо пароль
        const passwordHash = bcrypt.hashSync(password, 10);
        
        // Створюємо користувача
        const result = execute(`
            INSERT INTO users (email, password_hash, name, role, student_group, course)
            VALUES (@email, @hash, @name, @role, @group, @course)
        `, {
            email: email.toLowerCase(),
            hash: passwordHash,
            name,
            role,
            group: role === 'student' ? group : null,
            course: role === 'student' ? parseInt(course) : null
        });
        
        // Автоматично логінимо
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
        
        execute(`
            INSERT INTO sessions (user_id, token, expires_at)
            VALUES (@userId, @token, @expires)
        `, {
            userId: result.lastInsertRowid,
            token,
            expires: expiresAt
        });
        
        res.status(201).json({
            message: 'Реєстрація успішна',
            token,
            user: {
                id: result.lastInsertRowid,
                email: email.toLowerCase(),
                name,
                role,
                group: role === 'student' ? group : null,
                course: role === 'student' ? parseInt(course) : null
            }
        });
        
    } catch (err) {
        console.error('Помилка реєстрації:', err);
        res.status(500).json({ error: 'Помилка сервера при реєстрації' });
    }
});

// ============================================
// ВХІД
// ============================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Введіть email і пароль' 
            });
        }
        
        // Шукаємо користувача
        const user = queryOne(
            'SELECT * FROM users WHERE email = @email AND is_active = 1',
            { email: email.toLowerCase() }
        );
        
        if (!user) {
            return res.status(401).json({ 
                error: 'Невірний email або пароль' 
            });
        }
        
        // Перевіряємо пароль
        const validPassword = bcrypt.compareSync(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ 
                error: 'Невірний email або пароль' 
            });
        }
        
        // Видаляємо старі сесії цього користувача
        execute(
            'DELETE FROM sessions WHERE user_id = @userId',
            { userId: user.id }
        );
        
        // Створюємо нову сесію
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
        
        execute(`
            INSERT INTO sessions (user_id, token, expires_at)
            VALUES (@userId, @token, @expires)
        `, {
            userId: user.id,
            token,
            expires: expiresAt
        });
        
        res.json({
            message: 'Вхід успішний',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                group: user.student_group,
                course: user.course
            }
        });
        
    } catch (err) {
        console.error('Помилка входу:', err);
        res.status(500).json({ error: 'Помилка сервера при вході' });
    }
});

// ============================================
// ВИХІД
// ============================================
router.post('/logout', authMiddleware, (req, res) => {
    try {
        // Видаляємо сесію
        execute(
            'DELETE FROM sessions WHERE user_id = @userId',
            { userId: req.user.id }
        );
        
        res.json({ message: 'Ви вийшли з системи' });
        
    } catch (err) {
        console.error('Помилка виходу:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ПОТОЧНИЙ КОРИСТУВАЧ
// ============================================
router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
