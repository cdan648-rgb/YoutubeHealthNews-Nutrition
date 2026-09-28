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
  CampaignArticleRow,
  CampaignHandle,
  NewsletterGateway,
  PendingConfirmationRow,
  QueuedSendRow,
  SubStatusValue,
  SubscriberForUnsub,
  SubscriberSummary,
  SubscriberSendTarget,
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

type CampaignRow = {
  id: string;
  articleId: string;
  totalQueued: number;
  totalSent: number;
  startedAt: string | null;
  completedAt: string | null;
};

type SendRow = {
  id: string;
  campaignId: string;
  subscriberId: string;
  status: 'queued' | 'sending' | 'sent' | 'unknown' | 'failed';
  attemptedAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  attemptCount: number;
  error: Record<string, unknown> | null;
};

type LogRow = {
  ts: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  stage: string;
  message: string;
  context: Record<string, unknown>;
};

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
  readonly campaigns: CampaignRow[];
  readonly sends: SendRow[];
  readonly logs: LogRow[];
  /** Test-only: set the article payload the fake returns for a campaign id. */
  setArticleForCampaign(campaignId: string, article: CampaignArticleRow | null): void;
  /** Test-only: set the daily send cap. `null` means unlimited (the settings singleton default is 90). */
  setDailySendCap(cap: number | null): void;
  seed(row: SubscriberSeed): void;
};

export function fakeNewsletterGateway(
  seeds: readonly SubscriberSeed[] = [],
): FakeNewsletterGateway {
  const subscribers: SubscriberRow[] = [];
  const attempts: AttemptRow[] = [];
  const sendFailures: SendFailureRow[] = [];
  const campaigns: CampaignRow[] = [];
  const sends: SendRow[] = [];
  const logs: LogRow[] = [];
  const articlesByCampaign = new Map<string, CampaignArticleRow | null>();
  let cap: number | null = 90;

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
    campaigns,
    sends,
    logs,
    setArticleForCampaign: (campaignId, article) => {
      articlesByCampaign.set(campaignId, article);
    },
    setDailySendCap: (value) => {
      cap = value;
    },
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

    /* -------------------------- send state machine --------------------------- */

    campaignGetOrCreate: (articleId) => {
      const existing = campaigns.find((c) => c.articleId === articleId);
      if (existing !== undefined) {
        const handle: CampaignHandle = { id: existing.id, created: false };
        return Promise.resolve(handle);
      }
      const row: CampaignRow = {
        id: uuid(),
        articleId,
        totalQueued: 0,
        totalSent: 0,
        startedAt: null,
        completedAt: null,
      };
      campaigns.push(row);
      const handle: CampaignHandle = { id: row.id, created: true };
      return Promise.resolve(handle);
    },

    activeSubscriberIds: () =>
      Promise.resolve(subscribers.filter((s) => s.status === 'active').map((s) => s.id)),

    fanoutSends: (campaignId, subscriberIds) => {
      let inserted = 0;
      for (const subscriberId of subscriberIds) {
        if (sends.some((s) => s.campaignId === campaignId && s.subscriberId === subscriberId)) {
          continue;
        }
        sends.push({
          id: uuid(),
          campaignId,
          subscriberId,
          status: 'queued',
          attemptedAt: null,
          sentAt: null,
          providerMessageId: null,
          attemptCount: 0,
          error: null,
        });
        inserted += 1;
      }
      return Promise.resolve(inserted);
    },

    campaignSetStarted: (campaignId, totalQueued) => {
      const camp = campaigns.find((c) => c.id === campaignId);
      if (camp !== undefined) {
        camp.totalQueued = totalQueued;
        camp.startedAt = camp.startedAt ?? new Date().toISOString();
      }
      return Promise.resolve();
    },

    reclaimStale: (campaignId, cutoffIso) => {
      let n = 0;
      for (const send of sends) {
        if (
          send.campaignId === campaignId &&
          send.status === 'sending' &&
          send.attemptedAt !== null &&
          send.attemptedAt < cutoffIso
        ) {
          send.status = 'unknown';
          send.error = { reason: 'sending_timed_out' };
          n += 1;
        }
      }
      return Promise.resolve(n);
    },

    dailySendCap: () => Promise.resolve(cap),

    sentTodayCount: (sinceIso) =>
      Promise.resolve(
        sends.filter(
          (s) =>
            s.attemptedAt !== null &&
            s.attemptedAt >= sinceIso &&
            (s.status === 'sent' || s.status === 'sending' || s.status === 'unknown'),
        ).length,
      ),

    queuedBatch: (campaignId, limit) => {
      const list: QueuedSendRow[] = sends
        .filter((s) => s.campaignId === campaignId && s.status === 'queued')
        .slice(0, Math.max(1, limit))
        .map((s) => ({ id: s.id, subscriberId: s.subscriberId }));
      return Promise.resolve(list);
    },

    claimSend: (sendId, nowIso) => {
      const send = sends.find((s) => s.id === sendId);
      if (send === undefined || send.status !== 'queued') return Promise.resolve(false);
      send.status = 'sending';
      send.attemptedAt = nowIso;
      return Promise.resolve(true);
    },

    subscriberForSend: (subscriberId) => {
      const row = subscribers.find((s) => s.id === subscriberId);
      const result: SubscriberSendTarget | null =
        row === undefined
          ? null
          : { email: row.email, unsubscribeTokenHash: row.unsubscribeTokenHash };
      return Promise.resolve(result);
    },

    markSendSent: (sendId, providerMessageId, nowIso) => {
      const send = sends.find((s) => s.id === sendId);
      if (send !== undefined) {
        send.status = 'sent';
        send.sentAt = nowIso;
        send.providerMessageId = providerMessageId;
        send.attemptCount = 1;
      }
      return Promise.resolve();
    },

    markSendFailed: (sendId, reason) => {
      const send = sends.find((s) => s.id === sendId);
      if (send !== undefined) {
        send.status = 'failed';
        send.attemptCount = 1;
        send.error = { reason };
      }
      return Promise.resolve();
    },

    log: (level, code, stage, message, context) => {
      logs.push({
        ts: new Date().toISOString(),
        level,
        code,
        stage,
        message,
        context: context ?? {},
      });
      return Promise.resolve();
    },

    loadArticleForCampaign: (campaignId) =>
      Promise.resolve(articlesByCampaign.get(campaignId) ?? null),

    updateCampaignTotals: (campaignId) => {
      const camp = campaigns.find((c) => c.id === campaignId);
      if (camp === undefined) return Promise.resolve();
      camp.totalSent = sends.filter(
        (s) => s.campaignId === campaignId && s.status === 'sent',
      ).length;
      const open = sends.filter(
        (s) => s.campaignId === campaignId && (s.status === 'queued' || s.status === 'sending'),
      ).length;
      if (open === 0) camp.completedAt = camp.completedAt ?? new Date().toISOString();
      return Promise.resolve();
    },

    markSubscriberDeliveryStatus: (emailNormalized, status) => {
      let n = 0;
      for (const row of subscribers) {
        if (
          row.emailNormalized === emailNormalized &&
          (row.status === 'active' || row.status === 'pending')
        ) {
          row.status = status;
          n += 1;
        }
      }
      return Promise.resolve(n);
    },
  };

  return gateway;
}
