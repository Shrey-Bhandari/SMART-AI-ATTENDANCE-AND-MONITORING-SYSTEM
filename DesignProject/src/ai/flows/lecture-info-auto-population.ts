'use server';

/**
 * @fileOverview Automatically populates lecture information based on the camera ID.
 *
 * This flow takes a camera ID as input and returns the corresponding lecture details,
 * including subject, standard, division, and time.
 *
 * @function populateLectureInfo - The main function to populate lecture information.
 * @typedef {PopulateLectureInfoInput} PopulateLectureInfoInput - Input type for the populateLectureInfo function.
 * @typedef {PopulateLectureInfoOutput} PopulateLectureInfoOutput - Output type for the populateLectureInfo function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PopulateLectureInfoInputSchema = z.object({
  cameraId: z.string().describe('The ID of the camera.'),
});
export type PopulateLectureInfoInput = z.infer<typeof PopulateLectureInfoInputSchema>;

const PopulateLectureInfoOutputSchema = z.object({
  subject: z.string().describe('The subject of the lecture.'),
  academicYear: z.string().describe('The academic year of the lecture.'),
  standard: z.string().describe('The standard of the lecture.'),
  division: z.string().describe('The division of the lecture.'),
  classRoom: z.string().describe('The classroom where lecture is held.'),
  date: z.string().describe('The date of the lecture.'),
  startTime: z.string().describe('The start time of the lecture.'),
  endTime: z.string().describe('The end time of the lecture.'),
});
export type PopulateLectureInfoOutput = z.infer<typeof PopulateLectureInfoOutputSchema>;

export async function populateLectureInfo(input: PopulateLectureInfoInput): Promise<PopulateLectureInfoOutput> {
  return populateLectureInfoFlow(input);
}

const populateLectureInfoPrompt = ai.definePrompt({
  name: 'populateLectureInfoPrompt',
  input: {schema: PopulateLectureInfoInputSchema},
  output: {schema: PopulateLectureInfoOutputSchema},
  prompt: `You are an AI assistant designed to fetch lecture information based on the provided camera ID.

  Given the camera ID: {{{cameraId}}}, return the lecture details, using the following structure:

  Subject: (Subject of the lecture)
  Academic Year: (Academic year of the lecture)
  Standard: (Standard of the lecture)
  Division: (Division of the lecture)
  Classroom: (Classroom of the lecture)
  Date: (Date of the lecture)
  Start Time: (Start time of the lecture)
  End Time: (End time of the lecture)

  Ensure that the information returned is accurate and corresponds to the provided camera ID.`,
});

const populateLectureInfoFlow = ai.defineFlow(
  {
    name: 'populateLectureInfoFlow',
    inputSchema: PopulateLectureInfoInputSchema,
    outputSchema: PopulateLectureInfoOutputSchema,
  },
  async input => {
    // In a real implementation, you would likely fetch lecture data from a database
    // based on the camera ID.  For this example, we'll return dummy data.
    const {output} = await populateLectureInfoPrompt(input);
    return output!;
  }
);
