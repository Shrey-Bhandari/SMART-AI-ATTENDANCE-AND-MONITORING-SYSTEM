'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Student } from '@/lib/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { StudentProfile } from './student-profile';

export const columns: ColumnDef<Student>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => {
      const student = row.original;
      return (
        <Sheet>
          <SheetTrigger asChild>
            <div className="flex items-center gap-3 cursor-pointer group">
              <Avatar>
                <AvatarImage src={student.avatarUrl} alt={student.name} />
                <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="font-medium group-hover:underline">{student.name}</span>
            </div>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Student Profile</SheetTitle>
              <SheetDescription>Detailed attendance summary for {student.name}.</SheetDescription>
            </SheetHeader>
            <StudentProfile studentId={student.id} />
          </SheetContent>
        </Sheet>
      );
    },
  },
  {
    accessorKey: 'standard',
    header: 'Standard',
  },
  {
    accessorKey: 'division',
    header: 'Division',
  },
  {
    accessorKey: 'overallAttendance',
    header: 'Overall Attendance',
    cell: ({ row }) => {
      const attendance = row.original.overallAttendance;
      const variant: 'default' | 'secondary' | 'destructive' =
        attendance > 85
          ? 'default'
          : attendance > 75
          ? 'secondary'
          : 'destructive';
      return <Badge variant={variant}>{attendance}%</Badge>;
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              View Profile
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
             <SheetHeader>
              <SheetTitle>Student Profile</SheetTitle>
              <SheetDescription>Detailed attendance summary for {row.original.name}.</SheetDescription>
            </SheetHeader>
            <StudentProfile studentId={row.original.id} />
          </SheetContent>
        </Sheet>
      );
    },
  },
];
