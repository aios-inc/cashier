# Drivers and conventions

## Creating a driver

```ts
import { CashierProvider, createCashier } from '@aios-inc/cashier';

const cashier = createCashier({
  default: CashierProvider.Stripe,
  providers: { stripe: { apiKey: process.env.STRIPE_SECRET_KEY! } },
});

const driver = cashier.use();
```

`use()` returns a `CashierDriver` for the default provider, `use(CashierProvider.Recurly)` for a configured provider, and `use(CashierProvider.Stripe, { apiKey })` for credentials given at runtime. Drivers are created once and reused. See [TypeScript](typescript.md) for every option.

On Stripe the SDK is created with API version `2023-08-16`, the version the mappers are written for.

## What a driver has

| Property        | Type                    | Reference                         |
| --------------- | ----------------------- | --------------------------------- |
| `provider`      | `CashierProvider`       | The provider behind the driver.   |
| `customers`     | `CustomersResource`     | [Customers](customers.md)         |
| `invoices`      | `InvoicesResource`      | [Invoices](invoices.md)           |
| `payments`      | `PaymentsResource`      | [Payments](payments.md)           |
| `products`      | `ProductsResource`      | [Products](products.md)           |
| `prices`        | `PricesResource`        | [Prices](prices.md)               |
| `subscriptions` | `SubscriptionsResource` | [Subscriptions](subscriptions.md) |

Every method returns a promise. When it fails, it rejects with a subclass of `CashierError`. See [Errors](errors.md).

## How providers map to Cashier

| Cashier      | Stripe        | Recurly                                        |
| ------------ | ------------- | ---------------------------------------------- |
| Customer     | Customer      | Account                                        |
| Invoice      | Invoice       | Invoice                                        |
| Payment      | PaymentIntent | Transaction (`purchase` and `capture`)         |
| Product      | Product       | Plan                                           |
| Price        | Price         | Not available. Pricing is defined on the plan. |
| Subscription | Subscription  | Subscription, with a single item for its plan  |

## Conventions

- **Amounts** (`subtotal`, `tax`, `total`, `unitAmount`, `amount`) are integers in the currency's minor unit, for example `14999` for USD 149.99 and `5000` for JPY 5000. Recurly returns major units, and Cashier converts them using the currency's number of decimal places.
- **Currencies** are uppercase ISO 4217 codes such as `USD`.
- **Timestamps** are `Date` objects.
- **Metadata** is a `Record<string, string>`. On Recurly it is read from and written to custom fields.
- **Unknown states** from a provider are returned as `status: 'unknown'` instead of failing.
- **`provider`** is set on every returned object, so you always know where it came from.

## Recurly ids and codes

Recurly methods that take an id also accept a code with the `code-` prefix, as the Recurly API does:

- `code-customer-42` is the account with code `customer-42`.
- `code-pro-monthly` is the plan with code `pro-monthly`.

## Pagination and limits

Every `list` method takes an optional `limit`, which defaults to `100`.

| Provider | Behavior                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| Stripe   | Returns a single page of up to `limit` results. Stripe accepts at most 100.   |
| Recurly  | Reads pages until `limit` results are collected. Recurly accepts at most 200. |

`payments`, `invoices` and `subscriptions` also have `cursorPaginate`, which returns one page at a time:

```ts
const page = await driver.payments.cursorPaginate({
  customer: 'cus_123',
  perPage: 25,
  cursor: req.query.cursor,
});
```

It takes `perPage` (defaults to `100`) and `cursor`, and returns a `CursorPaginator`:

| Field          | Type             | Description                                                   |
| -------------- | ---------------- | ------------------------------------------------------------- |
| `data`         | `Item[]`         | The items on this page.                                       |
| `perPage`      | `number`         | The page size that was requested.                             |
| `hasMorePages` | `boolean`        | Whether there is a next page.                                 |
| `nextCursor`   | `string \| null` | Pass it as `cursor` to get the next page. `null` on the last. |

The cursor is opaque. On Stripe it is the id of the page's last item, and on Recurly it is Recurly's own cursor, so always pass back the `nextCursor` you received instead of building one. The result is plain JSON, so an API can return it as is and the client can send `nextCursor` back as a query parameter. There is no previous cursor, because Recurly cannot page backwards.

## TypeScript

The package exports every type it uses: `CashierDriver` (and `CashierDriver<Provider>` for one provider), `CashierProvider`, `CashierProviderOptions`, `RefundReason`, the relations each provider supports (`CashierPaymentRelations`, `CashierInvoiceRelations`, `CashierSubscriptionRelations`), the result types with relations (`PaymentWith<Relation>`, `InvoiceWith<Relation>`, `SubscriptionWith<Relation>`), the resource interfaces (`CustomersResource`, `InvoicesResource`, `PaymentsResource`, `ProductsResource`, `PricesResource`, `SubscriptionsResource`), the result types (`Customer`, `Invoice`, `Payment`, `PaymentDispute`, `PaymentSubscription`, `Refund`, `Product`, `Price`, `Subscription`), `CursorPaginator` and the parameter types such as `CreateSubscriptionParams`, `RefundPaymentParams` and `CursorPaginateParams`.
