'use client';

import { useState, useEffect } from 'react';

export function DateTime() {
  const [date, setDate] = useState<Date | null>(null);

  useEffect(() => {
    setDate(new Date());
    const timer = setInterval(() => setDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (!date) {
    return <div className="h-10 w-48" />; // Placeholder for initial render
  }

  return (
    <div className="flex flex-col items-end">
      <div className="font-semibold text-lg">{formatTime(date)}</div>
      <div className="text-xs text-muted-foreground">{formatDate(date)}</div>
    </div>
  );
}
