'use client';
import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { getLectures, getStudents } from '@/lib/api';
import type { Lecture, Student } from '@/lib/types';

export default function ReportsPage() {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  
  const [selectedLecture, setSelectedLecture] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);


  useEffect(() => {
    getLectures().then(setLectures);
    getStudents().then(setStudents);
  }, []);
  
  const handleDownload = (type: 'lecture' | 'student' | 'date_range') => {
    let url = `${process.env.NEXT_PUBLIC_API_URL}`;
    switch(type) {
      case 'lecture':
        if(!selectedLecture) return;
        url += `/attendance/csv/${selectedLecture}`;
        break;
      case 'student':
        if(!selectedStudent) return;
        url += `/attendance/student/${selectedStudent}/csv_summary`; // Assuming this endpoint exists
        break;
      case 'date_range':
        if(!startDate || !endDate) return;
        url += `/attendance/csv_range?start=${startDate}&end=${endDate}`; // Assuming this endpoint exists
        break;
    }
     window.open(url, '_blank');
  };


  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate and download detailed attendance reports."
      />
      <Tabs defaultValue="lecture">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="lecture">Lecture Report</TabsTrigger>
          <TabsTrigger value="student">Student Report</TabsTrigger>
          <TabsTrigger value="date_range">Date Range Report</TabsTrigger>
        </TabsList>

        <TabsContent value="lecture">
          <Card>
            <CardHeader>
              <CardTitle>Lecture Report</CardTitle>
              <CardDescription>
                Select a lecture to generate its attendance report.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select Lecture</Label>
                <Select value={selectedLecture} onValueChange={setSelectedLecture}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a lecture" />
                  </SelectTrigger>
                  <SelectContent>
                    {lectures.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.subject} - {l.date} ({l.startTime})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => handleDownload('lecture')} disabled={!selectedLecture}><Download/> Export CSV</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student">
          <Card>
            <CardHeader>
              <CardTitle>Student Report</CardTitle>
              <CardDescription>
                Select a student to generate their full attendance summary.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select Student</Label>
                <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a student" />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} ({s.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => handleDownload('student')} disabled={!selectedStudent}><Download/> Export CSV</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="date_range">
          <Card>
            <CardHeader>
              <CardTitle>Date Range Report</CardTitle>
              <CardDescription>
                Generate a combined attendance summary for a specific period.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <Button onClick={() => handleDownload('date_range')} disabled={!startDate || !endDate}><Download/> Export CSV</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
