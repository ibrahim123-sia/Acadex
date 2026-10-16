// Online payment providers behind one interface. Each institution connects its own merchant
// account (payment_accounts: public settings + sealed secrets). Drivers:
//   stripe    — Stripe Checkout (cards, worldwide), webhooks signed with the endpoint secret
//   jazzcash  — JazzCash hosted checkout (page redirection v1.1), callbacks signed with the integrity salt
//   easypaisa — Easypay hosted checkout, results confirmed with the transaction inquiry API
//   bank      — bank transfer / Raast: payers pay to the IBAN with the invoice number as
//               reference; matched from the bank statement in reconciliation
//   fake      — a local checkout page and signed callbacks (development and tests)
// The JazzCash and Easypaisa drivers follow the providers' published integration guides; they
// need the institution's merchant credentials (sandbox or live) to run against the real services.
import crypto from 'node:crypto';
import { badRequest } from '../errors';

export type ProviderName = 'stripe' | 'jazzcash' | 'easypaisa' | 'bank' | 'fake';

export interface ProviderAccount {
  id: number;
  provider: ProviderName;
  mode: 'sandbox' | 'live';
  publicConfig: Record<string, string>;
  secrets: Record<string, string>;
}

export interface CheckoutInput {
  reference: string;
  amount: number;
  currency: string;
  title: string;
  invoiceNumber: string;
  payerEmail?: string;
  payerPhone?: string;
  /** where the payer comes back to (our page) */
  returnUrl: string;
  /** where the provider sends the result (our webhook) */
  callbackUrl: string;
}

export interface CheckoutResult {
  /** send the payer here… */
  redirectUrl?: string;
  /** …or post this form (providers that need a POST) */
  form?: { action: string; fields: Record<string, string> };
  /** or show these instructions (bank transfer) */
  instructions?: Record<string, string>;
  providerSessionId?: string;
}

export interface ProviderEvent {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'ignored';
  reference?: string;
  providerRef?: string;
  amount?: number;
}

export interface CallbackRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
}

export interface Settlement {
  providerRef: string;
  reference?: string;
  amount: number;
  at: string;
}

export interface PaymentProvider {
  name: ProviderName;
  label: string;
  /** pays online (redirect / form); bank is offline */
  online: boolean;
  createCheckout(acct: ProviderAccount, input: CheckoutInput): Promise<CheckoutResult>;
  /** verify and read a webhook / callback; throws SignatureError when it isn't genuine */
  parseCallback(acct: ProviderAccount, req: CallbackRequest): Promise<ProviderEvent>;
  /** what the provider says it settled (reconciliation) */
  settlements?(acct: ProviderAccount, from: string, to: string): Promise<Settlement[]>;
  refund?(acct: ProviderAccount, providerRef: string, amount: number): Promise<{ providerRef: string }>;
}

export class SignatureError extends Error {}

