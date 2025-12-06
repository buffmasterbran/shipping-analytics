import type { ShipStationShipment, ShipStationUser, ShipStationApiResponse } from '@/types/shipstation';

const SHIPSTATION_BASE_URL = process.env.SHIPSTATION_BASE_URL || 'https://ssapi.shipstation.com';

/**
 * Get Basic Auth header for ShipStation API
 */
function getAuthHeader(): string {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET must be set');
  }

  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Fetch all shipments from ShipStation with pagination
 */
export async function fetchAllShipments(
  startDate: string,
  endDate: string
): Promise<ShipStationShipment[]> {
  const authHeader = getAuthHeader();
  const allShipments: ShipStationShipment[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${SHIPSTATION_BASE_URL}/shipments`);
    url.searchParams.set('createDateStart', startDate);
    url.searchParams.set('createDateEnd', endDate);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('pageSize', '500'); // Max page size

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ShipStation API error: ${response.status} - ${errorText}`);
    }

    const data: ShipStationApiResponse<ShipStationShipment> = await response.json();
    
    if (data.shipments) {
      allShipments.push(...data.shipments);
    }

    // Check if there are more pages
    hasMore = page < (data.pages || 0);
    page++;
  }

  return allShipments;
}

/**
 * Fetch all users from ShipStation
 */
export async function fetchAllUsers(): Promise<ShipStationUser[]> {
  const authHeader = getAuthHeader();
  const allUsers: ShipStationUser[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${SHIPSTATION_BASE_URL}/users`);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('pageSize', '500');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ShipStation API error: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    
    // ShipStation Users API returns an array directly, not wrapped in an object
    let users: ShipStationUser[] = [];
    if (Array.isArray(responseData)) {
      users = responseData;
    } else if (responseData.users && Array.isArray(responseData.users)) {
      // Fallback: if wrapped in an object
      users = responseData.users;
    }
    
    // Debug: Log raw API response structure
    if (page === 1 && users.length > 0) {
      console.log('ShipStation Users API response structure:', JSON.stringify(users[0], null, 2));
    }
    
    allUsers.push(...users);

    // Check if there are more pages (ShipStation Users API may not paginate the same way)
    // If response is an array and we got less than pageSize, we're done
    hasMore = Array.isArray(responseData) ? users.length === 500 : page < (responseData.pages || 0);
    page++;
  }

  return allUsers;
}


