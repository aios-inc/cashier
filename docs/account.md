# Account

`driver.account` reads the settings of the Stripe account your API key belongs to. It is only on the Stripe driver.

- [`account.get()`](#accountget)
- [The `Account` object](#the-account-object)

## `account.get()`

Returns your Stripe account, for example to show the statement descriptor a customer will see before you charge their card.

```ts
const account = await cashier.use(CashierProvider.Stripe).account.get();

account.statementDescriptor; // 'ACME INC'
```

| Provider | Behavior                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Retrieves the account of the API key.                                                                                           |
| Recurly  | Not available. Recurly sets the descriptor on each payment gateway, and its API does not return it. `account` does not compile. |

`account` is typed in `CashierDriverCapabilities`, so it exists on `cashier.use(CashierProvider.Stripe)` but not on `cashier.use()` or the Recurly driver. See [Provider-only methods](typescript.md#provider-only-methods).

To read the descriptor a payment was actually charged with, load `statementDescriptor` on the payment. See [Payments](payments.md#loading-relations-with-with).

## The `Account` object

| Field                       | Type              | Description                                                                                                |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                        | `string`          | The Stripe account id.                                                                                     |
| `name`                      | `string \| null`  | The business name, or the Dashboard display name when there is none.                                       |
| `statementDescriptor`       | `string \| null`  | `settings.payments.statement_descriptor`, the default text on customers' card statements.                  |
| `statementDescriptorPrefix` | `string \| null`  | `settings.card_payments.statement_descriptor_prefix`, which prefixes a dynamic descriptor set on a charge. |
| `provider`                  | `CashierProvider` | Always `stripe`.                                                                                           |
