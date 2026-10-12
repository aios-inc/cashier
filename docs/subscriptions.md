# Subscriptions

`driver.subscriptions` lists, creates, changes and cancels subscriptions.

- [`subscriptions.list(params)`](#subscriptionslistparams)
- [`subscriptions.cursorPaginate(params)`](#subscriptionscursorpaginateparams)
- [Filtering by status](#filtering-by-status)
- [Loading relations with `with`](#loading-relations-with-with)
- [`subscriptions.create(params)`](#subscriptionscreateparams)
- [`subscriptions.get(subscriptionId)`](#subscriptionsgetsubscriptionid)
- [`subscriptions.update(subscriptionId, params)`](#subscriptionsupdatesubscriptionid-params)
- [`subscriptions.cancel(subscriptionId, params?)`](#subscriptionscancelsubscriptionid-params)
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

Returns one page of a customer's subscriptions, newest first, with a cursor for the next page.

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
| `customer` | `string`                      | Required. The customer id.                                                          |
| `status`   | `SubscriptionStatus \| 'all'` | Only return subscriptions with this status. Defaults to `'all'`.                    |
| `perPage`  | `number`                      | Number of subscriptions per page. Defaults to `100`.                                |
| `cursor`   | `string \| null`              | The `nextCursor` of the previous page. Leave it out, or pass `null`, for the first. |
| `with`     | `SubscriptionRelation[]`      | Relations to load. See [Loading relations](#loading-relations-with-with).           |

It returns a `CursorPaginator<Subscription>`. See [Pagination and limits](drivers.md#pagination-and-limits).

| Provider | Behavior                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Lists the customer's subscriptions after the cursor, which is the id of the last subscription. The maximum `perPage` is 100. |
| Recurly  | Lists the account's subscriptions with Recurly's own cursor. The maximum `perPage` is 200.                                   |

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

| Relation   | Adds       | Stripe                                                                                                                                                     | Recurly                                            |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `product`  | `product`  | One `products.list` request per page for the products of the first items. Stripe cannot expand the product here, because it is more than four levels deep. | No extra cost. The subscription's plan.            |
| `interval` | `interval` | No extra cost. The first item's price interval.                                                                                                            | One `getPlan` request per unique plan on the page. |
| `pause`    | `pause`    | No extra cost. `pause_collection`.                                                                                                                         | No extra cost.                                     |
| `discount` | `discount` | No extra cost. The subscription's discount coupon.                                                                                                         | No extra cost. The first active coupon redemption. |

Both providers support every relation, typed in `CashierSubscriptionRelations`. A relation a driver cannot load rejects with `UnsupportedOperationError` before any request is made.

| Field      | Type                           | Stripe                                                                                       | Recurly                                                                                                                                                          |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`  | `SubscriptionProduct \| null`  | `{ id, name }` of the first item's product. `null` when Stripe does not return it.           | `{ id, name }` of the plan.                                                                                                                                      |
| `interval` | `BillingInterval \| null`      | The first item's `price.recurring`. `null` for a price that does not recur.                  | The plan's `intervalUnit` and `intervalLength`. `days` is `day` and `months` is `month`. `null` for any other unit.                                              |
| `pause`    | `SubscriptionPause \| null`    | `pause_collection.behavior` and `resumes_at`. `null` when collection is not paused.          | `{ behavior: null, resumesAt: null }` when the state is `paused` or `pausedAt` is set, because Recurly only gives the number of paused cycles. `null` otherwise. |
| `discount` | `SubscriptionDiscount \| null` | The coupon's `id`, `name`, `amount_off` and `percent_off`. `null` when there is no discount. | The coupon's `code`, `name`, `percent`, and the fixed amount in the subscription's currency in minor units. `null` when no coupon redemption is active.          |

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

## `subscriptions.get(subscriptionId)`

Returns one subscription.

```ts
const subscription = await driver.subscriptions.get('sub_123');
```

## `subscriptions.update(subscriptionId, params)`

Changes the price, quantity or metadata and returns the updated subscription.

```ts
const subscription = await driver.subscriptions.update('sub_123', {
  price: 'price_456',
  quantity: 2,
});
```

| Parameter  | Type                     | Description                                              |
| ---------- | ------------------------ | -------------------------------------------------------- |
| `price`    | `string`                 | New Stripe price id, or Recurly plan id or `code-` code. |
| `quantity` | `number`                 | New quantity.                                            |
| `metadata` | `Record<string, string>` | Metadata to set.                                         |

| Provider | Behavior                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Replaces the price or quantity of the subscription's only item. A subscription with more than one item rejects with `ValidationError`. |
| Recurly  | Applies the plan or quantity change right away, then saves `metadata` as custom fields, then reads the subscription again.             |

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

| Parameter     | Type      | Description                                                                            |
| ------------- | --------- | -------------------------------------------------------------------------------------- |
| `atPeriodEnd` | `boolean` | Keep the subscription running until the end of the period. Defaults to `false`.        |
| `comment`     | `string`  | Free text stored with the cancellation. An empty string is the same as leaving it out. |

| Provider | Default                                  | `atPeriodEnd: true`                       | `comment`                                                                                                                                                                        |
| -------- | ---------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Cancels right away.                      | Cancels at the end of the current period. | Stored as `cancellation_details.comment`, with either cancel. Stripe accepts at most 5000 characters, so a longer comment rejects with `ValidationError` before any request.     |
| Recurly  | Terminates right away, without a refund. | Cancels at the end of the current term.   | Recurly has no internal note on a cancel or terminate, and `customerNotes` is visible to the customer, so a comment rejects with `UnsupportedOperationError` before any request. |

## The `Subscription` object

| Field                | Type                     | Description                                       |
| -------------------- | ------------------------ | ------------------------------------------------- |
| `id`                 | `string`                 | The provider's id.                                |
| `customerId`         | `string \| null`         | The customer or account id.                       |
| `status`             | `SubscriptionStatus`     | See below.                                        |
| `items`              | `SubscriptionItem[]`     | See below.                                        |
| `currency`           | `string`                 | Uppercase ISO 4217 code.                          |
| `currentPeriodStart` | `Date \| null`           | Start of the current billing period.              |
| `currentPeriodEnd`   | `Date \| null`           | End of the current billing period.                |
| `cancelAtPeriodEnd`  | `boolean`                | Whether it ends at the end of the current period. |
| `cancelAt`           | `Date \| null`           | When it is scheduled to end. See below.           |
| `canceledAt`         | `Date \| null`           | When it was canceled.                             |
| `trialEnd`           | `Date \| null`           | End of the free trial.                            |
| `createdAt`          | `Date`                   | When it was created.                              |
| `metadata`           | `Record<string, string>` | Stripe metadata or Recurly custom fields.         |
| `provider`           | `CashierProvider`        | The provider it came from.                        |

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
