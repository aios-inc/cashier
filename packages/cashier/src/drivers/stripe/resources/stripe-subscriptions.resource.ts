import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CancelSubscriptionParams,
  CreateSubscriptionParams,
  CursorPaginateSubscriptionsParams,
  GetSubscriptionParams,
  ListSubscriptionsParams,
  ProviderSubscriptionRelation,
  Subscription,
  SubscriptionProduct,
  SubscriptionRefund,
  SubscriptionStatusFilter,
  SubscriptionWith,
  SubscriptionsResource,
  UpdateSubscriptionParams,
} from '../../../types/subscription.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_LIST_LIMIT,
  STRIPE_MAX_CANCELLATION_COMMENT_LENGTH,
  STRIPE_PRORATION_BEHAVIORS,
  STRIPE_SUBSCRIPTION_RELATION_EXPAND,
  STRIPE_SUBSCRIPTION_STATUS_FILTERS,
} from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  getStripeCancelAt,
  getStripeSubscriptionProductId,
  mapStripeSubscription,
} from '../mappers/stripe-subscription.mapper';
import {
  getExpanded,
  toStripeCursorPaginator,
  toStripeExpand,
  toUnixSeconds,
} from '../mappers/stripe-mapper.utils';
import { stripeRequest } from '../stripe-request';
import { getStripeSubscriptionItemId } from '../stripe-subscription-item';

type StripeSubscriptionRelation =
  ProviderSubscriptionRelation<CashierProvider.Stripe>;

const STRIPE_SUBSCRIPTION_RELATIONS: ReadonlySet<string> = new Set(
  Object.keys(STRIPE_SUBSCRIPTION_RELATION_EXPAND),
);

const resolveSubscriptionRelations = <
  Relation extends StripeSubscriptionRelation,
>(
  requested?: readonly Relation[],
): ReadonlySet<Relation> =>
  resolveRelations(
    CashierProvider.Stripe,
    'subscriptions',
    STRIPE_SUBSCRIPTION_RELATIONS,
    requested,
  );

const toStripeStatus = (
  status: SubscriptionStatusFilter,
): Stripe.SubscriptionListParams.Status | null =>
  status === 'all'
    ? 'all'
    : (STRIPE_SUBSCRIPTION_STATUS_FILTERS[status] ?? null);

const fail = (message: string): never => {
  throw new ValidationError(message, { provider: CashierProvider.Stripe });
};

const getUnusedPeriod = (
  subscription: Stripe.Subscription,
  now: number,
): number => {
  const start = subscription.current_period_start;
  const end = subscription.current_period_end;

  return end > start ? Math.min(1, Math.max(0, end - now) / (end - start)) : 0;
};

const toStripeRefund = (
  subscription: Stripe.Subscription,
  refund: SubscriptionRefund,
  now: number,
): Stripe.RefundCreateParams | null => {
  const invoice = getExpanded(subscription.latest_invoice);
  const charge = getExpanded(invoice?.charge);

  if (!invoice || !charge) return null;

  const refundable = charge.amount - charge.amount_refunded;
  const amount =
    refund === 'full'
      ? refundable
      : Math.min(
          refundable,
          Math.round(invoice.amount_paid * getUnusedPeriod(subscription, now)),
        );

  return amount > 0 ? { charge: charge.id, amount } : null;
};

export class StripeSubscriptionsResource implements SubscriptionsResource<CashierProvider.Stripe> {
  constructor(private readonly client: Stripe) {}

