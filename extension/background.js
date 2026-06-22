// Extension Configuration
const CONFIG = {
  SUPABASE_URL: 'https://lrvwbtfqdjjjqmpfbfvz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_4B52bbGWu0RjvGW95_aicA_YLOvJDOt',
  API_ENDPOINT: 'http://localhost:3000/api/activity'  // Will sync to dashboard API
};

// ─── Storage Keys ───
const STORAGE_KEYS = {
  USER_ID: 'employee_user_id',
  SESSION_TOKEN: 'session_token',
  EMAIL: 'employee_email',
  NAME: 'employee_name',
  LAST_PING: 'last_ping_time',
  CURRENT_TAB: 'current_tab_data',
  RECENT_HISTORY: 'recent_browser_history',
  TRACKING_STATS: 'tracking_stats'
};

// ─── Tab Tracking ───
let activeTabId = null;
let tabStartTime = null;
let currentDomain = null;
let currentUrl = null;
let currentTitle = null;
let currentVisitId = null;
let isTracking = false;
let productiveSecondsToday = 0;
let unproductiveSecondsToday = 0;
let trackingSegmentStart = null;
let trackingSegmentType = null;
let totalVisitsToday = 0;
let lastSavedAt = null;
let trackingStateReady = null;
let trackingCommitQueue = Promise.resolve();

const DEBUG_PREFIX = '[TrackingDebug]';

function logTrackingDebug(event, details = {}) {
  console.log(`${DEBUG_PREFIX} ${event}`, details);
}

