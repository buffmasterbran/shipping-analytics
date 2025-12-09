'use client';

import { useState, useEffect } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ShipmentsHourlyResponse, HourlySeriesPoint, UserSummary } from '@/types/shipstation';
import DateRangePicker from '@/components/DateRangePicker';

/**
 * Determine packing time status based on average time and goal
 * Returns: 'AMAZING' | 'Ok' | 'NEEDS Improvement'
 * AMAZING: <= goal * 1.2 (20% buffer)
 * Ok: > goal * 1.2 but <= goal * 2
 * NEEDS Improvement: > goal * 2
 */
function getPackingTimeStatus(averageTimeMinutes: number | undefined, goalMinutes: number | undefined): 'AMAZING' | 'Ok' | 'NEEDS Improvement' | undefined {
  if (averageTimeMinutes === undefined || goalMinutes === undefined) {
    return undefined;
  }
  
  const amazingThreshold = goalMinutes * 1.2; // 20% increase for AMAZING
  
  if (averageTimeMinutes <= amazingThreshold) {
    return 'AMAZING';
  } else if (averageTimeMinutes <= goalMinutes * 2) {
    return 'Ok';
  } else {
    return 'NEEDS Improvement';
  }
}

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
  const [allUsers, setAllUsers] = useState<Array<{ userId: string | number; userName?: string; name?: string }>>([]);
  const [openBoxDropdown, setOpenBoxDropdown] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<{ userId: string; userName: string; boxSize: string } | null>(null);
  // Track manual inclusion/exclusion overrides for detail modal entries
  const [detailModalOverrides, setDetailModalOverrides] = useState<Map<number, boolean>>(new Map());
  // Persistent exclusions stored in localStorage: Map<`${userId}_${boxSize}`, Set<detailIndex>>
  const [persistentExclusions, setPersistentExclusions] = useState<Map<string, Set<number>>>(new Map());
  // Smart Analysis state (for detail modal)
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    suggestions: Array<{ index: number; action: 'exclude' | 'include'; reason: string; confidence: string }>;
    summary: string;
    patterns: string[];
  } | null>(null);
  
  // High-level Performance Analysis state
  const [analyzingPerformance, setAnalyzingPerformance] = useState(false);
  const [performanceAnalysis, setPerformanceAnalysis] = useState<{
    userComparison?: { topPerformers: string[]; needsImprovement: string[]; insights: string };
    trends?: { improving: string[]; declining: string[]; insights: string };
    boxSizeInsights?: Array<{ boxSize: string; status: string; users: string[]; insight: string }>;
    overallSummary?: string;
    recommendations?: string[];
  } | null>(null);
  
  // Fetch all users on page load (including inactive) to have complete user mapping
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('/api/users');
        if (response.ok) {
          const userData = await response.json();
          setAllUsers(userData.users || []);
          console.log(`Loaded ${userData.users?.length || 0} users on page load`);
        }
      } catch (error) {
        console.error('Failed to fetch users on page load:', error);
      }
    };
    fetchUsers();
  }, []);
  
  // Load exclusions from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('packingTimeExclusions');
      if (stored) {
        const parsed = JSON.parse(stored);
        const exclusionsMap = new Map<string, Set<number>>();
        Object.entries(parsed).forEach(([key, value]) => {
          exclusionsMap.set(key, new Set(value as number[]));
        });
        setPersistentExclusions(exclusionsMap);
      }
    } catch (error) {
      console.error('Failed to load exclusions from localStorage:', error);
    }
  }, []);
  
  // Save exclusions to localStorage whenever they change
  useEffect(() => {
    try {
      const toStore: Record<string, number[]> = {};
      persistentExclusions.forEach((indices, key) => {
        toStore[key] = Array.from(indices);
      });
      localStorage.setItem('packingTimeExclusions', JSON.stringify(toStore));
    } catch (error) {
      console.error('Failed to save exclusions to localStorage:', error);
    }
  }, [persistentExclusions]);
  
  // Load overrides from persistent exclusions when modal opens
  useEffect(() => {
    if (detailModal) {
      const exclusionKey = `${detailModal.userId}_${detailModal.boxSize}`;
      const excludedIndices = persistentExclusions.get(exclusionKey) || new Set<number>();
      const overrides = new Map<number, boolean>();
      excludedIndices.forEach(index => {
        overrides.set(index, false); // false means excluded
      });
      setDetailModalOverrides(overrides);
      // Reset analysis when modal changes
      setAnalysisResult(null);
    }
  }, [detailModal?.userId, detailModal?.boxSize, persistentExclusions]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside any dropdown
      // Don't close if clicking inside the expanded box sizes table or status buttons
      if (!target.closest('.box-dropdown-container') && 
          !target.closest('table.min-w-full') && // Don't close when clicking in the expanded table
          !target.closest('button[title="Click to see calculation details"]') && // Don't close when clicking status button
          !target.closest('.fixed.inset-0')) { // Don't close when modal is open
        setOpenBoxDropdown(null);
      }
    };

    if (openBoxDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openBoxDropdown]);

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
  const visibleUsersTotal = data
    ? data.users
        .filter(user => visibleUsers.has(user.userName))
        .reduce((sum, user) => sum + user.totalShipments, 0)
    : 0;

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
                  {visibleUsersTotal.toLocaleString()}
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
              {/* Smart Analysis Button */}
              <div className="mb-4 flex justify-end">
                <button
                  onClick={async () => {
                    setAnalyzingPerformance(true);
                    setPerformanceAnalysis(null);
                    try {
                      // Calculate previous period (same length as current period)
                      const startDateObj = new Date(startDate);
                      const endDateObj = new Date(endDate);
                      const daysDiff = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                      
                      // Fetch previous period data
                      const prevEndDate = format(subDays(startDateObj, 1), 'yyyy-MM-dd');
                      const prevStartDate = format(subDays(startDateObj, daysDiff), 'yyyy-MM-dd');
                      
                      let previousPeriodData = null;
                      try {
                        const prevResponse = await fetch(`/api/shipments/hourly?startDate=${prevStartDate}&endDate=${prevEndDate}`);
                        if (prevResponse.ok) {
                          const prevData = await prevResponse.json();
                          previousPeriodData = {
                            userSummaries: prevData.users,
                            startDate: prevStartDate,
                            endDate: prevEndDate,
                          };
                        }
                      } catch (err) {
                        console.log('Could not fetch previous period data:', err);
                      }
                      
                      // Filter out admin account "Brandegee Pierce" from analysis
                      const filteredUsers = data.users.filter(user => user.userName !== 'Brandegee Pierce');
                      const filteredPreviousPeriod = previousPeriodData ? {
                        ...previousPeriodData,
                        userSummaries: previousPeriodData.userSummaries.filter((user: UserSummary) => user.userName !== 'Brandegee Pierce'),
                      } : null;
                      
                      // Call analysis API
                      const response = await fetch('/api/analyze-performance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          userSummaries: filteredUsers,
                          startDate: data.startDate,
                          endDate: data.endDate,
                          previousPeriodData: filteredPreviousPeriod,
                        }),
                      });
                      
                      if (!response.ok) {
                        throw new Error('Analysis failed');
                      }
                      
                      const result = await response.json();
                      if (result.success && result.analysis) {
                        setPerformanceAnalysis(result.analysis);
                      } else {
                        throw new Error(result.error || 'Invalid response');
                      }
                    } catch (error) {
                      console.error('Performance analysis error:', error);
                      alert('Failed to analyze performance. Make sure OPENAI_API_KEY is configured.');
                    } finally {
                      setAnalyzingPerformance(false);
                    }
                  }}
                  disabled={analyzingPerformance || !data}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {analyzingPerformance ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Smart Analysis
                    </>
                  )}
                </button>
              </div>
              
              {/* Performance Analysis Results */}
              {performanceAnalysis && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-lg font-semibold text-blue-900">Performance Analysis</h3>
                    <button
                      onClick={() => setPerformanceAnalysis(null)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  {performanceAnalysis.overallSummary && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">Summary</h4>
                      <p className="text-sm text-blue-800">{performanceAnalysis.overallSummary}</p>
                    </div>
                  )}
                  
                  {performanceAnalysis.userComparison && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">User Performance</h4>
                      <p className="text-sm text-blue-800 mb-2">{performanceAnalysis.userComparison.insights}</p>
                      {performanceAnalysis.userComparison.topPerformers && performanceAnalysis.userComparison.topPerformers.length > 0 && (
                        <div className="text-sm text-green-700">
                          <span className="font-medium">Top Performers: </span>
                          {performanceAnalysis.userComparison.topPerformers.join(', ')}
                        </div>
                      )}
                      {performanceAnalysis.userComparison.needsImprovement && performanceAnalysis.userComparison.needsImprovement.length > 0 && (
                        <div className="text-sm text-red-700 mt-1">
                          <span className="font-medium">Needs Improvement: </span>
                          {performanceAnalysis.userComparison.needsImprovement.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {performanceAnalysis.trends && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">Trends</h4>
                      <p className="text-sm text-blue-800 mb-2">{performanceAnalysis.trends.insights}</p>
                      {performanceAnalysis.trends.improving && performanceAnalysis.trends.improving.length > 0 && (
                        <div className="text-sm text-green-700">
                          <span className="font-medium">Improving: </span>
                          {performanceAnalysis.trends.improving.join(', ')}
                        </div>
                      )}
                      {performanceAnalysis.trends.declining && performanceAnalysis.trends.declining.length > 0 && (
                        <div className="text-sm text-red-700 mt-1">
                          <span className="font-medium">Declining: </span>
                          {performanceAnalysis.trends.declining.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {performanceAnalysis.boxSizeInsights && performanceAnalysis.boxSizeInsights.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">Box Size Insights</h4>
                      <div className="space-y-2">
                        {performanceAnalysis.boxSizeInsights.map((insight, idx) => (
                          <div key={idx} className="text-sm bg-white rounded p-2 border border-blue-200">
                            <div className="font-medium text-blue-900">{insight.boxSize}</div>
                            <div className="text-blue-700 mt-1">{insight.insight}</div>
                            {insight.users && insight.users.length > 0 && (
                              <div className="text-xs text-blue-600 mt-1">Users: {insight.users.join(', ')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {performanceAnalysis.recommendations && performanceAnalysis.recommendations.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">Recommendations</h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-blue-800">
                        {performanceAnalysis.recommendations.map((rec, idx) => (
                          <li key={idx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              
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
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Box Sizes
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
                                    const boxSizes = user.boxSizeBreakdown || {};
                                    const boxSizeEntries = Object.entries(boxSizes).sort((a, b) => b[1] - a[1]); // Sort by count descending
                                    const totalBoxCount = Object.values(boxSizes).reduce((sum, count) => sum + count, 0);
                                    return (
                                      <>
                                        <tr key={user.userId} className="hover:bg-gray-50">
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
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {boxSizeEntries.length > 0 ? (
                                              <button
                                                onClick={() => setOpenBoxDropdown(openBoxDropdown === user.userId ? null : user.userId)}
                                                className="p-1 hover:bg-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors"
                                                title={`Box Sizes (${totalBoxCount})`}
                                              >
                                                <svg
                                                  className={`w-5 h-5 text-gray-600 transition-transform ${openBoxDropdown === user.userId ? 'rotate-180' : ''}`}
                                                  fill="none"
                                                  stroke="currentColor"
                                                  viewBox="0 0 24 24"
                                                >
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                              </button>
                                            ) : (
                                              <span className="text-gray-400">—</span>
                                            )}
                                          </td>
                                        </tr>
                                        {openBoxDropdown === user.userId && boxSizeEntries.length > 0 && (
                                          <tr className="bg-gray-50 box-dropdown-container" onClick={(e) => e.stopPropagation()}>
                                            <td colSpan={6} className="px-6 py-4">
                                              <div className="bg-white rounded-lg border border-gray-200 shadow-sm box-dropdown-container" onClick={(e) => e.stopPropagation()}>
                                                <table className="min-w-full divide-y divide-gray-200">
                                                  <thead className="bg-gray-50">
                                                    <tr>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Box Size
                                                      </th>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Count
                                                      </th>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Percentage
                                                      </th>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Avg Time
                                                      </th>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Goal
                                                      </th>
                                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Status
                                                      </th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="bg-white divide-y divide-gray-200">
                                                    {boxSizeEntries.map(([boxSize, count]) => {
                                                      const boxPercentage = totalBoxCount > 0 
                                                        ? ((count / totalBoxCount) * 100).toFixed(1) 
                                                        : '0';
                                                      const boxStats = user.boxSizeStats?.[boxSize];
                                                      
                                                      // Apply exclusions to recalculate average
                                                      const exclusionKey = `${user.userId}_${boxSize}`;
                                                      const excludedIndices = persistentExclusions.get(exclusionKey) || new Set<number>();
                                                      let avgTime = boxStats?.averageTimeMinutes;
                                                      
                                                      if (boxStats?.packingTimeDetails && excludedIndices.size > 0) {
                                                        const includedTimes = boxStats.packingTimeDetails
                                                          .map((detail, index) => {
                                                            const isExcluded = excludedIndices.has(index);
                                                            return isExcluded ? null : (detail.included ? detail.timeDifferenceMinutes : null);
                                                          })
                                                          .filter((time): time is number => time !== null);
                                                        
                                                        if (includedTimes.length > 0) {
                                                          avgTime = includedTimes.reduce((sum, time) => sum + time, 0) / includedTimes.length;
                                                        }
                                                      }
                                                      
                                                      const goal = boxStats?.goalMinutes;
                                                      const status = getPackingTimeStatus(avgTime, goal);
                                                      
                                                      return (
                                                        <tr key={boxSize} className="hover:bg-gray-50">
                                                          <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                                            {boxSize}
                                                          </td>
                                                          <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                                                            {count.toLocaleString()}
                                                          </td>
                                                          <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                                            {boxPercentage}%
                                                          </td>
                                                          <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                                                            {avgTime !== undefined ? `${avgTime.toFixed(1)} min` : '—'}
                                                          </td>
                                                          <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">
                                                            {goal !== undefined ? `${goal} min` : '—'}
                                                          </td>
                                                          <td className="px-4 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                            {status !== undefined ? (
                                                              <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  e.preventDefault();
                                                                  setDetailModal({ userId: user.userId, userName: user.userName, boxSize });
                                                                }}
                                                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${
                                                                  status === 'AMAZING'
                                                                    ? 'bg-green-100 text-green-800' 
                                                                    : status === 'Ok'
                                                                    ? 'bg-yellow-100 text-yellow-800'
                                                                    : 'bg-red-100 text-red-800'
                                                                }`}
                                                                title="Click to see calculation details"
                                                              >
                                                                {status === 'AMAZING' ? '✓ AMAZING' : status === 'Ok' ? '○ Ok' : '✗ NEEDS Improvement'}
                                                              </button>
                                                            ) : (
                                                              <span className="text-gray-400 text-xs">—</span>
                                                            )}
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </>
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

      {/* Detail Modal */}
      {detailModal && data && (() => {
        const user = data.users.find(u => u.userId === detailModal.userId);
        const boxStats = user?.boxSizeStats?.[detailModal.boxSize];
        const details = boxStats?.packingTimeDetails || [];
        
        // Sort details by time difference (biggest first)
        const sortedDetails = [...details].sort((a, b) => 
          (b.timeDifferenceMinutes || 0) - (a.timeDifferenceMinutes || 0)
        );
        
        // Calculate current average based on manual overrides
        // Map original index to sorted index for overrides
        const originalIndexMap = new Map<number, number>();
        sortedDetails.forEach((sortedDetail, sortedIndex) => {
          const originalIndex = details.findIndex(d => 
            d.currentTime === sortedDetail.currentTime && 
            d.previousTime === sortedDetail.previousTime
          );
          if (originalIndex !== -1) {
            originalIndexMap.set(sortedIndex, originalIndex);
          }
        });
        
        // Get persistent exclusions for this user/boxSize
        const exclusionKey = `${detailModal.userId}_${detailModal.boxSize}`;
        const excludedIndices = persistentExclusions.get(exclusionKey) || new Set<number>();
        
        const includedTimes = sortedDetails
          .map((detail, sortedIndex) => {
            const originalIndex = originalIndexMap.get(sortedIndex);
            if (originalIndex === undefined) return null;
            
            // Check if this index is excluded (either from persistent exclusions or modal overrides)
            const isExcludedPersistent = excludedIndices.has(originalIndex);
            const override = detailModalOverrides.get(originalIndex);
            
            // If there's a modal override, use it; otherwise check persistent exclusion; otherwise use original included status
            let isIncluded: boolean;
            if (override !== undefined) {
              isIncluded = override;
            } else if (isExcludedPersistent) {
              isIncluded = false;
            } else {
              isIncluded = detail.included;
            }
            
            return isIncluded ? detail.timeDifferenceMinutes : null;
          })
          .filter((time): time is number => time !== null);
        
        const recalculatedAverage = includedTimes.length > 0
          ? includedTimes.reduce((sum, time) => sum + time, 0) / includedTimes.length
          : undefined;
        
        // Reset overrides when modal closes or changes
        const handleModalClose = () => {
          setDetailModalOverrides(new Map());
          setDetailModal(null);
        };
        
        const toggleInclusion = (sortedIndex: number) => {
          const newOverrides = new Map(detailModalOverrides);
          const originalIndex = originalIndexMap.get(sortedIndex);
          if (originalIndex === undefined) return;
          
          const currentOverride = newOverrides.get(originalIndex);
          const originalIncluded = details[originalIndex]?.included ?? false;
          
          // If no override exists, toggle from original state
          // If override exists, toggle from override state
          const newValue = currentOverride !== undefined ? !currentOverride : !originalIncluded;
          newOverrides.set(originalIndex, newValue);
          setDetailModalOverrides(newOverrides);
          
          // Save to persistent exclusions
          const exclusionKey = `${detailModal.userId}_${detailModal.boxSize}`;
          const newExclusions = new Map(persistentExclusions);
          const excludedIndices = newExclusions.get(exclusionKey) || new Set<number>();
          
          if (newValue === false) {
            // Excluding this entry
            excludedIndices.add(originalIndex);
          } else {
            // Including this entry (remove from exclusions)
            excludedIndices.delete(originalIndex);
          }
          
          if (excludedIndices.size > 0) {
            newExclusions.set(exclusionKey, excludedIndices);
          } else {
            newExclusions.delete(exclusionKey);
          }
          
          setPersistentExclusions(newExclusions);
        };
        
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Packing Time Details
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {detailModal.userName} - {detailModal.boxSize}
                  </p>
                  {boxStats && (() => {
                    const displayAverage = recalculatedAverage !== undefined && (excludedIndices.size > 0 || detailModalOverrides.size > 0) 
                      ? recalculatedAverage 
                      : boxStats.averageTimeMinutes;
                    const displayStatus = getPackingTimeStatus(displayAverage, boxStats.goalMinutes);
                    
                    return (
                      <div className="text-sm text-gray-500 mt-1">
                        {recalculatedAverage !== undefined && (excludedIndices.size > 0 || detailModalOverrides.size > 0) ? (
                          <>
                            <p>
                              Original Average: {boxStats.averageTimeMinutes?.toFixed(1)} min | Goal: {boxStats.goalMinutes} min
                            </p>
                            <p className="font-medium mt-1">
                              Recalculated Average: {recalculatedAverage.toFixed(1)} min
                              {displayStatus && (
                                <span className={`ml-2 ${
                                  displayStatus === 'AMAZING' ? 'text-green-600' : 
                                  displayStatus === 'Ok' ? 'text-yellow-600' : 
                                  'text-red-600'
                                }`}>
                                  ({displayStatus})
                                </span>
                              )}
                            </p>
                          </>
                        ) : (
                          <p>
                            Average: {boxStats.averageTimeMinutes?.toFixed(1)} min | Goal: {boxStats.goalMinutes} min
                            {displayStatus && (
                              <span className={`ml-2 ${
                                displayStatus === 'AMAZING' ? 'text-green-600' : 
                                displayStatus === 'Ok' ? 'text-yellow-600' : 
                                'text-red-600'
                              }`}>
                                ({displayStatus})
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setAnalyzing(true);
                      setAnalysisResult(null);
                      try {
                        const response = await fetch('/api/analyze-packing-times', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            packingTimeDetails: details,
                            userName: detailModal.userName,
                            boxSize: detailModal.boxSize,
                            goalMinutes: boxStats?.goalMinutes,
                          }),
                        });
                        
                        if (!response.ok) {
                          throw new Error('Analysis failed');
                        }
                        
                        const result = await response.json();
                        if (result.success && result.analysis) {
                          setAnalysisResult(result.analysis);
                        } else {
                          throw new Error(result.error || 'Invalid response');
                        }
                      } catch (error) {
                        console.error('Analysis error:', error);
                        alert('Failed to analyze packing times. Make sure OPENAI_API_KEY is configured.');
                      } finally {
                        setAnalyzing(false);
                      }
                    }}
                    disabled={analyzing || details.length === 0}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {analyzing ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Smart Analysis
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleModalClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {details.length > 0 ? (
                  <div className="space-y-4">
                    {/* Analysis Results */}
                    {analysisResult && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-sm font-semibold text-blue-900">AI Analysis Results</h3>
                          <button
                            onClick={() => setAnalysisResult(null)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        {analysisResult.summary && (
                          <p className="text-sm text-blue-800 mb-3">{analysisResult.summary}</p>
                        )}
                        {analysisResult.patterns && analysisResult.patterns.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-blue-900 mb-1">Patterns Detected:</p>
                            <ul className="text-xs text-blue-700 list-disc list-inside">
                              {analysisResult.patterns.map((pattern, idx) => (
                                <li key={idx}>{pattern}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysisResult.suggestions && analysisResult.suggestions.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-blue-900 mb-2">Suggestions:</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                              {analysisResult.suggestions.map((suggestion, idx) => {
                                const originalIndex = originalIndexMap.get(
                                  sortedDetails.findIndex((d, i) => {
                                    const origIdx = originalIndexMap.get(i);
                                    return origIdx === suggestion.index;
                                  }) ?? -1
                                ) ?? suggestion.index;
                                
                                return (
                                  <div key={idx} className="text-xs bg-white rounded p-2 border border-blue-200">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">
                                        Entry {suggestion.index + 1}: {suggestion.action === 'exclude' ? 'Exclude' : 'Include'}
                                      </span>
                                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                                        suggestion.confidence === 'high' ? 'bg-green-100 text-green-800' :
                                        suggestion.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800'
                                      }`}>
                                        {suggestion.confidence}
                                      </span>
                                    </div>
                                    <p className="text-gray-600 mt-1">{suggestion.reason}</p>
                                    <button
                                      onClick={() => {
                                        const newOverrides = new Map(detailModalOverrides);
                                        newOverrides.set(originalIndex, suggestion.action === 'include');
                                        setDetailModalOverrides(newOverrides);
                                        
                                        // Also update persistent exclusions
                                        const exclusionKey = `${detailModal.userId}_${detailModal.boxSize}`;
                                        const newExclusions = new Map(persistentExclusions);
                                        const excludedIndices = newExclusions.get(exclusionKey) || new Set<number>();
                                        
                                        if (suggestion.action === 'exclude') {
                                          excludedIndices.add(originalIndex);
                                        } else {
                                          excludedIndices.delete(originalIndex);
                                        }
                                        
                                        if (excludedIndices.size > 0) {
                                          newExclusions.set(exclusionKey, excludedIndices);
                                        } else {
                                          newExclusions.delete(exclusionKey);
                                        }
                                        
                                        setPersistentExclusions(newExclusions);
                                      }}
                                      className="mt-1 text-xs text-blue-600 hover:text-blue-800 underline"
                                    >
                                      Apply suggestion
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="text-sm text-gray-600 mb-4">
                      Showing time differences between consecutive shipments. Times marked in <span className="text-green-600 font-medium">green</span> were included in the average calculation, times marked in <span className="text-red-600 font-medium">red</span> were excluded (likely breaks).
                      <br />
                      <span className="font-medium text-blue-600">Click any status badge to toggle inclusion/exclusion and recalculate the average.</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Previous Shipment
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Previous Order
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Current Shipment
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Current Order
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Time Difference
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {sortedDetails.map((detail, sortedIndex) => {
                            const originalIndex = originalIndexMap.get(sortedIndex) ?? sortedIndex;
                            return (
                            <tr key={`${detail.currentTime}-${detail.previousTime}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                {detail.previousBoxSize}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                {format(new Date(detail.previousTime), 'h:mm a')}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {detail.currentBoxSize}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                {format(new Date(detail.currentTime), 'h:mm a')}
                              </td>
                              <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${
                                (() => {
                                  const isExcludedPersistent = excludedIndices.has(originalIndex);
                                  const override = detailModalOverrides.get(originalIndex);
                                  let isIncluded: boolean;
                                  if (override !== undefined) {
                                    isIncluded = override;
                                  } else if (isExcludedPersistent) {
                                    isIncluded = false;
                                  } else {
                                    isIncluded = detail.included;
                                  }
                                  return isIncluded ? 'text-gray-900' : 'text-gray-400';
                                })()
                              }`}>
                                {detail.timeDifferenceMinutes.toFixed(2)} min
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <button
                                  onClick={() => toggleInclusion(sortedIndex)}
                                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${
                                    (() => {
                                      const isExcludedPersistent = excludedIndices.has(originalIndex);
                                      const override = detailModalOverrides.get(originalIndex);
                                      let isIncluded: boolean;
                                      if (override !== undefined) {
                                        isIncluded = override;
                                      } else if (isExcludedPersistent) {
                                        isIncluded = false;
                                      } else {
                                        isIncluded = detail.included;
                                      }
                                      return isIncluded 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-red-100 text-red-800';
                                    })()
                                  }`}
                                  title="Click to toggle inclusion/exclusion"
                                >
                                  {(() => {
                                    const isExcludedPersistent = excludedIndices.has(originalIndex);
                                    const override = detailModalOverrides.get(originalIndex);
                                    let isIncluded: boolean;
                                    if (override !== undefined) {
                                      isIncluded = override;
                                    } else if (isExcludedPersistent) {
                                      isIncluded = false;
                                    } else {
                                      isIncluded = detail.included;
                                    }
                                    return isIncluded ? 'Included' : 'Excluded';
                                  })()}
                                </button>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No packing time data available for this box size.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


