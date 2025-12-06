import { NextRequest, NextResponse } from 'next/server';
import { fetchAllPackages } from '@/lib/shipstation';

/**
 * GET /api/packages
 * Extract unique packages from shipments
 * 
 * Query params:
 * - startDate: Optional start date (defaults to 90 days ago)
 * - endDate: Optional end date (defaults to now)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    
    const packages = await fetchAllPackages(startDate, endDate);

    return NextResponse.json({
      packages,
      total: packages.length,
      note: 'Packages are extracted from shipments since ShipStation does not have a dedicated packages endpoint',
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch packages' },
      { status: 500 }
    );
  }
}

