import 'reflect-metadata';
import {
  ArgumentsHost,
  Controller,
  Get,
  INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CashierProvider,
  NotFoundError,
  PaymentFailedError,
  ProviderError,
} from '@aios-inc/cashier';
import { CashierExceptionFilter } from '../src';

@Controller()
class BillingController {
  @Get('missing')
  missing(): never {
    throw new NotFoundError('Invoice in_1 not found', {
      provider: CashierProvider.Stripe,
    });
  }

  @Get('declined')
  declined(): never {
    throw new PaymentFailedError('Card declined', {
      provider: CashierProvider.Stripe,
      declineCode: 'insufficient_funds',
    });
  }

  @Get('provider-down')
  providerDown(): never {
    throw new ProviderError('socket hang up', {
      provider: CashierProvider.Recurly,
    });
  }

  @Get('other')
  other(): never {
    throw new Error('not a cashier error');
  }
}

@Module({
  controllers: [BillingController],
  providers: [{ provide: APP_FILTER, useClass: CashierExceptionFilter }],
})
class AppModule {}

describe('CashierExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should answer a NotFoundError with 404 and the error code', async () => {
    const response = await request(app.getHttpServer()).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'not_found',
      message: 'Invoice in_1 not found',
    });
  });

  it('should answer a declined payment with 402 and the decline code', async () => {
    const response = await request(app.getHttpServer()).get('/declined');

    expect(response.status).toBe(402);
    expect(response.body).toEqual({
      code: 'payment_failed',
      message: 'Card declined',
      declineCode: 'insufficient_funds',
    });
  });

  it('should hide provider details behind a 502', async () => {
    const response = await request(app.getHttpServer()).get('/provider-down');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      code: 'provider',
      message: 'The billing provider request failed',
    });
  });

  it('should leave other errors to Nest', async () => {
    const response = await request(app.getHttpServer()).get('/other');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  it('should rethrow errors outside of HTTP requests', () => {
    const filter = new CashierExceptionFilter(new HttpAdapterHost());
    const error = new NotFoundError('Invoice in_1 not found');
    const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;

    expect(() => filter.catch(error, host)).toThrow(error);
  });
});
