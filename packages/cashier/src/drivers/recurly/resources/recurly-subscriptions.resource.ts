import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CancelSubscriptionParams,
  CreateSubscriptionParams,
  CursorPaginateSubscriptionsParams,
  GetSubscriptionParams,
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
  RECURLY_SUBSCRIPTION_REFUNDS,
  RECURLY_SUBSCRIPTION_RELATIONS,
  RECURLY_SUBSCRIPTION_STATE_FILTERS,
} from '../../../constants/cashier.constants';
import { ProviderError } from '../../../errors/provider.error';
import { UnsupportedOperationError } from '../../../errors/unsupported-operation.error';
import { ValidationError } from '../../../errors/validation.error';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  RecurlySubscriptionLoaded,
  mapRecurlySubscription,
  mapRecurlySubscriptionStatus,
  toRecurlyCustomFields,
} from '../mappers/recurly-subscription.mapper';
import {
  findRecurlyBillingInfo,
  getRecurlyBillingInfo,
} from '../recurly-billing-info';
import {
  RECURLY_CODE_PREFIX,
  toRecurlyPlanReference,
} from '../recurly-plan-reference';
import { readRecurlyItems, readRecurlyPage } from '../recurly-page';
import { recurlyRequest } from '../recurly-request';
import { toRecurlySubscriptionChange } from '../recurly-subscription-change';

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

const fail = (message: string): never => {
  throw new ValidationError(message, { provider: CashierProvider.Recurly });
};

const isInTrial = (subscription: recurly.Subscription): boolean =>
  (subscription.trialEndsAt?.getTime() ?? 0) > Date.now();

const getAccountId = (subscription: recurly.Subscription): string => {
  if (!subscription.account?.id) {
    throw new ProviderError(
      `Recurly subscription ${subscription.id} has no account`,
      { provider: CashierProvider.Recurly },
    );
  }

  return subscription.account.id;
};

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

  get<Relation extends RecurlySubscriptionRelation = never>(
    subscriptionId: string,
    params: GetSubscriptionParams<Relation> = {},
  ): Promise<SubscriptionWith<Relation>> {
    return recurlyRequest(async () => {
      const relations = resolveSubscriptionRelations(params.with);
      const [subscription] = await this.map<Relation>(
        [await this.client.getSubscription(subscriptionId)],
        relations,
      );

      return subscription as SubscriptionWith<Relation>;
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
    return recurlyRequest(async () => {
      if (item) {
        throw new UnsupportedOperationError(
          'Recurly subscriptions have a single plan, so there is no item to choose',
          { provider: CashierProvider.Recurly },
        );
      }

      const current =
        paymentMethod || trialEnd
          ? await this.client.getSubscription(subscriptionId)
          : null;

      if (current && paymentMethod) {
        await getRecurlyBillingInfo(
          this.client,
          getAccountId(current),
          paymentMethod,
        );
      }

      if (current && trialEnd && !isInTrial(current)) {
        fail(`Subscription ${subscriptionId} is not in a trial`);
      }

      if (price !== undefined || quantity !== undefined) {
        await this.client.createSubscriptionChange(
          subscriptionId,
          toRecurlySubscriptionChange({ price, quantity, proration }),
        );
      }

      if (metadata || paymentMethod || trialEnd) {
        await this.client.updateSubscription(subscriptionId, {
          ...(paymentMethod ? { billingInfoId: paymentMethod } : {}),
          ...(trialEnd ? { nextBillDate: trialEnd } : {}),
          ...(metadata
            ? { customFields: toRecurlyCustomFields(metadata) }
            : {}),
        });
      }

      return mapRecurlySubscription(
        await this.client.getSubscription(subscriptionId),
      );
    });
  }

  cancel(
    subscriptionId: string,
    { atPeriodEnd = false, comment, refund }: CancelSubscriptionParams = {},
  ): Promise<Subscription> {
    return recurlyRequest(async () => {
      if (comment) {
        throw new UnsupportedOperationError(
          'Recurly cannot store a cancellation comment',
          { provider: CashierProvider.Recurly },
        );
      }

      if (refund && atPeriodEnd) {
        fail('A refund is only possible when canceling now, not at period end');
      }

      return mapRecurlySubscription(
        atPeriodEnd
          ? await this.client.cancelSubscription(subscriptionId, {
              params: { timeframe: 'term_end' },
            })
          : await this.client.terminateSubscription(subscriptionId, {
              params: {
                refund: refund ? RECURLY_SUBSCRIPTION_REFUNDS[refund] : 'none',
              },
            }),
      );
    });
  }

  resume(subscriptionId: string): Promise<Subscription> {
    return recurlyRequest(async () =>
      mapRecurlySubscription(
        await this.client.reactivateSubscription(subscriptionId),
      ),
    );
  }

  changeBillingDate(subscriptionId: string, date: Date): Promise<Subscription> {
    return recurlyRequest(async () => {
      if (!(date.getTime() > Date.now())) {
        fail('The billing date must be in the future');
      }

      return mapRecurlySubscription(
        await this.client.updateSubscription(subscriptionId, {
          nextBillDate: date,
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
    const [plans, loaded] = await Promise.all([
      relations.has('interval')
        ? this.getPlans(subscriptions)
        : new Map<string, recurly.Plan>(),
      Promise.all(
        subscriptions.map((subscription) => this.load(subscription, relations)),
      ),
    ]);

    return subscriptions.map(
      (subscription, index) =>
        mapRecurlySubscription(
          subscription,
          relations,
          plans,
          loaded[index],
        ) as SubscriptionWith<Relation>,
    );
  }

  private async load(
    subscription: recurly.Subscription,
    relations: ReadonlySet<RecurlySubscriptionRelation>,
  ): Promise<RecurlySubscriptionLoaded> {
    const [billingInfo, latestInvoice] = await Promise.all([
      relations.has('paymentMethod')
        ? findRecurlyBillingInfo(
            this.client,
            getAccountId(subscription),
            subscription.billingInfoId,
          )
        : null,
      relations.has('latestInvoice') && subscription.id
        ? this.getLatestInvoice(subscription.id)
        : null,
    ]);

    return { billingInfo, latestInvoice };
  }

  private async getLatestInvoice(
    subscriptionId: string,
  ): Promise<recurly.Invoice | null> {
    const [invoice] = await readRecurlyItems(
      this.client.listSubscriptionInvoices(subscriptionId, {
        params: { limit: 1, sort: 'created_at', order: 'desc' },
      }),
      1,
    );

    return invoice ?? null;
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
