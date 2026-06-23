'use client';

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  BarChart, 
  LogOut,
  Globe,
  Zap,
  Target,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

export default function EmployeeDashboard() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({ todayTime: 0, productivity: 0, topDomain: 'None' });
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserData();
  }, []);

  function resolveTimezone(value?: string | null) {
    return value || 'Asia/Kolkata';
  }

  function getTimezoneLabel(timeZone?: string | null) {
    switch (resolveTimezone(timeZone)) {
      case 'Asia/Kolkata':
        return 'IST';
      case 'America/New_York':
        return 'US Eastern';
      case 'America/Chicago':
        return 'US Central';
      case 'America/Los_Angeles':
        return 'US Pacific';
      default:
        return resolveTimezone(timeZone);
    }
  }

  function formatInTimezone(value: string | number | Date, timeZone?: string | null) {
    return new Date(value).toLocaleString([], {
      timeZone: resolveTimezone(timeZone),
      dateStyle: 'medium',
      timeStyle: 'medium'
    });
  }

  function formatLocalTime(value: string | number | Date, timeZone?: string | null) {
    return new Date(value).toLocaleTimeString([], {
      timeZone: resolveTimezone(timeZone),
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function loadUserData() {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        window.location.href = '/';
        return;
      }

      const userId = session.user.id;
      
      // 1. Get user profile
      const sessionEmail = session.user.email?.toLowerCase() || '';
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .or(`id.eq.${userId},email.eq.${sessionEmail}`)
        .single();
      if (profileError || !profile) {
        console.error('Failed to load employee profile:', profileError);
        window.location.href = '/';
        return;
      }

      if (profile.role !== 'employee') {
        window.location.href = '/admin';
        return;
      }

      setUser(profile);
      const timezone = resolveTimezone(profile.timezone);
      const activityUserId = profile.id || userId;

      // 2. Get today's logs
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { data: logs } = await supabase
        .from('activity_logs')
        .select('url,domain,time_spent,visit_count,created_at')
        .eq('user_id', activityUserId)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      if (logs) {
        setHistory(logs.slice(0, 5));
        const totalSec = logs.reduce((sum, log) => sum + Number(log.time_spent || 0), 0);
        const avgProd = 0;
        
        // Find top domain
        const domainMap: any = {};
        logs.forEach(l => {
          domainMap[l.domain] = (domainMap[l.domain] || 0) + Number(l.time_spent || 0);
        });
        const topD = Object.entries(domainMap).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'None';

        setStats({ todayTime: totalSec, productivity: avgProd, topDomain: topD });
      }
      setUser((current: any) => ({ ...current, timezone }));
    } catch (err) {
      console.error('Failed to load employee data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-indigo-950">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-indigo-950 font-sans text-white">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <h2 className="text-indigo-400 font-bold uppercase tracking-widest text-xs mb-1">My Dashboard</h2>
            <h1 className="text-4xl font-black">Welcome back, {user?.name?.split(' ')[0] || 'User'}! 👋</h1>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-white/60 mb-3">Profile</p>
            <div className="space-y-3 text-white">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Name</p>
                <p className="font-semibold text-lg">
                  {user?.name || 'Unknown'} ({getTimezoneLabel(user?.timezone)})
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Local Time</p>
                <p className="font-semibold text-lg">{formatLocalTime(new Date(), user?.timezone)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Email</p>
                <p className="font-semibold text-lg">{user?.email || 'Unknown'}</p>
              </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Role</p>
                  <p className="font-semibold text-lg capitalize">{user?.role || 'Employee'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Time Zone</p>
                  <p className="font-semibold text-lg">{user?.timezone || 'Asia/Kolkata'}</p>
                </div>
              </div>
            </div>
        </div>

        <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <GlassCard>
            <p className="text-sm font-medium text-white/50">Tracking Time Today</p>
            <h3 className="mt-2 text-3xl font-black">{Math.floor(stats.todayTime / 3600)}h {Math.floor((stats.todayTime % 3600) / 60)}m</h3>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-400">
              <Clock size={14} />
              <span>Real-time track active</span>
            </div>
          </GlassCard>

          <GlassCard>
            <p className="text-sm font-medium text-white/50">My Productivity</p>
            <h3 className="mt-2 text-3xl font-black">{stats.productivity}%</h3>
            <div className="mt-4 h-1.5 w-full rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${stats.productivity}%` }} />
            </div>
          </GlassCard>

          <GlassCard className="bg-indigo-600">
            <p className="text-sm font-medium text-indigo-100">Top Focus</p>
            <h3 className="mt-2 text-3xl font-black truncate">{stats.topDomain}</h3>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-white/80">
              <Globe size={14} />
              <span>Most time spent here</span>
            </div>
          </GlassCard>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
           <h3 className="text-xl font-bold mb-6">My Recent Activity</h3>
           <div className="space-y-6">
              {history.length > 0 ? history.map((log, i) => (
                <div key={i} className="flex justify-between items-center bg-white/5 p-4 rounded-xl">
                     <div>
                       <div className="font-bold">{log.domain}</div>
                     <div className="text-xs text-white/40">{formatInTimezone(log.created_at, user?.timezone)}</div>
                     </div>
                   <div className="text-right">
                     <div className="font-black">{Math.floor(Number(log.time_spent || 0) / 60)}m {Number(log.time_spent || 0) % 60}s</div>
                   </div>
                </div>
              )) : <div className="text-white/40">No activity logs found for today.</div>}
           </div>
        </div>
      </main>
    </div>
  );
}

function GlassCard({ children, className }: any) {
  return (
    <div className={cn("rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm", className)}>
      {children}
    </div>
  );
}
