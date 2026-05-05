import Stripe from 'stripe';

export type StripeAdapterConfig = {
  secretKey: string;
  webhookSecret: string;
  maxRetries: number;
  baseBackoffMs: number;
};

export type DisbursementResult =
  | { ok: true; externalTransferId: string }
  | { ok: false; failureCode: string; failureMessage: string };

export function createStripeClient(cfg: StripeAdapterConfig): Stripe {
  return new Stripe(cfg.secretKey, { apiVersion: '2026-04-22.dahlia' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyStripeError(err: unknown): { retryable: boolean; code: string; message: string } {
  const e = err as { type?: string; code?: string; message?: string; statusCode?: number };
  const code = e.code ?? e.type ?? 'stripe_error';
  const message = e.message ?? 'Stripe request failed';
  const retryable =
    e.type === 'StripeConnectionError' ||
    e.type === 'StripeAPIError' ||
    e.code === 'rate_limit' ||
    (typeof e.statusCode === 'number' && e.statusCode >= 500);
  return { retryable, code, message };
}

export async function dispatchStripeTransfer(params: {
  stripe: Stripe;
  connectedAccountId: string;
  amountCents: number;
  idempotencyKey: string;
  maxRetries: number;
  baseBackoffMs: number;
}): Promise<DisbursementResult> {
  let attempt = 0;
  // Exponential backoff with jitter for transient Stripe/API outages.
  while (attempt <= params.maxRetries) {
    try {
      const tr = await params.stripe.transfers.create(
        {
          amount: params.amountCents,
          currency: 'usd',
          destination: params.connectedAccountId,
          description: 'Swiftpay advance disbursement',
        },
        { idempotencyKey: `${params.idempotencyKey}:stripe-transfer` },
      );
      return { ok: true, externalTransferId: tr.id };
    } catch (err) {
      const classified = classifyStripeError(err);
      if (!classified.retryable || attempt === params.maxRetries) {
        return { ok: false, failureCode: classified.code, failureMessage: classified.message };
      }
      const backoff = params.baseBackoffMs * 2 ** attempt + Math.floor(Math.random() * 100);
      await sleep(backoff);
      attempt += 1;
    }
  }
  return { ok: false, failureCode: 'retry_exhausted', failureMessage: 'Retry attempts exhausted' };
}

export function constructStripeEvent(params: {
  stripe: Stripe;
  rawBody: string;
  signature: string;
  webhookSecret: string;
}): Stripe.Event {
  return params.stripe.webhooks.constructEvent(params.rawBody, params.signature, params.webhookSecret);
}
