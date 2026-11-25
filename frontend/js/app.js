/**
 * CVS — Global App Shell & Session Manager
 */
import { API } from './api.js';

// Global toast alert helper
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';

  const iconName = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
  const iconColor = type === 'success' ? 'text-success' : type === 'error' ? 'text-error' : type === 'warning' ? 'text-warning' : 'text-primary';

  toast.innerHTML = `
    <span class="material-symbols-outlined ${iconColor}">${iconName}</span>
    <span class="flex-1">${message}</span>
    <button class="text-on-surface-variant hover:text-on-surface text-xs" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Current User & Session State
export let currentUser = null;
export let currentSession = null;
let sessionCountdownInterval = null;
let checkSessionPromise = null;
let lastSessionCheckTime = 0;
const SESSION_CACHE_TTL = 30000; // 30 seconds cache for active session

export async function checkSession(forceRefresh = false) {
  const now = Date.now();
  // Return cached session if valid and not expired, avoiding redundant network requests
  if (!forceRefresh && currentUser && (now - lastSessionCheckTime < SESSION_CACHE_TTL)) {
    return currentUser;
  }

  // Deduplicate in-flight network requests
  if (checkSessionPromise) {
    return checkSessionPromise;
  }

  checkSessionPromise = (async () => {
    try {
      const res = await API.auth.getMe();
      if (res && res.data && res.data.user) {
        currentUser = res.data.user;
        currentSession = res.data.session;
        lastSessionCheckTime = Date.now();
        localStorage.setItem('cvs_user', JSON.stringify(currentUser));
        updateUserUI(currentUser);
        mountSessionBadge(currentSession);
        startSessionExpiryWatcher(currentSession);
        return currentUser;
      }
    } catch (err) {
      // If auth failed, try fallback to cached user or prompt login
      const cached = localStorage.getItem('cvs_user');
      if (cached) {
        currentUser = JSON.parse(cached);
        updateUserUI(currentUser);
        return currentUser;
      }
    } finally {
      checkSessionPromise = null;
    }
    return null;
  })();

  return checkSessionPromise;
}

function formatRemainingTime(expiresAt) {
  if (!expiresAt) return 'Unknown';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function startSessionExpiryWatcher(session) {
  if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);
  if (!session || !session.expiresAt) return;

  let warningShown = false;

  sessionCountdownInterval = setInterval(async () => {
    const diff = new Date(session.expiresAt).getTime() - Date.now();
    const remainingText = formatRemainingTime(session.expiresAt);
    const ttlSpan = document.getElementById('session-ttl-text');
    if (ttlSpan) ttlSpan.textContent = remainingText;

    const modalTtlSpan = document.getElementById('modal-session-ttl');
    if (modalTtlSpan) modalTtlSpan.textContent = remainingText;

    // 5-minute warning alert
    if (diff <= 5 * 60 * 1000 && diff > 4 * 60 * 1000 && !warningShown) {
      warningShown = true;
      showToast('⚠️ Warning: Your verification session will expire in 5 minutes.', 'warning');
    }

    // When 30-minute timeout is reached -> automatic logout
    if (diff <= 0) {
      clearInterval(sessionCountdownInterval);
      showToast('30-minute session expired. Logging out automatically...', 'warning');
      try {
        await logout();
      } catch (_) {
        window.location.href = '/login?expired=true';
      }
    }
  }, 1000);
}

function mountSessionBadge(session) {
  const header = document.querySelector('header');
  if (!header) return;

  let badge = document.getElementById('cvs-session-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'cvs-session-badge';
    badge.className = 'flex items-center gap-2 px-2.5 py-1 bg-surface-container hover:bg-surface-container-high border border-outline-variant hover:border-primary rounded text-xs font-label cursor-pointer transition-colors';
    badge.title = 'Click to inspect session expiration and security parameters';
    badge.addEventListener('click', openSessionModal);

    // Insert into header right container if available, or append
    const rightContainer = header.querySelector('.flex.items-center.gap-3:last-child') || header;
    rightContainer.insertBefore(badge, rightContainer.firstChild);
  }

  const remaining = session ? formatRemainingTime(session.expiresAt) : 'Active';
  badge.innerHTML = `
    <span class="w-2 h-2 rounded-full bg-success animate-pulse shrink-0"></span>
    <span class="text-on-surface-variant uppercase text-[11px] hidden sm:inline">Session:</span>
    <span id="session-ttl-text" class="text-on-surface font-mono text-[11px] font-semibold">${remaining}</span>
    <span class="material-symbols-outlined text-xs text-on-surface-variant hover:text-primary">info</span>
  `;

  ensureSessionModal();
}

function ensureSessionModal() {
  if (document.getElementById('session-inspector-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'session-inspector-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface/80 backdrop-blur-sm hidden';
  modal.innerHTML = `
    <div class="w-full max-w-lg bg-surface-container border border-outline-variant rounded-md shadow-2xl p-6 flex flex-col gap-5 text-xs font-body">
      <!-- Modal Header -->
      <div class="flex items-center justify-between pb-3 border-b border-outline-variant">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-lg">shield_person</span>
          <div>
            <span class="font-headline text-sm font-semibold text-on-surface block">Session Security & Expiration</span>
            <span class="font-label text-[10px] uppercase text-on-surface-variant">Cryptographic Session Telemetry</span>
          </div>
        </div>
        <button id="closeSessionModalBtn" class="text-on-surface-variant hover:text-on-surface p-1">
          <span class="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <!-- Session Parameter Table -->
      <div class="flex flex-col gap-2.5 font-label text-[11px]">
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Current User</span>
          <span id="modal-session-user" class="text-on-surface font-headline font-semibold">--</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Verified Roles</span>
          <span id="modal-session-roles" class="text-primary font-mono font-bold">--</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Session Status</span>
          <span class="flex items-center gap-1.5 text-success font-semibold">
            <span class="w-2 h-2 rounded-full bg-success"></span>
            ACTIVE · 200 OK
          </span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Session Timeout Policy</span>
          <span class="text-warning font-mono font-semibold">30 Minutes (Auto-Logout)</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Remaining Time (TTL)</span>
          <span id="modal-session-ttl" class="text-primary font-mono font-bold text-xs">Calculating...</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Expires At</span>
          <span id="modal-session-expires" class="text-on-surface font-mono">--</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Transport Security</span>
          <span class="text-on-surface font-mono">HTTP-Only Cookie (cvs_session)</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant rounded">
          <span class="text-on-surface-variant uppercase">Backend Verification</span>
          <span class="text-on-surface font-mono">Go Auth SHA-256 (Port 8080)</span>
        </div>
      </div>

      <!-- Explanatory note -->
      <div class="p-3 bg-surface-container-high border border-outline-variant rounded text-on-surface-variant text-[11px] leading-relaxed">
        <p><strong class="text-on-surface">30-Minute Security Policy:</strong> Verification sessions automatically expire 30 minutes after issuance. When the timer hits 0:00, CVS revokes the session token, clears the HTTP-only cookie, and logs you out automatically.</p>
      </div>

      <!-- Action Footer -->
      <div class="flex items-center justify-between pt-3 border-t border-outline-variant gap-3">
        <button id="testExpireSessionBtn" type="button" class="px-3 py-1.5 bg-warning/10 border border-warning/40 hover:bg-warning/20 text-warning rounded font-label text-xs uppercase font-medium flex items-center gap-1.5 transition-colors">
          <span class="material-symbols-outlined text-sm">timer_off</span>
          <span>Test Session Expiry</span>
        </button>
        <button id="closeSessionModalBtn2" type="button" class="px-4 py-1.5 bg-surface-container-high border border-outline-variant hover:border-on-surface text-on-surface rounded font-label text-xs uppercase transition-colors">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Wire modal close buttons
  document.getElementById('closeSessionModalBtn')?.addEventListener('click', closeSessionModal);
  document.getElementById('closeSessionModalBtn2')?.addEventListener('click', closeSessionModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSessionModal();
  });

  // Wire Test Session Expiry button
  document.getElementById('testExpireSessionBtn')?.addEventListener('click', async () => {
    showToast('Simulating session expiry: Revoking session...', 'warning');
    try {
      await API.auth.logout();
    } catch (_) { }
    window.location.href = '/login?expired=true';
  });
}

