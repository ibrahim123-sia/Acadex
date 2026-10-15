// LMS client helpers: shared types, the live-event stream, and the offline queue for
// attendance registers taken without a connection.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, tokenStore } from './api';

export type CourseRole = 'staff' | 'student' | 'guardian';

export interface CourseSummary {
  id: number;
  code: string;
  name: string;
  section_name: string | null;
  term_name: string | null;
  teachers: string | null;
  items: number;
  done: number | null;
  progress_percent: number | null;
  next_due: { id: number; title: string; due_at: string } | null;
}

export interface Item {
  id: number;
  module_id: number;
  kind: 'page' | 'file' | 'link' | 'video' | 'embed' | 'assessment' | 'live' | 'scorm';
  title: string;
  url: string;
  file_id: number | null;
  video_provider: string | null;
  video_ref: string | null;
  assessment_id: number | null;
  live_session_id: number | null;
  scorm_package_id: number | null;
  position: number;
  published: boolean;
  unlock_at: string | null;
  completion: 'view' | 'mark_done' | 'submit' | 'pass';
  duration_minutes: number | null;
  assessment_title?: string | null;
  due_at?: string | null;
  assessment_status?: string | null;
  done?: boolean;
  locked?: boolean;
  lock_reason?: string | null;
}

export interface Module {
  id: number;
  title: string;
  description: string;
  position: number;
  published: boolean;
  unlock_at: string | null;
  prerequisite_module_id: number | null;
  mastery_percent: string | null;
  items: Item[];
  locked?: boolean;
  lock_reason?: string | null;
  done?: boolean;
}

export interface CourseHome {
  course: { id: number; code: string; name: string; section_name: string | null; campus_id: number | null; gradebook_locked_at: string | null; archived: boolean; section_id: number | null };
  role: CourseRole;
  can_edit: boolean;
  staff: { id: number; name: string; role: string }[];
  upcoming: { id: number; title: string; kind: string; due_at: string; points: string }[];
  modules: Module[];
  progress?: { done: number; total: number; percent: number };
  resume_item_id?: number | null;
  student_id?: number;
}

export interface Assessment {
  id: number;
  offering_id: number;
  kind: 'assignment' | 'quiz' | 'exam' | 'project' | 'participation';
  title: string;
  instructions_html: string;
  points: string;
  category_id: number | null;
  available_from: string | null;
  due_at: string | null;
  available_until: string | null;
  status: 'draft' | 'published' | 'closed';
  submission_types: string[];
  allowed_attempts: number | null;
  late_policy: { mode: 'allow' | 'penalty' | 'block'; penalty_percent_per_day?: number; max_penalty_percent?: number };
  group_set_id: number | null;
  peer_review: { reviews_per_student: number; due_at: string | null; anonymous: boolean } | null;
  rubric_id: number | null;
  ai_policy: string;
  quiz: { time_limit_minutes: number | null; shuffle_questions: boolean; shuffle_options: boolean; one_at_a_time: boolean; show_results: string; scoring: string } | null;
  release_mode: 'manual' | 'on_grading';
  course: { id: number; name: string; section_name: string | null };
  role: CourseRole;
  can_edit: boolean;
  rubric: { id: number; title: string; criteria: { id: number; title: string; description: string; levels: { points: number; label: string; description: string }[] }[] } | null;
  my?: { due_at: string | null; available_until: string | null; extra_attempts: number; extra_time_percent: number; attempts_allowed: number | null };
  grade?: { points: string | null; excused: boolean; missing: boolean; late_penalty_percent: string; feedback_html: string; feedback_file_ids: number[]; rubric_scores: Record<string, { points: number; comment: string }> | null } | null;
  extensions?: { id: number; student_name: string | null; group_name: string | null; due_at: string | null; extra_attempts: number; reason: string }[];
}

export const KIND_LABEL: Record<Assessment['kind'], string> = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  exam: 'Exam',
  project: 'Project',
  participation: 'Participation',
};

/** "in 3 days", "2 hours ago" — for due dates. */
export function dueLabel(iso: string | null | undefined): { text: string; tone: 'neutral' | 'warning' | 'danger' } {
  if (!iso) return { text: 'No due date', tone: 'neutral' };
  const ms = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(ms);
  const text =
    abs < 3600_000 ? rtf.format(Math.round(ms / 60_000), 'minute') : abs < 86400_000 ? rtf.format(Math.round(ms / 3600_000), 'hour') : rtf.format(Math.round(ms / 86400_000), 'day');
  return { text: `Due ${text}`, tone: ms < 0 ? 'danger' : ms < 86400_000 * 2 ? 'warning' : 'neutral' };
}

// ---------------------------------------------------------------- live events

type Listener = (kind: string, data: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
let running = false;

/** One stream per tab; reconnects with a fresh token, backs off when offline. */
async function runStream() {
  if (running) return;
  running = true;
  let delay = 1000;
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
  while (listeners.size) {
    try {
      if (!tokenStore.get()) await refreshSession();
      const token = tokenStore.get();
      if (!token) throw new Error('signed out');
      const res = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        await refreshSession();
        throw new Error('reauth');
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      delay = 1000;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!event || event === 'ready') continue;
          if (event === 'reauth') await refreshSession();
          const parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
          listeners.forEach((fn) => fn(event, parsed));
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
  running = false;
}

/** Live updates: notifications refresh the bell; other events whatever the page asks for. */
export function useLiveEvents(onEvent?: Listener) {
  const qc = useQueryClient();
  useEffect(() => {
    const fn: Listener = (kind, data) => {
      if (kind === 'notification') void qc.invalidateQueries({ queryKey: ['notifications'] });
      onEvent?.(kind, data);
    };
    listeners.add(fn);
    void runStream();
    return () => {
      listeners.delete(fn);
    };
  }, [qc, onEvent]);
}

// ---------------------------------------------------------------- offline attendance queue

const QUEUE_KEY = 'acadex.attendanceQueue';
export interface QueuedRegister {
  section_id: number;
  offering_id: number | null;
  period_id: number | null;
  date: string;
  records: { student_id: number; status: string; minutes_late: number | null; note: string }[];
}

export const offlineQueue = {
  list(): QueuedRegister[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedRegister[];
    } catch {
      return [];
    }
  },
  add(r: QueuedRegister) {
    // the newest copy of the same register replaces older ones
    const rest = offlineQueue.list().filter((q) => !(q.section_id === r.section_id && q.offering_id === r.offering_id && q.period_id === r.period_id && q.date === r.date));
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...rest, r]));
    } catch {
      /* storage full or blocked */
    }
  },
  /** Send everything queued; what still fails stays queued. Returns how many were sent. */
  async flush(): Promise<number> {
    const items = offlineQueue.list();
    const left: QueuedRegister[] = [];
    let sent = 0;
    for (const r of items) {
      try {
        await api.put('/attendance/register', { ...r, offline: true });
        sent++;
      } catch (e) {
        // network trouble: keep it; a refusal (holiday, not your class) can't be fixed by retrying
        if (e instanceof TypeError) left.push(r);
      }
    }
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(left));
    } catch {
      /* ignore */
    }
    return sent;
  },
};
