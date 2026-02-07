import React, { useState, useEffect, createContext, useContext } from 'react';

// ============================================
// API HELPER
// ============================================
const API_URL = '/api';

async function api(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  // Якщо є body і це не FormData
  if (options.body && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  } else if (options.body instanceof FormData) {
    // Для FormData видаляємо Content-Type (браузер сам додасть з boundary)
    delete config.headers['Content-Type'];
    config.body = options.body;
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Помилка сервера');
  }

  return data;
}

// ============================================
// AUTH CONTEXT
// ============================================
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const data = await api('/auth/me');
        setUser(data.user);
      } catch {
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  };

  const login = async (email, password) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const register = async (userData) => {
    const data = await api('/auth/register', {
      method: 'POST',
      body: userData,
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

// ============================================
// TEST TYPE LABELS
// ============================================
const testTypeLabels = {
  lab: 'Лабораторна робота',
  control: 'Контрольна робота',
  exam: 'Іспит'
};

// ============================================
// MAIN APP
// ============================================
export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const [view, setView] = useState('login');
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingSpinner}></div>
        <p style={styles.loadingText}>Завантаження системи...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>{globalStyles}</style>
      
      {notification && (
        <div style={{
          ...styles.notification,
          backgroundColor: notification.type === 'success' ? '#065f46' : 
                          notification.type === 'error' ? '#991b1b' : '#1e40af'
        }}>
          {notification.message}
        </div>
      )}

      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>◈</span>
          <span style={styles.logoText}>TestHub</span>
          <span style={styles.logoSub}>Система тестування</span>
        </div>
        {user && (
          <div style={styles.userBar}>
            <span style={styles.userName}>
              {user.role === 'teacher' ? '👨‍🏫' : '👨‍🎓'} {user.name}
            </span>
            <button onClick={logout} style={styles.logoutBtn}>Вийти</button>
          </div>
        )}
      </header>

      <main style={styles.main}>
        {!user ? (
          view === 'login' ? (
            <LoginForm setView={setView} showNotification={showNotification} />
          ) : (
            <RegisterForm setView={setView} showNotification={showNotification} />
          )
        ) : user.role === 'teacher' ? (
          <TeacherDashboard showNotification={showNotification} />
        ) : (
          <StudentDashboard showNotification={showNotification} />
        )}
      </main>

      <footer style={styles.footer}>
        <p>© 2025 TestHub — Автоматизована система тестування з BI</p>
      </footer>
    </div>
  );
}

