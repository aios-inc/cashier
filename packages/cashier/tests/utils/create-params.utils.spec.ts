import { RecurlyInvoicesResource } from '../../src/drivers/recurly/resources/recurly-invoices.resource';
import { RecurlyPaymentsResource } from '../../src/drivers/recurly/resources/recurly-payments.resource';
import { StripeInvoicesResource } from '../../src/drivers/stripe/resources/stripe-invoices.resource';
import { StripePaymentsResource } from '../../src/drivers/stripe/resources/stripe-payments.resource';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  CreateInvoiceParams,
  InvoicesResource,
} from '../../src/types/invoice.types';
import {
  CreatePaymentParams,
  PaymentsResource,
} from '../../src/types/payment.types';
import {
  asRecurlyClient,
  createRecurlyClientMock,
} from '../fixtures/recurly-client.mock';
import {
  asStripeClient,
  createStripeClientMock,
} from '../fixtures/stripe-client.mock';

const NOW = new Date('2026-01-01T00:00:00Z');

const INVOICE_PARAMS: CreateInvoiceParams = {
  customer: 'customer-42',
  currency: 'EUR',
  lineItems: [{ description: 'Consultation', amount: 1999 }],
  collection: 'send_invoice',
};

const PAYMENT_PARAMS: CreatePaymentParams = {
  customer: 'customer-42',
  currency: 'EUR',
  amount: 1999,
  paymentMethod: 'pm_123',
};

const INVALID_INVOICE_PARAMS: [string, Partial<CreateInvoiceParams>][] = [
  ['there are no line items', { lineItems: [] }],
  [
    'an amount is zero',
    { lineItems: [{ description: 'Consultation', amount: 0 }] },
  ],
  [
    'an amount is negative',
    { lineItems: [{ description: 'Consultation', amount: -100 }] },
  ],
  [
    'an amount is not an integer',
    { lineItems: [{ description: 'Consultation', amount: 19.99 }] },
  ],
  ['the currency is empty', { currency: '' }],
  ['the currency is blank', { currency: '  ' }],
  [
    'both dueDate and daysUntilDue are given',
    { dueDate: new Date('2026-01-15T00:00:00Z'), daysUntilDue: 14 },
  ],
  [
    'a dueDate is given when charging automatically',
    {
      collection: 'charge_automatically',
      dueDate: new Date('2026-01-15T00:00:00Z'),
    },
  ],
  [
    'daysUntilDue is given when charging automatically',
    { collection: 'charge_automatically', daysUntilDue: 14 },
  ],
  ['chargeNow is given when sending the invoice', { chargeNow: true }],
  ['daysUntilDue is negative', { daysUntilDue: -1 }],
  ['daysUntilDue is not an integer', { daysUntilDue: 1.5 }],
  ['the dueDate is in the past', { dueDate: new Date('2025-12-31T00:00:00Z') }],
];

const INVALID_PAYMENT_PARAMS: [string, Partial<CreatePaymentParams>][] = [
  ['the amount is zero', { amount: 0 }],
  ['the amount is negative', { amount: -100 }],
  ['the amount is not an integer', { amount: 19.99 }],
  ['the currency is empty', { currency: '' }],
];

const createStripe = () => {
  const client = createStripeClientMock();

  return {
    invoices: new StripeInvoicesResource(asStripeClient(client)),
    payments: new StripePaymentsResource(asStripeClient(client)),
    calls: () =>
      client.invoices.create.mock.calls.length +
      client.paymentIntents.create.mock.calls.length,
  };
};

const createRecurly = () => {
  const client = createRecurlyClientMock();

  return {
    invoices: new RecurlyInvoicesResource(asRecurlyClient(client)),
    payments: new RecurlyPaymentsResource(asRecurlyClient(client)),
    calls: () =>
      client.getAccount.mock.calls.length +
      client.createPurchase.mock.calls.length,
  };
};

describe.each([
  [CashierProvider.Stripe, createStripe],
  [CashierProvider.Recurly, createRecurly],
] as const)('create params validation on %s', (provider, create) => {
  let invoices: InvoicesResource;
  let payments: PaymentsResource;
  let calls: () => number;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    ({ invoices, payments, calls } = create());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(INVALID_INVOICE_PARAMS)(
    'should reject invoices.create when %s without calling the provider',
    async (_case, overrides) => {
      await expect(
        invoices.create({ ...INVOICE_PARAMS, ...overrides }),
      ).rejects.toMatchObject({ constructor: ValidationError, provider });
      expect(calls()).toBe(0);
    },
  );

  it.each(INVALID_PAYMENT_PARAMS)(
    'should reject payments.create when %s without calling the provider',
    async (_case, overrides) => {
      await expect(
        payments.create({ ...PAYMENT_PARAMS, ...overrides }),
      ).rejects.toMatchObject({ constructor: ValidationError, provider });
      expect(calls()).toBe(0);
    },
  );
});
