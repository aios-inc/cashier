# Invoices

`driver.invoices` creates, reads, pays and voids invoices.

- [`invoices.get(invoiceId, params?)`](#invoicesgetinvoiceid-params)
- [`invoices.list(params)`](#invoiceslistparams)
- [`invoices.cursorPaginate(params)`](#invoicescursorpaginateparams)
- [Loading relations with `with`](#loading-relations-with-with)
- [`invoices.create(params)`](#invoicescreateparams)
- [`invoices.pay(invoiceId, params?)`](#invoicespayinvoiceid-params)
- [`invoices.void(invoiceId)`](#invoicesvoidinvoiceid)
- [`invoices.preview(params)`](#invoicespreviewparams)
- [`invoices.sendReceipt(invoiceId, params?)`](#invoicessendreceiptinvoiceid-params)
- [The `Invoice` object](#the-invoice-object)

## `invoices.get(invoiceId, params?)`

Returns one invoice.

```ts
const invoice = await driver.invoices.get('in_123');

const refunded = await driver.invoices.get('in_123', { with: ['refunds'] });
```

| Parameter | Type                | Description                                                               |
| --------- | ------------------- | ------------------------------------------------------------------------- |
| `with`    | `InvoiceRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with). |

| Provider | Behavior                                                                |
| -------- | ----------------------------------------------------------------------- |
| Stripe   | Retrieves the invoice.                                                  |
| Recurly  | Retrieves the invoice. Amounts are converted from major to minor units. |

## `invoices.list(params)`

Returns a customer's or a subscription's invoices.

```ts
const invoices = await driver.invoices.list({
  customer: 'cus_123',
  status: 'paid',
});

const subscriptionInvoices = await driver.invoices.list({
  subscription: 'sub_123',
});
```

| Parameter      | Type                | Description                                                               |
| -------------- | ------------------- | ------------------------------------------------------------------------- |
| `customer`     | `string`            | The customer id. Required without `subscription`.                         |
| `subscription` | `string`            | Only return this subscription's invoices. Required without `customer`.    |
| `status`       | `'paid'`            | Only return paid invoices.                                                |
| `limit`        | `number`            | Maximum number of invoices. Defaults to `100`.                            |
| `with`         | `InvoiceRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with). |

Passing neither `customer` nor `subscription` does not compile, and rejects with `ValidationError` from plain JavaScript.

| Provider | Behavior                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Returns one page of up to `limit` invoices, filtered by `customer`, `subscription` or both. The maximum is 100.                                      |
| Recurly  | Reads pages of the account's invoices, or of the subscription's invoices when `subscription` is given, until `limit` is reached. The maximum is 200. |

## `invoices.cursorPaginate(params)`

Returns one page of a customer's invoices, newest first, with a cursor for the next page.

```ts
const invoices = await driver.invoices.cursorPaginate({
  customer: 'cus_123',
  status: 'paid',
  perPage: 25,
});

const nextInvoices = await driver.invoices.cursorPaginate({
  customer: 'cus_123',
  status: 'paid',
  perPage: 25,
  cursor: invoices.nextCursor,
});
```

| Parameter      | Type                | Description                                                                         |
| -------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `customer`     | `string`            | The customer id. Required without `subscription`.                                   |
| `subscription` | `string`            | Only return this subscription's invoices. Required without `customer`.              |
| `status`       | `'paid'`            | Only return paid invoices.                                                          |
| `perPage`      | `number`            | Number of invoices per page. Defaults to `100`.                                     |
| `cursor`       | `string \| null`    | The `nextCursor` of the previous page. Leave it out, or pass `null`, for the first. |
| `with`         | `InvoiceRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with).           |

It returns a `CursorPaginator<Invoice>`. See [Pagination and limits](drivers.md#pagination-and-limits).

| Provider | Behavior                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Stripe   | Lists the invoices after the cursor, which is the id of the last invoice. The maximum `perPage` is 100.     |
| Recurly  | Lists the account's or the subscription's invoices with Recurly's own cursor. The maximum `perPage` is 200. |

## Loading relations with `with`

`get`, `list` and `cursorPaginate` take `with`, like [payments](payments.md#loading-relations-with-with). The relations each provider supports are typed in `CashierInvoiceRelations`.

| Relation          | Adds              | Stripe                                                                      | Recurly                                                                |
| ----------------- | ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `refunds`         | `amountRefunded`  | Expands `charge`                                                            | No extra cost                                                          |
| `lineItems`       | `lineItems`       | No extra cost for up to 10 lines. One more request per 100 lines after that | No extra cost, unless Recurly reports more line items than it returned |
| `payments`        | `payments`        | Expands `payment_intent`                                                    | No extra cost                                                          |
| `startingBalance` | `startingBalance` | No extra cost                                                               | Not available                                                          |
| `timeline`        | `timeline`        | No extra cost                                                               | No extra cost                                                          |

| Driver                                              | Accepted relations                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `cashier.use(CashierProvider.Stripe)`               | `refunds`, `lineItems`, `payments`, `startingBalance`, `timeline`                     |
| `cashier.use(CashierProvider.Recurly)`              | `refunds`, `lineItems`, `payments`, `timeline`                                        |
| `cashier.use()`, or `use(provider)` with a variable | The relations every provider supports: `refunds`, `lineItems`, `payments`, `timeline` |

| Field             | Type                | Stripe                                                                                                     | Recurly                                                                          |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `amountRefunded`  | `number`            | The charge's `amount_refunded`                                                                             | `paid` minus `refundableAmount` on charge invoices, `0` on other invoices        |
| `lineItems`       | `InvoiceLineItem[]` | The invoice's `lines`                                                                                      | The invoice's line items                                                         |
| `payments`        | `Payment[]`         | The invoice's PaymentIntent, or an empty array. With API version `2023-08-16`, an invoice has at most one. | The invoice's `purchase` and `capture` transactions                              |
| `startingBalance` | `number`            | `starting_balance`: the customer balance applied to the invoice. Negative is credit.                       |                                                                                  |
| `timeline`        | `InvoiceEvent[]`    | `created`, then `finalized`, `paid`, `voided` and `uncollectible` from `status_transitions`                | `created`, then `paid`, `failed` or `voided` at `closed_at` for a closed invoice |

Amounts are in minor units. `timeline` is oldest first. Each `InvoiceEvent` has a `type` and the date it happened `at`.

### The `InvoiceLineItem` object

| Field            | Type             | Description                                                                   |
| ---------------- | ---------------- | ----------------------------------------------------------------------------- |
| `id`             | `string`         | The provider's line item id.                                                  |
| `description`    | `string \| null` | What the line is for.                                                         |
| `amount`         | `number`         | In minor units. Negative for credits, such as the unused time of a proration. |
| `quantity`       | `number \| null` | The quantity.                                                                 |
| `unitAmount`     | `number \| null` | The price per unit, in minor units.                                           |
| `priceId`        | `string \| null` | The Stripe price id or the Recurly plan id.                                   |
| `subscriptionId` | `string \| null` | The subscription the line bills.                                              |
| `periodStart`    | `Date \| null`   | Start of the period the line covers.                                          |
| `periodEnd`      | `Date \| null`   | End of the period the line covers.                                            |
| `proration`      | `boolean`        | `true` for a proration. On Recurly, a line whose `proration_rate` is not 1.   |

## `invoices.create(params)`

Creates a one-off invoice with one or more line items, issues it and returns it. It either charges the customer's saved payment method or sends the customer an invoice to pay.

```ts
const invoice = await driver.invoices.create({
  customer: 'cus_123',
  currency: 'EUR',
  lineItems: [
    { description: 'Consultation', amount: 4500 },
    { description: 'Blood test', amount: 1999 },
  ],
  collection: 'charge_automatically',
  chargeNow: true,
  paymentMethod: 'pm_123',
  metadata: { order: 'order-42' },
  idempotencyKey: 'order-42',
});

const sentInvoice = await driver.invoices.create({
  customer: 'cus_123',
  currency: 'GBP',
  lineItems: [{ description: 'Consultation', amount: 4500 }],
  collection: 'send_invoice',
  daysUntilDue: 14,
});
```

| Parameter                 | Type                                       | Description                                                                                                                               |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `customer`                | `string`                                   | Required. The customer id.                                                                                                                |
| `currency`                | `string`                                   | Required. ISO 4217 code, for example `EUR`. Cashier never picks a currency.                                                               |
| `lineItems`               | `CreateInvoiceLineItem[]`                  | Required. At least one item.                                                                                                              |
| `lineItems[].description` | `string`                                   | The line item's description. When empty, the invoice `description` is used.                                                               |
| `lineItems[].amount`      | `number`                                   | A positive integer in minor units.                                                                                                        |
| `collection`              | `'charge_automatically' \| 'send_invoice'` | Required. Charge the saved payment method, or send the invoice for the customer to pay.                                                   |
| `chargeNow`               | `boolean`                                  | Charge right away and return the paid invoice. Only with `charge_automatically`. Defaults to `false`.                                     |
| `description`             | `string`                                   | Shown to the customer on the invoice.                                                                                                     |
| `dueDate`                 | `Date`                                     | When the invoice is due. Only with `send_invoice`, must be in the future, and cannot be combined with `daysUntilDue`.                     |
| `daysUntilDue`            | `number`                                   | Days until the invoice is due. Only with `send_invoice`. Defaults to `30` when neither `dueDate` nor `daysUntilDue` is given.             |
| `paymentMethod`           | `string`                                   | Stripe payment method id or Recurly billing info id to charge. Used with `charge_automatically` only. Defaults to the customer's default. |
| `paymentMethodTypes`      | `string[]`                                 | Stripe payment method types the hosted invoice accepts, for example `['card']`. Stripe only.                                              |
| `metadata`                | `Record<string, string>`                   | Extra key and value pairs.                                                                                                                |
| `idempotencyKey`          | `string`                                   | Makes a retry with the same key safe. See the table below.                                                                                |

Invalid parameters reject with `ValidationError` before any request.

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Creates a draft invoice in `currency` that leaves out the customer's other pending invoice items, adds one invoice item per line item, then finalizes it. With `chargeNow` it pays the invoice and returns the paid invoice. Without it, `auto_advance` is on, so Stripe charges automatic invoices itself about an hour later and emails `send_invoice` invoices. `metadata` is set on the invoice and every item. `hostedInvoiceUrl` is always set. |
| Recurly  | Looks up the account, then makes one purchase with exactly these line items, so other pending charges on the account are not billed. `charge_automatically` becomes the `automatic` collection method and `send_invoice` becomes `manual`. `description` becomes the customer notes and `metadata` is saved as custom fields on every line item. Returns the purchase's charge invoice. `hostedInvoiceUrl` is always `null`.                          |

| Option               | Stripe                                                                                                  | Recurly                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chargeNow`          | Pays the invoice right after finalizing it.                                                             | Needs no extra call: Recurly collects an automatic invoice when it is created, with or without `chargeNow`.                                                                                                               |
| `dueDate`            | Sent as `due_date`.                                                                                     | Sent as `net` net terms: the whole days from now to `dueDate`, rounded up. The invoice is due that many days after it is created, at the time it was created, so it can fall up to one day after `dueDate`, never before. |
| `daysUntilDue`       | Sent as `days_until_due`.                                                                               | Sent as `net` net terms.                                                                                                                                                                                                  |
| `paymentMethodTypes` | Sent as `payment_settings.payment_method_types`.                                                        | Recurly has no equivalent, so it rejects with `UnsupportedOperationError` before any request.                                                                                                                             |
| `idempotencyKey`     | Each request gets its own key: `<key>-invoice`, `<key>-item-<index>`, `<key>-finalize` and `<key>-pay`. | Sent unchanged as the `Idempotency-Key` header of the purchase.                                                                                                                                                           |

A declined payment rejects with `PaymentFailedError` or `PaymentMethodError`. See [Errors](errors.md). On Stripe the invoice is already finalized when `chargeNow` fails, so it stays open.

## `invoices.pay(invoiceId, params?)`

Pays an open invoice and returns it.

```ts
const invoice = await driver.invoices.pay('in_123', {
  paymentMethod: 'pm_123',
});
```

| Parameter       | Type     | Description                                                                              |
| --------------- | -------- | ---------------------------------------------------------------------------------------- |
| `paymentMethod` | `string` | Stripe payment method id or Recurly billing info id. Defaults to the customer's default. |

| Provider | Behavior              |
| -------- | --------------------- |
| Stripe   | Pays the invoice.     |
| Recurly  | Collects the invoice. |

A declined payment rejects with `PaymentFailedError` or `PaymentMethodError`. See [Errors](errors.md).

## `invoices.void(invoiceId)`

Voids an invoice and returns it.

```ts
const invoice = await driver.invoices.void('in_123');
```

## `invoices.preview(params)`

Returns the next invoice of a subscription without creating it: what the customer will be charged next, or what a change of price or quantity would cost. This is Laravel Cashier's `upcomingInvoice` and `previewInvoice`.

```ts
const next = await driver.invoices.preview({ subscription: 'sub_123' });

next.total;
next.nextPaymentAt;

const change = await driver.invoices.preview({
  subscription: 'sub_123',
  price: 'price_premium',
  proration: 'prorate',
});
```

| Parameter      | Type                    | Description                                                                                                                  |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `subscription` | `string`                | Required. The subscription id.                                                                                               |
| `price`        | `string`                | Preview a change to this price. A Recurly plan id, or plan code with the `code-` prefix.                                     |
| `quantity`     | `number`                | Preview a change to this quantity.                                                                                           |
| `proration`    | `SubscriptionProration` | How the change would be prorated, as in [`subscriptions.update`](subscriptions.md#subscriptionsupdatesubscriptionid-params). |

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Retrieves the upcoming invoice of the subscription, with the change applied to its only item and `subscription_proration_behavior` set from `proration`. Changing the price or quantity of a subscription with several items rejects with `ValidationError`. Reads every line, 100 at a time after the first 10.                                                                                                                                                   |
| Recurly  | Recurly has no upcoming invoice. Without a change, the preview is estimated from the subscription: its `subtotal`, `tax` and `total`, one line for the plan and one for each add-on, charged at the end of the current period. With a change, Cashier previews the subscription change: when Recurly would invoice right away, the preview is that invoice. Otherwise it is estimated from the change, with `tax` set to `0` because Recurly does not estimate it. |

### The `InvoicePreview` object

| Field            | Type                | Description                                                                                                                                     |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `customerId`     | `string \| null`    | The customer or account id.                                                                                                                     |
| `subscriptionId` | `string`            | The subscription id.                                                                                                                            |
| `currency`       | `string`            | Uppercase ISO 4217 code.                                                                                                                        |
| `subtotal`       | `number`            | In minor units.                                                                                                                                 |
| `tax`            | `number`            | In minor units.                                                                                                                                 |
| `total`          | `number`            | In minor units.                                                                                                                                 |
| `amountDue`      | `number`            | What will be charged, in minor units, after any customer balance or credit.                                                                     |
| `lineItems`      | `InvoiceLineItem[]` | See [The `InvoiceLineItem` object](#the-invoicelineitem-object).                                                                                |
| `nextPaymentAt`  | `Date \| null`      | When it will be charged: Stripe's `next_payment_attempt`, or on Recurly the end of the current period, or the due date of an immediate invoice. |
| `provider`       | `CashierProvider`   | The provider it came from.                                                                                                                      |

## `invoices.sendReceipt(invoiceId, params?)`

Emails the customer the receipt of a paid invoice. Only the Stripe driver has it.

```ts
await cashier.use(CashierProvider.Stripe).invoices.sendReceipt('in_123');
```

| Parameter | Type     | Description                                                   |
| --------- | -------- | ------------------------------------------------------------- |
| `email`   | `string` | Where to send it. Defaults to the invoice's `customer_email`. |

| Provider | Behavior                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Sets `receipt_email` on the invoice's charge, which makes Stripe send the receipt. Stripe does not send receipts in test mode.                                                 |
| Recurly  | Not available. Recurly's API cannot send a receipt, so `sendReceipt` does not compile on the Recurly driver. See [Provider-only methods](typescript.md#provider-only-methods). |

An invoice that is not paid, or that has no email to send to, rejects with `ValidationError`.

## The `Invoice` object

| Field              | Type              | Description                                                                          |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------ |
| `id`               | `string`          | The provider's id.                                                                   |
| `number`           | `string \| null`  | The invoice number.                                                                  |
| `customerId`       | `string \| null`  | The customer or account id.                                                          |
| `subscriptionIds`  | `string[]`        | Subscriptions billed on this invoice.                                                |
| `billingReason`    | `string \| null`  | Stripe `billing_reason` or Recurly `origin`, for example `renewal`.                  |
| `status`           | `InvoiceStatus`   | See below.                                                                           |
| `currency`         | `string`          | Uppercase ISO 4217 code.                                                             |
| `subtotal`         | `number`          | In minor units.                                                                      |
| `tax`              | `number`          | In minor units. `0` when there is no tax.                                            |
| `total`            | `number`          | In minor units.                                                                      |
| `amountPaid`       | `number`          | In minor units. Stripe's `amount_paid`, Recurly's `paid`.                            |
| `amountRemaining`  | `number`          | What is still due, in minor units. Stripe's `amount_remaining`, Recurly's `balance`. |
| `attemptCount`     | `number`          | How many times payment was attempted.                                                |
| `hostedInvoiceUrl` | `string \| null`  | The provider's hosted invoice page, when it has one.                                 |
| `createdAt`        | `Date`            | When the invoice was created.                                                        |
| `dueDate`          | `Date \| null`    | When the invoice is due.                                                             |
| `paidAt`           | `Date \| null`    | When the invoice was paid.                                                           |
| `provider`         | `CashierProvider` | The provider it came from.                                                           |

| Field              | Stripe               | Recurly       |
| ------------------ | -------------------- | ------------- |
| `attemptCount`     | `attempt_count`      | Always `0`    |
| `hostedInvoiceUrl` | `hosted_invoice_url` | Always `null` |
| `dueDate`          | `due_date`           | `dueAt`       |

### Invoice status

| `status`        | Stripe                | Recurly                         |
| --------------- | --------------------- | ------------------------------- |
| `draft`         | `draft`, or no status |                                 |
| `open`          | `open`                | `pending`, `processing`, `open` |
| `paid`          | `paid`                | `paid`                          |
| `past_due`      |                       | `past_due`                      |
| `failed`        |                       | `failed`                        |
| `void`          | `void`                | `voided`                        |
| `uncollectible` | `uncollectible`       |                                 |
| `closed`        |                       | `closed`                        |
| `unknown`       |                       | Any other state                 |
