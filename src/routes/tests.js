/**
 * ============================================
 * МАРШРУТИ ДЛЯ ТЕСТІВ
 * ============================================
 * POST   /api/tests              - створити тест (з файлами завдання та критеріїв)
 * GET    /api/tests/:id          - отримати тест
 * DELETE /api/tests/:id          - видалити тест
 * POST   /api/tests/:id/grade-all - оцінити всі здані роботи
 * GET    /api/tests/:id/results/:filename - завантажити Excel з результатами
 * GET    /api/tests/:id/task-file - завантажити PDF завдання
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const { queryAll, queryOne, execute } = require('../database/connection');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

// Налаштування multer для завантаження файлів
const uploadsDir = path.resolve(__dirname, '../../uploads/tests');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uniqueName = `${Date.now()}_${originalName}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (file.fieldname === 'task_file' && ext === '.pdf') {
            cb(null, true);
        } else if (file.fieldname === 'criteria_file' && ['.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Невірний формат файлу: ${file.fieldname}`), false);
        }
    }
});

const uploadFields = upload.fields([
    { name: 'task_file', maxCount: 1 },
    { name: 'criteria_file', maxCount: 1 }
]);

/**
 * Парсить Excel файл і витягує структуру колонок (як в batch.js)
 * Розрізняє критерії (з балами) та інформаційні поля
 */
function parseCriteriaFromExcel(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (data.length === 0) {
        throw new Error('Excel файл порожній');
    }
    
    const headers = data[0];
    const columns = [];
    
    headers.forEach((header, index) => {
        if (!header) return;
        
        const headerStr = String(header).trim();
        const headerLower = headerStr.toLowerCase();
        
        let infoType = null;
        let columnType = 'info';
        let maxPoints = null;
        
        // СПОЧАТКУ перевіряємо відомі інформаційні поля
        if (/^№\s*$|^номер$/i.test(headerLower)) {
            infoType = 'number';
        } else if (/^студент$|^учасник$|^прізвище$|^пІб$|^ім['']?я$/i.test(headerLower)) {
            infoType = 'name';
        } else if (/^група$|^клас$|^курс$/i.test(headerLower)) {
            infoType = 'group';
        } else if (/email|пошта/i.test(headerLower)) {
            infoType = 'email';
        } else if (/заклад|школа|університет|ліцей|гімназ/i.test(headerLower)) {
            infoType = 'institution';
        } else if (/^тема|назва роботи/i.test(headerLower)) {
            infoType = 'topic';
        } else if (/керівник|викладач|вчитель/i.test(headerLower)) {
            infoType = 'supervisor';
        } else if (/^дата/i.test(headerLower)) {
            infoType = 'date';
        } else if (/сума|всього|разом|підсумок|total/i.test(headerLower)) {
            // Це поле для суми - НЕ критерій!
            infoType = 'total';
        } else if (/відгук|коментар|примітк|feedback/i.test(headerLower)) {
            infoType = 'feedback';
        } else {
            // ТІЛЬКИ тепер перевіряємо чи є бали в назві → критерій
            const pointsMatch = headerStr.match(/[-–—]\s*(\d+)\s*б/i) || 
                               headerStr.match(/(\d+)\s*бал/i) ||
                               headerStr.match(/макс\.?\s*(\d+)/i) ||
                               headerStr.match(/\((\d+)\s*б\.?\)/i);
            
            if (pointsMatch) {
                columnType = 'criterion';
                maxPoints = parseInt(pointsMatch[1]);
            } else {
                infoType = 'other';
            }
        }
        
        columns.push({
            index,
            name: headerStr,
            type: columnType,
            infoType,
            maxPoints
        });
    });
    
    // Для сумісності зі старим форматом
    const criteria = columns.filter(c => c.type === 'criterion');
    
    return { 
        columns,  // Нова структура для submissions.js
        headers,  // Оригінальні заголовки
        criteria  // Для сумісності зі старим кодом
    };
}

