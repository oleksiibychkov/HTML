/**
 * ============================================
 * ІНІЦІАЛІЗАЦІЯ БАЗИ ДАНИХ
 * ============================================
 * Запускається один раз для створення таблиць
 * Команда: npm run init-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDatabase, execute, execMultiple, closeDatabase, queryOne } = require('./connection');

async function init() {
    console.log('');
    console.log('🔧 Ініціалізація бази даних TestHub...');
    console.log('');

    // Ініціалізуємо базу
    await initDatabase();

    // Читаємо SQL схему
    const schemaPath = path.join(__dirname, '../../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Виконуємо схему
    try {
        execMultiple(schema);
        console.log('✅ Схему бази даних створено');
    } catch (err) {
        // Ігноруємо помилки "already exists"
        if (!err.message.includes('already exists')) {
            console.error('❌ Помилка схеми:', err.message);
        }
    }

    // ============================================
    // МІГРАЦІЯ: Додаємо нові поля якщо їх немає
    // ============================================
    console.log('');
    console.log('🔄 Перевірка міграцій...');
    
    const migrations = [
        { table: 'submissions', column: 'ai_grades_json', type: 'TEXT' },
        { table: 'submissions', column: 'ai_info_json', type: 'TEXT' },
        { table: 'tests', column: 'criteria_json', type: 'TEXT' },
        { table: 'tests', column: 'criteria_file', type: 'TEXT' }
    ];
    
    for (const m of migrations) {
        try {
            execute(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
            console.log(`   ✅ Додано поле: ${m.table}.${m.column}`);
        } catch (err) {
            // Ігноруємо якщо поле вже існує
            if (!err.message.includes('duplicate column')) {
                // console.log(`   ⚠️  Поле ${m.table}.${m.column} вже існує`);
            }
        }
    }

    // ============================================
    // СТВОРЕННЯ ДЕМО-КОРИСТУВАЧІВ
    // ============================================

    console.log('');
    console.log('👥 Створення демо-користувачів...');

    // Хешуємо паролі (bcryptjs - синхронний)
    const teacherHash = bcrypt.hashSync('teacher123', 10);
    const studentHash = bcrypt.hashSync('student123', 10);

    // Перевіряємо чи викладач вже існує
    const existingTeacher = queryOne('SELECT id FROM users WHERE email = ?', { email: 'teacher@test.com' });
    
    if (!existingTeacher) {
        try {
            execute(`
                INSERT INTO users (id, email, password_hash, name, role)
                VALUES (1, 'teacher@test.com', @hash, 'Іван Петренко', 'teacher')
            `, { hash: teacherHash });
            console.log('   ✅ Викладач: teacher@test.com / teacher123');
        } catch (err) {
            console.log('   ⚠️  Викладач вже існує');
        }
    } else {
        console.log('   ⚠️  Викладач вже існує');
    }

    // Перевіряємо чи студент вже існує
    const existingStudent = queryOne('SELECT id FROM users WHERE email = ?', { email: 'student@test.com' });
    
    if (!existingStudent) {
        try {
            execute(`
                INSERT INTO users (id, email, password_hash, name, role, student_group, course)
                VALUES (2, 'student@test.com', @hash, 'Марія Коваленко', 'student', 'КН-21', 3)
            `, { hash: studentHash });
            console.log('   ✅ Студент: student@test.com / student123');
        } catch (err) {
            console.log('   ⚠️  Студент вже існує');
        }
    } else {
        console.log('   ⚠️  Студент вже існує');
    }

    // ============================================
    // СТВОРЕННЯ ДЕМО-ДИСЦИПЛІНИ
    // ============================================

    console.log('');
    console.log('📚 Створення демо-дисципліни...');

    const existingDiscipline = queryOne('SELECT id FROM disciplines WHERE id = 1');
    
    if (!existingDiscipline) {
        try {
            // Дисципліна
            execute(`
                INSERT INTO disciplines (id, teacher_id, name, description)
                VALUES (1, 1, 'Програмування на Python', 'Основи програмування мовою Python')
            `);
            console.log('   ✅ Дисципліна: Програмування на Python');

            // Тест (лабораторна робота)
            const now = new Date();
            const startTime = new Date(now.getTime() - 3600000).toISOString(); // 1 година тому
            const endTime = new Date(now.getTime() + 86400000 * 7).toISOString(); // через 7 днів

            execute(`
                INSERT INTO tests (id, discipline_id, type, title, description, start_time, end_time, max_points)
                VALUES (1, 1, 'lab', 'Лабораторна робота №1', 'Основи синтаксису Python', @start, @end, 100)
            `, { start: startTime, end: endTime });
            console.log('   ✅ Тест: Лабораторна робота №1');

            // Критерії оцінювання
            const criteria = [
                { name: 'Правильність коду', points: 30, desc: 'Код працює без помилок і виконує поставлене завдання' },
                { name: 'Ефективність алгоритму', points: 25, desc: 'Оптимальне використання ресурсів' },
                { name: 'Коментарі та документація', points: 20, desc: 'Наявність пояснень до коду' },
                { name: 'Стиль коду (PEP8)', points: 15, desc: 'Дотримання стандартів оформлення' },
                { name: 'Обробка помилок', points: 10, desc: 'Коректна обробка виключних ситуацій' }
            ];

            for (let i = 0; i < criteria.length; i++) {
                execute(`
                    INSERT INTO criteria (id, test_id, name, max_points, description, sort_order)
                    VALUES (@id, 1, @name, @points, @desc, @order)
                `, { 
                    id: i + 1, 
                    name: criteria[i].name, 
                    points: criteria[i].points,
                    desc: criteria[i].desc,
                    order: i 
                });
            }
            console.log('   ✅ Критерії оцінювання: 5 шт.');

        } catch (err) {
            console.error('   ❌ Помилка:', err.message);
        }
    } else {
        console.log('   ⚠️  Демо-дисципліна вже існує');
    }

    // ============================================
    // ФІНАЛ
    // ============================================

    console.log('');
    console.log('════════════════════════════════════════════');
    console.log('✅ База даних успішно ініціалізована!');
    console.log('════════════════════════════════════════════');
    console.log('');
    console.log('Тепер можеш запустити сервер:');
    console.log('  npm run dev');
    console.log('');

    // Закриваємо з'єднання
    closeDatabase();
}

// Запускаємо
init().catch(err => {
    console.error('Критична помилка:', err);
    process.exit(1);
});
