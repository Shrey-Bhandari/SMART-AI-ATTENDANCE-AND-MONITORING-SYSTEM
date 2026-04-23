'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Download, Eye } from 'lucide-react';
import type { Lecture } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatTimeToAmPm } from '@/lib/utils';
import { deleteLecture } from '@/lib/api';
import { Edit } from 'lucide-react';

export const columns: ColumnDef<Lecture>[] = [
  {
    accessorKey: 'subject',
    header: 'Subject',
  },
  {
    accessorKey: 'date',
    header: 'Date',
  },
  {
    accessorKey: 'time',
    header: 'Time',
    cell: ({ row }) => {
      const s = formatTimeToAmPm(row.original.startTime);
      const e = formatTimeToAmPm(row.original.endTime);
      return `${s}${s && e ? ' - ' : ''}${e}`;
    },
  },
  {
    accessorKey: 'standard',
    header: 'Standard',
    cell: ({ row }) => <Badge variant="outline">{row.original.standard}</Badge>
  },
  {
    accessorKey: 'division',
    header: 'Division',
  },
  {
    accessorKey: 'classRoom',
    header: 'Classroom',
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const lecture = row.original;
      if (lecture.cancelled) return <Badge variant="destructive">Cancelled</Badge>;
      return null;
    }
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const lecture = row.original;
      // determine if lecture can still be edited/cancelled (current time before lecture end and not already cancelled)
      const now = new Date();
      const lectureEnd = new Date(`${lecture.date}T${lecture.endTime}`);
      const editable = !lecture.cancelled && now < lectureEnd;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                const url = `/attendance?lecture=${lecture.id}`;
                // open attendance view in a new tab with lecture pre-selected
                window.open(url, '_blank');
              }}
            >
              <Eye /> View Attendance
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000');
                const url = `${apiUrl}/attendance/csv/${lecture.id}`;
                window.open(url, '_blank');
              }}
            >
              <Download /> Download CSV
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                // dispatch a custom event with the lecture to open edit dialog in parent
                window.dispatchEvent(new CustomEvent('openLectureEdit', { detail: lecture }));
              }}
              disabled={!editable}
            >
              <Edit /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const ok = window.confirm('Are you sure you want to cancel this lecture?');
                if (!ok) return;
                try {
                  await deleteLecture(lecture.id);
                  // notify parent to refresh list
                  window.dispatchEvent(new CustomEvent('lectureDeleted', { detail: lecture.id }));
                } catch (err) {
                  window.alert('Failed to cancel lecture: ' + (err instanceof Error ? err.message : String(err)));
                }
              }}
              disabled={!editable}
            >
              Cancel Lecture
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
