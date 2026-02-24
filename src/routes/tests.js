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
const { gradeStudentWork, compareFormulas } = require('../math-checker');
const { parseQuizMarkdown, gradeQuizAnswers, buildAIPromptForUnanswered } = require('../quiz-checker');

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
        if (file.fieldname === 'task_file' && (ext === '.pdf' || ext === '.md')) {
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
        const { discipline_id, type, title, description, start_time, end_time, grading_method, math_tasks, quiz_question_count } = req.body;
        
        // Валідація grading_method
        const validMethods = ['ai', 'math', 'mixed', 'quiz'];
        const method = validMethods.includes(grading_method) ? grading_method : 'ai';
        
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
        const parsedQuizCount = quiz_question_count ? parseInt(quiz_question_count) : null;
        const result = execute(`
            INSERT INTO tests (discipline_id, type, title, description, task_file, criteria_file, criteria_json, start_time, end_time, max_points, grading_method, quiz_question_count)
            VALUES (@disciplineId, @type, @title, @description, @taskFile, @criteriaFile, @criteriaJson, @startTime, @endTime, @maxPoints, @gradingMethod, @quizQuestionCount)
        `, {
            disciplineId: parseInt(discipline_id),
            type,
            title,
            description: description || null,
            taskFile: taskFilePath,
            criteriaFile: criteriaFilePath,
            criteriaJson,
            startTime: start_time,
            endTime: end_time,
            maxPoints,
            gradingMethod: method,
            quizQuestionCount: parsedQuizCount > 0 ? parsedQuizCount : null
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
        
        // Зберігаємо математичні завдання (для math та mixed режимів)
        let mathTasksCount = 0;
        if ((method === 'math' || method === 'mixed') && math_tasks) {
            let parsedTasks;
            try {
                parsedTasks = typeof math_tasks === 'string' ? JSON.parse(math_tasks) : math_tasks;
            } catch { parsedTasks = []; }
            
            if (Array.isArray(parsedTasks)) {
                let mathTotalPoints = 0;
                for (const task of parsedTasks) {
                    if (!task.description || !task.reference_answer) continue;
                    
                    const taskPoints = parseInt(task.points) || 10;
                    mathTotalPoints += taskPoints;
                    
                    execute(`
                        INSERT INTO math_tasks (test_id, task_number, description, reference_answer, points, config_json)
                        VALUES (@testId, @taskNumber, @description, @referenceAnswer, @points, @configJson)
                    `, {
                        testId,
                        taskNumber: parseInt(task.task_number) || (mathTasksCount + 1),
                        description: task.description.trim(),
                        referenceAnswer: task.reference_answer.trim(),
                        points: taskPoints,
                        configJson: task.config ? JSON.stringify(task.config) : null
                    });
                    mathTasksCount++;
                }
                
                // Для чисто мат. тесту — maxPoints = сума балів за завдання
                if (method === 'math' && mathTotalPoints > 0) {
                    execute(`UPDATE tests SET max_points = @pts WHERE id = @id`, { pts: mathTotalPoints, id: testId });
                    maxPoints = mathTotalPoints;
                }
            }
        }
        
        // Зберігаємо quiz-питання (для quiz режиму)
        let quizQuestionsCount = 0;
        if (method === 'quiz' && taskFilePath) {
            try {
                const mdPath = path.join(uploadsDir, taskFilePath);
                const mdContent = fs.readFileSync(mdPath, 'utf8');
                const parsedQuestions = parseQuizMarkdown(mdContent);

                if (parsedQuestions.length > 0) {
                    for (const q of parsedQuestions) {
                        execute(`
                            INSERT INTO quiz_questions (test_id, question_number, section_title, level_title, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_explanation, points, sort_order)
                            VALUES (@testId, @questionNumber, @sectionTitle, @levelTitle, @questionText, @optionA, @optionB, @optionC, @optionD, @correctAnswer, @correctExplanation, @points, @sortOrder)
                        `, {
                            testId,
                            questionNumber: q.question_number,
                            sectionTitle: q.section_title || null,
                            levelTitle: q.level_title || null,
                            questionText: q.question_text,
                            optionA: q.option_a || null,
                            optionB: q.option_b || null,
                            optionC: q.option_c || null,
                            optionD: q.option_d || null,
                            correctAnswer: q.correct_answer || null,
                            correctExplanation: q.correct_explanation || null,
                            points: q.points || 1,
                            sortOrder: q.sort_order
                        });
                        quizQuestionsCount++;
                    }

                    // Оновлюємо max_points
                    const pointsPerQuestion = parsedQuestions.length > 0 ? (parsedQuestions[0].points || 1) : 1;
                    const effectiveCount = (parsedQuizCount && parsedQuizCount > 0 && parsedQuizCount < parsedQuestions.length)
                        ? parsedQuizCount
                        : parsedQuestions.length;
                    const quizTotalPoints = effectiveCount * pointsPerQuestion;
                    execute(`UPDATE tests SET max_points = @pts WHERE id = @id`, { pts: quizTotalPoints, id: testId });
                    maxPoints = quizTotalPoints;
                }

                console.log(`📝 Quiz: розпарсено ${quizQuestionsCount} питань для тесту #${testId}`);
            } catch (parseErr) {
                console.error('Помилка парсингу quiz .md:', parseErr);
            }
        }

        res.status(201).json({
            message: 'Тест створено',
            test: {
                id: testId,
                title,
                type,
                grading_method: method,
                max_points: maxPoints,
                has_task_file: !!taskFilePath,
                has_criteria_file: !!criteriaFilePath,
                criteria_count: criteriaJson ? JSON.parse(criteriaJson).criteria.length : 0,
                math_tasks_count: mathTasksCount,
                quiz_questions_count: quizQuestionsCount,
                quiz_questions_total: quizQuestionsCount,
                quiz_question_count: parsedQuizCount > 0 ? parsedQuizCount : null
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
        
        // Отримуємо мат. завдання
        const mathTasks = queryAll(`
            SELECT * FROM math_tasks WHERE test_id = @testId ORDER BY task_number
        `, { testId });

        // Отримуємо quiz-питання
        const quizQuestions = queryAll(`
            SELECT * FROM quiz_questions WHERE test_id = @testId ORDER BY sort_order
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
                math_tasks: mathTasks,
                quiz_questions: quizQuestions,
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
// QUIZ ПИТАННЯ ДЛЯ СТУДЕНТІВ (без відповідей)
// ============================================
router.get('/:id/quiz-questions', authMiddleware, (req, res) => {
    try {
        const testId = parseInt(req.params.id);
        const studentId = req.user.id;

        const test = queryOne(`
            SELECT t.*, d.name as discipline_name
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id AND t.is_active = 1
        `, { id: testId });

        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }

        // Завантажуємо всі питання
        const allQuestions = queryAll(`
            SELECT id, question_number, section_title, level_title, question_text,
                   option_a, option_b, option_c, option_d, points, sort_order
            FROM quiz_questions
            WHERE test_id = @testId
            ORDER BY sort_order
        `, { testId });

        let questions = allQuestions;
        let maxPoints = test.max_points;
        const quizQuestionCount = test.quiz_question_count;

        // Якщо задано кількість питань і вона менша за загальну — випадковий вибір
        if (quizQuestionCount && quizQuestionCount > 0 && quizQuestionCount < allQuestions.length) {
            // Перевіряємо чи вже є збережений набір для цього студента
            const existingSet = queryOne(`
                SELECT question_ids_json FROM quiz_student_sets
                WHERE test_id = @testId AND student_id = @studentId
            `, { testId, studentId });

            let selectedIds;

            if (existingSet) {
                // Використовуємо збережений набір
                selectedIds = JSON.parse(existingSet.question_ids_json);
            } else {
                // Випадково обираємо N питань
                const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
                selectedIds = shuffled.slice(0, quizQuestionCount).map(q => q.id);

                // Зберігаємо набір
                execute(`
                    INSERT INTO quiz_student_sets (test_id, student_id, question_ids_json)
                    VALUES (@testId, @studentId, @questionIds)
                `, {
                    testId,
                    studentId,
                    questionIds: JSON.stringify(selectedIds)
                });
            }

            // Фільтруємо питання за обраними ID і зберігаємо порядок sort_order
            const idSet = new Set(selectedIds);
            questions = allQuestions.filter(q => idSet.has(q.id));

            // Оновлюємо max_points для підмножини
            const pointsPerQuestion = questions.length > 0 ? questions[0].points : 1;
            maxPoints = questions.length * pointsPerQuestion;
        }

        res.json({
            test_id: testId,
            test_title: test.title,
            max_points: maxPoints,
            total_questions: allQuestions.length,
            selected_questions: questions.length,
            questions
        });

    } catch (err) {
        console.error('Помилка отримання quiz-питань:', err);
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
        
        const gradingMethod = test.grading_method || 'ai';
        
        // Отримуємо критерії (для ai та mixed)
        let criteria = [];
        if (gradingMethod !== 'math' && gradingMethod !== 'quiz') {
            if (test.criteria_json) {
                criteria = JSON.parse(test.criteria_json).criteria || [];
            } else {
                const dbCriteria = queryAll(`SELECT * FROM criteria WHERE test_id = @testId`, { testId });
                criteria = dbCriteria.map(c => ({ name: c.name, maxPoints: c.max_points }));
            }
        }

        // Отримуємо мат. завдання (для math та mixed)
        let mathTasks = [];
        if (gradingMethod === 'math' || gradingMethod === 'mixed') {
            mathTasks = queryAll(`SELECT * FROM math_tasks WHERE test_id = @testId ORDER BY task_number`, { testId });
        }

        // Отримуємо quiz-питання (для quiz)
        let quizQuestions = [];
        if (gradingMethod === 'quiz') {
            quizQuestions = queryAll(`SELECT * FROM quiz_questions WHERE test_id = @testId ORDER BY sort_order`, { testId });
        }

        // Валідація
        if (gradingMethod === 'ai' && criteria.length === 0) {
            return res.status(400).json({ error: 'Тест не має критеріїв оцінювання' });
        }
        if (gradingMethod === 'math' && mathTasks.length === 0) {
            return res.status(400).json({ error: 'Тест не має математичних завдань' });
        }
        if (gradingMethod === 'mixed' && mathTasks.length === 0 && criteria.length === 0) {
            return res.status(400).json({ error: 'Тест не має ні критеріїв, ні мат. завдань' });
        }
        if (gradingMethod === 'quiz' && quizQuestions.length === 0) {
            return res.status(400).json({ error: 'Тест не має quiz-питань' });
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
        if (!apiKey && gradingMethod !== 'math' && gradingMethod !== 'quiz') {
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
                        const ext = path.extname(filePath).toLowerCase();
                        
                        if (ext === '.pdf') {
                            const pdfBuffer = fs.readFileSync(filePath);
                            const pdfData = await pdfParse(pdfBuffer);
                            studentText = pdfData.text;
                        } else if (ext === '.md' || ext === '.txt') {
                            studentText = fs.readFileSync(filePath, 'utf8');
                        } else if (ext === '.docx') {
                            try {
                                const mammoth = require('mammoth');
                                const result = await mammoth.extractRawText({ path: filePath });
                                studentText = result.value;
                            } catch { /* ігноруємо */ }
                        }
                        
                        execute(`UPDATE submissions SET extracted_text = @text WHERE id = @id`, {
                            text: studentText,
                            id: submission.id
                        });
                    }
                }
                
                if (gradingMethod !== 'quiz' && (!studentText || studentText.length < 5)) {
                    errors.push({ student: submission.student_name, error: 'Не вдалося витягти текст' });
                    execute(`UPDATE submissions SET status = 'error' WHERE id = @id`, { id: submission.id });
                    continue;
                }
                
                let totalGrade = 0;
                let feedback = '';
                let gradesArray = [];
                let mathCheckResult = null;
                
                // ========== MATH перевірка ==========
                if ((gradingMethod === 'math' || gradingMethod === 'mixed') && mathTasks.length > 0) {
                    const tasksForChecker = mathTasks.map(t => ({
                        task_number: t.task_number,
                        description: t.description,
                        reference_answer: t.reference_answer,
                        points: t.points,
                        config: t.config_json ? JSON.parse(t.config_json) : {}
                    }));
                    
                    mathCheckResult = gradeStudentWork(tasksForChecker, studentText);
                    
                    // Зберігаємо результати мат. перевірки
                    for (const r of mathCheckResult.results) {
                        const mathTask = mathTasks.find(t => t.task_number === r.taskNumber);
                        if (mathTask) {
                            try {
                                execute(`
                                    INSERT OR REPLACE INTO math_results 
                                    (submission_id, math_task_id, student_answer, is_correct, match_percentage, points_earned, details_json)
                                    VALUES (@subId, @taskId, @answer, @correct, @match, @points, @details)
                                `, {
                                    subId: submission.id,
                                    taskId: mathTask.id,
                                    answer: r.studentAnswer || null,
                                    correct: r.correct ? 1 : 0,
                                    match: r.matchPercentage || 0,
                                    points: r.points,
                                    details: JSON.stringify(r.details || {})
                                });
                            } catch (e) {
                                console.error('Помилка збереження math_result:', e.message);
                            }
                        }
                    }
                    
                    if (gradingMethod === 'math') {
                        // Чисто мат. режим — оцінка тільки за формули
                        totalGrade = mathCheckResult.earnedPoints;
                        feedback = mathCheckResult.results.map(r => 
                            `Завдання ${r.taskNumber}: ${r.correct ? '✅' : '❌'} ${r.message}` + 
                            (r.studentAnswer ? ` (відповідь: ${r.studentAnswer})` : ' (відповідь не знайдена)')
                        ).join('\n');
                        gradesArray = mathCheckResult.results.map(r => ({
                            criterion: `Завдання ${r.taskNumber}: ${r.description}`,
                            points: r.points,
                            max: r.maxPoints
                        }));
                    }
                }
                
                // ========== QUIZ перевірка ==========
                if (gradingMethod === 'quiz') {
                    // Завантажуємо відповіді студента з quiz_answers
                    const studentQuizAnswers = queryAll(`
                        SELECT qa.*, qq.question_number
                        FROM quiz_answers qa
                        JOIN quiz_questions qq ON qa.quiz_question_id = qq.id
                        WHERE qa.submission_id = @subId
                    `, { subId: submission.id });

                    if (studentQuizAnswers.length === 0) {
                        errors.push({ student: submission.student_name, error: 'Немає quiz-відповідей' });
                        execute(`UPDATE submissions SET status = 'error' WHERE id = @id`, { id: submission.id });
                        continue;
                    }

                    // Визначаємо набір питань для цього студента
                    let studentQuestions = quizQuestions;
                    const studentSet = queryOne(`
                        SELECT question_ids_json FROM quiz_student_sets
                        WHERE test_id = @testId AND student_id = @studentId
                    `, { testId, studentId: submission.student_id });

                    if (studentSet) {
                        const selectedIds = new Set(JSON.parse(studentSet.question_ids_json));
                        studentQuestions = quizQuestions.filter(q => selectedIds.has(q.id));
                    }

                    // Формуємо об'єкт відповідей { questionId: 'A' }
                    const answersMap = {};
                    for (const a of studentQuizAnswers) {
                        answersMap[a.quiz_question_id] = a.student_answer;
                    }

                    // Перевіряємо детерміністично (тільки питання з набору студента)
                    const quizResult = gradeQuizAnswers(studentQuestions, answersMap);

                    // Оновлюємо quiz_answers з результатами детерміністичної перевірки
                    for (const r of quizResult.results) {
                        try {
                            execute(`
                                UPDATE quiz_answers
                                SET is_correct = @isCorrect, points_earned = @pointsEarned
                                WHERE submission_id = @subId AND quiz_question_id = @qId
                            `, {
                                isCorrect: r.isCorrect ? 1 : 0,
                                pointsEarned: r.pointsEarned,
                                subId: submission.id,
                                qId: r.questionId
                            });
                        } catch (e) {
                            console.error('Помилка оновлення quiz_answer:', e.message);
                        }
                    }

                    // Якщо є питання без відомої відповіді — AI
                    let aiEarned = 0;
                    if (quizResult.needsAI.length > 0) {
                        const aiPrompt = buildAIPromptForUnanswered(quizResult.needsAI);
                        const apiKey = process.env.ANTHROPIC_API_KEY;

                        if (apiKey && aiPrompt) {
                            try {
                                const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'x-api-key': apiKey,
                                        'anthropic-version': '2023-06-01'
                                    },
                                    body: JSON.stringify({
                                        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
                                        max_tokens: 2000,
                                        messages: [{ role: 'user', content: aiPrompt }]
                                    })
                                });

                                if (aiResponse.ok) {
                                    const aiData = await aiResponse.json();
                                    const aiText = aiData.content?.[0]?.text || '';
                                    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                                    if (jsonMatch) {
                                        const aiResult = JSON.parse(jsonMatch[0]);
                                        for (const ans of (aiResult.answers || [])) {
                                            const needQ = quizResult.needsAI.find(q => q.questionNumber === ans.questionNumber);
                                            if (needQ) {
                                                const pts = ans.isCorrect ? needQ.maxPoints : 0;
                                                aiEarned += pts;
                                                try {
                                                    execute(`
                                                        UPDATE quiz_answers
                                                        SET is_correct = @isCorrect, points_earned = @pts, ai_explanation = @expl
                                                        WHERE submission_id = @subId AND quiz_question_id = @qId
                                                    `, {
                                                        isCorrect: ans.isCorrect ? 1 : 0,
                                                        pts,
                                                        expl: ans.explanation || null,
                                                        subId: submission.id,
                                                        qId: needQ.questionId
                                                    });
                                                } catch (e) { /* ігноруємо */ }
                                            }
                                        }
                                    }
                                }
                            } catch (aiErr) {
                                console.error('Quiz AI помилка:', aiErr.message);
                            }
                        }
                    }

                    totalGrade = quizResult.earnedPoints + aiEarned;

                    // ========== AI оцінка пояснень студента ==========
                    let explanationBonus = 0;
                    const explanationsToCheck = studentQuizAnswers
                        .filter(a => a.student_explanation && a.student_explanation.trim().length > 0)
                        .map(a => {
                            const q = studentQuestions.find(sq => sq.id === a.quiz_question_id);
                            return q ? {
                                questionId: a.quiz_question_id,
                                questionNumber: q.question_number,
                                questionText: q.question_text,
                                optionA: q.option_a,
                                optionB: q.option_b,
                                optionC: q.option_c,
                                optionD: q.option_d,
                                correctAnswer: q.correct_answer || null,
                                studentAnswer: a.student_answer,
                                explanation: a.student_explanation
                            } : null;
                        }).filter(Boolean);

                    if (explanationsToCheck.length > 0 && apiKey) {
                        try {
                            const explQuestionsText = explanationsToCheck.map((e, i) =>
                                `${i + 1}. Тест ${e.questionNumber}: ${e.questionText}\n` +
                                `   A) ${e.optionA || '—'}  B) ${e.optionB || '—'}  C) ${e.optionC || '—'}  D) ${e.optionD || '—'}\n` +
                                (e.correctAnswer ? `   Правильна відповідь: ${e.correctAnswer}\n` : '') +
                                `   Відповідь студента: ${e.studentAnswer}\n` +
                                `   Пояснення студента: "${e.explanation}"`
                            ).join('\n\n');

                            const explPrompt = `Ти — експерт, який оцінює пояснення студентів до тестових відповідей (multiple choice A/B/C/D).

Для кожного питання оціни якість пояснення студента від 0 до 2 додаткових балів:
- 0 — пояснення відсутнє, нерелевантне, або демонструє повне нерозуміння
- 1 — часткове пояснення, має деякі правильні елементи
- 2 — повне, грамотне пояснення з розумінням теми

ПИТАННЯ ТА ПОЯСНЕННЯ:
${explQuestionsText}

Відповідь ТІЛЬКИ у форматі JSON:
{
  "scores": [
    {
      "questionNumber": "N.M",
      "score": 0,
      "feedback": "коротке пояснення оцінки українською"
    }
  ]
}

ВАЖЛИВО:
- Повертай ТІЛЬКИ валідний JSON
- Оцінюй саме якість пояснення, а не правильність відповіді
- Навіть якщо відповідь неправильна, гарне пояснення може отримати бали`;

                            const explResponse = await fetch('https://api.anthropic.com/v1/messages', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-api-key': apiKey,
                                    'anthropic-version': '2023-06-01'
                                },
                                body: JSON.stringify({
                                    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
                                    max_tokens: 2000,
                                    messages: [{ role: 'user', content: explPrompt }]
                                })
                            });

                            if (explResponse.ok) {
                                const explData = await explResponse.json();
                                const explText = explData.content?.[0]?.text || '';
                                const explJsonMatch = explText.match(/\{[\s\S]*\}/);
                                if (explJsonMatch) {
                                    const explResult = JSON.parse(explJsonMatch[0]);
                                    for (const sc of (explResult.scores || [])) {
                                        const expl = explanationsToCheck.find(e => e.questionNumber === sc.questionNumber);
                                        if (expl && typeof sc.score === 'number' && sc.score >= 0 && sc.score <= 2) {
                                            explanationBonus += sc.score;
                                            try {
                                                execute(`
                                                    UPDATE quiz_answers
                                                    SET explanation_score = @score
                                                    WHERE submission_id = @subId AND quiz_question_id = @qId
                                                `, {
                                                    score: sc.score,
                                                    subId: submission.id,
                                                    qId: expl.questionId
                                                });
                                            } catch (e) { /* ігноруємо */ }
                                        }
                                    }
                                }
                            }
                        } catch (explErr) {
                            console.error('Quiz explanation AI помилка:', explErr.message);
                        }
                    }

                    totalGrade += explanationBonus;

                    // Формуємо feedback
                    const totalAnswered = studentQuizAnswers.length;
                    const totalQuestions = studentQuestions.length;
                    const correctCount = quizResult.results.filter(r => r.isCorrect).length;

                    feedback = `Quiz: ${totalGrade}/${quizResult.totalPoints + (explanationsToCheck.length * 2)} балів\n` +
                        `Правильних: ${correctCount}/${totalAnswered} (з ${totalQuestions} питань)`;

                    if (explanationBonus > 0) {
                        feedback += `\nБонус за пояснення: +${explanationBonus} б.`;
                    }

                    if (quizResult.needsAI.length > 0) {
                        feedback += `\n(${quizResult.needsAI.length} питань перевірено AI)`;
                    }

                    gradesArray = quizResult.results.map(r => ({
                        criterion: `Тест ${r.questionNumber}`,
                        points: r.pointsEarned,
                        max: r.maxPoints
                    }));
                }

                // ========== AI перевірка ==========
                if (gradingMethod === 'ai' || gradingMethod === 'mixed') {
                    const apiKey = process.env.ANTHROPIC_API_KEY;
                    if (!apiKey) {
                        if (gradingMethod === 'mixed' && mathCheckResult) {
                            // Якщо API немає, але мат. частина є — зберігаємо тільки мат. результат
                            totalGrade = mathCheckResult.earnedPoints;
                            feedback = 'Мат. перевірка виконана. AI-перевірка недоступна (немає API ключа).\n' +
                                mathCheckResult.results.map(r => `Завдання ${r.taskNumber}: ${r.correct ? '✅' : '❌'} ${r.message}`).join('\n');
                        } else {
                            errors.push({ student: submission.student_name, error: 'API ключ не налаштовано' });
                            execute(`UPDATE submissions SET status = 'error' WHERE id = @id`, { id: submission.id });
                            continue;
                        }
                    } else {
                        // Формуємо промпт
                        let mathContext = '';
                        if (gradingMethod === 'mixed' && mathCheckResult) {
                            mathContext = `\n\nРезультати автоматичної перевірки формул:\n` +
                                mathCheckResult.results.map(r => 
                                    `- Завдання ${r.taskNumber}: ${r.correct ? 'ПРАВИЛЬНО ✅' : 'НЕПРАВИЛЬНО ❌'} ` +
                                    `(збіг ${r.matchPercentage}%, ${r.points}/${r.maxPoints} б.)` +
                                    (r.studentAnswer ? ` [відповідь: ${r.studentAnswer}]` : ' [відповідь не знайдена]')
                                ).join('\n') +
                                `\nАвтоматична оцінка за формули: ${mathCheckResult.earnedPoints}/${mathCheckResult.totalPoints}\n` +
                                `\nВраховуй ці результати при оцінюванні. Формульна перевірка вже проведена автоматично — оціни решту критеріїв (хід розв'язання, оформлення тощо).`;
                        }
                        
                        const prompt = `Ти — викладач, який оцінює студентську роботу.

Дисципліна: ${test.discipline_name}
Назва тесту: ${test.title}
Студент: ${submission.student_name}
${taskText ? `\nУмова завдання:\n"""\n${taskText}\n"""` : ''}${mathContext}

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
                        
                        let aiResult;
                        try {
                            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                            aiResult = JSON.parse(jsonMatch[0]);
                        } catch {
                            aiResult = {
                                total: Math.floor(test.max_points * 0.7),
                                feedback: 'Автоматична оцінка',
                                grades: []
                            };
                        }
                        
                        if (gradingMethod === 'mixed' && mathCheckResult) {
                            // Mixed: AI бали + мат. бали
                            totalGrade = (aiResult.total || 0) + mathCheckResult.earnedPoints;
                            feedback = `🔢 Формули: ${mathCheckResult.earnedPoints}/${mathCheckResult.totalPoints} б.\n` +
                                mathCheckResult.results.map(r => `  ${r.correct ? '✅' : '❌'} Завдання ${r.taskNumber}: ${r.message}`).join('\n') +
                                `\n\n📝 AI-оцінка: ${aiResult.total} б.\n${aiResult.feedback}`;
                            gradesArray = [
                                ...mathCheckResult.results.map(r => ({
                                    criterion: `🔢 Завдання ${r.taskNumber}`,
                                    points: r.points,
                                    max: r.maxPoints
                                })),
                                ...(aiResult.grades || [])
                            ];
                        } else {
                            // Чисто AI
                            totalGrade = aiResult.total;
                            feedback = aiResult.feedback;
                            gradesArray = aiResult.grades || [];
                        }
                    }
                }
                
                // Зберігаємо оцінку
                execute(`
                    UPDATE submissions 
                    SET status = 'graded', total_grade = @grade, ai_feedback = @feedback, graded_at = @gradedAt
                    WHERE id = @id
                `, {
                    grade: totalGrade,
                    feedback: feedback,
                    gradedAt: new Date().toISOString(),
                    id: submission.id
                });
                
                results.push({
                    student: submission.student_name,
                    group: submission.student_group,
                    total: totalGrade,
                    feedback: feedback,
                    grades: gradesArray,
                    mathResult: mathCheckResult ? {
                        earned: mathCheckResult.earnedPoints,
                        total: mathCheckResult.totalPoints,
                        tasks: mathCheckResult.results.map(r => ({
                            num: r.taskNumber,
                            correct: r.correct,
                            studentAnswer: r.studentAnswer
                        }))
                    } : null
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
        const mathHeaders = mathTasks.map(t => `Завд.${t.task_number} (${t.points} б.)`);
        const quizHeaders = quizQuestions.map(q => `Тест ${q.question_number}`);
        const criteriaHeaders = criteria.map(c => c.name);
        excelData.push(['№', 'Студент', 'Група', ...mathHeaders, ...quizHeaders, ...criteriaHeaders, 'Загальна сума', 'Відгук']);

        // Дані
        results.forEach((r, index) => {
            const mathCols = mathTasks.map(t => {
                const taskResult = r.mathResult?.tasks?.find(tr => tr.num === t.task_number);
                return taskResult ? (taskResult.correct ? t.points : 0) : '';
            });
            const quizCols = quizQuestions.map(q => {
                const grade = r.grades?.find(g => g.criterion === `Тест ${q.question_number}`);
                return grade ? grade.points : '';
            });
            const critCols = criteria.map(c => {
                const grade = r.grades?.find(g =>
                    g.criterion?.toLowerCase().includes(c.name.toLowerCase().substring(0, 15))
                );
                return grade?.points ?? '';
            });
            excelData.push([
                index + 1,
                r.student,
                r.group || '',
                ...mathCols,
                ...quizCols,
                ...critCols,
                r.total,
                r.feedback?.substring(0, 500) || ''
            ]);
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
