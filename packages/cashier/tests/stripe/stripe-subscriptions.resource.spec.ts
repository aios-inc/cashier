import { StripeSubscriptionsResource } from '../../src/drivers/stripe/resources/stripe-subscriptions.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import { STRIPE_FIXTURES } from '../fixtures/stripe.fixtures';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
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
});
