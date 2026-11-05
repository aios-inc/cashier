import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  Invoice,
  InvoiceEvent,
  InvoiceEventType,
  InvoiceLineItem,
  InvoicePreview,
  InvoiceRelation,
  InvoiceStatus,
  InvoiceWith,
} from '../../../types/invoice.types';
import { RECURLY_PAYMENT_TRANSACTION_TYPES } from '../../../constants/cashier.constants';
import { toMinorUnits } from '../../../utils/money.utils';
import { mapRecurlyPayment } from './recurly-payment.mapper';

const RECURLY_INVOICE_STATUSES: Record<string, InvoiceStatus> = {
  pending: 'open',
  processing: 'open',
  open: 'open',
  past_due: 'past_due',
  paid: 'paid',
  failed: 'failed',
  voided: 'void',
  closed: 'closed',
};

const RECURLY_INVOICE_CLOSED_EVENTS: Record<string, InvoiceEventType> = {
  paid: 'paid',
  failed: 'failed',
  voided: 'voided',
};

export const mapRecurlyInvoiceStatus = (
  state: string | null | undefined,
): InvoiceStatus => RECURLY_INVOICE_STATUSES[state ?? ''] ?? 'unknown';

const mapRecurlyInvoiceAmountRefunded = (
  invoice: recurly.Invoice,
  currency: string,
): number => {
  const refundable = invoice.refundableAmount;

  if (invoice.type !== 'charge' || typeof refundable !== 'number') return 0;

  return (
    toMinorUnits(invoice.paid ?? 0, currency) -
    toMinorUnits(refundable, currency)
  );
};

const toMinorOrNull = (
  amount: number | null | undefined,
  currency: string,
): number | null =>
  amount === null || amount === undefined
    ? null
    : toMinorUnits(amount, currency);

export const mapRecurlyInvoiceLineItem = (
  lineItem: recurly.LineItem,
  invoiceCurrency: string,
): InvoiceLineItem => {
  const currency = (lineItem.currency ?? invoiceCurrency).toUpperCase();

  return {
    id: lineItem.id ?? '',
    description: lineItem.description ?? null,
    amount: toMinorUnits(lineItem.amount ?? 0, currency),
    quantity: lineItem.quantity ?? null,
    unitAmount: toMinorOrNull(lineItem.unitAmount, currency),
    priceId: lineItem.planId ?? null,
    subscriptionId: lineItem.subscriptionId ?? null,
    periodStart: lineItem.startDate ?? null,
    periodEnd: lineItem.endDate ?? null,
    proration: (lineItem.prorationRate ?? 1) !== 1,
  };
};

const mapRecurlyInvoiceTimeline = (
  invoice: recurly.Invoice,
): InvoiceEvent[] => {
  const events: InvoiceEvent[] = [
    { type: 'created', at: invoice.createdAt ?? new Date(0) },
  ];
  const closed = RECURLY_INVOICE_CLOSED_EVENTS[invoice.state ?? ''];

  if (closed && invoice.closedAt) {
    events.push({ type: closed, at: invoice.closedAt });
  }

  return events;
};

export const mapRecurlyInvoice = (
  invoice: recurly.Invoice,
  relations: ReadonlySet<InvoiceRelation> = new Set(),
): Invoice & Partial<InvoiceWith<InvoiceRelation>> => {
  const currency = (invoice.currency ?? '').toUpperCase();

  return {
    id: invoice.id ?? '',
    number: invoice.number ?? null,
    customerId: invoice.account?.id ?? null,
    subscriptionIds: invoice.subscriptionIds ?? [],
    billingReason: invoice.origin ?? null,
    status: mapRecurlyInvoiceStatus(invoice.state),
    currency,
    subtotal: toMinorUnits(invoice.subtotal ?? 0, currency),
    tax: toMinorUnits(invoice.tax ?? 0, currency),
    total: toMinorUnits(invoice.total ?? 0, currency),
    amountPaid: toMinorUnits(invoice.paid ?? 0, currency),
    amountRemaining: toMinorUnits(invoice.balance ?? 0, currency),
    attemptCount: 0,
    hostedInvoiceUrl: null,
    createdAt: invoice.createdAt ?? new Date(0),
    dueDate: invoice.dueAt ?? null,
    paidAt: invoice.state === 'paid' ? (invoice.closedAt ?? null) : null,
    provider: CashierProvider.Recurly,
    ...(relations.has('refunds')
      ? { amountRefunded: mapRecurlyInvoiceAmountRefunded(invoice, currency) }
      : {}),
    ...(relations.has('lineItems')
      ? {
          lineItems: (invoice.lineItems ?? []).map((lineItem) =>
            mapRecurlyInvoiceLineItem(lineItem, currency),
          ),
        }
      : {}),
    ...(relations.has('payments')
      ? {
          payments: (invoice.transactions ?? [])
            .filter((transaction) =>
              RECURLY_PAYMENT_TRANSACTION_TYPES.has(transaction.type ?? ''),
            )
            .map((transaction) => mapRecurlyPayment(transaction)),
        }
      : {}),
    ...(relations.has('timeline')
      ? { timeline: mapRecurlyInvoiceTimeline(invoice) }
      : {}),
  };
};

