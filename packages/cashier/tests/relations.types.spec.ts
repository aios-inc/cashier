import { Cashier } from '../src/cashier';
import { CashierProvider } from '../src/types/cashier.types';
import { CASHIER_FIXTURES } from './fixtures/cashier.fixtures';

const checkStripeRelations = async (cashier: Cashier) => {
  const stripe = cashier.use(CashierProvider.Stripe);
  const [payment] = await stripe.payments.list({
    customer: 'cus_123',
    with: ['refunds', 'dispute', 'receipt', 'reversal', 'subscription'],
  });
  const amountRefunded: number | undefined = payment?.amountRefunded;
  const reversed: boolean | undefined = payment?.reversed;

  const page = await stripe.payments.cursorPaginate({
    customer: 'cus_123',
    with: ['dispute'],
  });
  const disputeId: string | undefined = page.data[0]?.dispute?.id;

  // @ts-expect-error refunds were not loaded
  void page.data[0]?.amountRefunded;

  const invoice = await stripe.invoices.get('in_123', { with: ['refunds'] });
  const invoiceRefunded: number = invoice.amountRefunded;

  await stripe.payments.list({
    customer: 'cus_123',
    // @ts-expect-error charges is not a relation
    with: ['charges'],
  });

  return { amountRefunded, reversed, disputeId, invoiceRefunded };
};

const checkRecurlyRelations = async (cashier: Cashier) => {
  const recurly = cashier.use(CashierProvider.Recurly);
  const [payment] = await recurly.payments.list({
    customer: 'code-customer-42',
    with: ['refunds', 'subscription'],
  });

  await recurly.payments.list({
    customer: 'code-customer-42',
    // @ts-expect-error Recurly has no disputes
    with: ['dispute'],
  });

  return payment?.subscription?.id;
};

const checkDefaultRelations = async (
  cashier: Cashier,
  provider: CashierProvider,
) => {
  const [payment] = await cashier.use().payments.list({
    customer: 'cus_123',
    with: ['refunds', 'subscription'],
  });

  await cashier.use().payments.list({
    customer: 'cus_123',
    // @ts-expect-error receipts are not available on every provider
    with: ['receipt'],
  });

  await cashier.use(provider).payments.list({
    customer: 'cus_123',
    // @ts-expect-error reversals are not available on every provider
    with: ['reversal'],
  });

  const [plain] = await cashier.use().payments.list({ customer: 'cus_123' });

  // @ts-expect-error refunds were not loaded
  void plain?.amountRefunded;

  return payment?.amountRefunded;
};

const checkSubscriptionRelations = async (cashier: Cashier) => {
  const page = await cashier.use().subscriptions.cursorPaginate({
    customer: 'cus_123',
    status: 'all',
    with: ['product', 'interval'],
  });
  const productName: string | undefined = page.data[0]?.product?.name;
  const cancelAt: Date | null | undefined = page.data[0]?.cancelAt;

  // @ts-expect-error discounts were not loaded
  void page.data[0]?.discount;

  await cashier.use().subscriptions.cursorPaginate({ price: 'price_123' });

  // @ts-expect-error a customer or a price is required
  await cashier.use().subscriptions.cursorPaginate({ status: 'all' });

  await cashier.use(CashierProvider.Recurly).subscriptions.list({
    customer: 'code-customer-42',
    // @ts-expect-error refunds is not a subscription relation
    with: ['refunds'],
  });

  return { productName, cancelAt };
};

const checkProviderMethods = async (
  cashier: Cashier,
  provider: CashierProvider,
) => {
  const stripe = cashier.use(CashierProvider.Stripe);
  const account = await stripe.account.get();
  const statementDescriptor: string | null = account.statementDescriptor;

  await stripe.payments.sendReceipt('pi_123');
  await stripe.invoices.sendReceipt('in_123', { email: 'jane@example.com' });

  const [found] = await stripe.customers.search({
    email: 'jane@example.com',
    limit: 10,
  });
  const foundEmail: string | null | undefined = found?.email;

  const payment = await stripe.payments.get('pi_123', {
    with: ['fees', 'statementDescriptor', 'paymentMethod', 'timeline'],
  });
  const fee: number | null = payment.fee;
  const brand: string | null | undefined = payment.paymentMethod?.brand;

  const invoice = await stripe.invoices.get('in_123', {
    with: ['startingBalance', 'lineItems'],
  });
  const startingBalance: number = invoice.startingBalance;

  const recurly = cashier.use(CashierProvider.Recurly);

  // @ts-expect-error Recurly has no account resource
  void recurly.account;

  // @ts-expect-error Recurly cannot send receipts
  void recurly.payments.sendReceipt;

  // @ts-expect-error Recurly cannot send receipts
  void recurly.invoices.sendReceipt;

  // @ts-expect-error Recurly cannot search customers
  void recurly.customers.search;

  // @ts-expect-error Recurly has no fees
  await recurly.payments.get('rec_txn_1', { with: ['fees'] });

  // @ts-expect-error Recurly has no starting balance
  await recurly.invoices.get('rec_inv_1', { with: ['startingBalance'] });

  // @ts-expect-error the account is not available on every provider
  void cashier.use().account;

  // @ts-expect-error receipts are not available on every provider
  void cashier.use(provider).payments.sendReceipt;

  // @ts-expect-error customer search is not available on every provider
  void cashier.use().customers.search;

  const [paymentMethod] = await cashier
    .use()
    .paymentMethods.list({ customer: 'cus_123' });
  const isDefault: boolean | undefined = paymentMethod?.isDefault;

  const customer = await cashier
    .use()
    .customers.get('cus_123', { with: ['balances'] });
  const balance: number | undefined = customer.balances[0]?.amount;

  const subscription = await cashier.use().subscriptions.get('sub_123', {
    with: ['paymentMethod', 'latestInvoice'],
  });
  const last4: string | null | undefined = subscription.paymentMethod?.last4;
  const latestInvoiceTotal: number | undefined =
    subscription.latestInvoice?.total;

  // @ts-expect-error the latest invoice was not loaded
  void (await cashier.use().subscriptions.get('sub_123')).latestInvoice;

  await cashier.use().invoices.list({ subscription: 'sub_123' });

  // @ts-expect-error a customer or a subscription is required
  await cashier.use().invoices.list({ status: 'paid' });

  return {
    statementDescriptor,
    fee,
    brand,
    startingBalance,
    isDefault,
    balance,
    last4,
    latestInvoiceTotal,
    foundEmail,
  };
};

describe('relation types', () => {
  it('should only accept the relations each provider supports', () => {
    const cashier = new Cashier({
      providers: { stripe: { apiKey: CASHIER_FIXTURES.API_KEY } },
    });

    expect([
      checkStripeRelations,
      checkRecurlyRelations,
      checkDefaultRelations,
      checkSubscriptionRelations,
      checkProviderMethods,
    ]).toHaveLength(5);
    expect(cashier.use(CashierProvider.Stripe).provider).toBe(
      CashierProvider.Stripe,
    );
  });
});
