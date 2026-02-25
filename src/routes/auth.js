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
const { queryOne, queryAll, execute, saveDatabase } = require('../database/connection');
const { authMiddleware, teacherOnly, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Час життя сесії (в годинах)
const SESSION_HOURS = parseInt(process.env.SESSION_LIFETIME_HOURS) || 24;

// ============================================
// РЕЄСТРАЦІЯ (з rate limiting)
// ============================================
router.post('/register', (req, res, next) => {
    // Застосовуємо authLimiter
    const authLimiter = req.app.get('authLimiter');
    if (authLimiter) return authLimiter(req, res, next);
    next();
}, async (req, res) => {
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
// ВХІД (з rate limiting - захист від brute force)
// ============================================
router.post('/login', (req, res, next) => {
    // Застосовуємо authLimiter
    const authLimiter = req.app.get('authLimiter');
    if (authLimiter) return authLimiter(req, res, next);
    next();
}, async (req, res) => {
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

// ============================================
// ADMIN: СТАТИСТИКА СИСТЕМИ
// ============================================
router.get('/admin/stats', authMiddleware, adminOnly, (req, res) => {
    try {
        const stats = {
            teachers: queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND is_active = 1").count,
            students: queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND is_active = 1").count,
            disciplines: queryOne("SELECT COUNT(*) as count FROM disciplines WHERE is_active = 1").count,
            tests: queryOne("SELECT COUNT(*) as count FROM tests WHERE is_active = 1").count,
            submissions: queryOne("SELECT COUNT(*) as count FROM submissions").count,
            graded: queryOne("SELECT COUNT(*) as count FROM submissions WHERE status = 'graded'").count
        };
        res.json({ stats });
    } catch (err) {
        console.error('Помилка статистики:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ADMIN: ВСІ ВИКЛАДАЧІ
// ============================================
router.get('/admin/teachers', authMiddleware, adminOnly, (req, res) => {
    try {
        const teachers = queryAll(`
            SELECT u.id, u.name, u.email, u.created_at, u.is_active,
                   COUNT(DISTINCT d.id) as disciplines_count,
                   COUNT(DISTINCT t.id) as tests_count
            FROM users u
            LEFT JOIN disciplines d ON d.teacher_id = u.id AND d.is_active = 1
            LEFT JOIN tests t ON t.discipline_id = d.id AND t.is_active = 1
            WHERE u.role = 'teacher'
            GROUP BY u.id
            ORDER BY u.name ASC
        `);
        res.json({ teachers });
    } catch (err) {
        console.error('Помилка:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ADMIN: ВСІ СТУДЕНТИ
// ============================================
router.get('/admin/students', authMiddleware, adminOnly, (req, res) => {
    try {
        const students = queryAll(`
            SELECT u.id, u.name, u.email, u.student_group, u.course, u.created_at, u.is_active,
                   COUNT(DISTINCT s.id) as submissions_count
            FROM users u
            LEFT JOIN submissions s ON s.student_id = u.id
            WHERE u.role = 'student'
            GROUP BY u.id
            ORDER BY u.name ASC
        `);
        res.json({ students });
    } catch (err) {
        console.error('Помилка:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ADMIN: ВИДАЛИТИ БУДЬ-ЯКОГО КОРИСТУВАЧА
// ============================================
router.delete('/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = queryOne('SELECT id, name, email, role FROM users WHERE id = @id', { id: userId });

        if (!user) {
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }
        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Не можна видалити адміністратора' });
        }

        // Видаляємо файли
        const fs = require('fs');
        const path = require('path');

        if (user.role === 'teacher') {
            // Файли тестів
            const tests = queryAll(`
                SELECT t.task_file, t.criteria_file FROM tests t
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE d.teacher_id = @id
            `, { id: userId });
            for (const t of tests) {
                for (const f of ['task_file', 'criteria_file']) {
                    if (t[f]) {
                        const fp = path.resolve(__dirname, '../../', t[f]);
                        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) {}
                    }
                }
            }
            // Файли здач до тестів цього викладача
            const subs = queryAll(`
                SELECT s.file_path FROM submissions s
                JOIN tests t ON s.test_id = t.id
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE d.teacher_id = @id
            `, { id: userId });
            for (const s of subs) {
                if (s.file_path) {
                    const fp = path.resolve(__dirname, '../../', s.file_path);
                    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) {}
                }
            }
        } else {
            // Файли здач студента
            const subs = queryAll('SELECT file_path FROM submissions WHERE student_id = @id', { id: userId });
            for (const s of subs) {
                if (s.file_path) {
                    const fp = path.resolve(__dirname, '../../', s.file_path);
                    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) {}
                }
            }
        }

        execute('DELETE FROM users WHERE id = @id', { id: userId });
        saveDatabase();
        res.json({ message: `${user.role === 'teacher' ? 'Викладача' : 'Студента'} ${user.name} видалено` });
    } catch (err) {
        console.error('Помилка видалення:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// СПИСОК СТУДЕНТІВ (для панелі налаштувань)
// ============================================
router.get('/students', authMiddleware, teacherOnly, (req, res) => {
    try {
        const students = queryAll(`
            SELECT u.id, u.name, u.email, u.student_group, u.course, u.created_at,
                   COUNT(DISTINCT s.id) as submissions_count,
                   COUNT(DISTINCT s.test_id) as tests_count
            FROM users u
            LEFT JOIN submissions s ON s.student_id = u.id
            LEFT JOIN tests t ON s.test_id = t.id
            LEFT JOIN disciplines d ON t.discipline_id = d.id AND d.teacher_id = @teacherId
            WHERE u.role = 'student' AND u.is_active = 1
            AND (d.teacher_id = @teacherId OR s.id IS NULL)
            GROUP BY u.id
            HAVING submissions_count > 0
            ORDER BY u.name ASC
        `, { teacherId: req.user.id });

        res.json({ students });
    } catch (err) {
        console.error('Помилка отримання студентів:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ СТУДЕНТА (тільки студента, не викладача)
// ============================================
router.delete('/users/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        const user = queryOne('SELECT id, name, email, role FROM users WHERE id = @id', { id: userId });
        if (!user) {
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }
        if (user.role !== 'student') {
            return res.status(403).json({ error: 'Можна видаляти тільки студентів' });
        }

        // Видаляємо файли здач цього студента
        const submissions = queryAll(
            'SELECT file_path FROM submissions WHERE student_id = @id',
            { id: userId }
        );
        const fs = require('fs');
        const path = require('path');
        for (const sub of submissions) {
            if (sub.file_path) {
                const fullPath = path.resolve(__dirname, '../../', sub.file_path);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
                }
            }
        }

        // CASCADE видалить submissions, quiz_answers, sessions, resubmit_requests
        execute('DELETE FROM users WHERE id = @id', { id: userId });
        saveDatabase();

        res.json({ message: `Студента ${user.name} видалено` });
    } catch (err) {
        console.error('Помилка видалення студента:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ СВІЙ АКАУНТ (викладач)
// ============================================
router.delete('/me', authMiddleware, (req, res) => {
    try {
        const { confirmEmail } = req.body;

        if (!confirmEmail || confirmEmail.toLowerCase() !== req.user.email.toLowerCase()) {
            return res.status(400).json({ error: 'Для підтвердження введіть свій email' });
        }

        const fs = require('fs');
        const path = require('path');

        // Видаляємо файли тестів та здач
        const tests = queryAll(`
            SELECT t.task_file, t.criteria_file
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE d.teacher_id = @teacherId
        `, { teacherId: req.user.id });

        for (const test of tests) {
            for (const fileProp of ['task_file', 'criteria_file']) {
                if (test[fileProp]) {
                    const fullPath = path.resolve(__dirname, '../../', test[fileProp]);
                    if (fs.existsSync(fullPath)) {
                        try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
                    }
                }
            }
        }

        const submissions = queryAll(`
            SELECT s.file_path
            FROM submissions s
            JOIN tests t ON s.test_id = t.id
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE d.teacher_id = @teacherId
        `, { teacherId: req.user.id });

        for (const sub of submissions) {
            if (sub.file_path) {
                const fullPath = path.resolve(__dirname, '../../', sub.file_path);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
                }
            }
        }

        // CASCADE видалить disciplines, tests, submissions, sessions, тощо
        execute('DELETE FROM users WHERE id = @id', { id: req.user.id });
        saveDatabase();

        res.json({ message: 'Ваш акаунт видалено', logout: true });
    } catch (err) {
        console.error('Помилка видалення акаунту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
