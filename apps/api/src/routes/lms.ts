// Everything the LMS (and the finance office) adds under /api: authentication runs once here for all of it. Package
// files (SCORM) are served before it, under their own launch tokens.
import { Router } from 'express';
import { auth, requireInstitutionUser } from '../middleware/auth';
import admissions from './admissions';
import ai from './ai';
import assessments from './assessments';
import attendance from './attendance';
import content, { scormContentRouter } from './content';
import courses from './courses';
import engage from './engage';
import exams from './exams';
import finance from './finance';
import outcomes from './outcomes';
import gradebook from './gradebook';
import messages from './messages';
import reach from './reach';
import modules from './modules';
import bookings from './bookings';
import tenantSaas from './tenant-saas';
import quizzes from './quizzes';
import timetable from './timetable';

const lms = Router();
lms.use(scormContentRouter);
lms.use(auth, requireInstitutionUser);
for (const r of [courses, assessments, quizzes, gradebook, attendance, timetable, engage, content, finance, exams, outcomes, admissions, ai, messages, reach, modules, tenantSaas, bookings]) lms.use(r);

export default lms;
