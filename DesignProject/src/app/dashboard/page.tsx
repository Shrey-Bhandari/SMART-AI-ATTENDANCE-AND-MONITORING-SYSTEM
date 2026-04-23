
'use client';

import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Users,
  Video,
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Pie, PieChart, Cell } from 'recharts';
import type { ChartConfig } from '@/components/ui/chart';
import DashboardSummary from './components/dashboard-summary';
import { useEffect, useState } from 'react';
import { getDashboardKPIs } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimeToAmPm } from '@/lib/utils';

const chartConfig = {
  present: {
    label: 'Present',
    color: 'hsl(var(--chart-1))',
  },
  absent: {
    label: 'Absent',
    color: 'hsl(var(--chart-2))',
  },
} satisfies ChartConfig;

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const kpiData = await getDashboardKPIs();
        setData(kpiData);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const kpiData = [
    { title: 'Total Cameras', value: data?.total_cameras ?? '...', icon: Video, color: 'text-blue-500' },
    { title: 'Active Cameras', value: data?.active_cameras ?? '...', icon: Activity, color: 'text-green-500' },
    { title: 'Lectures Running', value: data?.active_lectures ?? '...', icon: CheckCircle, color: 'text-indigo-500' },
    { title: 'Total Students', value: data?.total_students ?? '...', icon: Users, color: 'text-purple-500' },
  ];

  const chartData = [
    { status: 'Present', count: data?.today_attendance.present_count ?? 0, fill: 'var(--color-present)' },
    { status: 'Absent', count: data?.today_attendance.absent_count ?? 0, fill: 'var(--color-absent)' },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A quick overview of the system."
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiData.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
              <kpi.icon className={`h-4 w-4 text-muted-foreground ${kpi.color}`} />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold">{kpi.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Attendance Today ({data?.today_attendance.percentage.toFixed(1)}%)</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            {loading ? <Skeleton className="h-[250px] w-[250px] rounded-full" /> : (
              <ChartContainer
                config={chartConfig}
                className="mx-auto aspect-square h-[250px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={chartData}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={60}
                    strokeWidth={5}
                  >
                    {chartData.map((entry, index) => (
                       <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
           <CardHeader>
            <CardTitle>System Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <DashboardSummary />
            {data?.offline_cameras?.length > 0 && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Camera Offline</AlertTitle>
                <AlertDescription>
                  Camera(s) {data.offline_cameras.join(', ')} are currently offline. Please check connections.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Classrooms</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {loading ? (
                <Skeleton className="h-4 w-3/4" />
              ) : (
                (data?.classrooms || []).map((c: any) => (
                  <div key={c.camera_id} className="flex items-center justify-between">
                    <div className="font-medium">{c.camera_id}</div>
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${c.status === 'busy' ? 'bg-red-500' : 'bg-green-500'}`} />
                      <div className="text-sm text-muted-foreground">
                        {c.status.toUpperCase()}
                        {c.status === 'busy' && c.current_lecture ? (
                          <span>{` — ${c.current_lecture} (${formatTimeToAmPm(c.start_time) || '??:??'} - ${formatTimeToAmPm(c.end_time) || '??:??'})`}</span>
                        ) : c.current_lecture ? (
                          <span>{` — ${c.current_lecture}`}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
