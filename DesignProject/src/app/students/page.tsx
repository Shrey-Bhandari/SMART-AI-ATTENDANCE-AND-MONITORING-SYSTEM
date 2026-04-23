'use client';

import { PageHeader } from '@/components/page-header';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
import { DataTable } from './components/data-table';
import { columns } from './components/columns';
import { useEffect, useState } from 'react';
import { getStudents } from '@/lib/api';
import type { Student } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStandard, setSelectedStandard] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');
  const [standards, setStandards] = useState<string[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);

  useEffect(() => {
    async function fetchStudents() {
      setLoading(true);
      try {
        const data = await getStudents();
        setStudents(data);
        setFilteredStudents(data);
        // derive standards & divisions from student data
        const stds = Array.from(new Set(data.map((s: Student) => s.standard).filter(Boolean)));
        const divs = Array.from(new Set(data.map((s: Student) => s.division).filter(Boolean)));
        setStandards(stds.sort());
        setDivisions(divs.sort());
      } catch (error) {
        console.error("Failed to fetch students", error);
      } finally {
        setLoading(false);
      }
    }
    fetchStudents();
  }, []);

  useEffect(() => {
    const results = students.filter((student) => {
      const matchesSearch =
        student.name.toLowerCase().includes(search.toLowerCase()) ||
        String(student.id).toLowerCase().includes(search.toLowerCase());
      const matchesStandard = selectedStandard ? student.standard === selectedStandard : true;
      const matchesDivision = selectedDivision ? student.division === selectedDivision : true;
      return matchesSearch && matchesStandard && matchesDivision;
    });
    setFilteredStudents(results);
  }, [search, students, selectedStandard, selectedDivision]);

  return (
    <>
      <PageHeader
        title="Students"
        description="Manage student records and view their attendance profiles."
      />
      <div className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search students by name or ID..."
              className="pl-8 sm:w-[300px]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Standard</Label>
            <Select value={selectedStandard} onValueChange={(v) => { setSelectedStandard(v === "__all" ? "" : v); setSelectedDivision(''); }}>
              <SelectTrigger>
                <SelectValue placeholder="All standards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {standards.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Division</Label>
            <Select value={selectedDivision} onValueChange={(v) => setSelectedDivision(v === "__all" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                { // show only divisions available for selected standard (if any)
                  (selectedStandard ? Array.from(new Set(students.filter(s => s.standard === selectedStandard).map(s => s.division))) : divisions)
                    .filter(Boolean)
                    .sort()
                    .map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))
                }
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
       {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <DataTable columns={columns} data={filteredStudents} />
      )}
    </>
  );
}
