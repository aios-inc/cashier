# @aios-inc/cashier-express

[![npm](https://img.shields.io/npm/v/@aios-inc/cashier-express.svg)](https://www.npmjs.com/package/@aios-inc/cashier-express)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/aios-inc/cashier/blob/main/LICENSE)

Express middleware and error handler for [Cashier](https://github.com/aios-inc/cashier), unified subscription billing for Node.js and TypeScript. Get a typed `req.cashier` on every request and answer billing errors with the right HTTP status. Supports Express 4 and 5.

## Install

```bash
npm install @aios-inc/cashier @aios-inc/cashier-express stripe recurly
```

## Usage

```ts
import express from 'express';
import { CashierProvider, createCashier } from '@aios-inc/cashier';
import {
  cashierErrorHandler,
  cashierMiddleware,
} from '@aios-inc/cashier-express';

const cashier = createCashier({
  default: CashierProvider.Stripe,
  providers: { stripe: { apiKey: process.env.STRIPE_SECRET_KEY! } },
});

const app = express();

app.use(cashierMiddleware(cashier));

app.get('/invoices/:id', async (req, res) => {
  res.json(await req.cashier.use().invoices.get(req.params.id));
});

app.use(cashierErrorHandler());
```

A missing invoice then answers `404 { "code": "not_found", "message": "..." }`, a declined card `402` with the decline code, and so on. Errors that are not Cashier errors go to your next error handler.

## Documentation

- [Express guide](https://github.com/aios-inc/cashier/blob/main/docs/express.md): the middleware, the error handler, Express 4 and testing.
- [API reference](https://github.com/aios-inc/cashier/blob/main/docs/README.md): customers, invoices, payments, products, prices and subscriptions.
- [Errors](https://github.com/aios-inc/cashier/blob/main/docs/errors.md): every error class and the HTTP responses.

## License

[MIT](https://github.com/aios-inc/cashier/blob/main/LICENSE) © AIOS
