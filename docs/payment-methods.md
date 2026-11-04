# Payment methods

`driver.paymentMethods` lists the cards and other payment methods a customer has saved: Stripe payment methods and Recurly billing infos.

- [`paymentMethods.list(params)`](#paymentmethodslistparams)
- [The `PaymentMethod` object](#the-paymentmethod-object)

To change which one is billed, see `defaultPaymentMethod` in [`customers.update`](customers.md#customersupdatecustomerid-params) and `paymentMethod` in [`subscriptions.update`](subscriptions.md#subscriptionsupdatesubscriptionid-params).

## `paymentMethods.list(params)`

Returns a customer's saved payment methods, with the default one marked.

```ts
const paymentMethods = await driver.paymentMethods.list({
  customer: 'cus_123',
});

const card = paymentMethods.find((paymentMethod) => paymentMethod.isDefault);

card?.brand; // 'visa'
card?.last4; // '4242'
card?.wallet; // 'apple_pay'
```

| Parameter  | Type     | Description                                           |
| ---------- | -------- | ----------------------------------------------------- |
| `customer` | `string` | Required. The customer id.                            |
| `limit`    | `number` | Maximum number of payment methods. Defaults to `100`. |

| Provider | Behavior                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe   | Lists the customer's payment methods and retrieves the customer, in parallel, to find `invoice_settings.default_payment_method`. A deleted customer rejects with `NotFoundError`. The maximum `limit` is 100.             |
| Recurly  | Lists the account's billing infos. The default is the one with `primary_payment_method`. Without the Wallet feature an account has at most one billing info, and it is the default. Reads pages until `limit` is reached. |

## The `PaymentMethod` object

| Field        | Type                          | Description                                                                                           |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`         | `string`                      | The Stripe payment method id or the Recurly billing info id. Pass it as `paymentMethod` to charge it. |
| `customerId` | `string \| null`              | The customer or account id.                                                                           |
| `type`       | `PaymentMethodType`           | `card`, `bank_account`, `paypal` or `other`.                                                          |
| `brand`      | `string \| null`              | The card brand in lowercase, as Stripe names it: `visa`, `mastercard`, `amex`, `discover` and so on.  |
| `last4`      | `string \| null`              | The last four digits of the card or bank account.                                                     |
| `expMonth`   | `number \| null`              | The card's expiry month, 1 to 12.                                                                     |
| `expYear`    | `number \| null`              | The card's four-digit expiry year.                                                                    |
| `wallet`     | `PaymentMethodWallet \| null` | `apple_pay`, `google_pay`, `link` or `other` when the card came from a wallet. `null` otherwise.      |
| `isDefault`  | `boolean`                     | `true` for the payment method the customer is billed with by default.                                 |
| `createdAt`  | `Date \| null`                | When it was saved.                                                                                    |
| `provider`   | `CashierProvider`             | The provider it came from.                                                                            |

`type`, `brand`, `last4`, `expMonth`, `expYear` and `wallet` are the `PaymentMethodDetails`, which payments and subscriptions also return with `with: ['paymentMethod']`.

| Field    | Stripe                                                                                                                                            | Recurly                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`   | `card` for cards, `bank_account` for `us_bank_account`, `sepa_debit`, `bacs_debit`, `au_becs_debit` and `acss_debit`, `paypal`, otherwise `other` | `card` for `credit_card` and wallets, `bank_account` for `bank_account_info`, `iban_bank_account`, `sepadirectdebit` and `eft`, `paypal` for PayPal, otherwise `other` |
| `brand`  | `card.brand`                                                                                                                                      | `card_type` in lowercase, with `American Express` as `amex`, `Diners Club` as `diners` and `Union Pay` as `unionpay`                                                   |
| `wallet` | `card.wallet.type`, or `link` for a Link payment method                                                                                           | `apple_pay` for Apple Pay and `google_pay` for Google Pay billing infos                                                                                                |
