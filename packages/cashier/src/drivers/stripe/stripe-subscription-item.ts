import Stripe from 'stripe';
import { CashierProvider } from '../../types/cashier.types';
import { ValidationError } from '../../errors/validation.error';

export const getStripeSubscriptionItemId = async (
  client: Stripe,
  subscriptionId: string,
  item?: string,
): Promise<string> => {
  if (item) return item;

  const subscription = await client.subscriptions.retrieve(subscriptionId);
  const [onlyItem, ...otherItems] = subscription.items.data;

  if (!onlyItem || otherItems.length > 0) {
    throw new ValidationError(
      'Changing price or quantity of a subscription with several items requires the item',
      { provider: CashierProvider.Stripe },
    );
  }

  return onlyItem.id;
};