function openSessionModal() {
  ensureSessionModal();
  const modal = document.getElementById('session-inspector-modal');
  if (!modal) return;

  const userEl = document.getElementById('modal-session-user');
  const rolesEl = document.getElementById('modal-session-roles');
  const ttlEl = document.getElementById('modal-session-ttl');
  const expEl = document.getElementById('modal-session-expires');

  if (currentUser) {
    if (userEl) userEl.textContent = `${currentUser.name} (${currentUser.email})`;
    if (rolesEl) rolesEl.textContent = Array.isArray(currentUser.roles) ? currentUser.roles.join(', ').toUpperCase() : 'USER';
  }

  if (currentSession && currentSession.expiresAt) {
    if (expEl) expEl.textContent = new Date(currentSession.expiresAt).toLocaleString();
    if (ttlEl) ttlEl.textContent = formatRemainingTime(currentSession.expiresAt);
  }

  modal.classList.remove('hidden');
}

function closeSessionModal() {
  const modal = document.getElementById('session-inspector-modal');
  if (modal) modal.classList.add('hidden');
}

function updateUserUI(user) {
  if (!user) return;
  const userNameEls = document.querySelectorAll('.user-name-display');
  const userEmailEls = document.querySelectorAll('.user-email-display');
  const userRoleEls = document.querySelectorAll('.user-roles-display');

  userNameEls.forEach(el => el.textContent = user.name || 'User');
  userEmailEls.forEach(el => el.textContent = user.email || '');
  userRoleEls.forEach(el => {
    if (Array.isArray(user.roles)) {
      el.textContent = user.roles.join(', ').toUpperCase();
    }
  });

  // Role-Based Access Control (RBAC) UI Filtering
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const isAdmin = roles.includes('admin');
  const isReviewer = roles.includes('reviewer');
  const isRecruiter = roles.includes('recruiter');

  // If user is ONLY a recruiter (not admin or reviewer):
  // They only see Recruiter functionality (Operations & Docs)
  if (isRecruiter && !isAdmin && !isReviewer) {
    // Hide Admin Overview nav group
    document.querySelectorAll('a[href="/dashboard"]').forEach(a => {
      const group = a.closest('.flex.flex-col.gap-1');
      if (group) group.style.display = 'none';
    });

    // Hide Reviewer Queue nav group
    document.querySelectorAll('a[href="/reviewer"]').forEach(a => {
      const group = a.closest('.flex.flex-col.gap-1');
      if (group) group.style.display = 'none';
    });

    // If currently on an unauthorized page, redirect to candidates directory
    const path = window.location.pathname;
    if (path.includes('reviewer') || path.includes('dashboard')) {
      window.location.href = '/candidates';
    }
  }

  // If user is ONLY a reviewer (not admin):
  if (isReviewer && !isAdmin && !isRecruiter) {
    // Hide Admin Overview nav group
    document.querySelectorAll('a[href="/dashboard"]').forEach(a => {
      const group = a.closest('.flex.flex-col.gap-1');
      if (group) group.style.display = 'none';
    });
  }
}

