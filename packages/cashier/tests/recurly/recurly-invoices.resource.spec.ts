import * as recurly from 'recurly';
import { RecurlyInvoicesResource } from '../../src/drivers/recurly/resources/recurly-invoices.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { ProviderError } from '../../src/errors/provider.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import {
  RECURLY_FIXTURES,
  createFailingRecurlyPager,
  createRecurlyPagePager,
  createRecurlyPager,
  withRecurlyStatus,
} from '../fixtures/recurly.fixtures';
import {
  RecurlyClientMock,
  asRecurlyClient,
  createRecurlyClientMock,
} from '../fixtures/recurly-client.mock';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  CreateInvoiceParams,
  InvoicePreview,
} from '../../src/types/invoice.types';

const PLAN_LINE_ITEM = {
  id: 'li_1',
  currency: 'usd',
  description: 'Pro Monthly',
  amount: 149.99,
  quantity: 1,
  unitAmount: 149.99,
  planId: 'plan_1',
  subscriptionId: 'rec_sub_1',
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-02-01T00:00:00Z'),
  prorationRate: null,
} as recurly.LineItem;

const PRORATED_CREDIT_LINE_ITEM = {
  id: 'li_2',
  currency: null,
  description: null,
  amount: -50,
  quantity: null,
  unitAmount: null,
  planId: null,
  subscriptionId: null,
  startDate: null,
  endDate: null,
  prorationRate: 0.5,
} as recurly.LineItem;

const EXPECTED_PLAN_LINE_ITEM = {
  id: 'li_1',
  description: 'Pro Monthly',
  amount: 14999,
  quantity: 1,
  unitAmount: 14999,
  priceId: 'plan_1',
  subscriptionId: 'rec_sub_1',
  periodStart: new Date('2026-01-01T00:00:00Z'),
  periodEnd: new Date('2026-02-01T00:00:00Z'),
  proration: false,
};

const EXPECTED_PRORATED_CREDIT_LINE_ITEM = {
  id: 'li_2',
  description: null,
  amount: -5000,
  quantity: null,
  unitAmount: null,
  priceId: null,
  subscriptionId: null,
  periodStart: null,
  periodEnd: null,
  proration: true,
};

