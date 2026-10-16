# Errors

Every method rejects with a subclass of `CashierError`. Raw Stripe or Recurly errors are never thrown directly. The original error is kept in `cause`.

## Error classes

| Error                       | `code`                  | When                                                                                                                    |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NotFoundError`             | `not_found`             | The customer, invoice, payment, product, price or subscription does not exist, or the Stripe customer was deleted.      |
| `AuthenticationError`       | `authentication`        | The API key is missing or invalid.                                                                                      |
| `AuthorizationError`        | `authorization`         | The API key is valid but not allowed to perform the request.                                                            |
| `ValidationError`           | `validation`            | The request has invalid or missing parameters, from the provider or from Cashier's own checks.                          |
| `PaymentFailedError`        | `payment_failed`        | A charge was declined or payment is required. `declineCode` holds the provider's decline code when there is one.        |
| `PaymentMethodError`        | `payment_method`        | The card or payment method is invalid, for example an expired card, a wrong CVC or an invalid token.                    |
| `SubscriptionError`         | `subscription`          | The subscription cannot be changed in its current state.                                                                |
| `RateLimitError`            | `rate_limit`            | The provider is rate limiting requests.                                                                                 |
| `ConflictError`             | `conflict`              | The request conflicts with another one, for example an idempotency key reuse, a lock timeout or a simultaneous request. |
| `UnsupportedOperationError` | `unsupported_operation` | The provider does not support the operation, for example prices on Recurly.                                             |
| `ProviderError`             | `provider`              | Anything else, such as provider server errors and network failures.                                                     |

## Properties

| Property         | Type                           | Description                                                                   |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `name`           | `string`                       | The class name, for example `NotFoundError`.                                  |
| `message`        | `string`                       | The provider's message, or Cashier's own message.                             |
| `code`           | `CashierErrorCode`             | One of the codes in the table above.                                          |
| `provider`       | `CashierProvider \| undefined` | The provider that failed.                                                     |
| `providerStatus` | `number \| undefined`          | The HTTP status from the provider.                                            |
| `providerCode`   | `string \| undefined`          | The provider's error code, such as `resource_missing`.                        |
| `cause`          | `unknown`                      | The original error from the provider client.                                  |
| `declineCode`    | `string \| undefined`          | Only on `PaymentFailedError`. The decline code, such as `insufficient_funds`. |

## Handling errors

Match on the class, or on `code` when you prefer a `switch`:

```ts
import {
  CashierError,
  NotFoundError,
  PaymentFailedError,
} from '@aios-medical/cashier';

try {
  await driver.invoices.pay('in_123');
} catch (error) {
  if (error instanceof PaymentFailedError) {
    return { paid: false, reason: error.declineCode };
  }

  if (error instanceof NotFoundError) {
    return null;
  }

  if (error instanceof CashierError && error.code === 'rate_limit') {
    await retryLater();
  }

  throw error;
}
```

## How provider errors are mapped

| Cashier error               | Stripe                                                                                  | Recurly                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `NotFoundError`             | `resource_missing`, HTTP 404                                                            | `not_found`, HTTP 404                                                                           |
| `AuthenticationError`       | Authentication error, HTTP 401                                                          | `unauthorized`, `invalid_api_key`                                                               |
| `AuthorizationError`        | Permission error, HTTP 403                                                              | `forbidden`, `invalid_permissions`                                                              |
| `ValidationError`           | Invalid request error, HTTP 400 and 422                                                 | `bad_request`, `validation` and other HTTP 422 errors                                           |
| `PaymentFailedError`        | Card errors not listed below, HTTP 402                                                  | Declined transactions, `payment_required`                                                       |
| `PaymentMethodError`        | `expired_card`, `incorrect_cvc`, `incorrect_number`, `invalid_number` and similar codes | `invalid_token`, and transactions with `expired_card`, `invalid_card_number` and similar codes  |
| `SubscriptionError`         |                                                                                         | `immutable_subscription`                                                                        |
| `RateLimitError`            | Rate limit error, HTTP 429                                                              | `rate_limited`, HTTP 429                                                                        |
| `ConflictError`             | Idempotency error, `lock_timeout`, HTTP 409                                             | `simultaneous_request`, `precondition_failed`, HTTP 409 and 412                                 |
| `UnsupportedOperationError` |                                                                                         | `missing_feature`, every Recurly `prices` method, and `paymentMethodTypes` on `invoices.create` |
| `ProviderError`             | API and connection errors, anything else                                                | Server and network errors, anything else                                                        |

## HTTP responses

`toHttpError(error)` turns a Cashier error into an HTTP status and a JSON body you can send to your API clients. The [NestJS exception filter](nestjs.md#turn-cashier-errors-into-http-responses) and the [Express error handler](express.md#error-responses) use it, so every framework answers the same way.

```ts
import { CashierError, toHttpError } from '@aios-medical/cashier';

if (error instanceof CashierError) {
  const { status, body } = toHttpError(error);

  return reply.status(status).send(body);
}
```

| Error                       | Status | Body `message`                        |
| --------------------------- | ------ | ------------------------------------- |
| `NotFoundError`             | 404    | The error message                     |
| `ValidationError`           | 422    | The error message                     |
| `PaymentFailedError`        | 402    | The error message, plus `declineCode` |
| `PaymentMethodError`        | 402    | The error message                     |
| `SubscriptionError`         | 409    | The error message                     |
| `ConflictError`             | 409    | The error message                     |
| `RateLimitError`            | 429    | The error message                     |
| `UnsupportedOperationError` | 501    | The error message                     |
| `AuthenticationError`       | 500    | `The billing provider request failed` |
| `AuthorizationError`        | 500    | `The billing provider request failed` |
| `ProviderError`             | 502    | `The billing provider request failed` |

The body is `{ code, message }`, with `declineCode` added for declined payments when the provider sends one.

`AuthenticationError` and `AuthorizationError` mean your own API key is wrong or lacks permissions. That is a server problem, not the caller's, so they answer 500. For these and for `ProviderError`, the provider's message is replaced with a generic one, so details about your keys or the provider never reach your API clients. Log `error.message` and `error.cause` on your side.

`getHttpStatus(error)` returns only the status.
