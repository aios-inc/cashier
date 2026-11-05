import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import { Invoice } from '../../../types/invoice.types';
import {
  Subscription,
  SubscriptionDiscount,
  SubscriptionItem,
  SubscriptionPause,
  SubscriptionProduct,
  SubscriptionRelation,
  SubscriptionStatus,
  SubscriptionWith,
} from '../../../types/subscription.types';
import {
  fromUnixSeconds,
  getExpandableId,
  getExpanded,
  toStripeInterval,
} from './stripe-mapper.utils';
import { mapStripeInvoice } from './stripe-invoice.mapper';
import { mapStripeSubscriptionPaymentMethod } from './stripe-payment-method.mapper';

const mapStripeSubscriptionItem = (
  item: Stripe.SubscriptionItem,
): SubscriptionItem => ({
  id: item.id,
  priceId: item.price.id,
  quantity: item.quantity ?? 1,
  unitAmount: item.price.unit_amount,
});

const mapStripeSubscriptionPause = (
  pause: Stripe.Subscription.PauseCollection | null | undefined,
): SubscriptionPause | null =>
  pause
    ? { behavior: pause.behavior, resumesAt: fromUnixSeconds(pause.resumes_at) }
    : null;

const mapStripeSubscriptionDiscount = (
  discount: Stripe.Discount | null | undefined,
): SubscriptionDiscount | null =>
  discount
    ? {
        couponId: discount.coupon.id,
        name: discount.coupon.name,
        amountOff: discount.coupon.amount_off,
        percentOff: discount.coupon.percent_off,
      }
    : null;

const getStripeSubscriptionPaymentMethod = (
  subscription: Stripe.Subscription,
): string | Stripe.PaymentMethod | null => {
  const customer = getExpanded(subscription.customer);
  const customerDefault =
    customer && !customer.deleted
      ? customer.invoice_settings?.default_payment_method
      : null;

  return subscription.default_payment_method ?? customerDefault ?? null;
};

const mapStripeLatestInvoice = (
  invoice: string | Stripe.Invoice | null,
): Invoice | null => {
  const expanded = getExpanded(invoice);

  return expanded ? mapStripeInvoice(expanded) : null;
};

export const getStripeCancelAt = (
  subscription: Stripe.Subscription,
): Date | null =>
  fromUnixSeconds(subscription.cancel_at) ??
  (subscription.cancel_at_period_end
    ? fromUnixSeconds(subscription.current_period_end)
    : null);

export const getStripeSubscriptionProductId = (
  subscription: Stripe.Subscription,
): string | null => getExpandableId(subscription.items.data[0]?.price.product);

export const mapStripeSubscription = (
  subscription: Stripe.Subscription,
  relations: ReadonlySet<SubscriptionRelation> = new Set(),
  products: ReadonlyMap<string, SubscriptionProduct> = new Map(),
): Subscription & Partial<SubscriptionWith<SubscriptionRelation>> => ({
  id: subscription.id,
  customerId: getExpandableId(subscription.customer),
  status: subscription.status satisfies SubscriptionStatus,
  items: subscription.items.data.map(mapStripeSubscriptionItem),
  currency: subscription.currency.toUpperCase(),
  currentPeriodStart: fromUnixSeconds(subscription.current_period_start),
  currentPeriodEnd: fromUnixSeconds(subscription.current_period_end),
  cancelAtPeriodEnd: subscription.cancel_at_period_end,
  cancelAt: getStripeCancelAt(subscription),
  canceledAt: fromUnixSeconds(subscription.canceled_at),
  trialEnd: fromUnixSeconds(subscription.trial_end),
  startDate: fromUnixSeconds(subscription.start_date),
  createdAt: new Date(subscription.created * 1000),
  metadata: subscription.metadata,
  provider: CashierProvider.Stripe,
  ...(relations.has('product')
    ? {
        product:
          products.get(getStripeSubscriptionProductId(subscription) ?? '') ??
          null,
      }
    : {}),
  ...(relations.has('interval')
    ? {
        interval: toStripeInterval(subscription.items.data[0]?.price.recurring),
      }
    : {}),
  ...(relations.has('pause')
    ? { pause: mapStripeSubscriptionPause(subscription.pause_collection) }
    : {}),
  ...(relations.has('discount')
    ? { discount: mapStripeSubscriptionDiscount(subscription.discount) }
    : {}),
  ...(relations.has('paymentMethod')
    ? {
        paymentMethod: mapStripeSubscriptionPaymentMethod(
          getStripeSubscriptionPaymentMethod(subscription),
        ),
      }
    : {}),
  ...(relations.has('latestInvoice')
    ? {
        latestInvoice: mapStripeLatestInvoice(subscription.latest_invoice),
      }
    : {}),
});
