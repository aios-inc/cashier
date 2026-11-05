import Stripe from 'stripe';
import { mapStripeError } from '../../src/drivers/stripe/stripe-error.mapper';
import { AuthenticationError } from '../../src/errors/authentication.error';
import { AuthorizationError } from '../../src/errors/authorization.error';
import { CashierError } from '../../src/errors/cashier.error';
import { ConflictError } from '../../src/errors/conflict.error';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { ProviderError } from '../../src/errors/provider.error';
import { RateLimitError } from '../../src/errors/rate-limit.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';

const raw = (fields: Partial<Stripe.StripeRawError>) =>
  ({ message: 'Stripe failure', ...fields }) as Stripe.StripeRawError;

describe('mapStripeError', () => {
  it.each([
    [
      'a declined card',
      new Stripe.errors.StripeCardError(
        raw({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          statusCode: 402,
        }),
      ),
      PaymentFailedError,
    ],
    [
      'an expired card',
      new Stripe.errors.StripeCardError(
        raw({ type: 'card_error', code: 'expired_card', statusCode: 402 }),
      ),
      PaymentMethodError,
    ],
    [
      'a missing resource',
      new Stripe.errors.StripeInvalidRequestError(
        raw({
          type: 'invalid_request_error',
          code: 'resource_missing',
          statusCode: 404,
        }),
      ),
      NotFoundError,
    ],
    [
      'a customer default payment method that is missing or detached',
      new Stripe.errors.StripeInvalidRequestError(
        raw({
          type: 'invalid_request_error',
          code: 'resource_missing',
          param: 'invoice_settings[default_payment_method]',
          statusCode: 400,
        }),
      ),
      PaymentMethodError,
    ],
    [
      'a subscription default payment method that is missing or detached',
      new Stripe.errors.StripeInvalidRequestError(
        raw({
          type: 'invalid_request_error',
          code: 'resource_missing',
          param: 'default_payment_method',
          statusCode: 400,
        }),
      ),
      PaymentMethodError,
    ],
    [
      'a lock timeout',
      new Stripe.errors.StripeInvalidRequestError(
        raw({
          type: 'invalid_request_error',
          code: 'lock_timeout',
          statusCode: 429,
        }),
      ),
      ConflictError,
    ],
    [
      'an invalid parameter',
      new Stripe.errors.StripeInvalidRequestError(
        raw({
          type: 'invalid_request_error',
          code: 'parameter_invalid_integer',
          statusCode: 400,
        }),
      ),
      ValidationError,
    ],
    [
      'an invalid api key',
      new Stripe.errors.StripeAuthenticationError(
        raw({ type: 'invalid_request_error', statusCode: 401 }),
      ),
      AuthenticationError,
    ],
    [
      'a restricted key without permission',
      new Stripe.errors.StripePermissionError(
        raw({ type: 'invalid_request_error', statusCode: 403 }),
      ),
      AuthorizationError,
    ],
    [
      'a rate limit',
      new Stripe.errors.StripeRateLimitError(
        raw({ type: 'invalid_request_error', statusCode: 429 }),
      ),
      RateLimitError,
    ],
    [
      'an idempotency key reuse',
      new Stripe.errors.StripeIdempotencyError(
        raw({ type: 'idempotency_error', statusCode: 400 }),
      ),
      ConflictError,
    ],
    [
      'a Stripe server error',
      new Stripe.errors.StripeAPIError(
        raw({ type: 'api_error', statusCode: 500 }),
      ),
      ProviderError,
    ],
    [
      'a connection failure',
      new Stripe.errors.StripeConnectionError(raw({ type: 'api_error' })),
      ProviderError,
    ],
    ['a non-Stripe error', new Error('socket hang up'), ProviderError],
  ])('should map %s', (_scenario, error, ExpectedError) => {
    const mapped = mapStripeError(error);

    expect(mapped).toBeInstanceOf(ExpectedError);
    expect(mapped.provider).toBe(CashierProvider.Stripe);
    expect(mapped.cause).toBe(error);
  });

  it('should keep the provider status, provider code and decline code', () => {
    const error = new Stripe.errors.StripeCardError(
      raw({
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        statusCode: 402,
      }),
    );

    expect(mapStripeError(error)).toMatchObject({
      code: 'payment_failed',
      providerStatus: 402,
      providerCode: 'card_declined',
      declineCode: 'insufficient_funds',
    });
  });

  it('should return a cashier error unchanged', () => {
    const error = new ValidationError('Already mapped');

    expect(mapStripeError(error)).toBe(error);
    expect(error).toBeInstanceOf(CashierError);
  });
});
