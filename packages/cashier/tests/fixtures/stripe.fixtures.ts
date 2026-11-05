import Stripe from 'stripe';
import { Customer } from '../../src/types/customer.types';
import { Invoice } from '../../src/types/invoice.types';
import {
  Payment,
  PaymentWith,
  Refund,
  RefundReason,
} from '../../src/types/payment.types';
import { Product } from '../../src/types/product.types';
import { Price } from '../../src/types/price.types';
import {
  Subscription,
  SubscriptionWith,
} from '../../src/types/subscription.types';
import { CashierProvider } from '../../src/types/cashier.types';

const SUBSCRIPTION_INVOICE = {
  id: 'in_123',
  number: 'INV-001',
  customer: 'cus_123',
  subscription: 'sub_123',
  billing_reason: 'subscription_cycle',
  status: 'paid',
  currency: 'usd',
  subtotal: 15000,
  tax: null,
  total: 15000,
  amount_paid: 15000,
  amount_remaining: 0,
  charge: { id: 'ch_123', amount_refunded: 5000 },
  attempt_count: 1,
  hosted_invoice_url: 'https://invoice.stripe.com/i/in_123',
  created: 1767225600,
  due_date: null,
  status_transitions: { paid_at: 1767229200 },
} as unknown as Stripe.Invoice;

const EXPANDED_DRAFT_INVOICE = {
  id: 'in_456',
  number: null,
  customer: { id: 'cus_123' },
  subscription: null,
  billing_reason: 'manual',
  status: null,
  currency: 'gbp',
  subtotal: 5000,
  tax: 1000,
  total: 6000,
  amount_paid: 0,
  amount_remaining: 6000,
  charge: null,
  attempt_count: 0,
  hosted_invoice_url: null,
  created: 1767312000,
  due_date: 1767916800,
  status_transitions: { paid_at: null },
} as unknown as Stripe.Invoice;

const PRODUCT = {
  id: 'prod_123',
  name: 'Pro Plan',
  description: null,
  active: true,
  created: 1767225600,
} as unknown as Stripe.Product;

const RECURRING_PRICE = {
  id: 'price_123',
  product: 'prod_123',
  currency: 'usd',
  unit_amount: 29900,
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 3 },
  active: true,
  created: 1767225600,
} as unknown as Stripe.Price;

const ONE_TIME_PRICE = {
  id: 'price_456',
  product: { id: 'prod_123' },
  currency: 'gbp',
  unit_amount: null,
  type: 'one_time',
  recurring: null,
  active: false,
  created: 1767312000,
} as unknown as Stripe.Price;

const SUBSCRIPTION = {
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  items: {
    data: [
      {
        id: 'si_123',
        price: {
          id: 'price_123',
          unit_amount: 29900,
          product: 'prod_123',
          recurring: { interval: 'month', interval_count: 1 },
        },
        quantity: 1,
      },
    ],
  },
  currency: 'usd',
  current_period_start: 1767225600,
  current_period_end: 1769904000,
  cancel_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  trial_end: null,
  pause_collection: null,
  discount: null,
  start_date: 1767225600,
  created: 1767225600,
  metadata: { source: 'checkout' },
} as unknown as Stripe.Subscription;

const PAUSED_DISCOUNTED_SUBSCRIPTION = {
  ...SUBSCRIPTION,
  id: 'sub_456',
  status: 'paused',
  items: {
    data: [
      {
        id: 'si_456',
        price: {
          id: 'price_456',
          unit_amount: 299000,
          product: { id: 'prod_456' },
          recurring: { interval: 'year', interval_count: 1 },
        },
        quantity: 1,
      },
    ],
  },
  pause_collection: { behavior: 'void', resumes_at: 1769904000 },
  discount: {
    coupon: {
      id: 'WELCOME10',
      name: 'Welcome',
      amount_off: null,
      percent_off: 10,
    },
  },
} as unknown as Stripe.Subscription;

const SUBSCRIPTION_PRODUCTS = [
  { id: 'prod_123', name: 'Pro Plan' },
  { id: 'prod_456', name: 'Pro Annual' },
] as unknown as Stripe.Product[];

