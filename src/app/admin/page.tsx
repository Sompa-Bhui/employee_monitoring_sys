'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Activity,
  Clock,
  MoreVertical,
  ArrowUpRight,
  UserPlus,
  Shield,
  User as UserIcon,
  X,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchAdminDashboard, fetchEmployeeDetails } from '@/lib/stats';
import { createUserAction, deleteUserAction, updateUserRoleAction, updateUserTimezoneAction, toggleUserStatusAction } from '@/app/actions/user-actions';
import { supabase } from '@/lib/supabase';

const ADMIN_EMAIL = 'bhuisompa001@gmail.com';
const LOCAL_PREVIEW_MODE = process.env.NODE_ENV !== 'production';

const FALLBACK_EMPLOYEES = [
  {
    id: 'preview-1',
    name: 'Ayesha Rahman',
    email: 'ayesha@example.com',
    role: 'employee',
    status: 'active',
    todayTime: 5420,
    websiteCount: 8,
    totalVisits: 46
  },
  {
    id: 'preview-2',
    name: 'Imran Hossain',
    email: 'imran@example.com',
    role: 'hr',
    status: 'inactive',
    todayTime: 2380,
    websiteCount: 5,
    totalVisits: 19
  }
];

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, onlineUsers: 0, totalHours: '0h' });
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; email: string } | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedEmployeeDetails, setSelectedEmployeeDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'employee', password: '', timezone: 'Asia/Kolkata' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTimezoneUserId, setEditingTimezoneUserId] = useState<string | null>(null);
  const [timezoneByUserId, setTimezoneByUserId] = useState<Record<string, string>>({});
  const [timezoneSavingId, setTimezoneSavingId] = useState<string | null>(null);
  const TIMEZONE_OPTIONS = [
    { label: 'India (IST)', value: 'Asia/Kolkata' },
    { label: 'US Eastern', value: 'America/New_York' },
    { label: 'US Central', value: 'America/Chicago' },
    { label: 'US Pacific', value: 'America/Los_Angeles' }
  ];

  useEffect(() => {
    void loadData();
    void loadCurrentUser();
  }, [router]);

  async function loadCurrentUser() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (LOCAL_PREVIEW_MODE) {
          setCurrentUser({ name: 'Local Preview', role: 'admin', email: 'local@preview' });
          return;
        }
        router.replace('/');
        return;
      }

      const sessionEmail = session.user.email?.toLowerCase() || '';
      const { data: profile, error } = await supabase
        .from('users')
        .select('name,role,email')
        .or(`id.eq.${session.user.id},email.eq.${sessionEmail}`)
        .single();

      if (error || !profile?.role) {
        if (sessionEmail === ADMIN_EMAIL) {
          setCurrentUser({ name: profile?.name || 'Admin', role: 'admin', email: sessionEmail });
          return;
        }

        if (LOCAL_PREVIEW_MODE) {
          setCurrentUser({ name: 'Local Preview', role: 'admin', email: 'local@preview' });
          return;
        }

        router.replace('/');
        return;
      }

      if (profile.role !== 'admin') {
        router.replace('/employee');
        return;
      }

      setCurrentUser({
        name: profile.name || session.user.email || 'Administrator',
        role: profile.role,
        email: profile.email || session.user.email || ''
      });
    } catch (err) {
      console.error('Failed to load current user session:', err);
      if (LOCAL_PREVIEW_MODE) {
        setCurrentUser({ name: 'Local Preview', role: 'admin', email: 'local@preview' });
      } else {
        router.replace('/');
      }
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const payload = await fetchAdminDashboard();
      const nextStats = payload.stats || { totalUsers: 0, activeUsers: 0, onlineUsers: 0, totalHours: '0h' };
      const nextEmployees = payload.employees || [];
      setStats(nextStats);
      setEmployees(nextEmployees);
      setTimezoneByUserId(Object.fromEntries(nextEmployees.map((emp: any) => [emp.id, emp.timezone || 'Asia/Kolkata'])));

      if (nextEmployees.length === 0 && nextStats.totalUsers === 0) {
        setError('No users found. Please check your database connection and Supabase policies.');
      }
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      if (LOCAL_PREVIEW_MODE) {
        setStats({ totalUsers: FALLBACK_EMPLOYEES.length, activeUsers: 1, onlineUsers: 1, totalHours: '2h 24m' });
        setEmployees(FALLBACK_EMPLOYEES);
        setError(null);
        return;
      }
      setError(err?.name === 'AbortError'
        ? 'Admin dashboard request timed out. Check /api/admin-dashboard and Supabase configuration.'
        : `Connection Error: ${err?.message || 'Could not connect to Supabase.'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDetails(userId: string) {
    try {
      setDetailsLoading(true);
      setSelectedEmployeeId(userId);
      const details = await fetchEmployeeDetails(userId);
      setSelectedEmployeeDetails(details);
    } catch (err) {
      console.error('Failed to load user details:', err);
      setSelectedEmployeeDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createUserAction(newUser);
      setShowAddModal(false);
      setNewUser({ name: '', email: '', role: 'employee', password: '', timezone: 'Asia/Kolkata' });
      await loadData();
    } catch (err: any) {
      alert('Error creating user: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTimezone = async (userId: string) => {
    const timezone = timezoneByUserId[userId] || 'Asia/Kolkata';
    setTimezoneSavingId(userId);
    try {
      await updateUserTimezoneAction(userId, timezone);
      setEditingTimezoneUserId(null);
      await loadData();
    } catch (err: any) {
      alert('Error updating timezone: ' + err.message);
    } finally {
      setTimezoneSavingId(null);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (confirm('Are you sure you want to delete this user? This cannot be undone.')) {
      await deleteUserAction(id);
      await loadData();
    }
  };

  const handleChangeRole = async (id: string, newRole: string) => {
    await updateUserRoleAction(id, newRole);
    await loadData();
    setActiveMenuId(null);
  };

  const handleToggleStatus = async (id: string, status: string) => {
    await toggleUserStatusAction(id, status);
    await loadData();
    setActiveMenuId(null);
  };

  const formatSeconds = (sec: number) => {
    const total = Math.max(0, Number(sec) || 0);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    return `${secs}s`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Shield size={20} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold">{currentUser?.name || currentUser?.email || 'Administrator'}</div>
              <div className="text-xs text-slate-400">{currentUser?.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : 'Admin'}</div>
              <div className="text-xs text-slate-400">{currentUser?.email || ''}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-200 bg-indigo-100 font-bold text-indigo-700">
              {currentUser?.name ? currentUser.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'SB'}
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {LOCAL_PREVIEW_MODE && (
          <div className="mb-6 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-900">
            Local preview mode is enabled. If Supabase live snapshots are not configured, you will still see fallback data.
          </div>
        )}

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900">Organization Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Real-time database records and activity summary.</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-700 hover:shadow-indigo-300 active:scale-95"
          >
            <UserPlus size={18} />
            <span>Create New User</span>
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-600">
            <XCircle size={18} />
            {error}
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Employees" value={stats.totalUsers.toString()} icon={Users} color="bg-blue-500" />
          <StatCard title="Active Accounts" value={stats.activeUsers.toString()} icon={CheckCircle} color="bg-emerald-500" />
          <StatCard title="Online Now" value={stats.onlineUsers.toString()} icon={Clock} color="bg-indigo-500" />
          <StatCard title="Company Track Time" value={stats.totalHours} icon={Activity} color="bg-amber-500" />
        </div>

        <div className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <h3 className="font-bold text-slate-800">All Database Users</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/30">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Employee</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Role</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Today's Time</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Websites</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Visits</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.length > 0 ? employees.map((emp) => (
                  <tr key={emp.id} className="transition-colors hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 font-bold text-slate-600">
                          {emp.name ? emp.name[0] : emp.email?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{emp.name || 'No Name'}</div>
                          <div className="text-xs text-slate-400">{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={emp.role} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={cn('h-2 w-2 rounded-full', emp.status === 'active' ? 'bg-emerald-500' : 'bg-rose-400')} />
                        <span className="text-sm font-medium capitalize">{emp.status || 'inactive'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-600">{formatSeconds(emp.todayTime)}</td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-600">{emp.websiteCount ?? 0}</td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-600">{emp.totalVisits ?? 0}</td>
                    <td className="relative px-6 py-4 text-right">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === emp.id ? null : emp.id)}
                        className="p-1 text-slate-400 transition-colors hover:text-slate-600"
                      >
                        <MoreVertical size={18} />
                      </button>
                      {activeMenuId === emp.id && (
                        <div className="absolute right-6 top-12 z-50 w-44 rounded-xl border border-slate-100 bg-white p-1 shadow-xl">
                          <MenuItem icon={UserIcon} label="View Details" onClick={() => handleOpenDetails(emp.id)} />
                          <div className="my-1 h-[1px] bg-slate-100" />
                          <p className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">Change Role To</p>
                          <MenuItem icon={Shield} label="Admin" onClick={() => handleChangeRole(emp.id, 'admin')} disabled={emp.role === 'admin'} />
                          <MenuItem icon={UserIcon} label="Employee" onClick={() => handleChangeRole(emp.id, 'employee')} disabled={emp.role === 'employee'} />
                          <div className="my-1 h-[1px] bg-slate-100" />
                          <MenuItem icon={Clock} label="Edit Time Zone" onClick={() => setEditingTimezoneUserId(emp.id)} />
                          <MenuItem
                            icon={emp.status === 'active' ? XCircle : CheckCircle}
                            label={emp.status === 'active' ? 'Deactivate' : 'Activate'}
                            onClick={() => handleToggleStatus(emp.id, emp.status)}
                          />
                          <MenuItem icon={Trash2} label="Delete User" onClick={() => handleDeleteUser(emp.id)} danger />
                        </div>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="px-6 py-10 text-sm text-slate-500" colSpan={7}>
                      No employees to display yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedEmployeeDetails && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Employee details</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  {selectedEmployeeDetails.employee?.name || selectedEmployeeDetails.employee?.email || 'Unknown Employee'}
                </h2>
                <p className="text-sm text-slate-500">{selectedEmployeeDetails.employee?.email || 'No email available'}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedEmployeeDetails(null);
                  setSelectedEmployeeId(null);
                }}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                Close details
              </button>
            </div>

            {detailsLoading ? (
              <div className="py-10 text-center text-slate-500">Loading employee details...</div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <InfoCard label="Time Zone" value={selectedEmployeeDetails.employee?.timezone || 'Asia/Kolkata'} />
                  <InfoCard label="Current Website" value={selectedEmployeeDetails.currentWebsite || 'No live website'} />
                  <InfoCard label="Current Domain" value={selectedEmployeeDetails.currentDomain || 'No live domain'} />
                  <InfoCard label="Time Active" value={formatSeconds(selectedEmployeeDetails.currentTimeSpent || 0)} />
                  <InfoCard label="Total Usage Time" value={formatSeconds(selectedEmployeeDetails.totalUsageSeconds || selectedEmployeeDetails.totalTime || 0)} />
                  <InfoCard label="Productivity Score" value={`${selectedEmployeeDetails.productivityPercent ?? selectedEmployeeDetails.productivity ?? 0}%`} />
                  <InfoCard label="Productive / Unproductive" value={`${formatSeconds(selectedEmployeeDetails.productiveSeconds || 0)} / ${formatSeconds(selectedEmployeeDetails.unproductiveSeconds || 0)}`} />
                  <InfoCard label="Websites Tracked" value={String(selectedEmployeeDetails.websitesTracked || selectedEmployeeDetails.websiteCount || 0)} />
                  <InfoCard label="Total Visits" value={String(selectedEmployeeDetails.totalVisits || selectedEmployeeDetails.visitCount || 0)} />
                  <InfoCard label="Most Visited Website" value={selectedEmployeeDetails.mostVisitedWebsite || selectedEmployeeDetails.mostVisited || 'No data yet'} />
                </div>

                <div className="mt-8 space-y-8">
                  <div>
                    <h3 className="mb-3 text-base font-semibold text-slate-900">Recent Website Activity</h3>
                    {selectedEmployeeDetails.recentWebsiteActivity?.length ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full border-collapse text-left">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Website</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Time Spent</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Visits</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Last Visit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {selectedEmployeeDetails.recentWebsiteActivity.map((row: any, index: number) => (
                              <tr key={`${row.domain}-${index}`} className="hover:bg-slate-50/70">
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-slate-900">{row.domain || 'Unknown domain'}</div>
                                  <div className="max-w-[280px] truncate text-xs text-slate-500">{row.latestUrl || '-'}</div>
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-slate-700">{formatSeconds(Number(row.totalTime || 0))}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-slate-700">{Number(row.totalVisits || 0)}</td>
                                <td className="px-4 py-3 text-sm text-slate-500">{row.lastVisit ? new Date(row.lastVisit).toLocaleString() : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No recent website activity found for this employee.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-base font-semibold text-slate-900">Recent Browser History</h3>
                    {selectedEmployeeDetails.recentBrowserHistory?.length ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full border-collapse text-left">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Title</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">URL</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Domain</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Visit Time</th>
                              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Time Spent</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {selectedEmployeeDetails.recentBrowserHistory.map((row: any, index: number) => (
                              <tr key={`${row.visitTime}-${index}`} className="hover:bg-slate-50/70">
                                <td className="px-4 py-3 text-sm font-semibold text-slate-900">{row.title || 'Tracked website'}</td>
                                <td className="px-4 py-3 text-xs text-slate-500 max-w-[320px] truncate">{row.url || '-'}</td>
                                <td className="px-4 py-3 text-sm text-slate-700">{row.domain || '-'}</td>
                                <td className="px-4 py-3 text-sm text-slate-500">{row.visitTime ? new Date(row.visitTime).toLocaleString() : '-'}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-slate-700">{formatSeconds(Number(row.timeSpent || 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No browser history data synced yet.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">Create New User</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Full Name</label>
                <input
                  type="text"
                  required
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="john@company.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">System Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Set a secure password"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Time Zone</label>
                <select
                  required
                  value={newUser.timezone}
                  onChange={(e) => setNewUser({ ...newUser, timezone: e.target.value })}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="pt-4 text-xs text-slate-400">
                <p>Note: The administrator sets the password when creating the user.</p>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-bold text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                <span>Create User Account</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {editingTimezoneUserId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">Edit Time Zone</h2>
              <button onClick={() => setEditingTimezoneUserId(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Time Zone</label>
                <select
                  value={timezoneByUserId[editingTimezoneUserId] || 'Asia/Kolkata'}
                  onChange={(e) => setTimezoneByUserId((current) => ({ ...current, [editingTimezoneUserId]: e.target.value }))}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={timezoneSavingId === editingTimezoneUserId}
                onClick={() => handleUpdateTimezone(editingTimezoneUserId)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-bold text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
              >
                <span>{timezoneSavingId === editingTimezoneUserId ? 'Saving...' : 'Save Time Zone'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-white', color)}>
          <Icon size={20} />
        </div>
        <ArrowUpRight className="text-slate-300" size={16} />
      </div>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-tight text-slate-400">{title}</p>
        <h3 className="text-2xl font-black text-slate-900">{value}</h3>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: any = {
    admin: 'border-purple-100 bg-purple-50 text-purple-700',
    hr: 'border-blue-100 bg-blue-50 text-blue-700',
    employee: 'border-slate-100 bg-slate-50 text-slate-600'
  };
  const label = role === 'admin' ? 'Admin' : role === 'hr' ? 'HR' : 'Employee';
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-black uppercase', styles[role] || styles.employee)}>
      {label}
    </span>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors disabled:opacity-30',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-600 hover:bg-slate-50'
      )}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-3 break-words text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
