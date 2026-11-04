import { StripePaymentMethodsResource } from '../../src/drivers/stripe/resources/stripe-payment-methods.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { CashierProvider } from '../../src/types/cashier.types';
import { STRIPE_FIXTURES } from '../fixtures/stripe.fixtures';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
  createStripeMissingResourceError,
} from '../fixtures/stripe-client.mock';

const createPaymentMethod = (
  id: string,
  type: string,
  details: Record<string, unknown> = {},
) => ({
  id,
  type,
  customer: STRIPE_FIXTURES.CUSTOMER_ID,
  created: 1767225600,
  ...details,
});

const card = (wallet: string | null) => ({
  card: {
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2028,
    wallet: wallet ? { type: wallet } : null,
  },
});

const expectedCard = (
  id: string,
  wallet: string | null,
  isDefault = false,
) => ({
  id,
  customerId: STRIPE_FIXTURES.CUSTOMER_ID,
  type: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2028,
  wallet,
  isDefault,
  createdAt: new Date(1767225600 * 1000),
  provider: CashierProvider.Stripe,
});

const expectedOther = (
  id: string,
  type: string,
  last4: string | null,
  wallet: string | null = null,
) => ({
  id,
  customerId: STRIPE_FIXTURES.CUSTOMER_ID,
  type,
  brand: null,
  last4,
  expMonth: null,
  expYear: null,
  wallet,
  isDefault: false,
  createdAt: new Date(1767225600 * 1000),
  provider: CashierProvider.Stripe,
});

describe('StripePaymentMethodsResource', () => {
  let client: StripeClientMock;
  let paymentMethods: StripePaymentMethodsResource;

  const mockCustomer = (defaultPaymentMethod: string | null) =>
    client.customers.retrieve.mockResolvedValue({
      ...STRIPE_FIXTURES.CUSTOMER,
      invoice_settings: { default_payment_method: defaultPaymentMethod },
    });

  beforeEach(() => {
    client = createStripeClientMock();
    paymentMethods = new StripePaymentMethodsResource(asStripeClient(client));
  });

  describe('list', () => {
    it('should list the payment methods with the default limit', async () => {
      mockCustomer(null);
      client.customers.listPaymentMethods.mockResolvedValue({ data: [] });

      await paymentMethods.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID });

      expect(client.customers.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
      );
      expect(client.customers.listPaymentMethods).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { limit: 100 },
      );
    });

    it('should pass the given limit', async () => {
      mockCustomer(null);
      client.customers.listPaymentMethods.mockResolvedValue({ data: [] });

      await paymentMethods.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 5,
      });

      expect(client.customers.listPaymentMethods).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { limit: 5 },
      );
    });

    it('should map cards, wallets, bank accounts and other types, and mark the default', async () => {
      mockCustomer('pm_apple');
      client.customers.listPaymentMethods.mockResolvedValue({
        data: [
          createPaymentMethod('pm_apple', 'card', card('apple_pay')),
          createPaymentMethod('pm_google', 'card', card('google_pay')),
          createPaymentMethod('pm_link_card', 'card', card('link')),
          createPaymentMethod('pm_samsung', 'card', card('samsung_pay')),
          createPaymentMethod('pm_card', 'card', card(null)),
          createPaymentMethod('pm_sepa', 'sepa_debit', {
            sepa_debit: { last4: '3000' },
          }),
          createPaymentMethod('pm_us_bank', 'us_bank_account', {
            us_bank_account: { last4: '6789' },
          }),
          createPaymentMethod('pm_paypal', 'paypal'),
          createPaymentMethod('pm_link', 'link'),
          createPaymentMethod('pm_klarna', 'klarna'),
        ],
      });

      const result = await paymentMethods.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(result).toEqual([
        expectedCard('pm_apple', 'apple_pay', true),
        expectedCard('pm_google', 'google_pay'),
        expectedCard('pm_link_card', 'link'),
        expectedCard('pm_samsung', 'other'),
        expectedCard('pm_card', null),
        expectedOther('pm_sepa', 'bank_account', '3000'),
        expectedOther('pm_us_bank', 'bank_account', '6789'),
        expectedOther('pm_paypal', 'paypal', null),
        expectedOther('pm_link', 'other', null, 'link'),
        expectedOther('pm_klarna', 'other', null),
      ]);
    });

    it('should map a card without details to nulls', async () => {
      mockCustomer(null);
      client.customers.listPaymentMethods.mockResolvedValue({
        data: [createPaymentMethod('pm_card', 'card')],
      });

      const [paymentMethod] = await paymentMethods.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(paymentMethod).toMatchObject({
        type: 'card',
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null,
        wallet: null,
        isDefault: false,
      });
    });

    it('should mark nothing as default when the customer has no default', async () => {
      client.customers.retrieve.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);
      client.customers.listPaymentMethods.mockResolvedValue({
        data: [createPaymentMethod('pm_card', 'card', card(null))],
      });

      const [paymentMethod] = await paymentMethods.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(paymentMethod?.isDefault).toBe(false);
    });

    it('should throw NotFoundError for a deleted customer', async () => {
      client.customers.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.DELETED_CUSTOMER,
      );
      client.customers.listPaymentMethods.mockResolvedValue({ data: [] });

      await expect(
        paymentMethods.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID }),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Stripe,
      });
    });

    it('should map a missing customer to NotFoundError', async () => {
      client.customers.retrieve.mockRejectedValue(
        createStripeMissingResourceError(),
      );
      client.customers.listPaymentMethods.mockResolvedValue({ data: [] });

      await expect(
        paymentMethods.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
