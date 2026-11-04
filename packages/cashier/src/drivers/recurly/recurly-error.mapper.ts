import * as recurly from 'recurly';
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
import { SubscriptionError } from '../../errors/subscription.error';
import { UnsupportedOperationError } from '../../errors/unsupported-operation.error';
import { ValidationError } from '../../errors/validation.error';
import {
  RECURLY_PAYMENT_METHOD_ERROR_CODES,
  RECURLY_PAYMENT_METHOD_PARAMS,
} from '../../constants/cashier.constants';
import {
  createErrorFromHttpStatus,
  getErrorMessage,
} from '../../utils/http-status-error.utils';

type RecurlyApiError = recurly.ApiError & {
  type?: string;
  transactionError?: recurly.TransactionError | null;
};

type RecurlyErrorParam = { param?: string };

const getProviderStatus = (error: RecurlyApiError): number | undefined => {
  const response = error.getResponse?.() as { status?: number } | undefined;

  return response?.status;
};

const isPaymentMethodParamError = (error: RecurlyApiError): boolean =>
  ((error.params ?? []) as RecurlyErrorParam[]).some(({ param }) =>
    RECURLY_PAYMENT_METHOD_PARAMS.has(param ?? ''),
  );

const mapRecurlyTransactionError = (
  error: RecurlyApiError,
  message: string,
  details: CashierErrorDetails,
): CashierError => {
  const transactionCode = error.transactionError?.code ?? undefined;

  if (RECURLY_PAYMENT_METHOD_ERROR_CODES.has(transactionCode ?? '')) {
    return new PaymentMethodError(message, {
      ...details,
      providerCode: transactionCode,
    });
  }

  return new PaymentFailedError(message, {
    ...details,
    providerCode: transactionCode ?? details.providerCode,
    declineCode: error.transactionError?.declineCode ?? undefined,
  });
};

export const mapRecurlyError = (error: unknown): CashierError => {
  if (error instanceof CashierError) return error;

  if (!(error instanceof recurly.ApiError)) {
    return new ProviderError(getErrorMessage(error), {
      provider: CashierProvider.Recurly,
      cause: error,
    });
  }

  const apiError = error as RecurlyApiError;
  const message = getErrorMessage(error);
  const details: CashierErrorDetails = {
    provider: CashierProvider.Recurly,
    providerStatus: getProviderStatus(apiError),
    providerCode: apiError.type,
    cause: error,
  };

  if (error instanceof recurly.errors.TransactionError) {
    return mapRecurlyTransactionError(apiError, message, details);
  }

  if (error instanceof recurly.errors.InvalidTokenError) {
    return new PaymentMethodError(message, details);
  }

  if (error instanceof recurly.errors.ImmutableSubscriptionError) {
    return new SubscriptionError(message, details);
  }

  if (
    error instanceof recurly.errors.SimultaneousRequestError ||
    error instanceof recurly.errors.PreconditionFailedError
  ) {
    return new ConflictError(message, details);
  }

  if (error instanceof recurly.errors.MissingFeatureError) {
    return new UnsupportedOperationError(message, details);
  }

  if (
    error instanceof recurly.errors.BadRequestError ||
    error instanceof recurly.errors.UnprocessableEntityError
  ) {
    return isPaymentMethodParamError(apiError)
      ? new PaymentMethodError(message, details)
      : new ValidationError(message, details);
  }

  if (error instanceof recurly.errors.UnauthorizedError) {
    return new AuthenticationError(message, details);
  }

  if (error instanceof recurly.errors.InvalidApiKeyError) {
    return new AuthenticationError(message, details);
  }

  if (error instanceof recurly.errors.ForbiddenError) {
    return new AuthorizationError(message, details);
  }

  if (error instanceof recurly.errors.NotFoundError) {
    return new NotFoundError(message, details);
  }

  if (error instanceof recurly.errors.TooManyRequestsError) {
    return new RateLimitError(message, details);
  }

  if (error instanceof recurly.errors.PaymentRequiredError) {
    return new PaymentFailedError(message, details);
  }

  return createErrorFromHttpStatus(message, details);
};
