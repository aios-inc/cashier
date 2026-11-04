import { StripeCustomersResource } from '../../src/drivers/stripe/resources/stripe-customers.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import { STRIPE_FIXTURES } from '../fixtures/stripe.fixtures';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
  createStripeMissingPaymentMethodError,
  createStripeMissingResourceError,
} from '../fixtures/stripe-client.mock';

describe('StripeCustomersResource', () => {
  let client: StripeClientMock;
  let customers: StripeCustomersResource;

  beforeEach(() => {
    client = createStripeClientMock();
    customers = new StripeCustomersResource(asStripeClient(client));
  });

  describe('get', () => {
    it('should retrieve and map the customer', async () => {
      client.customers.retrieve.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      const customer = await customers.get(STRIPE_FIXTURES.CUSTOMER_ID);

      expect(client.customers.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
      );
      expect(customer).toEqual(STRIPE_FIXTURES.EXPECTED_CUSTOMER);
    });

    it('should throw NotFoundError for a deleted customer', async () => {
      client.customers.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.DELETED_CUSTOMER,
      );

      await expect(
        customers.get(STRIPE_FIXTURES.CUSTOMER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('should map a missing customer to NotFoundError', async () => {
      client.customers.retrieve.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        customers.get(STRIPE_FIXTURES.CUSTOMER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list', () => {
    it('should list customers with the default limit', async () => {
      client.customers.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.CUSTOMER],
      });

      const result = await customers.list();

      expect(client.customers.list).toHaveBeenCalledWith({ limit: 100 });
      expect(result).toEqual([STRIPE_FIXTURES.EXPECTED_CUSTOMER]);
    });

    it('should filter by email and pass the limit', async () => {
      client.customers.list.mockResolvedValue({ data: [] });

      await customers.list({ email: STRIPE_FIXTURES.CUSTOMER_EMAIL, limit: 5 });

      expect(client.customers.list).toHaveBeenCalledWith({
        limit: 5,
        email: STRIPE_FIXTURES.CUSTOMER_EMAIL,
      });
    });
  });

  describe('create', () => {
    it('should create the customer with a joined name and metadata', async () => {
      client.customers.create.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      const customer = await customers.create({
        email: STRIPE_FIXTURES.CUSTOMER_EMAIL,
        code: 'ignored-by-stripe',
        firstName: 'Jane',
        lastName: 'Doe',
        metadata: { source: 'checkout' },
      });

      expect(client.customers.create).toHaveBeenCalledWith({
        email: STRIPE_FIXTURES.CUSTOMER_EMAIL,
        name: 'Jane Doe',
        metadata: { source: 'checkout' },
      });
      expect(customer).toEqual(STRIPE_FIXTURES.EXPECTED_CUSTOMER);
    });

    it('should omit the name when no name parts are given', async () => {
      client.customers.create.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      await customers.create({ email: STRIPE_FIXTURES.CUSTOMER_EMAIL });

      expect(client.customers.create).toHaveBeenCalledWith({
        email: STRIPE_FIXTURES.CUSTOMER_EMAIL,
      });
    });
  });

  describe('update', () => {
    it('should update only the fields that are given', async () => {
      client.customers.update.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      const customer = await customers.update(STRIPE_FIXTURES.CUSTOMER_ID, {
        email: STRIPE_FIXTURES.CUSTOMER_EMAIL,
      });

      expect(client.customers.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { email: STRIPE_FIXTURES.CUSTOMER_EMAIL },
      );
      expect(customer).toEqual(STRIPE_FIXTURES.EXPECTED_CUSTOMER);
    });

    it('should join firstName and lastName into the Stripe name', async () => {
      client.customers.update.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      await customers.update(STRIPE_FIXTURES.CUSTOMER_ID, {
        firstName: 'Jane',
        lastName: 'Doe',
        metadata: { source: 'checkout' },
      });

      expect(client.customers.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { name: 'Jane Doe', metadata: { source: 'checkout' } },
      );
    });

    it('should reject a partial name update without calling Stripe', async () => {
      await expect(
        customers.update(STRIPE_FIXTURES.CUSTOMER_ID, { firstName: 'Jane' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(client.customers.update).not.toHaveBeenCalled();
    });

    it('should set the default payment method for invoices and renewals', async () => {
      client.customers.update.mockResolvedValue(STRIPE_FIXTURES.CUSTOMER);

      const customer = await customers.update(STRIPE_FIXTURES.CUSTOMER_ID, {
        defaultPaymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
      });

      expect(client.customers.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        {
          invoice_settings: {
            default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
          },
        },
      );
      expect(customer).toEqual(STRIPE_FIXTURES.EXPECTED_CUSTOMER);
    });

    it('should map a payment method that is not attached to the customer to PaymentMethodError', async () => {
      client.customers.update.mockRejectedValue(
        createStripeMissingPaymentMethodError(
          'invoice_settings[default_payment_method]',
        ),
      );

      await expect(
        customers.update(STRIPE_FIXTURES.CUSTOMER_ID, {
          defaultPaymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        }),
      ).rejects.toMatchObject({
        constructor: PaymentMethodError,
        provider: CashierProvider.Stripe,
        providerCode: 'resource_missing',
      });
    });
  });

  describe('get with balances', () => {
    it('should add the balance in the customer currency', async () => {
      client.customers.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.CUSTOMER,
        currency: 'usd',
        balance: -2500,
      });

      const customer = await customers.get(STRIPE_FIXTURES.CUSTOMER_ID, {
        with: ['balances'],
      });

      expect(client.customers.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
      );
      expect(customer).toEqual({
        ...STRIPE_FIXTURES.EXPECTED_CUSTOMER,
        balances: [{ currency: 'USD', amount: -2500 }],
      });
    });

    it('should have no balances when the customer has no currency yet', async () => {
      client.customers.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.CUSTOMER,
        currency: null,
        balance: 0,
      });

      const customer = await customers.get(STRIPE_FIXTURES.CUSTOMER_ID, {
        with: ['balances'],
      });

      expect(customer.balances).toEqual([]);
    });

    it('should reject a relation Stripe does not support without calling Stripe', async () => {
      await expect(
        customers.get(STRIPE_FIXTURES.CUSTOMER_ID, {
          with: ['invoices' as 'balances'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.customers.retrieve).not.toHaveBeenCalled();
    });
  });

  describe('creditBalance', () => {
    const transaction = {
      id: 'cbtxn_123',
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      amount: -2500,
      currency: 'usd',
      description: 'Goodwill',
      created: 1767225600,
    };

    it('should create a negative balance transaction', async () => {
      client.customers.createBalanceTransaction.mockResolvedValue(transaction);

      const result = await customers.creditBalance(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { amount: 2500, currency: 'USD', description: 'Goodwill' },
      );

      expect(client.customers.createBalanceTransaction).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { amount: -2500, currency: 'usd', description: 'Goodwill' },
      );
      expect(result).toEqual({
        id: 'cbtxn_123',
        customerId: STRIPE_FIXTURES.CUSTOMER_ID,
        amount: -2500,
        currency: 'USD',
        description: 'Goodwill',
        createdAt: new Date(1767225600 * 1000),
        provider: CashierProvider.Stripe,
      });
    });

    it('should leave out a missing description', async () => {
      client.customers.createBalanceTransaction.mockResolvedValue({
        ...transaction,
        description: null,
      });

      await customers.creditBalance(STRIPE_FIXTURES.CUSTOMER_ID, {
        amount: 2500,
        currency: 'USD',
      });

      expect(client.customers.createBalanceTransaction).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { amount: -2500, currency: 'usd' },
      );
    });

    it.each([
      ['a zero amount', { amount: 0, currency: 'USD' }],
      ['a fractional amount', { amount: 10.5, currency: 'USD' }],
      ['a negative amount', { amount: -100, currency: 'USD' }],
      ['an empty currency', { amount: 100, currency: ' ' }],
    ])('should reject %s without calling Stripe', async (_case, params) => {
      await expect(
        customers.creditBalance(STRIPE_FIXTURES.CUSTOMER_ID, params),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });
  });

  describe('debitBalance', () => {
    it('should create a positive balance transaction', async () => {
      client.customers.createBalanceTransaction.mockResolvedValue({
        id: 'cbtxn_456',
        customer: { id: STRIPE_FIXTURES.CUSTOMER_ID },
        amount: 1000,
        currency: 'eur',
        description: null,
        created: 1767225600,
      });

      const result = await customers.debitBalance(STRIPE_FIXTURES.CUSTOMER_ID, {
        amount: 1000,
        currency: 'EUR',
      });

      expect(client.customers.createBalanceTransaction).toHaveBeenCalledWith(
        STRIPE_FIXTURES.CUSTOMER_ID,
        { amount: 1000, currency: 'eur' },
      );
      expect(result).toMatchObject({
        id: 'cbtxn_456',
        customerId: STRIPE_FIXTURES.CUSTOMER_ID,
        amount: 1000,
        currency: 'EUR',
        description: null,
      });
    });

    it('should reject an invalid amount without calling Stripe', async () => {
      await expect(
        customers.debitBalance(STRIPE_FIXTURES.CUSTOMER_ID, {
          amount: 0,
          currency: 'EUR',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(client.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });
  });
});