  async list<Relation extends StripeSubscriptionRelation = never>({
    customer,
    status = 'all',
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListSubscriptionsParams<Relation>): Promise<SubscriptionWith<Relation>[]> {
    return (
      await this.fetch<Relation>({ customer, limit }, status, limit, relations)
    ).data;
  }

  async cursorPaginate<Relation extends StripeSubscriptionRelation = never>({
    customer,
    price,
    status = 'all',
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginateSubscriptionsParams<Relation>): Promise<
    CursorPaginator<SubscriptionWith<Relation>>
  > {
    if (!customer && !price) {
      throw new ValidationError(
        'Listing subscriptions requires a customer or a price',
        { provider: CashierProvider.Stripe },
      );
    }

    return this.fetch<Relation>(
      {
        ...(customer ? { customer } : {}),
        ...(price ? { price } : {}),
        limit: perPage,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      status,
      perPage,
      relations,
    );
  }

  create({
    customer,
    price,
    currency,
    quantity = 1,
    paymentMethod,
    couponCode,
    trialEnd,
    metadata,
  }: CreateSubscriptionParams): Promise<Subscription> {
    return stripeRequest(async () =>
      mapStripeSubscription(
        await this.client.subscriptions.create({
          customer,
          items: [{ price, quantity }],
          currency: currency.toLowerCase(),
          ...(paymentMethod ? { default_payment_method: paymentMethod } : {}),
          ...(couponCode ? { coupon: couponCode } : {}),
          ...(trialEnd ? { trial_end: toUnixSeconds(trialEnd) } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      ),
    );
  }

  get<Relation extends StripeSubscriptionRelation = never>(
    subscriptionId: string,
    params: GetSubscriptionParams<Relation> = {},
  ): Promise<SubscriptionWith<Relation>> {
    return stripeRequest(async () => {
      const relations: ReadonlySet<StripeSubscriptionRelation> =
        resolveSubscriptionRelations(params.with);
      const subscription = await this.client.subscriptions.retrieve(
        subscriptionId,
        toStripeExpand(relations, STRIPE_SUBSCRIPTION_RELATION_EXPAND),
      );
      const products = relations.has('product')
        ? await this.getProducts([subscription])
        : new Map<string, SubscriptionProduct>();

      return mapStripeSubscription(
        subscription,
        relations,
        products,
      ) as SubscriptionWith<Relation>;
    });
  }

  update(
    subscriptionId: string,
    {
      item,
      price,
      quantity,
      proration,
      trialEnd,
      paymentMethod,
      metadata,
    }: UpdateSubscriptionParams,
  ): Promise<Subscription> {
    return stripeRequest(async () => {
      const isItemChange = price !== undefined || quantity !== undefined;

      if (item && !isItemChange) {
        fail('item requires a price or a quantity to change');
      }

      const items = isItemChange
        ? [
            {
              id: await getStripeSubscriptionItemId(
                this.client,
                subscriptionId,
                item,
              ),
              ...(price ? { price } : {}),
              ...(quantity !== undefined ? { quantity } : {}),
            },
          ]
        : undefined;

      return mapStripeSubscription(
        await this.client.subscriptions.update(subscriptionId, {
          ...(items ? { items } : {}),
          ...(proration
            ? { proration_behavior: STRIPE_PRORATION_BEHAVIORS[proration] }
            : {}),
          ...(trialEnd ? { trial_end: toUnixSeconds(trialEnd) } : {}),
          ...(paymentMethod ? { default_payment_method: paymentMethod } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      );
    });
  }

  cancel(
    subscriptionId: string,
    { atPeriodEnd = false, comment, refund }: CancelSubscriptionParams = {},
  ): Promise<Subscription> {
    return stripeRequest(async () => {
      if (comment && comment.length > STRIPE_MAX_CANCELLATION_COMMENT_LENGTH) {
        fail(
          `The cancellation comment must be at most ${STRIPE_MAX_CANCELLATION_COMMENT_LENGTH} characters`,
        );
      }

      if (refund && atPeriodEnd) {
        fail('A refund is only possible when canceling now, not at period end');
      }

      const cancellationDetails = comment
        ? { cancellation_details: { comment } }
        : undefined;

      if (atPeriodEnd) {
        return mapStripeSubscription(
          await this.client.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
            ...cancellationDetails,
          }),
        );
      }

      const refundParams = refund
        ? toStripeRefund(
            await this.client.subscriptions.retrieve(subscriptionId, {
              expand: ['latest_invoice.charge'],
            }),
            refund,
            toUnixSeconds(new Date()),
          )
        : null;
      const canceled = cancellationDetails
        ? await this.client.subscriptions.cancel(
            subscriptionId,
            cancellationDetails,
          )
        : await this.client.subscriptions.cancel(subscriptionId);

      if (refundParams) await this.client.refunds.create(refundParams);

      return mapStripeSubscription(canceled);
    });
  }

  resume(subscriptionId: string): Promise<Subscription> {
    return stripeRequest(async () => {
      const subscription =
        await this.client.subscriptions.retrieve(subscriptionId);

      if (!getStripeCancelAt(subscription)) {
        fail(`Subscription ${subscriptionId} is not scheduled to cancel`);
      }

      return mapStripeSubscription(
        await this.client.subscriptions.update(
          subscriptionId,
          subscription.cancel_at_period_end
            ? { cancel_at_period_end: false }
            : { cancel_at: '' },
        ),
      );
    });
  }

  changeBillingDate(subscriptionId: string, date: Date): Promise<Subscription> {
    return stripeRequest(async () => {
      if (!(date.getTime() > Date.now())) {
        fail('The billing date must be in the future');
      }

      return mapStripeSubscription(
        await this.client.subscriptions.update(subscriptionId, {
          trial_end: toUnixSeconds(date),
          proration_behavior: 'none',
        }),
      );
    });
  }

  private fetch<Relation extends StripeSubscriptionRelation>(
    params: Stripe.SubscriptionListParams,
    status: SubscriptionStatusFilter,
    perPage: number,
    requested?: readonly Relation[],
  ): Promise<CursorPaginator<SubscriptionWith<Relation>>> {
    return stripeRequest(async () => {
      const relations: ReadonlySet<StripeSubscriptionRelation> =
        resolveSubscriptionRelations(requested);
      const stripeStatus = toStripeStatus(status);

      if (!stripeStatus) {
        return { data: [], perPage, hasMorePages: false, nextCursor: null };
      }

      const response = await this.client.subscriptions.list({
        ...params,
        status: stripeStatus,
        ...toStripeExpand(
          relations,
          STRIPE_SUBSCRIPTION_RELATION_EXPAND,
          'data.',
        ),
      });
      const products = relations.has('product')
        ? await this.getProducts(response.data)
        : new Map<string, SubscriptionProduct>();

      return toStripeCursorPaginator(
        response,
        perPage,
        (subscription) =>
          mapStripeSubscription(
            subscription,
            relations,
            products,
          ) as SubscriptionWith<Relation>,
      );
    });
  }

  private async getProducts(
    subscriptions: Stripe.Subscription[],
  ): Promise<Map<string, SubscriptionProduct>> {
    const ids = [
      ...new Set(
        subscriptions
          .map(getStripeSubscriptionProductId)
          .filter((id): id is string => id !== null),
      ),
    ];

    if (ids.length === 0) return new Map();

    const response = await this.client.products.list({
      ids,
      limit: DEFAULT_LIST_LIMIT,
    });

    return new Map(
      response.data.map((product) => [
        product.id,
        { id: product.id, name: product.name },
      ]),
    );
  }
}
