import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CancelSubscriptionParams,
  CreateSubscriptionParams,
  CursorPaginateSubscriptionsParams,
  ListSubscriptionsParams,
  ProviderSubscriptionRelation,
  Subscription,
  SubscriptionStatusFilter,
  SubscriptionWith,
  SubscriptionsResource,
  UpdateSubscriptionParams,
} from '../../../types/subscription.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_LIST_LIMIT,
  RECURLY_SUBSCRIPTION_RELATIONS,
  RECURLY_SUBSCRIPTION_STATE_FILTERS,
} from '../../../constants/cashier.constants';
import { UnsupportedOperationError } from '../../../errors/unsupported-operation.error';
import { ValidationError } from '../../../errors/validation.error';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapRecurlySubscription,
  mapRecurlySubscriptionStatus,
  toRecurlyCustomFields,
} from '../mappers/recurly-subscription.mapper';
import {
  RECURLY_CODE_PREFIX,
  toRecurlyPlanReference,
} from '../recurly-plan-reference';
import { readRecurlyItems, readRecurlyPage } from '../recurly-page';
import { recurlyRequest } from '../recurly-request';

type RecurlySubscriptionRelation =
  ProviderSubscriptionRelation<CashierProvider.Recurly>;

const resolveSubscriptionRelations = (
  requested?: readonly RecurlySubscriptionRelation[],
): ReadonlySet<RecurlySubscriptionRelation> =>
  resolveRelations(
    CashierProvider.Recurly,
    'subscriptions',
    RECURLY_SUBSCRIPTION_RELATIONS,
    requested,
  );

const hasStatus =
  (status: SubscriptionStatusFilter) =>
  (subscription: recurly.Subscription): boolean =>
    status === 'all' ||
    mapRecurlySubscriptionStatus(subscription.state) === status;

const hasPrice =
  (price?: string) =>
  (subscription: recurly.Subscription): boolean =>
    !price ||
    (price.startsWith(RECURLY_CODE_PREFIX)
      ? subscription.plan?.code === price.slice(RECURLY_CODE_PREFIX.length)
      : subscription.plan?.id === price);

export class RecurlySubscriptionsResource implements SubscriptionsResource<CashierProvider.Recurly> {
  constructor(private readonly client: recurly.Client) {}

  list<Relation extends RecurlySubscriptionRelation = never>({
    customer,
    status = 'all',
    limit = DEFAULT_LIST_LIMIT,
    with: requested,
  }: ListSubscriptionsParams<Relation>): Promise<SubscriptionWith<Relation>[]> {
    return recurlyRequest(async () => {
      const relations = resolveSubscriptionRelations(requested);

      return this.map<Relation>(
        await readRecurlyItems(
          this.subscriptions(customer, limit, status),
          limit,
          hasStatus(status),
        ),
        relations,
      );
    });
  }

  cursorPaginate<Relation extends RecurlySubscriptionRelation = never>({
    customer,
    price,
    status = 'all',
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: requested,
  }: CursorPaginateSubscriptionsParams<Relation>): Promise<
    CursorPaginator<SubscriptionWith<Relation>>
  > {
    return recurlyRequest(async () => {
      if (!customer && !price) {
        throw new ValidationError(
          'Listing subscriptions requires a customer or a price',
          { provider: CashierProvider.Recurly },
        );
      }

      const relations = resolveSubscriptionRelations(requested);
      const page = await readRecurlyPage(
        this.subscriptions(customer, perPage, status, cursor),
      );

      return {
        data: await this.map<Relation>(
          page.items.filter(hasStatus(status)).filter(hasPrice(price)),
          relations,
        ),
        perPage,
        hasMorePages: page.hasMorePages,
        nextCursor: page.nextCursor,
      };
    });
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
    return recurlyRequest(async () => {
      const account = await this.client.getAccount(customer);

      return mapRecurlySubscription(
        await this.client.createSubscription({
          ...toRecurlyPlanReference(price),
          account: { code: account.code },
          currency,
          quantity,
          ...(paymentMethod ? { billingInfoId: paymentMethod } : {}),
          ...(couponCode ? { couponCodes: [couponCode] } : {}),
          ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
          ...(metadata
            ? { customFields: toRecurlyCustomFields(metadata) }
            : {}),
        }),
      );
    });
  }

  get(subscriptionId: string): Promise<Subscription> {
    return recurlyRequest(async () =>
      mapRecurlySubscription(await this.client.getSubscription(subscriptionId)),
    );
  }

  update(
    subscriptionId: string,
    { price, quantity, metadata }: UpdateSubscriptionParams,
  ): Promise<Subscription> {
    return recurlyRequest(async () => {
      if (price !== undefined || quantity !== undefined) {
        await this.client.createSubscriptionChange(subscriptionId, {
          timeframe: 'now',
          ...(price ? toRecurlyPlanReference(price) : {}),
          ...(quantity !== undefined ? { quantity } : {}),
        });
      }

      if (metadata) {
        await this.client.updateSubscription(subscriptionId, {
          customFields: toRecurlyCustomFields(metadata),
        });
      }

      return mapRecurlySubscription(
        await this.client.getSubscription(subscriptionId),
      );
    });
  }

  cancel(
    subscriptionId: string,
    { atPeriodEnd = false, comment }: CancelSubscriptionParams = {},
  ): Promise<Subscription> {
    return recurlyRequest(async () => {
      if (comment) {
        throw new UnsupportedOperationError(
          'Recurly cannot store a cancellation comment',
          { provider: CashierProvider.Recurly },
        );
      }

      return mapRecurlySubscription(
        atPeriodEnd
          ? await this.client.cancelSubscription(subscriptionId, {
              params: { timeframe: 'term_end' },
            })
          : await this.client.terminateSubscription(subscriptionId, {
              params: { refund: 'none' },
            }),
      );
    });
  }

  private subscriptions(
    customer: string | undefined,
    limit: number,
    status: SubscriptionStatusFilter,
    cursor?: string | null,
  ): recurly.Pager<recurly.Subscription> {
    const state =
      status === 'all' ? undefined : RECURLY_SUBSCRIPTION_STATE_FILTERS[status];

    const options = {
      params: {
        limit,
        ...(state ? { state } : {}),
        ...(cursor ? { cursor } : {}),
      },
    };

    return customer
      ? this.client.listAccountSubscriptions(customer, options)
      : this.client.listSubscriptions(options);
  }

  private async map<Relation extends RecurlySubscriptionRelation>(
    subscriptions: recurly.Subscription[],
    relations: ReadonlySet<RecurlySubscriptionRelation>,
  ): Promise<SubscriptionWith<Relation>[]> {
    const plans = relations.has('interval')
      ? await this.getPlans(subscriptions)
      : new Map<string, recurly.Plan>();

    return subscriptions.map(
      (subscription) =>
        mapRecurlySubscription(
          subscription,
          relations,
          plans,
        ) as SubscriptionWith<Relation>,
    );
  }

  private async getPlans(
    subscriptions: recurly.Subscription[],
  ): Promise<Map<string, recurly.Plan>> {
    const ids = [
      ...new Set(
        subscriptions
          .map((subscription) => subscription.plan?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    return new Map(
      await Promise.all(
        ids.map(async (id) => [id, await this.client.getPlan(id)] as const),
      ),
    );
  }
}
