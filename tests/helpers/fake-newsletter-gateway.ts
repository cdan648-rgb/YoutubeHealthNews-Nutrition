/**
 * An in-memory `NewsletterGateway` for the newsletter tests.
 *
 * Only the operations the signup, confirm and unsubscribe paths actually use are modelled,
 * over plain arrays with real filtering — enough to prove the rate-limit window, the
 * "same address is one person" dedup, the double-opt-in transitions and the constant-time
 * token comparison, without a database.
 *
 * The real RPCs are proven against the live database by the pgTAP suite; this fake exists
 * to test the orchestration around them.
 */
import type {
  NewsletterGateway,
  PendingConfirmationRow,
  SubStatusValue,
  SubscriberForUnsub,
  SubscriberSummary,
} from '@/lib/automation/internal-gateway';

export type SubscriberSeed = {
  readonly id: string;
  readonly email: string;
  readonly emailNormalized?: string;
  readonly status: SubStatusValue;
  readonly confirmTokenHash?: string | null;
  readonly confirmExpiresAt?: string | null;
  readonly unsubscribeTokenHash?: string;
};

type SubscriberRow = {
  id: string;
  email: string;
  emailNormalized: string;
  status: SubStatusValue;
  confirmTokenHash: string | null;
  confirmExpiresAt: string | null;
  unsubscribeTokenHash: string;
  confirmedAt: string | null;
  subscribedAt: string | null;
  unsubscribedAt: string | null;
};

type AttemptRow = { ipHmac: string; ts: string; outcome: string };
type SendFailureRow = { level: 'warn' | 'error'; message: string; stage: string };

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`;
}

/** Mirror of `internal.normalize_email`, so seeded rows dedupe like the database does. */
function normalizeEmail(input: string): string {
  const lowered = input.trim().toLowerCase();
  const at = lowered.indexOf('@');
  if (at === -1) return lowered;
  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

export type FakeNewsletterGateway = NewsletterGateway & {
  readonly subscribers: SubscriberRow[];
  readonly attempts: AttemptRow[];
  readonly sendFailures: SendFailureRow[];
  seed(row: SubscriberSeed): void;
};

export function fakeNewsletterGateway(
  seeds: readonly SubscriberSeed[] = [],
): FakeNewsletterGateway {
  const subscribers: SubscriberRow[] = [];
  const attempts: AttemptRow[] = [];
  const sendFailures: SendFailureRow[] = [];

  function insert(row: SubscriberSeed): SubscriberRow {
    const full: SubscriberRow = {
      id: row.id,
      email: row.email,
      emailNormalized: row.emailNormalized ?? normalizeEmail(row.email),
      status: row.status,
      confirmTokenHash: row.confirmTokenHash ?? null,
      confirmExpiresAt: row.confirmExpiresAt ?? null,
      unsubscribeTokenHash: row.unsubscribeTokenHash ?? 'x',
      confirmedAt: null,
      subscribedAt: null,
      unsubscribedAt: null,
    };
    subscribers.push(full);
    return full;
  }

  for (const seed of seeds) insert(seed);

  const gateway: FakeNewsletterGateway = {
    subscribers,
    attempts,
    sendFailures,
    seed: (row) => {
      insert(row);
    },

    countRecentAttempts: (ipHmac, since) =>
      Promise.resolve(attempts.filter((row) => row.ipHmac === ipHmac && row.ts >= since).length),

    recordAttempt: (ipHmac, outcome) => {
      attempts.push({ ipHmac, ts: new Date().toISOString(), outcome });
      return Promise.resolve();
    },

    findSubscriber: (emailNormalized) => {
      const row = subscribers.find((s) => s.emailNormalized === emailNormalized);
      const result: SubscriberSummary | null =
        row === undefined ? null : { id: row.id, status: row.status };
      return Promise.resolve(result);
    },

    insertPending: (payload) => {
      const email = String(payload.email);
      const normalized = normalizeEmail(email);
      if (subscribers.some((s) => s.emailNormalized === normalized)) {
        // The unique constraint on email_normalized.
        return Promise.resolve(null);
      }
      const row = insert({
        id: uuid(),
        email,
        emailNormalized: normalized,
        status: 'pending',
        confirmTokenHash: (payload.confirm_token_hash as string) ?? null,
        confirmExpiresAt: (payload.confirm_expires_at as string) ?? null,
        unsubscribeTokenHash: (payload.unsubscribe_token_hash as string) ?? 'placeholder',
      });
      return Promise.resolve(row.id);
    },

    setUnsubscribeHash: (id, hash) => {
      const row = subscribers.find((s) => s.id === id);
      if (row !== undefined) row.unsubscribeTokenHash = hash;
      return Promise.resolve();
    },

    rearmPending: (id, consent) => {
      const row = subscribers.find((s) => s.id === id);
      if (row !== undefined) {
        row.status = 'pending';
        row.confirmTokenHash = (consent.confirm_token_hash as string) ?? null;
        row.confirmExpiresAt = (consent.confirm_expires_at as string) ?? null;
      }
      return Promise.resolve();
    },

    logSendFailure: (level, message, stage = 'confirm') => {
      sendFailures.push({ level, message, stage });
      return Promise.resolve();
    },

    pendingWithConfirmTokens: () => {
      const list: PendingConfirmationRow[] = subscribers
        .filter((row) => row.status === 'pending' && row.confirmTokenHash !== null)
        .map((row) => ({
          id: row.id,
          confirmTokenHash: row.confirmTokenHash,
          confirmExpiresAt: row.confirmExpiresAt,
        }));
      return Promise.resolve(list);
    },

    activate: (id, nowIso) => {
      const row = subscribers.find((s) => s.id === id);
      if (row === undefined || row.status !== 'pending') return Promise.resolve(false);
      row.status = 'active';
      row.confirmedAt = nowIso;
      row.subscribedAt = nowIso;
      row.confirmTokenHash = null;
      return Promise.resolve(true);
    },

    getSubscriberForUnsub: (id) => {
      const row = subscribers.find((s) => s.id === id);
      const result: SubscriberForUnsub | null =
        row === undefined
          ? null
          : { status: row.status, unsubscribeTokenHash: row.unsubscribeTokenHash };
      return Promise.resolve(result);
    },

    markUnsubscribed: (id, nowIso) => {
      const row = subscribers.find((s) => s.id === id);
      if (row === undefined || row.status === 'unsubscribed') return Promise.resolve(false);
      row.status = 'unsubscribed';
      row.unsubscribedAt = nowIso;
      return Promise.resolve(true);
    },
  };

  return gateway;
}
