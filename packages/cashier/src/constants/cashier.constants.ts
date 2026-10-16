import Stripe from 'stripe';
import {
  CashierInvoiceRelations,
  InvoiceCollection,
} from '../types/invoice.types';
import { CashierPaymentRelations, RefundReason } from '../types/payment.types';
import {
  CashierSubscriptionRelations,
  SubscriptionStatus,
} from '../types/subscription.types';

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2023-08-16';

export const DEFAULT_LIST_LIMIT = 100;

export const RECURLY_MAX_LIST_LIMIT = 200;

export const DRIVER_CACHE_SIZE = 100;

export const STRIPE_MAX_CANCELLATION_COMMENT_LENGTH = 5000;

export const DEFAULT_DAYS_UNTIL_DUE = 30;

export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const STRIPE_OFF_SESSION_PAYMENT_METHOD_TYPES = ['card', 'link'];

export const RECURLY_COLLECTION_METHODS: Record<InvoiceCollection, string> = {
  charge_automatically: 'automatic',
  send_invoice: 'manual',
};

export const STRIPE_PAYMENT_RELATION_EXPAND: Record<
  CashierPaymentRelations['stripe'],
  string[]
> = {
  refunds: ['latest_charge'],
  dispute: ['latest_charge.dispute'],
  receipt: ['latest_charge'],
  reversal: ['latest_charge.refunds'],
  subscription: ['invoice.subscription'],
};

export const STRIPE_REFUND_REASONS: Record<
  RefundReason,
  Stripe.RefundCreateParams.Reason
> = {
  [RefundReason.Duplicate]: 'duplicate',
  [RefundReason.Fraudulent]: 'fraudulent',
  [RefundReason.RequestedByCustomer]: 'requested_by_customer',
};

export const STRIPE_INVOICE_RELATION_EXPAND: Record<
  CashierInvoiceRelations['stripe'],
  string[]
> = {
  refunds: ['charge'],
};

export const RECURLY_PAYMENT_RELATIONS: ReadonlySet<
  CashierPaymentRelations['recurly']
> = new Set(['refunds', 'subscription']);

export const STRIPE_SUBSCRIPTION_RELATIONS: ReadonlySet<
  CashierSubscriptionRelations['stripe']
> = new Set(['product', 'interval', 'pause', 'discount']);

export const RECURLY_SUBSCRIPTION_RELATIONS: ReadonlySet<
  CashierSubscriptionRelations['recurly']
> = new Set(['product', 'interval', 'pause', 'discount']);

export const STRIPE_SUBSCRIPTION_STATUS_FILTERS: Partial<
  Record<SubscriptionStatus, Stripe.SubscriptionListParams.Status>
> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'unpaid',
  paused: 'paused',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete_expired',
};

export const RECURLY_SUBSCRIPTION_STATE_FILTERS: Partial<
  Record<SubscriptionStatus, string>
> = {
  active: 'live',
  canceled: 'expired',
  future: 'future',
};

export const RECURLY_INVOICE_RELATIONS: ReadonlySet<
  CashierInvoiceRelations['recurly']
> = new Set(['refunds']);

export const STRIPE_PAYMENT_METHOD_ERROR_CODES: ReadonlySet<string> = new Set([
  'expired_card',
  'incorrect_cvc',
  'incorrect_number',
  'incorrect_zip',
  'invalid_cvc',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'invalid_number',
  'payment_method_unactivated',
  'payment_method_unexpected_state',
]);

export const RECURLY_PAYMENT_METHOD_ERROR_CODES: ReadonlySet<string> = new Set([
  'expired_card',
  'invalid_card_number',
  'invalid_security_code',
  'invalid_expiration_date',
  'invalid_billing_info',
  'billing_info_not_found',
]);
