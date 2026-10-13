import { z } from 'zod';
import { ASSESSMENT_TYPES, ATTENDANCE_STATUSES } from '../constants';
import { httpUrl, id, isoDate, optionalDate, optionalId, requiredText, text } from './common';

export const attendanceBody = z.object({
  section_id: id,
  date: isoDate,
  records: z.array(z.object({ student_id: id, status: z.enum(ATTENDANCE_STATUSES) })).max(500),
});

export const gradesBody = z
  .object({
    section_id: id,
    offering_id: optionalId,
    assignment_type: z.enum(ASSESSMENT_TYPES).default('Quiz'),
    assignment_name: requiredText(120),
    total_marks: z.coerce.number().positive().max(10000).default(100),
    records: z.array(z.object({ student_id: id, obtained_marks: z.coerce.number().min(0) })).max(500),
  })
  .refine((b) => b.records.every((r) => r.obtained_marks <= b.total_marks), {
    message: 'Obtained marks cannot exceed total marks',
    path: ['records'],
  });

export const assignmentBody = z.object({
  section_id: id,
  offering_id: optionalId,
  title: requiredText(200),
  description: text(5000).default(''),
  due_date: optionalDate,
});

export const submissionBody = z.object({ assignment_id: id, title: text(200).default(''), file_link: httpUrl });

export const rosterQuery = z.object({ date: isoDate.optional() });
