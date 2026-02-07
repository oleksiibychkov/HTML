/**
 * ============================================
 * MIDDLEWARE АВТОРИЗАЦІЇ
 * ============================================
 * Перевіряє чи користувач залогінений
 */

const { queryOne } = require('../database/connection');

/**
 * Перевіряє токен авторизації
 * Токен передається в заголовку: Authorization: Bearer <token>
 */
function authMiddleware(req, res, next) {
    // Отримуємо заголовок Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Необхідна авторизація',
            code: 'NO_TOKEN'
        });
    }
    
    // Витягуємо токен (після "Bearer ")
    const token = authHeader.substring(7);
    
    // Шукаємо сесію в базі
    const session = queryOne(`
        SELECT s.*, u.id as user_id, u.email, u.name, u.role, u.student_group, u.course
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = @token AND s.expires_at > datetime('now')
    `, { token });
    
    if (!session) {
        return res.status(401).json({ 
            error: 'Сесія недійсна або закінчилась',
            code: 'INVALID_SESSION'
        });
    }
    
    // Додаємо інформацію про користувача до запиту
    req.user = {
        id: session.user_id,
        email: session.email,
        name: session.name,
        role: session.role,
        group: session.student_group,
        course: session.course
    };
    
    // Продовжуємо обробку запиту
    next();
}

/**
 * Перевіряє чи користувач є викладачем
 */
function teacherOnly(req, res, next) {
    if (req.user.role !== 'teacher') {
        return res.status(403).json({ 
            error: 'Доступ тільки для викладачів',
            code: 'TEACHER_ONLY'
        });
    }
    next();
}

/**
 * Перевіряє чи користувач є студентом
 */
function studentOnly(req, res, next) {
    if (req.user.role !== 'student') {
        return res.status(403).json({ 
            error: 'Доступ тільки для студентів',
            code: 'STUDENT_ONLY'
        });
    }
    next();
}

module.exports = {
    authMiddleware,
    teacherOnly,
    studentOnly
};
