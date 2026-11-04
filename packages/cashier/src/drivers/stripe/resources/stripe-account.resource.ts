import Stripe from 'stripe';
import { Account, AccountResource } from '../../../types/account.types';
import { mapStripeAccount } from '../mappers/stripe-account.mapper';
import { stripeRequest } from '../stripe-request';

export class StripeAccountResource implements AccountResource {
  constructor(private readonly client: Stripe) {}

  get(): Promise<Account> {
    return stripeRequest(async () =>
      mapStripeAccount(await this.client.accounts.retrieve()),
    );
  }
}