// Logout handler: clear credentials & return to login gateway
export async function logout() {
  try {
    await API.auth.logout();
  } catch (_) {
  } finally {
    currentUser = null;
    currentSession = null;
    lastSessionCheckTime = 0;
    checkSessionPromise = null;
    localStorage.removeItem('cvs_session_token');
    localStorage.removeItem('cvs_user');
    window.location.href = '/login';
  }
}

// Switch role helper
export async function switchRole(role) {
  try {
    showToast(`Activating ${role.toUpperCase()} session...`, 'info');
    const res = await API.auth.devLogin(role);
    if (res && res.data && res.data.user) {
      localStorage.setItem('cvs_session_token', res.data.sessionToken);
      localStorage.setItem('cvs_user', JSON.stringify(res.data.user));
      showToast(`Active profile: ${res.data.user.name} (${res.data.user.roles.join(', ')})`, 'success');
      setTimeout(() => {
        if (role === 'reviewer' && !window.location.pathname.includes('reviewer')) {
          window.location.href = '/reviewer';
        } else if (role === 'recruiter' && window.location.pathname.includes('reviewer')) {
          window.location.href = '/candidates';
        } else {
          window.location.reload();
        }
      }, 350);
    }
  } catch (err) {
    showToast('Role switch failed: ' + err.message, 'error');
  }
}

// Initialize Shell Events on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar drawer
  const openBtn = document.getElementById('openSidebarBtn');
  const closeBtn = document.getElementById('closeSidebarBtn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (openBtn && sidebar) {
    openBtn.addEventListener('click', () => {
      sidebar.classList.remove('-translate-x-full');
      if (backdrop) backdrop.classList.remove('hidden');
    });
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }

  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);

  // Wire logout buttons
  document.querySelectorAll('.logout-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  });

  // Check auth session
  checkSession();
});
