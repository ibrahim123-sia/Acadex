// Card payments of the platform's own invoices (Stripe Checkout). Mounted under /api/billing
// with a raw body (the signature covers the exact bytes).
import { Router } from 'express';
import { getConfig } from '../config';
import { runAsSystem } from '../db/context';
import { verifyStripeSignature } from '../lib/finance/providers';
import { logger } from '../lib/logger';
import { markInvoicePaid } from '../lib/platform';

// ---------------------------------------------------------------- platform invoices paid by card

const router = Router();

router.post('/stripe/webhook', async (req, res) => {
  const secret = getConfig().billing.stripeWebhookSecret;
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!secret || !verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, secret)) return res.status(400).json({ error: 'Bad signature' });
  const ev = JSON.parse(raw.toString('utf8')) as { type: string; data: { object: { id: string; payment_status?: string; metadata?: Record<string, string> } } };
  if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
    const invoiceId = Number(ev.data.object.metadata?.platform_invoice_id);
    if (Number.isInteger(invoiceId) && invoiceId > 0) {
      const ok = await runAsSystem(() => markInvoicePaid(invoiceId, 'stripe', ev.data.object.id));
      logger.info({ invoiceId, ok }, 'platform invoice paid by card');
    }
  }
  res.json({ received: true });
});

export default router;