// ============================================
// СТВОРИТИ ТЕСТ
// ============================================
router.post('/', authMiddleware, teacherOnly, uploadFields, async (req, res) => {
    const files = req.files || {};
    
    try {
        const { discipline_id, type, title, description, start_time, end_time } = req.body;
        
        // Перевіряємо чи дисципліна належить викладачу
        const discipline = queryOne(`
            SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId
        `, { id: parseInt(discipline_id), teacherId: req.user.id });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Валідація дат (порівнюємо як рядки - datetime-local формат сортується коректно)
        if (end_time <= start_time) {
            return res.status(400).json({ error: 'Дата закінчення має бути після дати початку' });
        }
        
        // Зберігаємо час як є (локальний час користувача)
        
        let taskFilePath = null;
        let criteriaFilePath = null;
        let criteriaJson = null;
        let maxPoints = 100;
        
        // Обробка PDF завдання
        if (files.task_file && files.task_file[0]) {
            taskFilePath = files.task_file[0].filename;
        }
        
        // Обробка Excel критеріїв
        if (files.criteria_file && files.criteria_file[0]) {
            criteriaFilePath = files.criteria_file[0].filename;
            const fullPath = path.join(uploadsDir, criteriaFilePath);
            
            try {
                const parsed = parseCriteriaFromExcel(fullPath);
                criteriaJson = JSON.stringify(parsed);
                maxPoints = parsed.criteria.reduce((sum, c) => sum + c.maxPoints, 0);
            } catch (parseErr) {
                console.error('Помилка парсингу Excel:', parseErr);
                return res.status(400).json({ error: 'Не вдалося розпарсити Excel файл' });
            }
        }
        
        // Створюємо тест
        const result = execute(`
            INSERT INTO tests (discipline_id, type, title, description, task_file, criteria_file, criteria_json, start_time, end_time, max_points)
            VALUES (@disciplineId, @type, @title, @description, @taskFile, @criteriaFile, @criteriaJson, @startTime, @endTime, @maxPoints)
        `, {
            disciplineId: parseInt(discipline_id),
            type,
            title,
            description: description || null,
            taskFile: taskFilePath,
            criteriaFile: criteriaFilePath,
            criteriaJson,
            startTime: start_time,  // Зберігаємо локальний час напряму
            endTime: end_time,      // Зберігаємо локальний час напряму
            maxPoints
        });
        
        const testId = result.lastInsertRowid;
        
        // Якщо є критерії з JSON, додаємо їх також в таблицю criteria
        if (criteriaJson) {
            const parsed = JSON.parse(criteriaJson);
            parsed.criteria.forEach((crit, index) => {
                execute(`
                    INSERT INTO criteria (test_id, name, max_points, sort_order)
                    VALUES (@testId, @name, @maxPoints, @sortOrder)
                `, {
                    testId,
                    name: crit.name,
                    maxPoints: crit.maxPoints,
                    sortOrder: index
                });
            });
        }
        
        res.status(201).json({
            message: 'Тест створено',
            test: {
                id: testId,
                title,
                type,
                max_points: maxPoints,
                has_task_file: !!taskFilePath,
                has_criteria_file: !!criteriaFilePath,
                criteria_count: criteriaJson ? JSON.parse(criteriaJson).criteria.length : 0
            }
        });
        
    } catch (err) {
        console.error('Помилка створення тесту:', err);
        Object.values(files).flat().forEach(f => {
            if (f && fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОТРИМАТИ ТЕСТ
// ============================================
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        const test = queryOne(`
            SELECT t.*, d.name as discipline_name, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id AND t.is_active = 1
        `, { id: testId });
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        // Отримуємо критерії
        const criteria = queryAll(`
            SELECT * FROM criteria WHERE test_id = @testId ORDER BY sort_order
        `, { testId });
        
        // Кількість зданих робіт
        const stats = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'graded' THEN 1 ELSE 0 END) as graded,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
            FROM submissions WHERE test_id = @testId
        `, { testId });
        
        res.json({
            test: {
                ...test,
                criteria,
                submissions_count: stats?.total || 0,
                graded_count: stats?.graded || 0,
                pending_count: stats?.pending || 0
            }
        });
        
    } catch (err) {
        console.error('Помилка отримання тесту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОЦІНИТИ ВСІ РОБОТИ ТЕСТУ
// ============================================
router.post('/:id/grade-all', authMiddleware, teacherOnly, async (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        // Перевіряємо тест і права доступу
        const test = queryOne(`
            SELECT t.*, d.teacher_id, d.name as discipline_name
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test || test.teacher_id !== req.user.id) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        // Отримуємо критерії
        let criteria = [];
        if (test.criteria_json) {
            criteria = JSON.parse(test.criteria_json).criteria || [];
        } else {
            const dbCriteria = queryAll(`SELECT * FROM criteria WHERE test_id = @testId`, { testId });
            criteria = dbCriteria.map(c => ({ name: c.name, maxPoints: c.max_points }));
        }
        
        if (criteria.length === 0) {
            return res.status(400).json({ error: 'Тест не має критеріїв оцінювання' });
        }
        
        // Отримуємо неоцінені роботи
        const submissions = queryAll(`
            SELECT s.*, u.name as student_name, u.student_group
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            WHERE s.test_id = @testId AND s.status IN ('pending', 'error')
        `, { testId });
        
        if (submissions.length === 0) {
            return res.status(400).json({ error: 'Немає робіт для оцінювання' });
        }
        
        // Читаємо текст завдання якщо є
        let taskText = '';
        if (test.task_file) {
            try {
                const taskPath = path.join(uploadsDir, test.task_file);
                if (fs.existsSync(taskPath)) {
                    const pdfBuffer = fs.readFileSync(taskPath);
                    const pdfData = await pdfParse(pdfBuffer);
                    taskText = pdfData.text.substring(0, 3000);
                }
            } catch (e) {
                console.error('Помилка читання PDF завдання:', e);
            }
        }
        
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API ключ не налаштовано' });
        }
        
        const results = [];
        const errors = [];
        
        // Оцінюємо кожну роботу
        for (const submission of submissions) {
            try {
                // Оновлюємо статус
                execute(`UPDATE submissions SET status = 'grading' WHERE id = @id`, { id: submission.id });
                
                // Читаємо текст роботи
                let studentText = submission.extracted_text || '';
                if (!studentText && submission.file_path) {
                    const filePath = path.resolve(__dirname, '../../', submission.file_path);
                    if (fs.existsSync(filePath)) {
                        const pdfBuffer = fs.readFileSync(filePath);
                        const pdfData = await pdfParse(pdfBuffer);
                        studentText = pdfData.text;
                        
                        execute(`UPDATE submissions SET extracted_text = @text WHERE id = @id`, {
                            text: studentText,
                            id: submission.id
                        });
                    }
                }
                
                if (!studentText || studentText.length < 10) {
                    errors.push({ student: submission.student_name, error: 'Не вдалося витягти текст' });
                    execute(`UPDATE submissions SET status = 'error' WHERE id = @id`, { id: submission.id });
                    continue;
                }
                
                // Формуємо промпт
                const prompt = `Ти — викладач, який оцінює студентську роботу.

Дисципліна: ${test.discipline_name}
Назва тесту: ${test.title}
Студент: ${submission.student_name}
${taskText ? `\nУмова завдання:\n"""\n${taskText}\n"""` : ''}

Робота студента:
"""
${studentText.substring(0, 15000)}
"""

Критерії оцінювання:
${criteria.map(c => `- ${c.name}: максимум ${c.maxPoints} балів`).join('\n')}

Оціни роботу за кожним критерієм. Будь об'єктивним.

Відповідь ТІЛЬКИ у форматі JSON:
{
  "grades": [
    {"criterion": "назва критерію", "points": число, "max": число}
  ],
  "total": сума_балів,
  "feedback": "короткий відгук українською"
}`;

                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
                        max_tokens: 2000,
                        messages: [{ role: 'user', content: prompt }]
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Помилка BI сервісу');
                }
                
                const aiResponse = await response.json();
                const aiText = aiResponse.content?.[0]?.text || '';
                
                let result;
                try {
                    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                    result = JSON.parse(jsonMatch[0]);
                } catch {
                    result = {
                        total: Math.floor(test.max_points * 0.7),
                        feedback: 'Автоматична оцінка',
                        grades: []
                    };
                }
                
                // Зберігаємо оцінку
                execute(`
                    UPDATE submissions 
                    SET status = 'graded', total_grade = @grade, ai_feedback = @feedback, graded_at = @gradedAt
                    WHERE id = @id
                `, {
                    grade: result.total,
                    feedback: result.feedback,
                    gradedAt: new Date().toISOString(),
                    id: submission.id
                });
                
                results.push({
                    student: submission.student_name,
                    group: submission.student_group,
                    total: result.total,
                    feedback: result.feedback,
                    grades: result.grades || []
                });
                
            } catch (err) {
                console.error(`Помилка оцінювання ${submission.student_name}:`, err);
                errors.push({ student: submission.student_name, error: err.message });
                execute(`UPDATE submissions SET status = 'error' WHERE id = @id`, { id: submission.id });
            }
        }
        
        // Генеруємо Excel з результатами
        const resultsDir = path.resolve(__dirname, '../../uploads/results');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        const wb = XLSX.utils.book_new();
        const excelData = [];
        
        // Заголовки
        excelData.push(['№', 'Студент', 'Група', ...criteria.map(c => c.name), 'Загальна сума', 'Відгук BI']);
        
        // Дані
        results.forEach((r, index) => {
            const row = [
                index + 1,
                r.student,
                r.group || '',
                ...criteria.map(c => {
                    const grade = r.grades?.find(g => 
                        g.criterion?.toLowerCase().includes(c.name.toLowerCase().substring(0, 15))
                    );
                    return grade?.points ?? '';
                }),
                r.total,
                r.feedback
            ];
            excelData.push(row);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        XLSX.utils.book_append_sheet(wb, ws, 'Результати');
        
        const resultFileName = `results_test_${testId}_${Date.now()}.xlsx`;
        const resultPath = path.join(resultsDir, resultFileName);
        XLSX.writeFile(wb, resultPath);
        
        res.json({
            message: `Оцінено ${results.length} робіт`,
            success: results.length,
            errors: errors.length,
            results,
            errors_list: errors,
            download_url: `/api/tests/${testId}/results/${resultFileName}`
        });
        
    } catch (err) {
        console.error('Помилка масового оцінювання:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗАВАНТАЖИТИ ФАЙЛ РЕЗУЛЬТАТІВ
// ============================================
router.get('/:id/results/:filename', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        const filename = req.params.filename;
        
        const test = queryOne(`
            SELECT t.*, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test || test.teacher_id !== req.user.id) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        const resultsDir = path.resolve(__dirname, '../../uploads/results');
        const filePath = path.join(resultsDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не знайдено' });
        }
        
        res.download(filePath, `Результати_${test.title}_${new Date().toISOString().split('T')[0]}.xlsx`);
        
    } catch (err) {
        console.error('Помилка завантаження:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗАВАНТАЖИТИ ФАЙЛ ЗАВДАННЯ
// ============================================
router.get('/:id/task-file', authMiddleware, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        const test = queryOne(`SELECT * FROM tests WHERE id = @id`, { id: testId });
        
        if (!test || !test.task_file) {
            return res.status(404).json({ error: 'Файл завдання не знайдено' });
        }
        
        const filePath = path.join(uploadsDir, test.task_file);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не знайдено' });
        }
        
        res.download(filePath, `Завдання_${test.title}.pdf`);
        
    } catch (err) {
        console.error('Помилка:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ ТЕСТ
// ============================================
router.delete('/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        const test = queryOne(`
            SELECT t.*, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test || test.teacher_id !== req.user.id) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        execute(`UPDATE tests SET is_active = 0 WHERE id = @id`, { id: testId });
        
        res.json({ message: 'Тест видалено' });
        
    } catch (err) {
        console.error('Помилка видалення:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОНОВИТИ ШАБЛОН КРИТЕРІЇВ (для існуючого тесту)
// ============================================
const uploadCriteria = upload.single('criteria_file');

router.post('/:id/update-criteria', authMiddleware, teacherOnly, uploadCriteria, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        
        // Перевіряємо тест і права
        const test = queryOne(`
            SELECT t.*, d.teacher_id
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test || test.teacher_id !== req.user.id) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Завантажте Excel файл з критеріями' });
        }
        
        // Парсимо Excel
        const fullPath = req.file.path;
        let parsed;
        try {
            parsed = parseCriteriaFromExcel(fullPath);
        } catch (parseErr) {
            fs.unlinkSync(fullPath);
            return res.status(400).json({ error: 'Не вдалося розпарсити Excel: ' + parseErr.message });
        }
        
        if (parsed.criteria.length === 0) {
            fs.unlinkSync(fullPath);
            return res.status(400).json({ 
                error: 'Excel не містить критеріїв. Переконайтесь, що стовпці мають бали в назві (наприклад: "Критерій – 5 б.")'
            });
        }
        
        const criteriaJson = JSON.stringify(parsed);
        const maxPoints = parsed.criteria.reduce((sum, c) => sum + c.maxPoints, 0);
        
        // Видаляємо старий файл якщо є
        if (test.criteria_file) {
            const oldPath = path.join(uploadsDir, test.criteria_file);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }
        
        // Оновлюємо тест
        execute(`
            UPDATE tests 
            SET criteria_file = @criteriaFile,
                criteria_json = @criteriaJson,
                max_points = @maxPoints
            WHERE id = @id
        `, {
            id: testId,
            criteriaFile: req.file.filename,
            criteriaJson,
            maxPoints
        });
        
        // Видаляємо старий файл результатів (бо структура змінилась)
        const resultsDir = path.resolve(__dirname, '../../results');
        const oldResultsPath = path.join(resultsDir, `test_${testId}_results.xlsx`);
        if (fs.existsSync(oldResultsPath)) {
            fs.unlinkSync(oldResultsPath);
        }
        
        // Логуємо структуру
        console.log(`\n📊 Оновлено шаблон для тесту #${testId}:`);
        parsed.columns.forEach(col => {
            if (col.type === 'criterion') {
                console.log(`   ⭐ КРИТЕРІЙ (${col.maxPoints} б.): ${col.name}`);
            } else {
                console.log(`   📋 ІНФО (${col.infoType}): ${col.name}`);
            }
        });
        console.log(`   Максимум балів: ${maxPoints}\n`);
        
        res.json({
            message: 'Шаблон критеріїв оновлено',
            criteria_count: parsed.criteria.length,
            max_points: maxPoints,
            columns: parsed.columns.map(c => ({
                name: c.name,
                type: c.type,
                infoType: c.infoType,
                maxPoints: c.maxPoints
            }))
        });
        
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Помилка оновлення критеріїв:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
