import { StripeAccountResource } from '../../src/drivers/stripe/resources/stripe-account.resource';
import { AuthenticationError } from '../../src/errors/authentication.error';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
} from '../fixtures/stripe-client.mock';
import Stripe from 'stripe';

describe('StripeAccountResource', () => {
  let client: StripeClientMock;
  let account: StripeAccountResource;

  beforeEach(() => {
    client = createStripeClientMock();
    account = new StripeAccountResource(asStripeClient(client));
  });

  describe('get', () => {
    it('should retrieve the account and map its statement descriptor', async () => {
      client.accounts.retrieve.mockResolvedValue({
        id: 'acct_123',
        business_profile: { name: 'Acme Health' },
        settings: {
          dashboard: { display_name: 'Acme' },
          payments: { statement_descriptor: 'ACME HEALTH' },
          card_payments: { statement_descriptor_prefix: 'ACME' },
        },
      });

      const result = await account.get();

      expect(client.accounts.retrieve).toHaveBeenCalledWith();
      expect(result).toEqual({
        id: 'acct_123',
        name: 'Acme Health',
        statementDescriptor: 'ACME HEALTH',
        statementDescriptorPrefix: 'ACME',
        provider: CashierProvider.Stripe,
      });
    });

    it('should fall back to the dashboard display name', async () => {
      client.accounts.retrieve.mockResolvedValue({
        id: 'acct_123',
        business_profile: { name: null },
        settings: { dashboard: { display_name: 'Acme' } },
      });

      const result = await account.get();

      expect(result.name).toBe('Acme');
    });

    it('should map missing settings to nulls', async () => {
      client.accounts.retrieve.mockResolvedValue({ id: 'acct_123' });

      const result = await account.get();

      expect(result).toEqual({
        id: 'acct_123',
        name: null,
        statementDescriptor: null,
        statementDescriptorPrefix: null,
        provider: CashierProvider.Stripe,
      });
    });

    it('should map an authentication error', async () => {
      client.accounts.retrieve.mockRejectedValue(
        new Stripe.errors.StripeAuthenticationError({
          type: 'invalid_request_error',
          message: 'Invalid API Key provided',
          statusCode: 401,
        } as Stripe.StripeRawError),
      );

      await expect(account.get()).rejects.toBeInstanceOf(AuthenticationError);
    });
  });
});
