/**
 * Reference verification.
 *
 * A citation the reader cannot follow is worse than no citation, so every URL a generated
 * article proposes is fetched before the article can publish. Results are cached, both to
 * be polite to the organisations we cite and so a past validation decision can be
 * re-examined against the same evidence.
 *
 * The important subtlety was measured rather than assumed. Several genuinely authoritative
 * hosts refuse requests from datacenter IPs outright: `ods.od.nih.gov` and `cdc.gov` both
 * return 403, and `cochranelibrary.com` returns 412, while the pages plainly exist. So the
 * verifier distinguishes three outcomes, not two:
 *
 *   reachable     2xx — cite freely
 *   blocked       403/429/412 — we were refused, not told the page is missing. An
 *                 allowlisted host stays citable and the gate records a soft note.
 *   missing       404/410 — the page does not exist. Hard failure.
 *
 * Collapsing "blocked" into "missing" would reject correct NIH citations, which would push
 * the pipeline toward weaker sources — the opposite of the intent.
 */
import 'server-only';

import { liveGateway, type AutomationGateway } from '@/lib/automation/internal-gateway';

/** The slice of the automation gateway reference verification needs. */
export type ReferenceGateway = Pick<AutomationGateway, 'referenceCacheGet' | 'referenceCachePut'>;

export type ReferenceStatus = 'reachable' | 'blocked' | 'missing' | 'error';

export type ReferenceCheck = {
  readonly url: string;
  readonly status: ReferenceStatus;
  readonly httpStatus: number | null;
  readonly finalUrl: string | null;
  readonly host: string;
  readonly fromCache: boolean;
};

/** How long a verification result is trusted. */
export const CACHE_TTL_DAYS = 30;

const BLOCKED_STATUSES = new Set([401, 402, 403, 412, 429]);
const MISSING_STATUSES = new Set([404, 410]);

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function classify(httpStatus: number): ReferenceStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'reachable';
  if (BLOCKED_STATUSES.has(httpStatus)) return 'blocked';
  if (MISSING_STATUSES.has(httpStatus)) return 'missing';
  return 'error';
}

export type VerifyOptions = {
  readonly gateway?: ReferenceGateway;
  readonly fetchImpl?: typeof fetch;
  /** Skips the cache. Used by the manual integration script. */
  readonly force?: boolean;
  readonly timeoutMs?: number;
};

/**
 * Verify one URL, using the cache when it is fresh.
 *
 * A GET rather than a HEAD: several of these hosts answer HEAD with 405 while serving the
 * page perfectly well, which would classify a good citation as an error.
 */
export async function verifyReference(
  url: string,
  options: VerifyOptions = {},
): Promise<ReferenceCheck> {
  const gateway = options.gateway ?? liveGateway();
  const fetchImpl = options.fetchImpl ?? fetch;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { url, status: 'missing', httpStatus: null, finalUrl: null, host: '', fromCache: false };
  }

  const key = await sha256Hex(url);

  if (options.force !== true) {
    const data = await gateway.referenceCacheGet(key);

    if (data !== null) {
      const ageDays = (Date.now() - new Date(data.checkedAt).getTime()) / 86_400_000;
      if (ageDays < CACHE_TTL_DAYS) {
        return {
          url,
          status: data.httpStatus === null ? 'error' : classify(data.httpStatus),
          httpStatus: data.httpStatus,
          finalUrl: data.finalUrl,
          host: data.host ?? host,
          fromCache: true,
        };
      }
    }
  }

  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // Identifies us honestly. Some hosts block a missing or generic agent outright.
          'user-agent': 'SucKhoeGiaiMa-ReferenceChecker/1.0 (+https://example.com)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      httpStatus = response.status;
      finalUrl = response.url === '' ? null : response.url;
    } finally {
      clearTimeout(timer);
    }
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : String(cause);
  }

  const status: ReferenceStatus = httpStatus === null ? 'error' : classify(httpStatus);

  // Cache errors too: a host that is down stays down for a while, and retrying it on every
  // article would slow every run.
  await gateway.referenceCachePut({
    url_sha256: key,
    url,
    final_url: finalUrl,
    http_status: httpStatus,
    host,
    checked_at: new Date().toISOString(),
    error: errorMessage,
  });

  return { url, status, httpStatus, finalUrl, host, fromCache: false };
}

export type VerificationSummary = {
  readonly checks: readonly ReferenceCheck[];
  /** Cited freely: 2xx. */
  readonly reachable: readonly string[];
  /** Allowlisted but unconfirmed (403/412/429). Soft note, still citable. */
  readonly unverifiable: readonly string[];
  /** 404/410 or malformed. Hard failure if cited. */
  readonly unreachable: readonly string[];
};

/** Verify every URL an article proposes, sequentially so we never burst a host. */
export async function verifyReferences(
  urls: readonly string[],
  options: VerifyOptions = {},
): Promise<VerificationSummary> {
  const checks: ReferenceCheck[] = [];
  for (const url of new Set(urls)) {
    checks.push(await verifyReference(url, options));
  }

  return {
    checks,
    reachable: checks.filter((check) => check.status === 'reachable').map((check) => check.url),
    unverifiable: checks.filter((check) => check.status === 'blocked').map((check) => check.url),
    // An 'error' is treated as unreachable: we could not establish that the page exists,
    // and a citation we cannot stand behind should not ship.
    unreachable: checks
      .filter((check) => check.status === 'missing' || check.status === 'error')
      .map((check) => check.url),
  };
}

/** Whether a host is on the allowlist, accepting subdomains of an allowed host. */
export function isAllowlistedHost(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}
