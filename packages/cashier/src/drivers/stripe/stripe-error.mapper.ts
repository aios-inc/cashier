import Stripe from 'stripe';
import { CashierProvider } from '../../types/cashier.types';
import { CashierError, CashierErrorDetails } from '../../errors/cashier.error';
import { AuthenticationError } from '../../errors/authentication.error';
import { AuthorizationError } from '../../errors/authorization.error';
import { ConflictError } from '../../errors/conflict.error';
import { NotFoundError } from '../../errors/not-found.error';
import { PaymentFailedError } from '../../errors/payment-failed.error';
import { PaymentMethodError } from '../../errors/payment-method.error';
import { ProviderError } from '../../errors/provider.error';
import { RateLimitError } from '../../errors/rate-limit.error';
import { ValidationError } from '../../errors/validation.error';
import {
  STRIPE_PAYMENT_METHOD_ERROR_CODES,
  STRIPE_PAYMENT_METHOD_PARAMS,
} from '../../constants/cashier.constants';
import {
  createErrorFromHttpStatus,
  getErrorMessage,
} from '../../utils/http-status-error.utils';

const mapStripeCardError = (
  error: Stripe.errors.StripeCardError,
  details: CashierErrorDetails,
): CashierError =>
  STRIPE_PAYMENT_METHOD_ERROR_CODES.has(error.code ?? '')
    ? new PaymentMethodError(error.message, details)
    : new PaymentFailedError(error.message, {
        ...details,
        declineCode: error.decline_code,
      });

const mapStripeInvalidRequestError = (
  error: Stripe.errors.StripeInvalidRequestError,
  details: CashierErrorDetails,
): CashierError => {
  if (error.code === 'resource_missing') {
    return STRIPE_PAYMENT_METHOD_PARAMS.has(error.param ?? '')
      ? new PaymentMethodError(error.message, details)
      : new NotFoundError(error.message, details);
  }

  if (error.code === 'lock_timeout') {
    return new ConflictError(error.message, details);
  }

  if (STRIPE_PAYMENT_METHOD_ERROR_CODES.has(error.code ?? '')) {
    return new PaymentMethodError(error.message, details);
  }

  return details.providerStatus && details.providerStatus !== 400
    ? createErrorFromHttpStatus(error.message, details)
    : new ValidationError(error.message, details);
};

export const mapStripeError = (error: unknown): CashierError => {
  if (error instanceof CashierError) return error;

  if (!(error instanceof Stripe.errors.StripeError)) {
    return new ProviderError(getErrorMessage(error), {
      provider: CashierProvider.Stripe,
      cause: error,
    });
  }

  const details: CashierErrorDetails = {
    provider: CashierProvider.Stripe,
    providerStatus: error.statusCode,
    providerCode: error.code,
    cause: error,
  };

  if (error instanceof Stripe.errors.StripeCardError) {
    return mapStripeCardError(error, details);
  }

  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return mapStripeInvalidRequestError(error, details);
  }

  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return new AuthenticationError(error.message, details);
  }

  if (error instanceof Stripe.errors.StripePermissionError) {
    return new AuthorizationError(error.message, details);
  }

  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return new RateLimitError(error.message, details);
  }

  if (error instanceof Stripe.errors.StripeIdempotencyError) {
    return new ConflictError(error.message, details);
  }

  return createErrorFromHttpStatus(error.message, details);
};
