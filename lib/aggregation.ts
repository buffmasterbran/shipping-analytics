import { format, parseISO, differenceInHours, differenceInDays } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import type { ShipStationShipment } from '@/types/shipstation';
import type { HourlySeriesPoint, UserSummary } from '@/types/shipstation';

const TIMEZONE = 'America/New_York';
const SHIPSTATION_TIMEZONE = 'America/Los_Angeles'; // ShipStation returns times in Pacific Time

/**
 * Aggregate shipments by hour and userId
 */
export function aggregateShipmentsByHour(
  shipments: ShipStationShipment[],
  userMap: Map<string | number, string>
): {
  series: HourlySeriesPoint[];
  userSummaries: UserSummary[];
  totalShipments: number;
} {
  // Map to store counts: hour -> userName -> count
  const hourMap = new Map<string, Map<string, number>>();
  
  // Map to store user totals: userName -> count
  const userTotals = new Map<string, number>();
  
  // Map to store userName -> userId mapping
  const userNameToUserId = new Map<string, string>();
  
  // Map to store first and last shipment dates per user: userName -> { first: Date, last: Date }
  const userDateRanges = new Map<string, { first: Date; last: Date }>();

  for (const shipment of shipments) {
    // Use createDate, fallback to shipDate
    let dateStr = shipment.createDate || shipment.shipDate;
    if (!dateStr) continue;

    // ShipStation returns dates in Pacific Time (PST/PDT) without timezone indicator
    // Parse the date string and treat it as Pacific Time, then convert to Eastern Time
    let nyDate: Date;
    if (dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/-\d{2}:\d{2}$/)) {
      // Has timezone indicator, parse normally and convert to Eastern
      const parsedDate = parseISO(dateStr);
      nyDate = utcToZonedTime(parsedDate, TIMEZONE);
    } else {
      // No timezone indicator - treat as Pacific Time
      // Parse the ISO string to extract date components
      // Format: "2025-12-04T05:21:10.8600000" -> extract "2025-12-04T05:21:10"
      const cleanDateStr = dateStr.replace(/\.\d+$/, ''); // Remove milliseconds
      const match = cleanDateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      
      if (match) {
        const [, year, month, day, hour, minute, second] = match.map(Number);
        // ShipStation returns times in Pacific Time (PST/PDT) without timezone indicator
        // The date components represent Pacific Time: "2025-12-04T05:21:10" = 05:21 Pacific = 08:21 Eastern
        // Pacific to Eastern is 3 hours ahead
        // Create date string and parse it as UTC first
        const pacificDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
        // Parse as UTC (we'll adjust for Pacific)
        const utcDate = parseISO(pacificDateStr + 'Z');
        // The date string represents Pacific Time, not UTC
        // Pacific Time is UTC-8 (PST) or UTC-7 (PDT), Eastern is UTC-5 (EST) or UTC-4 (EDT)
        // So Pacific 05:21 = UTC 13:21 (PST) = Eastern 08:21 (EST)
        // Add 8 hours to convert Pacific to UTC (PST offset), then convert UTC to Eastern
        // The timezone conversion will handle DST automatically
        const actualUtcDate = new Date(utcDate.getTime() + (8 * 60 * 60 * 1000)); // Add 8 hours for PST
        // Convert UTC to Eastern Time (handles DST automatically)
        nyDate = utcToZonedTime(actualUtcDate, TIMEZONE);
      } else {
        // Fallback: parse normally
        const parsedDate = parseISO(cleanDateStr);
        nyDate = utcToZonedTime(parsedDate, TIMEZONE);
      }
    }

    // Format as hour bucket: "2025-12-06T14:00:00-05:00"
    const hourBucket = format(nyDate, "yyyy-MM-dd'T'HH:00:00XXX");

    // Get user identifier (use userName if available, otherwise userId)
    const userId = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
    
    // Try multiple lookup strategies for UUID matching
    // First try exact match with original type
    let userName = userMap.get(shipment.userId);
    
    // If not found, try with string conversion
    if (!userName) {
      const userIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
      userName = userMap.get(userIdStr);
    }
    
    // If still not found, try with number conversion (if it's a numeric string)
    if (!userName && typeof shipment.userId === 'string' && !isNaN(Number(shipment.userId))) {
      userName = userMap.get(Number(shipment.userId));
    }
    
    // Try case-insensitive match for string IDs
    if (!userName && typeof shipment.userId === 'string') {
      const shipmentUserIdLower = shipment.userId.toLowerCase();
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const keyStrLower = keyStr.toLowerCase();
        
        // Exact case-insensitive match
        if (keyStrLower === shipmentUserIdLower) {
          userName = value;
          break;
        }
        
        // For UUIDs, try matching without hyphens
        if (shipment.userId.includes('-') && keyStr.includes('-')) {
          const shipmentNoHyphens = shipmentUserIdLower.replace(/-/g, '');
          const keyNoHyphens = keyStrLower.replace(/-/g, '');
          if (shipmentNoHyphens === keyNoHyphens) {
            userName = value;
            break;
          }
        }
      }
    }
    
    // Fallback to User ID if no match found
    if (!userName) {
      userName = `User ${userId}`;
      // Debug: Log when we can't find a user name - log all instances for UUIDs
      if (typeof shipment.userId === 'string' && shipment.userId.includes('-')) {
        // This is a UUID, log it
        console.log(`[Hourly Aggregation] Could not find user name for UUID userId: ${shipment.userId}`);
        console.log(`UserMap has this exact key?`, userMap.has(shipment.userId));
        console.log(`UserMap has lowercase?`, userMap.has(shipment.userId.toLowerCase()));
        console.log(`UserMap has no hyphens?`, userMap.has(shipment.userId.replace(/-/g, '')));
        console.log(`Sample userMap keys (first 10):`, Array.from(userMap.keys()).slice(0, 10));
        console.log(`UserMap size:`, userMap.size);
        // Try to find a partial match
        for (const [key, value] of userMap.entries()) {
          const keyStr = typeof key === 'string' ? key : key.toString();
          if (keyStr.toLowerCase().includes(shipment.userId.toLowerCase().substring(0, 8))) {
            console.log(`Found partial match: ${keyStr} -> ${value}`);
          }
        }
      }
    }
    
    const userKey = userName;

    // Store userName -> userId mapping
    if (!userNameToUserId.has(userKey)) {
      userNameToUserId.set(userKey, userId);
    }

    // Initialize hour bucket if needed
    if (!hourMap.has(hourBucket)) {
      hourMap.set(hourBucket, new Map());
    }

    const hourData = hourMap.get(hourBucket)!;
    hourData.set(userKey, (hourData.get(userKey) || 0) + 1);

    // Update user totals
    userTotals.set(userKey, (userTotals.get(userKey) || 0) + 1);
    
    // Track first and last shipment dates for this user
    if (!userDateRanges.has(userKey)) {
      userDateRanges.set(userKey, { first: nyDate, last: nyDate });
    } else {
      const range = userDateRanges.get(userKey)!;
      if (nyDate < range.first) {
        range.first = nyDate;
      }
      if (nyDate > range.last) {
        range.last = nyDate;
      }
    }
  }

  // Convert to series array
  const series: HourlySeriesPoint[] = Array.from(hourMap.entries())
    .map(([hour, userCounts]) => {
      const point: HourlySeriesPoint = { hour };
      userCounts.forEach((count, userKey) => {
        point[userKey] = count;
      });
      return point;
    })
    .sort((a, b) => a.hour.localeCompare(b.hour));

  // Convert user totals to summaries
  const userSummaries: UserSummary[] = Array.from(userTotals.entries())
    .map(([userKey, totalShipments]) => {
      const userId = userNameToUserId.get(userKey) || userKey;
      const dateRange = userDateRanges.get(userKey);
      
      let shipmentsPerHour: number | undefined;
      let shipmentsPerDay: number | undefined;
      let minutesPerShipment: number | undefined;
      
      if (dateRange) {
        // Calculate time difference in milliseconds, then convert to hours
        const timeDiffMs = dateRange.last.getTime() - dateRange.first.getTime();
        const hoursDiff = timeDiffMs / (1000 * 60 * 60); // Convert to hours (can be fractional)
        const daysDiff = differenceInDays(dateRange.last, dateRange.first);
        
        // Calculate shipments per hour
        // If time difference is less than 1 hour, treat as 1 hour (minimum)
        if (hoursDiff > 0) {
          shipmentsPerHour = totalShipments / hoursDiff;
        } else {
          // If all shipments are at the same time or within same hour, rate is just the count
          shipmentsPerHour = totalShipments;
        }
        
        // Calculate minutes per shipment (60 minutes / shipments per hour)
        if (shipmentsPerHour > 0) {
          minutesPerShipment = 60 / shipmentsPerHour;
        }
        
        // Calculate shipments per day
        // If days difference is 0, treat as 1 day (minimum)
        if (daysDiff > 0) {
          shipmentsPerDay = totalShipments / (daysDiff + 1); // +1 to include both start and end days
        } else {
          // If all shipments are on the same day, rate is just the count
          shipmentsPerDay = totalShipments;
        }
      }
      
      return {
        userId,
        userName: userKey,
        totalShipments,
        firstShipmentDate: dateRange?.first.toISOString(),
        lastShipmentDate: dateRange?.last.toISOString(),
        shipmentsPerHour,
        shipmentsPerDay,
        minutesPerShipment,
      };
    })
    .sort((a, b) => b.totalShipments - a.totalShipments);

  return {
    series,
    userSummaries,
    totalShipments: shipments.length,
  };
}

