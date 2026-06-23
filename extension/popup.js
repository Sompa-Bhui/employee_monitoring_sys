const SUPABASE_URL = 'https://lrvwbtfqdjjjqmpfbfvz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4B52bbGWu0RjvGW95_aicA_YLOvJDOt';
const DASHBOARD_URL = 'http://localhost:3000/employee';

const authSection = document.getElementById('authSection');
const dashboardSection = document.getElementById('dashboardSection');
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const openPortalBtn = document.getElementById('openPortalBtn');

const authErrorMessage = document.getElementById('errorMessage');
const authSuccessMessage = document.getElementById('successMessage');
const dashboardErrorMessage = document.getElementById('dashboardErrorMessage');
const dashboardSuccessMessage = document.getElementById('dashboardSuccessMessage');

const avatarInitial = document.getElementById('avatarInitial');
const userNameEl = document.getElementById('userName');
const userLocalTimeEl = document.getElementById('userLocalTime');
const userEmailEl = document.getElementById('userEmail');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

const currentUrlEl = document.getElementById('currentUrl');
const currentDomainEl = document.getElementById('currentDomain');
const currentTimeEl = document.getElementById('currentTime');

const productivityPercentEl = document.getElementById('productivityPercent');
const productiveTimeEl = document.getElementById('productiveTime');
const unproductiveTimeEl = document.getElementById('unproductiveTime');
const productivityBarEl = document.getElementById('productivityBar');

const totalUsageTimeEl = document.getElementById('totalUsageTime');
const websitesTrackedEl = document.getElementById('websitesTracked');
const totalVisitsEl = document.getElementById('totalVisits');
const mostVisitedEl = document.getElementById('mostVisited');
const recentActivityBody = document.getElementById('recentActivityBody');
const recentActivityEmpty = document.getElementById('recentActivityEmpty');
const browserHistoryBody = document.getElementById('browserHistoryBody');
const browserHistoryEmpty = document.getElementById('browserHistoryEmpty');
const TIMEZONE_FALLBACK = 'Asia/Kolkata';

let lastStatus = null;
let latestMetrics = null;
let latestBrowserHistoryRows = [];
let latestLogs = [];
let latestTrackedHistoryRecords = [];
let refreshInFlight = false;
let historyRefreshTimer = null;

class SupabaseAuth {
  constructor(url, key) {
    this.url = url;
    this.key = key;
  }

  async signInWithPassword({ email, password }) {
    return this._authRequest('/auth/v1/token?grant_type=password', { email, password });
  }

