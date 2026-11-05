import Stripe from 'stripe';
import { Account } from '../../../types/account.types';
import { CashierProvider } from '../../../types/cashier.types';

export const mapStripeAccount = (account: Stripe.Account): Account => ({
  id: account.id,
  name:
    account.business_profile?.name ??
    account.settings?.dashboard?.display_name ??
    null,
  statementDescriptor: account.settings?.payments?.statement_descriptor ?? null,
  statementDescriptorPrefix:
    account.settings?.card_payments?.statement_descriptor_prefix ?? null,
  provider: CashierProvider.Stripe,
});
