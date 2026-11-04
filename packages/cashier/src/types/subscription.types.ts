import { CashierProvider } from './cashier.types';
import { Invoice } from './invoice.types';
import { CursorPaginateParams, CursorPaginator } from './pagination.types';
import { PaymentMethodDetails } from './payment-method.types';
import { BillingInterval } from './price.types';
import {
  LoadedRelations,
  ProviderRelation,
  WithParams,
} from './relation.types';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'paused'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'future'
  | 'failed'
  | 'unknown';

export interface SubscriptionItem {
  id: string | null;
  priceId: string;
  quantity: number;
  unitAmount: number | null;
}

export interface Subscription {
  id: string;
  customerId: string | null;
  status: SubscriptionStatus;
  items: SubscriptionItem[];
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  trialEnd: Date | null;
  startDate: Date | null;
  createdAt: Date;
  metadata: Record<string, string>;
  provider: CashierProvider;
}

export interface SubscriptionProduct {
  id: string;
  name: string;
}

export interface SubscriptionPause {
  behavior: string | null;
  resumesAt: Date | null;
}

export interface SubscriptionDiscount {
  couponId: string;
  name: string | null;
  amountOff: number | null;
  percentOff: number | null;
}

export type SubscriptionPaymentMethod = PaymentMethodDetails & { id: string };

export interface SubscriptionRelationFields {
  product: { product: SubscriptionProduct | null };
  interval: { interval: BillingInterval | null };
  pause: { pause: SubscriptionPause | null };
  discount: { discount: SubscriptionDiscount | null };
  paymentMethod: { paymentMethod: SubscriptionPaymentMethod | null };
  latestInvoice: { latestInvoice: Invoice | null };
}

export type SubscriptionRelation = keyof SubscriptionRelationFields;

export interface CashierSubscriptionRelations {
  stripe:
    | 'product'
    | 'interval'
    | 'pause'
    | 'discount'
    | 'paymentMethod'
    | 'latestInvoice';
  recurly:
    | 'product'
    | 'interval'
    | 'pause'
    | 'discount'
    | 'paymentMethod'
    | 'latestInvoice';
}

export type ProviderSubscriptionRelation<Provider extends CashierProvider> =
  Extract<
    ProviderRelation<CashierSubscriptionRelations, Provider>,
    SubscriptionRelation
  >;

export type SubscriptionWith<Relation extends SubscriptionRelation = never> =
  Subscription & LoadedRelations<SubscriptionRelationFields, Relation>;

export type GetSubscriptionParams<
  Relation extends SubscriptionRelation = never,
> = WithParams<Relation>;

export type SubscriptionStatusFilter = SubscriptionStatus | 'all';

export interface ListSubscriptionsParams<
  Relation extends SubscriptionRelation = never,
> extends WithParams<Relation> {
  customer: string;
  status?: SubscriptionStatusFilter;
  limit?: number;
}

export type SubscriptionScope =
  { customer: string; price?: string } | { customer?: string; price: string };

export type CursorPaginateSubscriptionsParams<
  Relation extends SubscriptionRelation = never,
> = Omit<CursorPaginateParams, 'customer'> &
  WithParams<Relation> &
  SubscriptionScope & {
    status?: SubscriptionStatusFilter;
  };

export interface CreateSubscriptionParams {
  customer: string;
  price: string;
  currency: string;
  quantity?: number;
  paymentMethod?: string;
  couponCode?: string;
  trialEnd?: Date;
  metadata?: Record<string, string>;
}

export type SubscriptionProration = 'prorate' | 'none' | 'invoiceNow';

export interface UpdateSubscriptionParams {
  item?: string;
  price?: string;
  quantity?: number;
  proration?: SubscriptionProration;
  trialEnd?: Date;
  paymentMethod?: string;
  metadata?: Record<string, string>;
}

export type SubscriptionRefund = 'full' | 'prorated';

export interface CancelSubscriptionParams {
  atPeriodEnd?: boolean;
  comment?: string;
  refund?: SubscriptionRefund;
}

export interface SubscriptionsResource<
  Provider extends CashierProvider = CashierProvider,
> {
  list<Relation extends ProviderSubscriptionRelation<Provider> = never>(
    params: ListSubscriptionsParams<Relation>,
  ): Promise<SubscriptionWith<Relation>[]>;
  cursorPaginate<
    Relation extends ProviderSubscriptionRelation<Provider> = never,
  >(
    params: CursorPaginateSubscriptionsParams<Relation>,
  ): Promise<CursorPaginator<SubscriptionWith<Relation>>>;
  create(params: CreateSubscriptionParams): Promise<Subscription>;
  get<Relation extends ProviderSubscriptionRelation<Provider> = never>(
    subscriptionId: string,
    params?: GetSubscriptionParams<Relation>,
  ): Promise<SubscriptionWith<Relation>>;
  update(
    subscriptionId: string,
    params: UpdateSubscriptionParams,
  ): Promise<Subscription>;
  cancel(
    subscriptionId: string,
    params?: CancelSubscriptionParams,
  ): Promise<Subscription>;
  resume(subscriptionId: string): Promise<Subscription>;
  changeBillingDate(subscriptionId: string, date: Date): Promise<Subscription>;
}
