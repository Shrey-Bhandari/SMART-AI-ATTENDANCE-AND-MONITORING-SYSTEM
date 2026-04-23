import { z } from 'zod';

export const lectureFormSchema = z.object({
  subject: z.string().min(2, { message: 'Subject must be at least 2 characters.' }),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid year format (e.g., 2024-25).'),
  standard: z.string().min(1),
  division: z.string().min(1),
  classRoom: z.string().min(1),
  date: z.string(),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM).'),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM).'),
});

export type LectureCreate = z.infer<typeof lectureFormSchema>;
