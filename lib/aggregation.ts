import { format, parseISO, differenceInHours, differenceInDays } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import type { ShipStationShipment } from '@/types/shipstation';
import type { HourlySeriesPoint, UserSummary } from '@/types/shipstation';

const TIMEZONE = 'America/New_York';
const SHIPSTATION_TIMEZONE = 'America/Los_Angeles'; // ShipStation returns times in Pacific Time


/**
 * Packing time goals in minutes per box size
 */
const PACKING_TIME_GOALS: Record<string, number> = {
  '2/4': 1.5,
  '4/6': 1.5,
  '6/10': 3,
  '9/12': 4,
  '12/18': 5,
  '22/30': 7,
  '12/24 (Factory 24x 16oz)': 7,
};

/**
 * Map dimensions to box size name
 * Maps standard box dimensions to their names
 */
function getBoxSizeName(dimensions: { length: number; width: number; height: number; units: string } | null | undefined): string {
  if (!dimensions) {
    return 'Unknown';
  }
  
  const { length, width, height, units } = dimensions;
  
  // Normalize dimensions (sort to handle different orientations)
  // Sort descending to match largest to smallest
  const dims = [length, width, height].sort((a, b) => b - a);
  
  // Box size mappings (sorted by largest dimension first)
  // Format: [largest, middle, smallest] => "Box Name"
  
  // a. 2/4 - 8x8x6
  if (dims[0] === 8 && dims[1] === 8 && dims[2] === 6) {
    return '2/4';
  }
  
  // b. 4/6 - 16x8x4
  if (dims[0] === 16 && dims[1] === 8 && dims[2] === 4) {
    return '4/6';
  }
  
  // c. 6/10 - 12x10x8
  if (dims[0] === 12 && dims[1] === 10 && dims[2] === 8) {
    return '6/10';
  }
  
  // d. 9/12 - 12x12x8
  if (dims[0] === 12 && dims[1] === 12 && dims[2] === 8) {
    return '9/12';
  }
  
  // e. 12/18 - 16x12x8
  if (dims[0] === 16 && dims[1] === 12 && dims[2] === 8) {
    return '12/18';
  }
  
  // f. 12/24 (Factory 24x 16oz) - 16x12x12
  if (dims[0] === 16 && dims[1] === 12 && dims[2] === 12) {
    return '12/24 (Factory 24x 16oz)';
  }
  
  // g. 22/30 - 20x12x12
  if (dims[0] === 20 && dims[1] === 12 && dims[2] === 12) {
    return '22/30';
  }
  
  // h. 24/32 (Factory 24x 26oz) - 16x16x12
  if (dims[0] === 16 && dims[1] === 16 && dims[2] === 12) {
    return '24/32 (Factory 24x 26oz)';
  }
  
  // i. 30/40 - 20x16x12
  if (dims[0] === 20 && dims[1] === 16 && dims[2] === 12) {
    return '30/40';
  }
  
  // j. 36/48 - 24x16x12
  if (dims[0] === 24 && dims[1] === 16 && dims[2] === 12) {
    return '36/48';
  }
  
  // k. 48/64 - 24x16x16
  if (dims[0] === 24 && dims[1] === 16 && dims[2] === 16) {
    return '48/64';
  }
  
  // l. CUSTOM PACKAGING - 1x1x1
  if (dims[0] === 1 && dims[1] === 1 && dims[2] === 1) {
    return 'CUSTOM PACKAGING';
  }
  
  // m. Desktop Display - 20x17x5
  if (dims[0] === 20 && dims[1] === 17 && dims[2] === 5) {
    return 'Desktop Display';
  }
  
  // n. Freestanding POP-FRS-72 - 54x24x5
  if (dims[0] === 54 && dims[1] === 24 && dims[2] === 5) {
    return 'Freestanding POP-FRS-72';
  }
  
  // o. FRS POP 2 of 2 (freestanding) - 32x25x6
  if (dims[0] === 32 && dims[1] === 25 && dims[2] === 6) {
    return 'FRS POP 2 of 2 (freestanding)';
  }
  
  // p. Freestanding Rear Kit (POP-FRS-Rear) - 15x24x11
  if (dims[0] === 24 && dims[1] === 15 && dims[2] === 11) {
    return 'Freestanding Rear Kit (POP-FRS-Rear)';
  }
  
  // q. (Factory 24x 10oz) - 24x17x6
  if (dims[0] === 24 && dims[1] === 17 && dims[2] === 6) {
    return '(Factory 24x 10oz)';
  }
  
  // Return formatted dimensions for unmapped sizes
  return `${length}x${width}x${height} ${units}`;
}

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
  
  // Map to store box size breakdown per user: userName -> boxSizeName -> count
  const userBoxSizes = new Map<string, Map<string, number>>();
  
  // Map to store box size shipments with timestamps: userName -> boxSizeName -> Date[]
  // Used to calculate average packing time per box size
  const userBoxSizeTimestamps = new Map<string, Map<string, Date[]>>();

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
    
    // Fallback: Try one more time with a more aggressive search
    if (!userName) {
      // Try searching through all userMap entries for any match
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const shipmentIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
        
        // Try exact match (case-insensitive)
        if (keyStr.toLowerCase() === shipmentIdStr.toLowerCase()) {
          userName = value;
          break;
        }
        
        // Try matching without hyphens (for UUIDs)
        if (shipmentIdStr.includes('-') || keyStr.includes('-')) {
          const keyNoHyphens = keyStr.replace(/-/g, '').toLowerCase();
          const shipmentNoHyphens = shipmentIdStr.replace(/-/g, '').toLowerCase();
          if (keyNoHyphens === shipmentNoHyphens) {
            userName = value;
            break;
          }
        }
      }
    }
    
    // Final fallback - this should never happen if userMap is properly populated
    // But if it does, use the userId and log an error
    if (!userName) {
      // Try one last aggressive search through all userMap values
      const shipmentIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
      const shipmentIdLower = shipmentIdStr.toLowerCase();
      const shipmentIdNoHyphens = shipmentIdLower.replace(/-/g, '');
      
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const keyLower = keyStr.toLowerCase();
        const keyNoHyphens = keyLower.replace(/-/g, '');
        
        // Try all variations
        if (keyLower === shipmentIdLower || 
            keyNoHyphens === shipmentIdNoHyphens ||
            keyStr === shipmentIdStr) {
          userName = value;
          break;
        }
      }
      
      // If still not found, log detailed error
      if (!userName) {
        console.error(`[Hourly Aggregation] CRITICAL: Could not find user name for userId: ${shipment.userId}`);
        console.error(`UserMap size:`, userMap.size);
        console.error(`UserMap sample keys:`, Array.from(userMap.keys()).slice(0, 10));
        console.error(`Shipment userId type:`, typeof shipment.userId, `value:`, shipment.userId);
        // Use userId as fallback but log it
        userName = userId;
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
    
    // Track box sizes for this user
    const dimensions = (shipment as any).dimensions;
    const boxSizeName = getBoxSizeName(dimensions);
    if (!userBoxSizes.has(userKey)) {
      userBoxSizes.set(userKey, new Map());
    }
    const boxSizeMap = userBoxSizes.get(userKey)!;
    boxSizeMap.set(boxSizeName, (boxSizeMap.get(boxSizeName) || 0) + 1);
    
    // Track timestamps for box sizes to calculate average packing time
    if (!userBoxSizeTimestamps.has(userKey)) {
      userBoxSizeTimestamps.set(userKey, new Map());
    }
    const boxSizeTimestampsMap = userBoxSizeTimestamps.get(userKey)!;
    if (!boxSizeTimestampsMap.has(boxSizeName)) {
      boxSizeTimestampsMap.set(boxSizeName, []);
    }
    boxSizeTimestampsMap.get(boxSizeName)!.push(nyDate);
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
      
      // Convert box size map to object and calculate stats
      const boxSizeBreakdown: Record<string, number> = {};
      const boxSizeStats: Record<string, { count: number; averageTimeMinutes?: number; goalMinutes?: number; isMeetingGoal?: boolean; packingTimeDetails?: Array<{ currentBoxSize: string; currentTime: string; previousBoxSize: string; previousTime: string; timeDifferenceMinutes: number; included: boolean }> }> = {};
      const boxSizeMap = userBoxSizes.get(userKey);
      const timestampsMap = userBoxSizeTimestamps.get(userKey);
      
      if (boxSizeMap && timestampsMap) {
        // Collect all shipments with their box sizes and timestamps
        const allShipments: Array<{ boxSize: string; timestamp: Date }> = [];
        timestampsMap.forEach((timestamps, boxSizeName) => {
          timestamps.forEach(timestamp => {
            allShipments.push({ boxSize: boxSizeName, timestamp });
          });
        });
        
        // Sort all shipments chronologically
        allShipments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        // Calculate packing times: time difference from previous shipment to current shipment
        // The time difference is attributed to the current shipment's box size
        const packingTimesByBoxSize = new Map<string, number[]>();
        const packingDetailsByBoxSize = new Map<string, Array<{ currentBoxSize: string; currentTime: string; previousBoxSize: string; previousTime: string; timeDifferenceMinutes: number; included: boolean }>>();
        
        for (let i = 1; i < allShipments.length; i++) {
          const current = allShipments[i];
          const previous = allShipments[i - 1];
          
          const diffMs = current.timestamp.getTime() - previous.timestamp.getTime();
          const diffMinutes = diffMs / (1000 * 60);
          
          // Track details for this box size
          if (!packingDetailsByBoxSize.has(current.boxSize)) {
            packingDetailsByBoxSize.set(current.boxSize, []);
          }
          
          const included = diffMinutes >= 0.5 && diffMinutes <= 60;
          packingDetailsByBoxSize.get(current.boxSize)!.push({
            currentBoxSize: current.boxSize,
            currentTime: current.timestamp.toISOString(),
            previousBoxSize: previous.boxSize,
            previousTime: previous.timestamp.toISOString(),
            timeDifferenceMinutes: parseFloat(diffMinutes.toFixed(2)),
            included,
          });
          
          // Only include reasonable time differences (between 0.5 and 60 minutes)
          // This filters out breaks, lunch, etc.
          if (included) {
            if (!packingTimesByBoxSize.has(current.boxSize)) {
              packingTimesByBoxSize.set(current.boxSize, []);
            }
            packingTimesByBoxSize.get(current.boxSize)!.push(diffMinutes);
          }
        }
        
        // Calculate averages per box size
        boxSizeMap.forEach((count, boxSizeName) => {
          boxSizeBreakdown[boxSizeName] = count;
          
          const packingTimes = packingTimesByBoxSize.get(boxSizeName) || [];
          let averageTimeMinutes: number | undefined;
          
          if (packingTimes.length > 0) {
            // Calculate average from actual packing times
            averageTimeMinutes = packingTimes.reduce((sum, time) => sum + time, 0) / packingTimes.length;
          } else if (count > 0) {
            // If this is the first shipment(s) of the day and we have other box sizes with averages,
            // use the average of all other box sizes as an estimate
            const allAverages: number[] = [];
            packingTimesByBoxSize.forEach((times, boxSize) => {
              if (times.length > 0) {
                const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
                allAverages.push(avg);
              }
            });
            
            if (allAverages.length > 0) {
              averageTimeMinutes = allAverages.reduce((sum, avg) => sum + avg, 0) / allAverages.length;
            }
          }
          
          // Get goal for this box size
          const goalMinutes = PACKING_TIME_GOALS[boxSizeName];
          const isMeetingGoal = averageTimeMinutes !== undefined && goalMinutes !== undefined
            ? averageTimeMinutes <= goalMinutes
            : undefined;
          
          // Get detailed breakdown for this box size
          const packingDetails = packingDetailsByBoxSize.get(boxSizeName) || [];
          
          boxSizeStats[boxSizeName] = {
            count,
            averageTimeMinutes: averageTimeMinutes ? parseFloat(averageTimeMinutes.toFixed(1)) : undefined,
            goalMinutes,
            isMeetingGoal,
            packingTimeDetails: packingDetails.length > 0 ? packingDetails : undefined,
          };
        });
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
        boxSizeBreakdown: Object.keys(boxSizeBreakdown).length > 0 ? boxSizeBreakdown : undefined,
        boxSizeStats: Object.keys(boxSizeStats).length > 0 ? boxSizeStats : undefined,
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
  
  // Map to store box size breakdown per user: userName -> boxSizeName -> count
  const userBoxSizes = new Map<string, Map<string, number>>();
  
  // Map to store box size shipments with timestamps: userName -> boxSizeName -> Date[]
  // Used to calculate average packing time per box size
  const userBoxSizeTimestamps = new Map<string, Map<string, Date[]>>();

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
    
    // Fallback: Try one more time with a more aggressive search
    if (!userName) {
      // Try searching through all userMap entries for any match
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const shipmentIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
        
        // Try exact match (case-insensitive)
        if (keyStr.toLowerCase() === shipmentIdStr.toLowerCase()) {
          userName = value;
          break;
        }
        
        // Try matching without hyphens (for UUIDs)
        if (shipmentIdStr.includes('-') || keyStr.includes('-')) {
          const keyNoHyphens = keyStr.replace(/-/g, '').toLowerCase();
          const shipmentNoHyphens = shipmentIdStr.replace(/-/g, '').toLowerCase();
          if (keyNoHyphens === shipmentNoHyphens) {
            userName = value;
            break;
          }
        }
      }
    }
    
    // Final fallback - this should never happen if userMap is properly populated
    // But if it does, use the userId and log an error
    if (!userName) {
      // Try one last aggressive search through all userMap values
      const shipmentIdStr = typeof shipment.userId === 'string' ? shipment.userId : shipment.userId.toString();
      const shipmentIdLower = shipmentIdStr.toLowerCase();
      const shipmentIdNoHyphens = shipmentIdLower.replace(/-/g, '');
      
      for (const [key, value] of userMap.entries()) {
        const keyStr = typeof key === 'string' ? key : key.toString();
        const keyLower = keyStr.toLowerCase();
        const keyNoHyphens = keyLower.replace(/-/g, '');
        
        // Try all variations
        if (keyLower === shipmentIdLower || 
            keyNoHyphens === shipmentIdNoHyphens ||
            keyStr === shipmentIdStr) {
          userName = value;
          break;
        }
      }
      
      // If still not found, log detailed error
      if (!userName) {
        console.error(`[Daily Aggregation] CRITICAL: Could not find user name for userId: ${shipment.userId}`);
        console.error(`UserMap size:`, userMap.size);
        console.error(`UserMap sample keys:`, Array.from(userMap.keys()).slice(0, 10));
        console.error(`Shipment userId type:`, typeof shipment.userId, `value:`, shipment.userId);
        // Use userId as fallback but log it
        userName = userId;
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
    
    // Track box sizes for this user
    const dimensions = (shipment as any).dimensions;
    const boxSizeName = getBoxSizeName(dimensions);
    if (!userBoxSizes.has(userKey)) {
      userBoxSizes.set(userKey, new Map());
    }
    const boxSizeMap = userBoxSizes.get(userKey)!;
    boxSizeMap.set(boxSizeName, (boxSizeMap.get(boxSizeName) || 0) + 1);
    
    // Track timestamps for box sizes to calculate average packing time
    if (!userBoxSizeTimestamps.has(userKey)) {
      userBoxSizeTimestamps.set(userKey, new Map());
    }
    const boxSizeTimestampsMap = userBoxSizeTimestamps.get(userKey)!;
    if (!boxSizeTimestampsMap.has(boxSizeName)) {
      boxSizeTimestampsMap.set(boxSizeName, []);
    }
    boxSizeTimestampsMap.get(boxSizeName)!.push(nyDate);
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
      
      // Convert box size map to object and calculate stats
      const boxSizeBreakdown: Record<string, number> = {};
      const boxSizeStats: Record<string, { count: number; averageTimeMinutes?: number; goalMinutes?: number; isMeetingGoal?: boolean; packingTimeDetails?: Array<{ currentBoxSize: string; currentTime: string; previousBoxSize: string; previousTime: string; timeDifferenceMinutes: number; included: boolean }> }> = {};
      const boxSizeMap = userBoxSizes.get(userKey);
      const timestampsMap = userBoxSizeTimestamps.get(userKey);
      
      if (boxSizeMap && timestampsMap) {
        // Collect all shipments with their box sizes and timestamps
        const allShipments: Array<{ boxSize: string; timestamp: Date }> = [];
        timestampsMap.forEach((timestamps, boxSizeName) => {
          timestamps.forEach(timestamp => {
            allShipments.push({ boxSize: boxSizeName, timestamp });
          });
        });
        
        // Sort all shipments chronologically
        allShipments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        // Calculate packing times: time difference from previous shipment to current shipment
        // The time difference is attributed to the current shipment's box size
        const packingTimesByBoxSize = new Map<string, number[]>();
        const packingDetailsByBoxSize = new Map<string, Array<{ currentBoxSize: string; currentTime: string; previousBoxSize: string; previousTime: string; timeDifferenceMinutes: number; included: boolean }>>();
        
        for (let i = 1; i < allShipments.length; i++) {
          const current = allShipments[i];
          const previous = allShipments[i - 1];
          
          const diffMs = current.timestamp.getTime() - previous.timestamp.getTime();
          const diffMinutes = diffMs / (1000 * 60);
          
          // Track details for this box size
          if (!packingDetailsByBoxSize.has(current.boxSize)) {
            packingDetailsByBoxSize.set(current.boxSize, []);
          }
          
          const included = diffMinutes >= 0.5 && diffMinutes <= 60;
          packingDetailsByBoxSize.get(current.boxSize)!.push({
            currentBoxSize: current.boxSize,
            currentTime: current.timestamp.toISOString(),
            previousBoxSize: previous.boxSize,
            previousTime: previous.timestamp.toISOString(),
            timeDifferenceMinutes: parseFloat(diffMinutes.toFixed(2)),
            included,
          });
          
          // Only include reasonable time differences (between 0.5 and 60 minutes)
          // This filters out breaks, lunch, etc.
          if (included) {
            if (!packingTimesByBoxSize.has(current.boxSize)) {
              packingTimesByBoxSize.set(current.boxSize, []);
            }
            packingTimesByBoxSize.get(current.boxSize)!.push(diffMinutes);
          }
        }
        
        // Calculate averages per box size
        boxSizeMap.forEach((count, boxSizeName) => {
          boxSizeBreakdown[boxSizeName] = count;
          
          const packingTimes = packingTimesByBoxSize.get(boxSizeName) || [];
          let averageTimeMinutes: number | undefined;
          
          if (packingTimes.length > 0) {
            // Calculate average from actual packing times
            averageTimeMinutes = packingTimes.reduce((sum, time) => sum + time, 0) / packingTimes.length;
          } else if (count > 0) {
            // If this is the first shipment(s) of the day and we have other box sizes with averages,
            // use the average of all other box sizes as an estimate
            const allAverages: number[] = [];
            packingTimesByBoxSize.forEach((times, boxSize) => {
              if (times.length > 0) {
                const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
                allAverages.push(avg);
              }
            });
            
            if (allAverages.length > 0) {
              averageTimeMinutes = allAverages.reduce((sum, avg) => sum + avg, 0) / allAverages.length;
            }
          }
          
          // Get goal for this box size
          const goalMinutes = PACKING_TIME_GOALS[boxSizeName];
          const isMeetingGoal = averageTimeMinutes !== undefined && goalMinutes !== undefined
            ? averageTimeMinutes <= goalMinutes
            : undefined;
          
          // Get detailed breakdown for this box size
          const packingDetails = packingDetailsByBoxSize.get(boxSizeName) || [];
          
          boxSizeStats[boxSizeName] = {
            count,
            averageTimeMinutes: averageTimeMinutes ? parseFloat(averageTimeMinutes.toFixed(1)) : undefined,
            goalMinutes,
            isMeetingGoal,
            packingTimeDetails: packingDetails.length > 0 ? packingDetails : undefined,
          };
        });
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
        boxSizeBreakdown: Object.keys(boxSizeBreakdown).length > 0 ? boxSizeBreakdown : undefined,
        boxSizeStats: Object.keys(boxSizeStats).length > 0 ? boxSizeStats : undefined,
      };
    })
    .sort((a, b) => b.totalShipments - a.totalShipments);

  return {
    series,
    userSummaries,
    totalShipments: shipments.length,
  };
}

