'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { revalidatePath } from 'next/cache';

/**
 * SCHEMA SYNC:
 * users: id, email, name, role, status, timezone
 */

export async function createUserAction(formData: { email: string; name: string; role: string; password: string; timezone: string }) {
  const { email, name, role, password, timezone } = formData;

  if (!email || !name || !role || !password || !timezone) {
    throw new Error('Name, email, role, password, and timezone are required to create a user.');
  }

  if (!['admin', 'employee'].includes(role)) {
    throw new Error('Role must be either admin or employee.');
  }

  try {
    // Get admin client (will throw descriptive error if env vars missing)
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Create user in Supabase Auth
    console.log(`[createUserAction] Creating auth user: ${email}`);
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role: role }
    });

    if (authError) {
       console.error('[createUserAction] Auth User Creation Error:', authError);
       throw new Error(`Auth Error: ${authError.message}`);
    }

    console.log(`[createUserAction] Auth user created: ${authUser.user.id}`);

    // 2. Sync to public.users (Using exact schema columns)
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .upsert({
        id: authUser.user.id,
        email,
        name,
        role,
        status: 'active',
        timezone
      });
    console.log('[createUserAction] public.users upsert payload:', {
      id: authUser.user.id,
      email,
      name,
      role,
      status: 'active',
      timezone
    });

    if (dbError) {
      console.error('[createUserAction] DB Sync Error:', dbError);
      // Rollback: delete the auth user since DB sync failed
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      throw new Error(`Database Error: ${dbError.message}`);
    }

    console.log(`[createUserAction] User record created in public.users`);


    revalidatePath('/admin');
    return { success: true, user: authUser.user };
  } catch (error: any) {
    console.error('[createUserAction] Exception:', error.message);
    // Re-throw with the actual error message so the client sees it
    throw new Error(error.message || 'An unexpected error occurred while creating the user.');
  }
}

export async function updateUserTimezoneAction(userId: string, timezone: string) {
  if (!userId || !timezone) {
    throw new Error('User ID and timezone are required.');
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from('users')
      .update({ timezone })
      .eq('id', userId);

    if (error) throw new Error(error.message);

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    console.error('[updateUserTimezoneAction] Error:', error.message);
    throw new Error(`Timezone Update Failed: ${error.message}`);
  }
}

export async function updateUserRoleAction(userId: string, newRole: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Update Auth user_metadata
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { role: newRole }
    });

    // Update public.users
    const { error } = await supabaseAdmin
      .from('users')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) throw new Error(error.message);

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    console.error('[updateUserRoleAction] Error:', error.message);
    throw new Error(`Role Update Failed: ${error.message}`);
  }
}

export async function deleteUserAction(userId: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const authLookupResponse = await supabaseAdmin.auth.admin.getUserById(userId);

    if (authLookupResponse.error) {
      const isMissingAuthUser =
        authLookupResponse.error.status === 404 ||
        authLookupResponse.error.code === 'user_not_found';

      if (!isMissingAuthUser) {
        throw new Error(`Auth lookup failed: ${authLookupResponse.error.message}`);
      }
    } else if (authLookupResponse.data?.user) {
      const authDeleteResponse = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (authDeleteResponse.error) {
        throw new Error(`Auth delete failed: ${authDeleteResponse.error.message}`);
      }
    }

    const activityLogsDeleteResponse = await supabaseAdmin
      .from('activity_logs')
      .delete()
      .eq('user_id', userId);

    if (activityLogsDeleteResponse.error) {
      throw new Error(`Activity logs delete failed: ${activityLogsDeleteResponse.error.message}`);
    }

    const usersDeleteResponse = await supabaseAdmin.from('users').delete().eq('id', userId);

    if (usersDeleteResponse.error) {
      throw new Error(`Users delete failed: ${usersDeleteResponse.error.message}`);
    }

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    console.error('[deleteUserAction] Error:', error.message);
     throw new Error(`Delete Failed: ${error.message}`);
  }
}

export async function toggleUserStatusAction(userId: string, currentStatus: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    
    const { error } = await supabaseAdmin
      .from('users')
      .update({ status: newStatus })
      .eq('id', userId);

    if (error) throw new Error(error.message);

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    console.error('[toggleUserStatusAction] Error:', error.message);
    throw new Error(`Status Update Failed: ${error.message}`);
  }
}
