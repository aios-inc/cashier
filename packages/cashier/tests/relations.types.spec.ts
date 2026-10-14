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
    ]).toHaveLength(4);
    expect(cashier.use(CashierProvider.Stripe).provider).toBe(
      CashierProvider.Stripe,
    );
  });
});
