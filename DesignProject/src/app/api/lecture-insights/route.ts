import { NextResponse } from 'next/server';
import { generateLectureVoiceSummary } from '@/ai/flows/lecture-voice-summary';

const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const transcript = String(body?.transcript || '').trim();
    const lectureId = body?.lectureId ?? null;
    const cameraId = body?.cameraId ? String(body.cameraId) : undefined;
    const lectureName = body?.lectureName ? String(body.lectureName) : undefined;
    const audioBase64 = body?.audioBase64 ? String(body.audioBase64) : undefined;
    const audioMime = body?.audioMime ? String(body.audioMime) : undefined;

    if (!transcript) {
      return NextResponse.json({ message: 'Transcript is required.' }, { status: 400 });
    }

    const insights = await generateLectureVoiceSummary({
      transcript,
      cameraId,
      lectureName,
    });

    // Persist generated insights to backend SQLite table
    const saveResponse = await fetch(`${BACKEND_API_URL}/lecture-insights/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lecture_id: lectureId,
        lecture_name: lectureName,
        camera_id: cameraId,
        transcript: insights.transcript,
        lecture_summary: insights.summary,
        key_topics: insights.keyTopics || [],
        action_items: insights.actionItems || [],
        overall_emotion: insights.overallEmotion,
        emotion_timeline: insights.emotionTimeline || [],
        emotion_disclaimer: 'Emotion analysis is an AI estimate and should be treated as advisory only.',
        audio_base64: audioBase64,
        audio_mime: audioMime,
      }),
    });

    const savePayload = await saveResponse.json();
    if (!saveResponse.ok) {
      const message = savePayload?.detail || savePayload?.message || 'Failed to save insights in backend DB';
      throw new Error(message);
    }

    const insightId = Number(savePayload?.insight_id || 0);

    return NextResponse.json({
      insightId,
      summary: insights.summary,
      keyTopics: insights.keyTopics || [],
      actionItems: insights.actionItems || [],
      overallEmotion: insights.overallEmotion,
      emotionTimeline: insights.emotionTimeline || [],
      transcript: insights.transcript,
      audioDownloadUrl: `${BACKEND_API_URL}/lecture-insights/${insightId}/audio`,
      summaryDownloadUrl: `${BACKEND_API_URL}/lecture-insights/${insightId}/summary`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate lecture insights';
    return NextResponse.json({ message }, { status: 500 });
  }
}
