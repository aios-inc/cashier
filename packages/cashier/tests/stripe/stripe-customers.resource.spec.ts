import { StripeCustomersResource } from '../../src/drivers/stripe/resources/stripe-customers.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
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
});
