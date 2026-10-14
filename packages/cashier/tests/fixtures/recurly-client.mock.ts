import * as recurly from 'recurly';

export const createRecurlyClientMock = () => ({
  getInvoice: jest.fn(),
  listAccountInvoices: jest.fn(),
  collectInvoice: jest.fn(),
  voidInvoice: jest.fn(),
  refundInvoice: jest.fn(),
  listAccountTransactions: jest.fn(),
  getTransaction: jest.fn(),
  getPlan: jest.fn(),
  listPlans: jest.fn(),
  getAccount: jest.fn(),
  listAccounts: jest.fn(),
  createAccount: jest.fn(),
  updateAccount: jest.fn(),
  listAccountSubscriptions: jest.fn(),
  listSubscriptions: jest.fn(),
  createSubscription: jest.fn(),
  getSubscription: jest.fn(),
  createSubscriptionChange: jest.fn(),
  updateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  terminateSubscription: jest.fn(),
});

export type RecurlyClientMock = ReturnType<typeof createRecurlyClientMock>;

export const asRecurlyClient = (mock: RecurlyClientMock): recurly.Client =>
  mock as unknown as recurly.Client;
