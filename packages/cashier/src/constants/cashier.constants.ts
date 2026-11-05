import Stripe from 'stripe';
import * as recurly from 'recurly';
import {
  CashierInvoiceRelations,
  InvoiceCollection,
} from '../types/invoice.types';
import { PaymentMethodWallet } from '../types/payment-method.types';
import { CashierPaymentRelations, RefundReason } from '../types/payment.types';
import {
  CashierSubscriptionRelations,
  SubscriptionProration,
  SubscriptionRefund,
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
  refunds: ['latest_charge.refunds'],
  dispute: ['latest_charge.dispute'],
  receipt: ['latest_charge'],
  reversal: ['latest_charge.refunds'],
  subscription: ['invoice.subscription'],
  paymentMethod: ['latest_charge'],
  fees: ['latest_charge.balance_transaction'],
  statementDescriptor: ['latest_charge'],
  timeline: ['latest_charge.refunds', 'latest_charge.dispute'],
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
  lineItems: [],
  payments: ['payment_intent'],
  startingBalance: [],
  timeline: [],
};

export const RECURLY_PAYMENT_RELATIONS: ReadonlySet<
  CashierPaymentRelations['recurly']
> = new Set(['refunds', 'subscription', 'paymentMethod', 'timeline']);

export const STRIPE_SUBSCRIPTION_RELATION_EXPAND: Record<
  CashierSubscriptionRelations['stripe'],
  string[]
> = {
  product: [],
  interval: [],
  pause: [],
  discount: [],
  paymentMethod: [
    'default_payment_method',
    'customer.invoice_settings.default_payment_method',
  ],
  latestInvoice: ['latest_invoice'],
};

export const RECURLY_SUBSCRIPTION_RELATIONS: ReadonlySet<
  CashierSubscriptionRelations['recurly']
> = new Set([
  'product',
  'interval',
  'pause',
  'discount',
  'paymentMethod',
  'latestInvoice',
]);

export const STRIPE_PRORATION_BEHAVIORS: Record<
  SubscriptionProration,
  Stripe.SubscriptionUpdateParams.ProrationBehavior
> = {
  prorate: 'create_prorations',
  none: 'none',
  invoiceNow: 'always_invoice',
};

export const STRIPE_WALLETS: Record<string, PaymentMethodWallet> = {
  apple_pay: 'apple_pay',
  google_pay: 'google_pay',
  link: 'link',
};

export const STRIPE_BANK_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'acss_debit',
  'au_becs_debit',
  'bacs_debit',
  'sepa_debit',
  'us_bank_account',
]);

export const RECURLY_CARD_BRANDS: Record<string, string> = {
  visa: 'visa',
  mastercard: 'mastercard',
  'american express': 'amex',
  discover: 'discover',
  jcb: 'jcb',
  'diners club': 'diners',
  'union pay': 'unionpay',
};

export const RECURLY_WALLETS: Record<string, PaymentMethodWallet> = {
  apple_pay: 'apple_pay',
  apple_pay_merchant_token: 'apple_pay',
  braintree_apple_pay: 'apple_pay',
  google_pay: 'google_pay',
  google_pay_device_pan: 'google_pay',
};

export const RECURLY_BANK_ACCOUNT_OBJECTS: ReadonlySet<string> = new Set([
  'bank_account_info',
  'eft',
  'iban_bank_account',
  'sepadirectdebit',
]);

export const RECURLY_PAYPAL_OBJECTS: ReadonlySet<string> = new Set([
  'braintree_paypal',
  'paypal',
  'paypal_billing_agreement',
]);

export const RECURLY_PAYMENT_TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  'purchase',
  'capture',
]);

export const RECURLY_NO_PRORATION: recurly.ProrationSettings = {
  charge: 'none',
  credit: 'none',
};

export const RECURLY_SUBSCRIPTION_REFUNDS: Record<SubscriptionRefund, string> =
  {
    full: 'full',
    prorated: 'partial',
  };

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
> = new Set(['refunds', 'lineItems', 'payments', 'timeline']);

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

export const STRIPE_PAYMENT_METHOD_PARAMS: ReadonlySet<string> = new Set([
  'default_payment_method',
  'invoice_settings[default_payment_method]',
  'payment_method',
]);

export const RECURLY_PAYMENT_METHOD_PARAMS: ReadonlySet<string> = new Set([
  'billing_info_id',
]);

export const RECURLY_PAYMENT_METHOD_ERROR_CODES: ReadonlySet<string> = new Set([
  'expired_card',
  'invalid_card_number',
  'invalid_security_code',
  'invalid_expiration_date',
  'invalid_billing_info',
  'billing_info_not_found',
]);
