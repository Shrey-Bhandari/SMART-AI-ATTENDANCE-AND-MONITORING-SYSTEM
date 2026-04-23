import { NextResponse } from 'next/server';
import { generateLectureVoiceSummary } from '@/ai/flows/lecture-voice-summary';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const transcript = String(body?.transcript || '').trim();
    const cameraId = body?.cameraId ? String(body.cameraId) : undefined;
    const lectureName = body?.lectureName ? String(body.lectureName) : undefined;

    if (transcript.length < 20) {
      return NextResponse.json(
        { message: 'Transcript is too short to summarize.' },
        { status: 400 }
      );
    }

    const summary = await generateLectureVoiceSummary({
      transcript,
      cameraId,
      lectureName,
    });

    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate lecture summary';
    return NextResponse.json({ message }, { status: 500 });
  }
}
