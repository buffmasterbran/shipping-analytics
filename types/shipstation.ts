// ShipStation API Types

export interface ShipStationShipment {
  shipmentId: number;
  orderId: number;
  userId: number | string; // Can be numeric ID or UUID string
  createDate: string; // ISO string
  shipDate: string; // ISO string
  shipmentCost: number;
  carrierCode: string;
  serviceCode: string;
  [key: string]: unknown;
}

export interface ShipStationUser {
  userId: number | string; // Can be numeric ID or UUID string
  userName?: string; // Username/login (optional)
  name?: string; // Display name (preferred for display)
  [key: string]: unknown;
}

export interface ShipStationApiResponse<T> {
  shipments?: T[];
  users?: T[];
  page: number;
  pages: number;
  total: number;
}

// Aggregated Data Types

export interface HourlySeriesPoint {
  hour: string; // e.g. "2025-12-06T14:00:00-05:00"
  [userId: string]: string | number; // dynamic keys for each user's shipment count
}

export interface PackingTimeDetail {
  currentBoxSize: string;
  currentTime: string; // ISO timestamp
  previousBoxSize: string;
  previousTime: string; // ISO timestamp
  timeDifferenceMinutes: number;
  included: boolean; // Whether this was included in the average calculation
}

export interface BoxSizeStats {
  count: number;
  averageTimeMinutes?: number; // Average time to pack this box size
  goalMinutes?: number; // Target time for this box size
  isMeetingGoal?: boolean; // Whether average time meets the goal
  packingTimeDetails?: PackingTimeDetail[]; // Detailed breakdown of calculations
}

export interface UserSummary {
  userId: string;
  userName: string;
  totalShipments: number;
  firstShipmentDate?: string; // ISO string of first shipment
  lastShipmentDate?: string; // ISO string of last shipment
  shipmentsPerHour?: number; // Calculated rate per hour
  shipmentsPerDay?: number; // Calculated rate per day
  minutesPerShipment?: number; // Calculated minutes per shipment (60 / shipmentsPerHour)
  boxSizeBreakdown?: Record<string, number>; // Map of box size name -> count
  boxSizeStats?: Record<string, BoxSizeStats>; // Map of box size name -> stats with goals
}

export interface ShipmentsHourlyResponse {
  startDate: string;
  endDate: string;
  timezone: string; // "America/New_York"
  series: HourlySeriesPoint[];
  users: UserSummary[];
  totals: {
    totalShipments: number;
  };
  rawShipments?: ShipStationShipment[]; // Optional raw shipment data
}


