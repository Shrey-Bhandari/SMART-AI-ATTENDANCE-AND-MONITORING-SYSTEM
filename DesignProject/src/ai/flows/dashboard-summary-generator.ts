'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating a summary of the dashboard, including key metrics like active lectures,
 * camera status, and attendance trends. The flow takes no input and returns a string summary.
 *
 * @example
 * ```typescript
 * const summary = await generateDashboardSummary();
 * console.log(summary);
 * ```
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DashboardSummaryOutputSchema = z.object({
  summary: z.string().describe('A summary of the current state of the system.'),
});

export type DashboardSummaryOutput = z.infer<typeof DashboardSummaryOutputSchema>;

export async function generateDashboardSummary(): Promise<DashboardSummaryOutput> {
  return dashboardSummaryFlow({});
}

const prompt = ai.definePrompt({
  name: 'dashboardSummaryPrompt',
  output: {schema: DashboardSummaryOutputSchema},
  prompt: `You are an AI assistant that summarizes key metrics of a classroom attendance system.

  Provide a concise summary (around 100 words) of the current system state. Highlight the following:

  - Total number of cameras configured.
  - Number of cameras currently active.
  - Number of lectures currently running.
  - Total number of students in the system.
  - Attendance marked today (number or percentage).

  Mention any warnings or potential issues, such as cameras being offline or low attendance rates.
  Focus on providing actionable insights for an administrator to quickly assess the system's overall performance.  Format the output as a single paragraph.
  `,
});

const dashboardSummaryFlow = ai.defineFlow(
  {
    name: 'dashboardSummaryFlow',
    outputSchema: DashboardSummaryOutputSchema,
  },
  async () => {
    const {output} = await prompt({});
    return output!;
  }
);
