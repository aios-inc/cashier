import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Cashier, CashierProvider, ValidationError } from '@aios-inc/cashier';
import { CashierModule, CashierService } from '../src';

const STRIPE_KEY = 'sk_test_nestjs';
const RECURLY_KEY = 'recurly_test_nestjs';
const BILLING_CONFIG = 'BILLING_CONFIG';

@Module({
  providers: [
    {
      provide: BILLING_CONFIG,
      useValue: {
        provider: CashierProvider.Recurly,
        stripeKey: STRIPE_KEY,
        recurlyKey: RECURLY_KEY,
      },
    },
  ],
  exports: [BILLING_CONFIG],
})
class BillingConfigModule {}

@Injectable()
class BillingService {
  constructor(@Inject(CashierService) readonly cashier: CashierService) {}
}

@Module({ providers: [BillingService], exports: [BillingService] })
class BillingModule {}

describe('CashierModule', () => {
  it('should provide a CashierService configured by forRoot', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CashierModule.forRoot({
          default: CashierProvider.Stripe,
          providers: { stripe: { apiKey: STRIPE_KEY } },
        }),
      ],
    }).compile();

    const service = moduleRef.get(CashierService);

    expect(service).toBeInstanceOf(Cashier);
    expect(service.defaultProvider).toBe(CashierProvider.Stripe);
    expect(service.use().provider).toBe(CashierProvider.Stripe);
  });

  it('should build the options with forRootAsync and injected dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CashierModule.forRootAsync({
          imports: [BillingConfigModule],
          inject: [BILLING_CONFIG],
          useFactory: (config: {
            provider: CashierProvider;
            stripeKey: string;
            recurlyKey: string;
          }) => ({
            default: config.provider,
            providers: {
              stripe: { apiKey: config.stripeKey },
              recurly: { apiKey: config.recurlyKey },
            },
          }),
        }),
      ],
    }).compile();

    const service = moduleRef.get(CashierService);

    expect(service.defaultProvider).toBe(CashierProvider.Recurly);
    expect(service.use().provider).toBe(CashierProvider.Recurly);
    expect(service.use(CashierProvider.Stripe).provider).toBe(
      CashierProvider.Stripe,
    );
  });

  it('should make CashierService available everywhere with isGlobal', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CashierModule.forRoot({
          isGlobal: true,
          providers: { stripe: { apiKey: STRIPE_KEY } },
        }),
        BillingModule,
      ],
    }).compile();

    expect(moduleRef.get(BillingService).cashier).toBe(
      moduleRef.get(CashierService),
    );
  });

  it('should not pass isGlobal on to the Cashier config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CashierModule.forRoot({
          isGlobal: true,
          providers: { stripe: { apiKey: STRIPE_KEY } },
        }),
      ],
    }).compile();

    expect(moduleRef.get(CashierService).use().provider).toBe(
      CashierProvider.Stripe,
    );
  });

  it('should support per-call api keys without configured providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CashierModule.forRoot({})],
    }).compile();

    const service = moduleRef.get(CashierService);

    expect(
      service.use(CashierProvider.Stripe, { apiKey: STRIPE_KEY }).provider,
    ).toBe(CashierProvider.Stripe);
    expect(() => service.use()).toThrow(ValidationError);
  });

  it('should be replaceable with a fake in tests', async () => {
    const fake = { use: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [BillingService, { provide: CashierService, useValue: fake }],
    }).compile();

    expect(moduleRef.get(BillingService).cashier).toBe(fake);
  });
});
