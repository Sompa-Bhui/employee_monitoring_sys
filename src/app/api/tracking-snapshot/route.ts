import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = body?.user_id;

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const snapshot = {
      user_id: userId,
      email: body.email || null,
      name: body.name || null,
      current_url: body.current_url || null,
      current_domain: body.current_domain || null,
      current_title: body.current_title || null,
      current_time_spent: Number(body.current_time_spent || 0),
      productive_seconds: Number(body.productive_seconds || 0),
      unproductive_seconds: Number(body.unproductive_seconds || 0),
      total_usage_seconds: Number(body.total_usage_seconds || 0),
      total_visits: Number(body.total_visits || 0),
      productivity_percent: Number(body.productivity_percent || 0),
      websites_tracked: Number(body.websites_tracked || 0),
      most_visited_website: body.most_visited_website || null,
      recent_activity: body.recent_activity || [],
      recent_browser_history: body.recent_browser_history || [],
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('tracking_snapshots')
      .upsert(snapshot, { onConflict: 'user_id' })
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[tracking-snapshot] upsert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, snapshot: data || snapshot });
  } catch (error: any) {
    console.error('[tracking-snapshot] unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Unexpected server error' }, { status: 500 });
  }
}
