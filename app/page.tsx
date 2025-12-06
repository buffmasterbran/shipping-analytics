'use client';

import { useState, useEffect } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ShipmentsHourlyResponse, HourlySeriesPoint } from '@/types/shipstation';
import DateRangePicker from '@/components/DateRangePicker';

export default function Dashboard() {
  const [data, setData] = useState<ShipmentsHourlyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [showUserTable, setShowUserTable] = useState(false);
  const [showChart, setShowChart] = useState(true); // Chart expanded by default
  const [showRawData, setShowRawData] = useState(false);
  const [visibleUsers, setVisibleUsers] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true); // Sidebar open by default

  const fetchData = async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/shipments/hourly?startDate=${start}&endDate=${end}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch data');
      }
      const result: ShipmentsHourlyResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(startDate, endDate);
  }, []);

  const handleDateRangeChange = (range: 'today' | 'yesterday' | 'custom') => {
    const now = new Date();
    if (range === 'today') {
      const today = format(startOfDay(now), 'yyyy-MM-dd');
      setStartDate(today);
      setEndDate(format(endOfDay(now), 'yyyy-MM-dd'));
      fetchData(today, format(endOfDay(now), 'yyyy-MM-dd'));
    } else if (range === 'yesterday') {
      const yesterday = subDays(now, 1);
      const yesterdayStart = format(startOfDay(yesterday), 'yyyy-MM-dd');
      const yesterdayEnd = format(endOfDay(yesterday), 'yyyy-MM-dd');
      setStartDate(yesterdayStart);
      setEndDate(yesterdayEnd);
      fetchData(yesterdayStart, yesterdayEnd);
    }
    // For custom, user will use the date inputs
  };

  const handleCustomDateSubmit = () => {
    if (startDate && endDate) {
      fetchData(startDate, endDate);
    }
  };

  // Prepare chart data - extract unique user names from series
  const chartData = data?.series || [];
  
  // Generate colors for each user
  const colors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
  ];

  // Create a stable color mapping based on original user order (before sorting)
  // This ensures each user always gets the same color regardless of sort order
  const userColorMap = data?.users.reduce((map, user, index) => {
    map[user.userName] = colors[index % colors.length];
    return map;
  }, {} as Record<string, string>) || {};

  // Sort users alphabetically for display
  const sortedUsers = data?.users ? [...data.users].sort((a, b) => a.userName.localeCompare(b.userName)) : [];
  const userNames = sortedUsers.map(u => u.userName);
  
  // Initialize visible users when data loads (all users visible by default, except Brandegee Pierce)
  useEffect(() => {
    if (data && data.users.length > 0) {
      const newUserNames = sortedUsers.map(u => u.userName);
      // Filter out "Brandegee Pierce" from default selection (admin user for batching)
      const defaultVisibleUsers = newUserNames.filter(name => name !== 'Brandegee Pierce');
      setVisibleUsers(prev => {
        // Only update if the user list has actually changed
        const prevSorted = Array.from(prev).sort().join(',');
        const newSorted = defaultVisibleUsers.join(',');
        if (prevSorted !== newSorted) {
          return new Set(defaultVisibleUsers);
        }
        return prev;
      });
    }
  }, [data?.users]);

  // Toggle user visibility
  const toggleUser = (userName: string) => {
    setVisibleUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userName)) {
        newSet.delete(userName);
      } else {
        newSet.add(userName);
      }
      return newSet;
    });
  };

  // Toggle all users
  const toggleAllUsers = () => {
    if (visibleUsers.size === userNames.length) {
      setVisibleUsers(new Set());
    } else {
      setVisibleUsers(new Set(userNames));
    }
  };

  // Filter user names to only visible ones
  const visibleUserNames = userNames.filter(name => visibleUsers.has(name));
  
  // Calculate total shipments for visible users only
  const visibleUsersTotal = data && visibleUserNames.length > 0
    ? data.users
        .filter(user => visibleUsers.has(user.userName))
        .reduce((sum, user) => sum + user.totalShipments, 0)
    : data?.totals.totalShipments || 0;

  // Determine if this is daily aggregation (date range > 1 day)
  const isDailyAggregation = data ? (() => {
    const startDateObj = new Date(data.startDate);
    const endDateObj = new Date(data.endDate);
    const daysDiff = Math.abs((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff > 1;
  })() : false;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div
        className={`bg-white shadow-lg transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'w-80' : 'w-0'
        }`}
        style={{ height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 40 }}
      >
        <div className={`${sidebarOpen ? 'p-6' : 'hidden'} space-y-6 h-full overflow-y-auto`}>
          {/* Sidebar Toggle Button and Quick Date Buttons */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => handleDateRangeChange('today')}
                className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => handleDateRangeChange('yesterday')}
                className="flex-1 px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Yesterday
              </button>
            </div>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-md transition-colors ml-2"
              aria-label="Collapse sidebar"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Date Range Selector */}
          <div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Date Range
                </label>
                <DateRangePicker
                  startDate={startDate}
                  endDate={endDate}
                  onDateRangeChange={(start, end) => {
                    setStartDate(start);
                    setEndDate(end);
                    fetchData(start, end);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          {!loading && !error && data && (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Total Shipments
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {data.totals.totalShipments.toLocaleString()}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {format(new Date(data.startDate), 'EEE MM/dd')} to {format(new Date(data.endDate), 'EEE MM/dd')}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Active Users
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {data.users.length}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Main Content Area */}
      <div 
        className="flex-1 flex flex-col min-h-screen overflow-y-auto"
        style={{ marginLeft: sidebarOpen ? '320px' : '48px', transition: 'margin-left 300ms ease-in-out' }}
      >
        {/* Sidebar Toggle Stripe (when sidebar is closed) */}
        {!sidebarOpen && (
          <div
            className="fixed left-0 top-0 bottom-0 w-12 bg-white shadow-lg z-40 flex items-start justify-center pt-4"
            style={{ height: '100vh' }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-3 hover:bg-gray-100 transition-colors rounded-md"
              aria-label="Expand menu"
            >
              <svg
                className="w-6 h-6 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 p-6">
          {/* User Toggle Controls - Moved to top of main section */}
          {!loading && !error && data && data.users.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">Show/Hide Users</h3>
                <button
                  onClick={toggleAllUsers}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  {visibleUsers.size === userNames.length ? 'Hide All' : 'Show All'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                {userNames.map((userName) => (
                  <label
                    key={userName}
                    className="flex items-center cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={visibleUsers.has(userName)}
                      onChange={() => toggleUser(userName)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span
                      className="ml-2 text-sm font-medium flex items-center"
                      style={{
                        color: visibleUsers.has(userName) ? userColorMap[userName] : '#9ca3af',
                        opacity: visibleUsers.has(userName) ? 1 : 0.5,
                      }}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-full mr-2"
                        style={{ backgroundColor: userColorMap[userName] }}
                      />
                      {userName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading shipment data...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-medium">Error: {error}</p>
            </div>
          )}

          {/* Dashboard Content */}
          {!loading && !error && data && (
            <>
              {/* Chart and User Table Combined */}
              {chartData.length > 0 ? (
                <div className="bg-white rounded-lg shadow-md mb-6">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-gray-800">
                        {(() => {
                          // Determine if this is daily data (date range > 1 day)
                          const startDateObj = new Date(data.startDate);
                          const endDateObj = new Date(data.endDate);
                          const daysDiff = Math.abs((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));
                          return daysDiff > 1 
                            ? 'Shipments Per Day by User' 
                            : 'Shipments Per Hour by User';
                        })()}
                      </h2>
                      <button
                        onClick={() => setShowChart(!showChart)}
                        className="p-2 hover:bg-gray-100 rounded-md transition-colors"
                        aria-label="Toggle chart"
                      >
                        <svg
                          className={`w-5 h-5 text-gray-500 transform transition-transform ${showChart ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {showChart && (
                    <div className="px-6 pb-6">
                      <div className="h-[calc(100vh-300px)] min-h-[500px] mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis
                              dataKey="hour"
                              stroke="#6b7280"
                              tick={{ fill: '#6b7280', fontSize: 12 }}
                              angle={-45}
                              textAnchor="end"
                              height={80}
                              tickFormatter={(value) => {
                                try {
                                  const date = new Date(value);
                                  // Check if this is daily data (date range > 1 day)
                                  const startDateObj = data ? new Date(data.startDate) : null;
                                  const endDateObj = data ? new Date(data.endDate) : null;
                                  const isDaily = startDateObj && endDateObj && 
                                    Math.abs((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) > 1;
                                  
                                  if (isDaily) {
                                    return format(date, 'MM/dd EEE');
                                  } else {
                                    return format(date, 'HH:mm');
                                  }
                                } catch {
                                  return value;
                                }
                              }}
                            />
                            <YAxis 
                              stroke="#6b7280" 
                              tick={{ fill: '#6b7280', fontSize: 12 }}
                              label={{
                                value: (() => {
                                  // Check if this is daily data (date range > 1 day)
                                  const startDateObj = data ? new Date(data.startDate) : null;
                                  const endDateObj = data ? new Date(data.endDate) : null;
                                  const isDaily = startDateObj && endDateObj && 
                                    Math.abs((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) > 1;
                                  return isDaily ? 'Shipments per day' : 'Shipments per hour';
                                })(),
                                angle: -90,
                                position: 'insideLeft',
                                style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 12 }
                              }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#fff',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '12px',
                              }}
                              labelFormatter={(value) => {
                                try {
                                  const date = new Date(value);
                                  return format(date, 'MMM dd, yyyy HH:mm');
                                } catch {
                                  return value;
                                }
                              }}
                              formatter={(value: number, name: string) => [value, name]}
                            />
                            <Legend
                              wrapperStyle={{ display: 'none' }}
                              iconType="line"
                            />
                            {visibleUserNames.map((userName) => (
                              <Line
                                key={userName}
                                type="monotone"
                                dataKey={userName}
                                stroke={userColorMap[userName]}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                activeDot={{ r: 6 }}
                                name={userName}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* User Summary Table */}
                      {data.users.length > 0 && (
                        <div className="border-t border-gray-200 pt-6">
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    User
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Total Shipments
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Percentage
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    {isDailyAggregation ? 'Shipments/Day' : 'Shipments/Hour'}
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Mins/Shipment
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {[...data.users]
                                  .sort((a, b) => a.userName.localeCompare(b.userName))
                                  .filter((user) => visibleUsers.has(user.userName))
                                  .map((user) => {
                                    const percentage = visibleUsersTotal > 0
                                      ? ((user.totalShipments / visibleUsersTotal) * 100).toFixed(1)
                                      : '0';
                                    const rate = isDailyAggregation 
                                      ? (user.shipmentsPerDay || 0)
                                      : (user.shipmentsPerHour || 0);
                                    const minsPerShipment = user.minutesPerShipment || 0;
                                    return (
                                      <tr key={user.userId}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                          {user.userName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {user.totalShipments.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                          {percentage}%
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {rate.toFixed(1)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                          {minsPerShipment.toFixed(1)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-600 text-lg">No shipment data available for the selected date range.</p>
              </div>
            )}

              {/* Raw Data Section */}
              {data.rawShipments && data.rawShipments.length > 0 && (
                <div className="bg-white rounded-lg shadow-md">
                <button
                  onClick={() => setShowRawData(!showRawData)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg"
                >
                  <h2 className="text-lg font-semibold text-gray-800">
                    Raw Shipment Data ({data.rawShipments.length.toLocaleString()} shipments)
                  </h2>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform ${showRawData ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showRawData && (
                  <div className="px-6 pb-6">
                    <div className="mt-4 overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg bg-gray-900 p-4">
                      <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-words">
                        {JSON.stringify(data.rawShipments, null, 2)}
                      </pre>
                    </div>
                    <div className="mt-4 text-sm text-gray-500">
                      <p>Showing raw JSON for all {data.rawShipments.length.toLocaleString()} shipments for the selected date range.</p>
                    </div>
                  </div>
                )}
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


