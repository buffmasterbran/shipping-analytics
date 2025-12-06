'use client';

import { useState, useEffect } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ShipmentsHourlyResponse, HourlySeriesPoint } from '@/types/shipstation';

export default function Dashboard() {
  const [data, setData] = useState<ShipmentsHourlyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [showUserTable, setShowUserTable] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [visibleUsers, setVisibleUsers] = useState<Set<string>>(new Set());

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
  
  // Initialize visible users when data loads (all users visible by default)
  useEffect(() => {
    if (data && data.users.length > 0) {
      const newUserNames = sortedUsers.map(u => u.userName);
      setVisibleUsers(prev => {
        // Only update if the user list has actually changed
        const prevSorted = Array.from(prev).sort().join(',');
        const newSorted = newUserNames.join(',');
        if (prevSorted !== newSorted) {
          return new Set(newUserNames);
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Date Range Selector and Summary Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Date Range Selector */}
          <div className="bg-white rounded-lg shadow-md p-3">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => handleDateRangeChange('today')}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={() => handleDateRangeChange('yesterday')}
                  className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  Yesterday
                </button>
              </div>
              <div className="flex gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleCustomDateSubmit}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  Apply
                </button>
              </div>
              {data && (
                <div className="text-xs text-gray-500 mt-1">
                  Timezone: {data.timezone}
                </div>
              )}
            </div>
          </div>

          {/* Summary Cards - only show when data is loaded */}
          {!loading && !error && data && (
            <>
              <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Shipments
                </h3>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {data.totals.totalShipments.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  {data.startDate} to {data.endDate}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Active Users
                </h3>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {data.users.length}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  Users with shipments
                </p>
              </div>
            </>
          )}
        </div>

        {/* Global User Toggle Controls */}
        {!loading && !error && data && data.users.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">Show/Hide Users:</h3>
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
            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="bg-white rounded-lg shadow-md">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg"
                >
                  <h2 className="text-lg font-semibold text-gray-800">
                    Shipments Per Hour by User
                  </h2>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform ${showChart ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showChart && (
                  <div className="px-6 pb-6">
                    <div className="h-96">
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
                                return format(date, 'MM/dd HH:mm');
                              } catch {
                                return value;
                              }
                            }}
                          />
                          <YAxis stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} />
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
                            formatter={(value: number) => [value, 'Shipments']}
                          />
                          <Legend
                            wrapperStyle={{ paddingTop: '20px' }}
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
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-600 text-lg">No shipment data available for the selected date range.</p>
              </div>
            )}

            {/* User Summary Table */}
            {data.users.length > 0 && (
              <div className="bg-white rounded-lg shadow-md mb-6 mt-6">
                <button
                  onClick={() => setShowUserTable(!showUserTable)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg"
                >
                  <h2 className="text-lg font-semibold text-gray-800">
                    Shipments by User ({data.users.length} users)
                  </h2>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform ${showUserTable ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showUserTable && (
                  <div className="px-6 pb-6">
                    <div className="overflow-x-auto mt-4">
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

            {/* Raw Data Section */}
            {data.rawShipments && data.rawShipments.length > 0 && (
              <div className="bg-white rounded-lg shadow-md mt-6">
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
  );
}


