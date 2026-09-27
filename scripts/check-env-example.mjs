#!/usr/bin/env node
/**
 * Assert .env.example contains placeholders only.
 *
 * The template is committed, so a real key pasted into it while debugging would
 * be published to the repo. This makes that a CI failure instead of an incident.
 */
import { readFileSync } from 'node:fs';

const REAL_VALUE_PATTERNS = [
  { name: 'OpenRouter key', re: /sk-or-v1-[A-Za-z0-9]{16,}/ },
  { name: 'Resend key', re: /\bre_[A-Za-z0-9]{16,}/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'Supabase publishable/secret key', re: /\bsb_(publishable|secret)_[A-Za-z0-9_-]{16,}/ },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  {
    name: 'real Supabase project URL',
    re: /https:\/\/(?!YOUR_PROJECT_REF)[a-z]{20}\.supabase\.co/,
  },
];

const content = readFileSync('.env.example', 'utf8');
const findings = [];

for (const { name, re } of REAL_VALUE_PATTERNS) {
  const match = re.exec(content);
  if (match) findings.push(`${name} looks like a real value: ${match[0].slice(0, 12)}…`);
}

// Every assignment must be empty, quoted-example, or an obvious placeholder.
const PLACEHOLDER =
  /^(|REPLACE_WITH_[A-Z0-9_]+|".*"|https?:\/\/(localhost|example\.com|YOUR_PROJECT_REF).*|[a-z]+@example\.com|inclusionai\/[a-z0-9.-]+|U[CU][A-Za-z0-9_-]{22})$/;

for (const [index, line] of content.split('\n').entries()) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  if (!PLACEHOLDER.test(value)) {
    findings.push(`line ${index + 1}: ${key} has a non-placeholder value`);
  }
}

if (findings.length > 0) {
  console.error(`check:env-example — FAILED (${findings.length} finding(s)):`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log('check:env-example — OK (placeholders only)');
