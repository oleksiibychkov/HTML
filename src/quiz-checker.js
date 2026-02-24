/**
 * ============================================
 * МОДУЛЬ ПЕРЕВІРКИ QUIZ (ТЕСТОВИХ ЗАВДАНЬ A/B/C/D)
 * ============================================
 * Парсить .md файл з тестовими завданнями,
 * перевіряє відповіді студентів,
 * будує промпт для AI (якщо правильна відповідь невідома).
 */

// ============================================
// ПАРСИНГ .MD ФАЙЛУ З ТЕСТАМИ
// ============================================
/**
 * Парсить Markdown з тестовими завданнями у масив об'єктів.
 *
 * Очікуваний формат (як у docs/Тестові_завдання_розділи_2-6.md):
 *   # Розділ 2: Назва
 *   ### Рівень 1 — Знання
 *   **Тест 2.1.** Текст питання
 *   - A) варіант
 *   - B) варіант
 *   - C) варіант
 *   - D) варіант
 *   <details><summary>Відповідь</summary>
 *   **B)** пояснення
 *   </details>
 */
function parseQuizMarkdown(mdContent) {
    const lines = mdContent.split('\n');
    const questions = [];

    let currentSection = '';
    let currentLevel = '';
    let sortOrder = 0;

    // State machine
    let state = 'scanning'; // scanning | question | options | details
    let currentQuestion = null;
    let inCodeBlock = false;
    let codeBlockContent = '';
    let detailsContent = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track code blocks (triple backticks)
        if (trimmed.startsWith('```')) {
            if (inCodeBlock) {
                // Closing code block - append to question text if in question state
                if (currentQuestion && (state === 'question' || state === 'options')) {
                    codeBlockContent += line + '\n';
                    currentQuestion.question_text += '\n' + codeBlockContent;
                    codeBlockContent = '';
                }
                inCodeBlock = false;
                continue;
            } else {
                inCodeBlock = true;
                codeBlockContent = line + '\n';
                continue;
            }
        }

        if (inCodeBlock) {
            codeBlockContent += line + '\n';
            if (state === 'details') {
                detailsContent += line + '\n';
            }
            continue;
        }

        // Detect section headers: # Розділ N: Title
        const sectionMatch = trimmed.match(/^#+\s*(?:Розділ|Section)\s*\d+\s*[:\-–—]\s*(.+)/i);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            continue;
        }

        // Detect level headers: ### Рівень N — Title
        const levelMatch = trimmed.match(/^#{1,4}\s*(?:Рівень|Level)\s*\d+\s*[—–\-]\s*(.+)/i);
        if (levelMatch) {
            currentLevel = levelMatch[1].trim();
            continue;
        }

        // Detect question: **Тест N.M.** text
        const questionMatch = trimmed.match(/^\*{2}Тест\s+(\d+\.\d+)\.?\*{2}\s*(.*)/i);
        if (questionMatch) {
            // Save previous question if exists
            if (currentQuestion) {
                questions.push(currentQuestion);
            }

            sortOrder++;
            currentQuestion = {
                question_number: questionMatch[1],
                section_title: currentSection,
                level_title: currentLevel,
                question_text: questionMatch[2].trim(),
                option_a: null,
                option_b: null,
                option_c: null,
                option_d: null,
                correct_answer: null,
                correct_explanation: null,
                points: 1,
                sort_order: sortOrder
            };
            state = 'question';
            continue;
        }

        // If we're in question/options state, detect options
        if (currentQuestion && (state === 'question' || state === 'options')) {
            const optionMatch = trimmed.match(/^[-*]\s*([ABCD])\)\s*(.*)/);
            if (optionMatch) {
                state = 'options';
                const letter = optionMatch[1].toUpperCase();
                const optionText = optionMatch[2].trim();
                const key = `option_${letter.toLowerCase()}`;
                currentQuestion[key] = optionText;
                continue;
            }

            // If in question state and not an option, append to question text
            // (handles multi-line questions, but skip empty/separator lines)
            if (state === 'question' && trimmed && !trimmed.match(/^---+$/) && !trimmed.startsWith('<details')) {
                currentQuestion.question_text += '\n' + trimmed;
            }
        }

        // Detect <details> block (correct answer)
        if (currentQuestion && trimmed.startsWith('<details')) {
            state = 'details';
            detailsContent = '';
            continue;
        }

        // Inside details block
        if (state === 'details') {
            if (trimmed === '</details>') {
                // Parse the details content
                parseDetailsBlock(detailsContent, currentQuestion);
                state = 'scanning';
                continue;
            }

            // Skip the <summary> line
            if (trimmed.startsWith('<summary>')) continue;

            detailsContent += line + '\n';
            continue;
        }

        // Separator line - if we have a complete question, finalize
        if (trimmed.match(/^---+$/) && currentQuestion && state !== 'details') {
            if (currentQuestion.option_a || currentQuestion.option_b) {
                questions.push(currentQuestion);
                currentQuestion = null;
                state = 'scanning';
            }
        }
    }

    // Don't forget the last question
    if (currentQuestion && (currentQuestion.option_a || currentQuestion.option_b)) {
        questions.push(currentQuestion);
    }

    return questions;
}

