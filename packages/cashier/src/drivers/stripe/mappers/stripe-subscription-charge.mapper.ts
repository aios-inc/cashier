import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import { SubscriptionCharge } from '../../../types/subscription.types';
import { getExpandableId, withoutCashierMetadata } from './stripe-mapper.utils';

export const mapStripeSubscriptionCharge = (
  invoiceItem: Stripe.InvoiceItem,
): SubscriptionCharge => ({
  id: invoiceItem.id,
  customerId: getExpandableId(invoiceItem.customer),
  subscriptionId: getExpandableId(invoiceItem.subscription),
  description: invoiceItem.description,
  unitAmount: invoiceItem.unit_amount ?? invoiceItem.amount,
  quantity: invoiceItem.quantity,
  amount: invoiceItem.amount,
  currency: invoiceItem.currency.toUpperCase(),
  metadata: withoutCashierMetadata(invoiceItem.metadata),
  createdAt: new Date(invoiceItem.date * 1000),
  provider: CashierProvider.Stripe,
});