describe('RecurlyInvoicesResource', () => {
  let client: RecurlyClientMock;
  let invoices: RecurlyInvoicesResource;

  beforeEach(() => {
    client = createRecurlyClientMock();
    invoices = new RecurlyInvoicesResource(asRecurlyClient(client));
  });

  describe('get', () => {
    it('should retrieve and map the invoice in minor units', async () => {
      client.getInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID);

      expect(client.getInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
      );
      expect(invoice).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should add the refunded amount with refunds', async () => {
      client.getInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['refunds'],
      });

      expect(invoice).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_INVOICES[0],
        amountRefunded: 4999,
      });
    });

    it('should throw NotFoundError with the provider status when the invoice does not exist', async () => {
      client.getInvoice.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        invoices.get(RECURLY_FIXTURES.INVOICE_ID),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Recurly,
        providerStatus: 404,
        providerCode: 'not_found',
      });
    });
  });

  describe('list', () => {
    it('should request account invoices with the limit and state filter', async () => {
      client.listAccountInvoices.mockReturnValue(createRecurlyPager([]));

      await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'paid',
      });

      expect(client.listAccountInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 100, state: 'paid' } },
      );
    });

    it('should map every invoice', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.INVOICES),
      );

      const result = await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(result).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES);
    });

    it('should use the currency exponent and keep unknown states and all subscription ids', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPager([RECURLY_FIXTURES.ZERO_DECIMAL_INVOICE]),
      );

      const result = await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(result).toEqual([RECURLY_FIXTURES.EXPECTED_ZERO_DECIMAL_INVOICE]);
    });

    it.each([
      [
        'a credit invoice',
        { type: 'credit', paid: 10, refundableAmount: null },
      ],
      [
        'a charge invoice without a refundable amount',
        { type: 'charge', paid: 10, refundableAmount: null },
      ],
    ])('should count no refund on %s', async (_case, overrides) => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPager([
          { ...RECURLY_FIXTURES.PAID_INVOICE, ...overrides },
        ]),
      );

      const [invoice] = await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['refunds'],
      });

      expect(invoice?.amountRefunded).toBe(0);
    });

    it('should add the refunded amount of charge invoices in minor units with refunds', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPager([
          ...RECURLY_FIXTURES.INVOICES,
          RECURLY_FIXTURES.ZERO_DECIMAL_INVOICE,
        ]),
      );

      const result = await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['refunds'],
      });

      expect(result.map((invoice) => invoice.amountRefunded)).toEqual([
        4999, 0, 2000,
      ]);
    });

    it('should reject a relation Recurly does not support without calling Recurly', async () => {
      await expect(
        invoices.list({
          customer: RECURLY_FIXTURES.ACCOUNT_ID,
          with: ['startingBalance' as 'refunds'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.listAccountInvoices).not.toHaveBeenCalled();
    });

    it('should stop reading pages once the limit is reached', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.INVOICES),
      );

      const result = await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        limit: 1,
      });

      expect(result).toEqual([RECURLY_FIXTURES.EXPECTED_INVOICES[0]]);
    });

    it('should map failures raised while paging', async () => {
      client.listAccountInvoices.mockReturnValue(
        createFailingRecurlyPager(new Error('Network down')),
      );

      await expect(
        invoices.list({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page with the state filter and return the next cursor', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPagePager(
          RECURLY_FIXTURES.INVOICES,
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      const page = await invoices.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        status: 'paid',
        perPage: 2,
        with: ['refunds'],
      });

      expect(client.listAccountInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 2, state: 'paid' } },
      );
      expect(page).toEqual({
        data: [
          { ...RECURLY_FIXTURES.EXPECTED_INVOICES[0], amountRefunded: 4999 },
          { ...RECURLY_FIXTURES.EXPECTED_INVOICES[1], amountRefunded: 0 },
        ],
        perPage: 2,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });

    it('should pass the cursor to Recurly', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPagePager(
          [RECURLY_FIXTURES.PAID_INVOICE],
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      await invoices.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        perPage: 1,
        cursor: RECURLY_FIXTURES.CURSOR,
      });

      expect(client.listAccountInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 1, cursor: RECURLY_FIXTURES.CURSOR } },
      );
    });

    it('should return no next cursor on the last page', async () => {
      client.listAccountInvoices.mockReturnValue(
        createRecurlyPagePager([RECURLY_FIXTURES.PAID_INVOICE]),
      );

      const page = await invoices.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(page).toEqual({
        data: [RECURLY_FIXTURES.EXPECTED_INVOICES[0]],
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });

    it('should map failures raised while paging', async () => {
      client.listAccountInvoices.mockReturnValue(
        createFailingRecurlyPager(new Error('Network down')),
      );

      await expect(
        invoices.cursorPaginate({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('pay', () => {
    it('should collect the invoice with the given billing info', async () => {
      client.collectInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.pay(RECURLY_FIXTURES.INVOICE_ID, {
        paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
      });

      expect(client.collectInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        { body: { billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID } },
      );
      expect(invoice).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should collect with the default billing info when none is given', async () => {
      client.collectInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      await invoices.pay(RECURLY_FIXTURES.INVOICE_ID);

      expect(client.collectInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        undefined,
      );
    });
  });

  describe('void', () => {
    it('should void and map the invoice', async () => {
      client.voidInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.void(RECURLY_FIXTURES.INVOICE_ID);

      expect(client.voidInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
      );
      expect(invoice).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES[0]);
    });
  });
  describe('create', () => {
    const NOW = new Date('2026-01-01T12:00:00Z');
    const BASE_PARAMS: CreateInvoiceParams = {
      customer: RECURLY_FIXTURES.ACCOUNT_ID,
      currency: 'usd',
      lineItems: [
        { description: 'Consultation', amount: 1999 },
        { description: '', amount: 500 },
      ],
      collection: 'send_invoice',
      description: 'Clinic visit',
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.ACCOUNT);
      client.createPurchase.mockResolvedValue({
        chargeInvoice: RECURLY_FIXTURES.PAID_INVOICE,
        creditInvoices: [],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should make one purchase with the line items in major units', async () => {
      const invoice = await invoices.create(BASE_PARAMS);

      expect(client.getAccount).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
      );
      expect(client.createPurchase).toHaveBeenCalledTimes(1);
      expect(client.createPurchase).toHaveBeenCalledWith({
        currency: 'USD',
        account: { code: RECURLY_FIXTURES.ACCOUNT_CODE },
        collectionMethod: 'manual',
        netTerms: 30,
        netTermsType: 'net',
        customerNotes: 'Clinic visit',
        lineItems: [
          {
            currency: 'USD',
            unitAmount: 19.99,
            type: 'charge',
            description: 'Consultation',
          },
          {
            currency: 'USD',
            unitAmount: 5,
            type: 'charge',
            description: 'Clinic visit',
          },
        ],
      });
      expect(invoice).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should keep zero-decimal amounts unchanged', async () => {
      client.createPurchase.mockResolvedValue({
        chargeInvoice: RECURLY_FIXTURES.ZERO_DECIMAL_INVOICE,
      });

      const invoice = await invoices.create({
        ...BASE_PARAMS,
        currency: 'JPY',
        lineItems: [{ description: 'Consultation', amount: 5000 }],
      });

      expect(client.createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: [expect.objectContaining({ unitAmount: 5000 })],
        }),
      );
      expect(invoice.total).toBe(5000);
    });

    it.each([
      [
        'collects automatically with the billing info',
        {
          collection: 'charge_automatically',
          chargeNow: true,
          paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        },
        {
          collectionMethod: 'automatic',
          billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID,
        },
      ],
      [
        'collects automatically with the default billing info',
        { collection: 'charge_automatically' },
        { collectionMethod: 'automatic' },
      ],
      [
        'sends the invoice with days until due',
        {
          collection: 'send_invoice',
          daysUntilDue: 14,
          paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        },
        { collectionMethod: 'manual', netTerms: 14, netTermsType: 'net' },
      ],
      [
        'sends the invoice with a due date, rounding up to whole days',
        {
          collection: 'send_invoice',
          dueDate: new Date('2026-01-15T00:00:00Z'),
        },
        { collectionMethod: 'manual', netTerms: 14, netTermsType: 'net' },
      ],
      [
        'sends the invoice with a due date on an exact day',
        {
          collection: 'send_invoice',
          dueDate: new Date('2026-01-08T12:00:00Z'),
        },
        { collectionMethod: 'manual', netTerms: 7, netTermsType: 'net' },
      ],
    ] as const)(
      'should map the collection when it %s',
      async (_case, overrides, expected) => {
        await invoices.create({ ...BASE_PARAMS, ...overrides });

        const [purchase] = client.createPurchase.mock.calls[0];

        expect(purchase).toMatchObject(expected);

        for (const key of ['billingInfoId', 'netTerms', 'netTermsType']) {
          if (!(key in expected)) expect(purchase).not.toHaveProperty(key);
        }
      },
    );

    it('should add the metadata to every line item as custom fields', async () => {
      await invoices.create({
        ...BASE_PARAMS,
        metadata: { order: 'order-42' },
      });

      const [purchase] = client.createPurchase.mock.calls[0];

      expect(
        purchase.lineItems.map(
          (lineItem: recurly.LineItemCreate) => lineItem.customFields,
        ),
      ).toEqual([
        [{ name: 'order', value: 'order-42' }],
        [{ name: 'order', value: 'order-42' }],
      ]);
    });

    it('should pass the idempotency key as a request header', async () => {
      await invoices.create({ ...BASE_PARAMS, idempotencyKey: 'order-42' });

      expect(client.createPurchase).toHaveBeenCalledWith(expect.any(Object), {
        headers: { 'Idempotency-Key': 'order-42' },
      });
    });

    it('should reject payment method types without calling Recurly', async () => {
      await expect(
        invoices.create({ ...BASE_PARAMS, paymentMethodTypes: ['card'] }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.getAccount).not.toHaveBeenCalled();
      expect(client.createPurchase).not.toHaveBeenCalled();
    });

    it('should throw PaymentFailedError when the transaction is declined', async () => {
      client.createPurchase.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.TransactionError(
            'Transaction declined',
            'transaction',
            {
              transactionError: {
                code: 'declined',
                declineCode: 'do_not_honor',
              },
            },
          ),
          422,
        ),
      );

      await expect(
        invoices.create({ ...BASE_PARAMS, collection: 'charge_automatically' }),
      ).rejects.toMatchObject({
        constructor: PaymentFailedError,
        provider: CashierProvider.Recurly,
        providerCode: 'declined',
        declineCode: 'do_not_honor',
      });
    });

    it('should throw NotFoundError when the account does not exist', async () => {
      client.getAccount.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError(
            "Couldn't find Account",
            'not_found',
            {},
          ),
          404,
        ),
      );

      await expect(invoices.create(BASE_PARAMS)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(client.createPurchase).not.toHaveBeenCalled();
    });

    it('should throw ProviderError when Recurly returns no charge invoice', async () => {
      client.createPurchase.mockResolvedValue({ chargeInvoice: null });

      await expect(invoices.create(BASE_PARAMS)).rejects.toBeInstanceOf(
        ProviderError,
      );
    });
  });

  describe('get with relations', () => {
    it('should map the line items in minor units', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        lineItems: [PLAN_LINE_ITEM, PRORATED_CREDIT_LINE_ITEM],
        hasMoreLineItems: false,
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['lineItems'],
      });

      expect(client.listInvoiceLineItems).not.toHaveBeenCalled();
      expect(invoice).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_INVOICES[0],
        lineItems: [
          EXPECTED_PLAN_LINE_ITEM,
          EXPECTED_PRORATED_CREDIT_LINE_ITEM,
        ],
      });
    });

    it('should list every line item when the invoice has more than it returned', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        lineItems: [PLAN_LINE_ITEM],
        hasMoreLineItems: true,
      });
      client.listInvoiceLineItems.mockReturnValue(
        createRecurlyPager([PLAN_LINE_ITEM, PRORATED_CREDIT_LINE_ITEM]),
      );

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['lineItems'],
      });

      expect(client.listInvoiceLineItems).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        { params: { limit: 200 } },
      );
      expect(invoice.lineItems).toEqual([
        EXPECTED_PLAN_LINE_ITEM,
        EXPECTED_PRORATED_CREDIT_LINE_ITEM,
      ]);
    });

    it('should return no line items when Recurly sent none', async () => {
      client.getInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['lineItems'],
      });

      expect(invoice.lineItems).toEqual([]);
    });

    it('should not list line items without the relation', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        hasMoreLineItems: true,
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID);

      expect(client.listInvoiceLineItems).not.toHaveBeenCalled();
      expect(invoice).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should keep only the purchase and capture transactions as payments', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        transactions: [
          RECURLY_FIXTURES.SUCCESSFUL_TRANSACTION,
          { ...RECURLY_FIXTURES.DECLINED_TRANSACTION, type: 'capture' },
          { ...RECURLY_FIXTURES.REFUNDS[0] },
          { ...RECURLY_FIXTURES.DECLINED_TRANSACTION, type: 'verify' },
        ],
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['payments'],
      });

      expect(invoice.payments).toEqual(RECURLY_FIXTURES.EXPECTED_PAYMENTS);
    });

    it('should return no payments for an invoice without transactions', async () => {
      client.getInvoice.mockResolvedValue(RECURLY_FIXTURES.PAID_INVOICE);

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['payments'],
      });

      expect(invoice.payments).toEqual([]);
    });

    it.each([
      ['paid', 'paid'],
      ['failed', 'failed'],
      ['voided', 'voided'],
    ] as const)(
      'should add the %s event at the close date',
      async (state, type) => {
        client.getInvoice.mockResolvedValue({
          ...RECURLY_FIXTURES.PAID_INVOICE,
          state,
        });

        const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
          with: ['timeline'],
        });

        expect(invoice.timeline).toEqual([
          { type: 'created', at: new Date('2026-01-01T00:00:00Z') },
          { type, at: new Date('2026-01-01T01:00:00Z') },
        ]);
      },
    );

    it('should only add the creation of an open invoice', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        state: 'pending',
        closedAt: null,
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID, {
        with: ['timeline'],
      });

      expect(invoice.timeline).toEqual([
        { type: 'created', at: new Date('2026-01-01T00:00:00Z') },
      ]);
    });

    it('should report the amount paid and remaining from paid and balance', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        paid: 100,
        balance: 49.99,
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID);

      expect(invoice).toMatchObject({
        amountPaid: 10000,
        amountRemaining: 4999,
      });
    });

    it('should default the amount paid and remaining to zero', async () => {
      client.getInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.PAID_INVOICE,
        paid: null,
        balance: null,
      });

      const invoice = await invoices.get(RECURLY_FIXTURES.INVOICE_ID);

      expect(invoice).toMatchObject({ amountPaid: 0, amountRemaining: 0 });
    });
  });

  describe('list by subscription', () => {
    it('should list the subscription invoices', async () => {
      client.listSubscriptionInvoices.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.INVOICES),
      );

      const result = await invoices.list({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        status: 'paid',
      });

      expect(client.listSubscriptionInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { limit: 100, state: 'paid' } },
      );
      expect(client.listAccountInvoices).not.toHaveBeenCalled();
      expect(result).toEqual(RECURLY_FIXTURES.EXPECTED_INVOICES);
    });

    it('should list the subscription invoices when a customer is also given', async () => {
      client.listSubscriptionInvoices.mockReturnValue(createRecurlyPager([]));

      await invoices.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
      });

      expect(client.listSubscriptionInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { limit: 100 } },
      );
      expect(client.listAccountInvoices).not.toHaveBeenCalled();
    });

    it('should paginate the subscription invoices with the cursor', async () => {
      client.listSubscriptionInvoices.mockReturnValue(
        createRecurlyPagePager(
          RECURLY_FIXTURES.INVOICES,
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      const page = await invoices.cursorPaginate({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        perPage: 2,
        cursor: RECURLY_FIXTURES.CURSOR,
      });

      expect(client.listSubscriptionInvoices).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { params: { limit: 2, cursor: RECURLY_FIXTURES.CURSOR } },
      );
      expect(page).toEqual({
        data: RECURLY_FIXTURES.EXPECTED_INVOICES,
        perPage: 2,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });

    it.each([
      ['list', () => invoices.list({} as { customer: string })],
      [
        'cursorPaginate',
        () => invoices.cursorPaginate({} as { customer: string }),
      ],
    ])(
      'should reject %s without a customer or a subscription without calling Recurly',
      async (_method, call) => {
        await expect(call()).rejects.toMatchObject({
          constructor: ValidationError,
          provider: CashierProvider.Recurly,
        });
        expect(client.listAccountInvoices).not.toHaveBeenCalled();
        expect(client.listSubscriptionInvoices).not.toHaveBeenCalled();
      },
    );
  });

  describe('preview', () => {
    const SUBSCRIPTION = {
      ...RECURLY_FIXTURES.ACTIVE_SUBSCRIPTION,
      quantity: 2,
      unitAmount: 10,
      addOns: [
        {
          id: 'addon_1',
          addOn: { name: 'Support' },
          unitAmount: 2.5,
          quantity: 2,
        },
        { id: null, addOn: null, unitAmount: null, quantity: null },
      ],
      subtotal: 25,
      tax: 2.5,
      total: 27.5,
    } as recurly.Subscription;

    const toLineItem = (
      id: string,
      description: string | null,
      amount: number,
      quantity: number,
      unitAmount: number,
      priceId: string | null,
    ) => ({
      id,
      description,
      amount,
      quantity,
      unitAmount,
      priceId,
      subscriptionId: 'rec_sub_1',
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: null,
      proration: false,
    });

    it('should estimate the next renewal from the subscription without a change', async () => {
      client.getSubscription.mockResolvedValue(SUBSCRIPTION);

      const preview = await invoices.preview({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
      });

      expect(client.getSubscription).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
      );
      expect(client.previewSubscriptionChange).not.toHaveBeenCalled();
      expect(preview).toEqual({
        customerId: RECURLY_FIXTURES.ACCOUNT_ID,
        subscriptionId: 'rec_sub_1',
        currency: 'USD',
        subtotal: 2500,
        tax: 250,
        total: 2750,
        amountDue: 2750,
        lineItems: [
          toLineItem('rec_sub_1', 'Pro Monthly', 2000, 2, 1000, 'plan_1'),
          toLineItem('addon_1', 'Support', 500, 2, 250, null),
          toLineItem('', null, 0, 1, 0, null),
        ],
        nextPaymentAt: new Date('2026-02-01T00:00:00Z'),
        provider: CashierProvider.Recurly,
      } satisfies InvoicePreview);
    });

    it('should preview a change now by plan code and map the invoice Recurly would charge', async () => {
      client.getSubscription.mockResolvedValue(SUBSCRIPTION);
      client.previewSubscriptionChange.mockResolvedValue({
        invoiceCollection: {
          chargeInvoice: {
            ...RECURLY_FIXTURES.PAID_INVOICE,
            subtotal: 75,
            tax: 7.5,
            total: 82.5,
            balance: 80,
            dueAt: new Date('2026-01-20T00:00:00Z'),
            lineItems: [PLAN_LINE_ITEM, PRORATED_CREDIT_LINE_ITEM],
          },
        },
      });

      const preview = await invoices.preview({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        price: RECURLY_FIXTURES.PLAN_CODE_REFERENCE,
        quantity: 3,
        proration: 'prorate',
      });

      expect(client.previewSubscriptionChange).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        { timeframe: 'now', planCode: 'pro-monthly', quantity: 3 },
      );
      expect(preview).toEqual({
        customerId: RECURLY_FIXTURES.ACCOUNT_ID,
        subscriptionId: 'rec_sub_1',
        currency: 'USD',
        subtotal: 7500,
        tax: 750,
        total: 8250,
        amountDue: 8000,
        lineItems: [
          EXPECTED_PLAN_LINE_ITEM,
          EXPECTED_PRORATED_CREDIT_LINE_ITEM,
        ],
        nextPaymentAt: new Date('2026-01-20T00:00:00Z'),
        provider: CashierProvider.Recurly,
      } satisfies InvoicePreview);
    });

    it('should use the total as the amount due when the charge invoice has no balance', async () => {
      client.getSubscription.mockResolvedValue(SUBSCRIPTION);
      client.previewSubscriptionChange.mockResolvedValue({
        invoiceCollection: {
          chargeInvoice: {
            ...RECURLY_FIXTURES.PAID_INVOICE,
            balance: null,
            dueAt: null,
          },
        },
      });

      const preview = await invoices.preview({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        quantity: 3,
      });

      expect(preview).toMatchObject({
        amountDue: 14999,
        lineItems: [],
        nextPaymentAt: null,
      });
    });

    it('should estimate the next renewal from the change without proration when there is no charge invoice', async () => {
      client.getSubscription.mockResolvedValue(SUBSCRIPTION);
      client.previewSubscriptionChange.mockResolvedValue({
        plan: { id: 'plan_2', name: 'Pro Legacy' },
        unitAmount: 20,
        quantity: 1,
        addOns: [],
        invoiceCollection: null,
      });

      const preview = await invoices.preview({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        price: 'plan_2',
        proration: 'none',
      });

      expect(client.previewSubscriptionChange).toHaveBeenCalledWith(
        RECURLY_FIXTURES.SUBSCRIPTION_ID,
        {
          timeframe: 'now',
          planId: 'plan_2',
          prorationSettings: { charge: 'none', credit: 'none' },
        },
      );
      expect(preview).toEqual({
        customerId: RECURLY_FIXTURES.ACCOUNT_ID,
        subscriptionId: 'rec_sub_1',
        currency: 'USD',
        subtotal: 2000,
        tax: 0,
        total: 2000,
        amountDue: 2000,
        lineItems: [
          toLineItem('rec_sub_1', 'Pro Legacy', 2000, 1, 2000, 'plan_2'),
        ],
        nextPaymentAt: new Date('2026-02-01T00:00:00Z'),
        provider: CashierProvider.Recurly,
      } satisfies InvoicePreview);
    });

    it('should keep the subscription plan, quantity and add-ons the change leaves out', async () => {
      client.getSubscription.mockResolvedValue(SUBSCRIPTION);
      client.previewSubscriptionChange.mockResolvedValue({});

      const preview = await invoices.preview({
        subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID,
        quantity: 2,
      });

      expect(preview).toMatchObject({ subtotal: 2500, tax: 0, total: 2500 });
      expect(preview.lineItems).toHaveLength(3);
    });

    it('should map a missing subscription to NotFoundError', async () => {
      client.getSubscription.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        invoices.preview({ subscription: RECURLY_FIXTURES.SUBSCRIPTION_ID }),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Recurly,
      });
    });
  });
});
