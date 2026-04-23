'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Circle } from 'lucide-react';
import { getCameraStatus, getCameras } from '@/lib/api';
import type { Camera } from '@/lib/types';

export default function SystemStatusPage() {
  const [cameraDetails, setCameraDetails] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatuses = async () => {
      setLoading(true);
      try {
        const { cameras } = await getCameras();
        const statuses = await Promise.all(
          cameras.map(async (camId) => {
            try {
              const status = await getCameraStatus(camId);
              return {
                id: camId,
                status: status.is_online ? 'Active' : 'Offline',
                currentLecture: status.current_lecture || 'N/A',
                attendanceActive: status.manual_attendance || status.auto_attendance_active,
                markedCount: status.marked_students_count,
              };
            } catch (e) {
              return {
                id: camId,
                status: 'Offline',
                currentLecture: 'Error',
                attendanceActive: false,
                markedCount: 0,
              };
            }
          })
        );
        setCameraDetails(statuses as Camera[]);
      } catch (error) {
        console.error("Failed to fetch camera statuses:", error);
        setCameraDetails([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStatuses();
    const intervalId = setInterval(fetchStatuses, 10000); // Refresh every 10 seconds
    return () => clearInterval(intervalId);
  }, []);

  return (
    <>
      <PageHeader
        title="System Status"
        description="Real-time status of all configured cameras."
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Camera ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Lecture</TableHead>
              <TableHead>Attendance Active</TableHead>
              <TableHead>Marked Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5} className="h-12 text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ))
            ) : (
              cameraDetails.map((camera) => (
                <TableRow key={camera.id}>
                  <TableCell className="font-medium">{camera.id}</TableCell>
                  <TableCell>
                    <Badge
                      variant={camera.status === 'Active' ? 'default' : 'destructive'}
                      className="gap-1"
                    >
                      <Circle className={cn(
                          "h-2 w-2",
                          camera.status === 'Active' ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"
                      )} />
                      {camera.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{camera.currentLecture}</TableCell>
                  <TableCell>
                    <Badge variant={camera.attendanceActive ? 'secondary' : 'outline'}>
                      {camera.attendanceActive ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>{camera.markedCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
