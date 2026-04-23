'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, RotateCcw, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getLectureInsights, getLectureInsightAudioUrl, getLectureInsightSummaryUrl } from '@/lib/api';
import type { LectureInsight } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

export default function LectureInsightsPage() {
  const [cameraId, setCameraId] = useState('');
  const [lecture, setLecture] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LectureInsight[]>([]);
  const { toast } = useToast();

  const resultCount = useMemo(() => items.length, [items]);

  const fetchInsights = async (options?: { silent?: boolean; unfiltered?: boolean }) => {
    setLoading(true);
    try {
      const unfiltered = Boolean(options?.unfiltered);
      const data = await getLectureInsights({
        cameraId: unfiltered ? undefined : cameraId.trim() || undefined,
        lecture: unfiltered ? undefined : lecture.trim() || undefined,
        startDate: unfiltered ? undefined : startDate || undefined,
        endDate: unfiltered ? undefined : endDate || undefined,
      });
      setItems(data.items || []);
    } catch (error: any) {
      setItems([]);
      if (!options?.silent) {
        toast({
          variant: 'destructive',
          title: 'Fetch Error',
          description: error?.message || 'Could not fetch lecture insights.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights({ silent: true, unfiltered: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetFilters = async () => {
    setCameraId('');
    setLecture('');
    setStartDate('');
    setEndDate('');
    await fetchInsights({ unfiltered: true });
  };

  return (
    <>
      <PageHeader
        title="Lecture Insights"
        description="Browse saved voice insights and re-download audio or summary files."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by camera, date, or lecture name/keyword.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Camera ID</p>
              <Input
                placeholder="e.g. C101"
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Lecture</p>
              <Input
                placeholder="Subject or keyword"
                value={lecture}
                onChange={(e) => setLecture(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Start Date</p>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">End Date</p>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fetchInsights()} disabled={loading}>
              <Search className="h-4 w-4" />
              {loading ? 'Applying...' : 'Apply Filters'}
            </Button>
            <Button variant="outline" onClick={resetFilters} disabled={loading}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Insights</CardTitle>
          <CardDescription>{resultCount} result(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Camera</TableHead>
                  <TableHead>Lecture</TableHead>
                  <TableHead>Emotion</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      Loading insights...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      No insights found. Try applying filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.insight_id}>
                      <TableCell>{item.insight_id}</TableCell>
                      <TableCell>{item.camera_id || 'N/A'}</TableCell>
                      <TableCell>{item.lecture_name || 'None'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.overall_emotion || 'N/A'}</Badge>
                      </TableCell>
                      <TableCell>{item.created_at}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(getLectureInsightAudioUrl(item.insight_id), '_blank')}
                          >
                            <Download className="h-4 w-4" />
                            Audio
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(getLectureInsightSummaryUrl(item.insight_id), '_blank')}
                          >
                            <Download className="h-4 w-4" />
                            Summary
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