const header = (h: CallbackRequest['headers'], k: string) => {
  const v = h[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
const timingEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const need = (acct: ProviderAccount, keys: string[]) => {
  const missing = keys.filter((k) => !acct.secrets[k]);
  if (missing.length) throw badRequest(`The ${acct.provider} account is missing: ${missing.join(', ')}`);
};
/** Minor units (paisa, cents) for providers that want integers. */
const minor = (amount: number) => Math.round(amount * 100);

// ---------------------------------------------------------------- Stripe

/** Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">; 5 minutes tolerance. */
export function verifyStripeSignature(rawBody: Buffer, sigHeader: string | undefined, secret: string, now = Date.now()): boolean {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  return sigHeader.split(',').some((p) => p.startsWith('v1=') && timingEqual(p.slice(3), expected));
}

const stripe: PaymentProvider = {
  name: 'stripe',
  label: 'Card (Stripe)',
  online: true,
  async createCheckout(acct, input) {
    need(acct, ['secret_key']);
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}status=success`,
      cancel_url: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}status=cancelled`,
      client_reference_id: input.reference,
      'metadata[reference]': input.reference,
      'payment_intent_data[metadata][reference]': input.reference,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(minor(input.amount)),
      'line_items[0][price_data][product_data][name]': `${input.title} (${input.invoiceNumber})`,
    });
    if (input.payerEmail) form.set('customer_email', input.payerEmail);
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acct.secrets.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': input.reference },
      body: form,
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !json.url) throw badRequest(`Stripe refused the payment: ${json.error?.message ?? res.status}`);
    return { redirectUrl: json.url, providerSessionId: json.id };
  },
  async parseCallback(acct, req) {
    need(acct, ['webhook_secret']);
    if (!verifyStripeSignature(req.rawBody, header(req.headers, 'stripe-signature'), acct.secrets.webhook_secret!)) throw new SignatureError('bad Stripe signature');
    const ev = JSON.parse(req.rawBody.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const o = ev.data.object;
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      if (o.payment_status !== 'paid') return { eventId: ev.id, type: 'ignored' };
      return { eventId: ev.id, type: 'payment.succeeded', reference: String(o.client_reference_id ?? ''), providerRef: String(o.payment_intent ?? o.id), amount: Number(o.amount_total) / 100 };
    }
    if (ev.type === 'checkout.session.async_payment_failed' || ev.type === 'checkout.session.expired') {
      return { eventId: ev.id, type: 'payment.failed', reference: String(o.client_reference_id ?? '') };
    }
    if (ev.type === 'charge.refunded') return { eventId: ev.id, type: 'refund.succeeded', providerRef: String(o.payment_intent ?? ''), amount: Number(o.amount_refunded) / 100 };
    return { eventId: ev.id, type: 'ignored' };
  },
  async settlements(acct, from, to) {
    need(acct, ['secret_key']);
    const out: Settlement[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: '100', 'created[gte]': String(Date.parse(`${from}T00:00:00Z`) / 1000), 'created[lte]': String(Date.parse(`${to}T23:59:59Z`) / 1000) });
      if (after) qs.set('starting_after', after);
      const res = await fetch(`https://api.stripe.com/v1/payment_intents?${qs}`, { headers: { Authorization: `Bearer ${acct.secrets.secret_key}` } });
      const json = (await res.json()) as { data: { id: string; status: string; amount_received: number; created: number; metadata?: { reference?: string } }[]; has_more: boolean };
      if (!res.ok) throw badRequest('Stripe did not return its payments');
      for (const p of json.data) if (p.status === 'succeeded') out.push({ providerRef: p.id, reference: p.metadata?.reference, amount: p.amount_received / 100, at: new Date(p.created * 1000).toISOString() });
      if (!json.has_more || !json.data.length) break;
      after = json.data[json.data.length - 1]!.id;
    }
    return out;
  },
  async refund(acct, providerRef, amount) {
    need(acct, ['secret_key']);
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acct.secrets.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ payment_intent: providerRef, amount: String(minor(amount)) }),
    });
    const json = (await res.json()) as { id?: string; error?: { message: string } };
    if (!res.ok || !json.id) throw badRequest(`Stripe refused the refund: ${json.error?.message ?? res.status}`);
    return { providerRef: json.id };
  },
};

// ---------------------------------------------------------------- JazzCash

/** pp_SecureHash: HMAC-SHA256(salt, salt & values of the non-empty pp_ fields sorted by name), upper-case hex. */
export function jazzcashHash(fields: Record<string, string>, salt: string): string {
  const values = Object.keys(fields)
    .filter((k) => k.startsWith('pp') && k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] != null)
    .sort()
    .map((k) => fields[k]);
  return crypto.createHmac('sha256', salt).update([salt, ...values].join('&')).digest('hex').toUpperCase();
}

const jzDate = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