  async _authRequest(endpoint, data, method = 'POST') {
    const response = await fetch(`${this.url}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Accept': 'application/json'
      },
      body: method === 'GET' ? undefined : JSON.stringify(data)
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        payload?.error_description ||
        payload?.message ||
        payload?.error?.message ||
        `Authentication failed (${response.status})`
      );
    }

    return payload;
  }
}

const auth = new SupabaseAuth(SUPABASE_URL, SUPABASE_ANON_KEY);

function setStorage(key, value) {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}

function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] || null));
  });
}

function removeStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

async function getTrackedRecentHistory() {
  const response = await sendMessage('getRecentHistory');
  const records = Array.isArray(response?.records) ? response.records : [];
  console.log('[Popup] History records found:', {
    source: 'chrome.storage.local',
    count: records.length,
    sample: records.slice(0, 3)
  });
  return records;
}

function showMessage(target, message, kind) {
  if (!target) {
    return;
  }

  target.textContent = message;
  target.className = `${kind}-message show`;
  window.setTimeout(() => {
    target.className = `${kind}-message`;
  }, 5000);
}

function clearMessages() {
  [authErrorMessage, authSuccessMessage, dashboardErrorMessage, dashboardSuccessMessage].forEach((node) => {
    if (node) {
      node.classList.remove('show');
      node.textContent = '';
    }
  });
}

function updateStatusBadge(status) {
  const normalized = status === 'tracking' ? 'tracking' : status === 'online' ? 'online' : 'offline';
  statusBadge.className = `status-badge ${normalized}`;
  statusText.textContent = normalized === 'tracking' ? 'Tracking' : normalized === 'online' ? 'Online' : 'Offline';
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  return `${secs}s`;
}

function formatShortDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${secs}s`;
}

function formatClock(value) {
  if (!value) {
    return '-';
  }

  const timezone = lastStatus?.timezone || TIMEZONE_FALLBACK;
  return new Date(value).toLocaleTimeString([], {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getTimezoneLabel(timeZone) {
  console.log('[PopupTimezone] getTimezoneLabel input:', timeZone);
  switch (timeZone || TIMEZONE_FALLBACK) {
    case 'Asia/Kolkata':
      return 'IST';
    case 'America/New_York':
      return 'US Eastern';
    case 'America/Chicago':
      return 'US Central';
    case 'America/Los_Angeles':
      return 'US Pacific';
    default:
      return timeZone || TIMEZONE_FALLBACK;
  }
}

function formatLocalTime(value, timeZone) {
  console.log('[PopupTimezone] formatLocalTime input:', { value, timeZone });
  return new Date(value).toLocaleTimeString([], {
    timeZone: timeZone || TIMEZONE_FALLBACK,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function truncateUrl(url) {
  if (!url) {
    return 'No active website';
  }

  return url.length > 58 ? `${url.slice(0, 55)}...` : url;
}

function truncateDomain(domain) {
  if (!domain) {
    return '-';
  }

  return domain.length > 12 ? `${domain.slice(0, 9)}...` : domain;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('[Popup] Non-JSON response received', {
      status: response.status,
      preview: text.slice(0, 180)
    });
    return { message: text };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleFromUrl(url) {
  if (!url) {
    return 'Tracked website';
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/[-_/]+/g, ' ').trim();
    return path ? `${parsed.hostname}${path ? ` ${path}` : ''}` : parsed.hostname;
  } catch (_error) {
    return url;
  }
}

function normalizeBrowserHistoryRecord(record) {
  return {
    title: record?.title || titleFromUrl(record?.url || ''),
    url: record?.url || '',
    domain: record?.domain || 'unknown',
    visitTime: record?.visitTime || record?.created_at || new Date().toISOString(),
    timeSpent: Number(record?.timeSpent ?? record?.time_spent ?? 0)
  };
}

async function fetchActivityLogs(userId, accessToken) {
  const params = new URLSearchParams({
    select: 'url,domain,time_spent,visit_count,created_at',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '500'
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs?${params.toString()}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || `Failed to load activity logs (${response.status})`);
  }

  const logs = Array.isArray(payload) ? payload : [];
  console.log('[Popup] Records fetched:', {
    source: 'Supabase activity_logs',
    userId,
    count: logs.length
  });
  return logs;
}

async function fetchEmployeeProfile(userId, accessToken) {
  const params = new URLSearchParams({
    select: 'id,email,name,role,status,timezone',
    id: `eq.${userId}`,
    limit: '1'
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/users?${params.toString()}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  const payload = await parseJsonResponse(response);
  console.log('[PopupTimezone] fetched profile payload:', payload);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || `Failed to load profile (${response.status})`);
  }

  return Array.isArray(payload) ? payload[0] || null : payload || null;
}

function searchBrowserHistoryByUrl(url) {
  return new Promise((resolve) => {
    if (!chrome.history || !url) {
      resolve(null);
      return;
    }

    chrome.history.search(
      {
        text: url,
        startTime: 0,
        maxResults: 10
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.warn('[Popup] History search failed:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }

        const exactMatch = results.find((item) => item.url === url);
        resolve(exactMatch || results[0] || null);
      }
    );
  });
}

async function buildBrowserHistoryRows(trackedHistoryRecords, logs) {
  const trackedSessionRecords = trackedHistoryRecords.filter((record) => record?.url);
  const sourceRecords = trackedSessionRecords.length ? trackedSessionRecords : logs;
  console.log('[Popup] Browser history source selected:', {
    source: trackedSessionRecords.length ? 'chrome.storage.local recent_browser_history' : 'Supabase activity_logs',
    count: sourceRecords.length
  });

  return sourceRecords
    .slice(0, 50)
    .map(normalizeBrowserHistoryRecord)
    .filter((row) => row.url)
    .sort((a, b) => new Date(b.visitTime).getTime() - new Date(a.visitTime).getTime());
}

function buildMetrics(trackedHistoryRecords, logs, status) {
  const allTrackedRecords = trackedHistoryRecords.filter((record) => record?.url);
  const metricSourceRecords = allTrackedRecords.length
    ? allTrackedRecords.map((record) => ({
      domain: record.domain || 'unknown',
      timeSpent: Number(record.timeSpent || 0),
      visits: Number(record.visitCount || (record.timeSpent > 0 || record.source === 'tracking' ? 1 : 0)),
      lastVisit: record.visitTime,
      url: record.url || ''
    }))
    : logs.map((log) => ({
      domain: log.domain || 'unknown',
      timeSpent: Number(log.time_spent || 0),
      visits: Number(log.visit_count || 0),
      lastVisit: log.created_at,
      url: log.url || ''
    }));

  const domainStats = new Map();
  let totalTrackedUsageTime = 0;
  let totalVisits = 0;
  let latestUrl = status.currentUrl || logs[0]?.url || '';

  for (const record of metricSourceRecords) {
    const domain = record.domain || 'unknown';
    const timeSpent = Number(record.timeSpent || 0);
    const visits = Number(record.visits || 0);
    totalTrackedUsageTime += timeSpent;
    totalVisits += visits;

    if (!latestUrl && record.url) {
      latestUrl = record.url;
    }

    if (!domainStats.has(domain)) {
      domainStats.set(domain, {
        domain,
        totalTime: 0,
        totalVisits: 0,
        lastVisit: record.lastVisit,
        latestUrl: record.url || ''
      });
    }

    const entry = domainStats.get(domain);
    entry.totalTime += timeSpent;
    entry.totalVisits += visits;
    entry.latestUrl = entry.latestUrl || record.url || '';

    if (!entry.lastVisit || new Date(record.lastVisit) > new Date(entry.lastVisit)) {
      entry.lastVisit = record.lastVisit;
    }
  }

  const productiveSeconds = Number(status.productiveSeconds || 0);
  const unproductiveSeconds = Number(status.unproductiveSeconds || 0);
  const currentWebsiteActiveTime = Number(status.currentTimeSpent || 0);

  const rankedDomains = Array.from(domainStats.values()).sort((a, b) => {
    if (b.totalVisits !== a.totalVisits) {
      return b.totalVisits - a.totalVisits;
    }
    return b.totalTime - a.totalTime;
  });

  const recentRecords = metricSourceRecords.slice(0, 50).map((record) => ({
    domain: record.domain || 'unknown',
    totalTime: Number(record.timeSpent || 0),
    totalVisits: Number(record.visits || 0),
    lastVisit: record.lastVisit,
    url: record.url || ''
  }));

  const mostVisited = rankedDomains[0]?.domain || '-';
  const websitesTracked = domainStats.size;
  const productivityPercent = Math.min(100, Math.round((productiveSeconds / 32400) * 100));

  console.log('[TrackingDebug] popup-metrics-aggregated', {
    trackedRecordCount: allTrackedRecords.length,
    storageRecordCount: trackedHistoryRecords.length,
    totalTrackedUsageTime,
    currentWebsiteActiveTime,
    totalVisits,
    productiveSeconds,
    unproductiveSeconds,
    productivityPercent
  });

  return {
    totalUsageSeconds: totalTrackedUsageTime,
    currentWebsiteActiveTime,
    totalVisits,
    websitesTracked,
    mostVisited,
    productiveSeconds,
    unproductiveSeconds,
    productivityPercent,
    latestUrl,
    recentRows: recentRecords,
    recentActivityRows: rankedDomains.slice(0, 20)
  };
}

function renderRecentActivity(rows) {
  recentActivityBody.innerHTML = '';

  if (!rows.length) {
    recentActivityEmpty.classList.remove('hidden');
    return;
  }

  recentActivityEmpty.classList.add('hidden');

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="domain-cell" title="${row.url || row.domain}">${truncateDomain(row.domain)}</td>
      <td>${formatShortDuration(row.totalTime)}</td>
      <td>${row.totalVisits}</td>
      <td>${formatClock(row.lastVisit)}</td>
    `;
    recentActivityBody.appendChild(tr);
  }
}

function renderBrowserHistory(rows) {
  browserHistoryBody.innerHTML = '';

  if (!rows.length) {
    console.log('[Popup] No browser history rows available for display.', {
      source: 'chrome.storage.local recent_browser_history / Supabase activity_logs fallback'
    });
    browserHistoryEmpty.classList.remove('hidden');
    return;
  }

  browserHistoryEmpty.classList.add('hidden');

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="compact-cell">
        <div class="history-title" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</div>
      </td>
      <td class="compact-cell">
        <span class="history-url" title="${escapeHtml(row.url)}">${escapeHtml(row.url || '-')}</span>
      </td>
      <td class="domain-cell compact-cell" title="${escapeHtml(row.domain)}">${escapeHtml(truncateDomain(row.domain))}</td>
      <td class="compact-cell">${formatClock(row.visitTime)}</td>
      <td class="compact-cell">${formatDuration(row.timeSpent)}</td>
    `;
    browserHistoryBody.appendChild(tr);
  }
}

function renderDashboard(status, metrics, browserHistoryRows = latestBrowserHistoryRows) {
  const name = status.name || 'Employee';
  const email = status.email || 'employee@company.com';
  const timezone = lastStatus?.timezone || status.timezone || TIMEZONE_FALLBACK;
  console.log('[PopupTimezone] renderDashboard timezone sources:', {
    statusTimezone: status.timezone,
    lastStatusTimezone: lastStatus?.timezone,
    resolvedTimezone: timezone
  });
  const initial = name.trim().charAt(0).toUpperCase() || 'E';
  const badgeState = status.isTracking ? 'tracking' : 'online';

  avatarInitial.textContent = initial;
  userNameEl.textContent = `${name} (${getTimezoneLabel(timezone)})`;
  userLocalTimeEl.textContent = formatLocalTime(new Date(), timezone);
  userEmailEl.textContent = `${email} (Employee)`;
  updateStatusBadge(badgeState);

  currentUrlEl.textContent = truncateUrl(status.currentUrl || metrics.latestUrl || '');
  currentUrlEl.title = status.currentUrl || metrics.latestUrl || '';
  currentDomainEl.textContent = status.currentDomain || metrics.mostVisited || '-';
  currentTimeEl.textContent = formatDuration(metrics.currentWebsiteActiveTime || 0);

  productivityPercentEl.textContent = `${metrics.productivityPercent}%`;
  productiveTimeEl.textContent = formatDuration(metrics.productiveSeconds);
  unproductiveTimeEl.textContent = formatDuration(metrics.unproductiveSeconds);
  productivityBarEl.style.width = `${metrics.productivityPercent}%`;

  totalUsageTimeEl.textContent = formatDuration(metrics.totalUsageSeconds);
  websitesTrackedEl.textContent = String(metrics.websitesTracked);
  totalVisitsEl.textContent = String(metrics.totalVisits);
  mostVisitedEl.textContent = metrics.mostVisited;

  renderRecentActivity(metrics.recentActivityRows);
  renderBrowserHistory(browserHistoryRows);
}

async function loadDashboardData(options = {}) {
  const { force = false } = options;

  if (refreshInFlight && !force) {
    return;
  }

  refreshInFlight = true;
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing';

  try {
    clearMessages();
    const status = await sendMessage('getStatus');
    lastStatus = status;

    if (!status.isLoggedIn) {
      authSection.classList.add('show');
      dashboardSection.classList.remove('show');
      updateStatusBadge('offline');
      return;
    }

    authSection.classList.remove('show');
    dashboardSection.classList.add('show');

    const accessToken = await getStorage('session_token');
    if (!accessToken) {
      throw new Error('Missing session token. Please sign in again.');
    }

    const profile = await fetchEmployeeProfile(status.userId, accessToken);
    lastStatus = { ...status, timezone: profile?.timezone || TIMEZONE_FALLBACK };
    console.log('[PopupTimezone] loadDashboardData timezone state:', {
      profileTimezone: profile?.timezone,
      statusTimezone: status.timezone,
      lastStatusTimezone: lastStatus.timezone
    });
    await setStorage('employee_timezone', lastStatus.timezone);

    const trackedHistoryRecords = await getTrackedRecentHistory();
    latestTrackedHistoryRecords = trackedHistoryRecords;
    const logs = await fetchActivityLogs(status.userId, accessToken);
    latestLogs = logs;
    const browserHistoryRows = await buildBrowserHistoryRows(trackedHistoryRecords, logs);
    latestBrowserHistoryRows = browserHistoryRows;
    latestMetrics = buildMetrics(trackedHistoryRecords, logs, status);
    renderDashboard(status, latestMetrics, browserHistoryRows);
  } catch (error) {
    console.error('[Popup] Failed to load dashboard data:', error);
    showMessage(dashboardErrorMessage, error.message || 'Failed to load dashboard data.', 'error');
  } finally {
    refreshInFlight = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearMessages();

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage(authErrorMessage, 'Email and password are required.', 'error');
    return;
  }

  const submitBtn = loginForm.querySelector('button');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing In';

  try {
    const authResponse = await auth.signInWithPassword({ email, password });
    const user = authResponse.user || authResponse;
    const accessToken = authResponse.access_token || authResponse.session?.access_token;

    if (!user?.id || !accessToken) {
      throw new Error('Login succeeded but session data was incomplete.');
    }

    const userData = {
      userId: user.id,
      email: user.email || email,
      name: user.user_metadata?.full_name || user.email || email,
      token: accessToken,
      timezone: null
    };

    try {
      const params = new URLSearchParams({
        select: 'timezone',
        id: `eq.${user.id}`,
        limit: '1'
      });
      const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/users?${params.toString()}`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      const profilePayload = await parseJsonResponse(profileResponse);
      console.log('[PopupTimezone] login profile payload:', profilePayload);
      if (profileResponse.ok && Array.isArray(profilePayload) && profilePayload[0]?.timezone) {
        userData.timezone = profilePayload[0].timezone;
      }
    } catch (_error) {
      userData.timezone = null;
    }

    await setStorage('employee_user_id', userData.userId);
    await setStorage('session_token', userData.token);
    await setStorage('employee_email', userData.email);
    await setStorage('employee_name', userData.name);
    await setStorage('employee_timezone', userData.timezone || TIMEZONE_FALLBACK);
    console.log('[PopupTimezone] stored employee_timezone:', userData.timezone || TIMEZONE_FALLBACK);

    const backgroundResponse = await sendMessage('login', userData);
    if (backgroundResponse?.error) {
      throw new Error(backgroundResponse.error);
    }

    showMessage(authSuccessMessage, 'Logged in successfully.', 'success');
    emailInput.value = '';
    passwordInput.value = '';
    await loadDashboardData({ force: true });
  } catch (error) {
    console.error('[Popup] Login error:', error);
    showMessage(authErrorMessage, error.message || 'Login failed. Check your credentials.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}

async function handleLogout() {
  clearMessages();
  logoutBtn.disabled = true;
  logoutBtn.textContent = 'Logging out';

  try {
    await sendMessage('logout');
    await removeStorage(['employee_user_id', 'session_token', 'employee_email', 'employee_name', 'employee_timezone']);
    lastStatus = null;
    latestMetrics = null;
    latestBrowserHistoryRows = [];
    latestTrackedHistoryRecords = [];
    latestLogs = [];
    dashboardSection.classList.remove('show');
    authSection.classList.add('show');
    updateStatusBadge('offline');
    showMessage(authSuccessMessage, 'Logged out successfully.', 'success');
  } catch (error) {
    console.error('[Popup] Logout error:', error);
    showMessage(dashboardErrorMessage, 'Logout failed.', 'error');
  } finally {
    logoutBtn.disabled = false;
    logoutBtn.textContent = 'Logout';
  }
}

async function refreshLiveTimeOnly() {
  if (!lastStatus || !latestMetrics) {
    return;
  }

  try {
    const status = await sendMessage('getStatus');
    lastStatus = {
      ...lastStatus,
      ...status,
      timezone: lastStatus?.timezone || status.timezone || TIMEZONE_FALLBACK
    };
    const trackedHistoryRecords = await getTrackedRecentHistory();
    latestTrackedHistoryRecords = trackedHistoryRecords;
    latestMetrics = buildMetrics(trackedHistoryRecords, latestLogs, lastStatus);
    renderDashboard(lastStatus, latestMetrics);
  } catch (error) {
    console.error('[Popup] Status refresh error:', error);
  }
}

function scheduleHistoryRefresh() {
  if (historyRefreshTimer) {
    window.clearTimeout(historyRefreshTimer);
  }

  historyRefreshTimer = window.setTimeout(() => {
    loadDashboardData();
  }, 350);
}

loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
refreshBtn.addEventListener('click', () => loadDashboardData({ force: true }));
openPortalBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateStatus') {
    refreshLiveTimeOnly();
    scheduleHistoryRefresh();
  }
});

window.setInterval(refreshLiveTimeOnly, 1000);
document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData({ force: true });
});
