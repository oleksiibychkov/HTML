/**
 * ============================================
 * МАРШРУТИ ЗДАЧІ РОБІТ
 * ============================================
 * POST /api/submissions - здати роботу (студент)
 * GET  /api/submissions - список робіт
 * GET  /api/submissions/:id - деталі роботи
 * POST /api/submissions/:id/grade - оцінити через BI (викладач)
 * GET  /api/submissions/test/:testId/results - завантажити Excel з результатами
 * GET  /api/submissions/test/:testId/results/view - переглянути результати (JSON)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { queryAll, queryOne, execute } = require('../database/connection');
const { authMiddleware, teacherOnly, studentOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// НАЛАШТУВАННЯ ЗАВАНТАЖЕННЯ ФАЙЛІВ
// ============================================

const uploadsDir = path.resolve(__dirname, '../../uploads');
const resultsDir = path.resolve(__dirname, '../../results');

// Створюємо папки якщо не існують
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
}

// Налаштування multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}_${req.user.id}_${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = ['.pdf', '.md', '.txt', '.doc', '.docx'];
        const allowedMimeTypes = [
            'application/pdf',
            'text/markdown',
            'text/plain',
            'text/x-markdown',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        
        if (allowedExtensions.includes(ext) || allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Дозволені формати: PDF, MD, TXT, DOC, DOCX'), false);
        }
    }
});

// ============================================
// ФУНКЦІЯ ПАРСИНГУ ШАБЛОНУ (як в batch.js)
// ============================================
function parseTemplateColumns(headers) {
    const columns = [];
    
    headers.forEach((header, index) => {
        if (!header) return;
        
        const headerStr = String(header).trim();
        const headerLower = headerStr.toLowerCase();
        
        let infoType = null;
        let columnType = 'info';
        let maxPoints = null;
        
        // Перевіряємо відомі інформаційні поля
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
            infoType = 'total';
        } else if (/відгук|коментар|примітк|feedback/i.test(headerLower)) {
            infoType = 'feedback';
        } else {
            // Перевіряємо чи є бали в назві
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
    
    return columns;
}

// ============================================
// ФУНКЦІЯ ОНОВЛЕННЯ EXCEL РЕЗУЛЬТАТІВ
// ============================================
async function updateResultsExcel(testId, newResult) {
    const test = queryOne(`
        SELECT t.*, d.name as discipline_name 
        FROM tests t 
        JOIN disciplines d ON t.discipline_id = d.id 
        WHERE t.id = @id
    `, { id: testId });
    
    if (!test) return null;
    
    // Парсимо шаблон критеріїв
    let templateData;
    try {
        templateData = JSON.parse(test.criteria_json || '{}');
    } catch {
        templateData = {};
    }
    
    let columns = templateData.columns || [];
    let headers = templateData.headers || [];
    
    // Якщо немає нового формату (columns), але є старий (criteria) - конвертуємо
    if (columns.length === 0 && templateData.criteria && templateData.criteria.length > 0) {
        // Генеруємо структуру зі старого формату
        headers = ['№', 'Студент', 'Група'];
        columns = [
            { index: 0, name: '№', type: 'info', infoType: 'number' },
            { index: 1, name: 'Студент', type: 'info', infoType: 'name' },
            { index: 2, name: 'Група', type: 'info', infoType: 'group' }
        ];
        
        // Додаємо критерії
        templateData.criteria.forEach((crit, i) => {
            const idx = 3 + i;
            headers.push(crit.name);
            columns.push({
                index: idx,
                name: crit.name,
                type: 'criterion',
                maxPoints: crit.maxPoints
            });
        });
        
        // Додаємо суму та відгук
        const sumIdx = headers.length;
        headers.push('Загальна сума');
        columns.push({ index: sumIdx, name: 'Загальна сума', type: 'info', infoType: 'total' });
        
        const fbIdx = headers.length;
        headers.push('Відгук BI');
        columns.push({ index: fbIdx, name: 'Відгук BI', type: 'info', infoType: 'feedback' });
    }
    
    // Якщо все ще немає даних - не створюємо файл
    if (columns.length === 0 || headers.length === 0) {
        console.error('Неможливо створити Excel результатів - немає структури шаблону');
        return null;
    }
    
    // Шлях до файлу результатів для цього тесту
    const resultFileName = `test_${testId}_results.xlsx`;
    const resultPath = path.join(resultsDir, resultFileName);
    
    let excelData = [];
    
    // Якщо файл існує - читаємо його
    if (fs.existsSync(resultPath)) {
        try {
            const workbook = XLSX.readFile(resultPath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            excelData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch (err) {
            console.error('Помилка читання існуючого файлу:', err);
            excelData = [];
        }
    }
    
    // Якщо файл новий або порожній - створюємо заголовки
    if (excelData.length === 0) {
        const resultHeaders = [...headers];
        
        // Перевіряємо чи є стовпці для суми та відгуку
        const hasTotalColumn = columns.some(c => c.infoType === 'total');
        const hasFeedbackColumn = columns.some(c => c.infoType === 'feedback');
        
        if (!hasTotalColumn) resultHeaders.push('Загальна сума');
        if (!hasFeedbackColumn) resultHeaders.push('Відгук BI');
        
        excelData.push(resultHeaders);
    }
    
    // Формуємо новий рядок
    const row = new Array(headers.length).fill('');
    
    columns.forEach(col => {
        if (col.type === 'criterion') {
            const grade = newResult.grades.find(g => {
                if (!g.criterion) return false;
                const gName = g.criterion.toLowerCase().trim();
                const cName = col.name.toLowerCase().trim();
                return gName.includes(cName.substring(0, 20)) || 
                       cName.includes(gName.substring(0, 20)) ||
                       gName === cName;
            });
            row[col.index] = grade?.points ?? '';
        } else if (col.type === 'info') {
            switch (col.infoType) {
                case 'number':
                    row[col.index] = newResult.rowNumber;
                    break;
                case 'total':
                    row[col.index] = newResult.total;
                    break;
                case 'feedback':
                    row[col.index] = newResult.feedback;
                    break;
                default:
                    // Інформація з AI або з бази
                    const infoValue = newResult.info?.[col.name];
                    if (infoValue) {
                        row[col.index] = infoValue;
                    } else if (col.infoType === 'name') {
                        row[col.index] = newResult.studentName || '';
                    } else if (col.infoType === 'group') {
                        row[col.index] = newResult.studentGroup || '';
                    } else if (col.infoType === 'email') {
                        row[col.index] = newResult.studentEmail || '';
                    }
                    break;
            }
        }
    });
    
    // Додаємо суму та відгук якщо немає відповідних стовпців
    const hasTotalColumn = columns.some(c => c.infoType === 'total');
    const hasFeedbackColumn = columns.some(c => c.infoType === 'feedback');
    if (!hasTotalColumn) row.push(newResult.total);
    if (!hasFeedbackColumn) row.push(newResult.feedback);
    
    // Шукаємо чи вже є результат для цього студента (по submission_id)
    let found = false;
    for (let i = 1; i < excelData.length; i++) {
        // Порівнюємо по номеру рядка та імені
        if (excelData[i] && excelData[i][0] === newResult.rowNumber) {
            excelData[i] = row;
            found = true;
            break;
        }
    }
    
    if (!found) {
        excelData.push(row);
    }
    
    // Зберігаємо файл
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    
    // Ширина стовпців
    ws['!cols'] = excelData[0].map(h => {
        const header = String(h || '').toLowerCase();
        if (header.includes('№') || header === 'n') return { width: 5 };
        if (header.includes('відгук') || header.includes('коментар')) return { width: 50 };
        if (header.includes('студент') || header.includes('учасник') || header.includes('пІб')) return { width: 25 };
        if (header.includes('заклад') || header.includes('школа')) return { width: 35 };
        if (header.includes('тема') || header.includes('назва')) return { width: 40 };
        return { width: 15 };
    });
    
    XLSX.utils.book_append_sheet(wb, ws, 'Результати');
    XLSX.writeFile(wb, resultPath);
    
    return resultFileName;
}

// ============================================
// ЗДАТИ РОБОТУ (СТУДЕНТ)
// ============================================
router.post('/', authMiddleware, studentOnly, upload.single('file'), async (req, res) => {
    try {
        const { test_id } = req.body;
        
        if (!test_id) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Вкажіть ID тесту' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Завантажте файл роботи (PDF, MD, TXT, DOC, DOCX)' });
        }
        
        // Перевіряємо тест
        const test = queryOne(`
            SELECT t.*, d.name as discipline_name
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id AND t.is_active = 1
        `, { id: parseInt(test_id) });
        
        if (!test) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        // Перевіряємо час
        const now = new Date();
        const startTime = new Date(test.start_time);
        const endTime = new Date(test.end_time);
        
        if (now < startTime) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Тест ще не розпочався' });
        }
        
        if (now > endTime) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Час здачі тесту вичерпано' });
        }
        
        // Перевіряємо чи вже здавав
        const existing = queryOne(
            'SELECT id FROM submissions WHERE test_id = @testId AND student_id = @studentId',
            { testId: test.id, studentId: req.user.id }
        );
        
        if (existing) {
            fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: 'Ви вже здавали цей тест' });
        }
        
        // Витягуємо текст з файлу (підтримка різних форматів)
        let extractedText = '';
        const ext = path.extname(req.file.originalname).toLowerCase();
        
        try {
            if (ext === '.pdf') {
                const pdfBuffer = fs.readFileSync(req.file.path);
                const pdfData = await pdfParse(pdfBuffer);
                extractedText = pdfData.text;
            } else if (ext === '.md' || ext === '.txt') {
                extractedText = fs.readFileSync(req.file.path, 'utf8');
            } else if (ext === '.docx') {
                const result = await mammoth.extractRawText({ path: req.file.path });
                extractedText = result.value;
            } else if (ext === '.doc') {
                // .doc (старий формат) - mammoth не підтримує, але спробуємо
                try {
                    const result = await mammoth.extractRawText({ path: req.file.path });
                    extractedText = result.value;
                } catch {
                    extractedText = `[Старий формат Word (.doc): ${req.file.originalname}. Рекомендуємо конвертувати в .docx]`;
                }
            } else {
                extractedText = fs.readFileSync(req.file.path, 'utf8');
            }
        } catch (parseErr) {
            console.error('Помилка парсингу файлу:', parseErr);
            extractedText = `[Не вдалося витягти текст з файлу: ${req.file.originalname}]`;
        }
        
        // Зберігаємо здачу
        const result = execute(`
            INSERT INTO submissions (student_id, test_id, original_filename, file_path, extracted_text, status)
            VALUES (@studentId, @testId, @filename, @filepath, @text, 'pending')
        `, {
            studentId: req.user.id,
            testId: test.id,
            filename: req.file.originalname,
            filepath: req.file.filename,
            text: extractedText
        });
        
        const submission = queryOne(
            'SELECT * FROM submissions WHERE id = @id',
            { id: result.lastInsertRowid }
        );
        
        res.status(201).json({
            message: 'Роботу успішно здано! Очікуйте на перевірку.',
            submission: {
                id: submission.id,
                test_id: submission.test_id,
                status: submission.status,
                submitted_at: submission.submitted_at
            }
        });
        
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Помилка здачі роботи:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// СПИСОК РОБІТ
// ============================================
router.get('/', authMiddleware, (req, res) => {
    try {
        let submissions;
        
        if (req.user.role === 'teacher') {
            const { discipline_id, test_id, status } = req.query;
            
            let sql = `
                SELECT s.*, 
                       u.name as student_name, 
                       u.email as student_email,
                       u.student_group,
                       t.title as test_title,
                       t.type as test_type,
                       t.max_points,
                       t.criteria_json,
                       d.name as discipline_name
                FROM submissions s
                JOIN users u ON s.student_id = u.id
                JOIN tests t ON s.test_id = t.id
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE d.teacher_id = @teacherId
            `;
            
            const params = { teacherId: req.user.id };
            
            if (discipline_id) {
                sql += ' AND d.id = @disciplineId';
                params.disciplineId = parseInt(discipline_id);
            }
            
            if (test_id) {
                sql += ' AND t.id = @testId';
                params.testId = parseInt(test_id);
            }
            
            if (status) {
                sql += ' AND s.status = @status';
                params.status = status;
            }
            
            sql += ' ORDER BY s.submitted_at DESC';
            
            submissions = queryAll(sql, params);
            
        } else {
            submissions = queryAll(`
                SELECT s.*, 
                       t.title as test_title,
                       t.type as test_type,
                       t.max_points,
                       d.name as discipline_name
                FROM submissions s
                JOIN tests t ON s.test_id = t.id
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE s.student_id = @studentId
                ORDER BY s.submitted_at DESC
            `, { studentId: req.user.id });
        }
        
        res.json({ submissions });
        
    } catch (err) {
        console.error('Помилка отримання робіт:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ДЕТАЛІ РОБОТИ
// ============================================
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const submissionId = parseInt(req.params.id);
        
        let submission;
        
        if (req.user.role === 'teacher') {
            submission = queryOne(`
                SELECT s.*, 
                       u.name as student_name,
                       u.email as student_email,
                       u.student_group,
                       t.title as test_title,
                       t.type as test_type,
                       t.max_points,
                       t.criteria_json,
                       d.name as discipline_name,
                       d.teacher_id
                FROM submissions s
                JOIN users u ON s.student_id = u.id
                JOIN tests t ON s.test_id = t.id
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE s.id = @id AND d.teacher_id = @teacherId
            `, { id: submissionId, teacherId: req.user.id });
        } else {
            submission = queryOne(`
                SELECT s.*, 
                       t.title as test_title,
                       t.type as test_type,
                       t.max_points,
                       d.name as discipline_name
                FROM submissions s
                JOIN tests t ON s.test_id = t.id
                JOIN disciplines d ON t.discipline_id = d.id
                WHERE s.id = @id AND s.student_id = @studentId
            `, { id: submissionId, studentId: req.user.id });
        }
        
        if (!submission) {
            return res.status(404).json({ error: 'Роботу не знайдено' });
        }
        
        // Парсимо критерії з JSON
        if (submission.criteria_json) {
            try {
                const templateData = JSON.parse(submission.criteria_json);
                const columns = templateData.columns || [];
                submission.criteria = columns.filter(c => c.type === 'criterion');
            } catch {
                submission.criteria = [];
            }
        }
        
        // Отримуємо збережені оцінки
        if (submission.ai_grades_json) {
            try {
                submission.grades = JSON.parse(submission.ai_grades_json);
            } catch {
                submission.grades = [];
            }
        }
        
        // Отримуємо інформацію витягнуту AI
        if (submission.ai_info_json) {
            try {
                submission.extracted_info = JSON.parse(submission.ai_info_json);
            } catch {
                submission.extracted_info = {};
            }
        }
        
        res.json({ submission });
        
    } catch (err) {
        console.error('Помилка отримання роботи:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОЦІНИТИ ЧЕРЕЗ AI (ВИКЛАДАЧ)
// ============================================
router.post('/:id/grade', authMiddleware, teacherOnly, async (req, res) => {
    try {
        const submissionId = parseInt(req.params.id);
        
        // Отримуємо роботу з усією інформацією
        const submission = queryOne(`
            SELECT s.*, 
                   u.name as student_name,
                   u.email as student_email,
                   u.student_group,
                   d.teacher_id, 
                   d.name as discipline_name,
                   t.title as test_title,
                   t.max_points,
                   t.criteria_json,
                   t.criteria_file
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            JOIN tests t ON s.test_id = t.id
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE s.id = @id
        `, { id: submissionId });
        
        if (!submission) {
            return res.status(404).json({ error: 'Роботу не знайдено' });
        }
        
        if (submission.teacher_id !== req.user.id) {
            return res.status(403).json({ error: 'Це не ваша дисципліна' });
        }
        
        if (submission.status === 'graded') {
            return res.status(400).json({ error: 'Робота вже оцінена' });
        }
        
        // Парсимо шаблон критеріїв
        let templateData;
        let columns = [];
        let criteria = [];
        
        if (submission.criteria_json) {
            // Є JSON шаблон
            try {
                templateData = JSON.parse(submission.criteria_json);
            } catch {
                return res.status(400).json({ 
                    error: 'Помилка читання шаблону критеріїв. Перезавантажте Excel файл.',
                    need_template: true
                });
            }
            
            // Перевіряємо наявність нової структури (columns)
            if (templateData.columns && Array.isArray(templateData.columns)) {
                columns = templateData.columns;
                criteria = columns.filter(c => c.type === 'criterion');
            } else if (templateData.criteria && Array.isArray(templateData.criteria)) {
                // Старий формат - конвертуємо
                criteria = templateData.criteria;
                columns = criteria.map((c, i) => ({
                    index: i,
                    name: c.name,
                    type: 'criterion',
                    maxPoints: c.maxPoints
                }));
            }
        } else {
            // Fallback: беремо критерії з таблиці criteria
            const dbCriteria = queryAll(`
                SELECT * FROM criteria WHERE test_id = @testId ORDER BY sort_order
            `, { testId: submission.test_id });
            
            if (dbCriteria.length > 0) {
                criteria = dbCriteria.map((c, i) => ({
                    index: i,
                    name: c.name,
                    type: 'criterion',
                    maxPoints: c.max_points
                }));
                columns = criteria;
            }
        }
        
        if (criteria.length === 0) {
            return res.status(400).json({ 
                error: 'Шаблон критеріїв не налаштовано для цього тесту. Завантажте Excel з критеріями при редагуванні тесту.',
                need_template: true
            });
        }
        
        const infoFields = columns.filter(c => c.type === 'info' && 
            !['number', 'total', 'feedback'].includes(c.infoType));
        
        // Оновлюємо статус
        execute(
            'UPDATE submissions SET status = @status WHERE id = @id',
            { id: submissionId, status: 'grading' }
        );
        
        // Рахуємо максимальну суму балів з критеріїв
        const maxPoints = criteria.reduce((sum, c) => sum + (c.maxPoints || 0), 0);
        
        // Формуємо список інформаційних полів для витягування
        const infoFieldsPrompt = infoFields.map(f => {
            const examples = {
                name: 'ПІБ учасника/студента',
                group: 'клас або група',
                institution: 'назва закладу освіти',
                topic: 'тема або назва роботи',
                supervisor: 'ПІБ керівника',
                email: 'електронна пошта',
                date: 'дата',
                other: 'значення'
            };
            return `"${f.name}": "${examples[f.infoType] || 'значення'}"`;
        });
        
        // Формуємо промпт для AI (як в batch.js)
        const prompt = `Ти — експерт, який аналізує та оцінює роботу.

Дисципліна: ${submission.discipline_name}
Тест: ${submission.test_title}
Студент (з бази): ${submission.student_name}

ТЕКСТ РОБОТИ:
"""
${(submission.extracted_text || '').substring(0, 15000)}
"""

ЗАВДАННЯ:
1. Витягни інформацію про автора та роботу з тексту
2. Оціни роботу за кожним критерієм

ІНФОРМАЦІЙНІ ПОЛЯ (знайди в тексті роботи):
${infoFieldsPrompt.length > 0 ? infoFieldsPrompt.join('\n') : '(немає додаткових полів)'}

КРИТЕРІЇ ОЦІНЮВАННЯ:
${criteria.map((c, i) => `${i + 1}. "${c.name}" — максимум ${c.maxPoints} балів`).join('\n')}

Відповідь ТІЛЬКИ у форматі JSON:
{
  "info": {
${infoFields.map(f => `    "${f.name}": "<знайдене значення або порожній рядок>"`).join(',\n') || ''}
  },
  "grades": [
${criteria.map((c, i) => `    {"criterion": "${c.name}", "points": <0-${c.maxPoints}>}${i < criteria.length - 1 ? ',' : ''}`).join('\n')}
  ],
  "total": <сума балів, максимум ${maxPoints}>,
  "feedback": "<короткий відгук українською, 2-3 речення>"
}

ВАЖЛИВО:
- Повертай ТІЛЬКИ валідний JSON
- Максимальна сума балів: ${maxPoints}
- Оцінюй об'єктивно та справедливо`;

        // Викликаємо Claude API
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            execute(
                'UPDATE submissions SET status = @status WHERE id = @id',
                { id: submissionId, status: 'pending' }
            );
            return res.status(500).json({ error: 'API ключ не налаштовано' });
        }
        
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
            const errorText = await response.text();
            console.error('Claude API помилка:', errorText);
            execute(
                'UPDATE submissions SET status = @status WHERE id = @id',
                { id: submissionId, status: 'error' }
            );
            return res.status(500).json({ error: 'Помилка BI сервісу' });
        }
        
        const aiResponse = await response.json();
        const aiText = aiResponse.content?.[0]?.text || '';
        
        // Парсимо відповідь
        let result;
        try {
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('JSON не знайдено');
            result = JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
            console.error('Помилка парсингу:', parseErr);
            result = {
                info: {},
                total: Math.floor(maxPoints * 0.7),
                feedback: 'Автоматична оцінка (помилка парсингу)',
                grades: criteria.map(c => ({
                    criterion: c.name,
                    points: Math.floor(c.maxPoints * 0.7)
                }))
            };
        }
        
        // Обмежуємо суму максимумом
        const totalGrade = Math.min(result.total || 0, maxPoints);
        
        // Оновлюємо здачу
        execute(`
            UPDATE submissions 
            SET status = 'graded',
                total_grade = @grade,
                ai_feedback = @feedback,
                ai_grades_json = @gradesJson,
                ai_info_json = @infoJson,
                graded_at = datetime('now')
            WHERE id = @id
        `, {
            id: submissionId,
            grade: totalGrade,
            feedback: result.feedback,
            gradesJson: JSON.stringify(result.grades || []),
            infoJson: JSON.stringify(result.info || {})
        });
        
        // Підраховуємо номер рядка для цього студента
        const rowNumber = queryOne(`
            SELECT COUNT(*) as cnt FROM submissions 
            WHERE test_id = @testId AND status = 'graded'
        `, { testId: submission.test_id })?.cnt || 1;
        
        // Оновлюємо Excel з результатами
        await updateResultsExcel(submission.test_id, {
            rowNumber,
            studentName: submission.student_name,
            studentGroup: submission.student_group,
            studentEmail: submission.student_email,
            info: result.info || {},
            grades: result.grades || [],
            total: totalGrade,
            feedback: result.feedback
        });
        
        // Повертаємо результат
        const updated = queryOne('SELECT * FROM submissions WHERE id = @id', { id: submissionId });
        
        res.json({
            message: 'Роботу оцінено',
            submission: {
                ...updated,
                grades: result.grades,
                info: result.info,
                max_points: maxPoints
            }
        });
        
    } catch (err) {
        console.error('Помилка оцінювання:', err);
        
        execute(
            'UPDATE submissions SET status = @status WHERE id = @id',
            { id: parseInt(req.params.id), status: 'error' }
        );
        
        res.status(500).json({ error: 'Помилка сервера при оцінюванні' });
    }
});

// ============================================
// ЗАВАНТАЖИТИ РЕЗУЛЬТАТИ ПО ТЕСТУ (EXCEL)
// ============================================
router.get('/test/:testId/results', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.testId);
        
        // Перевіряємо доступ
        const test = queryOne(`
            SELECT t.*, d.teacher_id, d.name as discipline_name
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        if (test.teacher_id !== req.user.id) {
            return res.status(403).json({ error: 'Це не ваш тест' });
        }
        
        const resultFileName = `test_${testId}_results.xlsx`;
        const resultPath = path.join(resultsDir, resultFileName);
        
        if (!fs.existsSync(resultPath)) {
            return res.status(404).json({ error: 'Файл результатів ще не створено. Оцініть хоча б одну роботу.' });
        }
        
        const downloadName = `Результати_${test.discipline_name}_${test.title}_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.download(resultPath, downloadName);
        
    } catch (err) {
        console.error('Помилка завантаження результатів:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ПЕРЕГЛЯД РЕЗУЛЬТАТІВ ПО ТЕСТУ (JSON)
// ============================================
router.get('/test/:testId/results/view', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.testId);
        
        // Перевіряємо доступ
        const test = queryOne(`
            SELECT t.*, d.teacher_id, d.name as discipline_name
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        if (test.teacher_id !== req.user.id) {
            return res.status(403).json({ error: 'Це не ваш тест' });
        }
        
        // Отримуємо всі оцінені роботи
        const submissions = queryAll(`
            SELECT s.*, u.name as student_name, u.email as student_email, u.student_group
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            WHERE s.test_id = @testId AND s.status = 'graded'
            ORDER BY s.graded_at DESC
        `, { testId });
        
        // Парсимо оцінки
        const results = submissions.map(s => {
            let grades = [];
            let info = {};
            try {
                grades = JSON.parse(s.ai_grades_json || '[]');
                info = JSON.parse(s.ai_info_json || '{}');
            } catch {}
            
            return {
                id: s.id,
                student_name: s.student_name,
                student_email: s.student_email,
                student_group: s.student_group,
                total_grade: s.total_grade,
                feedback: s.ai_feedback,
                grades,
                info,
                graded_at: s.graded_at
            };
        });
        
        // Парсимо критерії
        let criteria = [];
        try {
            const templateData = JSON.parse(test.criteria_json || '{}');
            criteria = (templateData.columns || []).filter(c => c.type === 'criterion');
        } catch {}
        
        res.json({
            test: {
                id: test.id,
                title: test.title,
                discipline_name: test.discipline_name,
                max_points: criteria.reduce((sum, c) => sum + (c.maxPoints || 0), 0)
            },
            criteria,
            results,
            total_graded: results.length
        });
        
    } catch (err) {
        console.error('Помилка перегляду результатів:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗІБРАТИ РЕЗУЛЬТАТИ ВИБРАНИХ ТЕСТІВ В ОДИН ФАЙЛ
// ============================================
router.post('/discipline/:disciplineId/selected-results', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.disciplineId);
        const { testIds } = req.body; // Масив ID обраних тестів
        
        // Перевіряємо права
        const discipline = queryOne(`
            SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId
        `, { id: disciplineId, teacherId: req.user.id });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Якщо не вказані тести - беремо всі
        let testFilterSimple = '';
        let testFilterWithAlias = '';
        if (testIds && testIds.length > 0) {
            const idsStr = testIds.map(id => parseInt(id)).join(',');
            testFilterSimple = `AND id IN (${idsStr})`;
            testFilterWithAlias = `AND t.id IN (${idsStr})`;
        }
        
        // Отримуємо тести
        const tests = queryAll(`
            SELECT * FROM tests WHERE discipline_id = @disciplineId AND is_active = 1 ${testFilterSimple}
        `, { disciplineId });
        
        // Отримуємо оцінені роботи
        const submissions = queryAll(`
            SELECT s.*, 
                   u.name as student_name, 
                   u.email as student_email, 
                   u.student_group,
                   t.title as test_title,
                   t.type as test_type
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            JOIN tests t ON s.test_id = t.id
            WHERE t.discipline_id = @disciplineId AND s.status = 'graded' ${testFilterWithAlias}
            ORDER BY t.title, u.name
        `, { disciplineId });
        
        if (submissions.length === 0) {
            return res.status(404).json({ error: 'Немає оцінених робіт для вибраних тестів' });
        }
        
        // Створюємо Excel
        const wb = XLSX.utils.book_new();
        
        // Загальний лист з усіма результатами
        const allData = [['№', 'Студент', 'Група', 'Email', 'Тест', 'Тип', 'Оцінка', 'Відгук BI', 'Дата оцінювання']];
        
        submissions.forEach((s, idx) => {
            allData.push([
                idx + 1,
                s.student_name,
                s.student_group || '',
                s.student_email || '',
                s.test_title,
                s.test_type === 'lab' ? 'Лабораторна' : s.test_type === 'control' ? 'Контрольна' : 'Іспит',
                s.total_grade,
                s.ai_feedback || '',
                s.graded_at ? new Date(s.graded_at).toLocaleString('uk-UA') : ''
            ]);
        });
        
        const wsAll = XLSX.utils.aoa_to_sheet(allData);
        XLSX.utils.book_append_sheet(wb, wsAll, 'Всі результати');
        
        // Окремі листи для кожного тесту
        tests.forEach(test => {
            const testSubmissions = submissions.filter(s => s.test_id === test.id);
            if (testSubmissions.length === 0) return;
            
            const testData = [['№', 'Студент', 'Група', 'Оцінка', 'Відгук BI']];
            testSubmissions.forEach((s, idx) => {
                testData.push([
                    idx + 1,
                    s.student_name,
                    s.student_group || '',
                    s.total_grade,
                    s.ai_feedback || ''
                ]);
            });
            
            const wsTest = XLSX.utils.aoa_to_sheet(testData);
            const sheetName = test.title.substring(0, 28) + (test.title.length > 28 ? '...' : '');
            XLSX.utils.book_append_sheet(wb, wsTest, sheetName);
        });
        
        // Зберігаємо у буфер
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(discipline.name)}_results.xlsx"`);
        res.send(buffer);
        
    } catch (err) {
        console.error('Помилка формування звіту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗІБРАТИ ВСІ РЕЗУЛЬТАТИ ДИСЦИПЛІНИ В ОДИН ФАЙЛ (старий endpoint для сумісності)
// ============================================
router.get('/discipline/:disciplineId/all-results', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.disciplineId);
        
        // Перевіряємо права
        const discipline = queryOne(`
            SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId
        `, { id: disciplineId, teacherId: req.user.id });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Отримуємо всі тести дисципліни
        const tests = queryAll(`
            SELECT * FROM tests WHERE discipline_id = @disciplineId AND is_active = 1
        `, { disciplineId });
        
        // Отримуємо всі оцінені роботи
        const submissions = queryAll(`
            SELECT s.*, 
                   u.name as student_name, 
                   u.email as student_email, 
                   u.student_group,
                   t.title as test_title,
                   t.type as test_type
            FROM submissions s
            JOIN users u ON s.student_id = u.id
            JOIN tests t ON s.test_id = t.id
            WHERE t.discipline_id = @disciplineId AND s.status = 'graded'
            ORDER BY t.title, u.name
        `, { disciplineId });
        
        if (submissions.length === 0) {
            return res.status(404).json({ error: 'Немає оцінених робіт' });
        }
        
        // Створюємо Excel
        const wb = XLSX.utils.book_new();
        
        // Загальний лист з усіма результатами
        const allData = [['№', 'Студент', 'Група', 'Email', 'Тест', 'Тип', 'Оцінка', 'Відгук BI', 'Дата оцінювання']];
        
        submissions.forEach((s, idx) => {
            allData.push([
                idx + 1,
                s.student_name,
                s.student_group || '',
                s.student_email || '',
                s.test_title,
                s.test_type === 'lab' ? 'Лабораторна' : s.test_type === 'control' ? 'Контрольна' : 'Іспит',
                s.total_grade,
                s.ai_feedback || '',
                s.graded_at ? new Date(s.graded_at).toLocaleString('uk-UA') : ''
            ]);
        });
        
        const wsAll = XLSX.utils.aoa_to_sheet(allData);
        XLSX.utils.book_append_sheet(wb, wsAll, 'Всі результати');
        
        // Окремі листи для кожного тесту
        tests.forEach(test => {
            const testSubmissions = submissions.filter(s => s.test_id === test.id);
            if (testSubmissions.length === 0) return;
            
            const testData = [['№', 'Студент', 'Група', 'Оцінка', 'Відгук BI']];
            testSubmissions.forEach((s, idx) => {
                testData.push([
                    idx + 1,
                    s.student_name,
                    s.student_group || '',
                    s.total_grade,
                    s.ai_feedback || ''
                ]);
            });
            
            const wsTest = XLSX.utils.aoa_to_sheet(testData);
            // Обмежуємо назву листа до 31 символу
            const sheetName = test.title.substring(0, 28) + (test.title.length > 28 ? '...' : '');
            XLSX.utils.book_append_sheet(wb, wsTest, sheetName);
        });
        
        // Зберігаємо у буфер
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(discipline.name)}_all_results.xlsx"`);
        res.send(buffer);
        
    } catch (err) {
        console.error('Помилка формування звіту:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОТРИМАТИ СТАТИСТИКУ РЕЗУЛЬТАТІВ ПО ДИСЦИПЛІНІ
// ============================================
router.get('/discipline/:disciplineId/stats', authMiddleware, teacherOnly, (req, res) => {
    try {
        const disciplineId = parseInt(req.params.disciplineId);
        
        // Перевіряємо права
        const discipline = queryOne(`
            SELECT * FROM disciplines WHERE id = @id AND teacher_id = @teacherId
        `, { id: disciplineId, teacherId: req.user.id });
        
        if (!discipline) {
            return res.status(404).json({ error: 'Дисципліну не знайдено' });
        }
        
        // Статистика по тестах
        const testStats = queryAll(`
            SELECT t.id, t.title, t.type, t.max_points,
                   COUNT(s.id) as total_submissions,
                   SUM(CASE WHEN s.status = 'graded' THEN 1 ELSE 0 END) as graded_count,
                   SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                   AVG(CASE WHEN s.status = 'graded' THEN s.total_grade END) as avg_grade
            FROM tests t
            LEFT JOIN submissions s ON t.id = s.test_id
            WHERE t.discipline_id = @disciplineId AND t.is_active = 1
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `, { disciplineId });
        
        res.json({
            discipline: {
                id: discipline.id,
                name: discipline.name
            },
            tests: testStats.map(t => ({
                ...t,
                avg_grade: t.avg_grade ? Math.round(t.avg_grade * 10) / 10 : null
            }))
        });
        
    } catch (err) {
        console.error('Помилка отримання статистики:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ ОКРЕМУ ЗДАЧУ
// ============================================
router.delete('/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const submissionId = parseInt(req.params.id);
        
        // Перевіряємо права (викладач повинен бути власником дисципліни)
        const submission = queryOne(`
            SELECT s.*, t.discipline_id, d.teacher_id
            FROM submissions s
            JOIN tests t ON s.test_id = t.id
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE s.id = @id
        `, { id: submissionId });
        
        if (!submission) {
            return res.status(404).json({ error: 'Здачу не знайдено' });
        }
        
        if (submission.teacher_id !== req.user.id) {
            return res.status(403).json({ error: 'Немає прав на видалення' });
        }
        
        // Видаляємо файл якщо є
        if (submission.file_path) {
            const filePath = path.join(__dirname, '../../uploads', submission.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Видаляємо з БД
        execute('DELETE FROM submissions WHERE id = @id', { id: submissionId });
        
        res.json({ message: 'Здачу видалено' });
        
    } catch (err) {
        console.error('Помилка видалення:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Обробник помилок multer
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Файл занадто великий (максимум 10MB)' });
        }
        return res.status(400).json({ error: `Помилка завантаження: ${err.message}` });
    }
    if (err.message === 'Дозволені формати: PDF, MD, TXT, DOC, DOCX') {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

module.exports = router;
