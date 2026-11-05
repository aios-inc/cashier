import Stripe from 'stripe';
import { CashierProvider } from '../../types/cashier.types';
import { NotFoundError } from '../../errors/not-found.error';

export const retrieveStripeCustomer = async (
  client: Stripe,
  customerId: string,
): Promise<Stripe.Customer> => {
  const customer = await client.customers.retrieve(customerId);

  if (customer.deleted) {
    throw new NotFoundError(`Customer ${customerId} has been deleted`, {
      provider: CashierProvider.Stripe,
    });
  }

  return customer;
};
