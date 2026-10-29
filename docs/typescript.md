# TypeScript

`@aios-inc/cashier` works on its own in any Node.js or TypeScript project. The [NestJS](nestjs.md) and [Express](express.md) packages are thin layers on top of it.

```bash
npm install @aios-inc/cashier stripe recurly
```

## Create a Cashier

Configure your providers once and create one Cashier for your app:

```ts
import { CashierProvider, createCashier } from '@aios-inc/cashier';

export const cashier = createCashier({
  default: CashierProvider.Stripe,
  providers: {
    stripe: { apiKey: process.env.STRIPE_SECRET_KEY! },
    recurly: { apiKey: process.env.RECURLY_API_KEY! },
  },
});
```

| Option      | Type                                                            | Description                                                                  |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `default`   | `CashierProvider`                                               | The provider `use()` returns. Optional when only one provider is configured. |
| `providers` | `{ stripe?: { apiKey: string }, recurly?: { apiKey: string } }` | The providers your app uses. Each one needs a non-empty `apiKey`.            |

`createCashier(config)` is the same as `new Cashier(config)`. Both config options are optional. With no config at all, pass the API key to every `use` call, as shown below.

Cashier checks the config when it is created. An empty `apiKey` throws `AuthenticationError`, and a `default` that is not in `providers` throws `ValidationError`, so a missing environment variable fails at startup instead of on the first payment.

## Get a driver with `use`

`use` returns a driver. A driver has the `customers`, `invoices`, `payments`, `products`, `prices` and `subscriptions` resources described in the [API reference](README.md#api-reference).

```ts
await cashier.use().subscriptions.create({
  customer: 'cus_123',
  price: 'price_123',
  currency: 'USD',
});

await cashier
  .use(CashierProvider.Recurly)
  .invoices.list({ customer: 'code-customer-42' });

await cashier
  .use(CashierProvider.Stripe, { apiKey: otherStripeKey })
  .customers.get('cus_456');
```

| Call                                      | Returns                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `use()`                                   | The driver for the `default` provider, typed as `CashierDriver`.                              |
| `use(CashierProvider.Recurly)`            | The driver for a provider in `providers`, typed as `CashierDriver<CashierProvider.Recurly>`.  |
| `use(CashierProvider.Stripe, { apiKey })` | A driver with credentials given at runtime, typed as `CashierDriver<CashierProvider.Stripe>`. |

Providers are named with the `CashierProvider` enum (`CashierProvider.Stripe`, `CashierProvider.Recurly`), so a plain string like `'stripe'` does not compile. The enum values are the strings `'stripe'` and `'recurly'`, which is also what `provider` holds on every result and error.

A driver typed for one provider only accepts the relations that provider can load in `with`, such as `dispute` on Stripe. `CashierDriver`, which `use()` returns, accepts the relations every provider supports. See [Loading relations](payments.md#loading-relations-with-with).

`cashier.defaultProvider` tells you which provider `use()` returns, or `null` when there is no default.

| Mistake                                                           | Error                 |
| ----------------------------------------------------------------- | --------------------- |
| `use()` without a default provider                                | `ValidationError`     |
| `use(CashierProvider.Recurly)` when Recurly is not in `providers` | `ValidationError`     |
| `use(CashierProvider.Stripe, { apiKey: '' })`                     | `AuthenticationError` |

You can call `use` on every request. Cashier keeps the drivers it creates and returns the same one for the same provider and API key.

## Use different credentials at runtime

The keys in `providers` are the defaults. Pass options to `use` to call a provider with other credentials, known only at runtime:

```ts
const apiKey = await loadStripeKey();

await cashier.use(CashierProvider.Stripe, { apiKey }).customers.get('cus_456');
```

- The options replace the configured credentials for that call only. `use()` and `use(CashierProvider.Stripe)` keep using the configured ones.
- The provider does not need to be in `providers`.
- The same provider and API key always return the same driver, so the Stripe or Recurly client is created once. Up to 100 drivers are kept, and the least recently used one is dropped first.
- Drivers are looked up by a SHA-256 hash of the API key, so keys never appear in cache keys, logs or error messages.

## The shared instance

`cashier`, exported by the package, is a shared Cashier with no config. It is handy for scripts:

```ts
import { cashier, CashierProvider } from '@aios-inc/cashier';

const billing = cashier.use(CashierProvider.Stripe, {
  apiKey: process.env.STRIPE_SECRET_KEY!,
});
```

In an application, prefer your own `createCashier(...)` so the config lives in one place and tests can replace it.

## Passing Cashier to your classes

Give your classes the Cashier instead of importing it, so tests can pass a fake:

```ts
import { Cashier, Subscription } from '@aios-inc/cashier';

export class BillingService {
  constructor(private readonly cashier: Cashier) {}

  getSubscription(subscriptionId: string): Promise<Subscription> {
    return this.cashier.use().subscriptions.get(subscriptionId);
  }
}

const billing = new BillingService(cashier);
```

## Testing

Every method returns a promise, so a fake driver is a plain object with `jest.fn()` methods:

```ts
import { Cashier, CashierDriver, CashierProvider } from '@aios-inc/cashier';

const driver = {
  provider: CashierProvider.Stripe,
  subscriptions: { get: jest.fn().mockResolvedValue(subscription) },
} as unknown as CashierDriver;

const fakeCashier = { use: () => driver } as unknown as Cashier;

const billing = new BillingService(fakeCashier);
```

## Handling errors

Every method rejects with a subclass of `CashierError`. See [Errors](errors.md) for the full list and for `toHttpError`, which turns an error into an HTTP status and response body.
