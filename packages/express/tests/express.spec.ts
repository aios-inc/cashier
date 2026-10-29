import express, { ErrorRequestHandler } from 'express';
import request from 'supertest';
import {
  CashierProvider,
  createCashier,
  NotFoundError,
  PaymentFailedError,
  ProviderError,
} from '@aios-inc/cashier';
import { cashierErrorHandler, cashierMiddleware } from '../src';

const cashier = createCashier({
  providers: { stripe: { apiKey: 'sk_test_express' } },
});

const createApp = () => {
  const app = express();

  app.use(cashierMiddleware(cashier));

  app.get('/provider', (req, res) => {
    res.json({
      provider: req.cashier.use().provider,
      sameInstance: req.cashier === cashier,
    });
  });

  app.get('/missing', () => {
    throw new NotFoundError('Invoice in_1 not found', {
      provider: CashierProvider.Stripe,
    });
  });

  app.get('/declined', async () => {
    throw new PaymentFailedError('Card declined', {
      provider: CashierProvider.Stripe,
      declineCode: 'insufficient_funds',
    });
  });

  app.get('/provider-down', () => {
    throw new ProviderError('socket hang up', {
      provider: CashierProvider.Stripe,
    });
  });

  app.get('/other', () => {
    throw new Error('not a cashier error');
  });

  app.use(cashierErrorHandler());

  const fallback: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(500).json({ fallback: (error as Error).message });
  };

  app.use(fallback);

  return app;
};

describe('cashierMiddleware', () => {
  it('should attach the Cashier instance to every request', async () => {
    const response = await request(createApp()).get('/provider');

    expect(response.body).toEqual({
      provider: CashierProvider.Stripe,
      sameInstance: true,
    });
  });
});

describe('cashierErrorHandler', () => {
  it('should answer a NotFoundError with 404 and the error code', async () => {
    const response = await request(createApp()).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'not_found',
      message: 'Invoice in_1 not found',
    });
  });

  it('should handle errors from async handlers', async () => {
    const response = await request(createApp()).get('/declined');

    expect(response.status).toBe(402);
    expect(response.body).toEqual({
      code: 'payment_failed',
      message: 'Card declined',
      declineCode: 'insufficient_funds',
    });
  });

  it('should hide provider details behind a 502', async () => {
    const response = await request(createApp()).get('/provider-down');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      code: 'provider',
      message: 'The billing provider request failed',
    });
  });

  it('should pass other errors to the next error handler', async () => {
    const response = await request(createApp()).get('/other');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ fallback: 'not a cashier error' });
  });
});
