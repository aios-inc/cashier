import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import { SubscriptionCharge } from '../../../types/subscription.types';
import { toMinorUnits } from '../../../utils/money.utils';
import { mapCustomFields } from './recurly-custom-fields.mapper';

export const mapRecurlySubscriptionCharge = (
  lineItem: recurly.LineItem,
): SubscriptionCharge => {
  const currency = (lineItem.currency ?? '').toUpperCase();

  return {
    id: lineItem.id ?? '',
    customerId: lineItem.account?.id ?? null,
    subscriptionId: lineItem.subscriptionId ?? null,
    description: lineItem.description ?? null,
    unitAmount: toMinorUnits(lineItem.unitAmount ?? 0, currency),
    quantity: lineItem.quantity ?? 1,
    amount: toMinorUnits(lineItem.subtotal ?? 0, currency),
    currency,
    metadata: mapCustomFields(lineItem.customFields),
    createdAt: lineItem.createdAt ?? new Date(0),
    provider: CashierProvider.Recurly,
  };
};
