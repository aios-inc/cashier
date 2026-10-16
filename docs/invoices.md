# Invoices

`driver.invoices` creates, reads, pays and voids invoices.

- [`invoices.get(invoiceId, params?)`](#invoicesgetinvoiceid-params)
- [`invoices.list(params)`](#invoiceslistparams)
- [`invoices.cursorPaginate(params)`](#invoicescursorpaginateparams)
- [Loading relations with `with`](#loading-relations-with-with)
- [`invoices.create(params)`](#invoicescreateparams)
- [`invoices.pay(invoiceId, params?)`](#invoicespayinvoiceid-params)
- [`invoices.void(invoiceId)`](#invoicesvoidinvoiceid)
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

Returns a customer's invoices.

```ts
const invoices = await driver.invoices.list({
  customer: 'cus_123',
  status: 'paid',
});
```

| Parameter  | Type                | Description                                                               |
| ---------- | ------------------- | ------------------------------------------------------------------------- |
| `customer` | `string`            | Required. The customer id.                                                |
| `status`   | `'paid'`            | Only return paid invoices.                                                |
| `limit`    | `number`            | Maximum number of invoices. Defaults to `100`.                            |
| `with`     | `InvoiceRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with). |

| Provider | Behavior                                                                            |
| -------- | ----------------------------------------------------------------------------------- |
| Stripe   | Returns one page of up to `limit` invoices. The maximum is 100.                     |
| Recurly  | Reads pages of the account's invoices until `limit` is reached. The maximum is 200. |

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

| Parameter  | Type                | Description                                                                         |
| ---------- | ------------------- | ----------------------------------------------------------------------------------- |
| `customer` | `string`            | Required. The customer id.                                                          |
| `status`   | `'paid'`            | Only return paid invoices.                                                          |
| `perPage`  | `number`            | Number of invoices per page. Defaults to `100`.                                     |
| `cursor`   | `string \| null`    | The `nextCursor` of the previous page. Leave it out, or pass `null`, for the first. |
| `with`     | `InvoiceRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with).           |

It returns a `CursorPaginator<Invoice>`. See [Pagination and limits](drivers.md#pagination-and-limits).

| Provider | Behavior                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Lists the customer's invoices after the cursor, which is the id of the last invoice. The maximum `perPage` is 100. |
| Recurly  | Lists the account's invoices with Recurly's own cursor. The maximum `perPage` is 200.                              |

## Loading relations with `with`

`get`, `list` and `cursorPaginate` take `with`, like [payments](payments.md#loading-relations-with-with). The relations each provider supports are typed in `CashierInvoiceRelations`.

| Relation  | Adds             | Stripe           | Recurly       |
| --------- | ---------------- | ---------------- | ------------- |
| `refunds` | `amountRefunded` | Expands `charge` | No extra cost |

`amountRefunded` is in minor units: the charge's `amount_refunded` on Stripe, and `paid` minus `refundableAmount` on Recurly charge invoices (`0` on other invoices).

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

## The `Invoice` object

| Field              | Type              | Description                                                         |
| ------------------ | ----------------- | ------------------------------------------------------------------- |
| `id`               | `string`          | The provider's id.                                                  |
| `number`           | `string \| null`  | The invoice number.                                                 |
| `customerId`       | `string \| null`  | The customer or account id.                                         |
| `subscriptionIds`  | `string[]`        | Subscriptions billed on this invoice.                               |
| `billingReason`    | `string \| null`  | Stripe `billing_reason` or Recurly `origin`, for example `renewal`. |
| `status`           | `InvoiceStatus`   | See below.                                                          |
| `currency`         | `string`          | Uppercase ISO 4217 code.                                            |
| `subtotal`         | `number`          | In minor units.                                                     |
| `tax`              | `number`          | In minor units. `0` when there is no tax.                           |
| `total`            | `number`          | In minor units.                                                     |
| `attemptCount`     | `number`          | How many times payment was attempted.                               |
| `hostedInvoiceUrl` | `string \| null`  | The provider's hosted invoice page, when it has one.                |
| `createdAt`        | `Date`            | When the invoice was created.                                       |
| `dueDate`          | `Date \| null`    | When the invoice is due.                                            |
| `paidAt`           | `Date \| null`    | When the invoice was paid.                                          |
| `provider`         | `CashierProvider` | The provider it came from.                                          |

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
