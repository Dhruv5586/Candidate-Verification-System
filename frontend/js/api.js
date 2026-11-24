/**
 * CVS — Unified Backend API Client
 * Connects Frontend directly to Node API (port 3000) & Go Auth (port 8080)
 */

const API_BASE = '/api/v1';

async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const defaultHeaders = {
    'Accept': 'application/json',
  };

  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  // Include saved session token in Authorization header if present
  const sessionToken = localStorage.getItem('cvs_session_token');
  if (sessionToken) {
    defaultHeaders['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
    credentials: 'include', // Automatically passes cvs_session cookie
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    let errorMsg = (data && data.error && data.error.message) || data.message || `Request failed with status ${response.status}`;
    if (data && data.error && Array.isArray(data.error.details) && data.error.details.length > 0) {
      const detailsStr = data.error.details.map(d => `${d.field ? d.field + ': ' : ''}${d.message}`).join(', ');
      if (detailsStr && !errorMsg.includes(detailsStr)) {
        errorMsg = `${errorMsg} (${detailsStr})`;
      }
    }
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;

    // Global Session Expiration Handler
    if (response.status === 401) {
      localStorage.removeItem('cvs_session_token');
      localStorage.removeItem('cvs_user');
      const isPublicPage = window.location.pathname.endsWith('login.html') || 
                           window.location.pathname.endsWith('index.html') ||
                           window.location.pathname === '/' ||
                           window.location.pathname === '';
      if (!isPublicPage) {
        const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?expired=true&returnUrl=${currentPath}`;
      }
    }

    throw err;
  }

  return data;
}

export const API = {
  // Authentication & Session
  auth: {
    getMe: () => request('/auth/me'),
    getUsers: () => request('/auth/users'),
    devLogin: (role, email) =>
      request('/auth/dev-session', {
        method: 'POST',
        body: JSON.stringify({ role, email }),
      }),
    logout: () => {
      localStorage.removeItem('cvs_session_token');
      localStorage.removeItem('cvs_user');
      return request('/auth/logout', { method: 'POST' });
    },
  },

  // Health & Service Telemetry
  health: {
    getStatus: () => request('/health'),
    getDbStatus: () => request('/health/database'),
    getAuthHealth: () => request('http://localhost:8080/health').catch(() => ({ status: 'unavailable' })),
  },

  // Candidates CRUD & Search
  candidates: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', params.page);
      if (params.limit) q.set('limit', params.limit);
      if (params.search) q.set('search', params.search);
      if (params.location) q.set('location', params.location);
      if (params.status) q.set('status', params.status);
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return request(`/candidates${queryStr}`);
    },
    getStats: () => request('/candidates/stats'),
    get: (id) => request(`/candidates/${id}`),
    create: (candidateData) =>
      request('/candidates', {
        method: 'POST',
        body: JSON.stringify(candidateData),
      }),
    uploadResume: (candidateId, file) => {
      const formData = new FormData();
      formData.append('resume', file);
      return request(`/candidates/${candidateId}/resumes`, {
        method: 'POST',
        body: formData,
      });
    },
    getResumes: (candidateId) => request(`/candidates/${candidateId}/resumes`),
    // CSV Bulk Import
    importPreview: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return request('/imports/preview', {
        method: 'POST',
        body: formData,
      });
    },
    importConfirm: (confirmationToken) =>
      request('/imports/confirm', {
        method: 'POST',
        body: JSON.stringify({ confirmationToken, confirm: true, importId: confirmationToken }),
      }),
  },

  // Verification Workflow
  verifications: {
    initiate: (candidateId) =>
      request(`/candidates/${candidateId}/verifications`, {
        method: 'POST',
      }),
    listForCandidate: (candidateId) => request(`/candidates/${candidateId}/verifications`),
    get: (verificationId) => request(`/verifications/${verificationId}`),
    getIssues: (verificationId) => request(`/verifications/${verificationId}/issues`),
    assignReviewer: (verificationId, reviewerId) =>
      request(`/verifications/${verificationId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ reviewerId }),
      }),
  },

  // Reviewer Queue & Decisions
  reviewer: {
    getAssignments: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      if (params.page) q.set('page', params.page);
      if (params.limit) q.set('limit', params.limit);
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return request(`/reviewer/assignments${queryStr}`);
    },
    getAssignment: (verificationId) => request(`/reviewer/assignments/${verificationId}`),
    submitDecision: (verificationId, { decision, comments }) =>
      request(`/reviewer/assignments/${verificationId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, comments }),
      }),
  },

  // Documents
  documents: {
    getDownloadUrl: (documentId) => `/api/v1/documents/${documentId}/download`,
  },
};
