const BASE = '';

function getToken() {
  return localStorage.getItem('sg_token');
}

export function setToken(token) {
  localStorage.setItem('sg_token', token);
}

export function clearToken() {
  localStorage.removeItem('sg_token');
}

export function isLoggedIn() {
  return !!getToken();
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + path, opts);
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.blob();
  }
  return res.json();
}

export const api = {
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  me: () => request('GET', '/api/auth/me'),

  getAgents: (params = '') => request('GET', '/api/agents' + (params ? '?' + params : '')),
  getAgent: (id) => request('GET', '/api/agents/' + id),
  deleteAgent: (id) => request('DELETE', '/api/agents/' + id),
  createTask: (agentId, taskType, args) => request('POST', '/api/agents/' + agentId + '/tasks', { task_type: taskType, args }),
  getAgentTasks: (id) => request('GET', '/api/agents/' + id + '/tasks'),
  getAgentResults: (id) => request('GET', '/api/agents/' + id + '/results'),

  getCredentials: (params = '') => request('GET', '/api/credentials' + (params ? '?' + params : '')),
  exportCredentials: () => request('GET', '/api/credentials/export'),

  getFiles: (params = '') => request('GET', '/api/files' + (params ? '?' + params : '')),
  downloadFile: (id) => fetch(BASE + '/api/files/' + id + '/download', {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  }),

  getListeners: () => request('GET', '/api/listeners'),
  createListener: (data) => request('POST', '/api/listeners', data),
  updateListener: (id, data) => request('PUT', '/api/listeners/' + id, data),
  startListener: (id) => request('POST', '/api/listeners/' + id + '/start'),
  stopListener: (id) => request('POST', '/api/listeners/' + id + '/stop'),

  getStats: () => request('GET', '/api/stats'),
  getActivity: (limit = 50) => request('GET', '/api/activity?limit=' + limit),

  buildAgent: (data) => request('POST', '/api/builder/generate', data),
  buildStatus: (id) => request('GET', '/api/builder/status/' + id),
  builderHistory: () => request('GET', '/api/builder/history'),
  downloadBuild: (id) => {
    const token = localStorage.getItem('sg_token');
    const a = document.createElement('a');
    a.href = '/api/builder/download/' + id;
    // Use fetch with auth header to download
    fetch('/api/builder/download/' + id, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-' + id + '.zip';
      a.click();
      URL.revokeObjectURL(url);
    });
  },

  getSettings: () => request('GET', '/api/settings'),
  updateSettings: (data) => request('POST', '/api/settings', data),
};
