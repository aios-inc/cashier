# Cashier

[![npm](https://img.shields.io/npm/v/@aios-inc/cashier.svg)](https://www.npmjs.com/package/@aios-inc/cashier)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/aios-inc/cashier/blob/main/LICENSE)

Unified subscription billing for Node.js and TypeScript. One API for every payment provider, with typed errors. Stripe and Recurly are supported today.

```bash
npm install @aios-inc/cashier stripe recurly
```

```ts
import { CashierProvider, createCashier } from '@aios-inc/cashier';

const cashier = createCashier({
  default: CashierProvider.Stripe,
  providers: {
    stripe: { apiKey: process.env.STRIPE_SECRET_KEY! },
    recurly: { apiKey: process.env.RECURLY_API_KEY! },
  },
});

const billing = cashier.use();

const customer = await billing.customers.create({ email: 'jane@example.com' });

await billing.subscriptions.create({
  customer: customer.id,
  price: 'price_123',
  currency: 'USD',
});
```

To switch providers, change `default`. Your billing code stays the same. Use `cashier.use(CashierProvider.Recurly)` to run several providers side by side.

## Why Cashier

- **One interface.** Same methods and the same result shapes on every provider.
- **Consistent data.** Amounts in cents, uppercase ISO 4217 currencies, `Date` timestamps.
- **Typed errors.** `NotFoundError`, `PaymentFailedError`, `RateLimitError` and more, with the provider error kept as `cause`.
- **Framework ready.** NestJS and Express packages included.
- **No extra dependencies.** Only the provider SDKs you install.

## Providers

[Stripe](https://www.npmjs.com/package/stripe) v13 and [Recurly](https://www.npmjs.com/package/recurly) v4.67 or later. Node.js 20 or later.

## Packages

- [`@aios-inc/cashier`](https://www.npmjs.com/package/@aios-inc/cashier): the core library
- [`@aios-inc/cashier-nestjs`](https://github.com/aios-inc/cashier/tree/main/packages/nestjs#readme): NestJS module
- [`@aios-inc/cashier-express`](https://github.com/aios-inc/cashier/tree/main/packages/express#readme): Express middleware

## Documentation

- [API reference](https://github.com/aios-inc/cashier/blob/main/docs/README.md#api-reference): customers, invoices, payments, products, prices and subscriptions
- [TypeScript](https://github.com/aios-inc/cashier/blob/main/docs/typescript.md), [NestJS](https://github.com/aios-inc/cashier/blob/main/docs/nestjs.md), [Express](https://github.com/aios-inc/cashier/blob/main/docs/express.md)
- [Drivers and conventions](https://github.com/aios-inc/cashier/blob/main/docs/drivers.md)
- [Errors](https://github.com/aios-inc/cashier/blob/main/docs/errors.md)

## Contributing

See [CONTRIBUTING.md](https://github.com/aios-inc/cashier/blob/main/CONTRIBUTING.md) and [SECURITY.md](https://github.com/aios-inc/cashier/blob/main/SECURITY.md).

## License

[MIT](https://github.com/aios-inc/cashier/blob/main/LICENSE) © AIOS
