import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  Refund,
  RefundReason,
  RefundStatus,
} from '../../../types/payment.types';
import { STRIPE_REFUND_REASONS } from '../../../constants/cashier.constants';
import { getExpandableId } from './stripe-mapper.utils';

const STRIPE_REFUND_STATUSES: Record<string, RefundStatus> = {
  succeeded: 'succeeded',
  pending: 'pending',
  requires_action: 'pending',
  failed: 'failed',
  canceled: 'canceled',
};

const mapStripeRefundReason = (
  reason: Stripe.Refund.Reason | null,
): RefundReason | null =>
  Object.values(RefundReason).find(
    (refundReason) => STRIPE_REFUND_REASONS[refundReason] === reason,
  ) ?? null;

export const mapStripeRefund = (refund: Stripe.Refund): Refund => ({
  id: refund.id,
  paymentId: getExpandableId(refund.payment_intent) ?? '',
  status: STRIPE_REFUND_STATUSES[refund.status ?? ''] ?? 'unknown',
  amount: refund.amount,
  currency: refund.currency.toUpperCase(),
  reason: mapStripeRefundReason(refund.reason),
  metadata: refund.metadata ?? {},
  createdAt: new Date(refund.created * 1000),
  provider: CashierProvider.Stripe,
});