const MULTI_ITEM_SUBSCRIPTION = {
  ...SUBSCRIPTION,
  items: {
    data: [
      { id: 'si_1', price: { id: 'price_1', unit_amount: 100 }, quantity: 1 },
      { id: 'si_2', price: { id: 'price_2', unit_amount: 200 }, quantity: 1 },
    ],
  },
} as unknown as Stripe.Subscription;

const CUSTOMER = {
  id: 'cus_123',
  email: 'jane@example.com',
  name: 'Jane Doe',
  metadata: { source: 'checkout' },
  created: 1767225600,
} as unknown as Stripe.Customer;

const DELETED_CUSTOMER = {
  id: 'cus_123',
  deleted: true,
} as unknown as Stripe.DeletedCustomer;

const DISPUTE = {
  id: 'dp_123',
  amount: 12900,
  status: 'needs_response',
  reason: 'fraudulent',
  created: 1767398400,
  evidence_details: { due_by: 1768262400 },
} as unknown as Stripe.Dispute;

const REFUNDED_CHARGE = {
  id: 'ch_123',
  amount_refunded: 4000,
  receipt_url: 'https://pay.stripe.com/receipts/ch_123',
  dispute: DISPUTE,
  refunds: {
    data: [
      {
        id: 're_1',
        payment_intent: 'pi_123',
        status: 'succeeded',
        amount: 3000,
        currency: 'gbp',
        reason: null,
        created: 1767484800,
        destination_details: { card: { type: 'refund' } },
      },
      {
        id: 're_2',
        payment_intent: 'pi_123',
        status: 'succeeded',
        amount: 1000,
        currency: 'gbp',
        reason: 'requested_by_customer',
        created: 1767571200,
        destination_details: { card: { type: 'reversal' } },
      },
    ],
  },
} as unknown as Stripe.Charge;

const SUCCEEDED_PAYMENT_INTENT = {
  id: 'pi_123',
  customer: 'cus_123',
  invoice: {
    id: 'in_123',
    subscription: { ...SUBSCRIPTION, cancel_at_period_end: true },
  },
  latest_charge: REFUNDED_CHARGE,
  status: 'succeeded',
  amount: 12900,
  currency: 'gbp',
  description: 'Wegovy 0.5mg',
  last_payment_error: null,
  created: 1767225600,
} as unknown as Stripe.PaymentIntent;

const FAILED_PAYMENT_INTENT = {
  id: 'pi_456',
  customer: { id: 'cus_123' },
  invoice: null,
  latest_charge: null,
  status: 'requires_payment_method',
  amount: 11900,
  currency: 'gbp',
  description: null,
  last_payment_error: { code: 'card_declined' },
  created: 1767312000,
} as unknown as Stripe.PaymentIntent;

const INCOMPLETE_PAYMENT_INTENT = {
  id: 'pi_789',
  customer: 'cus_123',
  invoice: { id: 'in_456', subscription: 'sub_456' },
  latest_charge: 'ch_789',
  status: 'requires_action',
  amount: 8900,
  currency: 'gbp',
  description: 'Wegovy 0.25mg',
  last_payment_error: null,
  created: 1767398400,
} as unknown as Stripe.PaymentIntent;

const REFUND = {
  id: 're_123',
  object: 'refund',
  payment_intent: 'pi_123',
  status: 'succeeded',
  amount: 12900,
  currency: 'gbp',
  reason: 'requested_by_customer',
  metadata: {},
  created: 1767484800,
} as unknown as Stripe.Refund;

