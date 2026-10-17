// A small load test (no extra tools): virtual users sign in with the demo accounts and keep
// opening the busiest screens — dashboards, course lists, a course, notifications, the
// timetable, fees — for a fixed time. Prints requests per second, latency percentiles and
// errors per endpoint, and exits non-zero when the error rate or p95 exceed the budgets.
//
//   npx tsx scripts/load-test.ts --url http://localhost:5000/api --users 50 --seconds 60
//   (budgets: --max-p95 800 --max-errors 1   [ms, percent])
// Never point it at production without the platform owner's agreement.

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const BASE = arg('url', 'http://localhost:5000/api').replace(/\/+$/, '');
const USERS = Number(arg('users', '30'));
const SECONDS = Number(arg('seconds', '30'));
const MAX_P95 = Number(arg('max-p95', '800'));
const MAX_ERR = Number(arg('max-errors', '1'));
const PASSWORD = arg('password', 'Acadex@123');
const ACCOUNTS = arg('accounts', 'ali.butt.s0@greenwood.edu,ali.sheikh.t0@greenwood.edu,parent1@greenwood.edu,admin@greenwood.edu').split(',');

const PATHS: Record<string, string[]> = {
  student: ['/me/student/overview', '/courses', '/notifications', '/timetable', '/finance/my', '/conversations'],
  teacher: ['/me/teacher/overview', '/courses', '/notifications', '/timetable', '/conversations'],
  parent: ['/parent/children', '/notifications', '/finance/my', '/conversations'],
  institution_admin: ['/institution/dashboard', '/institution/students?pageSize=50', '/notifications', '/tickets'],
};

interface Sample {
  path: string;
  ms: number;
  ok: boolean;
}
const samples: Sample[] = [];

async function login(email: string) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Acadex-Client': 'web' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  const j = (await res.json()) as { access_token: string; user: { role: string } };
  return { token: j.access_token, role: j.user.role };
}

async function virtualUser(n: number, until: number) {
  const { token, role } = await login(ACCOUNTS[n % ACCOUNTS.length]!);
  const paths = PATHS[role] ?? PATHS.student!;
  let i = n;
  while (Date.now() < until) {
    const path = paths[i++ % paths.length]!;
    const t0 = performance.now();
    let ok = false;
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Acadex-Client': 'web' } });
      await res.arrayBuffer();
      ok = res.status < 500 && res.status !== 429;
    } catch {
      ok = false;
    }
    samples.push({ path: path.split('?')[0]!, ms: performance.now() - t0, ok });
    // think time 0.2–1 s, like a person clicking
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
  }
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

(async () => {
  console.log(`load test: ${USERS} users for ${SECONDS}s against ${BASE}`);
  const until = Date.now() + SECONDS * 1000;
  // ramp up over a few seconds so sign-ins don't all land at once
  await Promise.all(Array.from({ length: USERS }, (_, n) => new Promise((r) => setTimeout(r, (n * 3000) / USERS)).then(() => virtualUser(n, until))));
  const total = samples.length;
  const errors = samples.filter((s) => !s.ok).length;
  const ms = samples.map((s) => s.ms);
  console.log(`\nrequests ${total}  (${(total / SECONDS).toFixed(1)}/s)   errors ${errors} (${((errors / Math.max(1, total)) * 100).toFixed(2)}%)`);
  console.log(`latency  p50 ${pct(ms, 50).toFixed(0)} ms   p95 ${pct(ms, 95).toFixed(0)} ms   p99 ${pct(ms, 99).toFixed(0)} ms\n`);
  const by = new Map<string, Sample[]>();
  for (const s of samples) by.set(s.path, [...(by.get(s.path) ?? []), s]);
  for (const [path, xs] of [...by.entries()].sort()) {
    const m = xs.map((x) => x.ms);
    console.log(`  ${path.padEnd(36)} ${String(xs.length).padStart(6)}  p50 ${pct(m, 50).toFixed(0).padStart(5)}  p95 ${pct(m, 95).toFixed(0).padStart(5)}  errors ${xs.filter((x) => !x.ok).length}`);
  }
  const p95 = pct(ms, 95);
  const errPct = (errors / Math.max(1, total)) * 100;
  if (p95 > MAX_P95 || errPct > MAX_ERR) {
    console.error(`\nFAILED budgets: p95 ${p95.toFixed(0)} ms (max ${MAX_P95}), errors ${errPct.toFixed(2)}% (max ${MAX_ERR}%)`);
    process.exit(1);
  }
  console.log('\nwithin budgets');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
