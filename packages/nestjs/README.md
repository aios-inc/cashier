# @aios-inc/cashier-nestjs

[![npm](https://img.shields.io/npm/v/@aios-inc/cashier-nestjs.svg)](https://www.npmjs.com/package/@aios-inc/cashier-nestjs)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/aios-inc/cashier/blob/main/LICENSE)

NestJS module for [Cashier](https://github.com/aios-inc/cashier), unified subscription billing for Node.js and TypeScript. Register it with `forRoot` or `forRootAsync`, inject `CashierService` anywhere, and turn billing errors into proper HTTP responses. Supports NestJS 9, 10, 11 and 12.

## Install

```bash
npm install @aios-inc/cashier @aios-inc/cashier-nestjs stripe recurly
```

## Usage

```ts
import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  CashierExceptionFilter,
  CashierModule,
  CashierService,
} from '@aios-inc/cashier-nestjs';
import { CashierProvider } from '@aios-inc/cashier';

@Module({
  imports: [
    CashierModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        default: CashierProvider.Stripe,
        providers: {
          stripe: { apiKey: config.getOrThrow('STRIPE_SECRET_KEY') },
          recurly: { apiKey: config.getOrThrow('RECURLY_API_KEY') },
        },
      }),
    }),
  ],
  providers: [{ provide: APP_FILTER, useClass: CashierExceptionFilter }],
})
export class AppModule {}

@Injectable()
export class BillingService {
  constructor(private readonly cashier: CashierService) {}

  getInvoice(invoiceId: string) {
    return this.cashier.use().invoices.get(invoiceId);
  }
}
```

| Call                                              | Driver                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `cashier.use()`                                   | The `default` provider. Switch providers by changing the config. |
| `cashier.use(CashierProvider.Recurly)`            | A provider from `providers`.                                     |
| `cashier.use(CashierProvider.Stripe, { apiKey })` | Other credentials, given at runtime.                             |

## Documentation

- [NestJS guide](https://github.com/aios-inc/cashier/blob/main/docs/nestjs.md): every option, the exception filter and testing.
- [API reference](https://github.com/aios-inc/cashier/blob/main/docs/README.md): customers, invoices, payments, products, prices and subscriptions.
- [Errors](https://github.com/aios-inc/cashier/blob/main/docs/errors.md): every error class and the HTTP responses.

## License

[MIT](https://github.com/aios-inc/cashier/blob/main/LICENSE) © AIOS
