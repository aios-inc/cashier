import * as recurly from 'recurly';
import { SubscriptionProration } from '../../types/subscription.types';
import { RECURLY_NO_PRORATION } from '../../constants/cashier.constants';
import { toRecurlyPlanReference } from './recurly-plan-reference';

export const toRecurlySubscriptionChange = ({
  price,
  quantity,
  proration,
}: {
  price?: string;
  quantity?: number;
  proration?: SubscriptionProration;
}): recurly.SubscriptionChangeCreate => ({
  timeframe: 'now',
  ...(price ? toRecurlyPlanReference(price) : {}),
  ...(quantity !== undefined ? { quantity } : {}),
  ...(proration === 'none' ? { prorationSettings: RECURLY_NO_PRORATION } : {}),
});
