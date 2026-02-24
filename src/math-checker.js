/**
 * ============================================
 * МОДУЛЬ ПЕРЕВІРКИ МАТЕМАТИЧНИХ ФОРМУЛ
 * ============================================
 * Порівнює формули числовим методом:
 * обчислює обидві на множині точок і порівнює значення.
 * 
 * Підтримує: sin, cos, tan, sqrt, ln, log, exp, abs, pi, e,
 *            степені (^), дроби, asin, acos, atan, sinh, cosh, tanh
 */

const { create, all } = require('mathjs');

// Створюємо ізольований інстанс mathjs
const math = create(all, {});

// ============================================
// КОНФІГУРАЦІЯ
// ============================================
const DEFAULT_CONFIG = {
    // Відрізок для перевірки
    rangeMin: -Math.PI,
    rangeMax: Math.PI,
    
    // Кількість рівномірних точок
    uniformPoints: 500,
    
    // Кількість випадкових точок з розширеного діапазону
    randomPoints: 200,
    randomRangeMin: -10,
    randomRangeMax: 10,
    
    // Допустима похибка (tolerance)
    tolerance: 1e-6,
    
    // Мінімальний відсоток співпадінь для "еквівалентні"
    matchThreshold: 0.95
};

// ============================================
// НОРМАЛІЗАЦІЯ ФОРМУЛИ
// ============================================
/**
 * Підготовка формули перед парсингом:
 * - замінює ^ на ** якщо потрібно
 * - нормалізує пробіли
 * - замінює π на pi
 */
