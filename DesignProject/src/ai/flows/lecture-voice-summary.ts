'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const LectureVoiceSummaryInputSchema = z.object({
  transcript: z.string().describe('Full transcript captured from lecture audio.'),
  cameraId: z.string().optional(),
  lectureName: z.string().optional(),
});

export type LectureVoiceSummaryInput = z.infer<typeof LectureVoiceSummaryInputSchema>;

const LectureVoiceSummaryOutputSchema = z.object({
  summary: z.string().describe('Concise lecture summary.'),
  keyTopics: z.array(z.string()).describe('Main key topics from the lecture.'),
  actionItems: z.array(z.string()).describe('Optional follow-up action items for students.'),
  overallEmotion: z.string().describe('Overall teaching emotion and tone.'),
  emotionTimeline: z.array(z.string()).describe('Short time-based emotion segments.'),
  transcript: z.string().describe('Cleaned transcript text used for the summary.'),
});

export type LectureVoiceSummaryOutput = z.infer<typeof LectureVoiceSummaryOutputSchema>;

export async function generateLectureVoiceSummary(
  input: LectureVoiceSummaryInput
): Promise<LectureVoiceSummaryOutput> {
  return lectureVoiceSummaryFlow(input);
}

const lectureVoiceSummaryPrompt = ai.definePrompt({
  name: 'lectureVoiceSummaryPrompt',
  input: { schema: LectureVoiceSummaryInputSchema },
  output: { schema: LectureVoiceSummaryOutputSchema },
  prompt: `You are an academic assistant that summarizes lecture transcripts.

Camera ID: {{{cameraId}}}
Lecture Name: {{{lectureName}}}

Transcript:
{{{transcript}}}

Instructions:
- If transcript has only counting/noise/non-lecture content, clearly mention that in the summary.
- Write a concise summary in 80-160 words.
- Extract 3-8 key topics in clear bullet-friendly text, or return [] if none.
- Add up to 5 practical action items for students, or return [] when not relevant.
- Infer the overall teacher emotion in one short phrase.
- Create 2-6 emotion timeline entries in format "00:00-00:03: Calm (70%)". Use estimated ranges.
- Return a cleaned transcript that preserves meaning.
- Keep factual and avoid inventing details not present in the transcript.
`,
});

const lectureVoiceSummaryFlow = ai.defineFlow(
  {
    name: 'lectureVoiceSummaryFlow',
    inputSchema: LectureVoiceSummaryInputSchema,
    outputSchema: LectureVoiceSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await lectureVoiceSummaryPrompt(input);
    return output!;
  }
);
