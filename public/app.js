// Coding Dojo Platform - Complete Frontend Client SPA

const state = {
  user: null,
  route: window.location.pathname || '/',
  routeParams: {},
  languages: [],
  belts: [],
  selectedLanguage: 'Python',
  languageBeltDetails: null,
  topics: [],
  currentTopic: null,
  currentQuestion: null,
  questionTestResults: null,
  userTypedCode: null, // Persistent typed code across test runs
  beltExamData: null,
  beltExamAnswers: {},
  beltExamResults: {},
  beltExamActiveTab: 0,
  progressData: null,
  staffStudents: [],
  staffPromotions: [],
  staffActiveModalStudent: null,
  adminContent: null,
  adminUsers: [],
  adminActiveTab: 'creator',
  adminBeltQuestions: [],
  activeToast: null
};

// API Helper with Silent Option
async function api(path, options = {}) {
  const { silent = false, ...fetchOpts } = options;
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    ...fetchOpts
  };
  if (opts.body && typeof opts.body === 'object') {
    opts.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (!silent) showToast(err.message, 'error');
    throw err;
  }
}

function showToast(message, type = 'info') {
  state.activeToast = { message, type };
  render();
  setTimeout(() => {
    state.activeToast = null;
    render();
  }, 4000);
}

function navigate(path, params = {}) {
  window.history.pushState({}, '', path);
  state.route = path;
  state.routeParams = params;
  initRoute();
}

window.addEventListener('popstate', () => {
  state.route = window.location.pathname;
  initRoute();
});

async function init() {
  try {
    const me = await api('/api/me', { silent: true });
    state.user = me.user;
    if (state.user?.selected_language) {
      state.selectedLanguage = state.user.selected_language;
    }
  } catch {
    state.user = null;
  }
  
  try {
    state.languages = await api('/api/languages', { silent: true });
  } catch {}

  initRoute();
}

async function initRoute() {
  const p = state.route;

  if (p === '/staff/dashboard' && state.user && state.user.role === 'student') {
    return navigate('/dashboard');
  }
  if (p === '/admin/dashboard' && state.user && state.user.role !== 'admin') {
    return navigate('/dashboard');
  }
  if ((p === '/staff/dashboard' || p === '/admin/dashboard' || p === '/belt-test' || p === '/dashboard' || p === '/progress') && !state.user) {
    return navigate('/login');
  }

  if (p === '/belt-test' && state.user) {
    try {
      const lang = state.selectedLanguage || 'Python';
      state.beltExamData = await api(`/api/belt-test/exam?language=${lang}`);
      state.beltExamActiveTab = 0;
      state.beltExamAnswers = {};
      state.beltExamResults = {};
    } catch {
      showToast('No active approved promotion exam found.', 'error');
      return navigate('/dashboard');
    }
  } else if (p.startsWith('/lesson/')) {
    const id = p.split('/')[2];
    if (id) {
      try {
        state.currentTopic = await api(`/api/topics/${id}`, { silent: true });
      } catch {}
    }
  } else if (p.startsWith('/question/')) {
    const id = p.split('/')[2];
    if (id) {
      try {
        state.currentQuestion = await api(`/api/questions/${id}`, { silent: true });
        state.questionTestResults = null;
        state.userTypedCode = null; // Reset typed code so it opens empty initially
      } catch {}
    }
  } else if (p === '/dashboard' && state.user) {
    try {
      const lang = state.selectedLanguage;
      state.languageBeltDetails = await api(`/api/languages/${lang}/belt-details`, { silent: true });
      state.topics = await api(`/api/topics?language=${lang}`, { silent: true });
      state.progressData = await api('/api/progress', { silent: true });
    } catch {}
  } else if (p === '/progress' && state.user) {
    try {
      state.progressData = await api('/api/progress', { silent: true });
    } catch {}
  } else if (p === '/revision' && state.user) {
    try {
      state.revisitData = await api('/api/revisit', { silent: true });
    } catch {}
  } else if (p === '/revisit' && state.user) {
    try {
      state.revisitData = await api('/api/revisit', { silent: true });
    } catch {}
  } else if (p === '/staff/dashboard' && state.user?.role !== 'student') {
    try {
      state.staffStats = await api('/api/staff/dashboard', { silent: true });
      state.staffStudents = await api('/api/staff/students', { silent: true });
      state.staffPromotions = await api('/api/staff/promotions', { silent: true });
    } catch {}
  } else if (p === '/admin/dashboard' && state.user?.role === 'admin') {
    try {
      state.adminStats = await api('/api/admin/dashboard', { silent: true });
      state.adminContent = await api('/api/admin/content', { silent: true });
      state.adminUsers = await api('/api/admin/users', { silent: true });
      state.adminBeltQuestions = await api('/api/admin/belt-test-questions', { silent: true });
    } catch {}
  }

  render();
}

// UI RENDER ENGINE
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  let html = '';

  if (state.activeToast) {
    html += `
      <div style="position: fixed; bottom: 24px; right: 24px; z-index: 1000; background: ${state.activeToast.type === 'error' ? '#EF4444' : '#10B981'}; color: white; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 10px; font-weight: 600;">
        <i class="fa-solid ${state.activeToast.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
        ${state.activeToast.message}
      </div>
    `;
  }

  const p = state.route;

  if (p === '/' && !state.user) {
    html += renderLandingPage();
  } else if (p === '/login') {
    html += renderAuthPage('login');
  } else if (p === '/register') {
    html += renderAuthPage('register');
  } else if (p === '/onboarding' && state.user) {
    html += renderOnboardingPage();
  } else if (state.user) {
    html += `
      <div class="app-container">
        ${renderSidebar()}
        <main class="main-content">
          ${renderMainView()}
        </main>
      </div>
    `;
  } else {
    html += renderLandingPage();
  }

  app.innerHTML = html;
}

// LANDING PAGE
function renderLandingPage() {
  return `
    <div>
      <nav class="public-nav">
        <div class="brand-logo"><i class="fa-solid fa-user-ninja"></i> CODING DOJO</div>
        <div style="display: flex; gap: 12px;">
          <button class="btn btn-secondary" onclick="navigate('/login')">Log In</button>
          <button class="btn btn-primary" onclick="navigate('/register')">Start Learning</button>
        </div>
      </nav>

      <section class="hero-section">
        <div class="hero-content">
          <div style="display: inline-flex; gap: 8px; background: var(--amber-100); color: var(--amber-700); padding: 4px 12px; border-radius: 99px; font-weight: 700; font-size: 13px; margin-bottom: 16px;">
            <i class="fa-solid fa-award"></i> Learn. Code. Progress. Earn Your Belt.
          </div>
          <h1 class="hero-headline">Master Programming <span>One Belt at a Time.</span></h1>
          <p class="hero-subtitle">Learn fundamentals in Python, C++, JavaScript, and Java, solve 3 questions per topic, pass test cases, and request belt promotion tests.</p>
          <div class="hero-actions">
            <button class="btn btn-accent" style="padding: 14px 28px; font-size: 16px;" onclick="navigate('/register')">
              Start Learning Now <i class="fa-solid fa-play"></i>
            </button>
            <button class="btn btn-secondary" onclick="navigate('/login')">Explore Dojo</button>
          </div>
        </div>

        <div class="hero-visual">
          <div class="code-editor-header">
            <div class="editor-dots"><div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div></div>
            <div style="font-family: var(--font-code); font-size: 12px; color: #94A3B8;">solution.cpp</div>
          </div>
          <pre style="font-family: var(--font-code); font-size: 14px; color: #E2E8F0; line-height: 1.7;">
<span style="color: #F59E0B;">#include &lt;iostream&gt;</span>
using namespace std;

int main() {
    int a, b;
    if (cin &gt;&gt; a &gt;&gt; b) cout &lt;&lt; (a + b);
    return 0;
}
          </pre>
        </div>
      </section>

      <footer style="background: var(--navy-900); color: #94A3B8; padding: 30px; text-align: center; font-size: 14px;">
        © 2026 Coding Dojo. All rights reserved.
      </footer>
    </div>
  `;
}

