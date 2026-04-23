'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Play,
  RefreshCw,
  Square,
  LoaderCircle,
  Video,
  Mic,
  Sparkles,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getCameras, getCameraStatus, startAttendance, stopAttendance, disableAutoAttendance } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

type LectureInsightsResponse = {
  insightId: number;
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  overallEmotion: string;
  emotionTimeline: string[];
  transcript: string;
  audioDownloadUrl?: string;
  summaryDownloadUrl?: string;
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function LiveCameraView() {
  const [cameras, setCameras] = useState<string[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cameraStatus, setCameraStatus] = useState<any>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isTogglingAttendance, setIsTogglingAttendance] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [transcriptText, setTranscriptText] = useState('');
  const [insights, setInsights] = useState<LectureInsightsResponse | null>(null);
  const { toast } = useToast();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordingActiveRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    async function fetchCameras() {
      try {
        const data = await getCameras();
        setCameras(data.cameras);
        if (data.cameras.length > 0) {
          setSelectedCamera(data.cameras[0]);
        }
      } catch (error) {
        console.error("Failed to fetch cameras:", error);
      }
    }
    fetchCameras();
  }, []);

  useEffect(() => {
    if (!selectedCamera) return;

    const fetchStatus = async () => {
      setIsLoadingStatus(true);
      try {
        const status = await getCameraStatus(selectedCamera);
        setCameraStatus(status);
      } catch (error) {
        console.error(`Failed to fetch status for camera ${selectedCamera}:`, error);
        setCameraStatus(null);
      } finally {
        setIsLoadingStatus(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Refresh status every 5 seconds

    return () => clearInterval(interval);
  }, [selectedCamera]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  const refreshStatus = async () => {
    if (!selectedCamera) return;
    setIsLoadingStatus(true);
    try {
      const status = await getCameraStatus(selectedCamera);
      setCameraStatus(status);
    } catch (error) {
      console.error(`Failed to fetch status for camera ${selectedCamera}:`, error);
      setCameraStatus(null);
      toast({
        variant: 'destructive',
        title: 'Status Error',
        description: 'Could not refresh camera status.',
      });
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const createSpeechRecognition = () => {
    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) return null;

    const recognition = new SpeechRecognitionApi();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
  };

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const startTranscriptCapture = () => {
    const recognition = createSpeechRecognition();
    if (!recognition) return;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          finalChunk += `${event.results[i][0]?.transcript || ''} `;
        }
      }
      if (finalChunk.trim()) {
        setTranscriptText((prev) => `${prev} ${finalChunk}`.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      if (recordingActiveRef.current) {
        try {
          recognition.start();
        } catch {
          // noop
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopTranscriptCapture = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(URL.createObjectURL(blob));
      };

      mediaRecorderRef.current = recorder;
      setTranscriptText('');
      setInsights(null);
      setAudioBlob(null);
      setRecordingSeconds(0);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl('');
      }

      recorder.start(1000);
      recordingActiveRef.current = true;
      startTranscriptCapture();
      setIsRecording(true);

      toast({
        title: 'Recording Started',
        description: 'Teacher voice recording is in progress.',
      });
    } catch (error: any) {
      recordingActiveRef.current = false;
      toast({
        variant: 'destructive',
        title: 'Microphone Error',
        description: error?.message || 'Could not start audio recording.',
      });
      setIsRecording(false);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopTranscriptCapture();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    recordingActiveRef.current = false;
    setIsRecording(false);
    toast({ title: 'Recording Stopped', description: 'Audio preview is ready.' });
  };

  const handleGenerateInsights = async () => {
    if (!audioBlob) return;

    setIsGeneratingInsights(true);
    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const transcript = transcriptText.trim() || 'No clear speech transcript captured from the recording.';
      const response = await fetch('/api/lecture-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          lectureId: cameraStatus?.current_lecture_id ?? null,
          cameraId: selectedCamera,
          lectureName: cameraStatus?.current_lecture,
          audioBase64,
          audioMime: audioBlob.type || 'audio/webm',
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to generate insights');
      }

      setInsights(payload as LectureInsightsResponse);
      toast({
        title: 'Insights Ready',
        description: 'Lecture insights generated and saved.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Insights Error',
        description: error?.message || 'Could not generate lecture insights.',
      });
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || '');
        const b64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(b64);
      };
      reader.onerror = () => reject(new Error('Failed to read audio data.'));
      reader.readAsDataURL(blob);
    });
  };

  const handleDownloadAudio = () => {
    if (insights?.audioDownloadUrl) {
      window.open(insights.audioDownloadUrl, '_blank');
      return;
    }
    if (!audioBlob) return;
    const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
    downloadBlob(audioBlob, `lecture-audio-${selectedCamera || 'camera'}.${ext}`);
  };

  const handleDownloadSummary = () => {
    if (insights?.summaryDownloadUrl) {
      window.open(insights.summaryDownloadUrl, '_blank');
      return;
    }
    if (!insights) return;
    const content = [
      'Lecture Summary',
      insights.summary,
      '',
      'Key Topics',
      insights.keyTopics.length ? insights.keyTopics.join('\n') : 'N/A',
      '',
      'Action Items',
      insights.actionItems.length ? insights.actionItems.join('\n') : 'N/A',
      '',
      'Overall Emotion',
      insights.overallEmotion || 'N/A',
      '',
      'Emotion Timeline',
      insights.emotionTimeline.length ? insights.emotionTimeline.join('\n') : 'N/A',
      '',
      'Transcript',
      insights.transcript || 'N/A',
    ].join('\n');

    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `lecture-summary-${selectedCamera || 'camera'}.txt`);
  };

  const handleResetInsights = () => {
    try {
      stopTranscriptCapture();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    } catch {
      // noop
    }
    recordingActiveRef.current = false;
    setIsRecording(false);
    setIsGeneratingInsights(false);
    setRecordingSeconds(0);
    setTranscriptText('');
    setInsights(null);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl('');
    }
  };


  const handleToggleAttendance = async () => {
    if (!selectedCamera || !cameraStatus) return;
    const isManualActive = Boolean(cameraStatus.manual_attendance);
    const isAutoActive = Boolean(cameraStatus.auto_attendance_active);

    setIsTogglingAttendance(true);

    try {
      // If auto is running (and manual is not), call disableAutoAttendance
      if (isAutoActive && !isManualActive) {
        const result = await disableAutoAttendance(selectedCamera);
        toast({ title: 'Automatic attendance', description: result.message });
        // update UI
        setCameraStatus((prev:any) => ({ ...prev, auto_attendance_active: false }));
      } else {
        const isStarting = !isManualActive;
        const action = isStarting ? startAttendance : stopAttendance;
        const result = await action(selectedCamera);

        // Optimistically update UI
        setCameraStatus((prev:any) => ({ ...prev, manual_attendance: isStarting }));

        toast({
          title: `Attendance ${isStarting ? 'Started' : 'Stopped'}`,
          description: result.message,
        });

        // Fetch status again for consistency
        const status = await getCameraStatus(selectedCamera);
        setCameraStatus(status);
      }
    } catch(error: any) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || `Could not toggle attendance.`,
      });
    } finally {
      setIsTogglingAttendance(false);
    }
  };
  
  const isAttendanceRunning = cameraStatus?.manual_attendance || cameraStatus?.auto_attendance_active;

  return (
    <Tabs value={selectedCamera} onValueChange={setSelectedCamera}>
      <TabsList>
        {cameras.map((cam) => (
          <TabsTrigger key={cam} value={cam}>
            {cam}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {selectedCamera ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
              <img
                src={`${API_URL}/video/${selectedCamera}`}
                alt={`Live feed from ${selectedCamera}`}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
             <div className="aspect-video w-full flex flex-col items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                <Video className="w-16 h-16" />
                <p className="mt-4 text-lg font-semibold">No Camera Selected</p>
                <p>Select a camera to view its live feed.</p>
            </div>
          )}
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Information Panel</CardTitle>
              <CardDescription>
                Details for Camera: {selectedCamera}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingStatus ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : cameraStatus ? (
                <div className="space-y-2 text-sm">
                  <p><strong>Lecture:</strong> {cameraStatus.current_lecture}</p>
                  <div className="flex items-center gap-2">
                    <strong>Status:</strong>
                    <span className="ml-2">
                      <Badge variant={isAttendanceRunning ? 'default' : 'outline'}>
                        {cameraStatus.manual_attendance ? 'Manual On' : cameraStatus.auto_attendance_active ? 'Auto On' : 'Inactive'}
                      </Badge>
                    </span>
                  </div>
                  <p><strong>Window:</strong> {cameraStatus.attendance_window_start || 'N/A'} - {cameraStatus.attendance_window_end || 'N/A'}</p>
                  <p><strong>Marked:</strong> {cameraStatus.marked_students_count || 0} students</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Could not load camera status.</p>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={handleToggleAttendance} disabled={isTogglingAttendance || isLoadingStatus}>
                  {isTogglingAttendance ? <LoaderCircle className="animate-spin" /> : (isAttendanceRunning ? <Square /> : <Play />)}
                  <span>{isTogglingAttendance ? 'Please wait...' : (
                    cameraStatus?.manual_attendance ? 'Stop Manual' : (cameraStatus?.auto_attendance_active ? 'Stop Automatic' : 'Start Manual')
                  )}</span>
                </Button>
                <Button variant="ghost" size="icon" disabled={isTogglingAttendance} onClick={refreshStatus}>
                  <RefreshCw />
                </Button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold">Teacher Voice Insights</p>
                    <p className="text-sm text-muted-foreground">Record lecture audio, then generate transcript, summary, and emotion trends.</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`px-3 py-2 text-sm ${isRecording ? 'bg-slate-800 text-white border-slate-800' : ''}`}
                  >
                    {isRecording ? `Recording ${formatDuration(recordingSeconds)}` : 'Recorder Idle'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {!isRecording ? (
                    <Button onClick={handleStartRecording} variant="secondary" className="justify-start">
                      <Mic className="h-4 w-4" />
                      Start Recording
                    </Button>
                  ) : (
                    <Button onClick={handleStopRecording} variant="destructive" className="justify-start">
                      <Square className="h-4 w-4" />
                      Stop Recording
                    </Button>
                  )}
                  <Button
                    onClick={handleGenerateInsights}
                    disabled={!audioBlob || isRecording || isGeneratingInsights}
                    className="justify-start"
                  >
                    {isGeneratingInsights ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate Insights
                  </Button>
                </div>

                {insights && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button variant="outline" onClick={handleDownloadAudio} className="justify-start">
                      <Download className="h-4 w-4" />
                      Download Audio
                    </Button>
                    <Button variant="outline" onClick={handleDownloadSummary} className="justify-start">
                      <Download className="h-4 w-4" />
                      Download Summary
                    </Button>
                  </div>
                )}

                {insights && (
                  <p className="text-sm text-muted-foreground">Saved to DB with Insight ID: {insights.insightId}</p>
                )}

                {audioUrl && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Recorded Audio Preview</p>
                    <audio controls src={audioUrl} className="w-full" />
                  </div>
                )}

                {insights && (
                  <div className="space-y-3 rounded-md border p-4">
                    <div>
                      <p className="text-xl font-semibold">Lecture Summary</p>
                      <p className="text-sm text-muted-foreground mt-1">{insights.summary}</p>
                    </div>

                    <div>
                      <p className="font-semibold">Key Topics</p>
                      {insights.keyTopics.length > 0 ? (
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {insights.keyTopics.map((topic, idx) => (
                            <li key={`${idx}-${topic.slice(0, 8)}`}>{topic}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">N/A</p>
                      )}
                    </div>

                    <div>
                      <p className="font-semibold">Action Items</p>
                      {insights.actionItems.length > 0 ? (
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {insights.actionItems.map((item, idx) => (
                            <li key={`${idx}-${item.slice(0, 8)}`}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">N/A</p>
                      )}
                    </div>

                    <div>
                      <p className="font-semibold">Overall Emotion</p>
                      <p className="text-sm text-muted-foreground">{insights.overallEmotion || 'N/A'}</p>
                    </div>

                    <div>
                      <p className="font-semibold">Emotion Timeline</p>
                      {insights.emotionTimeline.length > 0 ? (
                        <ul className="list-none text-sm text-muted-foreground space-y-1">
                          {insights.emotionTimeline.map((segment, idx) => (
                            <li key={`${idx}-${segment.slice(0, 8)}`}>{segment}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">N/A</p>
                      )}
                    </div>

                    <div>
                      <p className="font-semibold">Transcript</p>
                      <p className="text-sm text-muted-foreground">{insights.transcript || 'N/A'}</p>
                    </div>

                    <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      Emotion analysis is an AI estimate and should be treated as advisory only.
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={handleResetInsights} disabled={isRecording || isGeneratingInsights}>
                    Reset Voice Insights
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Tabs>
  );
}