export const mapRecurlyInvoicePreview = (
  invoice: recurly.Invoice,
  subscriptionId: string,
): InvoicePreview => {
  const currency = (invoice.currency ?? '').toUpperCase();
  const total = toMinorUnits(invoice.total ?? 0, currency);

  return {
    customerId: invoice.account?.id ?? null,
    subscriptionId,
    currency,
    subtotal: toMinorUnits(invoice.subtotal ?? 0, currency),
    tax: toMinorUnits(invoice.tax ?? 0, currency),
    total,
    amountDue: toMinorOrNull(invoice.balance, currency) ?? total,
    lineItems: (invoice.lineItems ?? []).map((lineItem) =>
      mapRecurlyInvoiceLineItem(lineItem, currency),
    ),
    nextPaymentAt: invoice.dueAt ?? null,
    provider: CashierProvider.Recurly,
  };
};

export const mapRecurlySubscriptionPreview = (
  subscription: recurly.Subscription,
  change?: recurly.SubscriptionChange,
): InvoicePreview => {
  const currency = (subscription.currency ?? '').toUpperCase();
  const subscriptionId = subscription.id ?? '';
  const plan = change?.plan ?? subscription.plan;
  const quantity = change?.quantity ?? subscription.quantity ?? 1;
  const unitAmount = change?.unitAmount ?? subscription.unitAmount ?? 0;
  const periodStart = subscription.currentPeriodEndsAt ?? null;
  const toLineItem = (
    id: string,
    description: string | null,
    itemUnitAmount: number,
    itemQuantity: number,
    priceId: string | null,
  ): InvoiceLineItem => ({
    id,
    description,
    amount: toMinorUnits(itemUnitAmount * itemQuantity, currency),
    quantity: itemQuantity,
    unitAmount: toMinorUnits(itemUnitAmount, currency),
    priceId,
    subscriptionId,
    periodStart,
    periodEnd: null,
    proration: false,
  });
  const lineItems = [
    toLineItem(
      subscriptionId,
      plan?.name ?? null,
      unitAmount,
      quantity,
      plan?.id ?? null,
    ),
    ...(change?.addOns ?? subscription.addOns ?? []).map((addOn) =>
      toLineItem(
        addOn.id ?? '',
        addOn.addOn?.name ?? null,
        addOn.unitAmount ?? 0,
        addOn.quantity ?? 1,
        null,
      ),
    ),
  ];
  const lineItemsTotal = lineItems.reduce(
    (total, lineItem) => total + lineItem.amount,
    0,
  );
  const subtotal = change
    ? lineItemsTotal
    : toMinorUnits(subscription.subtotal ?? 0, currency);
  const tax = change ? 0 : toMinorUnits(subscription.tax ?? 0, currency);
  const total = change
    ? subtotal
    : toMinorUnits(subscription.total ?? 0, currency);

  return {
    customerId: subscription.account?.id ?? null,
    subscriptionId,
    currency,
    subtotal,
    tax,
    total,
    amountDue: total,
    lineItems,
    nextPaymentAt: subscription.currentPeriodEndsAt ?? null,
    provider: CashierProvider.Recurly,
  };
};
