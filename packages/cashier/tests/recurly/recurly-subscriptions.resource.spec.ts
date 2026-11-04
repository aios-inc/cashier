import * as recurly from 'recurly';
import { RecurlySubscriptionsResource } from '../../src/drivers/recurly/resources/recurly-subscriptions.resource';
import { AuthenticationError } from '../../src/errors/authentication.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { ProviderError } from '../../src/errors/provider.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  RECURLY_FIXTURES,
  createFailingRecurlyPager,
  createRecurlyPagePager,
  createRecurlyPager,
  withRecurlyStatus,
} from '../fixtures/recurly.fixtures';
import {
  RecurlyClientMock,
  asRecurlyClient,
  createRecurlyClientMock,
} from '../fixtures/recurly-client.mock';

const RELATIONS = ['product', 'interval', 'pause', 'discount'] as const;

const EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION = {
  ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
  id: 'rec_sub_2',
  status: 'paused',
  items: [{ id: null, priceId: 'plan_2', quantity: 1, unitAmount: 14999 }],
};

describe('RecurlySubscriptionsResource', () => {
  let client: RecurlyClientMock;
  let subscriptions: RecurlySubscriptionsResource;

  beforeEach(() => {
    client = createRecurlyClientMock();
    subscriptions = new RecurlySubscriptionsResource(asRecurlyClient(client));
  });

  describe('list', () => {
    it('should list every state by default', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
        ]),
      );

      const result = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(client.listAccountSubscriptions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 100 } },
      );
      expect(result).toEqual([
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
        RECURLY_FIXTURES.EXPECTED_EXPIRED_SUBSCRIPTION,
      ]);
    });

    it.each([
      ['active', 'live'],
      ['canceled', 'expired'],
      ['future', 'future'],
    ] as const)(
      'should filter the %s status with the Recurly %s state',
      async (status, state) => {
        client.listAccountSubscriptions.mockReturnValue(createRecurlyPager([]));

        await subscriptions.list({
          customer: RECURLY_FIXTURES.ACCOUNT_ID,
          status,
          limit: 10,
        });

        expect(client.listAccountSubscriptions).toHaveBeenCalledWith(
          RECURLY_FIXTURES.ACCOUNT_ID,
          { params: { limit: 10, state } },
        );
      },
    );

    it('should keep only subscriptions Cashier reports as active, including canceled ones that run until period end', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          { ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION, state: 'future' },
          RECURLY_FIXTURES.CANCELED_SUBSCRIPTION,
        ]),
      );

      const result = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'active',
      });

      expect(result).toEqual([
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
        RECURLY_FIXTURES.EXPECTED_CANCELED_SUBSCRIPTION,
      ]);
    });

    it('should filter a status Recurly cannot filter after reading, counting only matches toward the limit', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
          {
            ...RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
            id: 'rec_sub_3',
          },
        ]),
      );

      const result = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'paused',
        limit: 1,
      });

      expect(client.listAccountSubscriptions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 1 } },
      );
      expect(result).toEqual([EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION]);
    });

    it('should map failures raised while paging', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createFailingRecurlyPager(new Error('Network down')),
      );

      await expect(
        subscriptions.list({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page and return the next cursor', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPagePager(
          [RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION],
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      const page = await subscriptions.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        perPage: 1,
      });

      expect(client.listAccountSubscriptions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 1 } },
      );
      expect(page).toEqual({
        data: [RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION],
        perPage: 1,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });

    it('should pass the cursor and state to Recurly', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPagePager([RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION]),
      );

      await subscriptions.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'canceled',
        perPage: 1,
        cursor: RECURLY_FIXTURES.CURSOR,
      });

      expect(client.listAccountSubscriptions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          params: {
            limit: 1,
            state: 'expired',
            cursor: RECURLY_FIXTURES.CURSOR,
          },
        },
      );
    });

    it('should return no next cursor on the last page', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPagePager([RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION]),
      );

      const page = await subscriptions.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        cursor: null,
      });

      expect(page).toEqual({
        data: [RECURLY_FIXTURES.EXPECTED_EXPIRED_SUBSCRIPTION],
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });

    it('should filter the page by status and keep the cursor when nothing matches', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPagePager(
          [RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION],
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      const page = await subscriptions.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'paused',
        perPage: 1,
      });

      expect(page).toEqual({
        data: [],
        perPage: 1,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });
  });

  describe('cursorPaginate by price', () => {
    it('should list the site subscriptions and keep those on the plan', async () => {
      client.listSubscriptions.mockReturnValue(
        createRecurlyPagePager(
          [
            RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
            RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
          ],
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      const page = await subscriptions.cursorPaginate({
        price: 'plan_1',
        perPage: 2,
      });

      expect(client.listSubscriptions).toHaveBeenCalledWith({
        params: { limit: 2 },
      });
      expect(client.listAccountSubscriptions).not.toHaveBeenCalled();
      expect(page).toEqual({
        data: [RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION],
        perPage: 2,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });

    it('should match a plan code and filter an account by price', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPagePager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
        ]),
      );

      const page = await subscriptions.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        price: 'code-pro-legacy',
      });

      expect(page.data.map((subscription) => subscription.id)).toEqual([
        'rec_sub_2',
      ]);
    });

    it('should reject without a customer or a price', async () => {
      await expect(
        // @ts-expect-error a customer or a price is required
        subscriptions.cursorPaginate({}),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(client.listSubscriptions).not.toHaveBeenCalled();
    });
  });

  describe('cancelAt', () => {
    it.each([
      [
        'the expiry date of a canceled subscription',
        RECURLY_FIXTURES.CANCELED_SUBSCRIPTION,
        new Date('2026-02-01T00:00:00Z'),
      ],
      [
        'null for an active subscription',
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        null,
      ],
      [
        'null for an expired subscription',
        RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
        null,
      ],
    ])('should be %s', async (_case, subscription, cancelAt) => {
      client.getSubscription.mockResolvedValue(subscription);

      const result = await subscriptions.get(RECURLY_FIXTURES.SUBSCRIPTION_ID);

      expect(result.cancelAt).toEqual(cancelAt);
    });
  });

  describe('relations', () => {
    it('should load every relation with one plan request per unique plan', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        ]),
      );
      client.getPlan.mockImplementation(async (planId: string) =>
        planId === RECURLY_FIXTURES.PLAN_ID
          ? RECURLY_FIXTURES.ACTIVE_PLAN
          : RECURLY_FIXTURES.INACTIVE_PLAN,
      );

      const result = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: RELATIONS,
      });

      expect(client.getPlan).toHaveBeenCalledTimes(2);
      expect(client.getPlan).toHaveBeenCalledWith('plan_1');
      expect(client.getPlan).toHaveBeenCalledWith('plan_2');
      expect(result).toEqual([
        {
          ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
          ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION_RELATIONS,
        },
        {
          ...EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION,
          ...RECURLY_FIXTURES.EXPECTED_PAUSED_DISCOUNTED_SUBSCRIPTION_RELATIONS,
        },
        {
          ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
          ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION_RELATIONS,
        },
      ]);
    });

    it.each(['product', 'pause', 'discount'] as const)(
      'should not request plans for the %s relation',
      async (relation) => {
        client.listAccountSubscriptions.mockReturnValue(
          createRecurlyPager([RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION]),
        );

        const [subscription] = await subscriptions.list({
          customer: RECURLY_FIXTURES.ACCOUNT_ID,
          with: [relation],
        });

        expect(client.getPlan).not.toHaveBeenCalled();
        expect(subscription).toEqual({
          ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
          [relation]:
            RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION_RELATIONS[relation],
        });
      },
    );

    it('should have no product or interval when the subscription has no plan', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          { ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION, plan: null },
        ]),
      );

      const [subscription] = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['product', 'interval'],
      });

      expect(client.getPlan).not.toHaveBeenCalled();
      expect(subscription).toMatchObject({ product: null, interval: null });
    });

    it('should have no interval for a plan interval unit Cashier does not know', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION]),
      );
      client.getPlan.mockResolvedValue({
        ...RECURLY_FIXTURES.ACTIVE_PLAN,
        intervalUnit: 'fortnights',
      });

      const [subscription] = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['interval'],
      });

      expect(subscription?.interval).toBeNull();
    });

    it('should map a pause scheduled with pausedAt on an active subscription', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          {
            ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
            pausedAt: new Date('2026-02-01T00:00:00Z'),
          },
        ]),
      );

      const [subscription] = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['pause'],
      });

      expect(subscription?.pause).toEqual({ behavior: null, resumesAt: null });
    });

    it.each([
      [
        'a percent coupon',
        { type: 'percent', percent: 20 },
        { amountOff: null, percentOff: 20 },
      ],
      [
        'a fixed coupon without the subscription currency',
        { type: 'fixed', currencies: [{ currency: 'EUR', amount: 5 }] },
        { amountOff: null, percentOff: null },
      ],
    ])('should map %s', async (_case, discount, expected) => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          {
            ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
            couponRedemptions: [
              {
                state: 'active',
                coupon: { code: 'spring', name: null, discount },
              },
            ],
          },
        ]),
      );

      const [subscription] = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['discount'],
      });

      expect(subscription?.discount).toEqual({
        couponId: 'spring',
        name: null,
        ...expected,
      });
    });

    it('should have no discount when no coupon redemption is active', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          {
            ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
            couponRedemptions: [
              { state: 'inactive', coupon: { code: 'old', name: 'Old' } },
            ],
          },
        ]),
      );

      const [subscription] = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['discount'],
      });

      expect(subscription?.discount).toBeNull();
    });

    it('should reject a relation Recurly does not support without calling Recurly', async () => {
      await expect(
        subscriptions.list({
          customer: RECURLY_FIXTURES.ACCOUNT_ID,
          with: ['invoices' as 'product'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.listAccountSubscriptions).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should resolve the account code and create the subscription by plan code', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.ACCOUNT);
      client.createSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      const subscription = await subscriptions.create({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        price: RECURLY_FIXTURES.PLAN_CODE_REFERENCE,
        currency: 'USD',
        quantity: 2,
        paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        couponCode: 'WELCOME',
        trialEnd: RECURLY_FIXTURES.TRIAL_END,
        metadata: { source: 'checkout' },
      });

      expect(client.getAccount).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
      );
      expect(client.createSubscription).toHaveBeenCalledWith({
        planCode: 'pro-monthly',
        account: { code: 'customer-42' },
        currency: 'USD',
        quantity: 2,
        billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID,
        couponCodes: ['WELCOME'],
        trialEndsAt: RECURLY_FIXTURES.TRIAL_END,
        customFields: [{ name: 'source', value: 'checkout' }],
      });
      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should create the subscription by plan id when no code prefix is used', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.ACCOUNT);
      client.createSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      await subscriptions.create({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        price: RECURLY_FIXTURES.PLAN_ID,
        currency: 'USD',
      });

      expect(client.createSubscription).toHaveBeenCalledWith({
        planId: RECURLY_FIXTURES.PLAN_ID,
        account: { code: 'customer-42' },
        currency: 'USD',
        quantity: 1,
      });
    });
  });

  describe('get', () => {
    it('should retrieve and map the subscription', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should report a canceled Recurly subscription as active until period end', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.CANCELED_SUBSCRIPTION,
      );

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_CANCELED_SUBSCRIPTION,
      );
    });

    it('should report an expired Recurly subscription as canceled', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
      );

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_EXPIRED_SUBSCRIPTION,
      );
    });
  });

  describe('update', () => {
    it('should change the plan and quantity immediately and return the fresh subscription', async () => {
      client.createSubscriptionChange.mockResolvedValue({});
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      const subscription = await subscriptions.update(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { price: RECURLY_FIXTURES.PLAN_CODE_REFERENCE, quantity: 2 },
      );

      expect(client.createSubscriptionChange).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { timeframe: 'now', planCode: 'pro-monthly', quantity: 2 },
      );
      expect(client.updateSubscription).not.toHaveBeenCalled();
      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should update metadata as custom fields without a plan change', async () => {
      client.updateSubscription.mockResolvedValue({});
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      await subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        metadata: { source: 'admin' },
      });

      expect(client.createSubscriptionChange).not.toHaveBeenCalled();
      expect(client.updateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { customFields: [{ name: 'source', value: 'admin' }] },
      );
    });

    it('should assign a billing info from the subscription account without a plan change', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
      });
      client.updateSubscription.mockResolvedValue({});

      const subscription = await subscriptions.update(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID },
      );

      expect(client.getABillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        RECURLY_FIXTURES.BILLING_INFO_ID,
      );
      expect(client.createSubscriptionChange).not.toHaveBeenCalled();
      expect(client.updateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID },
      );
      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should save the billing info and metadata in one update', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
      });
      client.updateSubscription.mockResolvedValue({});

      await subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        metadata: { source: 'admin' },
      });

      expect(client.updateSubscription).toHaveBeenCalledTimes(1);
      expect(client.updateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        {
          billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID,
          customFields: [{ name: 'source', value: 'admin' }],
        },
      );
    });

    it('should reject a billing info that is not on the subscription account with PaymentMethodError, before any write', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getABillingInfo.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          price: RECURLY_FIXTURES.PLAN_CODE_REFERENCE,
          paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        }),
      ).rejects.toMatchObject({
        constructor: PaymentMethodError,
        provider: CashierProvider.Recurly,
      });
      expect(client.createSubscriptionChange).not.toHaveBeenCalled();
      expect(client.updateSubscription).not.toHaveBeenCalled();
    });

    it('should map a Recurly billing_info_id validation error to PaymentMethodError', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
      });
      client.updateSubscription.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.ValidationError(
            'Billing info is invalid',
            'validation',
            { params: [{ param: 'billing_info_id', message: 'is invalid' }] },
          ),
          422,
        ),
      );

      await expect(
        subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        }),
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });
  });

  describe('cancel', () => {
    it('should terminate immediately without a refund by default', async () => {
      client.terminateSubscription.mockResolvedValue(
        RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
      );

      await subscriptions.cancel(RECURLY_FIXTURES.SUBSCRIPTION_ID);

      expect(client.terminateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { refund: 'none' } },
      );
      expect(client.cancelSubscription).not.toHaveBeenCalled();
    });

    it('should cancel at the end of the term', async () => {
      client.cancelSubscription.mockResolvedValue(
        RECURLY_FIXTURES.CANCELED_SUBSCRIPTION,
      );

      const subscription = await subscriptions.cancel(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { atPeriodEnd: true },
      );

      expect(client.cancelSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { timeframe: 'term_end' } },
      );
      expect(subscription.cancelAtPeriodEnd).toBe(true);
    });

    it('should ignore an empty comment', async () => {
      client.terminateSubscription.mockResolvedValue(
        RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
      );

      await subscriptions.cancel(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        comment: '',
      });

      expect(client.terminateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { refund: 'none' } },
      );
    });

    it.each([
      ['immediately', {}],
      ['at the end of the term', { atPeriodEnd: true }],
    ])(
      'should reject a comment %s without calling Recurly',
      async (_case, params) => {
        await expect(
          subscriptions.cancel(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
            ...params,
            comment: 'cancelled by customer-42',
          }),
        ).rejects.toMatchObject({
          constructor: UnsupportedOperationError,
          provider: CashierProvider.Recurly,
          message: 'Recurly cannot store a cancellation comment',
        });
        expect(client.terminateSubscription).not.toHaveBeenCalled();
        expect(client.cancelSubscription).not.toHaveBeenCalled();
      },
    );
  });

  describe('startDate', () => {
    it('should be null for a subscription that was never activated', async () => {
      client.getSubscription.mockResolvedValue({
        ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        activatedAt: null,
      });

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(subscription.startDate).toBeNull();
    });
  });

  describe('get with relations', () => {
    const CARD_BILLING_INFO = {
      id: RECURLY_FIXTURES.BILLING_INFO_ID,
      paymentMethod: {
        object: 'credit_card',
        cardType: 'MasterCard',
        lastFour: '4444',
        expMonth: 8,
        expYear: 2027,
      },
    } as recurly.BillingInfo;

    const EXPECTED_CARD = {
      id: RECURLY_FIXTURES.BILLING_INFO_ID,
      type: 'card',
      brand: 'mastercard',
      last4: '4444',
      expMonth: 8,
      expYear: 2027,
      wallet: null,
    };

    it('should load the billing info the subscription is billed with', async () => {
      client.getSubscription.mockResolvedValue({
        ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID,
      });
      client.getABillingInfo.mockResolvedValue(CARD_BILLING_INFO);

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { with: ['paymentMethod'] },
      );

      expect(client.getABillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        RECURLY_FIXTURES.BILLING_INFO_ID,
      );
      expect(client.getBillingInfo).not.toHaveBeenCalled();
      expect(subscription).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
        paymentMethod: EXPECTED_CARD,
      });
    });

    it('should load the account billing info when the subscription has none of its own', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getBillingInfo.mockResolvedValue(CARD_BILLING_INFO);

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { with: ['paymentMethod'] },
      );

      expect(client.getBillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
      );
      expect(client.getABillingInfo).not.toHaveBeenCalled();
      expect(subscription.paymentMethod).toEqual(EXPECTED_CARD);
    });

    it('should be null when the account has no billing info', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getBillingInfo.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { with: ['paymentMethod'] },
      );

      expect(subscription.paymentMethod).toBeNull();
    });

    it('should map any other billing info error', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.getBillingInfo.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.UnauthorizedError(
            'Unauthorized',
            'unauthorized',
            {},
          ),
          401,
        ),
      );

      await expect(
        subscriptions.get(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          with: ['paymentMethod'],
        }),
      ).rejects.toMatchObject({
        constructor: AuthenticationError,
        provider: CashierProvider.Recurly,
      });
    });

    it('should reject the payment method of a subscription without an account', async () => {
      client.getSubscription.mockResolvedValue({
        ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        account: null,
      });

      await expect(
        subscriptions.get(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          with: ['paymentMethod'],
        }),
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it('should load the latest invoice of the subscription', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.listSubscriptionInvoices.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.INVOICES),
      );

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { with: ['latestInvoice'] },
      );

      expect(client.listSubscriptionInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { limit: 1, sort: 'created_at', order: 'desc' } },
      );
      expect(subscription).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
        latestInvoice: RECURLY_FIXTURES.EXPECTED_INVOICES[0],
      });
    });

    it('should have no latest invoice when the subscription has none', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );
      client.listSubscriptionInvoices.mockReturnValue(createRecurlyPager([]));

      const subscription = await subscriptions.get(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { with: ['latestInvoice'] },
      );

      expect(subscription.latestInvoice).toBeNull();
    });

    it('should load the payment method and latest invoice of every listed subscription', async () => {
      client.listAccountSubscriptions.mockReturnValue(
        createRecurlyPager([
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
          RECURLY_FIXTURES.PAUSED_DISCOUNTED_SUBSCRIPTION,
        ]),
      );
      client.getBillingInfo.mockResolvedValue(CARD_BILLING_INFO);
      client.listSubscriptionInvoices.mockReturnValue(createRecurlyPager([]));

      const result = await subscriptions.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['paymentMethod', 'latestInvoice'],
      });

      expect(client.getBillingInfo).toHaveBeenCalledTimes(2);
      expect(client.listSubscriptionInvoices).toHaveBeenCalledWith(
        'rec_sub_2',
        { params: { limit: 1, sort: 'created_at', order: 'desc' } },
      );
      expect(result.map((subscription) => subscription.paymentMethod)).toEqual([
        EXPECTED_CARD,
        EXPECTED_CARD,
      ]);
    });

    it('should not load billing infos or invoices without the relations', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      await subscriptions.get(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        with: ['product'],
      });

      expect(client.getBillingInfo).not.toHaveBeenCalled();
      expect(client.getABillingInfo).not.toHaveBeenCalled();
      expect(client.listSubscriptionInvoices).not.toHaveBeenCalled();
    });

    it('should reject a relation Recurly does not support without calling Recurly', async () => {
      await expect(
        subscriptions.get(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          with: ['refunds' as 'product'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.getSubscription).not.toHaveBeenCalled();
    });
  });

  describe('update options', () => {
    it('should reject an item without calling Recurly', async () => {
      await expect(
        subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          item: 'si_123',
          quantity: 2,
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.getSubscription).not.toHaveBeenCalled();
      expect(client.createSubscriptionChange).not.toHaveBeenCalled();
    });

    it('should change the plan without proration', async () => {
      client.createSubscriptionChange.mockResolvedValue({});
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      await subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        price: RECURLY_FIXTURES.PLAN_ID,
        proration: 'none',
      });

      expect(client.createSubscriptionChange).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        {
          timeframe: 'now',
          planId: RECURLY_FIXTURES.PLAN_ID,
          prorationSettings: { charge: 'none', credit: 'none' },
        },
      );
    });

    it.each(['prorate', 'invoiceNow'] as const)(
      'should keep Recurly default proration for %s',
      async (proration) => {
        client.createSubscriptionChange.mockResolvedValue({});
        client.getSubscription.mockResolvedValue(
          RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        );

        await subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          quantity: 3,
          proration,
        });

        expect(client.createSubscriptionChange).toHaveBeenCalledWith(
          RECURLY_FIXTURES.SUBSCRIPTION_ID,
          { timeframe: 'now', quantity: 3 },
        );
      },
    );

    it('should move the trial end with the next bill date during a trial', async () => {
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      client.getSubscription.mockResolvedValue({
        ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
        trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      client.updateSubscription.mockResolvedValue({});

      await subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
        trialEnd,
        metadata: { source: 'admin' },
      });

      expect(client.updateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        {
          nextBillDate: trialEnd,
          customFields: [{ name: 'source', value: 'admin' }],
        },
      );
    });

    it('should reject a trial end outside a trial before any write', async () => {
      client.getSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      await expect(
        subscriptions.update(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          trialEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
          quantity: 2,
        }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.createSubscriptionChange).not.toHaveBeenCalled();
      expect(client.updateSubscription).not.toHaveBeenCalled();
    });
  });

  describe('cancel with a refund', () => {
    it.each([
      ['full', 'full'],
      ['prorated', 'partial'],
    ] as const)(
      'should terminate with a %s refund',
      async (refund, recurlyRefund) => {
        client.terminateSubscription.mockResolvedValue(
          RECURLY_FIXTURES.EXPIRED_SUBSCRIPTION,
        );

        const subscription = await subscriptions.cancel(
          RECURLY_FIXTURES.SUBSCRIPTION_ID,
          { refund },
        );

        expect(client.terminateSubscription).toHaveBeenCalledWith(
          RECURLY_FIXTURES.SUBSCRIPTION_ID,
          { params: { refund: recurlyRefund } },
        );
        expect(subscription).toEqual(
          RECURLY_FIXTURES.EXPECTED_EXPIRED_SUBSCRIPTION,
        );
      },
    );

    it('should reject a refund at period end without calling Recurly', async () => {
      await expect(
        subscriptions.cancel(RECURLY_FIXTURES.SUBSCRIPTION_ID, {
          atPeriodEnd: true,
          refund: 'full',
        }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.cancelSubscription).not.toHaveBeenCalled();
      expect(client.terminateSubscription).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should reactivate the canceled subscription', async () => {
      client.reactivateSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      const subscription = await subscriptions.resume(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );

      expect(client.reactivateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );
      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should map a subscription Recurly cannot reactivate', async () => {
      client.reactivateSubscription.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.ValidationError(
            'Subscription is not canceled',
            'validation',
            {},
          ),
          422,
        ),
      );

      await expect(
        subscriptions.resume(RECURLY_FIXTURES.SUBSCRIPTION_ID),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
      });
    });
  });

  describe('changeBillingDate', () => {
    it('should set the next bill date', async () => {
      const date = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

      client.updateSubscription.mockResolvedValue(
        RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      );

      const subscription = await subscriptions.changeBillingDate(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        date,
      );

      expect(client.updateSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { nextBillDate: date },
      );
      expect(subscription).toEqual(
        RECURLY_FIXTURES.EXPECTED_ACTIVE_SUBSCRIPTION,
      );
    });

    it('should reject a date that is not in the future without calling Recurly', async () => {
      await expect(
        subscriptions.changeBillingDate(
          RECURLY_FIXTURES.SUBSCRIPTION_ID,
          new Date(Date.now() - 1000),
        ),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.updateSubscription).not.toHaveBeenCalled();
    });
  });
});
