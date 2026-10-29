# Express

`@aios-inc/cashier-express` adds a middleware that puts your Cashier on every request as `req.cashier`, and an error handler that turns Cashier errors into HTTP responses. It supports Express 4 and 5.

```bash
npm install @aios-inc/cashier @aios-inc/cashier-express stripe recurly
```

## Set up

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

app.use(express.json());
app.use(cashierMiddleware(cashier));

app.post('/subscriptions', async (req, res) => {
  const subscription = await req.cashier.use().subscriptions.create({
    customer: req.body.customerId,
    price: req.body.priceId,
    currency: 'USD',
  });

  res.status(201).json(subscription);
});

app.use(cashierErrorHandler());
```

- `cashierMiddleware(cashier)` sets `req.cashier` on every request. With TypeScript, `req.cashier` is typed as `Cashier`, with no extra setup.
- `req.cashier.use()` works exactly like in [TypeScript](typescript.md#get-a-driver-with-use): `use()`, `use(CashierProvider.Recurly)` or `use(CashierProvider.Stripe, { apiKey })`.
- Add `cashierErrorHandler()` after your routes and before your own error handler.

## Error responses

`cashierErrorHandler()` answers Cashier errors with the right status and a JSON body:

```http
HTTP/1.1 402 Payment Required

{ "code": "payment_failed", "message": "Your card was declined.", "declineCode": "insufficient_funds" }
```

The status for each error and the hidden provider messages are listed in [Errors](errors.md#http-responses). Errors that are not Cashier errors are passed to the next error handler, so your own handler still sees them.

On Express 5, errors thrown in `async` route handlers reach the error handler on their own. On Express 4, pass them on yourself:

```ts
app.get('/invoices/:id', (req, res, next) => {
  req.cashier
    .use()
    .invoices.get(req.params.id)
    .then((invoice) => res.json(invoice), next);
});
```

## Without the middleware

The middleware is optional. You can import your Cashier anywhere and still use the error handler:

```ts
import { cashier } from './billing';

app.get('/invoices/:id', async (req, res) => {
  res.json(await cashier.use().invoices.get(req.params.id));
});

app.use(cashierErrorHandler());
```

## Testing

Use your own Cashier in tests and replace `req.cashier` with a fake:

```ts
import { Cashier, CashierDriver, CashierProvider } from '@aios-inc/cashier';

const driver = {
  provider: CashierProvider.Stripe,
  subscriptions: { create: jest.fn() },
} as unknown as CashierDriver;

app.use(cashierMiddleware({ use: () => driver } as unknown as Cashier));
```

## Exports

| Export                | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `cashierMiddleware`   | `(cashier: Cashier) => RequestHandler`. Sets `req.cashier`.     |
| `cashierErrorHandler` | `() => ErrorRequestHandler`. Maps `CashierError` to a response. |
