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
    charge: string | Stripe.Charge | null | undefined;
    email: string | null | undefined;
  },
): Promise<void> => {
  const chargeId = getExpandableId(charge);

  if (!paid || !chargeId) fail(`${subject} has no successful charge`);
  if (!email) fail(`${subject} has no email to send the receipt to`);

  const current =
    getExpanded(charge) ?? (await client.charges.retrieve(chargeId as string));

  // Stripe only sends a receipt when receipt_email changes, so clear it first
  // when it already holds this address.
  if (
    current.receipt_email?.toLowerCase() === (email as string).toLowerCase()
  ) {
    await client.charges.update(chargeId as string, { receipt_email: '' });
  }

  await client.charges.update(chargeId as string, {
    receipt_email: email as string,
  });
};
