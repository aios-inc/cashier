# NestJS

`@aios-inc/cashier-nestjs` adds a `CashierModule` with `forRoot` and `forRootAsync`, an injectable `CashierService`, and an exception filter that turns Cashier errors into HTTP responses. It supports NestJS 9, 10, 11 and 12.

```bash
npm install @aios-inc/cashier @aios-inc/cashier-nestjs stripe recurly
```

## Register the module

With values known up front, use `forRoot`:

```ts
import { Module } from '@nestjs/common';
import { CashierModule } from '@aios-inc/cashier-nestjs';
import { CashierProvider } from '@aios-inc/cashier';

@Module({
  imports: [
    CashierModule.forRoot({
      isGlobal: true,
      default: CashierProvider.Stripe,
      providers: {
        stripe: { apiKey: process.env.STRIPE_SECRET_KEY! },
      },
    }),
  ],
})
export class AppModule {}
```

To read the keys from `ConfigService` or any other provider, use `forRootAsync`:

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CashierProvider } from '@aios-inc/cashier';

CashierModule.forRootAsync({
  isGlobal: true,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    default: config.get<CashierProvider>(
      'BILLING_PROVIDER',
      CashierProvider.Stripe,
    ),
    providers: {
      stripe: { apiKey: config.getOrThrow('STRIPE_SECRET_KEY') },
      recurly: { apiKey: config.getOrThrow('RECURLY_API_KEY') },
    },
  }),
});
```

`forRootAsync` also accepts `useClass` and `useExisting`, like any NestJS configurable module.

| Option      | Description                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `isGlobal`  | Make `CashierService` available in every module without importing `CashierModule`. Defaults to `false`. |
| `default`   | The provider `use()` returns. Optional when only one provider is configured.                            |
| `providers` | The providers and API keys your app uses. See [TypeScript](typescript.md#create-a-cashier).             |

A missing or empty API key fails when the app starts, not on the first payment.

## Inject CashierService

`CashierService` is a `Cashier`, so it has the same `use` method:

```ts
import { Injectable } from '@nestjs/common';
import { Subscription } from '@aios-inc/cashier';
import { CashierService } from '@aios-inc/cashier-nestjs';

@Injectable()
export class BillingService {
  constructor(private readonly cashier: CashierService) {}

  subscribe(customerId: string, price: string): Promise<Subscription> {
    return this.cashier.use().subscriptions.create({
      customer: customerId,
      price,
      currency: 'USD',
    });
  }

  listInvoices(customer: {
    billingProvider: CashierProvider;
    billingId: string;
  }) {
    return this.cashier
      .use(customer.billingProvider)
      .invoices.list({ customer: customer.billingId });
  }
}
```

- `use()` uses the default provider, so switching providers is a config change.
- `use(CashierProvider.Recurly)` picks a configured provider for this call.
- `use(CashierProvider.Stripe, { apiKey })` uses other credentials, given at runtime. See [TypeScript](typescript.md#use-different-credentials-at-runtime).

## Turn Cashier errors into HTTP responses

Register `CashierExceptionFilter` once, globally:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CashierExceptionFilter } from '@aios-inc/cashier-nestjs';

@Module({
  providers: [{ provide: APP_FILTER, useClass: CashierExceptionFilter }],
})
export class AppModule {}
```

A `NotFoundError` thrown anywhere in a request then becomes:

```http
HTTP/1.1 404 Not Found

{ "code": "not_found", "message": "No such invoice: 'in_123'" }
```

The status for each error and the hidden provider messages are listed in [Errors](errors.md#http-responses). Other errors are left to NestJS. The filter works with both the Express and the Fastify platform, and only handles HTTP requests.

## Testing

Replace `CashierService` with a fake in your testing module:

```ts
import { Test } from '@nestjs/testing';
import { CashierDriver, CashierProvider } from '@aios-inc/cashier';
import { CashierService } from '@aios-inc/cashier-nestjs';

const driver = {
  provider: CashierProvider.Stripe,
  subscriptions: { create: jest.fn() },
} as unknown as CashierDriver;

const moduleRef = await Test.createTestingModule({
  providers: [
    BillingService,
    { provide: CashierService, useValue: { use: () => driver } },
  ],
}).compile();
```

## Exports

| Export                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `CashierModule`             | The module, with `forRoot` and `forRootAsync`.   |
| `CashierService`            | The injectable Cashier.                          |
| `CashierExceptionFilter`    | Maps `CashierError` to an HTTP response.         |
| `CASHIER_MODULE_OPTIONS`    | Injection token for the resolved module options. |
| `CashierModuleOptions`      | The options type, the same as `CashierConfig`.   |
| `CashierModuleAsyncOptions` | The `forRootAsync` options type.                 |