const jazzcash: PaymentProvider = {
  name: 'jazzcash',
  label: 'JazzCash',
  online: true,
  async createCheckout(acct, input) {
    need(acct, ['merchant_id', 'password', 'integrity_salt']);
    // Pakistan time, as JazzCash expects
    const now = new Date(Date.now() + 5 * 3600_000);
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: '',
      pp_Language: 'EN',
      pp_MerchantID: acct.secrets.merchant_id!,
      pp_SubMerchantID: '',
      pp_Password: acct.secrets.password!,
      pp_BankID: '',
      pp_ProductID: '',
      pp_TxnRefNo: input.reference.slice(0, 20),
      pp_Amount: String(minor(input.amount)),
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: jzDate(now),
      pp_BillReference: input.invoiceNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
      pp_Description: input.title.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 100),
      pp_TxnExpiryDateTime: jzDate(new Date(now.getTime() + 24 * 3600_000)),
      pp_ReturnURL: input.callbackUrl,
      ppmpf_1: input.reference,
    };
    fields.pp_SecureHash = jazzcashHash(fields, acct.secrets.integrity_salt!);
    const action = acct.mode === 'live' ? 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/' : 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';
    return { form: { action, fields }, providerSessionId: fields.pp_TxnRefNo };
  },
  async parseCallback(acct, req) {
    need(acct, ['integrity_salt']);
    const b = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k, String(v ?? '')]));
    if (!b.pp_SecureHash || !timingEqual(jazzcashHash(b, acct.secrets.integrity_salt!), b.pp_SecureHash.toUpperCase())) throw new SignatureError('bad JazzCash hash');
    const reference = b.ppmpf_1 || b.pp_TxnRefNo;
    const eventId = `${b.pp_TxnRefNo}:${b.pp_ResponseCode}:${b.pp_RetreivalReferenceNo ?? ''}`;
    if (b.pp_ResponseCode === '000' || b.pp_ResponseCode === '121') {
      return { eventId, type: 'payment.succeeded', reference, providerRef: b.pp_RetreivalReferenceNo || b.pp_TxnRefNo, amount: Number(b.pp_Amount) / 100 };
    }
    return { eventId, type: 'payment.failed', reference };
  },
};

// ---------------------------------------------------------------- Easypaisa

/**
 * merchantHashedReq: AES-128/ECB/PKCS5 of the sorted query string, keyed by the store's hash key,
 * base64. ECB is what Easypaisa's protocol prescribes for this request signature; nothing of ours
 * is stored with it.
 */
