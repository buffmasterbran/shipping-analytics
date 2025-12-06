import { NextResponse } from 'next/server';
import { fetchAllUsers } from '@/lib/shipstation';

/**
 * GET /api/users
 * Fetch all ShipStation users and cache the mapping
 */
export async function GET() {
  try {
    const users = await fetchAllUsers();
    
    // Create a map of userId -> displayName (supports both numeric IDs and UUIDs)
    // Prefer 'name' field over 'userName' for display
    const userMap: Record<string | number, string> = {};
    users.forEach(user => {
      const userId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
      const displayName = user.name || user.userName || `User ${userId}`;
      userMap[user.userId] = displayName;
    });

    return NextResponse.json({
      users: users.map(u => ({
        userId: u.userId,
        userName: u.userName || `User ${u.userId}`,
      })),
      userMap,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}


