# Customers

`driver.customers` manages Stripe customers and Recurly accounts.

- [`customers.get(customerId, params?)`](#customersgetcustomerid-params)
- [`customers.list(params?)`](#customerslistparams)
- [`customers.create(params)`](#customerscreateparams)
- [`customers.update(customerId, params)`](#customersupdatecustomerid-params)
- [`customers.creditBalance(customerId, params)`](#customerscreditbalancecustomerid-params)
- [`customers.debitBalance(customerId, params)`](#customersdebitbalancecustomerid-params)
- [The `Customer` object](#the-customer-object)

## `customers.get(customerId, params?)`

Returns one customer.

```ts
const customer = await driver.customers.get('cus_123');

const withBalance = await driver.customers.get('cus_123', {
  with: ['balances'],
});

withBalance.balances; // [{ currency: 'USD', amount: -2500 }]
```

| Parameter | Type                 | Description                                                     |
| --------- | -------------------- | --------------------------------------------------------------- |
| `with`    | `CustomerRelation[]` | Relations to load. `balances` is the only one, on both drivers. |

| Provider | Behavior                                                                 |
| -------- | ------------------------------------------------------------------------ |
| Stripe   | Retrieves the customer. A deleted customer rejects with `NotFoundError`. |
| Recurly  | Retrieves the account by id, or by code with the `code-` prefix.         |

### The customer balance

`with: ['balances']` adds `balances`, one `CustomerBalance` per currency. As in Stripe and Laravel Cashier, a negative `amount` is credit the customer has, which the next invoices use up. A positive `amount` is owed by the customer and added to the next invoice. Unpaid invoices are not part of the balance.

| Field      | Type     | Description                                          |
| ---------- | -------- | ---------------------------------------------------- |
| `currency` | `string` | Uppercase ISO 4217 code.                             |
| `amount`   | `number` | In minor units. Negative is credit, positive is due. |

| Provider | Behavior                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | The customer's `balance` in its `currency`. No extra request. A customer without a currency has no balance, so `balances` is empty.                                                                                                                                        |
| Recurly  | Two more requests: the account balance and the account's pending line items. For each currency, the open credit on credit invoices (`available_credit_amount`) counts as credit, and pending charges and credits, which Recurly adds to the next invoice, are added to it. |

## `customers.creditBalance(customerId, params)`

Gives the customer credit that the next invoices use up, and returns the balance transaction. This is Laravel Cashier's `creditBalance`.

```ts
const transaction = await driver.customers.creditBalance('cus_123', {
  amount: 2500,
  currency: 'USD',
  description: 'Goodwill credit',
});

transaction.amount; // -2500
```

| Parameter     | Type     | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `amount`      | `number` | Required. A positive integer in minor units.                   |
| `currency`    | `string` | Required. ISO 4217 code. Stripe needs the customer's currency. |
| `description` | `string` | Why the balance changed.                                       |

An `amount` that is not a positive integer, or a missing `currency`, rejects with `ValidationError` before any request.

| Provider | Behavior                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Creates a customer balance transaction with a negative `amount`.                                                                       |
| Recurly  | Creates a pending `credit` line item on the account, with the amount in major units. Recurly applies it to the account's next invoice. |

## `customers.debitBalance(customerId, params)`

Adds an amount the customer owes to their next invoice, and returns the balance transaction. It takes the same parameters as [`creditBalance`](#customerscreditbalancecustomerid-params).

```ts
await driver.customers.debitBalance('cus_123', {
  amount: 1000,
  currency: 'USD',
  description: 'Late fee',
});
```

| Provider | Behavior                                                         |
| -------- | ---------------------------------------------------------------- |
| Stripe   | Creates a customer balance transaction with a positive `amount`. |
| Recurly  | Creates a pending `charge` line item on the account.             |

### The `BalanceTransaction` object

| Field         | Type              | Description                                                                |
| ------------- | ----------------- | -------------------------------------------------------------------------- |
| `id`          | `string`          | The Stripe balance transaction id, or the Recurly line item id.            |
| `customerId`  | `string \| null`  | The customer or account id.                                                |
| `amount`      | `number`          | In minor units. Negative for `creditBalance`, positive for `debitBalance`. |
| `currency`    | `string`          | Uppercase ISO 4217 code.                                                   |
| `description` | `string \| null`  | The description, when one was given.                                       |
| `createdAt`   | `Date`            | When it was created.                                                       |
| `provider`    | `CashierProvider` | The provider it came from.                                                 |

## `customers.list(params?)`

Returns an array of customers.

```ts
const customers = await driver.customers.list({ email: 'jane@example.com' });
```

| Parameter | Type     | Description                                     |
| --------- | -------- | ----------------------------------------------- |
| `email`   | `string` | Only return customers with this email.          |
| `limit`   | `number` | Maximum number of customers. Defaults to `100`. |

| Provider | Behavior                                                              |
| -------- | --------------------------------------------------------------------- |
| Stripe   | Returns one page of up to `limit` customers. The maximum is 100.      |
| Recurly  | Reads pages of accounts until `limit` is reached. The maximum is 200. |

## `customers.create(params)`

Creates a customer and returns it.

```ts
const customer = await driver.customers.create({
  email: 'jane@example.com',
  code: 'customer-42',
  firstName: 'Jane',
  lastName: 'Doe',
  metadata: { source: 'checkout' },
});
```

| Parameter   | Type                     | Description                                                  |
| ----------- | ------------------------ | ------------------------------------------------------------ |
| `email`     | `string`                 | Required. The customer's email.                              |
| `code`      | `string`                 | Your own identifier. Required on Recurly, ignored on Stripe. |
| `firstName` | `string`                 | First name.                                                  |
| `lastName`  | `string`                 | Last name.                                                   |
| `metadata`  | `Record<string, string>` | Extra key and value pairs.                                   |

| Provider | Behavior                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Creates a customer. `firstName` and `lastName` are joined into the Stripe `name`.                                                  |
| Recurly  | Creates an account. Without `code` it rejects with `ValidationError` before calling Recurly. `metadata` is saved as custom fields. |

## `customers.update(customerId, params)`

Updates a customer and returns it. Fields you leave out are not changed.

```ts
const customer = await driver.customers.update('cus_123', {
  email: 'jane.doe@example.com',
});

await driver.customers.update('cus_123', { defaultPaymentMethod: 'pm_456' });
```

| Parameter              | Type                     | Description                                                                                              |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `email`                | `string`                 | New email.                                                                                               |
| `firstName`            | `string`                 | New first name.                                                                                          |
| `lastName`             | `string`                 | New last name.                                                                                           |
| `metadata`             | `Record<string, string>` | Metadata to set.                                                                                         |
| `defaultPaymentMethod` | `string`                 | Stripe payment method id or Recurly billing info id to bill by default. It must belong to this customer. |

| Provider | Behavior                                                                                                                                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Stripe stores a single name, so `firstName` and `lastName` must be given together. Otherwise it rejects with `ValidationError` before calling Stripe. `defaultPaymentMethod` sets `invoice_settings.default_payment_method`.                                                                                     |
| Recurly  | Updates each given field. `metadata` is saved as custom fields. `defaultPaymentMethod` makes the billing info the account's primary payment method. It is checked against the account before anything is written. If it is already primary, for example because it is the only billing info, nothing is changed. |

`defaultPaymentMethod` rejects with `PaymentMethodError` when the payment method does not exist or is not attached to the customer.

A subscription that has its own payment method keeps billing that one. Stripe charges a subscription's `default_payment_method` before the customer's default. To move an existing subscription to the new card, also call [`subscriptions.update`](subscriptions.md#subscriptionsupdatesubscriptionid-params) with `paymentMethod`.

On Recurly, `defaultPaymentMethod` needs the Wallet feature, which allows more than one billing info per account.

## The `Customer` object

| Field       | Type                     | Description                                        |
| ----------- | ------------------------ | -------------------------------------------------- |
| `id`        | `string`                 | The provider's id.                                 |
| `code`      | `string \| null`         | The Recurly account code. Always `null` on Stripe. |
| `email`     | `string \| null`         | Email.                                             |
| `name`      | `string \| null`         | Full name. On Recurly, first and last name joined. |
| `metadata`  | `Record<string, string>` | Stripe metadata or Recurly custom fields.          |
| `createdAt` | `Date`                   | When the customer was created.                     |
| `provider`  | `CashierProvider`        | The provider it came from.                         |

`with: ['balances']` adds `balances: CustomerBalance[]`. See [The customer balance](#the-customer-balance).
