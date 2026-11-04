import * as recurly from 'recurly';
import { mapRecurlyError } from '../../src/drivers/recurly/recurly-error.mapper';
import { AuthenticationError } from '../../src/errors/authentication.error';
import { AuthorizationError } from '../../src/errors/authorization.error';
import { ConflictError } from '../../src/errors/conflict.error';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { ProviderError } from '../../src/errors/provider.error';
import { RateLimitError } from '../../src/errors/rate-limit.error';
import { SubscriptionError } from '../../src/errors/subscription.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { withRecurlyStatus } from '../fixtures/recurly.fixtures';
import { CashierProvider } from '../../src/types/cashier.types';

const transactionError = (code: string, declineCode?: string) =>
  withRecurlyStatus(
    new recurly.errors.TransactionError('Transaction declined', 'transaction', {
      transactionError: { code, declineCode },
    }),
    422,
  );

describe('mapRecurlyError', () => {
  it.each([
    [
      'a declined transaction',
      transactionError('declined', 'do_not_honor'),
      PaymentFailedError,
    ],
    [
      'an expired card transaction',
      transactionError('expired_card'),
      PaymentMethodError,
    ],
    [
      'an invalid token',
      new recurly.errors.InvalidTokenError('Bad token', 'invalid_token', {}),
      PaymentMethodError,
    ],
    [
      'an immutable subscription',
      new recurly.errors.ImmutableSubscriptionError(
        'Immutable',
        'immutable_subscription',
        {},
      ),
      SubscriptionError,
    ],
    [
      'a simultaneous request',
      new recurly.errors.SimultaneousRequestError(
        'Busy',
        'simultaneous_request',
        {},
      ),
      ConflictError,
    ],
    [
      'a failed precondition',
      new recurly.errors.PreconditionFailedError(
        'Stale',
        'precondition_failed',
        {},
      ),
      ConflictError,
    ],
    [
      'a missing site feature',
      new recurly.errors.MissingFeatureError(
        'No feature',
        'missing_feature',
        {},
      ),
      UnsupportedOperationError,
    ],
    [
      'a validation failure',
      new recurly.errors.ValidationError('Invalid', 'validation', {}),
      ValidationError,
    ],
    [
      'a validation failure on billing_info_id',
      new recurly.errors.ValidationError('Invalid', 'validation', {
        params: [{ param: 'billing_info_id', message: 'is invalid' }],
      }),
      PaymentMethodError,
    ],
    [
      'a bad request',
      new recurly.errors.BadRequestError('Bad', 'bad_request', {}),
      ValidationError,
    ],
    [
      'an unauthorized request',
      new recurly.errors.UnauthorizedError('No auth', 'unauthorized', {}),
      AuthenticationError,
    ],
    [
      'an invalid api key',
      new recurly.errors.InvalidApiKeyError('Bad key', 'invalid_api_key', {}),
      AuthenticationError,
    ],
    [
      'a forbidden request',
      new recurly.errors.InvalidPermissionsError(
        'Forbidden',
        'invalid_permissions',
        {},
      ),
      AuthorizationError,
    ],
    [
      'a missing resource',
      new recurly.errors.NotFoundError('Missing', 'not_found', {}),
      NotFoundError,
    ],
    [
      'a rate limit',
      new recurly.errors.RateLimitedError('Slow down', 'rate_limited', {}),
      RateLimitError,
    ],
    [
      'a payment required response',
      new recurly.errors.PaymentRequiredError('Pay', 'payment_required', {}),
      PaymentFailedError,
    ],
    [
      'a Recurly server error',
      new recurly.errors.InternalServerError(
        'Down',
        'internal_server_error',
        {},
      ),
      ProviderError,
    ],
    [
      'an unclassified api error with a conflict status',
      withRecurlyStatus(new recurly.ApiError('Conflict', 'unknown', {}), 409),
      ConflictError,
    ],
    ['a non-Recurly error', new Error('socket hang up'), ProviderError],
  ])('should map %s', (_scenario, error, ExpectedError) => {
    const mapped = mapRecurlyError(error);

    expect(mapped).toBeInstanceOf(ExpectedError);
    expect(mapped.provider).toBe(CashierProvider.Recurly);
    expect(mapped.cause).toBe(error);
  });

  it('should keep the status, transaction code and decline code of a declined transaction', () => {
    expect(
      mapRecurlyError(transactionError('declined', 'do_not_honor')),
    ).toMatchObject({
      code: 'payment_failed',
      providerStatus: 422,
      providerCode: 'declined',
      declineCode: 'do_not_honor',
    });
  });
});
