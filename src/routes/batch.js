/**
 * ============================================
 * МАРШРУТИ МАСОВОГО ОЦІНЮВАННЯ
 * ============================================
 * POST /api/batch/upload-template - завантажити Excel шаблон
 * POST /api/batch/grade - оцінити папку з роботами
 * GET  /api/batch/download/:id - завантажити результати
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { queryAll, queryOne, execute } = require('../database/connection');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

// Папки для файлів
const uploadsDir = path.resolve(__dirname, '../../uploads');
const batchDir = path.resolve(__dirname, '../../uploads/batch');
const resultsDir = path.resolve(__dirname, '../../uploads/results');

// Створюємо папки
[uploadsDir, batchDir, resultsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Налаштування multer для множинного завантаження
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, batchDir);
    },
    filename: (req, file, cb) => {
        // Декодуємо ім'я файлу з UTF-8
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uniqueName = `${Date.now()}_${originalName}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowed = ['.pdf', '.xlsx', '.xls', '.doc', '.docx', '.txt', '.md'];
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Непідтримуваний формат: ${ext}`), false);
        }
    }
});

// ============================================
// ЗАВАНТАЖИТИ ШАБЛОН КРИТЕРІЇВ (EXCEL)
// ============================================
router.post('/upload-template', authMiddleware, teacherOnly, upload.single('template'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Завантажте Excel файл з критеріями' });
        }

        const { test_id } = req.body;
        
        // Читаємо Excel
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (data.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Excel файл порожній' });
        }
        
        // Перший рядок - заголовки
        const headers = data[0].map(h => h ? String(h).trim() : '');
        
        // Аналізуємо кожен стовпець
        const columns = [];
        
        headers.forEach((header, index) => {
            if (!header) return;
            
            const headerLower = header.toLowerCase();
            
            // СПОЧАТКУ перевіряємо спеціальні інформаційні поля
            // (навіть якщо вони мають бали в назві, як "Загальна сума – 20 б.")
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
                // Це поле для суми - НЕ критерій!
                infoType = 'total';
            } else if (/відгук|коментар|примітк|feedback/i.test(headerLower)) {
                infoType = 'feedback';
            } else {
                // Не розпізнане як інформаційне поле
                // Перевіряємо чи є бали в назві (тоді це критерій)
                const pointsMatch = header.match(/[-–—]\s*(\d+)\s*б/i) || 
                                   header.match(/(\d+)\s*бал/i) ||
                                   header.match(/макс\.?\s*(\d+)/i) ||
                                   header.match(/\((\d+)\s*б\.?\)/i);
                
                if (pointsMatch) {
                    columnType = 'criterion';
                    maxPoints = parseInt(pointsMatch[1]);
                } else {
                    // Невідоме поле без балів - вважаємо інформаційним
                    infoType = 'other';
                }
            }
            
            columns.push({
                index,
                name: header,
                type: columnType,
                infoType,
                maxPoints
            });
        });
        
        // Розділяємо на критерії та інформаційні поля
        const criteria = columns.filter(c => c.type === 'criterion');
        const infoFields = columns.filter(c => c.type === 'info');
        
        if (criteria.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'Не знайдено критеріїв оцінювання. Критерії повинні містити бали в назві (наприклад: "Актуальність теми – 5 б.")' 
            });
        }
        
        // Зберігаємо інформацію про шаблон
        const templateInfo = {
            file: req.file.filename,
            originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
            headers,
            columns,        // ВСІ стовпці з типами
            criteria,       // Тільки критерії
            infoFields,     // Тільки інформаційні поля
            uploadedAt: new Date().toISOString()
        };
        
        // Якщо вказано test_id - прив'язуємо до тесту
        if (test_id) {
            execute(`
                UPDATE tests 
                SET template_file = @template 
                WHERE id = @testId
            `, { 
                template: JSON.stringify(templateInfo),
                testId: parseInt(test_id)
            });
        }
        
        res.json({
            message: 'Шаблон завантажено',
            template: templateInfo,
            parsed: {
                totalColumns: columns.length,
                infoFields: infoFields.map(f => f.name),
                criteria: criteria.map(c => `${c.name} (${c.maxPoints} б.)`),
                totalPoints: criteria.reduce((sum, c) => sum + c.maxPoints, 0)
            }
        });
        
    } catch (err) {
        console.error('Помилка завантаження шаблону:', err);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// МАСОВЕ ОЦІНЮВАННЯ РОБІТ
// ============================================
router.post('/grade', authMiddleware, teacherOnly, upload.array('files', 100), async (req, res) => {
    const uploadedFiles = req.files || [];
    
    try {
        const { template, test_id, discipline_name, test_name } = req.body;
        
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'Завантажте файли робіт студентів' });
        }
        
        // Парсимо шаблон
        let templateData;
        try {
            templateData = JSON.parse(template);
        } catch {
            return res.status(400).json({ error: 'Невірний формат шаблону критеріїв' });
        }
        
        const columns = templateData.columns || [];
        const criteria = columns.filter(c => c.type === 'criterion');
        const infoFields = columns.filter(c => c.type === 'info');
        
        if (criteria.length === 0) {
            return res.status(400).json({ error: 'Шаблон не містить критеріїв' });
        }
        
        // Результати оцінювання
        const results = [];
        const errors = [];
        
        // API ключ
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API ключ не налаштовано' });
        }
        
        // Оцінюємо кожен файл
        for (const file of uploadedFiles) {
            const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const fileNameWithoutExt = path.basename(originalName, path.extname(originalName));
            
            try {
                // Витягуємо текст з файлу
                let content = '';
                const ext = path.extname(file.originalname).toLowerCase();
                
                if (ext === '.pdf') {
                    const pdfBuffer = fs.readFileSync(file.path);
                    const pdfData = await pdfParse(pdfBuffer);
                    content = pdfData.text;
                } else if (ext === '.txt' || ext === '.md') {
                    content = fs.readFileSync(file.path, 'utf8');
                } else if (ext === '.docx') {
                    const result = await mammoth.extractRawText({ path: file.path });
                    content = result.value;
                } else if (ext === '.doc') {
                    // Старий формат Word - спробуємо mammoth
                    try {
                        const result = await mammoth.extractRawText({ path: file.path });
                        content = result.value;
                    } catch {
                        content = `[Старий формат Word (.doc): ${originalName}]`;
                    }
                }
                
                if (!content || content.length < 10) {
                    errors.push({ file: originalName, error: 'Не вдалося витягти текст' });
                    continue;
                }
                
                // Формуємо список інформаційних полів для витягування
                const infoFieldsPrompt = infoFields
                    .filter(f => f.infoType && !['number', 'total', 'feedback'].includes(f.infoType))
                    .map(f => {
                        const examples = {
                            name: 'ПІБ учасника/студента',
                            group: 'клас або група',
                            institution: 'назва закладу освіти (школа, ліцей, університет)',
                            topic: 'тема або назва роботи',
                            supervisor: 'ПІБ керівника/викладача',
                            email: 'електронна пошта',
                            date: 'дата',
                            other: 'відповідне значення'
                        };
                        return `"${f.name}": "${examples[f.infoType] || 'значення'}"`;
                    });
                
                // Формуємо промпт для AI
                const prompt = `Ти — експерт, який аналізує та оцінює роботу.

Дисципліна: ${discipline_name || 'Не вказано'}
Назва: ${test_name || 'Робота'}
Файл: ${originalName}

ТЕКСТ РОБОТИ:
"""
${content.substring(0, 15000)}
"""

ЗАВДАННЯ:
1. Витягни інформацію про автора та роботу
2. Оціни роботу за кожним критерієм

ІНФОРМАЦІЙНІ ПОЛЯ (знайди в тексті роботи):
${infoFieldsPrompt.length > 0 ? infoFieldsPrompt.join('\n') : '(немає)'}

КРИТЕРІЇ ОЦІНЮВАННЯ:
${criteria.map((c, i) => `${i + 1}. "${c.name}" — максимум ${c.maxPoints} балів`).join('\n')}

Відповідь ТІЛЬКИ у форматі JSON:
{
  "info": {
${infoFields.filter(f => f.infoType && !['number', 'total', 'feedback'].includes(f.infoType))
    .map(f => `    "${f.name}": "<знайдене значення або порожній рядок>"`).join(',\n')}
  },
  "grades": [
${criteria.map((c, i) => `    {"criterion": "${c.name}", "points": <0-${c.maxPoints}>}${i < criteria.length - 1 ? ',' : ''}`).join('\n')}
  ],
  "total": <сума балів>,
  "feedback": "<короткий відгук українською, 2-3 речення>"
}

ВАЖЛИВО:
- Повертай ТІЛЬКИ валідний JSON
- Шукай інформацію про автора на початку або в кінці документа
- Якщо інформацію не знайдено — залиш порожній рядок ""
- Оцінюй об'єктивно та справедливо`;

                // Викликаємо Claude API
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
                    errors.push({ file: originalName, error: 'Помилка BI сервісу' });
                    continue;
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
                    // Fallback
                    result = {
                        info: {},
                        total: Math.floor(criteria.reduce((sum, c) => sum + c.maxPoints, 0) * 0.7),
                        feedback: 'Автоматична оцінка (помилка парсингу)',
                        grades: criteria.map(c => ({
                            criterion: c.name,
                            points: Math.floor(c.maxPoints * 0.7)
                        }))
                    };
                }
                
                results.push({
                    file: originalName,
                    fileNameWithoutExt,
                    info: result.info || {},
                    grades: result.grades || [],
                    total: result.total,
                    feedback: result.feedback
                });
                
            } catch (fileErr) {
                console.error(`Помилка обробки ${originalName}:`, fileErr);
                errors.push({ file: originalName, error: fileErr.message });
            }
        }
        
        // ============================================
        // ФОРМУЄМО EXCEL З РЕЗУЛЬТАТАМИ
        // ============================================
        const wb = XLSX.utils.book_new();
        const excelData = [];
        
        // Заголовки - використовуємо оригінальні з шаблону
        const headers = templateData.headers || [];
        
        // Перевіряємо чи є стовпець для суми та відгуку
        const hasTotalColumn = columns.some(c => c.infoType === 'total');
        const hasFeedbackColumn = columns.some(c => c.infoType === 'feedback');
        
        // Додаємо заголовки
        const resultHeaders = [...headers];
        if (!hasTotalColumn) resultHeaders.push('Загальна сума');
        if (!hasFeedbackColumn) resultHeaders.push('Відгук BI');
        excelData.push(resultHeaders);
        
        // Заповнюємо дані
        results.forEach((r, rowIndex) => {
            const row = new Array(headers.length).fill('');
            
            // Проходимо по кожному стовпцю
            columns.forEach(col => {
                if (col.type === 'criterion') {
                    // Критерій - шукаємо бал
                    const grade = r.grades.find(g => {
                        if (!g.criterion) return false;
                        // Порівнюємо назви (можуть бути невеликі відмінності)
                        const gName = g.criterion.toLowerCase().trim();
                        const cName = col.name.toLowerCase().trim();
                        return gName.includes(cName.substring(0, 20)) || 
                               cName.includes(gName.substring(0, 20)) ||
                               gName === cName;
                    });
                    row[col.index] = grade?.points ?? '';
                    
                } else if (col.type === 'info') {
                    // Інформаційне поле
                    switch (col.infoType) {
                        case 'number':
                            row[col.index] = rowIndex + 1;
                            break;
                        case 'total':
                            row[col.index] = r.total;
                            break;
                        case 'feedback':
                            row[col.index] = r.feedback;
                            break;
                        default:
                            // Шукаємо в info від AI
                            const infoValue = r.info?.[col.name];
                            if (infoValue) {
                                row[col.index] = infoValue;
                            } else {
                                // Fallback - ім'я файлу для поля "name"
                                if (col.infoType === 'name' && !infoValue) {
                                    row[col.index] = r.fileNameWithoutExt;
                                }
                            }
                            break;
                    }
                }
            });
            
            // Додаємо суму та відгук якщо немає відповідних стовпців
            if (!hasTotalColumn) row.push(r.total);
            if (!hasFeedbackColumn) row.push(r.feedback);
            
            excelData.push(row);
        });
        
        // Додаємо помилки
        if (errors.length > 0) {
            excelData.push([]);
            excelData.push(['ПОМИЛКИ:']);
            errors.forEach(e => {
                excelData.push(['', e.file, e.error]);
            });
        }
        
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        
        // Ширина стовпців
        ws['!cols'] = resultHeaders.map(h => {
            const header = String(h || '').toLowerCase();
            if (header.includes('№') || header === 'n') return { width: 5 };
            if (header.includes('відгук') || header.includes('коментар')) return { width: 50 };
            if (header.includes('студент') || header.includes('учасник') || header.includes('пІб')) return { width: 25 };
            if (header.includes('заклад') || header.includes('школа')) return { width: 35 };
            if (header.includes('тема') || header.includes('назва')) return { width: 40 };
            if (header.includes('керівник')) return { width: 25 };
            return { width: 15 };
        });
        
        XLSX.utils.book_append_sheet(wb, ws, 'Результати');
        
        // Зберігаємо файл
        const resultFileName = `results_${Date.now()}.xlsx`;
        const resultPath = path.join(resultsDir, resultFileName);
        XLSX.writeFile(wb, resultPath);
        
        // Зберігаємо в БД
        try {
            execute(`
                INSERT INTO batch_results (teacher_id, discipline_name, test_name, result_file, works_count, success_count, error_count)
                VALUES (@teacherId, @disciplineName, @testName, @resultFile, @worksCount, @successCount, @errorCount)
            `, {
                teacherId: req.user.id,
                disciplineName: discipline_name || '',
                testName: test_name || '',
                resultFile: resultFileName,
                worksCount: uploadedFiles.length,
                successCount: results.length,
                errorCount: errors.length
            });
            console.log('📊 Результати batch-оцінювання збережено в БД');
        } catch (dbErr) {
            console.error('Помилка збереження в БД:', dbErr);
        }
        
        // Видаляємо завантажені файли
        uploadedFiles.forEach(f => {
            if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        
        res.json({
            message: `Оцінено ${results.length} робіт`,
            success: results.length,
            errors: errors.length,
            results,
            downloadUrl: `/api/batch/download/${resultFileName}`
        });
        
    } catch (err) {
        console.error('Помилка масового оцінювання:', err);
        // Видаляємо файли при помилці
        uploadedFiles.forEach(f => {
            if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗАВАНТАЖИТИ РЕЗУЛЬТАТИ
// ============================================
router.get('/download/:filename', authMiddleware, teacherOnly, (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(resultsDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не знайдено' });
        }
        
        res.download(filePath, `Результати_${new Date().toISOString().split('T')[0]}.xlsx`);
        
    } catch (err) {
        console.error('Помилка завантаження:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ОТРИМАТИ ШАБЛОН КРИТЕРІЇВ ДЛЯ ТЕСТУ
// ============================================
router.get('/template/:testId', authMiddleware, teacherOnly, (req, res) => {
    try {
        const testId = parseInt(req.params.testId);
        
        const test = queryOne(`
            SELECT t.*, d.teacher_id 
            FROM tests t
            JOIN disciplines d ON t.discipline_id = d.id
            WHERE t.id = @id
        `, { id: testId });
        
        if (!test || test.teacher_id !== req.user.id) {
            return res.status(404).json({ error: 'Тест не знайдено' });
        }
        
        if (!test.template_file) {
            return res.status(404).json({ error: 'Шаблон не завантажено' });
        }
        
        let template;
        try {
            template = JSON.parse(test.template_file);
        } catch {
            return res.status(500).json({ error: 'Помилка читання шаблону' });
        }
        
        res.json({ template });
        
    } catch (err) {
        console.error('Помилка отримання шаблону:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// СПИСОК РЕЗУЛЬТАТІВ МАСОВОГО ОЦІНЮВАННЯ
// ============================================
router.get('/results-list', authMiddleware, teacherOnly, (req, res) => {
    try {
        const results = queryAll(`
            SELECT id, discipline_name, test_name, result_file, works_count, 
                   success_count, error_count, created_at
            FROM batch_results
            WHERE teacher_id = @teacherId
            ORDER BY created_at DESC
        `, { teacherId: req.user.id });
        
        res.json({ 
            results: results.map(r => ({
                id: r.id,
                name: r.test_name ? `${r.discipline_name} - ${r.test_name}` : r.discipline_name || 'Без назви',
                discipline: r.discipline_name,
                test: r.test_name,
                file: r.result_file,
                count: r.works_count,
                success: r.success_count,
                errors: r.error_count,
                date: new Date(r.created_at).toLocaleString('uk-UA')
            }))
        });
        
    } catch (err) {
        console.error('Помилка отримання списку:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ВИДАЛИТИ РЕЗУЛЬТАТ МАСОВОГО ОЦІНЮВАННЯ
// ============================================
router.delete('/results/:id', authMiddleware, teacherOnly, (req, res) => {
    try {
        const resultId = parseInt(req.params.id);
        
        // Перевіряємо права
        const result = queryOne(`
            SELECT * FROM batch_results WHERE id = @id AND teacher_id = @teacherId
        `, { id: resultId, teacherId: req.user.id });
        
        if (!result) {
            return res.status(404).json({ error: 'Результат не знайдено' });
        }
        
        // Видаляємо файл
        const filePath = path.join(resultsDir, result.result_file);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        // Видаляємо з БД
        execute('DELETE FROM batch_results WHERE id = @id', { id: resultId });
        
        res.json({ message: 'Результат видалено' });
        
    } catch (err) {
        console.error('Помилка видалення:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
