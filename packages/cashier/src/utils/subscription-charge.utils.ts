import { CashierProvider } from '../types/cashier.types';
import { Subscription, SubscriptionStatus } from '../types/subscription.types';
import { SubscriptionError } from '../errors/subscription.error';

const RENEWING_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'active',
  'trialing',
  'past_due',
]);

const endsBeforeRenewal = ({
  cancelAtPeriodEnd,
  cancelAt,
  currentPeriodEnd,
}: Subscription): boolean => {
  if (cancelAtPeriodEnd) return true;

  if (!cancelAt) return false;

  return !currentPeriodEnd || cancelAt.getTime() <= currentPeriodEnd.getTime();
};

export const assertSubscriptionRenews = (
  subscription: Subscription,
  provider: CashierProvider,
): void => {
  if (
    !RENEWING_STATUSES.has(subscription.status) ||
    endsBeforeRenewal(subscription)
  ) {
    throw new SubscriptionError(
      `Subscription ${subscription.id} does not renew, so a charge for its next renewal would never be billed`,
      { provider },
    );
  }
};
