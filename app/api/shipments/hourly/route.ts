import { NextRequest, NextResponse } from 'next/server';
import { format, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { fetchAllShipments, fetchAllUsers } from '@/lib/shipstation';
import { aggregateShipmentsByHour, aggregateShipmentsByDay } from '@/lib/aggregation';
import type { ShipmentsHourlyResponse } from '@/types/shipstation';

const TIMEZONE = 'America/New_York';

/**
 * GET /api/shipments/hourly
 * Fetch shipments and aggregate by hour and user
 * 
 * Query params:
 * - startDate: YYYY-MM-DD or ISO string (defaults to today)
 * - endDate: YYYY-MM-DD or ISO string (defaults to today)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let startDate = searchParams.get('startDate');
    let endDate = searchParams.get('endDate');

    // Default to today in New York timezone
    // Convert UTC now to Eastern time, then get start/end of day in Eastern time
    const now = new Date();
    const nyNow = utcToZonedTime(now, TIMEZONE);
    
    if (!startDate) {
      startDate = format(startOfDay(nyNow), 'yyyy-MM-dd');
    }
    if (!endDate) {
      endDate = format(endOfDay(nyNow), 'yyyy-MM-dd');
    }

    // Ensure dates are in YYYY-MM-DD format for API
    const startDateFormatted = startDate.split('T')[0];
    const endDateFormatted = endDate.split('T')[0];

    // Convert to UTC for ShipStation API (they expect UTC dates)
    const startUTC = zonedTimeToUtc(
      new Date(`${startDateFormatted}T00:00:00`),
      TIMEZONE
    ).toISOString();
    
    const endUTC = zonedTimeToUtc(
      new Date(`${endDateFormatted}T23:59:59`),
      TIMEZONE
    ).toISOString();

    // Fetch users first to get name mappings
    const users = await fetchAllUsers();
    const userMap = new Map<string | number, string>();
    
    // Debug: Log first few users to see structure
    if (users.length > 0) {
      console.log('Sample user from API:', JSON.stringify(users[0], null, 2));
    }
    
    users.forEach(user => {
      const userId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
      // Prefer 'name' field over 'userName' for display (name is the display name)
      const displayName = user.name || user.userName || `User ${userId}`;
      
      // Store with multiple key formats for reliable lookup
      // Store original userId (preserves type: string or number)
      userMap.set(user.userId, displayName);
      
      // Always store string version
      userMap.set(userId, displayName);
      
      // If it's a UUID (contains hyphens), store lowercase version
      if (typeof user.userId === 'string' && user.userId.includes('-')) {
        userMap.set(user.userId.toLowerCase(), displayName);
        // Also store without hyphens for matching
        userMap.set(user.userId.replace(/-/g, ''), displayName);
        userMap.set(user.userId.replace(/-/g, '').toLowerCase(), displayName);
      }
      
      // If it's a numeric string, also store as number
      if (typeof user.userId === 'string' && !isNaN(Number(user.userId)) && !user.userId.includes('-')) {
        userMap.set(Number(user.userId), displayName);
      }
      
      // If it's a number, also store as string
      if (typeof user.userId === 'number') {
        userMap.set(userId, displayName);
      }
    });
    
    // Debug: Log userMap contents
    console.log(`UserMap populated with ${userMap.size} entries`);
    if (users.length > 0) {
      console.log('Sample user from API:', {
        userId: users[0].userId,
        userIdType: typeof users[0].userId,
        name: users[0].name,
        userName: users[0].userName
      });
    }

    // Fetch all shipments
    const shipments = await fetchAllShipments(startUTC, endUTC);
    
    // Debug: Log sample shipment to see userId structure
    if (shipments.length > 0) {
      console.log('Sample shipment userId:', shipments[0].userId, typeof shipments[0].userId);
      console.log('User map has this userId?', userMap.has(shipments[0].userId));
    }

    // Determine if we should aggregate by day or hour
    // If the date range spans more than 1 day, use daily aggregation
    const startDateObj = new Date(`${startDateFormatted}T00:00:00`);
    const endDateObj = new Date(`${endDateFormatted}T23:59:59`);
    const daysDiff = differenceInDays(endDateObj, startDateObj);
    const useDailyAggregation = daysDiff > 1;

    // Aggregate by hour or day based on date range
    const { series, userSummaries, totalShipments } = useDailyAggregation
      ? aggregateShipmentsByDay(shipments, userMap)
      : aggregateShipmentsByHour(shipments, userMap);

    const response: ShipmentsHourlyResponse = {
      startDate: startDateFormatted,
      endDate: endDateFormatted,
      timezone: TIMEZONE,
      series,
      users: userSummaries,
      totals: {
        totalShipments,
      },
      rawShipments: shipments, // Include raw shipment data
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching hourly shipments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch shipments' },
      { status: 500 }
    );
  }
}


