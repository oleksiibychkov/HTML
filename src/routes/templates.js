/**
 * ============================================
 * МАРШРУТИ ДЛЯ ШАБЛОНІВ
 * ============================================
 * GET /api/templates              - список доступних шаблонів
 * GET /api/templates/:filename    - завантажити шаблон
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');

// Метадані шаблонів
const TEMPLATE_META = {
    'template_math_tasks.xlsx': {
        name: 'Математичні завдання',
        description: 'Шаблон з умовами та еталонними формулами-відповідями',
        category: 'math',
        icon: '🔢',
        forRole: 'teacher'
    },
    'template_criteria_math.xlsx': {
        name: 'Критерії: Математика',
        description: 'Формули + хід розв\'язання + оформлення (режим Гібрид)',
        category: 'criteria',
        icon: '📐',
        forRole: 'teacher'
    },
    'template_criteria_programming.xlsx': {
        name: 'Критерії: Програмування',
        description: 'Код, алгоритми, стиль, документація, обробка помилок',
        category: 'criteria',
        icon: '💻',
        forRole: 'teacher'
    },
    'template_criteria_databases.xlsx': {
        name: 'Критерії: Бази даних',
        description: 'SQL, нормалізація, проєктування схеми, оптимізація',
        category: 'criteria',
        icon: '🗄️',
        forRole: 'teacher'
    },
    'template_criteria_humanities.xlsx': {
        name: 'Критерії: Гуманітарні',
        description: 'Зміст, аргументація, джерела, грамотність, оригінальність',
        category: 'criteria',
        icon: '📖',
        forRole: 'teacher'
    },
    'template_student_answers.md': {
        name: 'Зразок відповідей студента',
        description: 'Приклад .md файлу з відповідями на математичний тест',
        category: 'student',
        icon: '📝',
        forRole: 'all'
    }
};

// ============================================
// СПИСОК ШАБЛОНІВ
// ============================================
router.get('/', authMiddleware, (req, res) => {
    try {
        if (!fs.existsSync(TEMPLATES_DIR)) {
            return res.json({ templates: [] });
        }

        const files = fs.readdirSync(TEMPLATES_DIR);
        const templates = files
            .filter(f => TEMPLATE_META[f])
            .map(filename => ({
                filename,
                ...TEMPLATE_META[filename],
                size: fs.statSync(path.join(TEMPLATES_DIR, filename)).size,
                download_url: `/api/templates/${filename}`
            }))
            .filter(t => t.forRole === 'all' || t.forRole === req.user.role);

        res.json({ templates });

    } catch (err) {
        console.error('Помилка отримання шаблонів:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ============================================
// ЗАВАНТАЖИТИ ШАБЛОН
// ============================================
router.get('/:filename', authMiddleware, (req, res) => {
    try {
        const filename = req.params.filename;
        
        // Захист від path traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Невірне ім\'я файлу' });
        }

        const filePath = path.join(TEMPLATES_DIR, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        const meta = TEMPLATE_META[filename];
        const downloadName = meta ? `TestHub_${meta.name.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_\s-]/g, '')}.${filename.split('.').pop()}` : filename;

        res.download(filePath, downloadName);

    } catch (err) {
        console.error('Помилка завантаження шаблону:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;