// LOGIN & REGISTER
function renderAuthPage(type) {
  const isRegister = type === 'register';

  return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg-main);">
      <div class="card" style="max-width: 420px; width: 100%; padding: 36px;">
        <div style="text-align: center; margin-bottom: 28px;">
          <div class="brand-logo" style="justify-content: center; margin-bottom: 8px;">
            <i class="fa-solid fa-user-ninja"></i> CODING DOJO
          </div>
          <h2 style="font-size: 22px; font-weight: 800;">${isRegister ? 'Create Account' : 'Sign In'}</h2>
          <p style="font-size: 13px; color: var(--navy-500); margin-top: 4px;">Students, Staff & Admins enter credentials</p>
        </div>

        <form onsubmit="handleAuthSubmit(event, '${type}')">
          ${isRegister ? `
            <div style="margin-bottom: 16px;">
              <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px;">Full Name</label>
              <input type="text" id="auth-name" required placeholder="e.g. Student Arun" style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 6px; font-size: 14px;">
            </div>
          ` : ''}

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px;">Email Address</label>
            <input type="email" id="auth-email" required placeholder="name@domain.com" style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 6px; font-size: 14px;">
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px;">Password</label>
            <input type="password" id="auth-password" required placeholder="••••••••" style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 6px; font-size: 14px;">
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px;">
            ${isRegister ? 'Create Account & Start' : 'Sign In'}
          </button>
        </form>

        ${!isRegister ? `
          <div style="margin-top: 24px; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-light); border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--navy-500); text-align: center; font-weight: 700; margin-bottom: 10px;">
              ⚡ Quick Fill Credentials:
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px;" onclick="fillCredentials('student@gmail.com', 'student123')">Student</button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px;" onclick="fillCredentials('staff@gmail.com', 'staff123')">Staff</button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px;" onclick="fillCredentials('admin@gmail.com', 'admin123')">Admin</button>
            </div>
          </div>
        ` : ''}

        <div style="margin-top: 20px; text-align: center; font-size: 13px;">
          ${isRegister ? `Already have an account? <a href="#" onclick="navigate('/login')">Log in</a>` : `Need an account? <a href="#" onclick="navigate('/register')">Register here</a>`}
        </div>
      </div>
    </div>
  `;
}

window.fillCredentials = function(email, password) {
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');
  if (emailInput) emailInput.value = email;
  if (passInput) passInput.value = password;
};

async function handleAuthSubmit(event, type) {
  event.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;

  if (type === 'register') {
    const name = document.getElementById('auth-name').value;
    try {
      const res = await api('/api/register', { method: 'POST', body: { name, email, password } });
      state.user = res.user;
      navigate('/onboarding');
    } catch {}
  } else {
    try {
      const res = await api('/api/login', { method: 'POST', body: { email, password } });
      state.user = res.user;
      if (res.user.role === 'admin') navigate('/admin/dashboard');
      else if (res.user.role === 'staff') navigate('/staff/dashboard');
      else navigate('/dashboard');
    } catch {}
  }
}

function renderOnboardingPage() {
  return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 40px; background: var(--bg-main);">
      <div class="card" style="max-width: 800px; width: 100%; padding: 40px; text-align: center;">
        <h1 style="font-size: 32px; font-weight: 800; margin-bottom: 12px;">Welcome to Coding Dojo 👋</h1>
        <p style="color: var(--navy-600); font-size: 16px; margin-bottom: 36px;">Select your starting language to explore its topics and earn your belt!</p>
        
        <div class="grid-cols-4" style="margin-bottom: 32px;">
          <div class="card language-option" onclick="selectLangChoice('Python')" style="cursor: pointer; border: 2px solid var(--amber-500);">
            <i class="fa-brands fa-python" style="font-size: 36px; color: #3776AB;"></i>
            <h4>Python</h4>
          </div>
          <div class="card language-option" onclick="selectLangChoice('C++')" style="cursor: pointer;">
            <i class="fa-solid fa-microchip" style="font-size: 36px; color: #00599C;"></i>
            <h4>C++</h4>
          </div>
          <div class="card language-option" onclick="selectLangChoice('JavaScript')" style="cursor: pointer;">
            <i class="fa-brands fa-js" style="font-size: 36px; color: #F7DF1E;"></i>
            <h4>JavaScript</h4>
          </div>
          <div class="card language-option" onclick="selectLangChoice('Java')" style="cursor: pointer;">
            <i class="fa-brands fa-java" style="font-size: 36px; color: #5382A1;"></i>
            <h4>Java</h4>
          </div>
        </div>
        <button class="btn btn-accent" style="padding: 12px 36px;" onclick="completeOnboarding()">Start Journey</button>
      </div>
    </div>
  `;
}

function selectLangChoice(lang) {
  state.selectedLanguage = lang;
}

async function completeOnboarding() {
  await api('/api/onboarding', { method: 'POST', body: { language: state.selectedLanguage } });
  state.user.selected_language = state.selectedLanguage;
  navigate('/dashboard');
}

// SIDEBAR WITHOUT ROLE SUFFIX LABELS
function renderSidebar() {
  const p = state.route;
  const isStaff = state.user?.role === 'staff' || state.user?.role === 'admin';
  const isAdmin = state.user?.role === 'admin';

  return `
    <aside class="sidebar">
      <div class="sidebar-logo"><i class="fa-solid fa-user-ninja"></i> CODING DOJO</div>
      <nav class="sidebar-nav">
        ${isAdmin ? `<div class="nav-item ${p === '/admin/dashboard' ? 'active' : ''}" onclick="navigate('/admin/dashboard')"><i class="fa-solid fa-shield-halved"></i> Admin Console</div>` : ''}
        ${isStaff ? `<div class="nav-item ${p === '/staff/dashboard' ? 'active' : ''}" onclick="navigate('/staff/dashboard')"><i class="fa-solid fa-user-doctor"></i> Sensei Portal</div>` : ''}

        <div class="nav-item ${p === '/dashboard' ? 'active' : ''}" onclick="navigate('/dashboard')"><i class="fa-solid fa-table-cells-large"></i> Dashboard</div>
        <div class="nav-item ${p === '/progress' ? 'active' : ''}" onclick="navigate('/progress')"><i class="fa-solid fa-chart-line"></i> Belt & Progress</div>
        <div class="nav-item ${p === '/revision' ? 'active' : ''}" onclick="navigate('/revision')"><i class="fa-solid fa-wrench"></i> Revision</div>
        <div class="nav-item ${p === '/revisit' ? 'active' : ''}" onclick="navigate('/revisit')"><i class="fa-solid fa-rotate-left"></i> Revisit History</div>
      </nav>

      <div class="sidebar-footer">
        <div style="font-size: 13px; color: #FFFFFF; font-weight: 700;">${state.user.name}</div>
        <button class="btn btn-secondary" style="width: 100%; margin-top: 8px; font-size: 12px; background: transparent; color: #94A3B8; border-color: var(--navy-700);" onclick="handleLogout()">Logout</button>
      </div>
    </aside>
  `;
}

