import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  return `${secs}s`;
}

function parseTimestamp(value: any) {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatLastSeen(timestamp: any) {
  const seenAt = parseTimestamp(timestamp);
  if (!seenAt) {
    return 'Unknown';
  }

  const diffMs = Date.now() - seenAt;
  if (diffMs < 60 * 1000) {
    return 'Just now';
  }

  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 60) {
    return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  if (diffHours < 48) {
    return 'Yesterday';
  }

  return new Date(seenAt).toLocaleString();
}

function resolveTimezone(value: any) {
  return String(value || 'Asia/Kolkata');
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '0';

  return {
    year: Number(getPart('year')),
    month: Number(getPart('month')),
    day: Number(getPart('day'))
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const valueOf = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const utcEquivalent = Date.UTC(
    valueOf('year'),
    valueOf('month') - 1,
    valueOf('day'),
    valueOf('hour'),
    valueOf('minute'),
    valueOf('second')
  );

  return utcEquivalent - date.getTime();
}

function getLocalDayBounds(date: Date, timeZone: string) {
  const { year, month, day } = getTimeZoneParts(date, timeZone);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetAtGuess = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const startMs = utcGuess - offsetAtGuess;
  const endMs = startMs + (24 * 60 * 60 * 1000);
  return { startMs, endMs };
}

function aggregateLogs(logs: any[]) {
  const sorted = [...logs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const totalUsageSeconds = sorted.reduce((sum, log) => sum + (Number(log.time_spent) || 0), 0);
  const totalVisits = sorted.reduce((sum, log) => sum + (Number(log.visit_count) || 0), 0);
  const websiteSet = new Set(sorted.map((log) => log.domain).filter(Boolean));

  const domainStats = new Map<string, { domain: string; totalVisits: number; totalTime: number; latestUrl: string; lastVisit: string }>();
  for (const log of sorted) {
    const domain = log.domain || 'unknown';
    const entry = domainStats.get(domain) || {
      domain,
      totalVisits: 0,
      totalTime: 0,
      latestUrl: '',
      lastVisit: ''
    };

    entry.totalVisits += Number(log.visit_count) || 0;
    entry.totalTime += Number(log.time_spent) || 0;
    entry.latestUrl = entry.latestUrl || log.url || '';
    entry.lastVisit = entry.lastVisit || log.created_at;
    domainStats.set(domain, entry);
  }

  const recentWebsiteActivity = Array.from(domainStats.values())
    .sort((a, b) => {
      if (b.totalVisits !== a.totalVisits) {
        return b.totalVisits - a.totalVisits;
      }
      return b.totalTime - a.totalTime;
    })
    .slice(0, 20);

  const mostVisited = recentWebsiteActivity[0] || null;
  const latestLog = sorted[0] || null;

  return {
    latestLog,
    recentLogs: sorted.slice(0, 50),
    recentWebsiteActivity,
    totalUsageSeconds,
    totalVisits,
    websitesTracked: websiteSet.size,
    mostVisitedWebsite: mostVisited?.domain || null
  };
}

function buildBrowserHistoryFallback(logs: any[]) {
  return logs.slice(0, 50).map((log) => ({
    title: log.url || log.domain || 'Tracked website',
    url: log.url || '',
    domain: log.domain || 'unknown',
    visitTime: log.created_at,
    timeSpent: Number(log.time_spent) || 0,
    visitCount: Number(log.visit_count) || 0
  }));
}

function normalizeValue(value: any) {
  return String(value || '').trim().toLowerCase();
}

function resolveTrackingIdentity(user: any, logs: any[], snapshots: any[]) {
  const directLogs = logs.filter((log: any) => log.user_id === user.id);
  const directSnapshots = snapshots.filter((snapshot: any) => snapshot.user_id === user.id);

  if (directLogs.length || directSnapshots.length) {
    return {
      trackingUserId: user.id,
      trackingIds: [user.id],
      source: 'direct-id'
    };
  }

  const userEmail = normalizeValue(user.email);
  const userName = normalizeValue(user.name);

  const snapshotMatches = snapshots.filter((snapshot: any) => {
    const snapshotEmail = normalizeValue(snapshot.email);
    const snapshotName = normalizeValue(snapshot.name);
    return (
      (userEmail && snapshotEmail === userEmail) ||
      (userName && snapshotName === userName)
    );
  });

  const candidateIds = new Set<string>();
  for (const snapshot of snapshotMatches) {
    if (snapshot?.user_id) {
      candidateIds.add(snapshot.user_id);
    }
  }

  if (!candidateIds.size && userEmail) {
    for (const log of logs) {
      const logSnapshot = snapshots.find((snapshot: any) => snapshot.user_id === log.user_id);
      if (normalizeValue(logSnapshot?.email) === userEmail) {
        candidateIds.add(log.user_id);
      }
    }
  }

  if (!candidateIds.size && userName) {
    for (const log of logs) {
      const logSnapshot = snapshots.find((snapshot: any) => snapshot.user_id === log.user_id);
      if (normalizeValue(logSnapshot?.name) === userName) {
        candidateIds.add(log.user_id);
      }
    }
  }

  const trackingIds = Array.from(candidateIds);
  return {
    trackingUserId: trackingIds[0] || user.id,
    trackingIds: trackingIds.length ? trackingIds : [user.id],
    source: trackingIds.length ? 'email-or-name-fallback' : 'fallback-user-id'
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const employeeId = url.searchParams.get('employeeId');
    const supabaseAdmin = getSupabaseAdmin();

    const [usersResult, logsResult, snapshotsResult] = await Promise.all([
      supabaseAdmin.from('users').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('activity_logs').select('user_id,time_spent,visit_count,created_at,url,domain'),
      supabaseAdmin
        .from('tracking_snapshots')
        .select('*')
        .order('updated_at', { ascending: false })
    ]);

    if (usersResult.error) {
      console.error('[admin-dashboard] users query error:', usersResult.error.message);
      return NextResponse.json({ error: usersResult.error.message }, { status: 500 });
    }

    if (logsResult.error) {
      console.error('[admin-dashboard] activity_logs query error:', logsResult.error.message);
      return NextResponse.json({ error: logsResult.error.message }, { status: 500 });
    }

    const users = usersResult.data || [];
    const logs = logsResult.data || [];
    const snapshots = snapshotsResult.error ? [] : (snapshotsResult.data || []);

    const snapshotByUser = snapshots.reduce((acc: Record<string, any>, snapshot: any) => {
      if (snapshot?.user_id && !acc[snapshot.user_id]) {
        acc[snapshot.user_id] = snapshot;
      }
      return acc;
    }, {});

    console.log('[admin-dashboard] Records fetched:', {
      employeeId,
      users: users.length,
      logs: logs.length,
      snapshots: snapshots.length
    });

    const totalUsers = users.length;
    const activeUsers = users.filter((user: any) => user.status === 'active').length;
    const onlineWindowMs = 2 * 60 * 1000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todaySeconds = logs
      .filter((log: any) => log.created_at >= todayStart.toISOString())
      .reduce((sum: number, log: any) => sum + (Number(log.time_spent) || 0), 0);

    const byUser = users.map((user: any) => {
      const timezone = resolveTimezone(user.timezone);
      const trackingIdentity = resolveTrackingIdentity(user, logs, snapshots);
      const userLogs = logs
        .filter((log: any) => trackingIdentity.trackingIds.includes(log.user_id))
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const aggregate = aggregateLogs(userLogs);
      const snapshot = trackingIdentity.trackingIds
        .map((trackingId: string) => snapshotByUser[trackingId])
        .find(Boolean) || snapshotByUser[user.id];
      const productiveSeconds = Number(snapshot?.productive_seconds ?? 0);
      const unproductiveSeconds = Number(snapshot?.unproductive_seconds ?? 0);
      const localDayBounds = getLocalDayBounds(new Date(), timezone);
      const localDayLogs = userLogs.filter((log: any) => {
        const createdAtMs = parseTimestamp(log.created_at);
        return createdAtMs !== null && createdAtMs >= localDayBounds.startMs && createdAtMs < localDayBounds.endMs;
      });
      const todayUsageSeconds = localDayLogs.reduce((sum: number, log: any) => sum + (Number(log.time_spent) || 0), 0);
      const latestActivityAt = snapshot?.updated_at || aggregate.latestLog?.created_at || user.updated_at || user.created_at || null;
      const latestActivityMs = parseTimestamp(latestActivityAt);
      const onlineStatus = Boolean(latestActivityMs && (Date.now() - latestActivityMs) <= onlineWindowMs);
      const productivityPercent = Number(snapshot?.productivity_percent ?? (
        productiveSeconds + unproductiveSeconds > 0
          ? Math.round((productiveSeconds / Math.max(1, productiveSeconds + unproductiveSeconds)) * 100)
          : 0
      ));

      return {
        ...user,
        currentWebsite: snapshot?.current_url || aggregate.latestLog?.url || '',
        currentDomain: snapshot?.current_domain || aggregate.latestLog?.domain || '',
        currentTitle: snapshot?.current_title || aggregate.latestLog?.url || '',
        currentTimeSpent: Number(snapshot?.current_time_spent ?? aggregate.latestLog?.time_spent ?? 0),
        productiveSeconds,
        unproductiveSeconds,
        totalUsageSeconds: todayUsageSeconds,
        productivityPercent,
        productiveTimeToday: todayUsageSeconds,
        lastSeen: onlineStatus ? 'Online' : formatLastSeen(latestActivityAt),
        lastSeenAt: latestActivityAt,
        onlineStatus,
        websitesTracked: Number(snapshot?.websites_tracked ?? aggregate.websitesTracked),
        totalVisits: Number(snapshot?.total_visits ?? aggregate.totalVisits),
        mostVisitedWebsite: snapshot?.most_visited_website || aggregate.mostVisitedWebsite,
        recentWebsiteActivity: snapshot?.recent_activity || aggregate.recentWebsiteActivity,
        recentBrowserHistory: snapshot?.recent_browser_history || buildBrowserHistoryFallback(userLogs),
        todayTime: todayUsageSeconds,
        websiteCount: Number(snapshot?.websites_tracked ?? aggregate.websitesTracked),
        mostVisited: snapshot?.most_visited_website || aggregate.mostVisitedWebsite,
        logs: userLogs,
        liveUpdatedAt: snapshot?.updated_at || aggregate.latestLog?.created_at || null,
        trackingUserId: trackingIdentity.trackingUserId,
        trackingIds: trackingIdentity.trackingIds,
        trackingIdentitySource: trackingIdentity.source
      };
    });

    const response: any = {
      stats: {
        totalUsers,
        activeUsers,
        onlineUsers: byUser.filter((entry: any) => entry.onlineStatus).length,
        totalHours: formatDuration(todaySeconds)
      },
      employees: byUser
    };

    if (employeeId) {
      const employee = users.find((user: any) => user.id === employeeId);
      const directDetails = byUser.find((entry: any) => entry.id === employeeId);
      const trackingDetails = byUser.find((entry: any) => Array.isArray(entry.trackingIds) && entry.trackingIds.includes(employeeId));
      const details = directDetails || trackingDetails || null;

      response.employeeDetails = {
        employee: details || employee || null,
        currentWebsite: details?.currentWebsite || '',
        currentDomain: details?.currentDomain || '',
        currentTitle: details?.currentTitle || '',
        currentTimeSpent: details?.currentTimeSpent || 0,
        productiveSeconds: details?.productiveSeconds || 0,
        unproductiveSeconds: details?.unproductiveSeconds || 0,
        totalUsageSeconds: details?.totalUsageSeconds || 0,
        productivityPercent: details?.productivityPercent || 0,
        productiveTimeToday: details?.productiveTimeToday || 0,
        lastSeen: details?.lastSeen || 'Unknown',
        lastSeenAt: details?.lastSeenAt || null,
        onlineStatus: Boolean(details?.onlineStatus),
        websitesTracked: details?.websitesTracked || 0,
        totalVisits: details?.totalVisits || 0,
        mostVisitedWebsite: details?.mostVisitedWebsite || '',
        recentWebsiteActivity: details?.recentWebsiteActivity || [],
        recentBrowserHistory: details?.recentBrowserHistory || [],
        logs: details?.logs || [],
        totalTime: details?.totalUsageSeconds || 0,
        websiteCount: details?.websitesTracked || 0,
        visitCount: details?.totalVisits || 0,
        productivity: details?.productivityPercent || 0,
        liveUpdatedAt: details?.liveUpdatedAt || null,
        trackingUserId: details?.trackingUserId || employee?.id || employeeId,
        trackingIds: details?.trackingIds || [employee?.id || employeeId],
        trackingIdentitySource: details?.trackingIdentitySource || (details ? 'resolved' : 'unresolved')
      };
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[admin-dashboard] unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Unexpected server error' }, { status: 500 });
  }
}
