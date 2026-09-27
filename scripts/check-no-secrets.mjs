#!/usr/bin/env node
/**
 * Post-build guard: assert that no server-only secret reached the client bundle.
 *
 * Next.js only inlines NEXT_PUBLIC_* vars, so this should never fire — which is
 * exactly why it is worth asserting. A single mistaken `NEXT_PUBLIC_` prefix on
 * the OpenRouter key would publish it to every visitor, and that mistake is
 * silent without this check.
 *
 * Scans the built client output for secret-shaped strings and for the NAMES of
 * server-only variables (a name appearing in client JS means it was inlined).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['.next/static', '.next/server/app'];

/** Secret-shaped value patterns. */
const VALUE_PATTERNS = [
  { name: 'OpenRouter API key', re: /sk-or-v1-[A-Za-z0-9]{16,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{16,}/ },
  { name: 'Supabase service-role JWT', re: /"role"\s*:\s*"service_role"/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

/** Server-only variable names that must never appear in client-reachable JS. */
const FORBIDDEN_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'REVALIDATE_SECRET',
  'AUTOMATION_SECRET',
  'ADMIN_TOKEN',
  'IP_HASH_SALT',
  'YOUTUBE_API_KEY',
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs|json|txt|map)$/.test(entry)) yield full;
  }
}

const findings = [];
let scanned = 0;

for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  // .next/static is client-only. .next/server is server code, where these names
  // legitimately appear, so only value patterns are checked there.
  const clientOnly = root.includes('static');
  for (const file of walk(root)) {
    scanned += 1;
    const content = readFileSync(file, 'utf8');
    for (const { name, re } of VALUE_PATTERNS) {
      if (re.test(content)) findings.push(`${name} value found in ${file}`);
    }
    if (clientOnly) {
      for (const varName of FORBIDDEN_NAMES) {
        if (content.includes(varName)) {
          findings.push(`server-only variable name "${varName}" found in client bundle ${file}`);
        }
      }
    }
  }
}

if (scanned === 0) {
  console.error('check:secrets — no build output found. Run `npm run build` first.');
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`check:secrets — FAILED (${findings.length} finding(s)):`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`check:secrets — OK (${scanned} build files scanned, no secrets found)`);
