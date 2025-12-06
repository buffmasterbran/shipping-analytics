import { NextRequest, NextResponse } from 'next/server';
import { format, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { fetchAllShipments, fetchAllUsers } from '@/lib/shipstation';
import { aggregateShipmentsByHour, aggregateShipmentsByDay } from '@/lib/aggregation';
import type { ShipmentsHourlyResponse, ShipStationUser } from '@/types/shipstation';

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

    // Step 1: Fetch active users first to get name mappings
    const activeUsers = await fetchAllUsers(false);
    const userMap = new Map<string | number, string>();
    
    // Debug: Log first few users to see structure
    if (activeUsers.length > 0) {
      console.log('Sample active user from API:', JSON.stringify(activeUsers[0], null, 2));
      console.log(`Total active users fetched: ${activeUsers.length}`);
      console.log('Sample active user IDs:', activeUsers.slice(0, 5).map(u => ({ userId: u.userId, name: u.name || u.userName, type: typeof u.userId })));
    }
    
    // Helper function to add user to userMap with all variations
    const addUserToMap = (user: ShipStationUser) => {
      const userId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
      // Prefer 'name' field over 'userName' for display (name is the display name)
      const displayName = user.name || user.userName || userId;
      
      // Store with multiple key formats for reliable lookup
      // Store original userId (preserves type: string or number)
      userMap.set(user.userId, displayName);
      
      // Always store string version
      userMap.set(userId, displayName);
      
      // If it's a UUID (contains hyphens), store multiple variations
      if (typeof user.userId === 'string' && user.userId.includes('-')) {
        const lowerUserId = user.userId.toLowerCase();
        const noHyphens = user.userId.replace(/-/g, '');
        const noHyphensLower = noHyphens.toLowerCase();
        
        userMap.set(lowerUserId, displayName);
        userMap.set(noHyphens, displayName);
        userMap.set(noHyphensLower, displayName);
        
        // Also try with uppercase
        userMap.set(user.userId.toUpperCase(), displayName);
      }
      
      // If it's a numeric string, also store as number
      if (typeof user.userId === 'string' && !isNaN(Number(user.userId)) && !user.userId.includes('-')) {
        userMap.set(Number(user.userId), displayName);
      }
      
      // If it's a number, also store as string
      if (typeof user.userId === 'number') {
        userMap.set(userId, displayName);
      }
    };
    
    // Add all active users to the map
    activeUsers.forEach(user => {
      addUserToMap(user);
    });
    
    // Fetch all shipments
    const shipments = await fetchAllShipments(startUTC, endUTC);
    
    // Extract unique user IDs from shipments and check for missing ones
    const shipmentUserIds = new Set<string | number>();
    shipments.forEach(shipment => {
      shipmentUserIds.add(shipment.userId);
    });
    
    // Step 2: Find user IDs from shipments that aren't in our active userMap
    const missingUserIds: Array<string | number> = [];
    shipmentUserIds.forEach(userId => {
      const userIdStr = typeof userId === 'string' ? userId : userId.toString();
      let found = userMap.has(userId);
      
      if (!found) {
        // Try lowercase/uppercase
        if (typeof userId === 'string') {
          found = userMap.has(userId.toLowerCase()) || userMap.has(userId.toUpperCase());
        }
        // Try without hyphens
        if (!found && typeof userId === 'string' && userId.includes('-')) {
          const noHyphens = userId.replace(/-/g, '');
          found = userMap.has(noHyphens) || userMap.has(noHyphens.toLowerCase()) || userMap.has(noHyphens.toUpperCase());
        }
      }
      
      if (!found) {
        missingUserIds.push(userId);
      }
    });
    
    // Step 3: If we have missing user IDs, fetch inactive users and only add the ones we need
    if (missingUserIds.length > 0) {
      console.log(`Found ${missingUserIds.length} user IDs in shipments that aren't in active users. Fetching inactive users to match...`);
      
      // Create a Set of active user IDs for quick lookup (normalized)
      const activeUserIdsSet = new Set<string>();
      activeUsers.forEach(user => {
        const userId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
        activeUserIdsSet.add(userId.toLowerCase());
        activeUserIdsSet.add(userId.toLowerCase().replace(/-/g, ''));
        if (typeof user.userId === 'string' && user.userId.includes('-')) {
          activeUserIdsSet.add(user.userId.toLowerCase());
          activeUserIdsSet.add(user.userId.replace(/-/g, '').toLowerCase());
        }
      });
      
      // Fetch inactive users (showInactive=true gets ALL users including active)
      const allUsers = await fetchAllUsers(true);
      console.log(`Fetched ${allUsers.length} total users (active + inactive)`);
      
      // Filter to only inactive users (those not in activeUsers)
      const inactiveUsers = allUsers.filter(user => {
        const userId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
        const userIdLower = userId.toLowerCase();
        const userIdNoHyphens = userIdLower.replace(/-/g, '');
        return !activeUserIdsSet.has(userIdLower) && !activeUserIdsSet.has(userIdNoHyphens);
      });
      console.log(`Found ${inactiveUsers.length} inactive users`);
      
      // Only add inactive users that match our missing IDs
      let addedCount = 0;
      inactiveUsers.forEach(user => {
        const userUserId = typeof user.userId === 'string' ? user.userId : user.userId.toString();
        const userUserIdLower = userUserId.toLowerCase();
        const userUserIdNoHyphens = userUserIdLower.replace(/-/g, '');
        
        // Check if this inactive user matches any of our missing IDs
        const matchesMissingId = missingUserIds.some(missingId => {
          const missingIdStr = typeof missingId === 'string' ? missingId : missingId.toString();
          const missingIdLower = missingIdStr.toLowerCase();
          const missingIdNoHyphens = missingIdLower.replace(/-/g, '');
          
          return userUserIdLower === missingIdLower ||
                 userUserIdNoHyphens === missingIdNoHyphens ||
                 userUserId === missingIdStr;
        });
        
        // Only add if it matches a missing ID
        if (matchesMissingId) {
          addUserToMap(user);
          addedCount++;
          console.log(`  ✓ Added inactive user ${user.userId} (${user.name || user.userName}) to userMap`);
        }
      });
      
      console.log(`Added ${addedCount} inactive users to userMap for unmatched shipment user IDs`);
      
      // Log any that still couldn't be matched
      const stillMissing: Array<string | number> = [];
      missingUserIds.forEach(missingId => {
        const missingIdStr = typeof missingId === 'string' ? missingId : missingId.toString();
        let found = userMap.has(missingId);
        if (!found && typeof missingId === 'string') {
          found = userMap.has(missingId.toLowerCase()) || userMap.has(missingId.toUpperCase());
        }
        if (!found && typeof missingId === 'string' && missingId.includes('-')) {
          const noHyphens = missingId.replace(/-/g, '');
          found = userMap.has(noHyphens) || userMap.has(noHyphens.toLowerCase());
        }
        if (!found) {
          stillMissing.push(missingId);
        }
      });
      
      if (stillMissing.length > 0) {
        console.warn(`⚠️  Still missing ${stillMissing.length} user IDs after matching attempt. These users may not exist in ShipStation:`);
        stillMissing.slice(0, 10).forEach(id => console.warn(`  - ${id}`));
      }
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


