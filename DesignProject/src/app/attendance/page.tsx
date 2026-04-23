'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { getLectures, getAttendanceForLecture, getAttendanceStats, markAttendance, unmarkAttendance } from '@/lib/api';
import { formatTimeToAmPm } from '@/lib/utils';
import type { Lecture, AttendanceRecord } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

const statCards = [
  { title: 'Total Students', key: 'total_students' },
  { title: 'Present', key: 'present_count' },
  { title: 'Absent', key: 'absent_count' },
  { title: 'Attendance %', key: 'attendance_percentage' },
];

export default function AttendancePage() {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [selectedLecture, setSelectedLecture] = useState<string>('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    async function fetchLectures() {
      try {
        const lecturesData = await getLectures();
        setLectures(lecturesData);
        // If URL has ?lecture=<id> use that as initial selection, else default to first
        let initialLecture: string | null = null;
        try {
          const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          initialLecture = params ? params.get('lecture') : null;
        } catch (e) {
          initialLecture = null;
        }

        if (initialLecture) {
          // if the lecture exists in fetched list, select it, otherwise fall back to first
          const exists = lecturesData.find((l) => String(l.id) === initialLecture);
          setSelectedLecture(exists ? initialLecture : String(lecturesData[0]?.id || ''));
        } else if (lecturesData.length > 0) {
          setSelectedLecture(String(lecturesData[0].id));
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to fetch lectures", error);
        setLoading(false);
      }
    }
    fetchLectures();
  }, []);

  useEffect(() => {
    if (!selectedLecture) return;

    async function fetchAttendanceData() {
      setLoading(true);
      try {
        const [recordsData, statsData] = await Promise.all([
          getAttendanceForLecture(selectedLecture),
          getAttendanceStats(selectedLecture),
        ]);
        setAttendanceRecords(recordsData.attendance);
        setStats(statsData);
      } catch (error) {
        console.error(`Failed to fetch attendance for lecture ${selectedLecture}`, error);
        setAttendanceRecords([]);
        setStats(null);
      } finally {
        setLoading(false);
      }
    }

    fetchAttendanceData();
  }, [selectedLecture]);
  
  const handleDownload = () => {
    if(!selectedLecture) return;
    const url = `${process.env.NEXT_PUBLIC_API_URL}/attendance/csv/${selectedLecture}`;
    window.open(url, '_blank');
  }

  const lecture = lectures.find((l) => String(l.id) === selectedLecture);

  return (
    <>
      <PageHeader
        title="Attendance View"
        description="Review attendance for specific lectures."
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { if(selectedLecture) { /* re-fetch logic */ } }}>
            <RefreshCw /> Refresh
          </Button>
          <Button onClick={handleDownload} disabled={!selectedLecture}>
            <Download /> Download CSV
          </Button>
          {!isEditing ? (
            <Button variant="default" onClick={() => setIsEditing(true)} disabled={!selectedLecture || !!(stats && stats.cancelled)}>
              Edit
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setIsEditing(false)}>
              Done
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="mb-6 max-w-sm">
        <Select value={selectedLecture} onValueChange={setSelectedLecture}>
          <SelectTrigger>
            <SelectValue placeholder="Select a lecture" />
          </SelectTrigger>
          <SelectContent>
            {lectures.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                    {l.subject} - {l.date} ({formatTimeToAmPm(l.startTime)})
                  </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? <StatSkeletons /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          {statCards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats ? (stats[card.key] + (card.key === 'attendance_percentage' ? '%' : '')) : '...'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Student Records for {lecture?.subject}</CardTitle>
        </CardHeader>
        <CardContent>
           {loading ? <TableSkeleton /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Marked Time</TableHead>
                  <TableHead>Camera ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceRecords.map((record, idx) => {
                  const key = `${record.studentId}`;
                  const checked = record.status === 'Present';
                  const isUpdating = !!updatingIds[key];
                  return (
                    <TableRow key={`${record.studentId}-${idx}`}>
                      <TableCell>{record.studentName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {record.status === 'Cancelled' ? (
                            <Badge variant="destructive">Cancelled</Badge>
                          ) : isEditing ? (
                            <>
                              <Checkbox
                                checked={checked}
                                disabled={isUpdating || !!(stats && stats.cancelled)}
                                onCheckedChange={async (val) => {
                                  if (!selectedLecture) return;
                                  setUpdatingIds((s) => ({ ...s, [key]: true }));
                                  try {
                                    if (val) {
                                      // mark
                                      const res = await markAttendance(selectedLecture, record.studentId, 'manual');
                                      // optimistic update
                                      setAttendanceRecords((prev) => prev.map(r => r.studentId === record.studentId ? ({ ...r, status: 'Present', markedTime: res.marked_at || new Date().toISOString(), cameraId: res.camera_id || 'manual' }) : r));
                                    } else {
                                      const res = await unmarkAttendance(selectedLecture, record.studentId);
                                      setAttendanceRecords((prev) => prev.map(r => r.studentId === record.studentId ? ({ ...r, status: 'Absent', markedTime: null, cameraId: null }) : r));
                                    }
                                  } catch (e) {
                                    console.error('Failed to update attendance', e);
                                  } finally {
                                    setUpdatingIds((s) => ({ ...s, [key]: false }));
                                  }
                                }}
                              />
                              <Badge variant={checked ? 'default' : 'destructive'}>
                                {checked ? 'Present' : 'Absent'}
                              </Badge>
                            </>
                          ) : (
                            <Badge variant={checked ? 'default' : 'destructive'}>
                              {checked ? 'Present' : 'Absent'}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{record.markedTime || 'N/A'}</TableCell>
                      <TableCell>{record.cameraId || 'N/A'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
           )}
        </CardContent>
      </Card>
    </>
  );
}

const StatSkeletons = () => (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
    {Array.from({ length: 4 }).map((_, i) => (
      <Card key={i}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-2/3" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-1/2" />
        </CardContent>
      </Card>
    ))}
  </div>
);

const TableSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-12 w-full" />
    <Skeleton className="h-12 w-full" />
    <Skeleton className="h-12 w-full" />
    <Skeleton className="h-12 w-full" />
  </div>
)
