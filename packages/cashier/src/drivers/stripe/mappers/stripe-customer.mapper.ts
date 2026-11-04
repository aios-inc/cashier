import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  BalanceTransaction,
  Customer,
  CustomerBalance,
} from '../../../types/customer.types';
import { getExpandableId } from './stripe-mapper.utils';

export const mapStripeCustomer = (customer: Stripe.Customer): Customer => ({
  id: customer.id,
  code: null,
  email: customer.email,
  name: customer.name ?? null,
  metadata: customer.metadata,
  createdAt: new Date(customer.created * 1000),
  provider: CashierProvider.Stripe,
});

export const toStripeCustomerName = (
  firstName: string | undefined,
  lastName: string | undefined,
): string | undefined =>
  [firstName, lastName].filter(Boolean).join(' ') || undefined;

export const mapStripeCustomerBalances = (
  customer: Stripe.Customer,
): CustomerBalance[] =>
  customer.currency
    ? [{ currency: customer.currency.toUpperCase(), amount: customer.balance }]
    : [];

export const mapStripeBalanceTransaction = (
  transaction: Stripe.CustomerBalanceTransaction,
): BalanceTransaction => ({
  id: transaction.id,
  customerId: getExpandableId(transaction.customer),
  amount: transaction.amount,
  currency: transaction.currency.toUpperCase(),
  description: transaction.description,
  createdAt: new Date(transaction.created * 1000),
  provider: CashierProvider.Stripe,
});
