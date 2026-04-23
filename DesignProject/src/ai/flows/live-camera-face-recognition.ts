'use server';

/**
 * @fileOverview Implements face recognition and attendance marking from a live camera feed.
 *
 * - liveCameraFaceRecognition - A function that processes the live camera feed, detects faces,
 *   recognizes students, and marks their attendance automatically.
 * - LiveCameraFaceRecognitionInput - The input type for the liveCameraFaceRecognition function.
 * - LiveCameraFaceRecognitionOutput - The return type for the liveCameraFaceRecognition function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const LiveCameraFaceRecognitionInputSchema = z.object({
  cameraId: z.string().describe('The ID of the camera feed to process.'),
  videoDataUri: z
    .string()
    .describe(
      'The live video feed as a data URI that must include a MIME type and use Base64 encoding. Expected format: \'data:<mimetype>;base64,<encoded_data>\'.'      
    ),
  lectureId: z.string().describe('The ID of the lecture for which to mark attendance.'),
});

export type LiveCameraFaceRecognitionInput = z.infer<
  typeof LiveCameraFaceRecognitionInputSchema
>;

const LiveCameraFaceRecognitionOutputSchema = z.object({
  attendanceMarked: z
    .number()
    .describe('The number of students whose attendance was successfully marked.'),
  report: z.string().describe('A summary report of the attendance marking process.'),
});

export type LiveCameraFaceRecognitionOutput = z.infer<
  typeof LiveCameraFaceRecognitionOutputSchema
>;

export async function liveCameraFaceRecognition(
  input: LiveCameraFaceRecognitionInput
): Promise<LiveCameraFaceRecognitionOutput> {
  return liveCameraFaceRecognitionFlow(input);
}

const faceRecognitionPrompt = ai.definePrompt({
  name: 'faceRecognitionPrompt',
  input: {schema: LiveCameraFaceRecognitionInputSchema},
  output: {schema: LiveCameraFaceRecognitionOutputSchema},
  prompt: `You are an AI attendance tracker. You are tracking attendance for lecture id {{lectureId}}.

  Analyze the video feed from camera {{cameraId}}. Identify the students present in the video feed using facial recognition. Mark their attendance in the system.

  Video Feed: {{media url=videoDataUri}}

  Output the number of students whose attendance was marked, and a summary report of the process.
  `,
});

const liveCameraFaceRecognitionFlow = ai.defineFlow(
  {
    name: 'liveCameraFaceRecognitionFlow',
    inputSchema: LiveCameraFaceRecognitionInputSchema,
    outputSchema: LiveCameraFaceRecognitionOutputSchema,
  },
  async input => {
    const {output} = await faceRecognitionPrompt(input);
    return output!;
  }
);
