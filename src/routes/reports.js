/**
 * ============================================
 * МАРШРУТИ ЗВІТІВ
 * ============================================
 * GET /api/reports/discipline/:id - звіт по дисципліні
 * GET /api/reports/test/:id - звіт по тесту
 * GET /api/reports/student/:id - звіт по студенту (для викладача)
 */

const express = require('express');
const { queryAll, queryOne } = require('../database/connection');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

// Мітки типів тестів
const TEST_TYPE_LABELS = {
    lab: 'Лабораторна робота',
    control: 'Контрольна робота',
    exam: 'Іспит'
};

// ============================================
// ЗВІТ ПО ДИСЦИПЛІНІ
// ============================================
router.get('/discipline/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.id);
        
        // Перевіряємо доступ
        const discipline = queryOne(`
            SELECT * FROM disciplines 
            WHERE id = @id AND teacher_id = @teacherId AND is_active = 1
        `, { id: disciplineId, teacherId: req.user.id });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Отримуємо всі тести дисципліни
        const tests = queryAll(`
            SELECT t.*, 
                   (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id) as total_submissions,
                   (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id AND s.status = 'graded') as graded_count,
                   (SELECT AVG(total_grade) FROM submissions s WHERE s.test_id = t.id AND s.status = 'graded') as avg_grade
            FROM tests t
            WHERE t.discipline_id = @disciplineId AND t.is_active = 1
            ORDER BY t.start_time DESC
        `, { disciplineId });
        
        // Для кожного тесту отримуємо результати студентів
        for (const test of tests) {
            test.type_label = TEST_TYPE_LABELS[test.type] || test.type;
            
            test.results = queryAll(`
                SELECT s.id, s.total_grade, s.status, s.submitted_at, s.graded_at,
                       u.name as student_name, u.email as student_email, u.student_group
                FROM submissions s
                JOIN users u ON s.student_id = u.id
                WHERE s.test_id = @testId
                ORDER BY u.student_group, u.name
            `, { testId: test.id });
        }
        
        // Загальна статистика
        const stats = queryOne(`
            SELECT 
                COUNT(DISTINCT s.student_id) as unique_students,
                COUNT(s.id) as total_submissions,
                AVG(CASE WHEN s.status = 'graded' THEN s.total_grade END) as overall_avg
            FROM submissions s
            JOIN tests t ON s.test_id = t.id
            WHERE t.discipline_id = @disciplineId
        `, { disciplineId });
        
        res.json({
            discipline,
            tests,
            statistics: stats
        });
        
    } catch (err) {
        console.error('Помилка формування звіту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗВІТ ПО ТЕСТУ
// ============================================
router.get('/test/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        // Перевіряємо доступ
        const test = queryOne(`
            SELECT t.*, d.name as discipline_name, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id AND d.teacher_id = @teacherId
        `, { id: testId, teacherId: req.user.id });
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        test.type_label = TEST_TYPE_LABELS[test.type] || test.type;
        
        // Критерії
        const criteria = queryAll(`
            SELECT * FROM criteria WHERE test_id = @testId ORDER BY sort_order
        `, { testId });
        
        // Результати студентів
        const results = queryAll(`
            SELECT s.*, 
                   u.name as student_name, 
                   u.email as student_email, 
                   u.student_group,
                   u.course
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            WHERE s.test_id = @testId
            ORDER BY u.student_group, u.name
        `, { testId });
        
        // Для кожного результату отримуємо бали по критеріях
        for (const result of results) {
            if (result.status === 'graded') {
                result.criterion_grades = queryAll(`
                    SELECT sg.points, sg.comment, c.name as criterion_name, c.max_points
                    FROM submission_grades sg
                    JOIN criteria c ON sg.criterion_id = c.id
                    WHERE sg.submission_id = @submissionId
                    ORDER BY c.sort_order
                `, { submissionId: result.id });
            }
        }
        
        // Статистика
        const stats = {
            total_submissions: results.length,
            graded: results.filter(r => r.status === 'graded').length,
            pending: results.filter(r => r.status === 'pending').length,
            avg_grade: 0,
            max_grade: 0,
            min_grade: test.max_points,
            grade_distribution: {
                excellent: 0,  // 90-100%
                good: 0,       // 75-89%
                satisfactory: 0, // 60-74%
                poor: 0        // <60%
            }
        };
        
        const gradedResults = results.filter(r => r.status === 'graded' && r.total_grade !== null);
        
        if (gradedResults.length > 0) {
            const grades = gradedResults.map(r => r.total_grade);
            stats.avg_grade = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
            stats.max_grade = Math.max(...grades);
            stats.min_grade = Math.min(...grades);
            
            // Розподіл оцінок
            for (const grade of grades) {
                const percentage = (grade / test.max_points) * 100;
                if (percentage >= 90) stats.grade_distribution.excellent++;
                else if (percentage >= 75) stats.grade_distribution.good++;
                else if (percentage >= 60) stats.grade_distribution.satisfactory++;
                else stats.grade_distribution.poor++;
            }
        }
        
        res.json({
            test,
            criteria,
            results,
            statistics: stats
        });
        
    } catch (err) {
        console.error('Помилка формування звіту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗВІТ ПО СТУДЕНТУ (ДЛЯ ВИКЛАДАЧА)
// ============================================
router.get('/student/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const studentId = parseInt(req.params.id);
        
        // Отримуємо студента
        const student = queryOne(`
            SELECT id, name, email, student_group, course
            FROM users
            WHERE id = @id AND role = 'student'
        `, { id: studentId });
        
        if (!student) {
            return res.status(404).json({ error: 'Студента не знайдено' });
        }
        
        // Результати студента по дисциплінах викладача
        const results = queryAll(`
            SELECT s.*, 
                   t.title as test_title, 
                   t.type as test_type,
                   t.max_points,
                   d.name as discipline_name
            FROM submissions s
            JOIN tests t ON s.test_id = t.id
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE s.student_id = @studentId AND d.teacher_id = @teacherId
            ORDER BY d.name, s.submitted_at DESC
        `, { studentId, teacherId: req.user.id });
        
        // Групуємо по дисциплінах
        const byDiscipline = {};
        for (const result of results) {
            if (!byDiscipline[result.discipline_name]) {
                byDiscipline[result.discipline_name] = [];
            }
            result.type_label = TEST_TYPE_LABELS[result.test_type] || result.test_type;
            byDiscipline[result.discipline_name].push(result);
        }
        
        // Статистика
        const gradedResults = results.filter(r => r.status === 'graded' && r.total_grade !== null);
        const stats = {
            total_submissions: results.length,
            graded: gradedResults.length,
            avg_grade: gradedResults.length > 0 
                ? Math.round(gradedResults.reduce((a, r) => a + r.total_grade, 0) / gradedResults.length)
                : 0,
            avg_percentage: gradedResults.length > 0
                ? Math.round(gradedResults.reduce((a, r) => a + (r.total_grade / r.max_points * 100), 0) / gradedResults.length)
                : 0
        };
        
        res.json({
            student,
            results_by_discipline: byDiscipline,
            all_results: results,
            statistics: stats
        });
        
    } catch (err) {
        console.error('Помилка формування звіту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЕКСПОРТ В CSV (УНІВЕРСАЛЬНИЙ)
// ============================================
router.get('/export/test/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        // Перевіряємо доступ
        const test = queryOne(`
            SELECT t.*, d.name as discipline_name, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id AND d.teacher_id = @teacherId
        `, { id: testId, teacherId: req.user.id });
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        // Отримуємо результати
        const results = queryAll(`
            SELECT 
                u.name as "ПІБ",
                u.student_group as "Група",
                u.email as "Email",
                s.total_grade as "Оцінка",
                t.max_points as "Макс. балів",
                ROUND(CAST(s.total_grade AS FLOAT) / t.max_points * 100, 1) as "Відсоток",
                s.submitted_at as "Дата здачі",
                s.graded_at as "Дата оцінювання",
                s.status as "Статус"
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            JOIN tests t ON s.test_id = t.id
            WHERE s.test_id = @testId
            ORDER BY u.student_group, u.name
        `, { testId });
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'Немає даних для експорту' });
        }
        
        // Формуємо CSV
        const headers = Object.keys(results[0]);
        const csvRows = [
            headers.join(','),
            ...results.map(row => 
                headers.map(h => {
                    let val = row[h] ?? '';
                    // Екрануємо коми і лапки
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                        val = `"${val.replace(/"/g, '""')}"`;
                    }
                    return val;
                }).join(',')
            )
        ];
        
        const csv = '\ufeff' + csvRows.join('\n'); // BOM для UTF-8
        
        const filename = `${test.discipline_name}_${test.title}_${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(csv);
        
    } catch (err) {
        console.error('Помилка експорту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