// ============================================
// LOGIN FORM
// ============================================
function LoginForm({ setView, showNotification }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const data = await login(email, password);
      showNotification(`Ласкаво просимо, ${data.user.name}!`, 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
    
    setIsLoading(false);
  };

  return (
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <div style={styles.authHeader}>
          <h2 style={styles.authTitle}>Вхід в систему</h2>
          <p style={styles.authSubtitle}>Введіть ваші облікові дані</p>
        </div>
        
        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button type="submit" style={styles.primaryBtn} disabled={isLoading}>
            {isLoading ? 'Вхід...' : 'Увійти'}
          </button>
        </form>
        
        <div style={styles.authFooter}>
          <p>Немає акаунту?</p>
          <button onClick={() => setView('register')} style={styles.linkBtn}>
            Зареєструватися
          </button>
        </div>

        <div style={styles.demoCredentials}>
          <p style={styles.demoTitle}>Демо доступ:</p>
          <p>Викладач: teacher@test.com / teacher123</p>
          <p>Студент: student@test.com / student123</p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// REGISTER FORM
// ============================================
function RegisterForm({ setView, showNotification }) {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    group: '',
    course: '',
    role: 'student'
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      showNotification('Паролі не співпадають', 'error');
      return;
    }

    setIsLoading(true);
    
    try {
      await register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        group: formData.group,
        course: formData.course
      });
      showNotification('Реєстрація успішна!', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
    
    setIsLoading(false);
  };

  return (
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <div style={styles.authHeader}>
          <h2 style={styles.authTitle}>Реєстрація</h2>
          <p style={styles.authSubtitle}>Створіть новий акаунт</p>
        </div>
        
        <form onSubmit={handleRegister} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Роль</label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              style={styles.input}
            >
              <option value="student">Студент</option>
              <option value="teacher">Викладач</option>
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>ПІБ</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              style={styles.input}
              placeholder="Іванов Іван Іванович"
              required
            />
          </div>
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              style={styles.input}
              placeholder="your@email.com"
              required
            />
          </div>

          {formData.role === 'student' && (
            <div style={styles.row}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Група</label>
                <input
                  type="text"
                  name="group"
                  value={formData.group}
                  onChange={handleChange}
                  style={styles.input}
                  placeholder="КН-21"
                  required
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Курс</label>
                <select
                  name="course"
                  value={formData.course}
                  onChange={handleChange}
                  style={styles.input}
                  required
                >
                  <option value="">Виберіть</option>
                  {[1,2,3,4,5,6].map(n => (
                    <option key={n} value={n}>{n} курс</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Пароль</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              style={styles.input}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Підтвердити пароль</label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button type="submit" style={styles.primaryBtn} disabled={isLoading}>
            {isLoading ? 'Реєстрація...' : 'Зареєструватися'}
          </button>
        </form>
        
        <div style={styles.authFooter}>
          <p>Вже маєте акаунт?</p>
          <button onClick={() => setView('login')} style={styles.linkBtn}>
            Увійти
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// TEACHER DASHBOARD
// ============================================
function TeacherDashboard({ showNotification }) {
  const [disciplines, setDisciplines] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [activeTab, setActiveTab] = useState('disciplines');
  const [showAddDiscipline, setShowAddDiscipline] = useState(false);
  const [showAddTest, setShowAddTest] = useState(null);
  const [selectedDiscipline, setSelectedDiscipline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resubmitRequests, setResubmitRequests] = useState([]); // Запити на перездачу

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [discData, subData, reqData] = await Promise.all([
        api('/disciplines'),
        api('/submissions'),
        api('/submissions/resubmit-requests')
      ]);
      setDisciplines(discData.disciplines || []);
      setSubmissions(subData.submissions || []);
      setResubmitRequests(reqData.requests || []);
    } catch (err) {
      showNotification(err.message, 'error');
    }
    setLoading(false);
  };

  const handleResubmitApprove = async (requestId) => {
    try {
      await api(`/submissions/resubmit-requests/${requestId}/approve`, {
        method: 'POST',
        body: { comment: 'Дозволено' }
      });
      showNotification('Запит схвалено. Студент може здати роботу повторно.', 'success');
      loadData();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const handleResubmitReject = async (requestId, comment) => {
    if (!comment || comment.trim().length < 5) {
      showNotification('Вкажіть причину відмови', 'error');
      return;
    }
    try {
      await api(`/submissions/resubmit-requests/${requestId}/reject`, {
        method: 'POST',
        body: { comment }
      });
      showNotification('Запит відхилено', 'success');
      loadData();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const allowResubmit = async (submissionId) => {
    if (!confirm('Дозволити студенту здати роботу повторно?')) return;
    try {
      await api(`/submissions/${submissionId}/allow-resubmit`, {
        method: 'POST'
      });
      showNotification('Перездачу дозволено', 'success');
      loadData();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const handleAddDiscipline = async (name) => {
    try {
      await api('/disciplines', {
        method: 'POST',
        body: { name }
      });
      await loadData();
      setShowAddDiscipline(false);
      showNotification('Дисципліну додано успішно', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const handleAddTest = async (disciplineId, formData) => {
    try {
      // formData тепер це FormData об'єкт з файлами
      const response = await fetch('/api/tests', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      await loadData();
      setShowAddTest(null);
      showNotification(`Тест створено! ${data.test.criteria_count || 0} критеріїв`, 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const loadDisciplineDetails = async (id) => {
    try {
      const data = await api(`/disciplines/${id}`);
      setSelectedDiscipline(data.discipline);
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  if (loading) {
    return <div style={styles.loadingText}>Завантаження...</div>;
  }

  return (
    <div style={styles.dashboard}>
      <div style={styles.tabs}>
        <button 
          onClick={() => setActiveTab('disciplines')}
          style={activeTab === 'disciplines' ? styles.tabActive : styles.tab}
        >
          📚 Мої дисципліни
        </button>
        <button 
          onClick={() => setActiveTab('submissions')}
          style={activeTab === 'submissions' ? styles.tabActive : styles.tab}
        >
          📝 Здані роботи
        </button>
        <button 
          onClick={() => setActiveTab('results')}
          style={activeTab === 'results' ? styles.tabActive : styles.tab}
        >
          📊 Результати
        </button>
        <button 
          onClick={() => setActiveTab('batch')}
          style={activeTab === 'batch' ? styles.tabActive : styles.tab}
        >
          🚀 Масове оцінювання
        </button>
        <button 
          onClick={() => setActiveTab('requests')}
          style={activeTab === 'requests' ? styles.tabActive : styles.tab}
        >
          🔄 Запити {resubmitRequests.filter(r => r.status === 'pending').length > 0 && (
            <span style={{
              marginLeft: '6px',
              padding: '2px 8px',
              borderRadius: '10px',
              backgroundColor: '#ef4444',
              fontSize: '12px'
            }}>
              {resubmitRequests.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'requests' && (
        <ResubmitRequestsView 
          requests={resubmitRequests}
          onApprove={handleResubmitApprove}
          onReject={handleResubmitReject}
          showNotification={showNotification}
        />
      )}

      {activeTab === 'results' && (
        <ResultsView 
          disciplines={disciplines} 
          showNotification={showNotification} 
        />
      )}

      {activeTab === 'batch' && (
        <BatchGrading showNotification={showNotification} />
      )}

      {activeTab === 'disciplines' && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Мої дисципліни</h3>
            <button onClick={() => setShowAddDiscipline(true)} style={styles.addBtn}>
              + Додати дисципліну
            </button>
          </div>

          {disciplines.length === 0 ? (
            <div style={styles.emptyState}>
              <p>У вас ще немає дисциплін</p>
              <button onClick={() => setShowAddDiscipline(true)} style={styles.primaryBtn}>
                Додати першу дисципліну
              </button>
            </div>
          ) : (
            <div style={styles.disciplineGrid}>
              {disciplines.map(disc => (
                <div key={disc.id} style={styles.disciplineCard}>
                  <h4 style={styles.disciplineName}>{disc.name}</h4>
                  <p style={styles.testCount}>{disc.tests_count || 0} тестів</p>
                  <div style={styles.cardActions}>
                    <button 
                      onClick={() => loadDisciplineDetails(disc.id)} 
                      style={styles.secondaryBtn}
                    >
                      Переглянути
                    </button>
                    <button 
                      onClick={() => setShowAddTest(disc.id)} 
                      style={styles.secondaryBtn}
                    >
                      + Тест
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedDiscipline && (
            <DisciplineDetails 
              discipline={selectedDiscipline}
              onClose={() => setSelectedDiscipline(null)}
              showNotification={showNotification}
              onUpdate={() => { loadData(); loadDisciplineDetails(selectedDiscipline.id); }}
            />
          )}
        </div>
      )}

      {activeTab === 'submissions' && (
        <SubmissionsList 
          submissions={submissions}
          showNotification={showNotification}
          onUpdate={loadData}
          onAllowResubmit={allowResubmit}
        />
      )}

      {showAddDiscipline && (
        <AddDisciplineModal 
          onClose={() => setShowAddDiscipline(false)}
          onAdd={handleAddDiscipline}
        />
      )}

      {showAddTest && (
        <AddTestModal 
          disciplineId={showAddTest}
          onClose={() => setShowAddTest(null)}
          onAdd={handleAddTest}
        />
      )}
    </div>
  );
}

// ============================================
// DISCIPLINE DETAILS
// ============================================
function DisciplineDetails({ discipline, onClose, showNotification, onUpdate }) {
  const [gradingTest, setGradingTest] = useState(null);
  const [gradingProgress, setGradingProgress] = useState(0);

  // Видалити тест
  const deleteTest = async (testId, testTitle) => {
    if (!confirm(`Видалити тест "${testTitle}"?\n\nВсі здані роботи та результати будуть видалені!`)) return;
    
    try {
      await api(`/tests/${testId}`, { method: 'DELETE' });
      showNotification('Тест видалено', 'success');
      if (onUpdate) onUpdate();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const handleGradeAll = async (test) => {
    if (!confirm(`Оцінити всі неоцінені роботи для "${test.title}"?`)) return;
    
    setGradingTest(test.id);
    setGradingProgress(10);
    
    try {
      const progressInterval = setInterval(() => {
        setGradingProgress(prev => Math.min(prev + 5, 90));
      }, 500);
      
      const response = await fetch(`/api/tests/${test.id}/grade-all`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      clearInterval(progressInterval);
      setGradingProgress(100);
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      showNotification(`Оцінено ${data.success} робіт!`, 'success');
      
      // Завантажити результати
      if (data.download_url) {
        try {
          const downloadResponse = await fetch(data.download_url, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          if (downloadResponse.ok) {
            const blob = await downloadResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Результати_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }
        } catch (downloadErr) {
          console.error('Помилка завантаження:', downloadErr);
        }
      }
      
    } catch (err) {
      showNotification(err.message, 'error');
    }
    
    setGradingTest(null);
    setGradingProgress(0);
  };

  const downloadTaskFile = async (testId, title) => {
    try {
      const response = await fetch(`/api/tests/${testId}/task-file`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Помилка завантаження');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'Завдання'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>{discipline.name}</h3>
        
        <h4 style={{ marginTop: '20px', marginBottom: '15px', color: '#94a3b8' }}>
          Тести ({discipline.tests?.length || 0})
        </h4>
        
        {discipline.tests?.length === 0 ? (
          <p style={{ color: '#64748b' }}>Немає тестів</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {discipline.tests.map(test => (
              <div key={test.id} style={detailStyles.testCard}>
                <div style={detailStyles.testHeader}>
                  <div>
                    <span style={styles.testType}>{testTypeLabels[test.type]}</span>
                    <span style={{ marginLeft: '10px', color: '#e2e8f0', fontWeight: '600' }}>{test.title}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {new Date(test.start_time).toLocaleDateString('uk-UA')} — {new Date(test.end_time).toLocaleDateString('uk-UA')}
                  </div>
                </div>
                
                <div style={detailStyles.testInfo}>
                  <div style={detailStyles.infoItem}>
                    <span style={detailStyles.infoLabel}>Критеріїв:</span>
                    <span>{test.criteria?.length || 0}</span>
                  </div>
                  <div style={detailStyles.infoItem}>
                    <span style={detailStyles.infoLabel}>Макс. балів:</span>
                    <span>{test.max_points}</span>
                  </div>
                  <div style={detailStyles.infoItem}>
                    <span style={detailStyles.infoLabel}>Здано робіт:</span>
                    <span style={{ color: '#3b82f6' }}>{test.submissions_count || 0}</span>
                  </div>
                  <div style={detailStyles.infoItem}>
                    <span style={detailStyles.infoLabel}>Оцінено:</span>
                    <span style={{ color: '#10b981' }}>{test.graded_count || 0}</span>
                  </div>
                </div>
                
                {/* Файли */}
                <div style={detailStyles.filesRow}>
                  {test.task_file && (
                    <button 
                      onClick={() => downloadTaskFile(test.id, test.title)}
                      style={detailStyles.fileBtn}
                    >
                      📄 Завдання (PDF)
                    </button>
                  )}
                  {test.criteria_file ? (
                    <span style={detailStyles.fileInfo}>📊 Excel критеріїв завантажено</span>
                  ) : (
                    <span style={{ ...detailStyles.fileInfo, color: '#f59e0b' }}>⚠️ Шаблон критеріїв не завантажено</span>
                  )}
                </div>
                
                {/* Кнопка оновлення шаблону критеріїв */}
                <div style={{ marginTop: '10px' }}>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    id={`criteria-upload-${test.id}`}
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      
                      const formData = new FormData();
                      formData.append('criteria_file', file);
                      
                      try {
                        const response = await fetch(`${API_URL}/tests/${test.id}/update-criteria`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                          body: formData
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error);
                        showNotification(`Шаблон оновлено: ${data.criteria_count} критеріїв, макс. ${data.max_points} балів`, 'success');
                        if (onUpdate) onUpdate();
                      } catch (err) {
                        showNotification(err.message, 'error');
                      }
                      e.target.value = '';
                    }}
                  />
                  <label 
                    htmlFor={`criteria-upload-${test.id}`}
                    style={{ 
                      ...detailStyles.fileBtn, 
                      display: 'inline-block',
                      cursor: 'pointer',
                      background: test.criteria_file ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.2)',
                      borderColor: test.criteria_file ? '#3b82f6' : '#f59e0b',
                      color: test.criteria_file ? '#3b82f6' : '#f59e0b'
                    }}
                  >
                    {test.criteria_file ? '📊 Оновити шаблон критеріїв' : '📊 Завантажити шаблон критеріїв'}
                  </label>
                </div>
                
                {/* Кнопка оцінювання */}
                {(test.submissions_count || 0) > (test.graded_count || 0) && (
                  <div style={detailStyles.gradeSection}>
                    {gradingTest === test.id ? (
                      <div style={detailStyles.progressContainer}>
                        <div style={detailStyles.progressBar}>
                          <div style={{ ...detailStyles.progressFill, width: `${gradingProgress}%` }} />
                        </div>
                        <span style={{ marginLeft: '10px', color: '#94a3b8' }}>{gradingProgress}%</span>
                      </div>
                    ) : (
                      <button 
                        onClick={() => handleGradeAll(test)}
                        style={detailStyles.gradeBtn}
                      >
                        🤖 Оцінити всі роботи ({(test.submissions_count || 0) - (test.graded_count || 0)} неоцінених)
                      </button>
                    )}
                  </div>
                )}
                
                {/* Кнопка завантаження результатів */}
                {(test.graded_count || 0) > 0 && (
                  <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                    <button 
                      onClick={async () => {
                        try {
                          const response = await fetch(`${API_URL}/submissions/test/${test.id}/results`, {
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                          });
                          if (!response.ok) {
                            const err = await response.json();
                            throw new Error(err.error || 'Помилка завантаження');
                          }
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Результати_${discipline.name}_${test.title}.xlsx`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch (err) {
                          showNotification(err.message, 'error');
                        }
                      }}
                      style={{ ...detailStyles.fileBtn, background: 'rgba(16, 185, 129, 0.2)', borderColor: '#10b981', color: '#10b981' }}
                    >
                      📥 Завантажити результати ({test.graded_count} оцінено)
                    </button>
                  </div>
                )}
                
                {/* Кнопка видалення тесту */}
                <div style={{ marginTop: '15px', borderTop: '1px solid #334155', paddingTop: '15px' }}>
                  <button 
                    onClick={() => deleteTest(test.id, test.title)}
                    style={{ 
                      ...detailStyles.fileBtn, 
                      background: 'rgba(239, 68, 68, 0.1)', 
                      borderColor: '#ef4444', 
                      color: '#ef4444' 
                    }}
                  >
                    🗑️ Видалити тест
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div style={styles.modalActions}>
          <button onClick={onClose} style={styles.secondaryBtn}>Закрити</button>
        </div>
      </div>
    </div>
  );
}

// Стилі для DisciplineDetails
const detailStyles = {
  testCard: {
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155'
  },
  testHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px'
  },
  testInfo: {
    display: 'flex',
    gap: '20px',
    marginBottom: '15px',
    flexWrap: 'wrap'
  },
  infoItem: {
    display: 'flex',
    gap: '5px',
    fontSize: '14px'
  },
  infoLabel: {
    color: '#64748b'
  },
  filesRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    marginBottom: '15px'
  },
  fileBtn: {
    padding: '8px 16px',
    background: 'rgba(59, 130, 246, 0.2)',
    border: '1px solid #3b82f6',
    borderRadius: '8px',
    color: '#3b82f6',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: 'inherit'
  },
  fileInfo: {
    fontSize: '13px',
    color: '#10b981'
  },
  gradeSection: {
    borderTop: '1px solid #334155',
    paddingTop: '15px'
  },
  gradeBtn: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%'
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center'
  },
  progressBar: {
    flex: 1,
    height: '8px',
    background: '#334155',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    transition: 'width 0.3s'
  }
};

// ============================================
// ADD DISCIPLINE MODAL
// ============================================
function AddDisciplineModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await onAdd(name);
    setLoading(false);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Додати дисципліну</h3>
        <form onSubmit={handleSubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Назва дисципліни</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              placeholder="Наприклад: Програмування на Python"
              required
              minLength={3}
            />
          </div>
          <div style={styles.modalActions}>
            <button type="button" onClick={onClose} style={styles.secondaryBtn}>
              Скасувати
            </button>
            <button type="submit" style={styles.primaryBtn} disabled={loading}>
              {loading ? 'Додавання...' : 'Додати'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// ADD TEST MODAL
// ============================================
function AddTestModal({ disciplineId, onClose, onAdd }) {
  const [testData, setTestData] = useState({
    type: 'lab',
    title: '',
    description: '',
    start_time: '',
    end_time: ''
  });
  const [taskFile, setTaskFile] = useState(null);
  const [criteriaFile, setCriteriaFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('file'); // 'file' або 'manual'
  const [manualCriteria, setManualCriteria] = useState([{ name: '', max_points: 0 }]);
  
  // Refs для file inputs
  const taskFileRef = React.useRef(null);
  const criteriaFileRef = React.useRef(null);

  const handleTaskFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setTaskFile(file);
    } else if (file) {
      alert('Завантажте PDF файл');
    }
  };

  const handleCriteriaFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      alert('Завантажте Excel файл (.xlsx)');
      return;
    }
    
    setCriteriaFile(file);
    setMode('file'); // Перемикаємо режим на file
  };

  const addManualCriteria = () => {
    setManualCriteria([...manualCriteria, { name: '', max_points: 0 }]);
  };

  const removeManualCriteria = (idx) => {
    setManualCriteria(manualCriteria.filter((_, i) => i !== idx));
  };

  const updateManualCriteria = (idx, field, value) => {
    const newCriteria = [...manualCriteria];
    newCriteria[idx][field] = field === 'max_points' ? parseInt(value) || 0 : value;
    setManualCriteria(newCriteria);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const formData = new FormData();
    formData.append('discipline_id', disciplineId);
    formData.append('type', testData.type);
    formData.append('title', testData.title);
    formData.append('description', testData.description || '');
    formData.append('start_time', testData.start_time);
    formData.append('end_time', testData.end_time);
    
    if (taskFile) {
      formData.append('task_file', taskFile);
    }
    
    // Якщо є Excel файл - завантажуємо його
    if (criteriaFile) {
      formData.append('criteria_file', criteriaFile);
    }
    
    // Якщо ручний режим і немає файлу - додаємо критерії як JSON
    if (mode === 'manual' && !criteriaFile) {
      formData.append('manual_criteria', JSON.stringify(manualCriteria));
    }
    
    await onAdd(disciplineId, formData);
    setLoading(false);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: '650px' }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Створити тест</h3>
        <form onSubmit={handleSubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Тип тесту</label>
            <select
              value={testData.type}
              onChange={(e) => setTestData({ ...testData, type: e.target.value })}
              style={styles.input}
            >
              <option value="lab">Лабораторна робота</option>
              <option value="control">Контрольна робота</option>
              <option value="exam">Іспит</option>
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Назва</label>
            <input
              type="text"
              value={testData.title}
              onChange={(e) => setTestData({ ...testData, title: e.target.value })}
              style={styles.input}
              placeholder="Контрольна робота №1"
              required
            />
          </div>

          <div style={styles.row}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Початок</label>
              <input
                type="datetime-local"
                value={testData.start_time}
                onChange={(e) => setTestData({ ...testData, start_time: e.target.value })}
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Закінчення</label>
              <input
                type="datetime-local"
                value={testData.end_time}
                onChange={(e) => setTestData({ ...testData, end_time: e.target.value })}
                style={styles.input}
                required
              />
            </div>
          </div>

          {/* PDF завдання */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>📄 PDF із завданням (опційно)</label>
            <div style={addTestStyles.fileUpload}>
              <input
                type="file"
                accept=".pdf"
                onChange={handleTaskFileChange}
                ref={taskFileRef}
                style={{ display: 'none' }}
              />
              <div 
                onClick={() => taskFileRef.current?.click()}
                style={addTestStyles.fileLabel}
              >
                {taskFile ? `✅ ${taskFile.name}` : '📤 Натисніть для вибору PDF'}
              </div>
            </div>
            <p style={addTestStyles.hint}>Студенти зможуть завантажити це завдання</p>
          </div>

          {/* Вибір режиму критеріїв */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>📊 Критерії оцінювання</label>
            <div style={addTestStyles.modeSelector}>
              {/* Кнопка завантаження Excel */}
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleCriteriaFileChange}
                style={{ display: 'none' }}
                id="criteriaFileUpload"
              />
              <label 
                htmlFor="criteriaFileUpload" 
                style={criteriaFile ? addTestStyles.modeActive : addTestStyles.modeBtn}
              >
                {criteriaFile ? `✅ ${criteriaFile.name}` : '📁 Завантажити Excel'}
              </label>
              
              {/* Кнопка ручного вводу */}
              <button
                type="button"
                onClick={() => {
                  setMode('manual');
                  setCriteriaFile(null);
                }}
                style={mode === 'manual' && !criteriaFile ? addTestStyles.modeActive : addTestStyles.modeBtn}
              >
                ✏️ Ввести вручну
              </button>
            </div>
            <p style={addTestStyles.hint}>
              Excel: перший рядок = назви критеріїв, бали в назві (напр: "Критерій – 5 б.")
            </p>
          </div>

          {/* Ручний ввід критеріїв */}
          {mode === 'manual' && !criteriaFile && (
            <div style={styles.criteriaSection}>
              {manualCriteria.map((crit, idx) => (
                <div key={idx} style={styles.criteriaRow}>
                  <input
                    type="text"
                    value={crit.name}
                    onChange={(e) => updateManualCriteria(idx, 'name', e.target.value)}
                    style={{ ...styles.input, flex: 2 }}
                    placeholder="Назва критерію"
                    required
                  />
                  <input
                    type="number"
                    value={crit.max_points}
                    onChange={(e) => updateManualCriteria(idx, 'max_points', e.target.value)}
                    style={{ ...styles.input, flex: 1, maxWidth: '100px' }}
                    placeholder="Бали"
                    min="0"
                    required
                  />
                  {manualCriteria.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeManualCriteria(idx)}
                      style={styles.removeBtn}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addManualCriteria} style={styles.addCriteriaBtn}>
                + Додати критерій
              </button>
              <p style={styles.totalPoints}>
                Всього балів: {manualCriteria.reduce((a, c) => a + c.max_points, 0)}
              </p>
            </div>
          )}

          <div style={styles.modalActions}>
            <button type="button" onClick={onClose} style={styles.secondaryBtn}>
              Скасувати
            </button>
            <button type="submit" style={styles.primaryBtn} disabled={loading}>
              {loading ? 'Створення...' : 'Створити тест'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// SUBMISSIONS LIST
// ============================================
function SubmissionsList({ submissions, showNotification, onUpdate, onAllowResubmit }) {
  const [grading, setGrading] = useState(null);

  const gradeWithBI = async (submissionId) => {
    setGrading(submissionId);
    
    try {
      const data = await api(`/submissions/${submissionId}/grade`, {
        method: 'POST'
      });
      showNotification(`Роботу оцінено: ${data.submission.total_grade} балів`, 'success');
      onUpdate();
    } catch (err) {
      showNotification(err.message, 'error');
    }
    
    setGrading(null);
  };

  if (submissions.length === 0) {
    return (
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Здані роботи</h3>
        <div style={styles.emptyState}>
          <p>Поки немає зданих робіт</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Здані роботи ({submissions.length})</h3>
      <div style={styles.submissionList}>
        {submissions.map(sub => (
          <div key={sub.id} style={styles.submissionCard}>
            <div style={styles.submissionHeader}>
              <span style={styles.studentName}>{sub.student_name}</span>
              <span style={styles.submissionDate}>
                {new Date(sub.submitted_at).toLocaleString('uk-UA')}
              </span>
            </div>
            <div style={styles.submissionDetails}>
              <span>{sub.discipline_name}</span>
              <span style={styles.testTypeBadge}>{testTypeLabels[sub.test_type]}</span>
              <span>{sub.test_title}</span>
            </div>
            <div style={styles.submissionActions}>
              {sub.status === 'graded' ? (
                <div style={styles.gradeDisplay}>
                  <span style={styles.gradeLabel}>Оцінка:</span>
                  <span style={styles.gradeValue}>{sub.total_grade}/{sub.max_points}</span>
                  {sub.ai_feedback && (
                    <p style={styles.feedbackText}>{sub.ai_feedback}</p>
                  )}
                </div>
              ) : sub.status === 'error' ? (
                <div style={{ color: '#ef4444' }}>
                  ⚠️ Помилка оцінювання
                  <button
                    onClick={() => gradeWithBI(sub.id)}
                    style={{ ...styles.aiBtn, marginLeft: '10px' }}
                    disabled={grading === sub.id}
                  >
                    Спробувати знову
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => gradeWithBI(sub.id)}
                  style={styles.aiBtn}
                  disabled={grading === sub.id}
                >
                  {grading === sub.id ? '🔄 BI оцінює...' : '🤖 Оцінити з BI'}
                </button>
              )}
              {/* Кнопка дозволу перездачі */}
              {onAllowResubmit && (
                <button
                  onClick={() => onAllowResubmit(sub.id)}
                  style={{
                    marginLeft: '10px',
                    padding: '8px 16px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    border: '1px solid #f59e0b',
                    borderRadius: '8px',
                    color: '#f59e0b',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  🔄 Дозволити перездачу
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// RESUBMIT REQUESTS VIEW (для викладача)
// ============================================
function ResubmitRequestsView({ requests, onApprove, onReject, showNotification }) {
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectComment, setRejectComment] = useState('');

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  const handleReject = () => {
    if (rejectComment.trim().length < 5) {
      showNotification('Вкажіть причину відмови (мін. 5 символів)', 'error');
      return;
    }
    onReject(rejectModal.id, rejectComment);
    setRejectModal(null);
    setRejectComment('');
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Запити на повторну здачу</h3>
      
      {pendingRequests.length === 0 && processedRequests.length === 0 ? (
        <div style={styles.emptyState}>
          <p>Немає запитів на повторну здачу</p>
        </div>
      ) : (
        <>
          {pendingRequests.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ color: '#f59e0b', marginBottom: '16px' }}>
                ⏳ Очікують розгляду ({pendingRequests.length})
              </h4>
              <div style={styles.submissionList}>
                {pendingRequests.map(req => (
                  <div key={req.id} style={{ ...styles.submissionCard, borderLeft: '4px solid #f59e0b' }}>
                    <div style={styles.submissionHeader}>
                      <span style={styles.studentName}>{req.student_name}</span>
                      <span style={styles.submissionDate}>
                        {new Date(req.created_at).toLocaleString('uk-UA')}
                      </span>
                    </div>
                    <div style={styles.submissionDetails}>
                      <span>{req.discipline_name}</span>
                      <span style={styles.testTypeBadge}>{req.test_title}</span>
                      <span style={{ color: '#94a3b8' }}>Група: {req.student_group}</span>
                    </div>
                    <div style={{ 
                      margin: '12px 0', 
                      padding: '12px', 
                      background: 'rgba(30, 41, 59, 0.5)', 
                      borderRadius: '8px' 
                    }}>
                      <strong style={{ color: '#94a3b8' }}>Причина:</strong>
                      <p style={{ color: '#e2e8f0', marginTop: '4px' }}>{req.reason}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => onApprove(req.id)}
                        style={{
                          padding: '10px 20px',
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        ✅ Схвалити
                      </button>
                      <button
                        onClick={() => setRejectModal(req)}
                        style={{
                          padding: '10px 20px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid #ef4444',
                          borderRadius: '8px',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        ❌ Відхилити
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {processedRequests.length > 0 && (
            <div>
              <h4 style={{ color: '#64748b', marginBottom: '16px' }}>
                📋 Історія ({processedRequests.length})
              </h4>
              <div style={styles.submissionList}>
                {processedRequests.slice(0, 10).map(req => (
                  <div key={req.id} style={{ 
                    ...styles.submissionCard, 
                    opacity: 0.7,
                    borderLeft: `4px solid ${req.status === 'approved' ? '#10b981' : '#ef4444'}`
                  }}>
                    <div style={styles.submissionHeader}>
                      <span style={styles.studentName}>{req.student_name}</span>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        backgroundColor: req.status === 'approved' ? '#065f46' : '#991b1b',
                        color: 'white'
                      }}>
                        {req.status === 'approved' ? '✅ Схвалено' : '❌ Відхилено'}
                      </span>
                    </div>
                    <div style={styles.submissionDetails}>
                      <span>{req.discipline_name} - {req.test_title}</span>
                    </div>
                    {req.teacher_comment && (
                      <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '8px' }}>
                        Коментар: {req.teacher_comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Модальне вікно відхилення */}
      {rejectModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>Відхилити запит</h3>
            <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
              Студент: {rejectModal.student_name}
            </p>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Причина відмови</label>
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                placeholder="Вкажіть причину відмови..."
              />
            </div>
            <div style={styles.modalActions}>
              <button 
                onClick={() => { setRejectModal(null); setRejectComment(''); }}
                style={styles.secondaryBtn}
              >
                Скасувати
              </button>
              <button 
                onClick={handleReject}
                style={{ ...styles.primaryBtn, background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
              >
                Відхилити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// STUDENT DASHBOARD
// ============================================
function StudentDashboard({ showNotification }) {
  const { user } = useAuth();
  const [disciplines, setDisciplines] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selectedDiscipline, setSelectedDiscipline] = useState(null);
  const [selectedTest, setSelectedTest] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resubmitModal, setResubmitModal] = useState(null); // submission для запиту
  const [resubmitReason, setResubmitReason] = useState('');
  const [resubmitStatuses, setResubmitStatuses] = useState({}); // статуси запитів

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [discData, subData] = await Promise.all([
        api('/disciplines'),
        api('/submissions')
      ]);
      setDisciplines(discData.disciplines || []);
      setSubmissions(subData.submissions || []);
      
      // Завантажуємо статуси запитів для всіх здач
      const statuses = {};
      for (const sub of (subData.submissions || [])) {
        try {
          const statusData = await api(`/submissions/${sub.id}/resubmit-status`);
          if (statusData.request) {
            statuses[sub.id] = statusData.request;
          }
        } catch {}
      }
      setResubmitStatuses(statuses);
    } catch (err) {
      showNotification(err.message, 'error');
    }
    setLoading(false);
  };

  const requestResubmit = async () => {
    if (!resubmitModal || !resubmitReason.trim()) return;
    
    try {
      await api(`/submissions/${resubmitModal.id}/resubmit-request`, {
        method: 'POST',
        body: { reason: resubmitReason }
      });
      showNotification('Запит надіслано! Очікуйте рішення викладача.', 'success');
      setResubmitModal(null);
      setResubmitReason('');
      loadData();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const loadDisciplineDetails = async (id) => {
    try {
      const data = await api(`/disciplines/${id}`);
      setSelectedDiscipline(data.discipline);
      setSelectedTest(null);
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const isTestActive = (test) => {
    const now = new Date();
    return new Date(test.start_time) <= now && now <= new Date(test.end_time);
  };

  const hasSubmitted = (testId) => {
    return submissions.some(s => s.test_id === testId);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const allowedTypes = [
      'application/pdf',
      'text/markdown',
      'text/plain',
      'text/x-markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExtensions = ['.pdf', '.md', '.txt', '.doc', '.docx'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (allowedTypes.includes(file.type) || allowedExtensions.includes(ext)) {
      setUploadedFile(file);
    } else {
      showNotification('Дозволені формати: PDF, MD, TXT, DOC, DOCX', 'error');
    }
  };

  const handleSubmit = async () => {
    if (!uploadedFile || !selectedTest) return;

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('test_id', selectedTest.id);
      formData.append('file', uploadedFile);

      await api('/submissions', {
        method: 'POST',
        body: formData
      });

      showNotification('Роботу успішно здано! Очікуйте на перевірку BI.', 'success');
      setUploadedFile(null);
      setSelectedTest(null);
      await loadData();
      // Оновлюємо деталі дисципліни
      if (selectedDiscipline) {
        await loadDisciplineDetails(selectedDiscipline.id);
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }

    setIsSubmitting(false);
  };

  if (loading) {
    return <div style={styles.loadingText}>Завантаження...</div>;
  }

  return (
    <div style={styles.dashboard}>
      <div style={styles.studentWelcome}>
        <h2>Вітаємо, {user.name}!</h2>
        <p>Група: {user.group} | Курс: {user.course}</p>
      </div>

      <div style={styles.studentContent}>
        <div style={styles.disciplineSelect}>
          <h3 style={styles.sectionTitle}>Доступні дисципліни</h3>
          <div style={styles.disciplineList}>
            {disciplines.map(disc => (
              <div
                key={disc.id}
                style={{
                  ...styles.disciplineOption,
                  ...(selectedDiscipline?.id === disc.id ? styles.disciplineOptionActive : {})
                }}
                onClick={() => loadDisciplineDetails(disc.id)}
              >
                <span style={styles.disciplineIcon}>📚</span>
                <span>{disc.name}</span>
                <span style={styles.testCountSmall}>{disc.tests_count || 0} тестів</span>
              </div>
            ))}
          </div>
        </div>

        {selectedDiscipline && (
          <div style={styles.testSelect}>
            <h3 style={styles.sectionTitle}>Тести з "{selectedDiscipline.name}"</h3>
            <div style={styles.testGrid}>
              {selectedDiscipline.tests?.map(test => {
                const active = isTestActive(test);
                const submitted = hasSubmitted(test.id);

                return (
                  <div
                    key={test.id}
                    style={{
                      ...styles.testCard,
                      ...(selectedTest?.id === test.id ? styles.testCardActive : {}),
                      ...(!active && !submitted ? styles.testCardDisabled : {})
                    }}
                    onClick={() => active && !submitted && setSelectedTest(test)}
                  >
                    <div style={styles.testCardHeader}>
                      <span style={styles.testCardType}>{testTypeLabels[test.type]}</span>
                      {!active && new Date() < new Date(test.start_time) && (
                        <span style={styles.statusBadge}>Очікується</span>
                      )}
                      {!active && new Date() > new Date(test.end_time) && (
                        <span style={{ ...styles.statusBadge, backgroundColor: '#991b1b' }}>Завершено</span>
                      )}
                      {active && !submitted && (
                        <span style={{ ...styles.statusBadge, backgroundColor: '#065f46' }}>Активний</span>
                      )}
                      {submitted && (
                        <span style={{ ...styles.statusBadge, backgroundColor: '#1e40af' }}>Здано</span>
                      )}
                    </div>
                    <h4 style={{ color: '#f1f5f9', margin: '10px 0' }}>{test.title}</h4>
                    <div style={styles.testCardTime}>
                      <p>Початок: {new Date(test.start_time).toLocaleString('uk-UA')}</p>
                      <p>Кінець: {new Date(test.end_time).toLocaleString('uk-UA')}</p>
                    </div>
                    <p style={styles.maxPoints}>Макс. балів: {test.max_points}</p>
                    
                    {test.my_submission && test.my_submission.total_grade !== null && (
                      <div style={styles.submissionResult}>
                        <p style={styles.resultGrade}>
                          Оцінка: {test.my_submission.total_grade}/{test.max_points}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedTest && (
          <div style={styles.uploadSection}>
            <h3 style={styles.sectionTitle}>
              Завантаження роботи: {selectedTest.title}
            </h3>
            <div style={styles.uploadArea}>
              <input
                type="file"
                accept=".pdf,.md,.txt,.doc,.docx"
                onChange={handleFileChange}
                style={styles.fileInput}
                id="fileUpload"
              />
              <label htmlFor="fileUpload" style={styles.uploadLabel}>
                {uploadedFile ? (
                  <>
                    <span style={styles.uploadIcon}>📄</span>
                    <span>{uploadedFile.name}</span>
                  </>
                ) : (
                  <>
                    <span style={styles.uploadIcon}>📤</span>
                    <span>Натисніть для вибору файлу (PDF, MD, TXT, DOC)</span>
                  </>
                )}
              </label>
            </div>
            {uploadedFile && (
              <button
                onClick={handleSubmit}
                style={styles.submitBtn}
                disabled={isSubmitting}
              >
                {isSubmitting ? '⏳ Завантаження...' : '✅ Здати роботу'}
              </button>
            )}
          </div>
        )}

        {submissions.length > 0 && (
          <div style={styles.mySubmissions}>
            <h3 style={styles.sectionTitle}>Мої роботи</h3>
            <div style={styles.submissionHistory}>
              {submissions.map(sub => {
                const resubmitRequest = resubmitStatuses[sub.id];
                return (
                  <div key={sub.id} style={styles.historyItem}>
                    <div style={styles.historyMain}>
                      <span style={styles.historyDisc}>{sub.discipline_name}</span>
                      <span style={styles.historyType}>{testTypeLabels[sub.test_type]}</span>
                    </div>
                    <div style={styles.historyMeta}>
                      <span>{new Date(sub.submitted_at).toLocaleString('uk-UA')}</span>
                      {sub.total_grade !== null ? (
                        <span style={styles.historyGrade}>Оцінка: {sub.total_grade}/{sub.max_points}</span>
                      ) : (
                        <span style={styles.historyPending}>
                          {sub.status === 'grading' ? 'Оцінюється...' : sub.status === 'error' ? '⚠️ Помилка' : 'На перевірці'}
                        </span>
                      )}
                    </div>
                    {/* Кнопка запиту на перездачу */}
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {resubmitRequest ? (
                        <span style={{
                          fontSize: '13px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          backgroundColor: resubmitRequest.status === 'pending' ? '#854d0e' : 
                                          resubmitRequest.status === 'approved' ? '#065f46' : '#991b1b',
                          color: 'white'
                        }}>
                          {resubmitRequest.status === 'pending' && '⏳ Запит на розгляді'}
                          {resubmitRequest.status === 'approved' && '✅ Перездачу дозволено'}
                          {resubmitRequest.status === 'rejected' && `❌ Відмовлено: ${resubmitRequest.teacher_comment}`}
                        </span>
                      ) : (
                        <button
                          onClick={() => setResubmitModal(sub)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '13px',
                            background: 'rgba(245, 158, 11, 0.2)',
                            border: '1px solid #f59e0b',
                            borderRadius: '6px',
                            color: '#f59e0b',
                            cursor: 'pointer'
                          }}
                        >
                          🔄 Запит на перездачу
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Модальне вікно запиту на перездачу */}
        {resubmitModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modal}>
              <h3 style={styles.modalTitle}>Запит на повторну здачу</h3>
              <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
                Тест: {resubmitModal.test_title || resubmitModal.discipline_name}
              </p>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Причина запиту</label>
                <textarea
                  value={resubmitReason}
                  onChange={(e) => setResubmitReason(e.target.value)}
                  style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }}
                  placeholder="Опишіть причину, чому потрібна повторна здача (мін. 10 символів)..."
                />
              </div>
              <div style={styles.modalActions}>
                <button 
                  onClick={() => { setResubmitModal(null); setResubmitReason(''); }}
                  style={styles.secondaryBtn}
                >
                  Скасувати
                </button>
                <button 
                  onClick={requestResubmit}
                  style={styles.primaryBtn}
                  disabled={resubmitReason.trim().length < 10}
                >
                  Надіслати запит
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// RESULTS VIEW COMPONENT
// ============================================
function ResultsView({ disciplines, showNotification }) {
  const [resultType, setResultType] = useState(null); // 'individual' | 'batch'
  const [selectedDiscipline, setSelectedDiscipline] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [selectedTests, setSelectedTests] = useState([]); // Для чекбоксів

  // Завантажити статистику по дисципліні
  const loadDisciplineStats = async (disciplineId) => {
    setLoading(true);
    setSelectedTests([]); // Скидаємо вибір
    try {
      const data = await api(`/submissions/discipline/${disciplineId}/stats`);
      setStats(data);
      setSelectedDiscipline(disciplines.find(d => d.id === disciplineId));
    } catch (err) {
      showNotification(err.message, 'error');
    }
    setLoading(false);
  };

  // Перемикання чекбокса тесту
  const toggleTestSelection = (testId) => {
    setSelectedTests(prev => 
      prev.includes(testId) 
        ? prev.filter(id => id !== testId)
        : [...prev, testId]
    );
  };

  // Вибрати/зняти всі
  const toggleAllTests = () => {
    if (!stats) return;
    const testsWithResults = stats.tests.filter(t => (t.graded_count || 0) > 0);
    if (selectedTests.length === testsWithResults.length) {
      setSelectedTests([]);
    } else {
      setSelectedTests(testsWithResults.map(t => t.id));
    }
  };

  // Завантажити вибрані результати
  const downloadSelectedResults = async () => {
    if (selectedTests.length === 0) {
      showNotification('Виберіть хоча б один тест', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/submissions/discipline/${stats.discipline.id}/selected-results`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ testIds: selectedTests })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Помилка завантаження');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stats.discipline.name}_вибрані_результати.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification('Файл завантажено', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  // Завантажити результати тесту
  const downloadTestResults = async (testId, testTitle) => {
    try {
      const response = await fetch(`${API_URL}/submissions/test/${testId}/results`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Помилка завантаження');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Результати_${testTitle}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  // Завантажити список batch результатів
  const loadBatchResults = async () => {
    setLoading(true);
    try {
      const data = await api('/batch/results-list');
      setBatchResults(data.results || []);
    } catch (err) {
      setBatchResults([]);
    }
    setLoading(false);
  };

  // Видалити batch результат
  const deleteBatchResult = async (id) => {
    if (!confirm('Видалити цей результат?')) return;
    try {
      await api(`/batch/results/${id}`, { method: 'DELETE' });
      setBatchResults(prev => prev.filter(r => r.id !== id));
      showNotification('Результат видалено', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const resultsStyles = {
    container: {
      padding: '20px'
    },
    typeSelector: {
      display: 'flex',
      gap: '20px',
      marginBottom: '30px',
      justifyContent: 'center'
    },
    typeCard: {
      background: 'linear-gradient(145deg, #1e293b, #0f172a)',
      borderRadius: '16px',
      padding: '30px',
      border: '2px solid #334155',
      cursor: 'pointer',
      transition: 'all 0.3s',
      textAlign: 'center',
      width: '280px'
    },
    typeCardActive: {
      borderColor: '#3b82f6',
      background: 'rgba(59, 130, 246, 0.1)'
    },
    typeIcon: {
      fontSize: '48px',
      marginBottom: '15px'
    },
    typeTitle: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#f1f5f9',
      marginBottom: '10px'
    },
    typeDesc: {
      color: '#94a3b8',
      fontSize: '14px'
    },
    backBtn: {
      background: 'transparent',
      border: '1px solid #475569',
      borderRadius: '8px',
      padding: '8px 16px',
      color: '#94a3b8',
      cursor: 'pointer',
      marginBottom: '20px'
    },
    disciplineList: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '20px'
    },
    disciplineCard: {
      background: 'linear-gradient(145deg, #1e293b, #0f172a)',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid #334155',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    statsCard: {
      background: 'linear-gradient(145deg, #1e293b, #0f172a)',
      borderRadius: '16px',
      padding: '25px',
      border: '1px solid #334155',
      marginBottom: '20px'
    },
    statsHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px'
    },
    statsTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: '#f1f5f9'
    },
    downloadAllBtn: {
      background: 'linear-gradient(135deg, #10b981, #059669)',
      border: 'none',
      borderRadius: '10px',
      padding: '12px 24px',
      color: 'white',
      fontWeight: '600',
      cursor: 'pointer'
    },
    testList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    },
    testRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '15px 20px',
      background: 'rgba(30, 41, 59, 0.5)',
      borderRadius: '10px'
    },
    testInfo: {
      flex: 1
    },
    testTitle: {
      fontWeight: '600',
      color: '#f1f5f9',
      marginBottom: '5px'
    },
    testMeta: {
      color: '#94a3b8',
      fontSize: '14px'
    },
    testActions: {
      display: 'flex',
      gap: '10px'
    },
    downloadBtn: {
      background: 'rgba(59, 130, 246, 0.2)',
      border: '1px solid #3b82f6',
      borderRadius: '8px',
      padding: '8px 16px',
      color: '#3b82f6',
      cursor: 'pointer',
      fontSize: '14px'
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px',
      color: '#64748b'
    }
  };

  // Вибір типу результатів
  if (!resultType) {
    return (
      <div style={resultsStyles.container}>
        <h3 style={styles.sectionTitle}>Результати оцінювання</h3>
        <p style={{ color: '#94a3b8', marginBottom: '30px', textAlign: 'center' }}>
          Виберіть тип результатів для перегляду
        </p>
        <div style={resultsStyles.typeSelector}>
          <div 
            style={resultsStyles.typeCard}
            onClick={() => setResultType('individual')}
            onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = '#334155'}
          >
            <div style={resultsStyles.typeIcon}>📝</div>
            <div style={resultsStyles.typeTitle}>Результати окремих робіт</div>
            <div style={resultsStyles.typeDesc}>
              Оцінки студентів, які здали роботи через платформу
            </div>
          </div>
          <div 
            style={resultsStyles.typeCard}
            onClick={() => { setResultType('batch'); loadBatchResults(); }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = '#334155'}
          >
            <div style={resultsStyles.typeIcon}>📊</div>
            <div style={resultsStyles.typeTitle}>Результати масового оцінювання</div>
            <div style={resultsStyles.typeDesc}>
              Excel файли з результатами batch-оцінювання
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Результати окремих робіт
  if (resultType === 'individual') {
    // Вибір дисципліни
    if (!selectedDiscipline) {
      return (
        <div style={resultsStyles.container}>
          <button 
            style={resultsStyles.backBtn} 
            onClick={() => setResultType(null)}
          >
            ← Назад
          </button>
          <h3 style={styles.sectionTitle}>Результати окремих робіт</h3>
          <p style={{ color: '#94a3b8', marginBottom: '20px' }}>
            Виберіть дисципліну для перегляду результатів
          </p>
          
          {disciplines.length === 0 ? (
            <div style={resultsStyles.emptyState}>
              <p>У вас ще немає дисциплін</p>
            </div>
          ) : (
            <div style={resultsStyles.disciplineList}>
              {disciplines.map(disc => (
                <div 
                  key={disc.id} 
                  style={resultsStyles.disciplineCard}
                  onClick={() => loadDisciplineStats(disc.id)}
                  onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                  onMouseOut={(e) => e.currentTarget.style.borderColor = '#334155'}
                >
                  <h4 style={{ color: '#f1f5f9', marginBottom: '10px' }}>{disc.name}</h4>
                  <p style={{ color: '#94a3b8', fontSize: '14px' }}>{disc.tests_count || 0} тестів</p>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Статистика по дисципліні
    return (
      <div style={resultsStyles.container}>
        <button 
          style={resultsStyles.backBtn} 
          onClick={() => { setSelectedDiscipline(null); setStats(null); }}
        >
          ← Назад до дисциплін
        </button>
        
        {loading ? (
          <div style={resultsStyles.emptyState}>Завантаження...</div>
        ) : stats ? (
          <div style={resultsStyles.statsCard}>
            <div style={resultsStyles.statsHeader}>
              <div>
                <div style={resultsStyles.statsTitle}>{stats.discipline.name}</div>
                <div style={{ color: '#94a3b8', marginTop: '5px' }}>
                  {stats.tests.length} тестів
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {selectedTests.length > 0 && (
                  <button 
                    style={resultsStyles.downloadAllBtn}
                    onClick={downloadSelectedResults}
                  >
                    📥 Завантажити вибрані ({selectedTests.length})
                  </button>
                )}
              </div>
            </div>
            
            {stats.tests.length === 0 ? (
              <div style={resultsStyles.emptyState}>
                <p>Немає тестів у цій дисципліні</p>
              </div>
            ) : (
              <>
                {/* Кнопка вибрати всі */}
                <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#94a3b8' }}>
                    <input 
                      type="checkbox"
                      checked={selectedTests.length === stats.tests.filter(t => (t.graded_count || 0) > 0).length && selectedTests.length > 0}
                      onChange={toggleAllTests}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    Вибрати всі з результатами
                  </label>
                </div>
                
                <div style={resultsStyles.testList}>
                  {stats.tests.map(test => {
                    const hasResults = (test.graded_count || 0) > 0;
                    return (
                      <div key={test.id} style={resultsStyles.testRow}>
                        {/* Чекбокс */}
                        <div style={{ marginRight: '15px' }}>
                          <input 
                            type="checkbox"
                            checked={selectedTests.includes(test.id)}
                            onChange={() => toggleTestSelection(test.id)}
                            disabled={!hasResults}
                            style={{ 
                              width: '18px', 
                              height: '18px', 
                              cursor: hasResults ? 'pointer' : 'not-allowed',
                              opacity: hasResults ? 1 : 0.3
                            }}
                          />
                        </div>
                        
                        <div style={resultsStyles.testInfo}>
                          <div style={resultsStyles.testTitle}>{test.title}</div>
                          <div style={resultsStyles.testMeta}>
                            {test.type === 'lab' ? 'Лабораторна' : test.type === 'control' ? 'Контрольна' : 'Іспит'}
                            {' • '}
                            Оцінено: {test.graded_count || 0} / {test.total_submissions || 0}
                            {test.avg_grade && ` • Середня: ${test.avg_grade}`}
                          </div>
                        </div>
                        <div style={resultsStyles.testActions}>
                          {hasResults && (
                            <button 
                              style={resultsStyles.downloadBtn}
                              onClick={() => downloadTestResults(test.id, test.title)}
                            >
                              📥 Завантажити
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={resultsStyles.emptyState}>
            <p>Не вдалося завантажити статистику</p>
          </div>
        )}
      </div>
    );
  }

  // Результати масового оцінювання
  if (resultType === 'batch') {
    return (
      <div style={resultsStyles.container}>
        <button 
          style={resultsStyles.backBtn} 
          onClick={() => setResultType(null)}
        >
          ← Назад
        </button>
        <h3 style={styles.sectionTitle}>Результати масового оцінювання</h3>
        
        {loading ? (
          <div style={resultsStyles.emptyState}>Завантаження...</div>
        ) : batchResults.length === 0 ? (
          <div style={resultsStyles.emptyState}>
            <p style={{ marginBottom: '15px' }}>Немає збережених результатів масового оцінювання</p>
            <p style={{ color: '#64748b', fontSize: '14px' }}>
              Перейдіть до вкладки "Масове оцінювання" для обробки нових робіт.
            </p>
          </div>
        ) : (
          <div style={resultsStyles.testList}>
            {batchResults.map((result) => (
              <div key={result.id} style={resultsStyles.testRow}>
                <div style={resultsStyles.testInfo}>
                  <div style={resultsStyles.testTitle}>{result.name || 'Без назви'}</div>
                  <div style={resultsStyles.testMeta}>
                    {result.date} • {result.success} успішно / {result.errors} помилок
                  </div>
                </div>
                <div style={resultsStyles.testActions}>
                  <button 
                    style={resultsStyles.downloadBtn}
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = `${API_URL}/batch/download/${result.file}`;
                      link.setAttribute('download', `Результати_${result.name || 'batch'}.xlsx`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                  >
                    📥 Завантажити
                  </button>
                  <button 
                    style={{ ...resultsStyles.downloadBtn, background: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444', color: '#ef4444' }}
                    onClick={() => deleteBatchResult(result.id)}
                  >
                    🗑️ Видалити
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ============================================
// BATCH GRADING COMPONENT
// ============================================
function BatchGrading({ showNotification }) {
  const [step, setStep] = useState(1);
  const [disciplineName, setDisciplineName] = useState('');
  const [testName, setTestName] = useState('');
  const [templateFile, setTemplateFile] = useState(null);
  const [template, setTemplate] = useState(null);
  const [studentFiles, setStudentFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const handleTemplateUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      showNotification('Завантажте Excel файл (.xlsx або .xls)', 'error');
      return;
    }

    setTemplateFile(file);

    // Завантажуємо на сервер для парсингу
    const formData = new FormData();
    formData.append('template', file);

    try {
      const response = await fetch('/api/batch/upload-template', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setTemplate(data.template);
      showNotification(`Знайдено ${data.template.criteria.length} критеріїв`, 'success');
    } catch (err) {
      showNotification(err.message, 'error');
      setTemplateFile(null);
    }
  };

  const handleFilesSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const validFiles = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext);
    });

    if (validFiles.length !== files.length) {
      showNotification(`${files.length - validFiles.length} файлів пропущено (непідтримуваний формат)`, 'info');
    }

    setStudentFiles(validFiles);
    showNotification(`Вибрано ${validFiles.length} файлів`, 'success');
  };

  const startGrading = async () => {
    if (!template || studentFiles.length === 0) {
      showNotification('Завантажте шаблон і файли робіт', 'error');
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('template', JSON.stringify(template));
    formData.append('discipline_name', disciplineName);
    formData.append('test_name', testName);
    
    studentFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      // Симуляція прогресу
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 5, 90));
      }, 500);

      const response = await fetch('/api/batch/grade', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setResults(data);
      setStep(4);
      showNotification(`Оцінено ${data.success} робіт!`, 'success');

    } catch (err) {
      showNotification(err.message, 'error');
    }

    setIsProcessing(false);
  };

  const downloadResults = async () => {
    if (!results?.downloadUrl) return;
    
    try {
      const response = await fetch(results.downloadUrl, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Помилка завантаження');
      }
      
      // Отримуємо blob і створюємо посилання для завантаження
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Результати_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const reset = () => {
    setStep(1);
    setDisciplineName('');
    setTestName('');
    setTemplateFile(null);
    setTemplate(null);
    setStudentFiles([]);
    setResults(null);
    setProgress(0);
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>📊 Масове оцінювання робіт</h3>
      
      {/* Прогрес-бар кроків */}
      <div style={batchStyles.stepsBar}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{
            ...batchStyles.step,
            ...(step >= s ? batchStyles.stepActive : {})
          }}>
            <div style={batchStyles.stepNumber}>{s}</div>
            <div style={batchStyles.stepLabel}>
              {s === 1 && 'Налаштування'}
              {s === 2 && 'Шаблон'}
              {s === 3 && 'Роботи'}
              {s === 4 && 'Результати'}
            </div>
          </div>
        ))}
      </div>

      {/* Крок 1: Налаштування */}
      {step === 1 && (
        <div style={batchStyles.stepContent}>
          <h4 style={batchStyles.stepTitle}>Крок 1: Інформація про тест</h4>
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Назва дисципліни</label>
            <input
              type="text"
              value={disciplineName}
              onChange={(e) => setDisciplineName(e.target.value)}
              style={styles.input}
              placeholder="Наприклад: Прикладна математика"
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Назва контрольної/тесту</label>
            <input
              type="text"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              style={styles.input}
              placeholder="Наприклад: Контрольна робота №1"
            />
          </div>

          <button 
            onClick={() => setStep(2)} 
            style={styles.primaryBtn}
            disabled={!disciplineName || !testName}
          >
            Далі →
          </button>
        </div>
      )}

      {/* Крок 2: Шаблон критеріїв */}
      {step === 2 && (
        <div style={batchStyles.stepContent}>
          <h4 style={batchStyles.stepTitle}>Крок 2: Завантажте Excel-шаблон з критеріями</h4>
          
          <p style={batchStyles.hint}>
            Завантажте Excel файл, де в першому рядку є назви критеріїв оцінювання.
            Бали можна вказати в назві (наприклад: "Аргументованість – 5 б.")
          </p>

          <div style={batchStyles.uploadBox}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleTemplateUpload}
              style={{ display: 'none' }}
              id="templateUpload"
            />
            <label htmlFor="templateUpload" style={batchStyles.uploadLabel}>
              {templateFile ? (
                <>
                  <span style={batchStyles.uploadIcon}>📋</span>
                  <span>{templateFile.name}</span>
                </>
              ) : (
                <>
                  <span style={batchStyles.uploadIcon}>📤</span>
                  <span>Натисніть для вибору Excel файлу</span>
                </>
              )}
            </label>
          </div>

          {template && (
            <div style={batchStyles.criteriaPreview}>
              <h5>Знайдені критерії:</h5>
              <ul>
                {template.criteria.map((c, i) => (
                  <li key={i}>{c.name} — макс. {c.maxPoints} б.</li>
                ))}
              </ul>
              <p style={batchStyles.totalMax}>
                Загальний максимум: {template.criteria.reduce((s, c) => s + c.maxPoints, 0)} балів
              </p>
            </div>
          )}

          <div style={batchStyles.buttons}>
            <button onClick={() => setStep(1)} style={styles.secondaryBtn}>
              ← Назад
            </button>
            <button 
              onClick={() => setStep(3)} 
              style={styles.primaryBtn}
              disabled={!template}
            >
              Далі →
            </button>
          </div>
        </div>
      )}

      {/* Крок 3: Файли робіт */}
      {step === 3 && (
        <div style={batchStyles.stepContent}>
          <h4 style={batchStyles.stepTitle}>Крок 3: Завантажте роботи студентів</h4>
          
          <p style={batchStyles.hint}>
            Виберіть файли робіт студентів (PDF, DOC, DOCX, TXT, MD).
            Ім'я файлу буде використано як ім'я студента.
          </p>

          <div style={batchStyles.uploadBox}>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md"
              multiple
              onChange={handleFilesSelect}
              style={{ display: 'none' }}
              id="filesUpload"
              webkitdirectory=""
              directory=""
            />
            <label htmlFor="filesUpload" style={batchStyles.uploadLabel}>
              <span style={batchStyles.uploadIcon}>📁</span>
              <span>Натисніть для вибору файлів або папки</span>
            </label>
          </div>

          {studentFiles.length > 0 && (
            <div style={batchStyles.filesList}>
              <h5>Вибрано файлів: {studentFiles.length}</h5>
              <div style={batchStyles.filesGrid}>
                {studentFiles.slice(0, 10).map((f, i) => (
                  <div key={i} style={batchStyles.fileItem}>
                    📄 {f.name}
                  </div>
                ))}
                {studentFiles.length > 10 && (
                  <div style={batchStyles.fileItem}>
                    ...і ще {studentFiles.length - 10} файлів
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={batchStyles.buttons}>
            <button onClick={() => setStep(2)} style={styles.secondaryBtn}>
              ← Назад
            </button>
            <button 
              onClick={startGrading} 
              style={batchStyles.gradeBtn}
              disabled={studentFiles.length === 0 || isProcessing}
            >
              {isProcessing ? (
                <>🔄 Оцінювання... {progress}%</>
              ) : (
                <>🤖 Почати оцінювання ({studentFiles.length} робіт)</>
              )}
            </button>
          </div>

          {isProcessing && (
            <div style={batchStyles.progressBar}>
              <div style={{ ...batchStyles.progressFill, width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Крок 4: Результати */}
      {step === 4 && results && (
        <div style={batchStyles.stepContent}>
          <h4 style={batchStyles.stepTitle}>✅ Оцінювання завершено!</h4>
          
          <div style={batchStyles.resultsSummary}>
            <div style={batchStyles.resultBox}>
              <span style={batchStyles.resultNumber}>{results.success}</span>
              <span>Оцінено</span>
            </div>
            <div style={{ ...batchStyles.resultBox, borderColor: '#ef4444' }}>
              <span style={{ ...batchStyles.resultNumber, color: '#ef4444' }}>{results.errors}</span>
              <span>Помилок</span>
            </div>
          </div>

          {results.results && results.results.length > 0 && (
            <div style={batchStyles.resultsTable}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={batchStyles.th}>Файл/Студент</th>
                    <th style={batchStyles.th}>Оцінка</th>
                    <th style={batchStyles.th}>Відгук</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      <td style={batchStyles.td}>{r.info?.name || r.fileNameWithoutExt || r.file}</td>
                      <td style={batchStyles.td}>
                        <strong style={{ color: '#10b981' }}>{r.total}</strong>
                      </td>
                      <td style={batchStyles.td}>{r.feedback}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.results.length > 10 && (
                <p style={{ textAlign: 'center', color: '#64748b', marginTop: '10px' }}>
                  ...і ще {results.results.length - 10} результатів
                </p>
              )}
            </div>
          )}

          <div style={batchStyles.buttons}>
            <button onClick={reset} style={styles.secondaryBtn}>
              🔄 Нове оцінювання
            </button>
            <button onClick={downloadResults} style={batchStyles.downloadBtn}>
              📥 Завантажити Excel з результатами
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Стилі для BatchGrading
const batchStyles = {
  stepsBar: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '30px',
    padding: '0 20px'
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    opacity: 0.5
  },
  stepActive: {
    opacity: 1
  },
  stepNumber: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    marginBottom: '8px'
  },
  stepLabel: {
    fontSize: '13px',
    color: '#94a3b8'
  },
  stepContent: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '30px',
    border: '1px solid #334155'
  },
  stepTitle: {
    fontSize: '20px',
    marginBottom: '20px',
    color: '#f1f5f9'
  },
  hint: {
    color: '#94a3b8',
    marginBottom: '20px',
    fontSize: '14px'
  },
  uploadBox: {
    marginBottom: '20px'
  },
  uploadLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    border: '2px dashed #475569',
    borderRadius: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#94a3b8'
  },
  uploadIcon: {
    fontSize: '40px',
    marginBottom: '12px'
  },
  criteriaPreview: {
    background: 'rgba(59, 130, 246, 0.1)',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px'
  },
  totalMax: {
    marginTop: '10px',
    fontWeight: 'bold',
    color: '#3b82f6'
  },
  buttons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px'
  },
  gradeBtn: {
    padding: '16px 32px',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  progressBar: {
    height: '8px',
    background: '#334155',
    borderRadius: '4px',
    marginTop: '20px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    transition: 'width 0.3s'
  },
  filesList: {
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px'
  },
  filesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px',
    marginTop: '10px'
  },
  fileItem: {
    padding: '8px 12px',
    background: 'rgba(59, 130, 246, 0.1)',
    borderRadius: '8px',
    fontSize: '13px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  resultsSummary: {
    display: 'flex',
    gap: '20px',
    marginBottom: '30px'
  },
  resultBox: {
    flex: 1,
    padding: '30px',
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '16px',
    textAlign: 'center',
    border: '2px solid #10b981'
  },
  resultNumber: {
    fontSize: '48px',
    fontWeight: 'bold',
    color: '#10b981',
    display: 'block'
  },
  resultsTable: {
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
    maxHeight: '400px',
    overflow: 'auto'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    borderBottom: '2px solid #334155',
    color: '#94a3b8'
  },
  td: {
    padding: '12px',
    borderBottom: '1px solid #1e293b',
    color: '#e2e8f0'
  },
  downloadBtn: {
    padding: '16px 32px',
    background: 'linear-gradient(135deg, #10b981, #059669)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit'
  }
};

// Стилі для AddTestModal
const addTestStyles = {
  fileUpload: {
    marginBottom: '10px'
  },
  fileLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    border: '2px dashed #475569',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#94a3b8',
    fontSize: '14px'
  },
  hint: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '8px'
  },
  modeSelector: {
    display: 'flex',
    gap: '10px',
    marginBottom: '10px'
  },
  modeBtn: {
    flex: 1,
    padding: '14px',
    background: 'rgba(30, 41, 59, 0.5)',
    border: '2px solid #334155',
    borderRadius: '10px',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modeActive: {
    flex: 1,
    padding: '14px',
    background: 'rgba(59, 130, 246, 0.2)',
    border: '2px solid #3b82f6',
    borderRadius: '10px',
    color: '#3b82f6',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
    fontWeight: '600',
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

// ============================================
// GLOBAL STYLES
// ============================================
const globalStyles = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes slideIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  
  input:focus, select:focus {
    border-color: #3b82f6 !important;
    outline: none;
  }
  
  button:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

// ============================================
// COMPONENT STYLES
// ============================================
const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    fontFamily: "'Source Sans Pro', sans-serif",
    color: '#e2e8f0'
  },
  loadingScreen: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a'
  },
  loadingSpinner: {
    width: '50px',
    height: '50px',
    border: '3px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '20px',
    color: '#94a3b8',
    textAlign: 'center',
    padding: '40px'
  },
  notification: {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '16px 24px',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '500',
    zIndex: 1000,
    animation: 'fadeIn 0.3s ease',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 40px',
    borderBottom: '1px solid #334155',
    background: 'rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(10px)'
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  logoIcon: {
    fontSize: '32px',
    color: '#3b82f6'
  },
  logoText: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  logoSub: {
    fontSize: '12px',
    color: '#64748b',
    marginLeft: '8px'
  },
  userBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px'
  },
  userName: {
    color: '#94a3b8'
  },
  logoutBtn: {
    padding: '8px 20px',
    background: 'transparent',
    border: '1px solid #475569',
    borderRadius: '8px',
    color: '#94a3b8',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit'
  },
  main: {
    minHeight: 'calc(100vh - 140px)',
    padding: '40px'
  },
  footer: {
    textAlign: 'center',
    padding: '20px',
    color: '#64748b',
    borderTop: '1px solid #1e293b'
  },
  authContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 'calc(100vh - 200px)'
  },
  authCard: {
    width: '100%',
    maxWidth: '440px',
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '24px',
    padding: '40px',
    border: '1px solid #334155',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
    animation: 'slideIn 0.4s ease'
  },
  authHeader: {
    textAlign: 'center',
    marginBottom: '32px'
  },
  authTitle: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '28px',
    fontWeight: '700',
    marginBottom: '8px',
    color: '#f1f5f9'
  },
  authSubtitle: {
    color: '#64748b'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1
  },
  label: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#94a3b8'
  },
  input: {
    padding: '14px 18px',
    background: '#0f172a',
    border: '2px solid #334155',
    borderRadius: '12px',
    color: '#e2e8f0',
    fontSize: '16px',
    fontFamily: 'inherit',
    transition: 'all 0.2s'
  },
  row: {
    display: 'flex',
    gap: '16px'
  },
  primaryBtn: {
    padding: '16px 32px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
    fontFamily: 'inherit',
    marginTop: '8px'
  },
  secondaryBtn: {
    padding: '12px 24px',
    background: 'transparent',
    border: '2px solid #475569',
    borderRadius: '10px',
    color: '#94a3b8',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit'
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#3b82f6',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px'
  },
  authFooter: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    marginTop: '24px',
    color: '#64748b'
  },
  demoCredentials: {
    marginTop: '32px',
    padding: '16px',
    background: 'rgba(59, 130, 246, 0.1)',
    borderRadius: '12px',
    border: '1px solid rgba(59, 130, 246, 0.2)',
    fontSize: '13px',
    color: '#94a3b8'
  },
  demoTitle: {
    fontWeight: '600',
    color: '#3b82f6',
    marginBottom: '8px'
  },
  dashboard: {
    maxWidth: '1400px',
    margin: '0 auto'
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '32px',
    borderBottom: '2px solid #1e293b',
    paddingBottom: '16px'
  },
  tab: {
    padding: '12px 24px',
    background: 'transparent',
    border: 'none',
    borderRadius: '10px',
    color: '#64748b',
    fontSize: '15px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit'
  },
  tabActive: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  section: {
    marginBottom: '40px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  sectionTitle: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '22px',
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: '20px'
  },
  addBtn: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px',
    color: '#64748b'
  },
  disciplineGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '24px'
  },
  disciplineCard: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #334155',
    transition: 'all 0.3s'
  },
  disciplineName: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '20px',
    fontWeight: '600',
    marginBottom: '10px',
    color: '#f1f5f9'
  },
  testCount: {
    color: '#64748b',
    marginBottom: '20px'
  },
  cardActions: {
    display: 'flex',
    gap: '10px'
  },
  testItem: {
    padding: '16px',
    background: 'rgba(59, 130, 246, 0.1)',
    borderRadius: '12px',
    marginBottom: '10px'
  },
  testType: {
    fontWeight: '600',
    color: '#3b82f6'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    padding: '20px'
  },
  modal: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '24px',
    padding: '32px',
    width: '100%',
    maxWidth: '480px',
    border: '1px solid #334155',
    maxHeight: '90vh',
    overflow: 'auto',
    animation: 'slideIn 0.3s ease'
  },
  modalTitle: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '24px',
    color: '#f1f5f9'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  criteriaSection: {
    marginTop: '16px'
  },
  criteriaRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
    alignItems: 'center'
  },
  removeBtn: {
    width: '36px',
    height: '36px',
    background: '#991b1b',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '16px'
  },
  addCriteriaBtn: {
    padding: '10px 16px',
    background: 'rgba(59, 130, 246, 0.2)',
    border: '1px dashed #3b82f6',
    borderRadius: '8px',
    color: '#3b82f6',
    cursor: 'pointer',
    width: '100%',
    fontSize: '14px',
    fontFamily: 'inherit'
  },
  totalPoints: {
    marginTop: '12px',
    textAlign: 'right',
    color: '#94a3b8',
    fontWeight: '600'
  },
  submissionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  submissionCard: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #334155'
  },
  submissionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '12px'
  },
  studentName: {
    fontWeight: '600',
    color: '#f1f5f9',
    fontSize: '16px'
  },
  submissionDate: {
    color: '#64748b',
    fontSize: '14px'
  },
  submissionDetails: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  testTypeBadge: {
    padding: '4px 12px',
    background: 'rgba(139, 92, 246, 0.2)',
    borderRadius: '20px',
    color: '#a78bfa',
    fontSize: '13px'
  },
  submissionActions: {
    borderTop: '1px solid #334155',
    paddingTop: '16px'
  },
  gradeDisplay: {
    background: 'rgba(6, 95, 70, 0.2)',
    borderRadius: '12px',
    padding: '16px'
  },
  gradeLabel: {
    color: '#94a3b8'
  },
  gradeValue: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    color: '#10b981',
    marginLeft: '8px'
  },
  feedbackText: {
    marginTop: '12px',
    color: '#94a3b8',
    fontSize: '14px',
    lineHeight: '1.5'
  },
  aiBtn: {
    padding: '14px 28px',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  studentWelcome: {
    marginBottom: '32px',
    padding: '28px',
    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))',
    borderRadius: '20px',
    border: '1px solid rgba(139, 92, 246, 0.3)'
  },
  studentContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px'
  },
  disciplineSelect: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #334155'
  },
  disciplineList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  disciplineOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '18px 24px',
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '2px solid transparent'
  },
  disciplineOptionActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3b82f6'
  },
  disciplineIcon: {
    fontSize: '24px'
  },
  testCountSmall: {
    marginLeft: 'auto',
    color: '#64748b',
    fontSize: '14px'
  },
  testSelect: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #334155'
  },
  testGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px'
  },
  testCard: {
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '16px',
    padding: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '2px solid transparent'
  },
  testCardActive: {
    borderColor: '#3b82f6',
    background: 'rgba(59, 130, 246, 0.1)'
  },
  testCardDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  testCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  testCardType: {
    fontWeight: '600',
    color: '#3b82f6'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    backgroundColor: '#854d0e',
    color: 'white'
  },
  testCardTime: {
    fontSize: '13px',
    color: '#94a3b8',
    marginBottom: '10px'
  },
  maxPoints: {
    fontWeight: '600',
    color: '#3b82f6',
    marginTop: '8px'
  },
  submissionResult: {
    marginTop: '16px',
    padding: '16px',
    background: 'rgba(6, 95, 70, 0.2)',
    borderRadius: '12px'
  },
  resultGrade: {
    fontWeight: '700',
    fontSize: '18px',
    color: '#10b981'
  },
  uploadSection: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #334155'
  },
  uploadArea: {
    marginBottom: '20px'
  },
  fileInput: {
    display: 'none'
  },
  uploadLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    border: '2px dashed #475569',
    borderRadius: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#94a3b8'
  },
  uploadIcon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  submitBtn: {
    padding: '16px 32px',
    background: 'linear-gradient(135deg, #10b981, #059669)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%'
  },
  mySubmissions: {
    background: 'linear-gradient(145deg, #1e293b, #0f172a)',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #334155'
  },
  submissionHistory: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '12px',
    flexWrap: 'wrap',
    gap: '10px'
  },
  historyMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  historyDisc: {
    fontWeight: '600',
    color: '#f1f5f9'
  },
  historyType: {
    padding: '4px 10px',
    background: 'rgba(139, 92, 246, 0.2)',
    borderRadius: '6px',
    color: '#a78bfa',
    fontSize: '12px'
  },
  historyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    color: '#64748b',
    fontSize: '14px'
  },
  historyGrade: {
    fontWeight: '600',
    color: '#10b981'
  },
  historyPending: {
    color: '#f59e0b'
  }
};
