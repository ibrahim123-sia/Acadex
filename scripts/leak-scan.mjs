#!/usr/bin/env node
// Checks the staged changes (git diff --cached) for credentials before a commit: connection
// strings with passwords, API keys and tokens, private keys, passwords in config. Known test
// values (local / CI databases, the public demo password) are allowed. Exits 1 on a finding.
//
//   npm run secrets:check          (run before every commit)
//   node scripts/leak-scan.mjs --range main..HEAD   (commits not yet pushed)
import { execFileSync } from 'node:child_process';

const ALLOWED = [
  /postgres(ql)?:\/\/postgres:postgres@(localhost|127\.0\.0\.1)/,
  /postgres(ql)?:\/\/acadex:acadex@(localhost|postgres)/,
  /postgresql:\/\/user:password@host/,
  /Acadex@123/,
  /local-compose-secret-change-me/,
  /acadex-dev-secret/,
  // obviously fake values in tests, and form error labels
  /['"]test-[a-z0-9-]+['"]/,
  /:\s*'(required|invalid)'/,
];
const RULES = [
  ['database URL with a password', /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|mssql):\/\/[^\s:/@'"`]+:[^\s@'"`]+@[^\s'"`]+/i],
  ['Neon password', /\bnpg_[A-Za-z0-9]{8,}/],
  ['Stripe key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Twilio auth', /\bSK[0-9a-f]{32}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['password in config', /\b(password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{6,}['"]/i],
  ['secret in env file', /^\+?\s*[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*[^\s#]{6,}/],
];

const range = process.argv.includes('--range') ? process.argv[process.argv.indexOf('--range') + 1] : null;
const diff = execFileSync('git', range ? ['diff', '-U0', '--no-color', range] : ['diff', '--cached', '-U0', '--no-color'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
let file = '';
const findings = [];
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.slice(6);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (/(^|\/)(package-lock\.json|.*\.snap|.*\.map)$/.test(file) || file.includes('node_modules/')) continue;
  const text = line.slice(1);
  if (ALLOWED.some((a) => a.test(text))) continue;
  for (const [name, re] of RULES) {
    if (re.test(text)) {
      // test files and .env.example may name variables; values from process.env or schemas are fine
      if (/process\.env|import\.meta\.env|z\.string\(|\$\{|REPLACE-ME/.test(text)) continue;
      findings.push(`${file}: ${name}: ${text.trim().slice(0, 160)}`);
    }
  }
}
if (findings.length) {
  console.error('Possible credentials in the staged changes — remove them (use env vars / secrets) before committing:\n');
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log('secrets check: no credentials in the staged changes');
