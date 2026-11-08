import Stripe from 'stripe';

export const createStripeClientMock = () => ({
  customers: {
    retrieve: jest.fn(),
    list: jest.fn(),
    search: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    listPaymentMethods: jest.fn(),
    createBalanceTransaction: jest.fn(),
  },
  accounts: {
    retrieve: jest.fn(),
  },
  charges: {
    retrieve: jest.fn(),
    update: jest.fn(),
  },
  invoices: {
    retrieve: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    finalizeInvoice: jest.fn(),
    pay: jest.fn(),
    voidInvoice: jest.fn(),
    retrieveUpcoming: jest.fn(),
    listUpcomingLines: jest.fn(),
    listLineItems: jest.fn(),
  },
  invoiceItems: {
    create: jest.fn(),
  },
  paymentIntents: {
    list: jest.fn(),
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  refunds: {
    create: jest.fn(),
  },
  products: {
    retrieve: jest.fn(),
    list: jest.fn(),
  },
  prices: {
    retrieve: jest.fn(),
    list: jest.fn(),
  },
  subscriptions: {
    list: jest.fn(),
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  },
});

export type StripeClientMock = ReturnType<typeof createStripeClientMock>;

export const asStripeClient = (mock: StripeClientMock): Stripe =>
  mock as unknown as Stripe;

export const createStripeMissingResourceError = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message: 'No such resource',
    statusCode: 404,
  } as Stripe.StripeRawError);

export const createStripeMissingPaymentMethodError = (param: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    param,
    message:
      'The customer does not have a payment method with the ID pm_123. The payment method must be attached to the customer.',
    statusCode: 400,
  } as Stripe.StripeRawError);
