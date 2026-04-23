'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getStudentSummary } from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export function StudentProfile({ studentId }: { studentId: string | number }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSummary() {
      setLoading(true);
      try {
        const data = await getStudentSummary(studentId);
        setSummary(data);
      } catch (error) {
        console.error(`Failed to fetch summary for student ${studentId}`, error);
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, [studentId]);

  const subjectStats = useMemo(() => {
    if (!summary || !Array.isArray(summary.lectures)) return [];
    const map: Record<string, { subject: string; present: number; total: number }> = {};
    for (const lec of summary.lectures) {
      const subj = lec.subject || 'Unknown';
      if (!map[subj]) map[subj] = { subject: subj, present: 0, total: 0 };
      map[subj].total += 1;
      if (lec.present) map[subj].present += 1;
    }
    return Object.values(map).map((s) => ({
      ...s,
      absent: s.total - s.present,
      percentage: s.total ? Math.round((s.present / s.total) * 100) : 0,
    }));
  }, [summary]);

  if (loading) {
    return (
      <div className="py-4 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Overall Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-10 w-24 mb-4" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lecture-wise Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!summary) {
    return <p>Could not load student summary.</p>;
  }

  return (
    <div className="py-4 space-y-6">
      <div className="flex items-center gap-4">
        <Avatar className="h-20 w-20">
          <AvatarImage src={summary.avatarUrl} alt={summary.student_name} />
          <AvatarFallback className="text-2xl">{summary.student_name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-xl font-semibold">{summary.student_name}</h2>
          <p className="text-sm text-muted-foreground">
            {summary.standard} - {summary.division}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overall Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-4xl font-bold">{summary.attendance_percentage}%</span>
            <div className="text-right">
              <p>{summary.present_count} Present</p>
              <p>{summary.absent_count} Absent</p>
            </div>
          </div>
          <Progress value={summary.attendance_percentage} className="w-full" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Subject-wise Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {subjectStats.length === 0 ? (
            <p>No subject data available.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Present</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Percent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjectStats.map((s: any) => (
                  <TableRow key={s.subject}>
                    <TableCell>{s.subject}</TableCell>
                    <TableCell>{s.present}</TableCell>
                    <TableCell>{s.absent}</TableCell>
                    <TableCell>{s.total}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="w-12">{s.percentage}%</span>
                        <Progress value={s.percentage} className="flex-1" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Lecture-wise Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.lectures.map((lecture: any) => (
                <TableRow key={lecture.lecture_id}>
                  <TableCell>{lecture.subject}</TableCell>
                  <TableCell>{lecture.date}</TableCell>
                  <TableCell>
                    <Badge variant={lecture.present ? 'default' : 'destructive'}>
                      {lecture.present ? 'Present' : 'Absent'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
