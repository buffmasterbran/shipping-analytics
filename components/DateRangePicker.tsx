'use client';

import { useState, useRef, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isBefore, isAfter, isWithinInterval, startOfWeek, endOfWeek, subWeeks, startOfDay, endOfDay } from 'date-fns';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onDateRangeChange: (start: string, end: string) => void;
}

export default function DateRangePicker({ startDate, endDate, onDateRangeChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempStart, setTempStart] = useState<Date | null>(startDate ? new Date(startDate) : null);
  const [tempEnd, setTempEnd] = useState<Date | null>(endDate ? new Date(endDate) : null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [nextMonth, setNextMonth] = useState(addMonths(new Date(), 1));
  const pickerRef = useRef<HTMLDivElement>(null);

  // Update temp dates when props change
  useEffect(() => {
    if (startDate) setTempStart(new Date(startDate));
    if (endDate) setTempEnd(new Date(endDate));
  }, [startDate, endDate]);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleDateClick = (date: Date) => {
    if (!tempStart || (tempStart && tempEnd)) {
      // Start new selection
      setTempStart(date);
      setTempEnd(null);
    } else if (tempStart && !tempEnd) {
      // Complete selection
      if (isBefore(date, tempStart)) {
        // If clicked date is before start, swap them
        setTempEnd(tempStart);
        setTempStart(date);
      } else {
        setTempEnd(date);
      }
      // Auto-apply when both dates are selected
      const startStr = format(tempStart, 'yyyy-MM-dd');
      const endStr = format(date < tempStart ? tempStart : date, 'yyyy-MM-dd');
      onDateRangeChange(startStr, endStr);
      setIsOpen(false);
    }
  };

  const isInRange = (date: Date) => {
    if (!tempStart || !tempEnd) return false;
    return isWithinInterval(date, { start: tempStart, end: tempEnd });
  };

  const isStartDate = (date: Date) => tempStart && isSameDay(date, tempStart);
  const isEndDate = (date: Date) => tempEnd && isSameDay(date, tempEnd);

  const renderCalendar = (month: Date) => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const firstDayOfWeek = monthStart.getDay();
    
    const displayText = tempStart && tempEnd
      ? `${format(tempStart, 'MMM dd')} - ${format(tempEnd, 'MMM dd')}`
      : tempStart
      ? `${format(tempStart, 'MMM dd')} - Select end date`
      : 'Select date range';

    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              setCurrentMonth(subMonths(currentMonth, 1));
              setNextMonth(subMonths(nextMonth, 1));
            }}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="font-semibold text-sm">{format(month, 'MMMM yyyy')}</div>
          <button
            onClick={() => {
              setCurrentMonth(addMonths(currentMonth, 1));
              setNextMonth(addMonths(nextMonth, 1));
            }}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div key={i} className="text-xs text-gray-500 text-center py-1 font-medium">
              {day}
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-1">
          {Array(firstDayOfWeek).fill(null).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {days.map((day) => {
            const inRange = isInRange(day);
            const isStart = isStartDate(day);
            const isEnd = isEndDate(day);
            const isToday = isSameDay(day, new Date());
            
            return (
              <button
                key={day.toString()}
                onClick={() => handleDateClick(day)}
                className={`
                  aspect-square text-sm rounded-md transition-colors
                  ${isStart || isEnd 
                    ? 'bg-blue-600 text-white font-semibold' 
                    : inRange 
                    ? 'bg-blue-100 text-blue-900' 
                    : 'hover:bg-gray-100 text-gray-700'
                  }
                  ${isToday && !isStart && !isEnd ? 'border border-gray-300' : ''}
                `}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const displayText = tempStart && tempEnd
    ? `${format(tempStart, 'MMM dd')} - ${format(tempEnd, 'MMM dd')}`
    : tempStart
    ? `${format(tempStart, 'MMM dd')} - Select end date`
    : startDate && endDate
    ? `${format(new Date(startDate), 'MMM dd')} - ${format(new Date(endDate), 'MMM dd')}`
    : 'Select date range';

  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (isOpen && pickerRef.current) {
      const rect = pickerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left
      });
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {displayText}
      </button>
      
      {isOpen && position && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black bg-opacity-20"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden" style={{
            top: `${position.top}px`,
            left: `${Math.max(16, position.left)}px`,
            maxHeight: '90vh',
            overflowY: 'auto',
            minWidth: '600px'
          }}>
            <div className="flex">
              <div className="flex">
                {renderCalendar(currentMonth)}
                {renderCalendar(nextMonth)}
              </div>
              <div className="border-l border-gray-200 p-4 flex flex-col gap-2 min-w-[160px]">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Quick Select</div>
                <button
                  type="button"
                  onClick={() => {
                    // Use Eastern timezone for date calculations
                    const now = new Date();
                    const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const weekStart = startOfWeek(nyNow, { weekStartsOn: 1 }); // Monday
                    const weekEnd = endOfWeek(nyNow, { weekStartsOn: 1 }); // Sunday
                    const startStr = format(weekStart, 'yyyy-MM-dd');
                    const endStr = format(weekEnd, 'yyyy-MM-dd');
                    setTempStart(weekStart);
                    setTempEnd(weekEnd);
                    onDateRangeChange(startStr, endStr);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  This Week
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Use Eastern timezone for date calculations
                    const now = new Date();
                    const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const lastWeekStart = startOfWeek(subWeeks(nyNow, 1), { weekStartsOn: 1 });
                    const lastWeekEnd = endOfWeek(subWeeks(nyNow, 1), { weekStartsOn: 1 });
                    const startStr = format(lastWeekStart, 'yyyy-MM-dd');
                    const endStr = format(lastWeekEnd, 'yyyy-MM-dd');
                    setTempStart(lastWeekStart);
                    setTempEnd(lastWeekEnd);
                    onDateRangeChange(startStr, endStr);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Last Week
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Use Eastern timezone for date calculations
                    const now = new Date();
                    const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const monthStart = startOfMonth(nyNow);
                    const monthEnd = endOfMonth(nyNow);
                    const startStr = format(monthStart, 'yyyy-MM-dd');
                    const endStr = format(monthEnd, 'yyyy-MM-dd');
                    setTempStart(monthStart);
                    setTempEnd(monthEnd);
                    onDateRangeChange(startStr, endStr);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Use Eastern timezone for date calculations
                    const now = new Date();
                    const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const lastMonth = subMonths(nyNow, 1);
                    const monthStart = startOfMonth(lastMonth);
                    const monthEnd = endOfMonth(lastMonth);
                    const startStr = format(monthStart, 'yyyy-MM-dd');
                    const endStr = format(monthEnd, 'yyyy-MM-dd');
                    setTempStart(monthStart);
                    setTempEnd(monthEnd);
                    onDateRangeChange(startStr, endStr);
                    setIsOpen(false);
                  }}
                  className="px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Last Month
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setTempStart(startDate ? new Date(startDate) : null);
                  setTempEnd(endDate ? new Date(endDate) : null);
                }}
                className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              {tempStart && tempEnd && (
                <button
                  type="button"
                  onClick={() => {
                    const startStr = format(tempStart, 'yyyy-MM-dd');
                    const endStr = format(tempEnd, 'yyyy-MM-dd');
                    onDateRangeChange(startStr, endStr);
                    setIsOpen(false);
                  }}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

