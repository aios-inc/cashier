import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  BalanceTransaction,
  Customer,
  CustomerBalance,
} from '../../../types/customer.types';
import { toMinorUnits } from '../../../utils/money.utils';
import { mapCustomFields } from './recurly-subscription.mapper';

export const mapRecurlyAccount = (account: recurly.Account): Customer => ({
  id: account.id ?? '',
  code: account.code ?? null,
  email: account.email ?? null,
  name: [account.firstName, account.lastName].filter(Boolean).join(' ') || null,
  metadata: mapCustomFields(account.customFields),
  createdAt: account.createdAt ?? new Date(0),
  provider: CashierProvider.Recurly,
});

export const mapRecurlyAccountBalances = (
  balance: recurly.AccountBalance,
  pendingLineItems: recurly.LineItem[],
): CustomerBalance[] => {
  const balances = new Map<string, number>();
  const add = (currency: string | null | undefined, amount: number) => {
    const code = (currency ?? '').toUpperCase();

    balances.set(code, (balances.get(code) ?? 0) + toMinorUnits(amount, code));
  };

  for (const amount of balance.balances ?? []) {
    add(amount.currency, -(amount.availableCreditAmount ?? 0));
  }

  for (const lineItem of pendingLineItems) {
    add(lineItem.currency, lineItem.amount ?? 0);
  }

  return [...balances].map(([currency, amount]) => ({ currency, amount }));
};

export const mapRecurlyBalanceTransaction = (
  lineItem: recurly.LineItem,
): BalanceTransaction => {
  const currency = (lineItem.currency ?? '').toUpperCase();

  return {
    id: lineItem.id ?? '',
    customerId: lineItem.account?.id ?? null,
    amount: toMinorUnits(lineItem.amount ?? 0, currency),
    currency,
    description: lineItem.description ?? null,
    endingBalance: null,
    createdAt: lineItem.createdAt ?? new Date(0),
    provider: CashierProvider.Recurly,
  };
};
