-- ============================================
-- СХЕМА БАЗИ ДАНИХ: Система тестування TestHub
-- ============================================
-- SQLite не потребує CREATE DATABASE - база створюється автоматично
-- Цей файл описує структуру всіх таблиць

-- ============================================
-- ТАБЛИЦЯ: users (Користувачі)
-- ============================================
-- Зберігає всіх користувачів: викладачів і студентів
CREATE TABLE IF NOT EXISTS users (
    -- id - унікальний ідентифікатор (PRIMARY KEY)
    -- INTEGER PRIMARY KEY в SQLite = автоінкремент
    id INTEGER PRIMARY KEY,
    
    -- Email для входу (унікальний, не може бути пустим)
    email TEXT NOT NULL UNIQUE,
    
    -- Хешований пароль (ніколи не зберігаємо відкритим текстом!)
    password_hash TEXT NOT NULL,
    
    -- Повне ім'я користувача
    name TEXT NOT NULL,
    
    -- Роль: 'teacher' або 'student'
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    
    -- Поля тільки для студентів (можуть бути NULL для викладачів)
    student_group TEXT,      -- Група (КН-21, ПЗ-32, тощо)
    course INTEGER,          -- Курс (1-6)
    
    -- Статус акаунту
    is_active INTEGER DEFAULT 1,  -- 1 = активний, 0 = заблокований
    
    -- Коли створено акаунт
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ТАБЛИЦЯ: disciplines (Дисципліни)
-- ============================================
-- Навчальні предмети, які веде викладач
CREATE TABLE IF NOT EXISTS disciplines (
    id INTEGER PRIMARY KEY,
    
    -- Хто створив дисципліну (зв'язок з users)
    teacher_id INTEGER NOT NULL,
    
    -- Назва предмету
    name TEXT NOT NULL,
    
    -- Опис (необов'язково)
    description TEXT,
    
    -- Чи активна дисципліна
    is_active INTEGER DEFAULT 1,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- FOREIGN KEY - зв'язок з таблицею users
    -- ON DELETE CASCADE означає: якщо видалити викладача, видаляться його дисципліни
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- ТАБЛИЦЯ: tests (Тести)
-- ============================================
-- Лабораторні, контрольні, іспити в межах дисципліни
CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY,
    
    -- До якої дисципліни належить
    discipline_id INTEGER NOT NULL,
    
    -- Тип тесту
    type TEXT NOT NULL CHECK (type IN ('lab', 'control', 'exam')),
    
    -- Назва (наприклад: "Лабораторна робота №1")
    title TEXT NOT NULL,
    
    -- Опис завдання
    description TEXT,
    
    -- PDF файл із завданням (шлях до файлу)
    task_file TEXT,
    
    -- Excel файл із критеріями (шлях до файлу)
    criteria_file TEXT,
    
    -- Критерії в JSON форматі (парсяться з Excel)
    criteria_json TEXT,
    
    -- Час початку та закінчення здачі
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    
    -- Максимальна кількість балів (рахується автоматично з критеріїв)
    max_points INTEGER DEFAULT 100,
    
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (discipline_id) REFERENCES disciplines(id) ON DELETE CASCADE
);

-- ============================================
-- ТАБЛИЦЯ: criteria (Критерії оцінювання)
-- ============================================
-- Кожен тест має свої критерії з балами
CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY,
    
    -- До якого тесту належить критерій
    test_id INTEGER NOT NULL,
    
    -- Назва критерію (наприклад: "Правильність коду")
    name TEXT NOT NULL,
    
    -- Максимальна кількість балів за цей критерій
    max_points INTEGER NOT NULL,
    
    -- Опис що саме оцінюється (для AI)
    description TEXT,
    
    -- Порядок відображення
    sort_order INTEGER DEFAULT 0,
    
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

-- ============================================
-- ТАБЛИЦЯ: submissions (Здані роботи)
-- ============================================
-- Роботи, які здали студенти
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY,
    
    -- Хто здав
    student_id INTEGER NOT NULL,
    
    -- На який тест
    test_id INTEGER NOT NULL,
    
    -- Оригінальна назва файлу
    original_filename TEXT NOT NULL,
    
    -- Шлях до збереженого файлу на сервері
    file_path TEXT NOT NULL,
    
    -- Витягнутий текст з PDF (для AI)
    extracted_text TEXT,
    
    -- Коли здано
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Статус: 'pending', 'grading', 'graded', 'error'
    status TEXT DEFAULT 'pending',
    
    -- Загальна оцінка (після перевірки AI)
    total_grade INTEGER,
    
    -- Текстовий відгук від AI
    ai_feedback TEXT,
    
    -- Оцінки по критеріях (JSON)
    ai_grades_json TEXT,
    
    -- Інформація витягнута з роботи (JSON: ПІБ, клас, заклад, тема тощо)
    ai_info_json TEXT,
    
    -- Коли оцінено
    graded_at DATETIME,
    
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
    
    -- Студент може здати тест тільки один раз
    UNIQUE(student_id, test_id)
);

-- ============================================
-- ТАБЛИЦЯ: submission_grades (Оцінки по критеріях)
-- ============================================
-- Детальні оцінки за кожним критерієм
CREATE TABLE IF NOT EXISTS submission_grades (
    id INTEGER PRIMARY KEY,
    
    -- До якої здачі належить
    submission_id INTEGER NOT NULL,
    
    -- За який критерій
    criterion_id INTEGER NOT NULL,
    
    -- Отримані бали
    points INTEGER NOT NULL,
    
    -- Коментар AI до цього критерію
    comment TEXT,
    
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (criterion_id) REFERENCES criteria(id) ON DELETE CASCADE,
    
    -- Один критерій оцінюється один раз для кожної здачі
    UNIQUE(submission_id, criterion_id)
);

-- ============================================
-- ТАБЛИЦЯ: sessions (Сесії авторизації)
-- ============================================
-- Для відстеження хто залогінений
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    
    user_id INTEGER NOT NULL,
    
    -- Токен сесії (випадковий рядок)
    token TEXT NOT NULL UNIQUE,
    
    -- Коли закінчується сесія
    expires_at DATETIME NOT NULL,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- ІНДЕКСИ (для швидкого пошуку)
-- ============================================
-- Індекс - це як зміст у книзі, дозволяє швидко знаходити дані

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_disciplines_teacher ON disciplines(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tests_discipline ON tests(discipline_id);
CREATE INDEX IF NOT EXISTS idx_criteria_test ON criteria(test_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_test ON submissions(test_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ============================================
-- ТАБЛИЦЯ: batch_results (Результати масового оцінювання)
-- ============================================
-- Зберігає результати batch-оцінювання для постійного доступу
CREATE TABLE IF NOT EXISTS batch_results (
    id INTEGER PRIMARY KEY,
    
    -- Хто проводив оцінювання
    teacher_id INTEGER NOT NULL,
    
    -- Назва дисципліни/тесту (введена викладачем)
    discipline_name TEXT,
    test_name TEXT,
    
    -- Шлях до Excel файлу з результатами
    result_file TEXT NOT NULL,
    
    -- Шлях до Excel шаблону критеріїв
    template_file TEXT,
    
    -- Кількість оцінених робіт
    works_count INTEGER DEFAULT 0,
    
    -- Успішних / з помилками
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    
    -- Коли створено
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_batch_results_teacher ON batch_results(teacher_id);

-- ============================================
-- ДЕМО-ДАНІ створюються в init.js з правильними bcrypt хешами
-- ============================================

-- ============================================
-- ТАБЛИЦЯ: resubmit_requests (Запити на повторну здачу)
-- ============================================
CREATE TABLE IF NOT EXISTS resubmit_requests (
    id INTEGER PRIMARY KEY,
    submission_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    teacher_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resubmit_requests_submission ON resubmit_requests(submission_id);
CREATE INDEX IF NOT EXISTS idx_resubmit_requests_status ON resubmit_requests(status);