// ─── Supabase Client (Simple Implementation) ───
class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
  }

  async query(table, method = 'GET', data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Accept': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.url}/rest/v1/${table}`, options);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `API error: ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();

      if (!responseText) {
        return null;
      }

      if (contentType.includes('application/json')) {
        return JSON.parse(responseText);
      }

      try {
        return JSON.parse(responseText);
      } catch (_error) {
        return responseText;
      }
    } catch (error) {
      console.error(`Supabase query failed for ${table}:`, error);
      throw error;
    }
  }

  // Insert activity log
  async insertActivityLog(logData, sessionToken) {
    try {
      logTrackingDebug('supabase-write-started', {
        domain: logData.domain,
        url: logData.url,
        timeSpent: logData.time_spent,
        visitCount: logData.visit_count
      });
      const headers = {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Prefer': 'return=minimal'
      };

      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      } else {
        headers['Authorization'] = `Bearer ${this.key}`;
      }

      const response = await fetch(`${this.url}/rest/v1/activity_logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(logData)
      });

      if (!response.ok) {
        const error = await response.text();
        logTrackingDebug('supabase-write-failed', {
          status: response.status,
          error,
          payload: logData
        });
        console.error(`[Extension] Insert failed (${response.status}):`, error);
        return false;
      }

      logTrackingDebug('supabase-write-succeeded', {
        status: response.status,
        payload: logData
      });
      return true;
    } catch (error) {
      logTrackingDebug('supabase-write-error', {
        message: error.message,
        payload: logData
      });
      console.error('[Extension] Failed to insert activity log:', error);
      return false;
    }
  }
}

const supabase = new SupabaseClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

async function syncCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.id || !tab.url) {
      return;
    }

    const previousTabId = activeTabId;
    const previousUrl = currentUrl;
    activeTabId = tab.id;
    currentUrl = tab.url;
    currentTitle = tab.title || tab.url;
    console.log('[Extension] URL detected during sync:', currentUrl);

    try {
      currentDomain = new URL(tab.url).hostname || 'unknown';
    } catch (_error) {
      currentDomain = 'unknown';
    }

    if (tabStartTime === null) {
      tabStartTime = Date.now();
    }

    // Restore or create the active visit independently from the live timer.
    // A valid tabStartTime alone is not enough for aggregation.
    if (isTracking && isTrackableUrl(tab.url)) {
      const activePageChanged = previousTabId !== null && (
        previousTabId !== tab.id || (previousUrl && previousUrl !== tab.url)
      );
      if (!currentVisitId || activePageChanged) {
        tabStartTime = Date.now();
        currentVisitId = `${tab.id}-${tabStartTime}`;
        lastSavedAt = tabStartTime;
      }

      if (trackingSegmentStart === null || trackingSegmentType === null) {
        startTrackingSegment('productive');
      }

      const records = await getRecentHistoryRecords();
      const currentVisit = records.find((record) => record.visitId === currentVisitId);
      if (!currentVisit) {
        totalVisitsToday += 1;
        await addRecentHistoryRecord({
          visitId: currentVisitId,
          tabId: tab.id,
          title: currentTitle,
          url: currentUrl,
          domain: currentDomain,
          visitTime: new Date(tabStartTime).toISOString(),
          timeSpent: 0,
          visitCount: 1,
          source: 'tracking',
          syncedToSupabase: false
        });
        logTrackingDebug('visit-count-incremented', {
          reason: 'active-visit-created',
          visitId: currentVisitId,
          totalVisitsToday
        });
      } else if (Number(currentVisit.visitCount || 0) < 1) {
        totalVisitsToday += 1;
        await updateRecentHistoryRecord(currentVisitId, { visitCount: 1 });
        logTrackingDebug('visit-count-incremented', {
          reason: 'active-visit-repaired',
          visitId: currentVisitId,
          totalVisitsToday
        });
      }

      await persistTrackingStats();
      await persistCurrentTabState();
    }
  } catch (error) {
    console.error('[Extension] Failed to sync current tab:', error);
  }
}

function isTrackableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname || 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

function createTrackingSnapshot() {
  return {
    tabId: activeTabId,
    startTime: tabStartTime,
    lastSavedAt,
    domain: currentDomain,
    url: currentUrl,
    title: currentTitle,
    visitId: currentVisitId
  };
}

function getCurrentTrackingType() {
  return isTracking && activeTabId !== null && currentDomain !== null && isTrackableUrl(currentUrl)
    ? 'productive'
    : 'unproductive';
}

function finalizeActiveSegment() {
  if (trackingSegmentStart === null || trackingSegmentType === null) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - trackingSegmentStart) / 1000));
  if (trackingSegmentType === 'productive') {
    productiveSecondsToday += elapsedSeconds;
  } else {
    unproductiveSecondsToday += elapsedSeconds;
  }

  logTrackingDebug('segment-finalized', {
    segmentType: trackingSegmentType,
    sessionDurationSeconds: elapsedSeconds,
    productiveSecondsToday,
    unproductiveSecondsToday
  });

  trackingSegmentStart = null;
  trackingSegmentType = null;
}

function startTrackingSegment(nextType) {
  finalizeActiveSegment();
  trackingSegmentStart = Date.now();
  trackingSegmentType = nextType;
}

async function syncTrackedVisitTime(now = Date.now()) {
  if (!currentVisitId || tabStartTime === null) {
    return;
  }

  const timeSpent = Math.max(0, Math.floor((now - tabStartTime) / 1000));
  await updateRecentHistoryRecord(currentVisitId, {
    tabId: activeTabId,
    title: currentTitle || currentUrl,
    url: currentUrl,
    domain: currentDomain,
    visitTime: new Date(tabStartTime).toISOString(),
    timeSpent,
    visitCount: 1,
    source: 'tracking'
  });

  logTrackingDebug('website-duration-updated', {
    visitId: currentVisitId,
    domain: currentDomain,
    accumulatedWebsiteDurationSeconds: timeSpent
  });
}

function commitTrackedTime(now = Date.now()) {
  trackingCommitQueue = trackingCommitQueue.then(
    () => commitTrackedTimeInternal(now),
    () => commitTrackedTimeInternal(now)
  );
  return trackingCommitQueue;
}

async function commitTrackedTimeInternal(now) {
  if (trackingSegmentStart === null || trackingSegmentType === null) {
    logTrackingDebug('commit-skipped-missing-segment', {
      trackingSegmentStart,
      trackingSegmentType,
      currentVisitId,
      currentUrl
    });
    return;
  }

  const elapsedMilliseconds = Math.max(0, now - trackingSegmentStart);
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  if (elapsedSeconds > 0) {
    if (trackingSegmentType === 'productive') {
      productiveSecondsToday += elapsedSeconds;
    } else {
      unproductiveSecondsToday += elapsedSeconds;
    }

    // Advance by consumed whole seconds only. Keeping the millisecond
    // remainder prevents frequent popup polls from discarding tracked time.
    trackingSegmentStart += elapsedSeconds * 1000;
  }

  if (trackingSegmentType === 'productive') {
    await syncTrackedVisitTime(now);
  }

  await persistTrackingStats();
  await persistCurrentTabState();

  logTrackingDebug('time-committed', {
    segmentType: trackingSegmentType,
    currentSessionDurationSeconds: tabStartTime === null ? 0 : Math.floor((now - tabStartTime) / 1000),
    elapsedSecondsAdded: elapsedSeconds,
    remainderMilliseconds: elapsedMilliseconds - (elapsedSeconds * 1000),
    productiveSecondsToday,
    unproductiveSecondsToday,
    totalVisitsToday
  });
}

function getTrackedTotals() {
  const liveType = getCurrentTrackingType();
  const liveElapsed = trackingSegmentStart === null ? 0 : Math.max(0, Math.floor((Date.now() - trackingSegmentStart) / 1000));
  const liveProductive = liveType === 'productive' && trackingSegmentType === 'productive' ? liveElapsed : 0;
  const liveUnproductive = liveType === 'unproductive' && trackingSegmentType === 'unproductive' ? liveElapsed : 0;

  return {
    productiveSeconds: productiveSecondsToday + liveProductive,
    unproductiveSeconds: unproductiveSecondsToday + liveUnproductive,
    totalUsageSeconds: productiveSecondsToday + liveProductive,
    totalVisits: totalVisitsToday
  };
}

async function loadTrackingStats() {
  const stats = await getStorageValue(STORAGE_KEYS.TRACKING_STATS);
  if (stats && typeof stats === 'object') {
    productiveSecondsToday = Number(stats.productiveSecondsToday || 0);
    unproductiveSecondsToday = Number(stats.unproductiveSecondsToday || 0);
    totalVisitsToday = Number(stats.totalVisitsToday || 0);
    trackingSegmentStart = Number(stats.trackingSegmentStart || 0) || null;
    trackingSegmentType = stats.trackingSegmentType || null;
  }

  await reconcileTrackingStatsFromHistory();

  logTrackingDebug('tracking-stats-loaded', {
    productiveSecondsToday,
    unproductiveSecondsToday,
    totalVisitsToday,
    trackingSegmentStart,
    trackingSegmentType
  });
}

async function persistTrackingStats() {
  await setStorageValue(STORAGE_KEYS.TRACKING_STATS, {
    productiveSecondsToday,
    unproductiveSecondsToday,
    totalVisitsToday,
    trackingSegmentStart,
    trackingSegmentType,
    updatedAt: new Date().toISOString()
  });
}

async function loadCurrentTabState() {
  const currentTabState = await getStorageValue(STORAGE_KEYS.CURRENT_TAB);
  if (!currentTabState || typeof currentTabState !== 'object') {
    return;
  }

  activeTabId = currentTabState.activeTabId ?? activeTabId;
  tabStartTime = currentTabState.tabStartTime ?? tabStartTime;
  lastSavedAt = currentTabState.lastSavedAt ?? lastSavedAt;
  currentDomain = currentTabState.currentDomain ?? currentDomain;
  currentUrl = currentTabState.currentUrl ?? currentUrl;
  currentTitle = currentTabState.currentTitle ?? currentTitle;
  currentVisitId = currentTabState.currentVisitId ?? currentVisitId;
}

async function persistCurrentTabState() {
  await setStorageValue(STORAGE_KEYS.CURRENT_TAB, {
    activeTabId,
    tabStartTime,
    lastSavedAt,
    currentDomain,
    currentUrl,
    currentTitle,
    currentVisitId,
    updatedAt: new Date().toISOString()
  });
}

async function initializeTrackingState() {
  const userId = await getStorageValue(STORAGE_KEYS.USER_ID);
  if (userId) {
    isTracking = true;
    console.log('[Extension] User session active. Tracking auto-started.');
  }

  await loadTrackingStats();
  await loadCurrentTabState();
  await syncCurrentTab();
}

function normalizeHistoryRecord(record = {}) {
  return {
    visitId: record.visitId || `${record.tabId || 'history'}-${record.visitTime || Date.now()}`,
    tabId: record.tabId || null,
    title: record.title || record.url || 'Tracked website',
    url: record.url || '',
    domain: record.domain || getDomainFromUrl(record.url || ''),
    visitTime: record.visitTime || new Date().toISOString(),
    timeSpent: Number(record.timeSpent || 0),
    visitCount: Number(record.visitCount || 0),
    source: record.source || 'tracking',
    syncedToSupabase: Boolean(record.syncedToSupabase),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

async function getRecentHistoryRecords() {
  const records = await getStorageValue(STORAGE_KEYS.RECENT_HISTORY);
  logTrackingDebug('storage-read-history', {
    recordCount: Array.isArray(records) ? records.length : 0,
    sample: Array.isArray(records) ? records.slice(0, 3) : []
  });
  return Array.isArray(records) ? records : [];
}

async function reconcileTrackingStatsFromHistory() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const records = await getRecentHistoryRecords();
  const todayTrackingRecords = records.filter((record) => (
    record?.source === 'tracking' && new Date(record.visitTime).getTime() >= startOfDay.getTime()
  ));
  const historyUsageSeconds = todayTrackingRecords.reduce(
    (sum, record) => sum + Math.max(0, Number(record.timeSpent || 0)),
    0
  );
  const historyVisits = todayTrackingRecords.reduce(
    (sum, record) => sum + Math.max(0, Number(record.visitCount || 0)),
    0
  );

  productiveSecondsToday = Math.max(productiveSecondsToday, historyUsageSeconds);
  totalVisitsToday = Math.max(totalVisitsToday, historyVisits);

  logTrackingDebug('stats-reconciled-from-history', {
    trackingRecordCount: todayTrackingRecords.length,
    historyUsageSeconds,
    historyVisits,
    productiveSecondsToday,
    totalVisitsToday
  });
}

async function setRecentHistoryRecords(records) {
  await setStorageValue(STORAGE_KEYS.RECENT_HISTORY, records.slice(0, 100));
}

async function addRecentHistoryRecord(record) {
  const normalizedRecord = normalizeHistoryRecord(record);
  const records = await getRecentHistoryRecords();
  const nextRecords = [normalizedRecord, ...records.filter((item) => item.visitId !== normalizedRecord.visitId)];
  await setRecentHistoryRecords(nextRecords);
  console.log('[Extension] Recent history record stored:', {
    source: 'chrome.storage.local',
    visitId: normalizedRecord.visitId,
    totalRecords: nextRecords.length
  });
}

async function updateRecentHistoryRecord(visitId, patch) {
  if (!visitId) {
    return;
  }

  const records = await getRecentHistoryRecords();
  const existingRecord = records.find((record) => record.visitId === visitId);
  const updatedRecord = normalizeHistoryRecord({
    tabId: activeTabId,
    visitTime: tabStartTime === null ? new Date().toISOString() : new Date(tabStartTime).toISOString(),
    source: 'tracking',
    ...existingRecord,
    ...patch,
    visitId
  });
  const nextRecords = existingRecord
    ? records.map((record) => (record.visitId === visitId ? updatedRecord : record))
    : [updatedRecord, ...records];
  await setRecentHistoryRecords(nextRecords);
  logTrackingDebug(existingRecord ? 'history-record-updated' : 'history-record-recovered', {
    visitId,
    domain: updatedRecord.domain,
    timeSpent: updatedRecord.timeSpent,
    visitCount: updatedRecord.visitCount,
    totalRecords: nextRecords.length
  });
}

async function updateTrackedTab(tabId, url, reason) {
  if (!isTrackableUrl(url)) {
    console.log('[Extension] Ignoring non-trackable URL:', url);
    return;
  }

  let tabTitle = currentTitle;
  try {
    const tab = await chrome.tabs.get(tabId);
    tabTitle = tab.title || tab.url || url;
  } catch (_error) {
    tabTitle = url;
  }

  activeTabId = tabId;
  currentUrl = url;
  currentDomain = getDomainFromUrl(url);
  currentTitle = tabTitle || url;
  currentVisitId = `${tabId}-${Date.now()}`;
  tabStartTime = Date.now();
  lastSavedAt = tabStartTime;
  startTrackingSegment('productive');
  totalVisitsToday += 1;
  await persistTrackingStats();

  await addRecentHistoryRecord({
    visitId: currentVisitId,
    tabId,
    title: currentTitle,
    url: currentUrl,
    domain: currentDomain,
    visitTime: new Date().toISOString(),
    timeSpent: 0,
    visitCount: 1,
    source: 'tracking',
    syncedToSupabase: false
  });
  await persistCurrentTabState();

  logTrackingDebug('visit-count-incremented', {
    reason,
    visitId: currentVisitId,
    totalVisitsToday
  });

  console.log('[Extension] URL detected:', {
    reason,
    tabId,
    url: currentUrl,
    domain: currentDomain,
    title: currentTitle
  });

  updatePopupStatus();
}

async function syncHistoryVisit(url, title = '', visitTime = Date.now()) {
  if (!isTrackableUrl(url)) {
    return;
  }

  const record = normalizeHistoryRecord({
    visitId: `tracking-history-${url}-${visitTime}`,
    title: title || url,
    url,
    domain: getDomainFromUrl(url),
    visitTime: new Date(visitTime).toISOString(),
    timeSpent: 0,
    visitCount: 1,
    source: 'tracking'
  });

  await addRecentHistoryRecord(record);
  logTrackingDebug('browser-history-visit-recorded', {
    url,
    domain: record.domain,
    visitTime: record.visitTime,
    visitCount: record.visitCount
  });
}

function markUnproductive(reason) {
  if (!isTracking) {
    return;
  }

  startTrackingSegment('unproductive');
  persistTrackingStats().catch((error) => {
    console.error('[Extension] Failed to persist unproductive segment:', error);
  });
  console.log('[Extension] Marked unproductive time:', { reason });
}

// ─── Track Active Tab Changes ───
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const previousSnapshot = createTrackingSnapshot();

    // Save previous tab if any
    if (isTracking && previousSnapshot.tabId !== null && previousSnapshot.startTime !== null) {
      await saveTabActivity(previousSnapshot, 'tab-activated');
    }

    // Get tab details
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || !isTrackableUrl(tab.url)) {
      markUnproductive('activated-non-trackable-tab');
      activeTabId = activeInfo.tabId;
      currentUrl = tab.url || null;
      currentTitle = tab.title || tab.url || null;
      currentDomain = null;
      currentVisitId = null;
      lastSavedAt = null;
      tabStartTime = Date.now();
      persistCurrentTabState().catch((error) => {
        console.error('[Extension] Failed to persist current tab state:', error);
      });
      console.log('[Extension] Activated tab is not trackable:', tab.url);
      return;
    }

    await updateTrackedTab(activeInfo.tabId, tab.url, 'tab-activated');
  } catch (error) {
    console.error('[Extension] Tab change error:', error);
  }
});

// ─── Track Tab Updates ───
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId) {
    return;
  }

  if (changeInfo.url && isTrackableUrl(changeInfo.url)) {
    (async () => {
      try {
        const previousSnapshot = createTrackingSnapshot();
        const nextDomain = getDomainFromUrl(changeInfo.url);

        if (
          isTracking &&
          previousSnapshot.tabId !== null &&
          previousSnapshot.startTime !== null &&
          (previousSnapshot.url !== changeInfo.url || previousSnapshot.domain !== nextDomain)
        ) {
          await saveTabActivity(previousSnapshot, 'url-changed');
        }

        await updateTrackedTab(tabId, changeInfo.url, 'url-changed');
        console.log('[Extension] Activity updated for URL change:', {
          previousUrl: previousSnapshot.url,
          nextUrl: changeInfo.url
        });
      } catch (error) {
        console.error('[Extension] Tab URL update error:', error);
      }
    })();
    return;
  }

  if (changeInfo.status === 'complete' && tab?.url && isTrackableUrl(tab.url)) {
    currentUrl = tab.url || currentUrl;
    currentDomain = getDomainFromUrl(tab.url);
    currentTitle = tab.title || currentTitle || tab.url;
    console.log('[Extension] Tab load complete:', {
      tabId,
      url: currentUrl,
      domain: currentDomain,
      title: currentTitle
    });
    updateRecentHistoryRecord(currentVisitId, {
      title: currentTitle,
      url: currentUrl,
      domain: currentDomain
    }).catch((error) => {
      console.error('[Extension] Failed to update recent history title:', error);
    });
    persistCurrentTabState().catch((error) => {
      console.error('[Extension] Failed to persist current tab state:', error);
    });
    updatePopupStatus();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    markUnproductive('browser-blurred');
    return;
  }

  if (!isTracking) {
    return;
  }

  if (activeTabId !== null && isTrackableUrl(currentUrl)) {
    startTrackingSegment('productive');
    persistTrackingStats().catch((error) => {
      console.error('[Extension] Failed to persist productive segment:', error);
    });
  }
});

if (chrome.history?.onVisited) {
  chrome.history.onVisited.addListener((historyItem) => {
    if (!historyItem?.url || !isTrackableUrl(historyItem.url)) {
      return;
    }

    syncHistoryVisit(historyItem.url, historyItem.title || '', historyItem.lastVisitTime || Date.now()).catch((error) => {
      console.error('[Extension] Failed to sync browser history visit:', error);
    });
  });
}

// ─── Save Tab Activity to Supabase ───
async function saveTabActivity(snapshot = createTrackingSnapshot(), reason = 'activity-save') {
  if (snapshot.tabId === null || snapshot.startTime === null || !snapshot.domain || !snapshot.url) {
    console.log('[Extension] Skipping activity save: incomplete snapshot', snapshot);
    return;
  }

  const userId = await getStorageValue(STORAGE_KEYS.USER_ID);
  if (!userId) {
    console.warn('[Extension] No user ID, skipping activity save');
    return;
  }

  const sessionToken = await getStorageValue(STORAGE_KEYS.SESSION_TOKEN);
  if (!sessionToken) {
    console.warn('[Extension] No session token, skipping activity save');
    return;
  }

  const now = Date.now();
  const baseline = snapshot.lastSavedAt || snapshot.startTime;
  const timeSpent = Math.max(1, Math.round((now - baseline) / 1000));
  const isFirstSaveForVisit = baseline === snapshot.startTime;

  try {
    const activityLog = {
      user_id: userId,
      domain: snapshot.domain,
      url: snapshot.url,
      time_spent: timeSpent,
      visit_count: isFirstSaveForVisit ? 1 : 0,
      created_at: new Date().toISOString()
    };

    // Insert into Supabase
    const success = await supabase.insertActivityLog(activityLog, sessionToken);
    
    if (success) {
      lastSavedAt = now;
      await persistCurrentTabState();
      await updateRecentHistoryRecord(snapshot.visitId, {
        title: snapshot.title || snapshot.url,
        url: snapshot.url,
        domain: snapshot.domain,
        timeSpent: Math.max(1, Math.round((now - snapshot.startTime) / 1000)),
        visitCount: 1,
        syncedToSupabase: true,
        lastSyncedAt: new Date().toISOString()
      });
      console.log('[Extension] Activity inserted:', {
        reason,
        activityLog
      });
      
      // Also send ping to dashboard to update online status
      await sendPingToDashboard(userId);
      syncDashboardSnapshot({
        email: await getStorageValue(STORAGE_KEYS.EMAIL),
        name: await getStorageValue(STORAGE_KEYS.NAME),
        currentUrl: snapshot.url,
        currentDomain: snapshot.domain,
        currentTimeSpent: Math.max(1, Math.round((now - snapshot.startTime) / 1000)),
        productiveSeconds: productiveSecondsToday,
        unproductiveSeconds: unproductiveSecondsToday,
        totalUsageSeconds: productiveSecondsToday + unproductiveSecondsToday,
        totalVisits: totalVisitsToday
      }).catch((error) => {
        console.warn('[Extension] Snapshot sync after activity insert failed:', error?.message || error);
      });
    } else {
      await updateRecentHistoryRecord(snapshot.visitId, {
        title: snapshot.title || snapshot.url,
        url: snapshot.url,
        domain: snapshot.domain,
        timeSpent: Math.max(1, Math.floor((now - snapshot.startTime) / 1000)),
        visitCount: 1,
        syncedToSupabase: false,
        syncError: 'Supabase insert failed'
      });
    }
  } catch (error) {
    await updateRecentHistoryRecord(snapshot.visitId, {
      title: snapshot.title || snapshot.url,
      url: snapshot.url,
      domain: snapshot.domain,
      timeSpent: Math.max(1, Math.round((now - snapshot.startTime) / 1000)),
      visitCount: 1,
      syncedToSupabase: false,
      syncError: error.message || 'Unknown insert error'
    });
    console.error('[Extension] Failed to save activity:', error);
  }
}

// ─── Send Ping to Dashboard (for online status) ───
async function sendPingToDashboard(userId) {
  try {
    await setStorageValue(STORAGE_KEYS.LAST_PING, Date.now().toString());
    console.log('[Extension] Ping sent to dashboard');
  } catch (error) {
    console.error('[Extension] Ping failed:', error);
  }
}

async function syncDashboardSnapshot(status = null) {
  try {
    const userId = await getStorageValue(STORAGE_KEYS.USER_ID);
    if (!userId) {
      return;
    }

    const storedName = await getStorageValue(STORAGE_KEYS.NAME);
    const storedEmail = await getStorageValue(STORAGE_KEYS.EMAIL);
    const trackedHistoryRecords = await getRecentHistoryRecords();
    const liveTotals = getTrackedTotals();
    const activeStatus = status || {
      email: storedEmail,
      name: storedName,
      currentUrl,
      currentDomain,
      currentTimeSpent: isTracking && currentDomain && tabStartTime !== null
        ? Math.floor((Date.now() - tabStartTime) / 1000)
        : 0,
      productiveSeconds: liveTotals.productiveSeconds,
      unproductiveSeconds: liveTotals.unproductiveSeconds,
      totalUsageSeconds: liveTotals.totalUsageSeconds,
      totalVisits: liveTotals.totalVisits
    };

    const liveCurrentWebsite = activeStatus.currentUrl || currentUrl || '';
    const liveCurrentDomain = activeStatus.currentDomain || currentDomain || '';
    const liveCurrentTimeSpent = Number(activeStatus.currentTimeSpent || 0);
    const productiveSeconds = Number(activeStatus.productiveSeconds || 0);
    const unproductiveSeconds = Number(activeStatus.unproductiveSeconds || 0);
    const totalUsageSeconds = Number(activeStatus.totalUsageSeconds || 0);
    const totalVisits = Number(activeStatus.totalVisits || 0);
    const productivityPercent = productiveSeconds + unproductiveSeconds > 0
      ? Math.round((productiveSeconds / Math.max(1, productiveSeconds + unproductiveSeconds)) * 100)
      : 0;

    const historyRows = trackedHistoryRecords
      .filter((record) => record?.url)
      .slice(0, 50)
      .map((record) => ({
        title: record.title || record.url,
        url: record.url || '',
        domain: record.domain || getDomainFromUrl(record.url || ''),
        visitTime: record.visitTime || new Date().toISOString(),
        timeSpent: Number(record.timeSpent || 0),
        visitCount: Number(record.visitCount || 0)
      }));

    const domainStats = new Map();
    for (const row of historyRows) {
      const entry = domainStats.get(row.domain) || { domain: row.domain, totalVisits: 0, totalTime: 0 };
      entry.totalVisits += Number(row.visitCount || 0);
      entry.totalTime += Number(row.timeSpent || 0);
      domainStats.set(row.domain, entry);
    }

    const mostVisitedEntry = Array.from(domainStats.values()).sort((a, b) => {
      if (b.totalVisits !== a.totalVisits) return b.totalVisits - a.totalVisits;
      return b.totalTime - a.totalTime;
    })[0];

    const payload = {
      user_id: userId,
      email: storedEmail || activeStatus.email || null,
      name: storedName || activeStatus.name || null,
      current_url: liveCurrentWebsite,
      current_domain: liveCurrentDomain,
      current_title: currentTitle || liveCurrentWebsite || null,
      current_time_spent: liveCurrentTimeSpent,
      productive_seconds: productiveSeconds,
      unproductive_seconds: unproductiveSeconds,
      total_usage_seconds: totalUsageSeconds,
      total_visits: totalVisits,
      productivity_percent: productivityPercent,
      websites_tracked: domainStats.size,
      most_visited_website: mostVisitedEntry?.domain || liveCurrentDomain || null,
      recent_activity: historyRows.slice(0, 20).map((row) => ({
        domain: row.domain,
        url: row.url,
        timeSpent: row.timeSpent,
        visitCount: row.visitCount,
        visitTime: row.visitTime
      })),
      recent_browser_history: historyRows
    };

    await fetch(CONFIG.API_ENDPOINT.replace('/api/activity', '/api/tracking-snapshot'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('[Extension] Dashboard snapshot sync failed:', error?.message || error);
  }
}

// ─── Storage Helpers ───
async function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (key === STORAGE_KEYS.TRACKING_STATS) {
        logTrackingDebug('storage-write-tracking-stats', {
          productiveSecondsToday: value.productiveSecondsToday,
          unproductiveSecondsToday: value.unproductiveSecondsToday,
          totalVisitsToday: value.totalVisitsToday,
          trackingSegmentStart: value.trackingSegmentStart,
          trackingSegmentType: value.trackingSegmentType
        });
      } else if (key === STORAGE_KEYS.RECENT_HISTORY) {
        const activeRecord = Array.isArray(value)
          ? value.find((record) => record.visitId === currentVisitId)
          : null;
        logTrackingDebug('storage-write-history', {
          recordCount: Array.isArray(value) ? value.length : 0,
          currentVisitId,
          currentVisitTimeSpent: Number(activeRecord?.timeSpent || 0),
          currentVisitCount: Number(activeRecord?.visitCount || 0)
        });
      }

      resolve();
    });
  });
}

async function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

// ─── Clear All Storage ───
async function clearUserSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [STORAGE_KEYS.USER_ID, STORAGE_KEYS.SESSION_TOKEN, STORAGE_KEYS.EMAIL, STORAGE_KEYS.NAME],
      resolve
    );
  });
}

// ─── Message Handling (from popup) ───
async function handleRuntimeMessage(request, sender, sendResponse) {
  try {
    if (trackingStateReady) {
      await trackingStateReady;
    }

    console.log('[Extension] Message received:', request.action);

    if (request.action === 'login') {
      // Store user info after login
      await setStorageValue(STORAGE_KEYS.USER_ID, request.userId);
      await setStorageValue(STORAGE_KEYS.SESSION_TOKEN, request.token);
      await setStorageValue(STORAGE_KEYS.EMAIL, request.email);
      await setStorageValue(STORAGE_KEYS.NAME, request.name);
      isTracking = true;
      await syncCurrentTab();
      sendResponse({ success: true, message: 'Logged in successfully' });
    } 
    else if (request.action === 'logout') {
      // Save activity before logout
      if (isTracking && activeTabId !== null && tabStartTime !== null) {
        finalizeActiveSegment();
        await saveTabActivity(createTrackingSnapshot(), 'logout');
      }
      await clearUserSession();
      await setStorageValue(STORAGE_KEYS.RECENT_HISTORY, []);
      await setStorageValue(STORAGE_KEYS.TRACKING_STATS, {});
      await setStorageValue(STORAGE_KEYS.CURRENT_TAB, {});
      isTracking = false;
      activeTabId = null;
      tabStartTime = null;
      lastSavedAt = null;
      currentDomain = null;
      currentUrl = null;
      currentTitle = null;
      currentVisitId = null;
      productiveSecondsToday = 0;
      unproductiveSecondsToday = 0;
      trackingSegmentStart = null;
      trackingSegmentType = null;
      totalVisitsToday = 0;
      sendResponse({ success: true, message: 'Logged out successfully' });
    }
    else if (request.action === 'getStatus') {
      if (activeTabId === null || currentDomain === null) {
        await syncCurrentTab();
      }

      // Persist the live segment before returning it so cumulative time never
      // depends on a periodic save interval or popup lifecycle.
      if (isTracking && trackingSegmentStart !== null) {
        await commitTrackedTime();
      }

      const userId = await getStorageValue(STORAGE_KEYS.USER_ID);
      const email = await getStorageValue(STORAGE_KEYS.EMAIL);
      const name = await getStorageValue(STORAGE_KEYS.NAME);
      
      const status = {
        isLoggedIn: !!userId,
        userId,
        email,
        name,
        isTracking,
        currentUrl,
        currentDomain,
        currentTitle,
        currentTimeSpent: isTracking && currentDomain && tabStartTime !== null ? Math.floor((Date.now() - tabStartTime) / 1000) : 0,
        ...getTrackedTotals()
      };
      logTrackingDebug('status-returned-to-popup', {
        currentSessionDurationSeconds: status.currentTimeSpent,
        totalUsageSeconds: status.totalUsageSeconds,
        productiveSeconds: status.productiveSeconds,
        unproductiveSeconds: status.unproductiveSeconds,
        totalVisits: status.totalVisits,
        currentVisitId
      });
      syncDashboardSnapshot(status).catch((error) => {
        console.warn('[Extension] Snapshot sync after getStatus failed:', error?.message || error);
      });
      sendResponse(status);
    }
    else if (request.action === 'pageActivity') {
      if (!isTracking || sender.tab?.id !== activeTabId || trackingSegmentType !== 'productive') {
        sendResponse({ success: false });
        return;
      }

      await commitTrackedTime();
      updatePopupStatus();
      sendResponse({ success: true });
    }
    else if (request.action === 'getRecentHistory') {
      const records = await getRecentHistoryRecords();
      console.log('[Extension] Recent history fetched for popup:', {
        source: 'chrome.storage.local',
        count: records.length
      });
      sendResponse({ records });
    }
    else if (request.action === 'startTracking') {
      isTracking = true;
      await syncCurrentTab();
      startTrackingSegment(isTrackableUrl(currentUrl) ? 'productive' : 'unproductive');
      await persistTrackingStats();
      sendResponse({ success: true });
    }
    else if (request.action === 'stopTracking') {
      if (isTracking && activeTabId !== null && trackingSegmentStart !== null) {
        finalizeActiveSegment();
        await persistTrackingStats();
        await saveTabActivity(createTrackingSnapshot(), 'stop-tracking');
      }
      isTracking = false;
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('[Extension] Message handling error:', error);
    sendResponse({ error: error.message });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleRuntimeMessage(request, sender, sendResponse).catch((error) => {
    console.error('[Extension] Unhandled message error:', error);
    sendResponse({ error: error.message });
  });

  // Keep the response channel open while storage and aggregation finish.
  return true;
});

// ─── Update Popup UI ───
function updatePopupStatus() {
  // Notify popup to update
  chrome.runtime.sendMessage({
    action: 'updateStatus'
  }).catch(() => {
    // Popup might not be open
  });
}

console.log('[Extension] Background service worker initialized');
trackingStateReady = initializeTrackingState().catch((error) => {
  console.error('[Extension] Failed to initialize tracking state:', error);
});
