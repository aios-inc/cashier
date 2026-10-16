import Stripe from 'stripe';

export const createStripeClientMock = () => ({
  customers: {
    retrieve: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  invoices: {
    retrieve: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    finalizeInvoice: jest.fn(),
    pay: jest.fn(),
    voidInvoice: jest.fn(),
  },
  invoiceItems: {
    create: jest.fn(),
  },
  paymentIntents: {
    list: jest.fn(),
    create: jest.fn(),
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
