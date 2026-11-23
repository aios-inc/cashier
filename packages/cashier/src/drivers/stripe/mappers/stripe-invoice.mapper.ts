import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  Invoice,
  InvoiceEvent,
  InvoiceEventType,
  InvoiceLineItem,
  InvoiceLineItemRefund,
  InvoicePreview,
  InvoiceRefund,
  InvoiceRelation,
  InvoiceStatus,
  InvoiceWith,
} from '../../../types/invoice.types';
import { STRIPE_IDEMPOTENCY_METADATA_KEY } from '../../../constants/cashier.constants';
import {
  fromUnixSeconds,
  getExpandableId,
  getExpanded,
} from './stripe-mapper.utils';
import { mapStripePayment } from './stripe-payment.mapper';
import { mapStripeRefund } from './stripe-refund.mapper';

const STRIPE_INVOICE_TRANSITIONS: [
  keyof Stripe.Invoice.StatusTransitions,
  InvoiceEventType,
][] = [
  ['finalized_at', 'finalized'],
  ['paid_at', 'paid'],
  ['voided_at', 'voided'],
  ['marked_uncollectible_at', 'uncollectible'],
];

const toList = (value: string | null): string[] => (value ? [value] : []);

export const mapStripeInvoiceLineItem = (
  lineItem: Stripe.InvoiceLineItem,
  amountRefunded = 0,
): InvoiceLineItem => ({
  id: lineItem.id,
  description: lineItem.description,
  amount: lineItem.amount,
  quantity: lineItem.quantity,
  unitAmount: lineItem.price?.unit_amount ?? null,
  priceId: lineItem.price?.id ?? null,
  subscriptionId: getExpandableId(lineItem.subscription),
  periodStart: fromUnixSeconds(lineItem.period?.start),
  periodEnd: fromUnixSeconds(lineItem.period?.end),
  proration: lineItem.proration,
  recurring: lineItem.type === 'subscription',
  amountRefunded,
  metadata: lineItem.metadata ?? {},
});

const mapStripeInvoiceTimeline = (invoice: Stripe.Invoice): InvoiceEvent[] => {
  const events: InvoiceEvent[] = [
    { type: 'created', at: new Date(invoice.created * 1000) },
  ];

  for (const [transition, type] of STRIPE_INVOICE_TRANSITIONS) {
    const at = fromUnixSeconds(invoice.status_transitions?.[transition]);

    if (at) events.push({ type, at });
  }

  return events.sort(
    (first, second) => first.at.getTime() - second.at.getTime(),
  );
};

export const mapStripeInvoice = (
  invoice: Stripe.Invoice,
  relations: ReadonlySet<InvoiceRelation> = new Set(),
  amountsRefundedByLineItem: ReadonlyMap<string, number> = new Map(),
): Invoice & Partial<InvoiceWith<InvoiceRelation>> => {
  const paymentIntent = getExpanded(invoice.payment_intent);

  return {
    id: invoice.id,
    number: invoice.number,
    customerId: getExpandableId(invoice.customer),
    subscriptionIds: toList(getExpandableId(invoice.subscription)),
    billingReason: invoice.billing_reason,
    status: (invoice.status ?? 'draft') satisfies InvoiceStatus,
    currency: invoice.currency.toUpperCase(),
    subtotal: invoice.subtotal,
    tax: invoice.tax ?? 0,
    total: invoice.total,
    amountPaid: invoice.amount_paid,
    amountRemaining: invoice.amount_remaining,
    attemptCount: invoice.attempt_count ?? 0,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    createdAt: new Date(invoice.created * 1000),
    dueDate: fromUnixSeconds(invoice.due_date),
    paidAt: fromUnixSeconds(invoice.status_transitions?.paid_at),
    metadata: invoice.metadata ?? {},
    provider: CashierProvider.Stripe,
    ...(relations.has('refunds')
      ? { amountRefunded: getExpanded(invoice.charge)?.amount_refunded ?? 0 }
      : {}),
    ...(relations.has('lineItems')
      ? {
          lineItems: (invoice.lines?.data ?? []).map((lineItem) =>
            mapStripeInvoiceLineItem(
              lineItem,
              amountsRefundedByLineItem.get(lineItem.id),
            ),
          ),
        }
      : {}),
    ...(relations.has('payments')
      ? { payments: paymentIntent ? [mapStripePayment(paymentIntent)] : [] }
      : {}),
    ...(relations.has('startingBalance')
      ? { startingBalance: invoice.starting_balance }
      : {}),
    ...(relations.has('timeline')
      ? { timeline: mapStripeInvoiceTimeline(invoice) }
      : {}),
  };
};

export const mapStripeInvoicePreview = (
  invoice: Stripe.UpcomingInvoice,
  subscriptionId: string,
  lineItems: Stripe.InvoiceLineItem[],
): InvoicePreview => ({
  customerId: getExpandableId(invoice.customer),
  subscriptionId,
  currency: invoice.currency.toUpperCase(),
  subtotal: invoice.subtotal,
  tax: invoice.tax ?? 0,
  total: invoice.total,
  amountDue: invoice.amount_due,
  lineItems: lineItems.map((lineItem) => mapStripeInvoiceLineItem(lineItem)),
  nextPaymentAt: fromUnixSeconds(invoice.next_payment_attempt),
  provider: CashierProvider.Stripe,
});

const withoutIdempotencyKey = (
  metadata: Stripe.Metadata | null,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(metadata ?? {}).filter(
      ([key]) => key !== STRIPE_IDEMPOTENCY_METADATA_KEY,
    ),
  );

export const mapStripeCreditNote = (
  creditNote: Stripe.CreditNote,
  lineItems: InvoiceLineItemRefund[],
): InvoiceRefund => {
  const refund = getExpanded(creditNote.refund);

  return {
    id: creditNote.id,
    invoiceId: getExpandableId(creditNote.invoice) ?? '',
    amount: refund?.amount ?? creditNote.amount,
    currency: creditNote.currency.toUpperCase(),
    lineItems,
    refunds: refund ? [mapStripeRefund(refund)] : [],
    metadata: withoutIdempotencyKey(creditNote.metadata),
    createdAt: new Date(creditNote.created * 1000),
    provider: CashierProvider.Stripe,
  };
};
