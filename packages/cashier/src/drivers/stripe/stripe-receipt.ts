import Stripe from 'stripe';
import { CashierProvider } from '../../types/cashier.types';
import { ValidationError } from '../../errors/validation.error';
import { getExpandableId, getExpanded } from './mappers/stripe-mapper.utils';

const fail = (message: string): never => {
  throw new ValidationError(message, { provider: CashierProvider.Stripe });
};

export const getStripeCustomerEmail = (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null => {
  const expanded = getExpanded(customer);

  return expanded && !expanded.deleted ? expanded.email : null;
};

export const sendStripeReceipt = async (
  client: Stripe,
  {
    subject,
    paid,
    charge,
    email,
  }: {
    subject: string;
    paid: boolean;
    charge: string | { id: string } | null | undefined;
    email: string | null | undefined;
  },
): Promise<void> => {
  const chargeId = getExpandableId(charge);

  if (!paid || !chargeId) fail(`${subject} has no successful charge`);
  if (!email) fail(`${subject} has no email to send the receipt to`);

  await client.charges.update(chargeId as string, {
    receipt_email: email as string,
  });
};