export function easypaisaHash(params: Record<string, string>, hashKey: string): string {
  const plain = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const key = Buffer.from(hashKey, 'utf8');
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

const easypaisa: PaymentProvider = {
  name: 'easypaisa',
  label: 'Easypaisa',
  online: true,
  async createCheckout(acct, input) {
    need(acct, ['store_id', 'hash_key']);
    const expiry = new Date(Date.now() + 5 * 3600_000 + 24 * 3600_000).toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 15);
    const params: Record<string, string> = {
      amount: input.amount.toFixed(1),
      orderRefNum: input.reference,
      paymentMethod: 'InitialRequest',
      postBackURL: input.callbackUrl,
      storeId: acct.secrets.store_id!,
      expiryDate: expiry,
    };
    const fields = { ...params, merchantHashedReq: easypaisaHash(params, acct.secrets.hash_key!), autoRedirect: '1', emailAddr: input.payerEmail ?? '', mobileNum: input.payerPhone ?? '' };
    const action = acct.mode === 'live' ? 'https://easypay.easypaisa.com.pk/easypay/Index.jsf' : 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf';
    return { form: { action, fields }, providerSessionId: input.reference };
  },
  /** The postback carries no signature: the result is confirmed with Easypay's inquiry API. */
  async parseCallback(acct, req) {
    need(acct, ['store_id', 'api_username', 'api_password']);
    const reference = String(req.query.orderRefNumber ?? req.body.orderRefNumber ?? req.body.orderRefNum ?? '');
    if (!reference) throw new SignatureError('no order reference');
    const base = acct.mode === 'live' ? 'https://easypay.easypaisa.com.pk' : 'https://easypaystg.easypaisa.com.pk';
    const res = await fetch(`${base}/easypay-service/rest/v4/inquire-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Credentials: Buffer.from(`${acct.secrets.api_username}:${acct.secrets.api_password}`).toString('base64') },
      body: JSON.stringify({ orderId: reference, storeId: acct.secrets.store_id, accountNum: acct.secrets.account_number ?? '' }),
    });
    const json = (await res.json().catch(() => ({}))) as { responseCode?: string; transactionStatus?: string; transactionId?: string; transactionAmount?: string };
    if (!res.ok || json.responseCode !== '0000') throw new SignatureError('Easypay could not confirm the transaction');
    const status = (json.transactionStatus ?? '').toUpperCase();
    const eventId = `${reference}:${status}:${json.transactionId ?? ''}`;
    if (status === 'PAID') return { eventId, type: 'payment.succeeded', reference, providerRef: json.transactionId ?? reference, amount: Number(json.transactionAmount) };
    if (status === 'FAILED' || status === 'EXPIRED') return { eventId, type: 'payment.failed', reference };
    return { eventId, type: 'ignored', reference };
  },
};

// ---------------------------------------------------------------- bank transfer / Raast

const bank: PaymentProvider = {
  name: 'bank',
  label: 'Bank transfer / Raast',
  online: false,
  async createCheckout(acct, input) {
    const c = acct.publicConfig;
    return {
      instructions: {
        bank: c.bank_name ?? '',
        account_title: c.account_title ?? '',
        iban: c.iban ?? '',
        raast_id: c.raast_id ?? '',
        amount: input.amount.toFixed(2),
        reference: input.invoiceNumber,
      },
    };
  },
  async parseCallback() {
    throw new SignatureError('bank transfers have no callback; they are matched from the statement');
  },
};

// ---------------------------------------------------------------- fake (development, tests)

export const fakeSettlements: Settlement[] = [];
/** Sign a fake provider event the way the fake webhook expects (tests, the local pay page). */
export function signFake(body: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

const fake: PaymentProvider = {
  name: 'fake',
  label: 'Test payment',
  online: true,
  async createCheckout(acct, input) {
    const qs = new URLSearchParams({ reference: input.reference, amount: input.amount.toFixed(2), return: input.returnUrl, callback: input.callbackUrl });
    return { redirectUrl: `/api/payments/fake/checkout?${qs}`, providerSessionId: `fake_${input.reference}` };
  },
  async parseCallback(acct, req) {
    const secret = acct.secrets.webhook_secret ?? 'fake-secret';
    const sig = header(req.headers, 'x-fake-signature') ?? '';
    if (!timingEqual(sig, signFake(req.rawBody.toString('utf8'), secret))) throw new SignatureError('bad fake signature');
    const ev = JSON.parse(req.rawBody.toString('utf8')) as { id: string; type: ProviderEvent['type']; reference?: string; provider_ref?: string; amount?: number };
    if (ev.type === 'payment.succeeded' && ev.provider_ref) fakeSettlements.push({ providerRef: ev.provider_ref, reference: ev.reference, amount: Number(ev.amount), at: new Date().toISOString() });
    return { eventId: ev.id, type: ev.type, reference: ev.reference, providerRef: ev.provider_ref, amount: ev.amount };
  },
  async settlements() {
    return [...fakeSettlements];
  },
  async refund(_acct, providerRef) {
    return { providerRef: `fake_refund_${providerRef}` };
  },
};

export const PROVIDERS: Record<ProviderName, PaymentProvider> = { stripe, jazzcash, easypaisa, bank, fake };

/** Which secrets each provider needs (for the settings form). */
export const PROVIDER_SECRETS: Record<ProviderName, string[]> = {
  stripe: ['secret_key', 'webhook_secret'],
  jazzcash: ['merchant_id', 'password', 'integrity_salt'],
  easypaisa: ['store_id', 'hash_key', 'api_username', 'api_password', 'account_number'],
  bank: [],
  fake: ['webhook_secret'],
};