export const STRIPE_FIXTURES = {
  CUSTOMER,
  DELETED_CUSTOMER,
  CUSTOMER_EMAIL: 'jane@example.com',
  EXPECTED_CUSTOMER: {
    id: 'cus_123',
    code: null,
    email: 'jane@example.com',
    name: 'Jane Doe',
    metadata: { source: 'checkout' },
    createdAt: new Date(1767225600 * 1000),
    provider: CashierProvider.Stripe,
  } satisfies Customer,
  CUSTOMER_ID: 'cus_123',
  PAYMENT_ID: 'pi_123',
  REFUND,
  EXPECTED_REFUND: {
    id: 're_123',
    paymentId: 'pi_123',
    status: 'succeeded',
    amount: 12900,
    currency: 'GBP',
    reason: RefundReason.RequestedByCustomer,
    createdAt: new Date(1767484800 * 1000),
    provider: CashierProvider.Stripe,
  } satisfies Refund,
  INVOICE_ID: 'in_123',
  PRODUCT_ID: 'prod_123',
  PRICE_ID: 'price_123',
  NEW_PRICE_ID: 'price_789',
  SUBSCRIPTION_ID: 'sub_123',
  PAYMENT_METHOD_ID: 'pm_123',
  TRIAL_END: new Date('2026-02-01T00:00:00Z'),
  INVOICES: [SUBSCRIPTION_INVOICE, EXPANDED_DRAFT_INVOICE],
  SUBSCRIPTION_INVOICE,
  EXPECTED_INVOICES: [
    {
      id: 'in_123',
      number: 'INV-001',
      customerId: 'cus_123',
      subscriptionIds: ['sub_123'],
      billingReason: 'subscription_cycle',
      status: 'paid',
      currency: 'USD',
      subtotal: 15000,
      tax: 0,
      total: 15000,
      amountPaid: 15000,
      amountRemaining: 0,
      attemptCount: 1,
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_123',
      createdAt: new Date(1767225600 * 1000),
      dueDate: null,
      paidAt: new Date(1767229200 * 1000),
      provider: CashierProvider.Stripe,
    },
    {
      id: 'in_456',
      number: null,
      customerId: 'cus_123',
      subscriptionIds: [],
      billingReason: 'manual',
      status: 'draft',
      currency: 'GBP',
      subtotal: 5000,
      tax: 1000,
      total: 6000,
      amountPaid: 0,
      amountRemaining: 6000,
      attemptCount: 0,
      hostedInvoiceUrl: null,
      createdAt: new Date(1767312000 * 1000),
      dueDate: new Date(1767916800 * 1000),
      paidAt: null,
      provider: CashierProvider.Stripe,
    },
  ] satisfies Invoice[],
  PAYMENT_CURSOR: 'pi_123',
  REFUNDED_CHARGE,
  DISPUTE,
  SUCCEEDED_PAYMENT_INTENT,
  PAYMENT_INTENTS: [
    SUCCEEDED_PAYMENT_INTENT,
    FAILED_PAYMENT_INTENT,
    INCOMPLETE_PAYMENT_INTENT,
  ],
  EXPECTED_PAYMENTS: [
    {
      id: 'pi_123',
      customerId: 'cus_123',
      invoiceId: 'in_123',
      status: 'succeeded',
      amount: 12900,
      currency: 'GBP',
      description: 'Wegovy 0.5mg',
      createdAt: new Date(1767225600 * 1000),
      provider: CashierProvider.Stripe,
    },
    {
      id: 'pi_456',
      customerId: 'cus_123',
      invoiceId: null,
      status: 'failed',
      amount: 11900,
      currency: 'GBP',
      description: null,
      createdAt: new Date(1767312000 * 1000),
      provider: CashierProvider.Stripe,
    },
    {
      id: 'pi_789',
      customerId: 'cus_123',
      invoiceId: 'in_456',
      status: 'incomplete',
      amount: 8900,
      currency: 'GBP',
      description: 'Wegovy 0.25mg',
      createdAt: new Date(1767398400 * 1000),
      provider: CashierProvider.Stripe,
    },
  ] satisfies Payment[],
  EXPECTED_PAYMENTS_WITH_RELATIONS: [
    {
      id: 'pi_123',
      customerId: 'cus_123',
      invoiceId: 'in_123',
      status: 'succeeded',
      amount: 12900,
      amountRefunded: 4000,
      refunds: [
        {
          id: 're_1',
          paymentId: 'pi_123',
          status: 'succeeded',
          amount: 3000,
          currency: 'GBP',
          reason: null,
          createdAt: new Date(1767484800 * 1000),
          provider: CashierProvider.Stripe,
        },
        {
          id: 're_2',
          paymentId: 'pi_123',
          status: 'succeeded',
          amount: 1000,
          currency: 'GBP',
          reason: RefundReason.RequestedByCustomer,
          createdAt: new Date(1767571200 * 1000),
          provider: CashierProvider.Stripe,
        },
      ],
      currency: 'GBP',
      description: 'Wegovy 0.5mg',
      dispute: {
        id: 'dp_123',
        status: 'needs_response',
        reason: 'fraudulent',
        createdAt: new Date(1767398400 * 1000),
        evidenceDueBy: new Date(1768262400 * 1000),
      },
      receiptUrl: 'https://pay.stripe.com/receipts/ch_123',
      reversed: true,
      subscription: {
        id: 'sub_123',
        status: 'active',
        cancelAt: new Date(1769904000 * 1000),
      },
      createdAt: new Date(1767225600 * 1000),
      provider: CashierProvider.Stripe,
    },
    {
      id: 'pi_456',
      customerId: 'cus_123',
      invoiceId: null,
      status: 'failed',
      amount: 11900,
      amountRefunded: 0,
      refunds: [],
      currency: 'GBP',
      description: null,
      dispute: null,
      receiptUrl: null,
      reversed: false,
      subscription: null,
      createdAt: new Date(1767312000 * 1000),
      provider: CashierProvider.Stripe,
    },
    {
      id: 'pi_789',
      customerId: 'cus_123',
      invoiceId: 'in_456',
      status: 'incomplete',
      amount: 8900,
      amountRefunded: 0,
      refunds: [],
      currency: 'GBP',
      description: 'Wegovy 0.25mg',
      dispute: null,
      receiptUrl: null,
      reversed: false,
      subscription: { id: 'sub_456', status: null, cancelAt: null },
      createdAt: new Date(1767398400 * 1000),
      provider: CashierProvider.Stripe,
    },
  ] satisfies PaymentWith<
    'refunds' | 'dispute' | 'receipt' | 'reversal' | 'subscription'
  >[],
  PRODUCT,
  EXPECTED_PRODUCT: {
    id: 'prod_123',
    code: null,
    name: 'Pro Plan',
    description: null,
    active: true,
    createdAt: new Date(1767225600 * 1000),
    provider: CashierProvider.Stripe,
  } satisfies Product,
  RECURRING_PRICE,
  ONE_TIME_PRICE,
  EXPECTED_RECURRING_PRICE: {
    id: 'price_123',
    productId: 'prod_123',
    currency: 'USD',
    unitAmount: 29900,
    type: 'recurring',
    interval: { unit: 'month', count: 3 },
    active: true,
    createdAt: new Date(1767225600 * 1000),
    provider: CashierProvider.Stripe,
  } satisfies Price,
  EXPECTED_ONE_TIME_PRICE: {
    id: 'price_456',
    productId: 'prod_123',
    currency: 'GBP',
    unitAmount: null,
    type: 'one_time',
    interval: null,
    active: false,
    createdAt: new Date(1767312000 * 1000),
    provider: CashierProvider.Stripe,
  } satisfies Price,
  SUBSCRIPTION,
  MULTI_ITEM_SUBSCRIPTION,
  EXPECTED_SUBSCRIPTION: {
    id: 'sub_123',
    customerId: 'cus_123',
    status: 'active',
    items: [
      { id: 'si_123', priceId: 'price_123', quantity: 1, unitAmount: 29900 },
    ],
    currency: 'USD',
    currentPeriodStart: new Date(1767225600 * 1000),
    currentPeriodEnd: new Date(1769904000 * 1000),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    trialEnd: null,
    startDate: new Date(1767225600 * 1000),
    createdAt: new Date(1767225600 * 1000),
    metadata: { source: 'checkout' },
    provider: CashierProvider.Stripe,
  } satisfies Subscription,
  PAUSED_DISCOUNTED_SUBSCRIPTION,
  SUBSCRIPTION_PRODUCTS,
  EXPECTED_SUBSCRIPTION_RELATIONS: {
    product: { id: 'prod_123', name: 'Pro Plan' },
    interval: { unit: 'month', count: 1 },
    pause: null,
    discount: null,
  } satisfies Omit<
    SubscriptionWith<'product' | 'interval' | 'pause' | 'discount'>,
    keyof Subscription
  >,
  EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION_RELATIONS: {
    product: { id: 'prod_456', name: 'Pro Annual' },
    interval: { unit: 'year', count: 1 },
    pause: { behavior: 'void', resumesAt: new Date(1769904000 * 1000) },
    discount: {
      couponId: 'WELCOME10',
      name: 'Welcome',
      amountOff: null,
      percentOff: 10,
    },
  } satisfies Omit<
    SubscriptionWith<'product' | 'interval' | 'pause' | 'discount'>,
    keyof Subscription
  >,
};
