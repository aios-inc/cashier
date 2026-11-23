# Subscriptions

`driver.subscriptions` lists, creates, changes and cancels subscriptions, and adds one-off charges to their next renewal.

- [`subscriptions.list(params)`](#subscriptionslistparams)
- [`subscriptions.cursorPaginate(params)`](#subscriptionscursorpaginateparams)
- [Filtering by price](#filtering-by-price)
- [Filtering by status](#filtering-by-status)
- [Loading relations with `with`](#loading-relations-with-with)
- [`subscriptions.create(params)`](#subscriptionscreateparams)
- [`subscriptions.get(subscriptionId, params?)`](#subscriptionsgetsubscriptionid-params)
- [`subscriptions.update(subscriptionId, params)`](#subscriptionsupdatesubscriptionid-params)
- [`subscriptions.changeBillingDate(subscriptionId, date)`](#subscriptionschangebillingdatesubscriptionid-date)
- [`subscriptions.cancel(subscriptionId, params?)`](#subscriptionscancelsubscriptionid-params)
- [`subscriptions.resume(subscriptionId)`](#subscriptionsresumesubscriptionid)
- [`subscriptions.addCharge(subscriptionId, params)`](#subscriptionsaddchargesubscriptionid-params)
- [`subscriptions.listCharges(subscriptionId)`](#subscriptionslistchargessubscriptionid)
- [`subscriptions.removeCharge(subscriptionId, chargeId)`](#subscriptionsremovechargesubscriptionid-chargeid)
- [The `Subscription` object](#the-subscription-object)

## `subscriptions.list(params)`

Returns a customer's subscriptions of every status, newest first.

```ts
const subscriptions = await driver.subscriptions.list({ customer: 'cus_123' });
```

| Parameter  | Type                          | Description                                                                                                       |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `customer` | `string`                      | Required. The customer id.                                                                                        |
| `status`   | `SubscriptionStatus \| 'all'` | Only return subscriptions with this status. Defaults to `'all'`. See [Filtering by status](#filtering-by-status). |
| `limit`    | `number`                      | Maximum number of subscriptions. Defaults to `100`.                                                               |
| `with`     | `SubscriptionRelation[]`      | Relations to load. See [Loading relations](#loading-relations-with-with).                                         |

| Provider | Behavior                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Lists the customer's subscriptions with `status: 'all'`, so canceled ones are included. Returns one page of up to `limit` subscriptions. The maximum is 100. |
| Recurly  | Lists the account's subscriptions. Reads pages until `limit` subscriptions with the requested status are found. The maximum is 200.                          |

## `subscriptions.cursorPaginate(params)`

Returns one page of a customer's subscriptions, or of every subscription on a price, newest first, with a cursor for the next page.

```ts
const subscriptions = await driver.subscriptions.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
});

const nextSubscriptions = await driver.subscriptions.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
  cursor: subscriptions.nextCursor,
});
```

| Parameter  | Type                          | Description                                                                         |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `customer` | `string`                      | The customer id. Required unless `price` is given.                                  |
| `price`    | `string`                      | Only return subscriptions on this price. Required unless `customer` is given.       |
| `status`   | `SubscriptionStatus \| 'all'` | Only return subscriptions with this status. Defaults to `'all'`.                    |
| `perPage`  | `number`                      | Number of subscriptions per page. Defaults to `100`.                                |
| `cursor`   | `string \| null`              | The `nextCursor` of the previous page. Leave it out, or pass `null`, for the first. |
| `with`     | `SubscriptionRelation[]`      | Relations to load. See [Loading relations](#loading-relations-with-with).           |

It returns a `CursorPaginator<Subscription>`. See [Pagination and limits](drivers.md#pagination-and-limits).

| Provider | Behavior                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Lists the customer's subscriptions after the cursor, which is the id of the last subscription. The maximum `perPage` is 100. |
| Recurly  | Lists the account's subscriptions with Recurly's own cursor. The maximum `perPage` is 200.                                   |

## Filtering by price

Pass `price` to `cursorPaginate` to list the subscriptions on a price. Without `customer`, it lists them across every customer. With both, only that customer's. Leaving out both rejects with `ValidationError` before any request is made.

```ts
const subscriptions = await driver.subscriptions.cursorPaginate({
  price: 'price_123',
  status: 'active',
  perPage: 25,
});
```

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Passes `price` to `subscriptions.list`, which filters on Stripe's side.                                                                                                                                                                                                                                                                          |
| Recurly  | Recurly cannot filter subscriptions by plan, so Cashier reads the site's subscriptions, or the account's, and keeps those on the plan. `price` is a plan id, or `code-` followed by a plan code. A page can hold fewer than `perPage` subscriptions, or none, while `hasMorePages` is still `true`. Keep paging until `hasMorePages` is `false`. |

## Filtering by status

`status` takes a Cashier [subscription status](#subscription-status), or `'all'`, which is the default. Every subscription returned has that status.

| `status`            | Stripe                   | Recurly                                                                |
| ------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `all`               | `status: 'all'`          | No filter                                                              |
| `active`            | `status: 'active'`       | `state: 'live'`, keeping the subscriptions Cashier reports as `active` |
| `canceled`          | `status: 'canceled'`     | `state: 'expired'`                                                     |
| `future`            | Returns nothing          | `state: 'future'`                                                      |
| `failed`, `unknown` | Returns nothing          | Read without a filter, keeping the subscriptions with that status      |
| Any other status    | The same Stripe `status` | Read without a filter, keeping the subscriptions with that status      |

Stripe has no `future`, `failed` or `unknown` subscriptions, so Cashier returns an empty result without calling Stripe.

Recurly can only filter by a few states, so Cashier filters the rest after reading each page. With `cursorPaginate`, a page can then hold fewer than `perPage` subscriptions, or none, while `hasMorePages` is still `true`. Keep paging until `hasMorePages` is `false`. Recurly reports a subscription in a trial with the `active` state, so on Recurly it has `status: 'active'` and `status: 'trialing'` finds nothing.

## Loading relations with `with`

A subscription has only its own fields by default. Pass `with` to load related data, like [payments](payments.md#loading-relations-with-with). Each relation adds one field, and costs only what it needs:

```ts
const subscriptions = await driver.subscriptions.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
  with: ['product', 'interval', 'pause', 'discount'],
});

subscriptions.data[0].product?.name;
subscriptions.data[0].interval;
```

| Relation        | Adds            | Stripe                                                                                                                                                     | Recurly                                              |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `product`       | `product`       | One `products.list` request per page for the products of the first items. Stripe cannot expand the product here, because it is more than four levels deep. | No extra cost. The subscription's plan.              |
| `interval`      | `interval`      | No extra cost. The first item's price interval.                                                                                                            | One `getPlan` request per unique plan on the page.   |
| `pause`         | `pause`         | No extra cost. `pause_collection`.                                                                                                                         | No extra cost.                                       |
| `discount`      | `discount`      | No extra cost. The subscription's discount coupon.                                                                                                         | No extra cost. The first active coupon redemption.   |
| `paymentMethod` | `paymentMethod` | Expands `default_payment_method` and `customer.invoice_settings.default_payment_method`.                                                                   | One request per subscription for its billing info.   |
| `latestInvoice` | `latestInvoice` | Expands `latest_invoice`.                                                                                                                                  | One request per subscription for its newest invoice. |

Both providers support every relation, typed in `CashierSubscriptionRelations`. A relation a driver cannot load rejects with `UnsupportedOperationError` before any request is made.

| Field           | Type                                | Stripe                                                                                                                                             | Recurly                                                                                                                                                          |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`       | `SubscriptionProduct \| null`       | `{ id, name }` of the first item's product. `null` when Stripe does not return it.                                                                 | `{ id, name }` of the plan.                                                                                                                                      |
| `interval`      | `BillingInterval \| null`           | The first item's `price.recurring`. `null` for a price that does not recur.                                                                        | The plan's `intervalUnit` and `intervalLength`. `days` is `day` and `months` is `month`. `null` for any other unit.                                              |
| `pause`         | `SubscriptionPause \| null`         | `pause_collection.behavior` and `resumes_at`. `null` when collection is not paused.                                                                | `{ behavior: null, resumesAt: null }` when the state is `paused` or `pausedAt` is set, because Recurly only gives the number of paused cycles. `null` otherwise. |
| `discount`      | `SubscriptionDiscount \| null`      | The coupon's `id`, `name`, `amount_off` and `percent_off`. `null` when there is no discount.                                                       | The coupon's `code`, `name`, `percent`, and the fixed amount in the subscription's currency in minor units. `null` when no coupon redemption is active.          |
| `paymentMethod` | `SubscriptionPaymentMethod \| null` | The subscription's `default_payment_method`, or the customer's default when it has none, which is what Stripe charges. `null` when neither is set. | The subscription's `billing_info_id`, or the account's primary billing info when it has none. `null` when the account has no billing info.                       |
| `latestInvoice` | `Invoice \| null`                   | `latest_invoice`.                                                                                                                                  | The subscription's newest invoice. `null` when there is none.                                                                                                    |

`SubscriptionPaymentMethod` is the payment method's `id` with its `PaymentMethodDetails`: `type`, `brand`, `last4`, `expMonth`, `expYear` and `wallet`. See [Payment methods](payment-methods.md#the-paymentmethod-object). `latestInvoice` is an [`Invoice`](invoices.md#the-invoice-object) without relations.

`SubscriptionDiscount` has `couponId`, `name`, `amountOff` (in minor units) and `percentOff`. Only one of `amountOff` and `percentOff` is set for a fixed or percent coupon.

## `subscriptions.create(params)`

Creates a subscription and returns it.

```ts
const subscription = await driver.subscriptions.create({
  customer: 'cus_123',
  price: 'price_123',
  currency: 'USD',
  quantity: 1,
  couponCode: 'WELCOME',
  trialEnd: new Date('2026-12-01T00:00:00Z'),
  metadata: { source: 'checkout' },
});
```

| Parameter       | Type                     | Description                                                             |
| --------------- | ------------------------ | ----------------------------------------------------------------------- |
| `customer`      | `string`                 | Required. The customer id.                                              |
| `price`         | `string`                 | Required. A Stripe price id, or a Recurly plan id or `code-` plan code. |
| `currency`      | `string`                 | Required. ISO 4217 code, for example `USD`.                             |
| `quantity`      | `number`                 | Defaults to `1`.                                                        |
| `paymentMethod` | `string`                 | Stripe payment method id or Recurly billing info id.                    |
| `couponCode`    | `string`                 | Coupon to apply.                                                        |
| `trialEnd`      | `Date`                   | End of the free trial.                                                  |
| `metadata`      | `Record<string, string>` | Extra key and value pairs.                                              |

| Provider | Behavior                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Creates a subscription with one item for `price` and `quantity`. `paymentMethod` becomes the default payment method and `couponCode` the coupon. |
| Recurly  | Looks up the account, then creates the subscription for its code. `metadata` is saved as custom fields.                                          |

A declined first payment rejects with `PaymentFailedError` or `PaymentMethodError`. See [Errors](errors.md).

## `subscriptions.get(subscriptionId, params?)`

Returns one subscription.

```ts
const subscription = await driver.subscriptions.get('sub_123');

const detail = await driver.subscriptions.get('sub_123', {
  with: ['product', 'paymentMethod', 'latestInvoice'],
});

detail.paymentMethod?.last4;
detail.latestInvoice?.status;
```

| Parameter | Type                     | Description                                                               |
| --------- | ------------------------ | ------------------------------------------------------------------------- |
| `with`    | `SubscriptionRelation[]` | Relations to load. See [Loading relations](#loading-relations-with-with). |

## `subscriptions.update(subscriptionId, params)`

Changes the price, quantity, trial end, payment method or metadata and returns the updated subscription.

```ts
const subscription = await driver.subscriptions.update('sub_123', {
  price: 'price_456',
  quantity: 2,
  proration: 'invoiceNow',
});

await driver.subscriptions.update('sub_123', { paymentMethod: 'pm_456' });

await driver.subscriptions.update('sub_123', {
  trialEnd: new Date('2027-01-15'),
});
```

| Parameter       | Type                     | Description                                                                                                        |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `item`          | `string`                 | The Stripe subscription item to change. Needed for a `price` or `quantity` change when there are several items.    |
| `price`         | `string`                 | New Stripe price id, or Recurly plan id or `code-` code.                                                           |
| `quantity`      | `number`                 | New quantity.                                                                                                      |
| `proration`     | `SubscriptionProration`  | How a `price` or `quantity` change is prorated. See below.                                                         |
| `trialEnd`      | `Date`                   | When the trial ends. Use it to extend or end a trial.                                                              |
| `paymentMethod` | `string`                 | Stripe payment method id or Recurly billing info id to bill for this subscription. It must belong to the customer. |
| `metadata`      | `Record<string, string>` | Metadata to set.                                                                                                   |

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Replaces the price or quantity of `item`, or of the subscription's only item. Without `item`, a `price` or `quantity` change on a subscription with more than one item rejects with `ValidationError`, and so does `item` without a `price` or `quantity`. `trialEnd` sets `trial_end`. `paymentMethod` sets the subscription's `default_payment_method` and works on any subscription, including one with several items.                                                                                              |
| Recurly  | A Recurly subscription has one plan, so `item` rejects with `UnsupportedOperationError`. Checks that the `paymentMethod` billing info belongs to the subscription's account, applies the plan or quantity change right away, then saves `paymentMethod` as `billing_info_id`, `trialEnd` as `next_bill_date` and `metadata` as custom fields, then reads the subscription again. `trialEnd` on a subscription that is not in a trial rejects with `ValidationError`. `paymentMethod` needs the Recurly Wallet feature. |

### Proration

`proration` is Laravel Cashier's `noProrate()` and `swapAndInvoice()`:

| `proration`          | Meaning                                                       | Stripe `proration_behavior` | Recurly                                                                     |
| -------------------- | ------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `prorate`, (default) | Credit the unused time and charge the new price for the rest. | `create_prorations`         | Change `now`, prorated. Recurly invoices the difference right away.         |
| `invoiceNow`         | Prorate, and invoice the difference right away.               | `always_invoice`            | The same as `prorate`.                                                      |
| `none`               | Switch without credit or charge for the current period.       | `none`                      | Change `now` with `proration_settings` `charge` and `credit` set to `none`. |

Leaving `proration` out keeps each provider's default, which is `prorate` on both. To see what a change would cost first, use [`invoices.preview`](invoices.md#invoicespreviewparams).

`paymentMethod` rejects with `PaymentMethodError` when the payment method does not exist or is not attached to the customer. Nothing is changed in that case.

To change the card for every future invoice of the customer, use [`customers.update`](customers.md#customersupdatecustomerid-params) with `defaultPaymentMethod`.

## `subscriptions.changeBillingDate(subscriptionId, date)`

Moves the next billing date, without charging or crediting anything for the extra or missing days, and returns the subscription. Later periods are billed from the new date.

```ts
await driver.subscriptions.changeBillingDate('sub_123', new Date('2027-01-01'));
```

A `date` that is not in the future rejects with `ValidationError` before any request.

| Provider | Behavior                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Stripe can only move a subscription's billing date with a trial, so this sets `trial_end` to `date` with `proration_behavior` `none`, as Stripe recommends. The subscription is `trialing` until `date`. |
| Recurly  | Sets the subscription's `next_bill_date`.                                                                                                                                                                |

## `subscriptions.cancel(subscriptionId, params?)`

Cancels a subscription and returns it.

```ts
await driver.subscriptions.cancel('sub_123');
await driver.subscriptions.cancel('sub_123', { atPeriodEnd: true });
```

Pass `comment` to record why and by whom the subscription was cancelled. Cashier stores it unchanged and does not parse it, so it can hold JSON:

```ts
await driver.subscriptions.cancel('sub_123', {
  comment: JSON.stringify({ cancelledBy: 'customer-42', reason: 'moving' }),
});
```

| Parameter     | Type                 | Description                                                                            |
| ------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `atPeriodEnd` | `boolean`            | Keep the subscription running until the end of the period. Defaults to `false`.        |
| `comment`     | `string`             | Free text stored with the cancellation. An empty string is the same as leaving it out. |
| `refund`      | `SubscriptionRefund` | `full` or `prorated`. Refund the latest invoice when canceling right away.             |

| Provider | Default                                  | `atPeriodEnd: true`                       | `comment`                                                                                                                                                                        |
| -------- | ---------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Cancels right away.                      | Cancels at the end of the current period. | Stored as `cancellation_details.comment`, with either cancel. Stripe accepts at most 5000 characters, so a longer comment rejects with `ValidationError` before any request.     |
| Recurly  | Terminates right away, without a refund. | Cancels at the end of the current term.   | Recurly has no internal note on a cancel or terminate, and `customerNotes` is visible to the customer, so a comment rejects with `UnsupportedOperationError` before any request. |

### Refunding on cancel

```ts
await driver.subscriptions.cancel('sub_123', { refund: 'prorated' });
```

`refund` only works when canceling right away. With `atPeriodEnd: true` it rejects with `ValidationError` before any request.

| `refund`   | Stripe                                                                                                                                | Recurly                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `full`     | Refunds what is left to refund of the latest invoice's charge.                                                                        | Terminates with `refund=full`: the last invoice of the current term.              |
| `prorated` | Refunds the latest invoice's `amount_paid` times the unused part of the current period, at most what is left to refund of its charge. | Terminates with `refund=partial`, prorated by the time left in the billing cycle. |

On Stripe, Cashier reads the subscription with its latest invoice and charge, cancels it, then creates the refund. When the latest invoice has no charge, for example because it was paid with credit, nothing is refunded. If the refund fails, the subscription stays canceled and the call rejects with the refund's error.

## `subscriptions.resume(subscriptionId)`

Undoes a scheduled cancellation, so a subscription that was going to end keeps renewing, and returns it. This is Laravel Cashier's `resume`. A subscription that has already ended cannot be resumed.

```ts
await driver.subscriptions.resume('sub_123');
```

| Provider | Behavior                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Reads the subscription. When it cancels at period end, sets `cancel_at_period_end` to `false`. When it has a `cancel_at` date, clears it. When nothing is scheduled, rejects with `ValidationError`. |
| Recurly  | Reactivates the `canceled` subscription. Recurly rejects a subscription that is not `canceled`.                                                                                                      |

## `subscriptions.addCharge(subscriptionId, params)`

Adds a one-off charge to the subscription's next renewal invoice and returns it. Use it for something the customer buys between renewals that should be billed with the next one.

```ts
const charge = await driver.subscriptions.addCharge('sub_123', {
  description: 'Needles x10',
  unitAmount: 1250,
  quantity: 2,
  metadata: { order: 'order-42' },
  idempotencyKey: 'order-42-needles',
});

charge.amount; // 2500
```

| Parameter        | Type                     | Description                                                                  |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `description`    | `string`                 | Required. Shown on the invoice.                                              |
| `unitAmount`     | `number`                 | Required. A positive integer in minor units, in the subscription's currency. |
| `quantity`       | `number`                 | A positive integer. Defaults to `1`.                                         |
| `metadata`       | `Record<string, string>` | Extra key and value pairs, stored on the charge.                             |
| `idempotencyKey` | `string`                 | Makes a retry with the same key safe.                                        |

Invalid parameters reject with `ValidationError` before any request. The charge is always in the subscription's currency. A subscription that does not renew rejects with `SubscriptionError`, because the charge would never be billed: one whose status is not `active`, `trialing` or `past_due`, or one set to cancel at or before the end of its current period.

| Provider | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe   | Reads the subscription, then creates an invoice item for it with `unit_amount` and `quantity`. Stripe bills it on the subscription's next invoice, which is the renewal unless the subscription is invoiced earlier, for example by [`subscriptions.update`](#subscriptionsupdatesubscriptionid-params) with `proration: 'invoiceNow'`. [`invoices.create`](invoices.md#invoicescreateparams) never picks it up. `idempotencyKey` is sent unchanged.                                                                                                               |
| Recurly  | Reads the subscription, then creates a pending `charge` line item on its account, in major units, with `metadata` as custom fields. Recurly cannot tie a pending charge to one subscription, so it is billed on the account's next invoice, which is this subscription's renewal when the account has only this subscription. [`invoices.create`](invoices.md#invoicescreateparams) and [`payments.create`](payments.md#paymentscreateparams) never pick it up. The returned `subscriptionId` is `null`. `idempotencyKey` is sent as the `Idempotency-Key` header. |

## `subscriptions.listCharges(subscriptionId)`

Returns the charges still waiting for the subscription's next invoice.

```ts
const charges = await driver.subscriptions.listCharges('sub_123');
```

| Provider | Behavior                                                                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Reads every pending invoice item of the subscription's customer and keeps the ones for this subscription.                                                                                                                                                                                                   |
| Recurly  | Reads every pending `charge` line item on the subscription's account in the subscription's currency. Recurly does not tie them to a subscription, so these include the account's other pending charges, such as those from [`customers.debitBalance`](customers.md#customersdebitbalancecustomerid-params). |

## `subscriptions.removeCharge(subscriptionId, chargeId)`

Removes a charge before it is billed. It resolves with nothing.

```ts
await driver.subscriptions.removeCharge('sub_123', 'ii_123');
```

A charge that is not on the subscription, or on its account on Recurly, rejects with `NotFoundError`. A charge that is already on an invoice rejects with `ValidationError`, so refund it with [`invoices.refundLineItems`](invoices.md#invoicesrefundlineitemsinvoiceid-params) instead.

| Provider | Behavior                          |
| -------- | --------------------------------- |
| Stripe   | Deletes the pending invoice item. |
| Recurly  | Removes the pending line item.    |

### The `SubscriptionCharge` object

| Field            | Type                     | Description                                                                       |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `id`             | `string`                 | The Stripe invoice item id, or the Recurly line item id. `removeCharge` takes it. |
| `customerId`     | `string \| null`         | The customer or account id.                                                       |
| `subscriptionId` | `string \| null`         | The subscription it is billed with. Always `null` on Recurly.                     |
| `description`    | `string \| null`         | What the charge is for.                                                           |
| `unitAmount`     | `number`                 | The price per unit, in minor units.                                               |
| `quantity`       | `number`                 | The quantity.                                                                     |
| `amount`         | `number`                 | `unitAmount` times `quantity`, in minor units, before discounts and tax.          |
| `currency`       | `string`                 | Uppercase ISO 4217 code.                                                          |
| `metadata`       | `Record<string, string>` | Stripe: the invoice item's metadata. Recurly: the line item's custom fields.      |
| `createdAt`      | `Date`                   | When it was added.                                                                |
| `provider`       | `CashierProvider`        | The provider it came from.                                                        |

## The `Subscription` object

| Field                | Type                     | Description                                                      |
| -------------------- | ------------------------ | ---------------------------------------------------------------- |
| `id`                 | `string`                 | The provider's id.                                               |
| `customerId`         | `string \| null`         | The customer or account id.                                      |
| `status`             | `SubscriptionStatus`     | See below.                                                       |
| `items`              | `SubscriptionItem[]`     | See below.                                                       |
| `currency`           | `string`                 | Uppercase ISO 4217 code.                                         |
| `currentPeriodStart` | `Date \| null`           | Start of the current billing period.                             |
| `currentPeriodEnd`   | `Date \| null`           | End of the current billing period.                               |
| `cancelAtPeriodEnd`  | `boolean`                | Whether it ends at the end of the current period.                |
| `cancelAt`           | `Date \| null`           | When it is scheduled to end. See below.                          |
| `canceledAt`         | `Date \| null`           | When it was canceled.                                            |
| `trialEnd`           | `Date \| null`           | End of the free trial.                                           |
| `startDate`          | `Date \| null`           | When it started: Stripe's `start_date`, Recurly's `activatedAt`. |
| `createdAt`          | `Date`                   | When it was created.                                             |
| `metadata`           | `Record<string, string>` | Stripe metadata or Recurly custom fields.                        |
| `provider`           | `CashierProvider`        | The provider it came from.                                       |

`cancelAt` is set when the subscription is scheduled to end:

| Provider | `cancelAt`                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| Stripe   | `cancel_at`, or `current_period_end` when `cancel_at_period_end` is `true`. `null` otherwise. |
| Recurly  | `expiresAt` when the state is `canceled`, which runs until then. `null` otherwise.            |

### Subscription items

| Field        | Type             | Description                                                |
| ------------ | ---------------- | ---------------------------------------------------------- |
| `id`         | `string \| null` | The Stripe subscription item id. Always `null` on Recurly. |
| `priceId`    | `string`         | The Stripe price id or the Recurly plan id.                |
| `quantity`   | `number`         | Quantity.                                                  |
| `unitAmount` | `number \| null` | In minor units.                                            |

Recurly subscriptions always have exactly one item.

### Subscription status

| `status`             | Stripe               | Recurly                                      |
| -------------------- | -------------------- | -------------------------------------------- |
| `active`             | `active`             | `active`, `live`, and `canceled` (see below) |
| `trialing`           | `trialing`           | `in_trial`                                   |
| `past_due`           | `past_due`           | `past_due`                                   |
| `unpaid`             | `unpaid`             |                                              |
| `paused`             | `paused`             | `paused`                                     |
| `canceled`           | `canceled`           | `expired`                                    |
| `incomplete`         | `incomplete`         |                                              |
| `incomplete_expired` | `incomplete_expired` |                                              |
| `future`             |                      | `future`                                     |
| `failed`             |                      | `failed`                                     |
| `unknown`            |                      | Any other state                              |

A Recurly subscription in the `canceled` state keeps running until the end of its term, like a Stripe subscription with `cancel_at_period_end`. Cashier returns it with `status: 'active'` and `cancelAtPeriodEnd: true`.
