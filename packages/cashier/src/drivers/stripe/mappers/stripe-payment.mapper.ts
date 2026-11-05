import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  Payment,
  PaymentDispute,
  PaymentDisputeStatus,
  PaymentEvent,
  PaymentEventType,
  PaymentRelation,
  PaymentRelationFields,
  PaymentStatus,
  PaymentSubscription,
  PaymentWith,
} from '../../../types/payment.types';
import { SubscriptionStatus } from '../../../types/subscription.types';
import {
  fromUnixSeconds,
  getExpandableId,
  getExpanded,
} from './stripe-mapper.utils';
import { mapStripePaymentMethodDetails } from './stripe-payment-method.mapper';
import { mapStripeRefund } from './stripe-refund.mapper';
import { getStripeCancelAt } from './stripe-subscription.mapper';

type StripeRefund = Stripe.Refund & {
  destination_details?: { card?: { type?: string | null } | null } | null;
};

type StripeCharge = Omit<Stripe.Charge, 'refunds'> & {
  dispute?: string | Stripe.Dispute | null;
  refunds?: Stripe.ApiList<StripeRefund> | null;
};

const STRIPE_PAYMENT_STATUSES: Record<
  Stripe.PaymentIntent.Status,
  PaymentStatus
> = {
  succeeded: 'succeeded',
  processing: 'pending',
  requires_capture: 'pending',
  requires_payment_method: 'incomplete',
  requires_confirmation: 'incomplete',
  requires_action: 'incomplete',
  canceled: 'canceled',
};

const STRIPE_DISPUTE_STATUSES: Record<string, PaymentDisputeStatus> = {
  warning_needs_response: 'warning_needs_response',
  warning_under_review: 'warning_under_review',
  warning_closed: 'warning_closed',
  needs_response: 'needs_response',
  under_review: 'under_review',
  won: 'won',
  lost: 'lost',
};

const mapStripePaymentStatus = (
  paymentIntent: Stripe.PaymentIntent,
): PaymentStatus => {
  if (
    paymentIntent.status === 'requires_payment_method' &&
    paymentIntent.last_payment_error
  ) {
    return 'failed';
  }

  return STRIPE_PAYMENT_STATUSES[paymentIntent.status] ?? 'unknown';
};

const mapStripeDispute = (
  dispute: string | Stripe.Dispute | null | undefined,
): PaymentDispute | null => {
  const expanded = getExpanded(dispute);

  if (!expanded) return null;

  return {
    id: expanded.id,
    status: STRIPE_DISPUTE_STATUSES[expanded.status] ?? 'unknown',
    reason: expanded.reason,
    createdAt: new Date(expanded.created * 1000),
    evidenceDueBy: fromUnixSeconds(expanded.evidence_details?.due_by),
  };
};

const COUNTED_REFUND_STATUSES: ReadonlySet<string> = new Set([
  'succeeded',
  'pending',
]);

const toPaymentEvent = (
  type: PaymentEventType,
  at: number,
  amount: number | null,
): PaymentEvent => ({ type, at: new Date(at * 1000), amount });

const mapStripePaymentTimeline = (
  paymentIntent: Stripe.PaymentIntent,
  charge: StripeCharge | null,
): PaymentEvent[] => {
  const events = [
    toPaymentEvent('created', paymentIntent.created, paymentIntent.amount),
  ];

  if (charge?.status === 'succeeded' || charge?.status === 'failed') {
    events.push(toPaymentEvent(charge.status, charge.created, charge.amount));
  }

  for (const refund of charge?.refunds?.data ?? []) {
    if (COUNTED_REFUND_STATUSES.has(refund.status ?? '')) {
      events.push(toPaymentEvent('refunded', refund.created, refund.amount));
    }
  }

  const dispute = getExpanded(charge?.dispute);

  if (dispute) {
    events.push(toPaymentEvent('disputed', dispute.created, dispute.amount));
  }

  if (paymentIntent.canceled_at) {
    events.push(toPaymentEvent('canceled', paymentIntent.canceled_at, null));
  }

  return events.sort(
    (first, second) => first.at.getTime() - second.at.getTime(),
  );
};

const mapStripeFees = (
  charge: StripeCharge | null,
): PaymentRelationFields['fees'] => {
  const balanceTransaction = getExpanded(charge?.balance_transaction);

  return {
    fee: balanceTransaction?.fee ?? null,
    net: balanceTransaction?.net ?? null,
  };
};

const isReversed = (charge: StripeCharge | null): boolean =>
  charge?.refunds?.data.some(
    (refund) => refund.destination_details?.card?.type === 'reversal',
  ) ?? false;

const mapStripePaymentSubscription = (
  invoice: string | Stripe.Invoice | null,
): PaymentSubscription | null => {
  const subscription = getExpanded(invoice)?.subscription;

  if (!subscription) return null;

  if (typeof subscription === 'string') {
    return { id: subscription, status: null, cancelAt: null };
  }

  return {
    id: subscription.id,
    status: subscription.status satisfies SubscriptionStatus,
    cancelAt: getStripeCancelAt(subscription),
  };
};

export const mapStripePayment = (
  paymentIntent: Stripe.PaymentIntent,
  relations: ReadonlySet<PaymentRelation> = new Set(),
): Payment & Partial<PaymentWith<PaymentRelation>> => {
  const charge = getExpanded(
    paymentIntent.latest_charge as string | StripeCharge | null | undefined,
  );

  return {
    id: paymentIntent.id,
    customerId: getExpandableId(paymentIntent.customer),
    invoiceId: getExpandableId(paymentIntent.invoice),
    status: mapStripePaymentStatus(paymentIntent),
    amount: paymentIntent.amount,
    currency: paymentIntent.currency.toUpperCase(),
    description: paymentIntent.description,
    createdAt: new Date(paymentIntent.created * 1000),
    provider: CashierProvider.Stripe,
    ...(relations.has('refunds')
      ? {
          amountRefunded: charge?.amount_refunded ?? 0,
          refunds: (charge?.refunds?.data ?? []).map(mapStripeRefund),
        }
      : {}),
    ...(relations.has('dispute')
      ? { dispute: mapStripeDispute(charge?.dispute) }
      : {}),
    ...(relations.has('receipt')
      ? { receiptUrl: charge?.receipt_url ?? null }
      : {}),
    ...(relations.has('reversal') ? { reversed: isReversed(charge) } : {}),
    ...(relations.has('subscription')
      ? { subscription: mapStripePaymentSubscription(paymentIntent.invoice) }
      : {}),
    ...(relations.has('paymentMethod')
      ? {
          paymentMethod: charge?.payment_method_details
            ? mapStripePaymentMethodDetails(charge.payment_method_details)
            : null,
        }
      : {}),
    ...(relations.has('fees') ? mapStripeFees(charge) : {}),
    ...(relations.has('statementDescriptor')
      ? {
          statementDescriptor:
            charge?.calculated_statement_descriptor ??
            paymentIntent.statement_descriptor ??
            null,
        }
      : {}),
    ...(relations.has('timeline')
      ? { timeline: mapStripePaymentTimeline(paymentIntent, charge) }
      : {}),
  };
};
