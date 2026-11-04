import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  Payment,
  PaymentEvent,
  PaymentRelation,
  PaymentStatus,
  PaymentSubscription,
  PaymentWith,
} from '../../../types/payment.types';
import { toMinorUnits } from '../../../utils/money.utils';
import { mapRecurlyPaymentMethodDetails } from './recurly-payment-method.mapper';
import { mapRecurlyRefundTransaction } from './recurly-refund.mapper';

const RECURLY_PAYMENT_STATUSES: Record<string, PaymentStatus> = {
  success: 'succeeded',
  pending: 'pending',
  processing: 'pending',
  scheduled: 'pending',
  declined: 'failed',
  error: 'failed',
  void: 'canceled',
};

export const mapRecurlyPaymentStatus = (
  status: string | null | undefined,
): PaymentStatus => RECURLY_PAYMENT_STATUSES[status ?? ''] ?? 'unknown';

const mapRecurlyPaymentSubscription = (
  subscriptionIds: string[] | null | undefined,
): PaymentSubscription | null => {
  const id = subscriptionIds?.[0];

  return id ? { id, status: null, cancelAt: null } : null;
};

const COUNTED_REFUND_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'succeeded',
  'pending',
]);

const isCountedRefund = (refund: recurly.Transaction): boolean =>
  COUNTED_REFUND_STATUSES.has(mapRecurlyPaymentStatus(refund.status));

const toMinorAmount = (transaction: recurly.Transaction): number =>
  toMinorUnits(
    Math.abs(transaction.amount ?? 0),
    (transaction.currency ?? '').toUpperCase(),
  );

const mapRecurlyPaymentTimeline = (
  transaction: recurly.Transaction,
  refunds: recurly.Transaction[],
): PaymentEvent[] => {
  const amount = toMinorAmount(transaction);
  const createdAt = transaction.createdAt ?? new Date(0);
  const status = mapRecurlyPaymentStatus(transaction.status);
  const events: PaymentEvent[] = [{ type: 'created', at: createdAt, amount }];

  if (status === 'succeeded') {
    events.push({
      type: 'succeeded',
      at: transaction.collectedAt ?? createdAt,
      amount,
    });
  }

  if (status === 'failed') {
    events.push({ type: 'failed', at: createdAt, amount });
  }

  if (transaction.voidedAt) {
    events.push({ type: 'canceled', at: transaction.voidedAt, amount: null });
  }

  for (const refund of refunds.filter(isCountedRefund)) {
    events.push({
      type: 'refunded',
      at: refund.createdAt ?? createdAt,
      amount: toMinorAmount(refund),
    });
  }

  return events.sort(
    (first, second) => first.at.getTime() - second.at.getTime(),
  );
};

export const mapRecurlyPayment = (
  transaction: recurly.Transaction,
  relations: ReadonlySet<PaymentRelation> = new Set(),
  refunds: recurly.Transaction[] = [],
): Payment & Partial<PaymentWith<PaymentRelation>> => {
  const currency = (transaction.currency ?? '').toUpperCase();
  const paymentId = transaction.id ?? '';

  return {
    id: paymentId,
    customerId: transaction.account?.id ?? null,
    invoiceId: transaction.invoice?.id ?? null,
    status: mapRecurlyPaymentStatus(transaction.status),
    amount: toMinorUnits(transaction.amount ?? 0, currency),
    currency,
    description: transaction.description ?? null,
    createdAt: transaction.createdAt ?? new Date(0),
    provider: CashierProvider.Recurly,
    ...(relations.has('refunds')
      ? {
          amountRefunded: sumRecurlyRefunds(refunds),
          refunds: refunds.map((refund) =>
            mapRecurlyRefundTransaction(refund, paymentId),
          ),
        }
      : {}),
    ...(relations.has('subscription')
      ? {
          subscription: mapRecurlyPaymentSubscription(
            transaction.subscriptionIds,
          ),
        }
      : {}),
    ...(relations.has('paymentMethod')
      ? {
          paymentMethod: transaction.paymentMethod
            ? mapRecurlyPaymentMethodDetails(transaction.paymentMethod)
            : null,
        }
      : {}),
    ...(relations.has('timeline')
      ? { timeline: mapRecurlyPaymentTimeline(transaction, refunds) }
      : {}),
  };
};

export const sumRecurlyRefunds = (refunds: recurly.Transaction[]): number =>
  refunds
    .filter(isCountedRefund)
    .reduce((total, refund) => total + toMinorAmount(refund), 0);

export const groupRecurlyRefunds = (
  refunds: recurly.Transaction[],
): Map<string, recurly.Transaction[]> => {
  const grouped = new Map<string, recurly.Transaction[]>();

  for (const refund of refunds) {
    const originalId = refund.originalTransactionId;

    if (!originalId) continue;

    grouped.set(originalId, [...(grouped.get(originalId) ?? []), refund]);
  }

  return grouped;
};