async function handleLogout() {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  navigate('/');
}

function renderMainView() {
  const p = state.route;
  if (p === '/dashboard') return renderStudentDashboard();
  if (p === '/belt-test') return renderBeltPromotionExamPage();
  if (p.startsWith('/lesson/')) return renderLessonPage();
  if (p.startsWith('/question/')) return renderPracticeArena();
  if (p === '/progress') return renderProgressPage();
  if (p === '/revision') return renderRevisionPage();
  if (p === '/revisit') return renderRevisitPage();
  if (p === '/staff/dashboard') return renderStaffDashboard();
  if (p === '/admin/dashboard') return renderAdminDashboard();
  return renderStudentDashboard();
}

// DASHBOARD
function renderStudentDashboard() {
  const prog = state.progressData || { xp: 0, streak: 1, languageStats: [] };
  const lbd = state.languageBeltDetails || {};
  const currentLang = state.selectedLanguage;
  const currentBelt = lbd.currentBelt || { name: 'White Belt', color_hex: '#E2E8F0' };
  const nextBelt = lbd.nextBelt || { name: 'Yellow Belt' };
  const completedTopics = lbd.completedTopicsCount || 0;
  const totalTopics = lbd.totalTopicsCount || 3;
  const canApply = lbd.canApplyPromotion;
  const pendingReq = lbd.promotionRequest;

  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
        <div>
          <h1 style="font-size: 28px; font-weight: 800;">Welcome back, ${state.user.name} 👋</h1>
          <p style="color: var(--navy-600); font-size: 14px;">Select a language to view its belt details, belt-structured topics, and promotion test status.</p>
        </div>
        <div style="display: flex; gap: 12px;">
          <div style="background: var(--amber-100); color: var(--amber-700); padding: 8px 16px; border-radius: 99px; font-weight: 700; font-size: 14px;">
            🔥 ${prog.streak || 1} Day Streak
          </div>
          <div style="background: var(--navy-900); color: #FFF; padding: 8px 16px; border-radius: 99px; font-weight: 700; font-size: 14px;">
            ⚡ ${prog.xp || 0} Total XP
          </div>
        </div>
      </div>

      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 14px;">Select Language</h2>
      <div class="grid-cols-4" style="margin-bottom: 28px;">
        ${(prog.languageStats || []).map(ls => `
          <div class="card" style="cursor: pointer; border: 2px solid ${currentLang === ls.name ? 'var(--amber-500)' : 'var(--border-light)'}; background: ${currentLang === ls.name ? 'var(--amber-50)' : 'white'};" onclick="changeDashboardLanguage('${ls.name}')">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h3 style="font-size: 18px; font-weight: 700;">${ls.name}</h3>
              <span class="belt-chip" style="background: ${ls.beltColor}; color: #0F172A;">🥋 ${ls.beltName}</span>
            </div>
            <div style="font-size: 12px; color: var(--navy-600);">Topics: ${ls.completedTopics} / ${ls.totalTopics}</div>
            <div class="progress-bar-bg" style="height: 6px; margin-top: 6px;">
              <div class="progress-bar-fill" style="width: ${ls.progressPercent}%;"></div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card belt-card" style="margin-bottom: 28px;">
        <div class="belt-card-header">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--amber-500); text-transform: uppercase;">${currentLang} Rank & Belt Status</div>
            <div style="font-size: 26px; font-weight: 800; margin-top: 4px;">🥋 ${currentBelt.name}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 13px; color: #94A3B8;">Completed Topics: <strong style="color: white;">${completedTopics} / ${totalTopics}</strong></div>
            <div style="font-size: 13px; color: #94A3B8; margin-top: 4px;">Target Rank: <strong style="color: var(--amber-500);">${nextBelt.name}</strong></div>
          </div>
        </div>

        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--navy-700); display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 13px; color: #E2E8F0;">
            ${completedTopics >= 3 ? '✓ Minimum 3 topics completed! Apply for Belt Promotion.' : `Complete at least 3 topics in ${currentLang} to apply for Belt Promotion.`}
          </div>

          ${pendingReq?.status === 'pending' ? `
            <span class="status-badge" style="background: var(--amber-500); color: #0F172A; padding: 8px 16px; font-weight: 700;">
              ⏳ Promotion Request Pending Staff Approval
            </span>
          ` : pendingReq?.status === 'approved' ? `
            <button class="btn btn-accent" style="padding: 10px 24px; font-size: 14px;" onclick="navigate('/belt-test')">
              🥋 Open Belt Promotion Test
            </button>
          ` : pendingReq?.status === 'rejected' ? `
            <div style="display: flex; gap: 12px; align-items: center;">
              <span style="font-size: 12px; color: #F87171; font-weight: 600;">⚠️ Previous request rejected by Sensei. You may re-apply below.</span>
              <button class="btn ${canApply ? 'btn-accent' : 'btn-disabled'}" style="padding: 10px 24px; font-size: 14px;" ${canApply ? '' : 'disabled'} onclick="requestBeltPromotion('${currentLang}')">
                Re-Apply for Belt Promotion
              </button>
            </div>
          ` : `
            <button class="btn ${canApply ? 'btn-accent' : 'btn-disabled'}" style="padding: 10px 24px; font-size: 14px;" ${canApply ? '' : 'disabled'} onclick="requestBeltPromotion('${currentLang}')">
              Apply for Belt Test Promotion
            </button>
          `}
        </div>
      </div>

      <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 16px;">${currentLang} Belt Topics (3 Questions Per Topic)</h2>
      <div class="grid-cols-3">
        ${(state.topics || []).map(t => `
          <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; border-top: 3px solid ${t.belt_color || '#E2E8F0'};">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span class="belt-chip" style="background: ${t.belt_color || '#E2E8F0'}; color: #0F172A; font-size: 11px;">🥋 ${t.belt_name}</span>
                <span class="status-badge ${t.completed ? 'passed' : 'failed'}" style="${t.completed ? '' : 'background: #F1F5F9; color: #64748B;'}">
                  ${t.completed ? '✓ Completed' : 'Available'}
                </span>
              </div>
              <h3 style="font-size: 17px; font-weight: 700; margin-bottom: 6px;">${t.name}</h3>
              <p style="font-size: 13px; color: var(--navy-600); margin-bottom: 16px;">${t.description}</p>
            </div>
            <button class="btn ${t.completed ? 'btn-secondary' : 'btn-primary'}" style="width: 100%;" onclick="navigate('/lesson/${t.id}')">
              ${t.completed ? 'Review Lesson' : 'Start Topic Lesson'} <i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function changeDashboardLanguage(langName) {
  state.selectedLanguage = langName;
  state.languageBeltDetails = await api(`/api/languages/${langName}/belt-details`, { silent: true });
  state.topics = await api(`/api/topics?language=${langName}`, { silent: true });
  render();
}

async function requestBeltPromotion(langName) {
  try {
    const res = await api('/api/belt-promotion/request', { method: 'POST', body: { language: langName } });
    showToast(res.message);
    state.languageBeltDetails = await api(`/api/languages/${langName}/belt-details`, { silent: true });
    render();
  } catch {}
}

// BELT PROMOTION EXAM PAGE
function renderBeltPromotionExamPage() {
  const exam = state.beltExamData;
  if (!exam) return `<div class="card">Loading Belt Promotion Exam...</div>`;

  const req = exam.promotionRequest;
  const questions = exam.examQuestions || [];
  const activeIdx = state.beltExamActiveTab || 0;
  const currentQ = questions[activeIdx];
  const qResults = state.beltExamResults[currentQ?.id];

  return `
    <div>
      <div style="margin-bottom: 16px;">
        <a href="#" onclick="navigate('/dashboard')" style="font-size: 14px; font-weight: 600;">
          <i class="fa-solid fa-arrow-left"></i> Back to Dashboard
        </a>
      </div>

      <div class="card" style="background: var(--navy-900); color: #FFF; margin-bottom: 24px; padding: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <span class="status-badge" style="background: var(--amber-500); color: #0F172A; font-weight: 800;">STAFF APPROVED EXAM</span>
            <h1 style="font-size: 24px; font-weight: 800; margin-top: 8px;">🥋 Belt Promotion Exam: ${req.target_belt_name} (${exam.language.name})</h1>
            <p style="font-size: 13px; color: #94A3B8; margin-top: 4px;">Run test cases on all 3 application questions and submit when passed to unlock your Belt!</p>
          </div>
          <button class="btn btn-accent" style="padding: 12px 28px; font-size: 15px;" onclick="submitFullBeltExam('${exam.language.name}')">
            <i class="fa-solid fa-paper-plane"></i> Submit Belt Exam
          </button>
        </div>
      </div>

      <div style="display: flex; gap: 12px; margin-bottom: 20px;">
        ${questions.map((q, idx) => `
          <button class="btn ${activeIdx === idx ? 'btn-primary' : 'btn-secondary'}" style="flex: 1; justify-content: flex-start;" onclick="state.beltExamActiveTab=${idx}; render();">
            <div style="text-align: left;">
              <div style="font-size: 11px; text-transform: uppercase; color: ${activeIdx === idx ? 'var(--amber-500)' : 'var(--navy-500)'};">Topic: ${q.topic_name}</div>
              <div style="font-weight: 700; font-size: 14px;">Question ${idx + 1}: ${q.title}</div>
            </div>
          </button>
        `).join('')}
      </div>

      ${currentQ ? `
        <div class="arena-layout">
          <div class="problem-panel">
            <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${currentQ.title}</h3>
            <p style="font-size: 14px; color: var(--navy-700); line-height: 1.6; margin-bottom: 16px;">${currentQ.statement}</p>

            <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Input Format</h4>
            <p style="font-size: 13px; color: var(--navy-600); margin-bottom: 12px;">${currentQ.input_desc}</p>

            <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Output Format</h4>
            <p style="font-size: 13px; color: var(--navy-600); margin-bottom: 12px;">${currentQ.output_desc}</p>

            <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Example Input</h4>
            <div class="code-snippet" style="margin-top: 4px; margin-bottom: 12px;">${currentQ.example_input}</div>

            <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Expected Output</h4>
            <div class="code-snippet" style="margin-top: 4px; margin-bottom: 16px;">${currentQ.example_output}</div>
          </div>

          <div class="editor-panel">
            <div class="editor-toolbar">
              <span><i class="fa-solid fa-code"></i> Type Exam Solution (Question ${activeIdx + 1})</span>
            </div>

            <textarea id="exam-editor-${currentQ.id}" class="code-textarea" spellcheck="false" placeholder="Type solution here..." oninput="state.beltExamAnswers[${currentQ.id}] = this.value">${state.beltExamAnswers[currentQ.id] || ''}</textarea>

            <div class="editor-actions">
              <button class="btn btn-accent" onclick="runExamQuestionTests(${currentQ.id}, '${exam.language.name}')">
                <i class="fa-solid fa-play"></i> Run Tests for Q${activeIdx + 1}
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px; background: #0F172A; color: #FFFFFF;">
          <div style="font-weight: 700; font-size: 14px; color: var(--amber-500); margin-bottom: 12px; display: flex; justify-content: space-between;">
            <span><i class="fa-solid fa-vial-circle-check"></i> Exam Test Case Evaluation (Question ${activeIdx + 1})</span>
            ${qResults ? `<span style="color: ${qResults.allPassed ? '#10B981' : '#EF4444'};">${qResults.allPassed ? '✓ All 8 Test Cases Passed' : 'Some Test Cases Failed'}</span>` : ''}
          </div>

          ${!qResults ? `
            <div style="color: #94A3B8; font-size: 13px;">Click <strong>Run Tests for Q${activeIdx + 1}</strong> above to evaluate solution code against 3 visible + 5 hidden test cases.</div>
          ` : `
            <div>
              <table class="test-case-table">
                <thead>
                  <tr><th>TEST CASE</th><th>INPUT</th><th>EXPECTED OUTPUT</th><th>YOUR OUTPUT</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  ${qResults.visibleTests.map(vt => `
                    <tr>
                      <td>Visible ${vt.testNumber}</td>
                      <td style="font-family: var(--font-code);">${vt.input}</td>
                      <td style="font-family: var(--font-code);">${vt.expectedOutput}</td>
                      <td style="font-family: var(--font-code);">${vt.actualOutput || 'N/A'}</td>
                      <td>
                        <span class="status-badge ${vt.status === 'passed' ? 'passed' : 'failed'}">
                          ${vt.status === 'passed' ? '✓ Passed' : '✗ Failed'}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div style="margin-top: 16px; padding: 12px; background: #1E293B; border-radius: 6px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
                <span>🔒 5 Hidden Test Cases (Server Evaluated)</span>
                <span style="font-weight: 700; color: ${qResults.hiddenTests.passed === qResults.hiddenTests.total ? '#10B981' : '#F59E0B'};">
                  ${qResults.hiddenTests.passed} / ${qResults.hiddenTests.total} Passed
                </span>
              </div>
            </div>
          `}
        </div>
      ` : ''}
    </div>
  `;
}

async function runExamQuestionTests(questionId, language) {
  const textarea = document.getElementById(`exam-editor-${questionId}`);
  if (textarea) state.beltExamAnswers[questionId] = textarea.value;

  const code = state.beltExamAnswers[questionId] || '';
  showToast('Running exam question test cases...', 'info');

  try {
    const res = await api('/api/belt-test/run-question', {
      method: 'POST',
      body: { questionId, code, language }
    });
    state.beltExamResults[questionId] = res;
    render();
  } catch {}
}

async function submitFullBeltExam(langName) {
  showToast('Evaluating Belt Exam answers...', 'info');
  try {
    const res = await api('/api/belt-test/submit', {
      method: 'POST',
      body: { language: langName, answers: state.beltExamAnswers }
    });

    if (res.success) {
      showToast(res.message);
      navigate('/dashboard');
    } else {
      showToast(res.message, 'error');
    }
  } catch {}
}

// LESSON PAGE
function renderLessonPage() {
  const t = state.currentTopic;
  if (!t) return `<div class="card">Loading topic content...</div>`;

  return `
    <div>
      <div style="margin-bottom: 16px;">
        <a href="#" onclick="navigate('/dashboard')" style="font-size: 14px; font-weight: 600;">
          <i class="fa-solid fa-arrow-left"></i> Back to Dashboard
        </a>
      </div>

      <div class="card" style="margin-bottom: 24px; background: var(--navy-900); color: #FFF; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 12px; font-weight: 700; color: var(--amber-500); text-transform: uppercase;">Language: ${t.language_name}</div>
          <h1 style="font-size: 26px; font-weight: 800; margin-top: 4px;">${t.name}</h1>
        </div>
        <span class="belt-chip" style="background: ${t.belt_color || '#E2E8F0'}; color: #0F172A;">🥋 ${t.belt_name}</span>
      </div>

      <div class="card" style="padding: 32px; margin-bottom: 24px;">
        <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 16px;">Content to be Learnt</h2>
        <div style="font-size: 15px; color: var(--navy-700); line-height: 1.7; margin-bottom: 24px;">
          ${t.content.replace(/\n/g, '<br>')}
        </div>
      </div>

      <div class="card" style="text-align: center; padding: 28px;">
        <h3 style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">Ready to Solve Questions?</h3>
        <p style="color: var(--navy-600); font-size: 14px; margin-bottom: 20px;">There are 3 separate practice questions available for this topic.</p>
        <button class="btn btn-accent" style="padding: 12px 36px; font-size: 16px;" onclick="completeLessonAndPractice(${t.id})">
          <i class="fa-solid fa-vial-circle-check"></i> Start Test & Solve Questions
        </button>
      </div>
    </div>
  `;
}

async function completeLessonAndPractice(topicId) {
  await api(`/api/topics/${topicId}/complete`, { method: 'POST' });
  const t = state.currentTopic;
  if (t && t.questions && t.questions.length > 0) {
    navigate(`/question/${t.questions[0].id}`);
  } else {
    navigate('/dashboard');
  }
}

// PRACTICE ARENA - INITIALLY EMPTY SOLUTION EDITOR ON RIGHT SIDE
function renderPracticeArena() {
  const q = state.currentQuestion;
  if (!q) return `<div class="card">Loading question...</div>`;

  const results = state.questionTestResults;
  const userLang = state.user.selected_language || 'Python';
  
  // Solution editor is completely EMPTY initially for student to type
  const currentCode = state.userTypedCode !== null ? state.userTypedCode : "";

  return `
    <div>
      <div class="arena-header">
        <div style="display: flex; align-items: center; gap: 16px;">
          <a href="#" onclick="navigate('/dashboard')" style="font-size: 14px; font-weight: 600;">
            <i class="fa-solid fa-chevron-left"></i> Dashboard
          </a>
          <h2 style="font-size: 18px; font-weight: 800;">${q.title}</h2>
          <span class="status-badge passed" style="background: var(--amber-100); color: var(--amber-700);">+${q.xp_value} XP</span>
        </div>
      </div>

      <div class="arena-layout">
        <div class="problem-panel">
          <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">Problem Statement</h3>
          <p style="font-size: 14px; color: var(--navy-700); line-height: 1.6; margin-bottom: 16px;">${q.statement}</p>

          <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Input Format</h4>
          <p style="font-size: 13px; color: var(--navy-600); margin-bottom: 12px;">${q.input_desc}</p>

          <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Output Format</h4>
          <p style="font-size: 13px; color: var(--navy-600); margin-bottom: 12px;">${q.output_desc}</p>

          <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Example Input</h4>
          <div class="code-snippet" style="margin-top: 4px; margin-bottom: 12px;">${q.example_input}</div>

          <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Expected Output</h4>
          <div class="code-snippet" style="margin-top: 4px; margin-bottom: 16px;">${q.example_output}</div>
        </div>

        <div class="editor-panel">
          <div class="editor-toolbar">
            <span><i class="fa-solid fa-code"></i> Type Your Solution (${userLang})</span>
          </div>

          <textarea id="code-editor" class="code-textarea" spellcheck="false" placeholder="Type solution here..." oninput="state.userTypedCode = this.value">${currentCode}</textarea>

          <div class="editor-actions">
            <button class="btn btn-secondary" style="padding: 8px 16px; background: var(--navy-700); color: white; border: none;" onclick="state.userTypedCode = ''; render();">
              Clear Solution
            </button>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-accent" onclick="runCodeTests(${q.id})">
                <i class="fa-solid fa-play"></i> Run Tests
              </button>
              <button id="submit-btn" class="btn btn-success ${results && results.canSubmit ? '' : 'btn-disabled'}" onclick="submitCodeSolution(${q.id})">
                <i class="fa-solid fa-paper-plane"></i> Submit Solution
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 20px; background: #0F172A; color: #FFFFFF;">
        <div style="font-weight: 700; font-size: 14px; color: var(--amber-500); margin-bottom: 12px; display: flex; justify-content: space-between;">
          <span><i class="fa-solid fa-vial-circle-check"></i> Test Case Evaluation Results</span>
          ${results ? `<span style="color: ${results.canSubmit ? '#10B981' : '#EF4444'};">${results.canSubmit ? '✓ All 8 Test Cases Passed' : 'Some Test Cases Failed'}</span>` : ''}
        </div>

        ${!results ? `
          <div style="color: #94A3B8; font-size: 13px;">Click <strong>Run Tests</strong> above to evaluate code.</div>
        ` : `
          <div>
            <table class="test-case-table">
              <thead>
                <tr><th>TEST CASE</th><th>INPUT</th><th>EXPECTED OUTPUT</th><th>YOUR OUTPUT</th><th>STATUS</th></tr>
              </thead>
              <tbody>
                ${results.visibleTests.map(vt => `
                  <tr>
                    <td>Visible ${vt.testNumber}</td>
                    <td style="font-family: var(--font-code);">${vt.input}</td>
                    <td style="font-family: var(--font-code);">${vt.expectedOutput}</td>
                    <td style="font-family: var(--font-code);">${vt.actualOutput || 'N/A'}</td>
                    <td>
                      <span class="status-badge ${vt.status === 'passed' ? 'passed' : 'failed'}">
                        ${vt.status === 'passed' ? '✓ Passed' : '✗ Failed'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="margin-top: 16px; padding: 12px; background: #1E293B; border-radius: 6px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
              <span>🔒 5 Hidden Test Cases (Server Evaluated)</span>
              <span style="font-weight: 700; color: ${results.hiddenTests.passed === results.hiddenTests.total ? '#10B981' : '#F59E0B'};">
                ${results.hiddenTests.passed} / ${results.hiddenTests.total} Passed
              </span>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

async function runCodeTests(questionId) {
  const textarea = document.getElementById('code-editor');
  if (textarea) state.userTypedCode = textarea.value;
  
  const code = state.userTypedCode || '';
  const lang = state.user.selected_language || 'Python';
  showToast('Running code against test cases...', 'info');
  
  try {
    const res = await api(`/api/questions/${questionId}/run`, { method: 'POST', body: { code, language: lang } });
    state.questionTestResults = res;
    render();
  } catch {}
}

async function submitCodeSolution(questionId) {
  const textarea = document.getElementById('code-editor');
  if (textarea) state.userTypedCode = textarea.value;

  const code = state.userTypedCode || '';
  const lang = state.user.selected_language || 'Python';

  try {
    const res = await api(`/api/questions/${questionId}/submit`, { method: 'POST', body: { code, language: lang } });
    if (res.success) showSuccessModal(res);
  } catch {}
}

function showSuccessModal(res) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <div style="font-size: 48px; margin-bottom: 8px;">🎉</div>
      <h2 style="font-size: 24px; font-weight: 800; margin-bottom: 8px;">Question Verified!</h2>
      <p style="color: var(--success); font-size: 18px; font-weight: 800; margin-bottom: 16px;">+${res.xpEarned} XP Earned</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove(); navigate('/dashboard');">Dashboard</button>
        <button class="btn btn-accent" onclick="this.closest('.modal-overlay').remove(); navigate('/dashboard');">Continue Practice</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ENHANCED BELT & PROGRESS ANALYTICS PAGE
function renderProgressPage() {
  const prog = state.progressData || { languageStats: [], beltStats: [] };
  const langStats = prog.languageStats || [];
  const beltStats = prog.beltStats || [];

  return `
    <div>
      <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">My Belt & Progress Analytics</h1>

      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 14px;">Current Belt Level Across All Languages</h2>
      <div class="grid-cols-4" style="margin-bottom: 32px;">
        ${langStats.map(lb => `
          <div class="card" style="border-top: 4px solid ${lb.beltColor}; text-align: center;">
            <div style="font-size: 12px; font-weight: 700; color: var(--navy-500); text-transform: uppercase;">${lb.name}</div>
            <div style="font-size: 20px; font-weight: 800; margin-top: 6px; color: var(--navy-900);">
              🥋 ${lb.beltName}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card" style="margin-bottom: 32px;">
        <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 16px;">Questions Solved in Each Belt Level</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Belt Tier</th>
              <th>Solved Questions Count</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${beltStats.map(bs => `
              <tr>
                <td style="font-weight: 600;">
                  <span class="belt-chip" style="background: ${bs.beltColor}; color: #0F172A;">🥋 ${bs.beltName}</span>
                </td>
                <td style="font-weight: 800; font-size: 16px; color: var(--navy-900);">${bs.solvedCount} Solved</td>
                <td>
                  <span class="status-badge ${bs.solvedCount > 0 ? 'passed' : 'failed'}">
                    ${bs.solvedCount > 0 ? '✓ Active Practice' : 'No Solved Qs'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 16px;">Activity Heatmap (2026)</h3>
        <div class="heatmap-grid">
          ${Array.from({ length: 52 }, (_, i) => `<div class="heatmap-cell ${i % 3 === 0 ? 'level-1' : i % 7 === 0 ? 'level-2' : ''}"></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderRevisionPage() {
  const rev = state.revisitData || { weakTopics: [] };
  return `
    <div>
      <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">Revision Center</h1>
      ${rev.weakTopics.length === 0 ? `<div class="card" style="color: var(--success);">✓ All topics have high accuracy!</div>` : `
        <div class="grid-cols-2">
          ${rev.weakTopics.map(w => `<div class="card"><h4>${w.topic_name}</h4><button class="btn btn-secondary" onclick="navigate('/lesson/${w.topic_id}')">Revise</button></div>`).join('')}
        </div>
      `}
    </div>
  `;
}

function renderRevisitPage() {
  const rev = state.revisitData || { completedLessons: [] };
  return `
    <div>
      <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">Revisit Completed Lessons</h1>
      <div class="grid-cols-3">
        ${rev.completedLessons.map(cl => `<div class="card"><h4>${cl.name}</h4><button class="btn btn-secondary" onclick="navigate('/lesson/${cl.id}')">Revisit</button></div>`).join('')}
      </div>
    </div>
  `;
}

// STAFF PORTAL
function renderStaffDashboard() {
  const stats = state.staffStats || { totalStudents: 1, activeStudents: 1, needsAttention: 0 };
  const students = state.staffStudents || [];
  const promotions = state.staffPromotions || [];
  const ms = state.staffActiveModalStudent;

  return `
    <div>
      <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">Sensei Mentor Portal</h1>

      <div class="grid-cols-3" style="margin-bottom: 32px;">
        <div class="card"><div style="font-size: 28px; font-weight: 800;">${stats.totalStudents}</div><div>Enrolled Students</div></div>
        <div class="card"><div style="font-size: 28px; font-weight: 800; color: var(--success);">${stats.activeStudents}</div><div>Active Students</div></div>
        <div class="card"><div style="font-size: 28px; font-weight: 800; color: var(--amber-500);">${promotions.length}</div><div>Pending Promotion Requests</div></div>
      </div>

      <div class="card" style="margin-bottom: 32px; border-left: 4px solid var(--amber-500);">
        <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 16px;">Pending Belt Promotion Requests</h3>
        ${promotions.length === 0 ? '<div style="color: var(--navy-500); font-size: 14px;">No pending promotion requests right now.</div>' : `
          <table class="data-table">
            <thead>
              <tr><th>Student Name</th><th>Language</th><th>Current Belt</th><th>Target Belt</th><th>Review Actions</th></tr>
            </thead>
            <tbody>
              ${promotions.map(p => `
                <tr>
                  <td style="font-weight: 600;">${p.student_name}</td>
                  <td>${p.language_name}</td>
                  <td>🥋 ${p.current_belt_name}</td>
                  <td style="font-weight: 700; color: var(--amber-600);">🥋 ${p.target_belt_name}</td>
                  <td style="display: flex; gap: 8px;">
                    <button class="btn btn-success" style="padding: 6px 14px; font-size: 12px;" onclick="reviewPromotion(${p.id}, 'approved')">Approve Test</button>
                    <button class="btn btn-secondary" style="padding: 6px 14px; font-size: 12px; background: #FFF1F2; color: #E11D48; border-color: #FECDD3;" onclick="reviewPromotion(${p.id}, 'rejected')">Reject Request</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <div class="card">
        <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 16px;">Student Roster</h3>
        <table class="data-table">
          <thead>
            <tr><th>Student Name</th><th>Language</th><th>XP</th><th>Streak</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${students.map(s => `
              <tr>
                <td style="font-weight: 600;">${s.name}</td>
                <td>${s.selected_language}</td>
                <td style="font-weight: 700;">${s.xp || 0} XP</td>
                <td>🔥 ${s.streak_days || 0}d</td>
                <td><button class="btn btn-primary" style="padding: 4px 12px; font-size: 12px;" onclick="viewStudentDetails(${s.id})">Inspect Student</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${ms ? `
        <div class="modal-overlay">
          <div class="modal-card" style="max-width: 750px; text-align: left; max-height: 90vh; overflow-y: auto; padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light);">
              <div>
                <span class="status-badge" style="background: var(--amber-100); color: var(--amber-700); font-size: 12px; font-weight: 700;">STUDENT PROFILE</span>
                <h2 style="font-size: 24px; font-weight: 800; margin-top: 4px;">${ms.name}</h2>
                <p style="font-size: 13px; color: var(--navy-500);">${ms.email} • Primary: <strong>${ms.selected_language}</strong></p>
              </div>
              <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 14px;" onclick="state.staffActiveModalStudent=null; render();">✕ Close</button>
            </div>

            <div class="grid-cols-4" style="margin-bottom: 24px;">
              <div style="background: #F8FAFC; padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; color: var(--navy-500);">TOTAL XP</div>
                <div style="font-size: 20px; font-weight: 800; color: var(--amber-600); margin-top: 2px;">⚡ ${ms.profile?.xp || 0}</div>
              </div>
              <div style="background: #F8FAFC; padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; color: var(--navy-500);">ACTIVE STREAK</div>
                <div style="font-size: 20px; font-weight: 800; color: #EF4444; margin-top: 2px;">🔥 ${ms.profile?.streak_days || 0}d</div>
              </div>
              <div style="background: #F8FAFC; padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; color: var(--navy-500);">SOLVED QUESTIONS</div>
                <div style="font-size: 20px; font-weight: 800; color: var(--navy-900); margin-top: 2px;">${ms.solvedCount || 0} Solved</div>
              </div>
              <div style="background: #F8FAFC; padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; color: var(--navy-500);">PROGRESS RATE</div>
                <div style="font-size: 20px; font-weight: 800; color: var(--success); margin-top: 2px;">${ms.progressPercent || 0}%</div>
              </div>
            </div>

            <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px;">Belt Ranks Across Languages</h3>
            <div class="grid-cols-4" style="margin-bottom: 24px;">
              ${(ms.languageBelts || []).map(lb => `
                <div style="border: 1px solid var(--border-light); padding: 10px; border-radius: 6px; text-align: center; border-top: 3px solid ${lb.beltColor};">
                  <div style="font-size: 11px; font-weight: 700; color: var(--navy-500);">${lb.language}</div>
                  <div style="font-size: 14px; font-weight: 800; margin-top: 4px;">🥋 ${lb.beltName}</div>
                </div>
              `).join('')}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
              <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 8px;">Completed Topics</h4>
                ${(ms.completedTopics || []).length === 0 ? '<div style="font-size: 12px; color: var(--navy-500);">No topics completed yet.</div>' : `
                  <ul style="padding-left: 16px; font-size: 12px; line-height: 1.8;">
                    ${ms.completedTopics.map(ct => `<li><strong>${ct.language_name}</strong>: ${ct.topic_name}</li>`).join('')}
                  </ul>
                `}
              </div>

              <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 8px;">Recent Question Submissions</h4>
                ${(ms.recentSubmissions || []).length === 0 ? '<div style="font-size: 12px; color: var(--navy-500);">No submissions recorded yet.</div>' : `
                  <ul style="padding-left: 16px; font-size: 12px; line-height: 1.8;">
                    ${ms.recentSubmissions.map(sub => `
                      <li>
                        ${sub.question_title} (${sub.language}) - 
                        <span style="color: ${sub.passed ? '#10B981' : '#EF4444'}; font-weight: 700;">${sub.passed ? '✓ Passed' : '✗ Failed'}</span>
                      </li>
                    `).join('')}
                  </ul>
                `}
              </div>
            </div>

            <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px;">Sensei Mentor Notes</h3>
            <div style="margin-bottom: 16px;">
              ${(ms.notes || []).length === 0 ? '<div style="font-size: 13px; color: var(--navy-500); margin-bottom: 12px;">No mentor notes added yet.</div>' : `
                <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
                  ${ms.notes.map(n => `
                    <div style="background: #F8FAFC; border-left: 3px solid var(--navy-800); padding: 10px 14px; border-radius: 4px;">
                      <div style="font-size: 11px; color: var(--navy-500); font-weight: 700;">By ${n.staff_name} • ${new Date(n.created_at).toLocaleString()}</div>
                      <div style="font-size: 13px; color: var(--navy-800); margin-top: 4px;">${n.note}</div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            <div style="display: flex; gap: 8px;">
              <input type="text" id="new-mentor-note" placeholder="Write mentor feedback note for student..." style="flex: 1; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 6px; font-size: 13px;">
              <button class="btn btn-primary" onclick="submitMentorNote(${ms.id})">Add Note</button>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function submitMentorNote(studentId) {
  const input = document.getElementById('new-mentor-note');
  const note = input ? input.value : '';
  if (!note) return showToast('Please enter note text', 'error');

  try {
    await api(`/api/staff/students/${studentId}/notes`, { method: 'POST', body: { note } });
    showToast('Mentor note added!');
    await viewStudentDetails(studentId);
  } catch {}
}

async function reviewPromotion(reqId, action) {
  await api(`/api/staff/promotions/${reqId}/review`, { method: 'POST', body: { action } });
  showToast(`Promotion request ${action}!`);
  state.staffPromotions = await api('/api/staff/promotions', { silent: true });
  render();
}

async function viewStudentDetails(studentId) {
  const data = await api(`/api/staff/students/${studentId}`, { silent: true });
  state.staffActiveModalStudent = data;
  render();
}

// ADMIN CONSOLE
function renderAdminDashboard() {
  const stats = state.adminStats || { totalStudents: 1, totalStaff: 1, totalLessons: 3, totalQuestions: 5, totalSubmissions: 2 };
  const content = state.adminContent || { languages: [], belts: [], topics: [], questions: [] };
  const beltQs = state.adminBeltQuestions || [];

  return `
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
        <div>
          <h1 style="font-size: 28px; font-weight: 800;">Admin Management Console</h1>
          <p style="color: var(--navy-600); font-size: 14px;">Manage Dojo curriculum, create topics/questions, and configure Belt Promotion Exam questions.</p>
        </div>
      </div>

      <div class="grid-cols-4" style="margin-bottom: 24px;">
        <div class="card"><div style="font-size: 24px; font-weight: 800;">${stats.totalStudents}</div><div>Students</div></div>
        <div class="card"><div style="font-size: 24px; font-weight: 800;">${stats.totalStaff}</div><div>Staff</div></div>
        <div class="card"><div style="font-size: 24px; font-weight: 800;">${stats.totalLessons}</div><div>Topics</div></div>
        <div class="card"><div style="font-size: 24px; font-weight: 800;">${stats.totalQuestions}</div><div>Questions</div></div>
      </div>

      <div style="display: flex; gap: 12px; margin-bottom: 24px; border-bottom: 2px solid var(--border-light); padding-bottom: 12px;">
        <button class="btn ${state.adminActiveTab === 'creator' ? 'btn-primary' : 'btn-secondary'}" onclick="state.adminActiveTab='creator'; render();">
          <i class="fa-solid fa-plus-circle"></i> 1. Curriculum Content Creator
        </button>
        <button class="btn ${state.adminActiveTab === 'belt-manager' ? 'btn-primary' : 'btn-secondary'}" onclick="state.adminActiveTab='belt-manager'; render();">
          <i class="fa-solid fa-award"></i> 2. Belt Promotion Test Manager
        </button>
        <button class="btn ${state.adminActiveTab === 'content' ? 'btn-primary' : 'btn-secondary'}" onclick="state.adminActiveTab='content'; render();">
          <i class="fa-solid fa-folder-open"></i> Full Curriculum Overview
        </button>
      </div>

      ${state.adminActiveTab === 'creator' ? renderAdminCurriculumCreator() : ''}
      ${state.adminActiveTab === 'belt-manager' ? renderAdminBeltTestManager(beltQs) : ''}
      ${state.adminActiveTab === 'content' ? renderAdminContentOverview(content) : ''}
    </div>
  `;
}

function renderAdminCurriculumCreator() {
  return `
    <div class="card" style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 16px;">Create Topic, Content & Practice Questions</h2>
      <p style="color: var(--navy-600); font-size: 14px; margin-bottom: 24px;">Select a language and belt tier, enter main topic lesson content, and configure 3 visible + 5 hidden test cases.</p>

      <form onsubmit="handleAdminCreateCurriculum(event)">
        <div class="grid-cols-2" style="margin-bottom: 20px;">
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Select Language</label>
            <select id="admin-lang-select" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
              <option value="Python">Python</option>
              <option value="C++">C++</option>
              <option value="JavaScript">JavaScript</option>
              <option value="Java">Java</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Select Belt Tier</label>
            <select id="admin-belt-select" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
              <option value="White Belt">🥋 White Belt</option>
              <option value="Yellow Belt">🥋 Yellow Belt</option>
              <option value="Orange Belt">🥋 Orange Belt</option>
              <option value="Green Belt">🥋 Green Belt</option>
              <option value="Blue Belt">🥋 Blue Belt</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Main Topic Heading / Title</label>
          <input type="text" id="admin-topic-name" required placeholder="e.g. Advanced String Operations" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
        </div>

        <div style="margin-bottom: 24px;">
          <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Topic Lesson Content to be Learnt</label>
          <textarea id="admin-topic-content" rows="4" required placeholder="Write detailed lesson markdown content for students..." style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px; font-family: var(--font-main);"></textarea>
        </div>

        <div style="border-top: 2px dashed var(--border-light); padding-top: 24px; margin-top: 24px;">
          <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">Practice Question Details</h3>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Question Title</label>
            <input type="text" id="admin-q-title" required placeholder="e.g. Reverse a String" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Problem Statement</label>
            <textarea id="admin-q-statement" rows="3" required placeholder="Read a string S and print S reversed." style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;"></textarea>
          </div>

          <div class="grid-cols-2" style="margin-bottom: 16px;">
            <div>
              <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Example Input</label>
              <input type="text" id="admin-q-ex-input" placeholder="hello" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
            </div>
            <div>
              <label style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px;">Expected Output</label>
              <input type="text" id="admin-q-ex-output" placeholder="olleh" style="width: 100%; padding: 10px; border: 1px solid var(--border-light); border-radius: 6px;">
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer;">
              <input type="checkbox" id="admin-is-belt-test"> Designate as Belt Promotion Test Question
            </label>
          </div>
        </div>

        <button type="submit" class="btn btn-accent" style="padding: 12px 32px;">Create Topic, Question & Test Cases</button>
      </form>
    </div>
  `;
}

async function handleAdminCreateCurriculum(event) {
  event.preventDefault();
  const langName = document.getElementById('admin-lang-select').value;
  const beltName = document.getElementById('admin-belt-select').value;
  const topicName = document.getElementById('admin-topic-name').value;
  const topicContent = document.getElementById('admin-topic-content').value;
  const qTitle = document.getElementById('admin-q-title').value;
  const qStatement = document.getElementById('admin-q-statement').value;
  const exInput = document.getElementById('admin-q-ex-input').value;
  const exOutput = document.getElementById('admin-q-ex-output').value;
  const isBeltTest = document.getElementById('admin-is-belt-test').checked;

  try {
    const topicRes = await api('/api/admin/topics', {
      method: 'POST',
      body: { language_name: langName, belt_name: beltName, name: topicName, content: topicContent }
    });

    const testCases = [
      { input: exInput || "5 10", expected_output: exOutput || "15", visible: 1 },
      { input: "20 30", expected_output: "50", visible: 1 },
      { input: "100 200", expected_output: "300", visible: 1 },
      { input: "-5 8", expected_output: "3", visible: 0 },
      { input: "0 0", expected_output: "0", visible: 0 },
      { input: "7 -2", expected_output: "5", visible: 0 },
      { input: "500 500", expected_output: "1000", visible: 0 },
      { input: "-100 -200", expected_output: "-300", visible: 0 }
    ];

    await api('/api/admin/questions', {
      method: 'POST',
      body: {
        topic_id: topicRes.topicId,
        title: qTitle,
        statement: qStatement,
        example_input: exInput || "5 10",
        example_output: exOutput || "15",
        is_belt_test: isBeltTest,
        test_cases: testCases
      }
    });

    showToast('Topic, Question & Test Cases created successfully!');
    state.adminStats = await api('/api/admin/dashboard', { silent: true });
    state.adminBeltQuestions = await api('/api/admin/belt-test-questions', { silent: true });
    state.adminActiveTab = 'belt-manager';
    render();
  } catch {}
}

function renderAdminBeltTestManager(beltQuestions) {
  return `
    <div class="card" style="padding: 28px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800;">Belt Promotion Test Questions Manager</h2>
          <p style="color: var(--navy-600); font-size: 13px;">Inspect, edit/alter, add, or remove questions assigned to Belt Promotion Exams.</p>
        </div>
        <button class="btn btn-primary" onclick="state.adminActiveTab='creator'; render();">+ Add Promotion Question</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Question ID</th>
            <th>Language</th>
            <th>Belt Tier</th>
            <th>Question Title</th>
            <th>Topic</th>
            <th>Promotion Exam Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${beltQuestions.map(q => `
            <tr>
              <td>#${q.id}</td>
              <td style="font-weight: 700;">${q.language_name}</td>
              <td><span class="belt-chip" style="background: ${q.belt_color || '#E2E8F0'}; color: #0F172A;">🥋 ${q.belt_name}</span></td>
              <td style="font-weight: 600;">${q.title}</td>
              <td style="font-size: 12px;">${q.topic_name}</td>
              <td>
                <span class="status-badge ${q.is_belt_test ? 'passed' : 'failed'}" style="${q.is_belt_test ? 'background: var(--amber-100); color: var(--amber-700);' : ''}">
                  ${q.is_belt_test ? '🥋 Promotion Test Q' : 'Standard Practice Q'}
                </span>
              </td>
              <td style="display: flex; gap: 8px;">
                <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="alterAdminQuestion(${q.id}, '${q.title.replace(/'/g, "\\'")}', ${q.is_belt_test})">
                  ${q.is_belt_test ? 'Remove from Exam' : 'Designate for Exam'}
                </button>
                <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; background: #FFF1F2; color: #E11D48;" onclick="deleteAdminQuestion(${q.id})">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function alterAdminQuestion(qId, title, isBeltTest) {
  try {
    await api(`/api/admin/questions/${qId}`, {
      method: 'PUT',
      body: { title, is_belt_test: !isBeltTest }
    });
    showToast(`Question status updated!`);
    state.adminBeltQuestions = await api('/api/admin/belt-test-questions', { silent: true });
    render();
  } catch {}
}

async function deleteAdminQuestion(qId) {
  if (!confirm('Are you sure you want to delete this question?')) return;
  try {
    await api(`/api/admin/questions/${qId}`, { method: 'DELETE' });
    showToast('Question deleted!');
    state.adminBeltQuestions = await api('/api/admin/belt-test-questions', { silent: true });
    render();
  } catch {}
}

function renderAdminContentOverview(content) {
  return `
    <div class="card" style="padding: 24px;">
      <h3>Curriculum Content Summary</h3>
      <p style="font-size: 14px; color: var(--navy-600); margin-top: 8px;">Total Topics: ${content.topics.length} | Total Practice Questions: ${content.questions.length}</p>
    </div>
  `;
}

window.addEventListener('DOMContentLoaded', init);