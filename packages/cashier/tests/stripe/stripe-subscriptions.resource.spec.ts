import { StripeSubscriptionsResource } from '../../src/drivers/stripe/resources/stripe-subscriptions.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { SubscriptionError } from '../../src/errors/subscription.error';
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

const RELATIONS = ['product', 'interval', 'pause', 'discount'] as const;

describe('StripeSubscriptionsResource', () => {
  let client: StripeClientMock;
  let subscriptions: StripeSubscriptionsResource;

  beforeEach(() => {
    client = createStripeClientMock();
    subscriptions = new StripeSubscriptionsResource(asStripeClient(client));
  });

  describe('list', () => {
    it('should list every status by default, newest first', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION],
      });

      const result = await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
        status: 'all',
      });
      expect(result).toEqual([STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION]);
    });

    it.each([
      ['active', 'active'],
      ['trialing', 'trialing'],
      ['past_due', 'past_due'],
      ['unpaid', 'unpaid'],
      ['paused', 'paused'],
      ['canceled', 'canceled'],
      ['incomplete', 'incomplete'],
      ['incomplete_expired', 'incomplete_expired'],
    ] as const)(
      'should filter the %s status with Stripe %s',
      async (status, stripeStatus) => {
        client.subscriptions.list.mockResolvedValue({ data: [] });

        await subscriptions.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          status,
          limit: 10,
        });

        expect(client.subscriptions.list).toHaveBeenCalledWith({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          limit: 10,
          status: stripeStatus,
        });
      },
    );

    it.each(['future', 'failed', 'unknown'] as const)(
      'should return nothing for the %s status, which Stripe never has, without calling Stripe',
      async (status) => {
        const result = await subscriptions.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          status,
        });

        expect(result).toEqual([]);
        expect(client.subscriptions.list).not.toHaveBeenCalled();
      },
    );

    it('should throw NotFoundError when the customer does not exist', async () => {
      client.subscriptions.list.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        subscriptions.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page and return the next cursor', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [
          STRIPE_FIXTURES.SUBSCRIPTION,
          STRIPE_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
        ],
        has_more: true,
      });

      const page = await subscriptions.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        perPage: 2,
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 2,
        status: 'all',
      });
      expect(page).toMatchObject({
        perPage: 2,
        hasMorePages: true,
        nextCursor: 'sub_456',
      });
    });

    it('should request the page after the cursor with the status filter', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION],
        has_more: true,
      });

      await subscriptions.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        status: 'canceled',
        perPage: 1,
        cursor: 'sub_000',
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 1,
        starting_after: 'sub_000',
        status: 'canceled',
      });
    });

    it('should return no next cursor on the last page', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION],
        has_more: false,
      });

      const page = await subscriptions.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        cursor: null,
      });

      expect(page).toEqual({
        data: [STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION],
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });

    it('should return an empty last page for a status Stripe never has', async () => {
      const page = await subscriptions.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        status: 'future',
        perPage: 25,
      });

      expect(page).toEqual({
        data: [],
        perPage: 25,
        hasMorePages: false,
        nextCursor: null,
      });
      expect(client.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe('cursorPaginate by price', () => {
    it('should pass the price to Stripe without a customer', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION],
        has_more: false,
      });

      await subscriptions.cursorPaginate({
        price: 'price_123',
        status: 'active',
        perPage: 10,
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        price: 'price_123',
        limit: 10,
        status: 'active',
      });
    });

    it('should pass both the customer and the price', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [],
        has_more: false,
      });

      await subscriptions.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        price: 'price_123',
        cursor: 'sub_000',
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        price: 'price_123',
        limit: 100,
        starting_after: 'sub_000',
        status: 'all',
      });
    });

    it('should reject without a customer or a price', async () => {
      await expect(
        // @ts-expect-error a customer or a price is required
        subscriptions.cursorPaginate({}),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(client.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe('cancelAt', () => {
    it.each([
      [
        'cancel_at when the cancellation is scheduled',
        { cancel_at: 1768262400, cancel_at_period_end: false },
        new Date(1768262400 * 1000),
      ],
      [
        'the period end when it cancels at period end',
        { cancel_at: null, cancel_at_period_end: true },
        new Date(1769904000 * 1000),
      ],
      [
        'null when no cancellation is scheduled',
        { cancel_at: null, cancel_at_period_end: false },
        null,
      ],
    ])('should be %s', async (_case, overrides, cancelAt) => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        ...overrides,
      });

      const subscription = await subscriptions.get(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription.cancelAt).toEqual(cancelAt);
    });
  });

  describe('relations', () => {
    it('should load every relation with one products request per page', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [
          STRIPE_FIXTURES.SUBSCRIPTION,
          STRIPE_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
          STRIPE_FIXTURES.SUBSCRIPTION,
        ],
      });
      client.products.list.mockResolvedValue({
        data: STRIPE_FIXTURES.SUBSCRIPTION_PRODUCTS,
      });

      const result = await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: RELATIONS,
      });

      expect(client.products.list).toHaveBeenCalledTimes(1);
      expect(client.products.list).toHaveBeenCalledWith({
        ids: ['prod_123', 'prod_456'],
        limit: 100,
      });
      expect(result).toEqual([
        {
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION,
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION_RELATIONS,
        },
        {
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION,
          id: 'sub_456',
          status: 'paused',
          items: [
            {
              id: 'si_456',
              priceId: 'price_456',
              quantity: 1,
              unitAmount: 299000,
            },
          ],
          ...STRIPE_FIXTURES.EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION_RELATIONS,
        },
        {
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION,
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION_RELATIONS,
        },
      ]);
    });

    it.each(['interval', 'pause', 'discount'] as const)(
      'should not request products for the %s relation',
      async (relation) => {
        client.subscriptions.list.mockResolvedValue({
          data: [STRIPE_FIXTURES.SUBSCRIPTION],
        });

        const [subscription] = await subscriptions.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          with: [relation],
        });

        expect(client.products.list).not.toHaveBeenCalled();
        expect(subscription).toEqual({
          ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION,
          [relation]: STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION_RELATIONS[relation],
        });
      },
    );

    it('should not request products when the page is empty', async () => {
      client.subscriptions.list.mockResolvedValue({ data: [] });

      await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['product'],
      });

      expect(client.products.list).not.toHaveBeenCalled();
    });

    it('should have no product when Stripe does not return it', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION],
      });
      client.products.list.mockResolvedValue({ data: [] });

      const [subscription] = await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['product'],
      });

      expect(subscription?.product).toBeNull();
    });

    it('should have no interval for a price without recurring details', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [
          {
            ...STRIPE_FIXTURES.SUBSCRIPTION,
            items: {
              data: [
                {
                  id: 'si_1',
                  price: { id: 'price_1', unit_amount: 100, recurring: null },
                  quantity: 1,
                },
              ],
            },
          },
        ],
      });

      const [subscription] = await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['interval'],
      });

      expect(subscription?.interval).toBeNull();
    });

    it('should map a pause without a resume date', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [
          {
            ...STRIPE_FIXTURES.SUBSCRIPTION,
            pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
          },
        ],
      });

      const [subscription] = await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['pause'],
      });

      expect(subscription?.pause).toEqual({
        behavior: 'keep_as_draft',
        resumesAt: null,
      });
    });

    it('should reject a relation Stripe does not support without calling Stripe', async () => {
      await expect(
        subscriptions.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          with: ['invoices' as 'product'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a subscription with every optional field', async () => {
      client.subscriptions.create.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      const subscription = await subscriptions.create({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        price: STRIPE_FIXTURES.PRICE_ID,
        currency: 'USD',
        quantity: 2,
        paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        couponCode: 'WELCOME',
        trialEnd: STRIPE_FIXTURES.TRIAL_END,
        metadata: { source: 'checkout' },
      });

      expect(client.subscriptions.create).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        items: [{ price: STRIPE_FIXTURES.PRICE_ID, quantity: 2 }],
        currency: 'usd',
        default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        coupon: 'WELCOME',
        trial_end: STRIPE_FIXTURES.TRIAL_END.getTime() / 1000,
        metadata: { source: 'checkout' },
      });
      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });

    it('should default the quantity to one', async () => {
      client.subscriptions.create.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.create({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        price: STRIPE_FIXTURES.PRICE_ID,
        currency: 'USD',
      });

      expect(client.subscriptions.create).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        items: [{ price: STRIPE_FIXTURES.PRICE_ID, quantity: 1 }],
        currency: 'usd',
      });
    });
  });

  describe('get', () => {
    it('should retrieve and map the subscription', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      const subscription = await subscriptions.get(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });
  });

  describe('update', () => {
    it('should replace the single item price instead of adding a new item', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        price: STRIPE_FIXTURES.NEW_PRICE_ID,
        quantity: 3,
      });

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          items: [
            { id: 'si_123', price: STRIPE_FIXTURES.NEW_PRICE_ID, quantity: 3 },
          ],
        },
      );
    });

    it('should update metadata without reading the subscription items', async () => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        metadata: { source: 'admin' },
      });

      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { metadata: { source: 'admin' } },
      );
    });

    it('should throw ValidationError when changing the price of a multi-item subscription', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.MULTI_ITEM_SUBSCRIPTION,
      );

      await expect(
        subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          price: STRIPE_FIXTURES.NEW_PRICE_ID,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('should set the subscription default payment method without reading the items', async () => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      const subscription = await subscriptions.update(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID },
      );

      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID },
      );
      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });

    it('should change the payment method of a multi-item subscription', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.MULTI_ITEM_SUBSCRIPTION,
      );
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.MULTI_ITEM_SUBSCRIPTION,
      );

      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        metadata: { source: 'admin' },
      });

      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
          metadata: { source: 'admin' },
        },
      );
    });

    it('should change the price and the payment method in one request', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        price: STRIPE_FIXTURES.NEW_PRICE_ID,
        paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
      });

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          items: [{ id: 'si_123', price: STRIPE_FIXTURES.NEW_PRICE_ID }],
          default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        },
      );
    });

    it('should map a payment method that is not attached to the customer to PaymentMethodError', async () => {
      client.subscriptions.update.mockRejectedValue(
        createStripeMissingPaymentMethodError('default_payment_method'),
      );

      await expect(
        subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        }),
      ).rejects.toMatchObject({
        constructor: PaymentMethodError,
        provider: CashierProvider.Stripe,
      });
    });
  });

  describe('cancel', () => {
    const comment = JSON.stringify({
      cancelledBy: 'customer-42',
      reason: 'too_expensive',
    });

    it('should cancel immediately by default', async () => {
      client.subscriptions.cancel.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID);

      expect(client.subscriptions.cancel).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('should cancel immediately with a comment', async () => {
      client.subscriptions.cancel.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, { comment });

      expect(client.subscriptions.cancel).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancellation_details: { comment } },
      );
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('should schedule the cancellation at period end', async () => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        atPeriodEnd: true,
      });

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancel_at_period_end: true },
      );
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it('should schedule the cancellation at period end with a comment', async () => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        atPeriodEnd: true,
        comment,
      });

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancel_at_period_end: true, cancellation_details: { comment } },
      );
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it.each([
      ['no comment', {}],
      ['an empty comment', { comment: '' }],
    ])(
      'should not send cancellation_details with %s',
      async (_case, params) => {
        client.subscriptions.cancel.mockResolvedValue(
          STRIPE_FIXTURES.SUBSCRIPTION,
        );
        client.subscriptions.update.mockResolvedValue(
          STRIPE_FIXTURES.SUBSCRIPTION,
        );

        await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, params);
        await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          ...params,
          atPeriodEnd: true,
        });

        expect(client.subscriptions.cancel).toHaveBeenCalledWith(
          STRIPE_FIXTURES.SUBSCRIPTION_ID,
        );
        expect(client.subscriptions.update).toHaveBeenCalledWith(
          STRIPE_FIXTURES.SUBSCRIPTION_ID,
          { cancel_at_period_end: true },
        );
      },
    );

    it('should accept a comment of 5000 characters', async () => {
      client.subscriptions.cancel.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        comment: 'a'.repeat(5000),
      });

      expect(client.subscriptions.cancel).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancellation_details: { comment: 'a'.repeat(5000) } },
      );
    });

    it.each([
      ['immediately', {}],
      ['at period end', { atPeriodEnd: true }],
    ])(
      'should reject a comment longer than 5000 characters %s without calling Stripe',
      async (_case, params) => {
        await expect(
          subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
            ...params,
            comment: 'a'.repeat(5001),
          }),
        ).rejects.toMatchObject({
          constructor: ValidationError,
          provider: CashierProvider.Stripe,
          message: 'The cancellation comment must be at most 5000 characters',
        });
        expect(client.subscriptions.cancel).not.toHaveBeenCalled();
        expect(client.subscriptions.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('get with relations', () => {
    const CARD = {
      id: 'pm_123',
      type: 'card',
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2028,
        wallet: null,
      },
    };

    const EXPECTED_CARD = {
      id: 'pm_123',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2028,
      wallet: null,
    };

    const getWith = (
      overrides: Record<string, unknown>,
      relations: readonly ('paymentMethod' | 'latestInvoice' | 'product')[],
    ) => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        ...overrides,
      });

      return subscriptions.get(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        with: relations,
      });
    };

    it('should retrieve without expansions by default', async () => {
      await getWith({}, []);

      expect(client.subscriptions.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {},
      );
    });

    it('should expand the payment methods and the latest invoice', async () => {
      const subscription = await getWith(
        {
          default_payment_method: CARD,
          latest_invoice: STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
        },
        ['paymentMethod', 'latestInvoice'],
      );

      expect(client.subscriptions.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          expand: [
            'default_payment_method',
            'customer.invoice_settings.default_payment_method',
            'latest_invoice',
          ],
        },
      );
      expect(subscription).toEqual({
        ...STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION,
        paymentMethod: EXPECTED_CARD,
        latestInvoice: STRIPE_FIXTURES.EXPECTED_INVOICES[0],
      });
    });

    it('should fall back to the customer default payment method', async () => {
      const subscription = await getWith(
        {
          default_payment_method: null,
          customer: {
            ...STRIPE_FIXTURES.CUSTOMER,
            invoice_settings: { default_payment_method: CARD },
          },
        },
        ['paymentMethod'],
      );

      expect(subscription.customerId).toBe(STRIPE_FIXTURES.CUSTOMER_ID);
      expect(subscription.paymentMethod).toEqual(EXPECTED_CARD);
    });

    it.each([
      ['there is no default anywhere', { default_payment_method: null }],
      [
        'the customer was deleted',
        {
          default_payment_method: null,
          customer: STRIPE_FIXTURES.DELETED_CUSTOMER,
        },
      ],
      [
        'the payment method is not expanded',
        { default_payment_method: 'pm_123' },
      ],
    ])('should have no payment method when %s', async (_case, overrides) => {
      const subscription = await getWith(overrides, ['paymentMethod']);

      expect(subscription.paymentMethod).toBeNull();
    });

    it.each([
      ['there is none', null],
      ['it is not expanded', 'in_123'],
    ])(
      'should have no latest invoice when %s',
      async (_case, latestInvoice) => {
        const subscription = await getWith({ latest_invoice: latestInvoice }, [
          'latestInvoice',
        ]);

        expect(subscription.latestInvoice).toBeNull();
      },
    );

    it('should list the product when the product relation is requested', async () => {
      client.products.list.mockResolvedValue({
        data: STRIPE_FIXTURES.SUBSCRIPTION_PRODUCTS,
      });

      const subscription = await getWith({}, ['product']);

      expect(client.products.list).toHaveBeenCalledWith({
        ids: ['prod_123'],
        limit: 100,
      });
      expect(subscription.product).toEqual({
        id: 'prod_123',
        name: 'Pro Plan',
      });
    });

    it('should expand the relations on every listed subscription', async () => {
      client.subscriptions.list.mockResolvedValue({
        data: [],
        has_more: false,
      });

      await subscriptions.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['latestInvoice'],
      });

      expect(client.subscriptions.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
        status: 'all',
        expand: ['data.latest_invoice'],
      });
    });
  });

  describe('update options', () => {
    beforeEach(() => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
    });

    it('should change the given item without reading the subscription', async () => {
      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        item: 'si_2',
        quantity: 4,
        proration: 'invoiceNow',
      });

      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          items: [{ id: 'si_2', quantity: 4 }],
          proration_behavior: 'always_invoice',
        },
      );
    });

    it.each([
      ['prorate', 'create_prorations'],
      ['none', 'none'],
      ['invoiceNow', 'always_invoice'],
    ] as const)(
      'should map the %s proration to %s',
      async (proration, behavior) => {
        client.subscriptions.retrieve.mockResolvedValue(
          STRIPE_FIXTURES.SUBSCRIPTION,
        );

        await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          price: STRIPE_FIXTURES.NEW_PRICE_ID,
          proration,
        });

        expect(client.subscriptions.update).toHaveBeenCalledWith(
          STRIPE_FIXTURES.SUBSCRIPTION_ID,
          {
            items: [{ id: 'si_123', price: STRIPE_FIXTURES.NEW_PRICE_ID }],
            proration_behavior: behavior,
          },
        );
      },
    );

    it('should set the trial end in unix seconds', async () => {
      await subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        trialEnd: STRIPE_FIXTURES.TRIAL_END,
      });

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { trial_end: STRIPE_FIXTURES.TRIAL_END.getTime() / 1000 },
      );
    });

    it('should reject an item without a price or a quantity', async () => {
      await expect(
        subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          item: 'si_2',
        }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('should ask for the item when the subscription has several', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.MULTI_ITEM_SUBSCRIPTION,
      );

      await expect(
        subscriptions.update(STRIPE_FIXTURES.SUBSCRIPTION_ID, { quantity: 2 }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        message:
          'Changing price or quantity of a subscription with several items requires the item',
      });
    });
  });

  describe('cancel with a refund', () => {
    const PERIOD_START = 1767225600;
    const PERIOD_END = 1769904000;

    const mockLatestInvoice = (
      charge: Record<string, unknown> | string | null,
    ) =>
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        latest_invoice: {
          ...STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
          amount_paid: 29900,
          charge,
        },
      });

    beforeEach(() => {
      client.subscriptions.cancel.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should cancel now and refund what is left of the latest charge', async () => {
      mockLatestInvoice({ id: 'ch_123', amount: 29900, amount_refunded: 5000 });

      const subscription = await subscriptions.cancel(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { refund: 'full' },
      );

      expect(client.subscriptions.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { expand: ['latest_invoice.charge'] },
      );
      expect(client.subscriptions.cancel).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );
      expect(client.refunds.create).toHaveBeenCalledWith({
        charge: 'ch_123',
        amount: 24900,
      });
      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });

    it('should refund the unused part of the period', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'queueMicrotask'],
        now: (PERIOD_START + (PERIOD_END - PERIOD_START) / 4) * 1000,
      });
      mockLatestInvoice({ id: 'ch_123', amount: 29900, amount_refunded: 0 });

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        refund: 'prorated',
      });

      expect(client.refunds.create).toHaveBeenCalledWith({
        charge: 'ch_123',
        amount: 22425,
      });
    });

    it('should not refund more than is left on the charge', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'queueMicrotask'],
        now: PERIOD_START * 1000,
      });
      mockLatestInvoice({
        id: 'ch_123',
        amount: 29900,
        amount_refunded: 20000,
      });

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        refund: 'prorated',
      });

      expect(client.refunds.create).toHaveBeenCalledWith({
        charge: 'ch_123',
        amount: 9900,
      });
    });

    it('should refund nothing once the period is over', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'queueMicrotask'],
        now: (PERIOD_END + 60) * 1000,
      });
      mockLatestInvoice({ id: 'ch_123', amount: 29900, amount_refunded: 0 });

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        refund: 'prorated',
      });

      expect(client.subscriptions.cancel).toHaveBeenCalled();
      expect(client.refunds.create).not.toHaveBeenCalled();
    });

    it.each([
      ['the latest invoice has no charge', null],
      ['the charge is not expanded', 'ch_123'],
      [
        'the charge is fully refunded',
        { id: 'ch_123', amount: 29900, amount_refunded: 29900 },
      ],
    ])('should cancel without a refund when %s', async (_case, charge) => {
      mockLatestInvoice(charge);

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        refund: 'full',
      });

      expect(client.subscriptions.cancel).toHaveBeenCalled();
      expect(client.refunds.create).not.toHaveBeenCalled();
    });

    it('should not refund when there is no latest invoice', async () => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        latest_invoice: null,
      });

      await subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        refund: 'full',
      });

      expect(client.refunds.create).not.toHaveBeenCalled();
    });

    it('should reject a refund at period end without calling Stripe', async () => {
      await expect(
        subscriptions.cancel(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
          atPeriodEnd: true,
          refund: 'full',
        }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.subscriptions.update).not.toHaveBeenCalled();
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    beforeEach(() => {
      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
    });

    it('should undo a cancellation at period end', async () => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        cancel_at_period_end: true,
        cancel_at: 1769904000,
      });

      const subscription = await subscriptions.resume(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancel_at_period_end: false },
      );
      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });

    it('should clear a scheduled cancellation date', async () => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        cancel_at_period_end: false,
        cancel_at: 1768262400,
      });

      await subscriptions.resume(STRIPE_FIXTURES.SUBSCRIPTION_ID);

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { cancel_at: '' },
      );
    });

    it('should reject a subscription that is not scheduled to cancel', async () => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      await expect(
        subscriptions.resume(STRIPE_FIXTURES.SUBSCRIPTION_ID),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('changeBillingDate', () => {
    it('should move the next charge with a trial end and no proration', async () => {
      const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      client.subscriptions.update.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );

      const subscription = await subscriptions.changeBillingDate(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        date,
      );

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        {
          trial_end: Math.floor(date.getTime() / 1000),
          proration_behavior: 'none',
        },
      );
      expect(subscription).toEqual(STRIPE_FIXTURES.EXPECTED_SUBSCRIPTION);
    });

    it('should reject a date in the past without calling Stripe', async () => {
      await expect(
        subscriptions.changeBillingDate(
          STRIPE_FIXTURES.SUBSCRIPTION_ID,
          new Date(Date.now() - 1000),
        ),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('addCharge', () => {
    const PARAMS = {
      description: 'Needles x10',
      unitAmount: 1250,
      metadata: { order: 'order-42' },
    };
    const INVOICE_ITEM = {
      id: 'ii_123',
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      subscription: STRIPE_FIXTURES.SUBSCRIPTION_ID,
      invoice: null,
      description: 'Needles x10',
      unit_amount: 1250,
      quantity: 2,
      amount: 2500,
      currency: 'usd',
      metadata: { order: 'order-42' },
      date: 1767225600,
    };

    beforeEach(() => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
      client.invoiceItems.create.mockResolvedValue(INVOICE_ITEM);
    });

    it('should add a pending invoice item to the subscription in its currency', async () => {
      const charge = await subscriptions.addCharge(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        { ...PARAMS, quantity: 2 },
      );

      expect(client.subscriptions.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );
      expect(client.invoiceItems.create).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        subscription: STRIPE_FIXTURES.SUBSCRIPTION_ID,
        currency: 'usd',
        unit_amount: 1250,
        quantity: 2,
        description: 'Needles x10',
        metadata: { order: 'order-42' },
      });
      expect(charge).toEqual({
        id: 'ii_123',
        customerId: STRIPE_FIXTURES.CUSTOMER_ID,
        subscriptionId: STRIPE_FIXTURES.SUBSCRIPTION_ID,
        description: 'Needles x10',
        unitAmount: 1250,
        quantity: 2,
        amount: 2500,
        currency: 'USD',
        metadata: { order: 'order-42' },
        createdAt: new Date(1767225600 * 1000),
        provider: CashierProvider.Stripe,
      });
    });

    it('should default the quantity to 1 and leave out missing metadata', async () => {
      await subscriptions.addCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        description: 'Needles x10',
        unitAmount: 1250,
      });

      expect(client.invoiceItems.create).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        subscription: STRIPE_FIXTURES.SUBSCRIPTION_ID,
        currency: 'usd',
        unit_amount: 1250,
        quantity: 1,
        description: 'Needles x10',
      });
    });

    it('should pass the idempotency key as is', async () => {
      await subscriptions.addCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, {
        ...PARAMS,
        idempotencyKey: 'order-42-needles',
      });

      expect(client.invoiceItems.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'order-42-needles' },
      );
    });

    it('should add the charge to a trialing subscription that has a cancellation after its next renewal', async () => {
      client.subscriptions.retrieve.mockResolvedValue({
        ...STRIPE_FIXTURES.SUBSCRIPTION,
        status: 'trialing',
        cancel_at: STRIPE_FIXTURES.SUBSCRIPTION.current_period_end + 86400,
      });

      await subscriptions.addCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, PARAMS);

      expect(client.invoiceItems.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['canceled', { status: 'canceled' }],
      ['incomplete', { status: 'incomplete' }],
      ['set to cancel at period end', { cancel_at_period_end: true }],
      [
        'set to cancel before its next renewal',
        { cancel_at: STRIPE_FIXTURES.SUBSCRIPTION.current_period_end },
      ],
    ])(
      'should reject a subscription that is %s without adding the charge',
      async (_case, overrides) => {
        client.subscriptions.retrieve.mockResolvedValue({
          ...STRIPE_FIXTURES.SUBSCRIPTION,
          ...overrides,
        });

        await expect(
          subscriptions.addCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, PARAMS),
        ).rejects.toMatchObject({
          constructor: SubscriptionError,
          provider: CashierProvider.Stripe,
        });
        expect(client.invoiceItems.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a blank description', { ...PARAMS, description: ' ' }],
      ['a zero unit amount', { ...PARAMS, unitAmount: 0 }],
      ['a fractional unit amount', { ...PARAMS, unitAmount: 12.5 }],
      ['a zero quantity', { ...PARAMS, quantity: 0 }],
      ['a fractional quantity', { ...PARAMS, quantity: 1.5 }],
    ])('should reject %s without calling Stripe', async (_case, params) => {
      await expect(
        subscriptions.addCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, params),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(client.invoiceItems.create).not.toHaveBeenCalled();
    });
  });

  describe('listCharges', () => {
    const createInvoiceItem = (id: string, subscription: string | null) => ({
      id,
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      subscription,
      invoice: null,
      description: `Item ${id}`,
      unit_amount: 1000,
      quantity: 1,
      amount: 1000,
      currency: 'usd',
      metadata: {},
      date: 1767225600,
    });

    beforeEach(() => {
      client.subscriptions.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION,
      );
    });

    it("should list the customer's pending invoice items and keep the subscription's", async () => {
      client.invoiceItems.list
        .mockResolvedValueOnce({
          data: [
            createInvoiceItem('ii_1', STRIPE_FIXTURES.SUBSCRIPTION_ID),
            createInvoiceItem('ii_2', 'sub_other'),
          ],
          has_more: true,
        })
        .mockResolvedValueOnce({
          data: [
            createInvoiceItem('ii_3', null),
            createInvoiceItem('ii_4', STRIPE_FIXTURES.SUBSCRIPTION_ID),
          ],
          has_more: false,
        });

      const charges = await subscriptions.listCharges(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(client.invoiceItems.list).toHaveBeenNthCalledWith(1, {
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        pending: true,
        limit: 100,
      });
      expect(client.invoiceItems.list).toHaveBeenNthCalledWith(2, {
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        pending: true,
        limit: 100,
        starting_after: 'ii_2',
      });
      expect(charges.map((charge) => charge.id)).toEqual(['ii_1', 'ii_4']);
    });
  });

  describe('removeCharge', () => {
    const INVOICE_ITEM = {
      id: 'ii_123',
      subscription: STRIPE_FIXTURES.SUBSCRIPTION_ID,
      invoice: null,
    };

    it('should delete a pending invoice item of the subscription', async () => {
      client.invoiceItems.retrieve.mockResolvedValue(INVOICE_ITEM);

      await subscriptions.removeCharge(
        STRIPE_FIXTURES.SUBSCRIPTION_ID,
        'ii_123',
      );

      expect(client.invoiceItems.retrieve).toHaveBeenCalledWith('ii_123');
      expect(client.invoiceItems.del).toHaveBeenCalledWith('ii_123');
    });

    it('should reject an invoice item of another subscription with NotFoundError', async () => {
      client.invoiceItems.retrieve.mockResolvedValue({
        ...INVOICE_ITEM,
        subscription: 'sub_other',
      });

      await expect(
        subscriptions.removeCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, 'ii_123'),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Stripe,
      });
      expect(client.invoiceItems.del).not.toHaveBeenCalled();
    });

    it('should reject an invoice item that is already on an invoice', async () => {
      client.invoiceItems.retrieve.mockResolvedValue({
        ...INVOICE_ITEM,
        invoice: 'in_123',
      });

      await expect(
        subscriptions.removeCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, 'ii_123'),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.invoiceItems.del).not.toHaveBeenCalled();
    });

    it('should map a missing invoice item to NotFoundError', async () => {
      client.invoiceItems.retrieve.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        subscriptions.removeCharge(STRIPE_FIXTURES.SUBSCRIPTION_ID, 'ii_404'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
