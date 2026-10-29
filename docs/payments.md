# Payments

`driver.payments` charges a customer's saved payment method, lists their payments, the charges made against their payment method whether they succeeded or not, and refunds them.

- [`payments.list(params)`](#paymentslistparams)
- [`payments.cursorPaginate(params)`](#paymentscursorpaginateparams)
- [`payments.create(params)`](#paymentscreateparams)
- [`payments.refund(paymentId, params?)`](#paymentsrefundpaymentid-params)
- [Loading relations with `with`](#loading-relations-with-with)
- [The `Payment` object](#the-payment-object)

## `payments.list(params)`

Returns a customer's payments, newest first.

```ts
const payments = await driver.payments.list({ customer: 'cus_123' });
```

| Parameter  | Type                | Description                                                               |
| ---------- | ------------------- | ------------------------------------------------------------------------- |
| `customer` | `string`            | Required. The customer id.                                                |
| `limit`    | `number`            | Maximum number of payments. Defaults to `100`.                            |
| `with`     | `PaymentRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with). |

| Provider | Behavior                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Lists the customer's PaymentIntents, the same payments the Dashboard shows. Returns one page of up to `limit` payments. The maximum is 100.                                    |
| Recurly  | Lists the account's payment transactions (`purchase` and `capture`), so refunds and card verifications are left out. Reads pages until `limit` is reached. The maximum is 200. |

## `payments.cursorPaginate(params)`

Returns one page of a customer's payments, newest first, with a cursor for the next page.

```ts
const payments = await driver.payments.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
});

const nextPayments = await driver.payments.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
  cursor: payments.nextCursor,
});
```

| Parameter  | Type                | Description                                                                         |
| ---------- | ------------------- | ----------------------------------------------------------------------------------- |
| `customer` | `string`            | Required. The customer id.                                                          |
| `perPage`  | `number`            | Number of payments per page. Defaults to `100`.                                     |
| `cursor`   | `string \| null`    | The `nextCursor` of the previous page. Leave it out, or pass `null`, for the first. |
| `with`     | `PaymentRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with).           |

It returns a `CursorPaginator<Payment>`. See [Pagination and limits](drivers.md#pagination-and-limits).

| Provider | Behavior                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Lists the customer's PaymentIntents after the cursor, which is the id of the last payment. The maximum `perPage` is 100. |
| Recurly  | Lists the account's payment transactions with Recurly's own cursor. The maximum `perPage` is 200.                        |

## `payments.create(params)`

Charges a customer's saved payment method right away, off-session, and returns the payment.

```ts
const payment = await driver.payments.create({
  customer: 'cus_123',
  currency: 'EUR',
  amount: 12900,
  paymentMethod: 'pm_123',
  description: 'Consultation',
  metadata: { order: 'order-42' },
  idempotencyKey: 'order-42',
});
```

| Parameter        | Type                     | Description                                                                 |
| ---------------- | ------------------------ | --------------------------------------------------------------------------- |
| `customer`       | `string`                 | Required. The customer id.                                                  |
| `currency`       | `string`                 | Required. ISO 4217 code, for example `EUR`. Cashier never picks a currency. |
| `amount`         | `number`                 | Required. A positive integer in minor units.                                |
| `paymentMethod`  | `string`                 | Required. Stripe payment method id or Recurly billing info id.              |
| `description`    | `string`                 | What the payment is for.                                                    |
| `metadata`       | `Record<string, string>` | Extra key and value pairs.                                                  |
| `idempotencyKey` | `string`                 | Makes a retry with the same key safe.                                       |

Invalid parameters reject with `ValidationError` before any request. The returned `id` is the one `payments.refund` takes and `payments.list` returns.

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Creates and confirms an off-session PaymentIntent limited to the `card` and `link` payment method types, so redirect-based methods and the methods configured in the Dashboard do not apply. The `id` is the PaymentIntent id. When the bank asks for 3D Secure and Stripe leaves the PaymentIntent in `requires_action`, the payment comes back with status `incomplete` instead of rejecting. `idempotencyKey` is sent unchanged. |
| Recurly  | Looks up the account, then makes one purchase with the `automatic` collection method and one line item for `amount`, charged to `paymentMethod`. `metadata` is saved as custom fields on the line item. The `id` is the purchase transaction id. `idempotencyKey` is sent as the `Idempotency-Key` header.                                                                                                                          |

A declined payment rejects with `PaymentFailedError` or `PaymentMethodError` on both providers. See [Errors](errors.md). On Stripe, a card that needs authentication off-session usually declines with `authentication_required`, which is a `PaymentFailedError`.

## `payments.refund(paymentId, params?)`

Refunds a payment, in full or in part, and returns the refund.

```ts
import { RefundReason } from '@aios-inc/cashier';

const refund = await driver.payments.refund('pi_123');

const partialRefund = await driver.payments.refund('pi_123', {
  amount: 5000,
  reason: RefundReason.RequestedByCustomer,
  metadata: { customer: 'customer-42' },
});
```

`paymentId` is the `id` of a [`Payment`](#the-payment-object).

| Parameter  | Type                     | Description                                                                                |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `amount`   | `number`                 | The amount to refund, in minor units. Leave it out to refund all that is still refundable. |
| `reason`   | `RefundReason`           | Why the payment is refunded. See [Refund reasons](#refund-reasons).                        |
| `metadata` | `Record<string, string>` | Stored on the refund where the provider supports it.                                       |

Pass the same parameters on every provider. A provider that cannot store `reason` or `metadata` ignores them, so the refund itself never depends on them.

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Creates a refund for the PaymentIntent, with `reason` mapped to Stripe's reason and `metadata` stored on the refund.                                                                                                                                                                                                                                                                                                                                                            |
| Recurly  | Recurly refunds invoices, not transactions. Cashier loads the transaction, then refunds its invoice by amount, with the amount converted to major units. Without `amount`, it refunds the invoice's refundable amount, which is more than the payment when the invoice was also paid by other transactions. A payment without an invoice rejects with `ValidationError`. Recurly has nowhere to store a reason or metadata on a refund, so `reason` and `metadata` are ignored. |

A payment that does not exist rejects with `NotFoundError`. A payment that is already fully refunded, or an `amount` larger than what is left to refund, rejects with `ValidationError`. See [Errors](errors.md).

To refund several payments, call `refund` once for each.

### Refund reasons

`RefundReason` is an enum, so the same value works on every provider:

| `RefundReason`                     | Stripe                  | Recurly |
| ---------------------------------- | ----------------------- | ------- |
| `RefundReason.Duplicate`           | `duplicate`             | Ignored |
| `RefundReason.Fraudulent`          | `fraudulent`            | Ignored |
| `RefundReason.RequestedByCustomer` | `requested_by_customer` | Ignored |

On Stripe, `RefundReason.Fraudulent` also adds the card and email to your Stripe block lists. Put any other details, such as a note in your own words, in `metadata`.

### The `Refund` object

| Field       | Type                   | Description                                                                                                                                                             |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`               | Stripe's refund id, or the id of Recurly's `refund` transaction.                                                                                                        |
| `paymentId` | `string`               | The id of the refunded payment.                                                                                                                                         |
| `status`    | `RefundStatus`         | See below.                                                                                                                                                              |
| `amount`    | `number`               | The amount refunded, in minor units.                                                                                                                                    |
| `currency`  | `string`               | Uppercase ISO 4217 code.                                                                                                                                                |
| `reason`    | `RefundReason \| null` | Stripe's reason as a `RefundReason`. `null` when there is none or Stripe's reason has no `RefundReason`, such as `expired_uncaptured_charge`. Always `null` on Recurly. |
| `createdAt` | `Date`                 | When the refund was created.                                                                                                                                            |
| `provider`  | `CashierProvider`      | The provider it came from.                                                                                                                                              |

On Recurly, the refund is read from the credit invoice that `refundInvoice` returns: its `refund` transaction for this payment, or its first `refund` transaction. When Recurly issued the whole refund as account credit, there is no refund transaction, so `id` is the credit invoice's id and `status` is `unknown`.

### Refund status

| `status`    | Stripe                       | Recurly                              |
| ----------- | ---------------------------- | ------------------------------------ |
| `succeeded` | `succeeded`                  | `success`                            |
| `pending`   | `pending`, `requires_action` | `pending`, `processing`, `scheduled` |
| `failed`    | `failed`                     | `declined`, `error`                  |
| `canceled`  | `canceled`                   | `void`                               |
| `unknown`   | Any other status             | Any other status                     |

## Loading relations with `with`

A payment has only its own fields by default. Pass `with` to load related data, as with Eloquent's `with`. Each relation adds one field, and costs only what it needs:

```ts
const payments = await cashier
  .use(CashierProvider.Stripe)
  .payments.cursorPaginate({
    customer: 'cus_123',
    perPage: 25,
    with: ['refunds', 'dispute', 'subscription'],
  });

payments.data[0].amountRefunded;
payments.data[0].dispute;
```

| Relation       | Adds             | Stripe                          | Recurly                                                                                 |
| -------------- | ---------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `refunds`      | `amountRefunded` | Expands `latest_charge`         | One more request for the account's refunds, only when a payment on the page is refunded |
| `dispute`      | `dispute`        | Expands `latest_charge.dispute` | Not available                                                                           |
| `receipt`      | `receiptUrl`     | Expands `latest_charge`         | Not available                                                                           |
| `reversal`     | `reversed`       | Expands `latest_charge.refunds` | Not available                                                                           |
| `subscription` | `subscription`   | Expands `invoice.subscription`  | No extra cost                                                                           |

Stripe expansions are part of the same request, so they make the response bigger but add no requests. On Recurly, the refunds request lists the account's `refund` transactions created since the oldest refunded payment on the page.

The relations each provider supports are typed in `CashierPaymentRelations`, so the compiler only accepts what the driver can load:

| Driver                                              | Accepted relations                                               |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `cashier.use(CashierProvider.Stripe)`               | `refunds`, `dispute`, `receipt`, `reversal`, `subscription`      |
| `cashier.use(CashierProvider.Recurly)`              | `refunds`, `subscription`                                        |
| `cashier.use()`, or `use(provider)` with a variable | The relations every provider supports: `refunds`, `subscription` |

The result type only has the fields you loaded, so reading `receiptUrl` without `with: ['receipt']` does not compile. When a relation reaches a driver that cannot load it, for example from plain JavaScript, the call rejects with `UnsupportedOperationError` before any request is made.

## The `Payment` object

| Field         | Type              | Description                                 |
| ------------- | ----------------- | ------------------------------------------- |
| `id`          | `string`          | The provider's id.                          |
| `customerId`  | `string \| null`  | The customer or account id.                 |
| `invoiceId`   | `string \| null`  | The invoice it paid, when there is one.     |
| `status`      | `PaymentStatus`   | See below.                                  |
| `amount`      | `number`          | In minor units.                             |
| `currency`    | `string`          | Uppercase ISO 4217 code.                    |
| `description` | `string \| null`  | The payment's description, when it has one. |
| `createdAt`   | `Date`            | When the payment was created.               |
| `provider`    | `CashierProvider` | The provider it came from.                  |

These fields are added by `with`:

| Field            | Type                          | Relation       | Stripe                                                                                  | Recurly                                                                                                          |
| ---------------- | ----------------------------- | -------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `amountRefunded` | `number`                      | `refunds`      | The latest charge's `amount_refunded`                                                   | The sum of the account's successful and pending `refund` transactions whose original transaction is this payment |
| `dispute`        | `PaymentDispute \| null`      | `dispute`      | The latest charge's dispute                                                             |                                                                                                                  |
| `receiptUrl`     | `string \| null`              | `receipt`      | The latest charge's `receipt_url`                                                       |                                                                                                                  |
| `reversed`       | `boolean`                     | `reversal`     | `true` when one of the latest charge's refunds has the card destination type `reversal` |                                                                                                                  |
| `subscription`   | `PaymentSubscription \| null` | `subscription` | The invoice's subscription, with its `status` and `cancelAt`                            | The transaction's first subscription id, with `status` and `cancelAt` set to `null`                              |

Amounts are in minor units. `amountRefunded` is `0` when nothing was refunded.

### Payment status

| `status`     | Stripe                                                                                                                | Recurly                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `succeeded`  | `succeeded`                                                                                                           | `success`                              |
| `pending`    | `processing`, `requires_capture`                                                                                      | `pending`, `processing`, `scheduled`   |
| `incomplete` | `requires_payment_method`, `requires_confirmation`, `requires_action`                                                 |                                        |
| `failed`     | `requires_payment_method` after a declined attempt (`last_payment_error` is set), which the Dashboard shows as Failed | `declined`, `error`                    |
| `canceled`   | `canceled`                                                                                                            | `void`                                 |
| `unknown`    | Any other status                                                                                                      | Any other status, such as `chargeback` |

### The `PaymentDispute` object

| Field           | Type                   | Description                                                                                                                                                            |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`               | The provider's id.                                                                                                                                                     |
| `status`        | `PaymentDisputeStatus` | Stripe's status: `warning_needs_response`, `warning_under_review`, `warning_closed`, `needs_response`, `under_review`, `won` or `lost`. Any other status is `unknown`. |
| `reason`        | `string`               | The provider's reason, for example `fraudulent`.                                                                                                                       |
| `createdAt`     | `Date`                 | When the dispute was opened.                                                                                                                                           |
| `evidenceDueBy` | `Date \| null`         | When evidence is due.                                                                                                                                                  |

### The `PaymentSubscription` object

| Field      | Type                         | Description                                                                                                          |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`       | `string`                     | The subscription id.                                                                                                 |
| `status`   | `SubscriptionStatus \| null` | The subscription's status. See [Subscriptions](subscriptions.md). `null` when the provider does not return it.       |
| `cancelAt` | `Date \| null`               | When the subscription is scheduled to cancel: Stripe's `cancel_at`, or the period end when it cancels at period end. |
