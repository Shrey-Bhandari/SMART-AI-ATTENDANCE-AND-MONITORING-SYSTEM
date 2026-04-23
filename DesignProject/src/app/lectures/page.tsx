'use client';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PlusCircle } from 'lucide-react';
import { LectureForm } from './components/lecture-form';
import { DataTable } from './components/data-table';
import { columns } from './components/columns';
import { useEffect, useState } from 'react';
import { getLectures } from '@/lib/api';
import type { Lecture } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function LecturesPage() {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLecture, setEditingLecture] = useState<Lecture | null>(null);

  async function fetchLectures() {
    setLoading(true);
    try {
      const data = await getLectures();
      setLectures(data);
    } catch (error) {
      console.error("Failed to fetch lectures", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLectures();
  }, []);

  useEffect(() => {
    function handleOpenEdit(e: Event) {
      // CustomEvent with lecture detail
      const ce = e as CustomEvent;
      setEditingLecture(ce.detail as Lecture);
      setDialogOpen(true);
    }

    function handleDeleted(e: Event) {
      fetchLectures();
    }

    window.addEventListener('openLectureEdit', handleOpenEdit as EventListener);
    window.addEventListener('lectureDeleted', handleDeleted as EventListener);
    return () => {
      window.removeEventListener('openLectureEdit', handleOpenEdit as EventListener);
      window.removeEventListener('lectureDeleted', handleDeleted as EventListener);
    };
  }, []);

  const handleLectureCreated = () => {
    setDialogOpen(false);
    fetchLectures(); // Refresh the list
  }

  const handleLectureUpdated = () => {
    setDialogOpen(false);
    setEditingLecture(null);
    fetchLectures();
  }

  return (
    <>
      <PageHeader title="Lectures" description="Manage scheduled lectures.">
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingLecture(null);
        }}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle />
              Create Lecture
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingLecture ? 'Edit Lecture' : 'Create New Lecture'}</DialogTitle>
              <DialogDescription>
                {editingLecture ? 'Update the lecture details.' : 'Fill in the details to schedule a new lecture.'}
              </DialogDescription>
            </DialogHeader>
            <LectureForm lecture={editingLecture ?? undefined} onLectureCreated={handleLectureCreated} onLectureUpdated={handleLectureUpdated} />
          </DialogContent>
        </Dialog>
      </PageHeader>
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <DataTable columns={columns} data={lectures} />
      )}
    </>
  );
}
