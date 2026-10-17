// A small five-field cron matcher (minute hour day-of-month month day-of-week, UTC), used when
// the schedule is driven from outside the process — e.g. a Cloudflare Worker cron trigger that
// wakes the API container every few minutes and asks which jobs fell due in that window.
// Supports `*`, numbers, ranges `a-b`, lists `a,b` and steps `*/n` / `a-b/n`.

const FIELDS: [min: number, max: number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7], // 0 and 7 are both Sunday
];

function parseField(spec: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range!.split('-');
      lo = Number(a);
      hi = b === undefined ? (stepText ? max : lo) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`bad cron field: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  matches(at: Date): boolean;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron needs five fields: ${expr}`);
  const [mins, hours, doms, months, dows] = parts.map((p, i) => parseField(p, FIELDS[i]!));
  if (dows!.has(7)) dows!.add(0);
  // like classic cron: when both day fields are restricted, either may match
  const domAny = parts[2] === '*';
  const dowAny = parts[4] === '*';
  return {
    matches(at: Date) {
      if (!mins!.has(at.getUTCMinutes()) || !hours!.has(at.getUTCHours()) || !months!.has(at.getUTCMonth() + 1)) return false;
      const dom = doms!.has(at.getUTCDate());
      const dow = dows!.has(at.getUTCDay());
      return domAny && dowAny ? true : domAny ? dow : dowAny ? dom : dom || dow;
    },
  };
}

/** The minutes in (from, to] at which `expr` fires (to the minute, oldest first). */
export function dueMinutes(expr: string, from: Date, to: Date): Date[] {
  const cron = parseCron(expr);
  const out: Date[] = [];
  const t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  for (let n = 0; t <= to && n < 60 * 24; n++, t.setTime(t.getTime() + 60_000)) if (cron.matches(t)) out.push(new Date(t));
  return out;
}
