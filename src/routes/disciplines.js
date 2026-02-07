/**
 * ============================================
 * МАРШРУТИ ДИСЦИПЛІН
 * ============================================
 * GET  /api/disciplines - список дисциплін
 * POST /api/disciplines - створити дисципліну (викладач)
 * GET  /api/disciplines/:id - одна дисципліна
 * PUT  /api/disciplines/:id - оновити (викладач)
 * DELETE /api/disciplines/:id - видалити (викладач)
 */

const express = require('express');
const { queryAll, queryOne, execute } = require('../database/connection');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// СПИСОК ДИСЦИПЛІН
// ============================================
router.get('/', authMiddleware, (req, res) => {
    try {
        let disciplines;
        
        if (req.user.role === 'teacher') {
            // Викладач бачить тільки свої дисципліни
            disciplines = queryAll(`
                SELECT d.*, 
                       COUNT(DISTINCT t.id) as tests_count,
                       u.name as teacher_name
                FROM disciplines d
                LEFT JOIN tests t ON d.id = t.discipline_id
                JOIN users u ON d.teacher_id = u.id
                WHERE d.teacher_id = @teacherId AND d.is_active = 1
                GROUP BY d.id
                ORDER BY d.created_at DESC
            `, { teacherId: req.user.id });
        } else {
            // Студент бачить всі активні дисципліни
            disciplines = queryAll(`
                SELECT d.*, 
                       COUNT(DISTINCT t.id) as tests_count,
                       u.name as teacher_name
                FROM disciplines d
                LEFT JOIN tests t ON d.id = t.discipline_id AND t.is_active = 1
                JOIN users u ON d.teacher_id = u.id
                WHERE d.is_active = 1
                GROUP BY d.id
                ORDER BY d.name ASC
            `);
        }
        
        res.json({ disciplines });
        
    } catch (err) {
        console.error('Помилка отримання дисциплін:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОДНА ДИСЦИПЛІНА З ТЕСТАМИ
// ============================================
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.id);
        
        // Отримуємо дисципліну
        const discipline = queryOne(`
            SELECT d.*, u.name as teacher_name
            FROM disciplines d
            JOIN users u ON d.teacher_id = u.id
            WHERE d.id = @id AND d.is_active = 1
        `, { id: disciplineId });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Перевірка доступу для викладача
        if (req.user.role === 'teacher' && discipline.teacher_id !== req.user.id) {
            return res.status(403).json({ error: 'Це не ваша дисципліна' });
        }
        
        // Отримуємо тести
        const tests = queryAll(`
            SELECT t.*,
                   (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id) as submissions_count,
                   (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id AND s.status = 'graded') as graded_count,
                   (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id AND s.status = 'pending') as pending_count
            FROM tests t
            WHERE t.discipline_id = @disciplineId AND t.is_active = 1
            ORDER BY t.start_time DESC
        `, { disciplineId });
        
        // Для кожного тесту отримуємо критерії
        for (const test of tests) {
            test.criteria = queryAll(`
                SELECT id, name, max_points, description, sort_order
                FROM criteria
                WHERE test_id = @testId
                ORDER BY sort_order
            `, { testId: test.id });
            
            // Для студента перевіряємо чи вже здавав
            if (req.user.role === 'student') {
                const submission = queryOne(`
                    SELECT id, status, total_grade, submitted_at
                    FROM submissions
                    WHERE test_id = @testId AND student_id = @studentId
                `, { testId: test.id, studentId: req.user.id });
                
                test.my_submission = submission || null;
            }
        }
        
        res.json({ 
            discipline: {
                ...discipline,
                tests
            }
        });
        
    } catch (err) {
        console.error('Помилка отримання дисципліни:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// СТВОРИТИ ДИСЦИПЛІНУ
// ============================================
router.post('/', authMiddleware, teacherOnly, (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name || name.trim().length < 3) {
            return res.status(400).json({ 
                error: 'Назва дисципліни має бути мінімум 3 символи' 
            });
        }
        
        const result = execute(`
            INSERT INTO disciplines (teacher_id, name, description)
            VALUES (@teacherId, @name, @description)
        `, {
            teacherId: req.user.id,
            name: name.trim(),
            description: description?.trim() || null
        });
        
        const discipline = queryOne(
            'SELECT * FROM disciplines WHERE id = @id',
            { id: result.lastInsertRowid }
        );
        
        res.status(201).json({
            message: 'Дисципліну створено',
            discipline
        });
        
    } catch (err) {
        console.error('Помилка створення дисципліни:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОНОВИТИ ДИСЦИПЛІНУ
// ============================================
router.put('/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.id);
        const { name, description } = req.body;
        
        // Перевіряємо чи дисципліна належить викладачу
        const existing = queryOne(
            'SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId',
            { id: disciplineId, teacherId: req.user.id }
        );
        
        if (!existing) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        if (name && name.trim().length < 3) {
            return res.status(400).json({ 
                error: 'Назва дисципліни має бути мінімум 3 символи' 
            });
        }
        
        execute(`
            UPDATE disciplines 
            SET name = COALESCE(@name, name),
                description = COALESCE(@description, description)
            WHERE id = @id
        `, {
            id: disciplineId,
            name: name?.trim() || null,
            description: description?.trim()
        });
        
        const updated = queryOne(
            'SELECT * FROM disciplines WHERE id = @id',
            { id: disciplineId }
        );
        
        res.json({
            message: 'Дисципліну оновлено',
            discipline: updated
        });
        
    } catch (err) {
        console.error('Помилка оновлення дисципліни:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ ДИСЦИПЛІНУ
// ============================================
router.delete('/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.id);
        
        // Перевіряємо чи дисципліна належить викладачу
        const existing = queryOne(
            'SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId',
            { id: disciplineId, teacherId: req.user.id }
        );
        
        if (!existing) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // "М'яке" видалення - просто деактивуємо
        execute(
            'UPDATE disciplines SET is_active = 0 WHERE id = @id',
            { id: disciplineId }
        );
        
        res.json({ message: 'Дисципліну видалено' });
        
    } catch (err) {
        console.error('Помилка видалення дисципліни:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
