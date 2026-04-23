'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { Student } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getOverallDefaulters, getSubjectDefaulters, getDateRangeDefaulters, getLectures } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';

export default function DefaultersPage() {
  const [threshold, setThreshold] = useState(75);
  const [activeTab, setActiveTab] = useState('overall');
  const [defaulters, setDefaulters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lectures, setLectures] = useState<any[]>([]);

  // State for subject tab
  const [selectedSubject, setSelectedSubject] = useState('');

  // State for date range tab
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  useEffect(() => {
    getLectures().then(data => {
      const uniqueSubjects = [...new Set(data.map(l => l.subject))];
      setLectures(uniqueSubjects.map(s => ({subject: s})));
    });
  }, []);

  useEffect(() => {
    async function fetchDefaulters() {
      setLoading(true);
      try {
        let data;
        if (activeTab === 'overall') {
          data = await getOverallDefaulters(threshold);
        } else if (activeTab === 'subject' && selectedSubject) {
          data = await getSubjectDefaulters(selectedSubject, threshold);
        } else if (activeTab === 'date_range' && startDate && endDate) {
          data = await getDateRangeDefaulters(startDate, endDate, threshold);
        }
        if (data) {
          setDefaulters(data.defaulters);
        }
      } catch (error) {
        console.error(`Failed to fetch ${activeTab} defaulters:`, error);
        setDefaulters([]);
      } finally {
        setLoading(false);
      }
    }
    fetchDefaulters();
  }, [activeTab, threshold, selectedSubject, startDate, endDate]);

  const handleThresholdChange = (value: number[]) => {
    setThreshold(value[0]);
  };

  return (
    <>
      <PageHeader
        title="Defaulters"
        description="Identify students with attendance below the required threshold."
      />

      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="space-y-2">
            <Label htmlFor="threshold">Attendance Threshold: {threshold}%</Label>
            <Slider
              id="threshold"
              min={0}
              max={100}
              step={1}
              value={[threshold]}
              onValueChange={handleThresholdChange}
            />
        </div>
      </div>
      
       <Tabs defaultValue="overall" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="overall">Overall</TabsTrigger>
          <TabsTrigger value="subject">Subject-wise</TabsTrigger>
          <TabsTrigger value="date_range">Date-range</TabsTrigger>
        </TabsList>
        <TabsContent value="overall">
            <DefaulterTable defaulters={defaulters} loading={loading} />
        </TabsContent>
        <TabsContent value="subject">
            <div className='max-w-sm mb-4'>
                 <Select value={selectedSubject} onValueChange={setSelectedSubject}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {lectures.map((l) => (
                      <SelectItem key={l.subject} value={l.subject}>{l.subject}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
            </div>
            <DefaulterTable defaulters={defaulters} loading={loading} />
        </TabsContent>
        <TabsContent value="date_range">
           <div className="grid grid-cols-2 gap-4 mb-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="start-date-def">Start Date</Label>
                  <Input id="start-date-def" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date-def">End Date</Label>
                  <Input id="end-date-def" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
            <DefaulterTable defaulters={defaulters} loading={loading} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DefaulterTable({ defaulters, loading }: { defaulters: any[], loading: boolean }) {
    if (loading) {
      return (
        <div className="rounded-md border p-4 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )
    }
    
    if (!defaulters || defaulters.length === 0) {
      return <p className="text-muted-foreground p-4 text-center">No defaulters found for the selected criteria.</p>
    }

    return (
        <div className="rounded-md border">
            <Table>
            <TableHeader>
                <TableRow>
                <TableHead>Student Name</TableHead>
                <TableHead>Attendance %</TableHead>
                <TableHead>Present</TableHead>
                <TableHead>Absent</TableHead>
                <TableHead>Total</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {defaulters.map((student) => (
                <TableRow key={student.student_id}>
                    <TableCell className="font-medium">{student.student_name}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{student.attendance_percentage}%</Badge>
                    </TableCell>
                    <TableCell>{student.present_lectures}</TableCell>
                    <TableCell>{student.absent_lectures}</TableCell>
                    <TableCell>{student.total_lectures}</TableCell>
                </TableRow>
                ))}
            </TableBody>
            </Table>
        </div>
    );
}
