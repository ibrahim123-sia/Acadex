// First-run tools for a real (non-demo) installation. Run by hand from your computer against the
// database named in apps/api/.env — never started by the server.
//
//   npm run db:empty -- --yes
//       Removes every institution, user and message, keeps the built-in roles, plans and
//       platform settings, so a fresh installation starts with nothing. Refuses without --yes.
//
//   npm run admin:create -- --email you@example.com --name "Your Name"
//       Creates the first platform administrator (the top role) and prints a one-time link to set
//       a password; the same link is emailed once the API runs with MAIL_DRIVER=smtp.
//       Refuses when that email already has an account. Later administrators are added in the
//       app: Platform → Groups & team. Set APP_URL to the public address so the link points there.
import 'dotenv/config';
import { pool } from './pool';
import { createPlatformAdmin, emptyDatabase } from './admin-tasks';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(DATABASE_URL is not set)';
  }
}

async function empty() {
  console.log(`Database: ${target()}`);
  if (!process.argv.includes('--yes')) {
    throw new Error('This deletes every institution, user and message in the database above. Run again with --yes to confirm.');
  }
  await emptyDatabase();
  console.log('✅ Emptied. Create the first platform administrator: npm run admin:create -- --email <email> --name "<name>"');
}

async function createAdmin() {
  console.log(`Database: ${target()}`);
  const { email, invite } = await createPlatformAdmin(arg('email') ?? '', arg('name') ?? '');
  console.log(`✅ Platform administrator created: ${arg('name')} <${email}>`);
  console.log(`   Set the password here (valid until ${invite.expires_at}):`);
  console.log(`   ${invite.url}`);
  console.log('   Then turn on two-step verification under Security.');
}

(async () => {
  const command = process.argv[2];
  try {
    if (command === 'empty') await empty();
    else if (command === 'create') await createAdmin();
    else throw new Error('Usage: admin.ts empty --yes | admin.ts create --email <email> --name "<name>"');
    await pool.end();
  } catch (e) {
    console.error('❌', (e as Error).message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