/**
 * Aggregate shipments by day and userId
 */
export function aggregateShipmentsByDay(
  shipments: ShipStationShipment[],
  userMap: Map<string | number, string>
): {
  series: HourlySeriesPoint[];
  userSummaries: UserSummary[];
  totalShipments: number;
} {
  // Map to store counts: day -> userName -> count
  const dayMap = new Map<string, Map<string, number>>();
  
  // Map to store user totals: userName -> count
  const userTotals = new Map<string, number>();
  
  // Map to store userName -> userId mapping
  const userNameToUserId = new Map<string, string>();
  
  // Map to store first and last shipment dates per user: userName -> { first: Date, last: Date }
  const userDateRanges = new Map<string, { first: Date; last: Date }>();

  for (const shipment of shipments) {
    // Use createDate, fallback to shipDate
    let dateStr = shipment.createDate || shipment.shipDate;
    if (!dateStr) continue;

    // ShipStation returns dates in Pacific Time (PST/PDT) without timezone indicator
    // Parse the date string and treat it as Pacific Time, then convert to Eastern Time
    let nyDate: Date;
    if (dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/-\d{2}:\d{2}$/)) {
      // Has timezone indicator, parse normally and convert to Eastern
      const parsedDate = parseISO(dateStr);
      nyDate = utcToZonedTime(parsedDate, TIMEZONE);
    } else {
      // No timezone indicator - treat as Pacific Time
      const cleanDateStr = dateStr.replace(/\.\d+$/, ''); // Remove milliseconds
      const match = cleanDateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      
      if (match) {
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const pacificDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
        const utcDate = parseISO(pacificDateStr + 'Z');
        const actualUtcDate = new Date(utcDate.getTime() + (8 * 60 * 60 * 1000)); // Add 8 hours for PST
        nyDate = utcToZonedTime(actualUtcDate, TIMEZONE);
      } else {
        // Fallback: parse normally
        const parsedDate = parseISO(cleanDateStr);
        nyDate = utcToZonedTime(parsedDate, TIMEZONE);
      }
    }

    // Format as day bucket: "2025-12-06T00:00:00-05:00"
    const dayBucket = format(nyDate, "yyyy-MM-dd'T'00:00:00XXX");

    // Get user identifier
    const userId = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
    
    // Try multiple lookup strategies for UUID matching
    // First try exact match with original type
    let userName = userMap.get(shipment.userId);
    
    // If not found, try with string conversion
    if (!userName) {
      const userIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
      userName = userMap.get(userIdStr);
    }
    
    // If still not found, try with number conversion (if it's a numeric string)
    if (!userName && typeof shipment.userId === 'string' && !isNaN(Number(shipment.userId))) {
      userName = userMap.get(Number(shipment.userId));
    }
    
    // Try case-insensitive match for string IDs
    if (!userName && typeof shipment.userId === 'string') {
      const shipmentUserIdLower = shipment.userId.toLowerCase();
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const keyStrLower = keyStr.toLowerCase();
        
        // Exact case-insensitive match
        if (keyStrLower === shipmentUserIdLower) {
          userName = value;
          break;
        }
        
        // For UUIDs, try matching without hyphens
        if (shipment.userId.includes('-') && keyStr.includes('-')) {
          const shipmentNoHyphens = shipmentUserIdLower.replace(/-/g, '');
          const keyNoHyphens = keyStrLower.replace(/-/g, '');
          if (shipmentNoHyphens === keyNoHyphens) {
            userName = value;
            break;
          }
        }
      }
    }
    
    // Fallback to User ID if no match found
    if (!userName) {
      userName = `User ${userId}`;
      // Debug: Log UUIDs that can't be matched
      if (typeof shipment.userId === 'string' && shipment.userId.includes('-')) {
        console.log(`[Daily Aggregation] Could not find user name for UUID: ${shipment.userId}`);
      }
    }
    
    const userKey = userName;

    // Store userName -> userId mapping
    if (!userNameToUserId.has(userKey)) {
      userNameToUserId.set(userKey, userId);
    }

    // Initialize day bucket if needed
    if (!dayMap.has(dayBucket)) {
      dayMap.set(dayBucket, new Map());
    }

    const dayData = dayMap.get(dayBucket)!;
    dayData.set(userKey, (dayData.get(userKey) || 0) + 1);

    // Update user totals
    userTotals.set(userKey, (userTotals.get(userKey) || 0) + 1);
    
    // Track first and last shipment dates for this user
    if (!userDateRanges.has(userKey)) {
      userDateRanges.set(userKey, { first: nyDate, last: nyDate });
    } else {
      const range = userDateRanges.get(userKey)!;
      if (nyDate < range.first) {
        range.first = nyDate;
      }
      if (nyDate > range.last) {
        range.last = nyDate;
      }
    }
  }

  // Convert to series array
  const series: HourlySeriesPoint[] = Array.from(dayMap.entries())
    .map(([day, userCounts]) => {
      const point: HourlySeriesPoint = { hour: day };
      userCounts.forEach((count, userKey) => {
        point[userKey] = count;
      });
      return point;
    })
    .sort((a, b) => a.hour.localeCompare(b.hour));

  // Convert user totals to summaries
  const userSummaries: UserSummary[] = Array.from(userTotals.entries())
    .map(([userKey, totalShipments]) => {
      const userId = userNameToUserId.get(userKey) || userKey;
      const dateRange = userDateRanges.get(userKey);
      
      let shipmentsPerHour: number | undefined;
      let shipmentsPerDay: number | undefined;
      let minutesPerShipment: number | undefined;
      
      if (dateRange) {
        // Calculate time difference in milliseconds, then convert to hours
        const timeDiffMs = dateRange.last.getTime() - dateRange.first.getTime();
        const hoursDiff = timeDiffMs / (1000 * 60 * 60); // Convert to hours (can be fractional)
        const daysDiff = differenceInDays(dateRange.last, dateRange.first);
        
        // Calculate shipments per hour
        // If time difference is less than 1 hour, treat as 1 hour (minimum)
        if (hoursDiff > 0) {
          shipmentsPerHour = totalShipments / hoursDiff;
        } else {
          // If all shipments are at the same time or within same hour, rate is just the count
          shipmentsPerHour = totalShipments;
        }
        
        // Calculate minutes per shipment (60 minutes / shipments per hour)
        if (shipmentsPerHour > 0) {
          minutesPerShipment = 60 / shipmentsPerHour;
        }
        
        // Calculate shipments per day
        // If days difference is 0, treat as 1 day (minimum)
        if (daysDiff > 0) {
          shipmentsPerDay = totalShipments / (daysDiff + 1); // +1 to include both start and end days
        } else {
          // If all shipments are on the same day, rate is just the count
          shipmentsPerDay = totalShipments;
        }
      }
      
      return {
        userId,
        userName: userKey,
        totalShipments,
        firstShipmentDate: dateRange?.first.toISOString(),
        lastShipmentDate: dateRange?.last.toISOString(),
        shipmentsPerHour,
        shipmentsPerDay,
        minutesPerShipment,
      };
    })
    .sort((a, b) => b.totalShipments - a.totalShipments);

  return {
    series,
    userSummaries,
    totalShipments: shipments.length,
  };
}