/**
 * Парсить блок <details> і витягує правильну відповідь та пояснення
 */
function parseDetailsBlock(content, question) {
    const lines = content.split('\n');
    let foundAnswer = false;
    const explanationParts = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Pattern: **B)** explanation text
        const answerMatch = trimmed.match(/^\*{2}([ABCD])\)\*{2}\s*(.*)/);
        if (answerMatch && !foundAnswer) {
            question.correct_answer = answerMatch[1].toUpperCase();
            if (answerMatch[2].trim()) {
                explanationParts.push(answerMatch[2].trim());
            }
            foundAnswer = true;
            continue;
        }

        // Also check for pattern without bold: B) explanation
        if (!foundAnswer) {
            const simpleMatch = trimmed.match(/^([ABCD])\)\s*(.*)/);
            if (simpleMatch) {
                question.correct_answer = simpleMatch[1].toUpperCase();
                if (simpleMatch[2].trim()) {
                    explanationParts.push(simpleMatch[2].trim());
                }
                foundAnswer = true;
                continue;
            }
        }

        // Collect explanation text
        if (foundAnswer) {
            explanationParts.push(trimmed);
        }
    }

    if (explanationParts.length > 0) {
        question.correct_explanation = explanationParts.join(' ');
    }
}

// ============================================
// ПЕРЕВІРКА ВІДПОВІДЕЙ СТУДЕНТІВ
// ============================================
/**
 * Перевіряє відповіді студента (де правильна відповідь відома).
 *
 * @param {Array} questions - Масив quiz_questions з БД
 * @param {Object} studentAnswers - { questionId: 'A'|'B'|'C'|'D' }
 * @returns {Object} Результат перевірки
 */
function gradeQuizAnswers(questions, studentAnswers) {
    let totalPoints = 0;
    let earnedPoints = 0;
    const results = [];
    const needsAI = [];

    for (const q of questions) {
        totalPoints += q.points;
        const studentAnswer = studentAnswers[q.id] || null;

        if (q.correct_answer) {
            // Детерміновна перевірка
            const isCorrect = studentAnswer &&
                studentAnswer.toUpperCase() === q.correct_answer.toUpperCase();
            const pointsEarned = isCorrect ? q.points : 0;
            earnedPoints += pointsEarned;

            results.push({
                questionId: q.id,
                questionNumber: q.question_number,
                studentAnswer,
                correctAnswer: q.correct_answer,
                isCorrect,
                pointsEarned,
                maxPoints: q.points
            });
        } else {
            // Потрібна AI перевірка
            needsAI.push({
                questionId: q.id,
                questionNumber: q.question_number,
                questionText: q.question_text,
                optionA: q.option_a,
                optionB: q.option_b,
                optionC: q.option_c,
                optionD: q.option_d,
                studentAnswer,
                maxPoints: q.points
            });
        }
    }

    return {
        totalPoints,
        earnedPoints,
        results,
        needsAI,
        percentage: totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0
    };
}

// ============================================
// ПРОМПТ ДЛЯ AI (питання без відповідей)
// ============================================
/**
 * Формує промпт для Claude API для питань без відомої правильної відповіді.
 *
 * @param {Array} needsAI - Масив питань, що потребують AI перевірки
 * @returns {string} Промпт для Claude
 */
function buildAIPromptForUnanswered(needsAI) {
    if (!needsAI || needsAI.length === 0) return null;

    const questionsText = needsAI.map((q, i) => {
        return `${i + 1}. Тест ${q.questionNumber}: ${q.questionText}
   A) ${q.optionA || '—'}
   B) ${q.optionB || '—'}
   C) ${q.optionC || '—'}
   D) ${q.optionD || '—'}
   Відповідь студента: ${q.studentAnswer || 'не відповів'}`;
    }).join('\n\n');

    return `Ти — експерт, який перевіряє тестові завдання (multiple choice A/B/C/D).

Для кожного питання визнач правильну відповідь та перевір відповідь студента.

ПИТАННЯ:
${questionsText}

Відповідь ТІЛЬКИ у форматі JSON:
{
  "answers": [
    {
      "questionNumber": "N.M",
      "correctAnswer": "A|B|C|D",
      "isCorrect": true|false,
      "explanation": "коротке пояснення українською"
    }
  ]
}

ВАЖЛИВО:
- Повертай ТІЛЬКИ валідний JSON
- Будь впевненим у правильній відповіді
- Якщо студент не відповів — isCorrect = false`;
}

module.exports = {
    parseQuizMarkdown,
    gradeQuizAnswers,
    buildAIPromptForUnanswered
};