function normalizeFormula(formula) {
    let f = formula.trim();
    
    // Замінюємо різні варіанти запису
    f = f.replace(/π/g, 'pi');
    f = f.replace(/∞/g, 'Infinity');
    f = f.replace(/√\(/g, 'sqrt(');
    f = f.replace(/√(\w)/g, 'sqrt($1)');
    f = f.replace(/\|([^|]+)\|/g, 'abs($1)'); // |x| → abs(x)
    
    // ln → log (в mathjs log = натуральний логарифм)
    // Але залишаємо log10, log2 як є
    f = f.replace(/\bln\b/g, 'log');
    
    // Замінюємо ** на ^ (mathjs використовує ^)
    f = f.replace(/\*\*/g, '^');
    
    // Видаляємо зайві пробіли
    f = f.replace(/\s+/g, ' ').trim();
    
    return f;
}

// ============================================
// ГЕНЕРАЦІЯ ТЕСТОВИХ ТОЧОК
// ============================================
function generateTestPoints(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const points = [];
    
    // Рівномірні точки на основному відрізку
    const step = (cfg.rangeMax - cfg.rangeMin) / cfg.uniformPoints;
    for (let x = cfg.rangeMin; x <= cfg.rangeMax; x += step) {
        points.push(x);
    }
    
    // Випадкові точки з розширеного діапазону
    for (let i = 0; i < cfg.randomPoints; i++) {
        const x = cfg.randomRangeMin + Math.random() * (cfg.randomRangeMax - cfg.randomRangeMin);
        points.push(x);
    }
    
    // Додаємо "цікаві" точки
    const special = [0, 1, -1, 0.5, -0.5, 2, -2, Math.PI, -Math.PI, Math.E, Math.PI/2, Math.PI/4, Math.PI/3, Math.PI/6];
    points.push(...special);
    
    return points;
}

// ============================================
// БЕЗПЕЧНЕ ОБЧИСЛЕННЯ ФОРМУЛИ В ТОЧЦІ
// ============================================
function safeEvaluate(compiled, x) {
    try {
        const result = compiled.evaluate({ x });
        
        // Перевіряємо чи результат — число
        if (typeof result !== 'number') return null;
        if (!isFinite(result)) return null;
        if (isNaN(result)) return null;
        
        return result;
    } catch {
        return null;
    }
}

// ============================================
// ГОЛОВНА ФУНКЦІЯ ПОРІВНЯННЯ
// ============================================
/**
 * Порівнює дві формули числовим методом.
 * 
 * @param {string} referenceFormula - Еталонна формула (від викладача)
 * @param {string} studentFormula - Формула студента
 * @param {object} config - Конфігурація (опційно)
 * @returns {object} Результат перевірки
 */
function compareFormulas(referenceFormula, studentFormula, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    
    // Нормалізуємо формули
    const refNorm = normalizeFormula(referenceFormula);
    const stuNorm = normalizeFormula(studentFormula);
    
    // Спочатку перевіримо чи формули ідентичні після нормалізації
    if (refNorm === stuNorm) {
        return {
            equivalent: true,
            matchPercentage: 100,
            message: 'Формули ідентичні',
            details: {
                referenceNormalized: refNorm,
                studentNormalized: stuNorm,
                totalPoints: 0,
                validPoints: 0,
                matchingPoints: 0
            }
        };
    }
    
    // Компілюємо формули
    let refCompiled, stuCompiled;
    try {
        refCompiled = math.compile(refNorm);
    } catch (err) {
        return {
            equivalent: false,
            matchPercentage: 0,
            error: true,
            message: `Помилка в еталонній формулі: ${err.message}`,
            details: { referenceNormalized: refNorm, parseError: 'reference' }
        };
    }
    
    try {
        stuCompiled = math.compile(stuNorm);
    } catch (err) {
        return {
            equivalent: false,
            matchPercentage: 0,
            error: true,
            message: `Помилка в формулі студента: ${err.message}`,
            details: { studentNormalized: stuNorm, parseError: 'student' }
        };
    }
    
    // Генеруємо тестові точки
    const points = generateTestPoints(cfg);
    
    let totalValid = 0;
    let matching = 0;
    let maxDifference = 0;
    const mismatchExamples = [];
    
    for (const x of points) {
        const refVal = safeEvaluate(refCompiled, x);
        const stuVal = safeEvaluate(stuCompiled, x);
        
        // Пропускаємо точки де хоча б одна формула не визначена
        if (refVal === null && stuVal === null) continue;
        
        // Якщо одна визначена, а інша ні — це розбіжність,
        // але тільки якщо це не поодинокий випадок
        if (refVal === null || stuVal === null) {
            totalValid++;
            if (mismatchExamples.length < 5) {
                mismatchExamples.push({
                    x: Math.round(x * 10000) / 10000,
                    reference: refVal,
                    student: stuVal,
                    reason: refVal === null ? 'еталон не визначений' : 'студент не визначений'
                });
            }
            continue;
        }
        
        totalValid++;
        
        // Порівнюємо з tolerance
        const diff = Math.abs(refVal - stuVal);
        
        // Відносна похибка для великих значень
        const relativeTolerance = Math.max(cfg.tolerance, cfg.tolerance * Math.abs(refVal));
        
        if (diff <= relativeTolerance) {
            matching++;
        } else {
            maxDifference = Math.max(maxDifference, diff);
            if (mismatchExamples.length < 5) {
                mismatchExamples.push({
                    x: Math.round(x * 10000) / 10000,
                    reference: Math.round(refVal * 10000) / 10000,
                    student: Math.round(stuVal * 10000) / 10000,
                    difference: Math.round(diff * 10000) / 10000
                });
            }
        }
    }
    
    // Рахуємо відсоток співпадінь
    const matchPercentage = totalValid > 0 ? (matching / totalValid) * 100 : 0;
    const equivalent = matchPercentage >= cfg.matchThreshold * 100;
    
    let message;
    if (equivalent) {
        message = `Формули еквівалентні (${matchPercentage.toFixed(1)}% точок збігаються)`;
    } else if (matchPercentage > 50) {
        message = `Формули частково збігаються (${matchPercentage.toFixed(1)}%)`;
    } else {
        message = `Формули не еквівалентні (${matchPercentage.toFixed(1)}% збіг)`;
    }
    
    return {
        equivalent,
        matchPercentage: Math.round(matchPercentage * 100) / 100,
        message,
        details: {
            referenceNormalized: refNorm,
            studentNormalized: stuNorm,
            totalPoints: points.length,
            validPoints: totalValid,
            matchingPoints: matching,
            maxDifference: Math.round(maxDifference * 10000) / 10000,
            mismatchExamples
        }
    };
}

// ============================================
// ПАРСИНГ .MD ФАЙЛУ З ВІДПОВІДЯМИ
// ============================================
/**
 * Парсить .md файл студента і витягує відповіді на завдання.
 * 
 * Очікуваний формат:
 *   ## Завдання 1
 *   **Відповідь:** sin(x)
 * 
 *   ## Завдання 2
 *   **Відповідь:** x^2 + 1
 * 
 * Або простіший формат:
 *   1. sin(x)
 *   2. x^2 + 1
 * 
 * Або з маркером:
 *   Відповідь 1: sin(x)
 *   Відповідь 2: x^2 + 1
 */
function parseStudentAnswers(mdContent) {
    const answers = {};
    const lines = mdContent.split('\n');
    
    // Паттерн 1: ## Завдання N ... Відповідь: formula
    let currentTask = null;
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Шукаємо номер завдання
        const taskMatch = trimmed.match(/^#{1,3}\s*(?:завдання|задача|задание|task|problem)\s*[#№]?\s*(\d+)/i) ||
                         trimmed.match(/^(?:завдання|задача|задание)\s*[#№]?\s*(\d+)/i);
        if (taskMatch) {
            currentTask = parseInt(taskMatch[1]);
            continue;
        }
        
        // Шукаємо відповідь для поточного завдання
        if (currentTask !== null) {
            const answerMatch = trimmed.match(/^\*{0,2}(?:відповідь|answer|результат)\*{0,2}\s*[:=]?\s*\*{0,2}\s*(.+)/i);
            if (answerMatch) {
                answers[currentTask] = answerMatch[1].trim()
                    .replace(/^\*{1,2}\s*/, '').replace(/\s*\*{1,2}$/, '')  // Видаляємо markdown bold
                    .replace(/^\$+/, '').replace(/\$+$/, '')  // Видаляємо LaTeX $...$
                    .replace(/^`+/, '').replace(/`+$/, '')    // Видаляємо markdown code
                    .trim();
                currentTask = null;
                continue;
            }
        }
    }
    
    // Паттерн 2: простий нумерований список "1. formula" або "1) formula"
    if (Object.keys(answers).length === 0) {
        for (const line of lines) {
            const trimmed = line.trim();
            const listMatch = trimmed.match(/^(\d+)\s*[.)]\s*(.+)/);
            if (listMatch) {
                const num = parseInt(listMatch[1]);
                let formula = listMatch[2].trim()
                    .replace(/^\*{1,2}\s*/, '').replace(/\s*\*{1,2}$/, '')
                    .replace(/^\$+/, '').replace(/\$+$/, '')
                    .replace(/^`+/, '').replace(/`+$/, '')
                    .trim();
                
                // Ігноруємо якщо це просто текст без мат. виразу
                if (formula && formula.length > 0) {
                    answers[num] = formula;
                }
            }
        }
    }
    
    // Паттерн 3: "Відповідь N: formula"
    if (Object.keys(answers).length === 0) {
        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(/(?:відповідь|answer|результат)\s*[#№]?\s*(\d+)\s*[:=]\s*(.+)/i);
            if (match) {
                answers[parseInt(match[1])] = match[2].trim()
                    .replace(/^\*{1,2}\s*/, '').replace(/\s*\*{1,2}$/, '')
                    .replace(/^\$+/, '').replace(/\$+$/, '')
                    .replace(/^`+/, '').replace(/`+$/, '')
                    .trim();
            }
        }
    }
    
    return answers;
}

// ============================================
// ПЕРЕВІРКА ВСІХ ЗАВДАНЬ
// ============================================
/**
 * Перевіряє всі відповіді студента проти еталонних.
 * 
 * @param {Array} mathTasks - Завдання [{task_number, description, reference_answer, points, config}]
 * @param {string} mdContent - Вміст .md файлу студента
 * @returns {object} Результати перевірки
 */
function gradeStudentWork(mathTasks, mdContent) {
    const studentAnswers = parseStudentAnswers(mdContent);
    
    const results = [];
    let totalPoints = 0;
    let earnedPoints = 0;
    
    for (const task of mathTasks) {
        const taskNum = task.task_number;
        const studentAnswer = studentAnswers[taskNum];
        
        totalPoints += task.points;
        
        if (!studentAnswer) {
            results.push({
                taskNumber: taskNum,
                description: task.description,
                referenceAnswer: task.reference_answer,
                studentAnswer: null,
                points: 0,
                maxPoints: task.points,
                correct: false,
                message: 'Відповідь не знайдена'
            });
            continue;
        }
        
        const comparison = compareFormulas(
            task.reference_answer,
            studentAnswer,
            task.config || {}
        );
        
        const correct = comparison.equivalent;
        const points = correct ? task.points : 0;
        earnedPoints += points;
        
        results.push({
            taskNumber: taskNum,
            description: task.description,
            referenceAnswer: task.reference_answer,
            studentAnswer,
            points,
            maxPoints: task.points,
            correct,
            matchPercentage: comparison.matchPercentage,
            message: comparison.message,
            details: comparison.details
        });
    }
    
    const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    
    return {
        totalPoints,
        earnedPoints,
        percentage: Math.round(percentage * 100) / 100,
        results,
        parsedAnswers: studentAnswers,
        summary: `${earnedPoints}/${totalPoints} балів (${Math.round(percentage)}%)`
    };
}

module.exports = {
    compareFormulas,
    parseStudentAnswers,
    gradeStudentWork,
    normalizeFormula,
    DEFAULT_CONFIG
};
