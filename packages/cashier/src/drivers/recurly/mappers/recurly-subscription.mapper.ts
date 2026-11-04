import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  BillingInterval,
  BillingIntervalUnit,
} from '../../../types/price.types';
import {
  Subscription,
  SubscriptionDiscount,
  SubscriptionPause,
  SubscriptionProduct,
  SubscriptionRelation,
  SubscriptionStatus,
  SubscriptionWith,
} from '../../../types/subscription.types';
import { toMinorUnits } from '../../../utils/money.utils';
import { mapRecurlyInvoice } from './recurly-invoice.mapper';
import { mapRecurlySubscriptionPaymentMethod } from './recurly-payment-method.mapper';

export interface RecurlySubscriptionLoaded {
  billingInfo?: recurly.BillingInfo | null;
  latestInvoice?: recurly.Invoice | null;
}

const RECURLY_SUBSCRIPTION_STATUSES: Record<string, SubscriptionStatus> = {
  active: 'active',
  live: 'active',
  canceled: 'active',
  in_trial: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  expired: 'canceled',
  future: 'future',
  failed: 'failed',
};

export const mapRecurlySubscriptionStatus = (
  state: string | null | undefined,
): SubscriptionStatus =>
  RECURLY_SUBSCRIPTION_STATUSES[state ?? ''] ?? 'unknown';

const RECURLY_INTERVAL_UNITS: Record<string, BillingIntervalUnit> = {
  days: 'day',
  months: 'month',
};

export const mapRecurlyPlanInterval = (
  plan: recurly.Plan | undefined,
): BillingInterval | null => {
  const unit = RECURLY_INTERVAL_UNITS[plan?.intervalUnit ?? ''];
  const count = plan?.intervalLength;

  return unit && count ? { unit, count } : null;
};

const mapRecurlySubscriptionProduct = (
  plan: recurly.PlanMini | null | undefined,
): SubscriptionProduct | null =>
  plan?.id ? { id: plan.id, name: plan.name ?? '' } : null;

const mapRecurlySubscriptionPause = (
  subscription: recurly.Subscription,
): SubscriptionPause | null =>
  subscription.state === 'paused' || subscription.pausedAt
    ? { behavior: null, resumesAt: null }
    : null;

const mapRecurlySubscriptionDiscount = (
  subscription: recurly.Subscription,
  currency: string,
): SubscriptionDiscount | null => {
  const coupon = subscription.couponRedemptions?.find(
    (redemption) => redemption.state === 'active',
  )?.coupon;

  if (!coupon) return null;

  const amountOff = coupon.discount?.currencies?.find(
    (pricing) => pricing.currency?.toUpperCase() === currency,
  )?.amount;

  return {
    couponId: coupon.code ?? coupon.id ?? '',
    name: coupon.name ?? null,
    amountOff:
      typeof amountOff === 'number' ? toMinorUnits(amountOff, currency) : null,
    percentOff: coupon.discount?.percent ?? null,
  };
};

export const mapCustomFields = (
  customFields: recurly.CustomField[] | null | undefined,
): Record<string, string> =>
  Object.fromEntries(
    (customFields ?? [])
      .filter((field) => field.name)
      .map((field) => [field.name as string, field.value ?? '']),
  );

export const mapRecurlySubscription = (
  subscription: recurly.Subscription,
  relations: ReadonlySet<SubscriptionRelation> = new Set(),
  plans: ReadonlyMap<string, recurly.Plan> = new Map(),
  loaded: RecurlySubscriptionLoaded = {},
): Subscription & Partial<SubscriptionWith<SubscriptionRelation>> => {
  const currency = (subscription.currency ?? '').toUpperCase();

  return {
    id: subscription.id ?? '',
    customerId: subscription.account?.id ?? null,
    status: mapRecurlySubscriptionStatus(subscription.state),
    items: [
      {
        id: null,
        priceId: subscription.plan?.id ?? '',
        quantity: subscription.quantity ?? 1,
        unitAmount:
          subscription.unitAmount === null ||
          subscription.unitAmount === undefined
            ? null
            : toMinorUnits(subscription.unitAmount, currency),
      },
    ],
    currency,
    currentPeriodStart: subscription.currentPeriodStartedAt ?? null,
    currentPeriodEnd: subscription.currentPeriodEndsAt ?? null,
    cancelAtPeriodEnd: subscription.state === 'canceled',
    cancelAt:
      subscription.state === 'canceled'
        ? (subscription.expiresAt ?? null)
        : null,
    canceledAt: subscription.canceledAt ?? null,
    trialEnd: subscription.trialEndsAt ?? null,
    startDate: subscription.activatedAt ?? null,
    createdAt: subscription.createdAt ?? new Date(0),
    metadata: mapCustomFields(subscription.customFields),
    provider: CashierProvider.Recurly,
    ...(relations.has('product')
      ? { product: mapRecurlySubscriptionProduct(subscription.plan) }
      : {}),
    ...(relations.has('interval')
      ? {
          interval: mapRecurlyPlanInterval(
            plans.get(subscription.plan?.id ?? ''),
          ),
        }
      : {}),
    ...(relations.has('pause')
      ? { pause: mapRecurlySubscriptionPause(subscription) }
      : {}),
    ...(relations.has('discount')
      ? { discount: mapRecurlySubscriptionDiscount(subscription, currency) }
      : {}),
    ...(relations.has('paymentMethod')
      ? {
          paymentMethod: mapRecurlySubscriptionPaymentMethod(
            loaded.billingInfo ?? null,
          ),
        }
      : {}),
    ...(relations.has('latestInvoice')
      ? {
          latestInvoice: loaded.latestInvoice
            ? mapRecurlyInvoice(loaded.latestInvoice)
            : null,
        }
      : {}),
  };
};

export const toRecurlyCustomFields = (
  metadata: Record<string, string>,
): recurly.CustomField[] =>
  Object.entries(metadata).map(([name, value]) => ({ name, value }));
