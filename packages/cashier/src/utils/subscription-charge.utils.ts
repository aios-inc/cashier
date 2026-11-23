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
  skipsNextRenewal: boolean,
): void => {
  if (
    skipsNextRenewal ||
    !RENEWING_STATUSES.has(subscription.status) ||
    endsBeforeRenewal(subscription)
  ) {
    throw new SubscriptionError(
      `Subscription ${subscription.id} does not renew or its next renewal is not collected, so a charge for it would never be paid`,
      { provider },
    );
  }
};
