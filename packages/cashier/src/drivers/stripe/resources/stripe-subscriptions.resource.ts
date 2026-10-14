import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CancelSubscriptionParams,
  CreateSubscriptionParams,
  CursorPaginateSubscriptionsParams,
  ListSubscriptionsParams,
  ProviderSubscriptionRelation,
  Subscription,
  SubscriptionProduct,
  SubscriptionStatusFilter,
  SubscriptionWith,
  SubscriptionsResource,
  UpdateSubscriptionParams,
} from '../../../types/subscription.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_LIST_LIMIT,
  STRIPE_MAX_CANCELLATION_COMMENT_LENGTH,
  STRIPE_SUBSCRIPTION_RELATIONS,
  STRIPE_SUBSCRIPTION_STATUS_FILTERS,
} from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  getStripeSubscriptionProductId,
  mapStripeSubscription,
} from '../mappers/stripe-subscription.mapper';
import { toStripeCursorPaginator } from '../mappers/stripe-mapper.utils';
import { stripeRequest } from '../stripe-request';

type StripeSubscriptionRelation =
  ProviderSubscriptionRelation<CashierProvider.Stripe>;

const toStripeStatus = (
  status: SubscriptionStatusFilter,
): Stripe.SubscriptionListParams.Status | null =>
  status === 'all'
    ? 'all'
    : (STRIPE_SUBSCRIPTION_STATUS_FILTERS[status] ?? null);

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
          ...(trialEnd
            ? { trial_end: Math.floor(trialEnd.getTime() / 1000) }
            : {}),
          ...(metadata ? { metadata } : {}),
        }),
      ),
    );
  }

  get(subscriptionId: string): Promise<Subscription> {
    return stripeRequest(async () =>
      mapStripeSubscription(
        await this.client.subscriptions.retrieve(subscriptionId),
      ),
    );
  }

  update(
    subscriptionId: string,
    { price, quantity, metadata }: UpdateSubscriptionParams,
  ): Promise<Subscription> {
    return stripeRequest(async () => {
      const isItemChange = price !== undefined || quantity !== undefined;
      const items = isItemChange
        ? [
            {
              id: await this.getSingleItemId(subscriptionId),
              ...(price ? { price } : {}),
              ...(quantity !== undefined ? { quantity } : {}),
            },
          ]
        : undefined;

      return mapStripeSubscription(
        await this.client.subscriptions.update(subscriptionId, {
          ...(items ? { items } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      );
    });
  }

  cancel(
    subscriptionId: string,
    { atPeriodEnd = false, comment }: CancelSubscriptionParams = {},
  ): Promise<Subscription> {
    return stripeRequest(async () => {
      if (comment && comment.length > STRIPE_MAX_CANCELLATION_COMMENT_LENGTH) {
        throw new ValidationError(
          `The cancellation comment must be at most ${STRIPE_MAX_CANCELLATION_COMMENT_LENGTH} characters`,
          { provider: CashierProvider.Stripe },
        );
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

      return mapStripeSubscription(
        cancellationDetails
          ? await this.client.subscriptions.cancel(
              subscriptionId,
              cancellationDetails,
            )
          : await this.client.subscriptions.cancel(subscriptionId),
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
        resolveRelations(
          CashierProvider.Stripe,
          'subscriptions',
          STRIPE_SUBSCRIPTION_RELATIONS,
          requested,
        );
      const stripeStatus = toStripeStatus(status);

      if (!stripeStatus) {
        return { data: [], perPage, hasMorePages: false, nextCursor: null };
      }

      const response = await this.client.subscriptions.list({
        ...params,
        status: stripeStatus,
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

  private async getSingleItemId(subscriptionId: string): Promise<string> {
    const subscription =
      await this.client.subscriptions.retrieve(subscriptionId);
    const [item, ...otherItems] = subscription.items.data;

    if (!item || otherItems.length > 0) {
      throw new ValidationError(
        'Changing price or quantity requires a subscription with exactly one item',
        { provider: CashierProvider.Stripe },
      );
    }

    return item.id;
  }
}
