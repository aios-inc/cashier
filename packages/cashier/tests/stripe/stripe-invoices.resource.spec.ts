import Stripe from 'stripe';
import { StripeInvoicesResource } from '../../src/drivers/stripe/resources/stripe-invoices.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { STRIPE_FIXTURES } from '../fixtures/stripe.fixtures';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
  createStripeMissingResourceError,
} from '../fixtures/stripe-client.mock';
import { CashierProvider } from '../../src/types/cashier.types';
import { CreateInvoiceParams } from '../../src/types/invoice.types';

describe('StripeInvoicesResource', () => {
  let client: StripeClientMock;
  let invoices: StripeInvoicesResource;

  beforeEach(() => {
    client = createStripeClientMock();
    invoices = new StripeInvoicesResource(asStripeClient(client));
  });

  describe('get', () => {
    it('should retrieve and map the invoice', async () => {
      client.invoices.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );

      const invoice = await invoices.get(STRIPE_FIXTURES.INVOICE_ID);

      expect(client.invoices.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
      );
      expect(invoice).toEqual(STRIPE_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should expand the charge and add the refunded amount with refunds', async () => {
      client.invoices.retrieve.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );

      const invoice = await invoices.get(STRIPE_FIXTURES.INVOICE_ID, {
        with: ['refunds'],
      });

      expect(client.invoices.retrieve).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        { expand: ['charge'] },
      );
      expect(invoice).toEqual({
        ...STRIPE_FIXTURES.EXPECTED_INVOICES[0],
        amountRefunded: 5000,
      });
    });

    it('should reject a relation Stripe does not support without calling Stripe', async () => {
      await expect(
        invoices.get(STRIPE_FIXTURES.INVOICE_ID, {
          with: ['payments' as 'refunds'],
        }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(client.invoices.retrieve).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when the invoice does not exist', async () => {
      client.invoices.retrieve.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        invoices.get(STRIPE_FIXTURES.INVOICE_ID),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Stripe,
        providerStatus: 404,
        providerCode: 'resource_missing',
      });
    });
  });

  describe('list', () => {
    it('should request invoices with the default limit and status filter', async () => {
      client.invoices.list.mockResolvedValue({ data: [] });

      await invoices.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        status: 'paid',
      });

      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
        status: 'paid',
      });
    });

    it('should omit the status filter when none is given', async () => {
      client.invoices.list.mockResolvedValue({ data: [] });

      await invoices.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID, limit: 10 });

      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 10,
      });
    });

    it('should map every invoice', async () => {
      client.invoices.list.mockResolvedValue({
        data: STRIPE_FIXTURES.INVOICES,
      });

      const result = await invoices.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(result).toEqual(STRIPE_FIXTURES.EXPECTED_INVOICES);
    });

    it('should expand the charges and add the refunded amounts with refunds', async () => {
      client.invoices.list.mockResolvedValue({
        data: STRIPE_FIXTURES.INVOICES,
      });

      const result = await invoices.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['refunds'],
      });

      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
        expand: ['data.charge'],
      });
      expect(result.map((invoice) => invoice.amountRefunded)).toEqual([
        5000, 0,
      ]);
    });

    it('should count no refund when the charge is not expanded and no hosted url when it is missing', async () => {
      client.invoices.list.mockResolvedValue({
        data: [
          {
            ...STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
            charge: 'ch_123',
            hosted_invoice_url: undefined,
          },
        ],
      });

      const [invoice] = await invoices.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: ['refunds'],
      });

      expect(invoice).toMatchObject({
        amountRefunded: 0,
        hostedInvoiceUrl: null,
      });
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page with the status filter', async () => {
      client.invoices.list.mockResolvedValue({
        data: STRIPE_FIXTURES.INVOICES,
        has_more: true,
      });

      const page = await invoices.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        status: 'paid',
        perPage: 2,
        with: ['refunds'],
      });

      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 2,
        status: 'paid',
        expand: ['data.charge'],
      });
      expect(page).toEqual({
        data: [
          { ...STRIPE_FIXTURES.EXPECTED_INVOICES[0], amountRefunded: 5000 },
          { ...STRIPE_FIXTURES.EXPECTED_INVOICES[1], amountRefunded: 0 },
        ],
        perPage: 2,
        hasMorePages: true,
        nextCursor: 'in_456',
      });
    });

    it('should request the page after the cursor', async () => {
      client.invoices.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION_INVOICE],
        has_more: true,
      });

      const page = await invoices.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        perPage: 1,
        cursor: 'in_000',
      });

      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 1,
        starting_after: 'in_000',
      });
      expect(page.nextCursor).toBe(STRIPE_FIXTURES.INVOICE_ID);
    });

    it('should return no next cursor on the last page', async () => {
      client.invoices.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUBSCRIPTION_INVOICE],
        has_more: false,
      });

      const page = await invoices.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(page).toEqual({
        data: [STRIPE_FIXTURES.EXPECTED_INVOICES[0]],
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });
  });

  describe('pay', () => {
    it('should pay the invoice with the given payment method', async () => {
      client.invoices.pay.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );

      const invoice = await invoices.pay(STRIPE_FIXTURES.INVOICE_ID, {
        paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
      });

      expect(client.invoices.pay).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        { payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID },
      );
      expect(invoice).toEqual(STRIPE_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should pay the invoice with the default payment method when none is given', async () => {
      client.invoices.pay.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );

      await invoices.pay(STRIPE_FIXTURES.INVOICE_ID);

      expect(client.invoices.pay).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
      );
    });
  });

  describe('void', () => {
    it('should void and map the invoice', async () => {
      client.invoices.voidInvoice.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );

      const invoice = await invoices.void(STRIPE_FIXTURES.INVOICE_ID);

      expect(client.invoices.voidInvoice).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
      );
      expect(invoice).toEqual(STRIPE_FIXTURES.EXPECTED_INVOICES[0]);
    });
  });
  describe('create', () => {
    const NOW = new Date('2026-01-01T00:00:00Z');
    const DRAFT_INVOICE = {
      ...STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      status: 'draft',
    } as Stripe.Invoice;
    const OPEN_INVOICE = {
      ...STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      status: 'open',
      status_transitions: { paid_at: null },
    } as unknown as Stripe.Invoice;
    const BASE_PARAMS: CreateInvoiceParams = {
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      currency: 'EUR',
      lineItems: [
        { description: 'Consultation', amount: 1999 },
        { description: '', amount: 500 },
      ],
      collection: 'send_invoice',
      description: 'Clinic visit',
      metadata: { order: 'order-42' },
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
      client.invoices.create.mockResolvedValue(DRAFT_INVOICE);
      client.invoiceItems.create.mockResolvedValue({ id: 'ii_123' });
      client.invoices.finalizeInvoice.mockResolvedValue(OPEN_INVOICE);
      client.invoices.pay.mockResolvedValue(
        STRIPE_FIXTURES.SUBSCRIPTION_INVOICE,
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const BASE_STRIPE_PARAMS = {
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      currency: 'eur',
      pending_invoice_items_behavior: 'exclude',
      description: 'Clinic visit',
      metadata: { order: 'order-42' },
    };

    it.each([
      [
        'charges now',
        { collection: 'charge_automatically', chargeNow: true },
        {
          collection_method: 'charge_automatically',
          auto_advance: false,
          default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        },
      ],
      [
        'charges automatically later',
        { collection: 'charge_automatically' },
        {
          collection_method: 'charge_automatically',
          auto_advance: true,
          default_payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        },
      ],
      [
        'sends the invoice with a due date',
        {
          collection: 'send_invoice',
          dueDate: new Date('2026-01-15T00:00:00Z'),
        },
        {
          collection_method: 'send_invoice',
          auto_advance: true,
          due_date: 1768435200,
        },
      ],
      [
        'sends the invoice with days until due',
        { collection: 'send_invoice', daysUntilDue: 14 },
        {
          collection_method: 'send_invoice',
          auto_advance: true,
          days_until_due: 14,
        },
      ],
      [
        'sends the invoice due in 30 days by default',
        { collection: 'send_invoice' },
        {
          collection_method: 'send_invoice',
          auto_advance: true,
          days_until_due: 30,
        },
      ],
    ] as const)(
      'should create the invoice when it %s',
      async (_case, overrides, expected) => {
        await invoices.create({
          ...BASE_PARAMS,
          paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
          ...overrides,
        });

        expect(client.invoices.create).toHaveBeenCalledWith({
          ...BASE_STRIPE_PARAMS,
          ...expected,
        });
      },
    );

    it('should restrict the payment method types when given', async () => {
      await invoices.create({
        ...BASE_PARAMS,
        paymentMethodTypes: ['card', 'customer_balance'],
      });

      expect(client.invoices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_settings: {
            payment_method_types: ['card', 'customer_balance'],
          },
        }),
      );
    });

    it('should create one invoice item per line item in the given currency', async () => {
      await invoices.create(BASE_PARAMS);

      expect(client.invoiceItems.create).toHaveBeenCalledTimes(2);
      expect(client.invoiceItems.create).toHaveBeenNthCalledWith(1, {
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        invoice: STRIPE_FIXTURES.INVOICE_ID,
        amount: 1999,
        currency: 'eur',
        description: 'Consultation',
        metadata: { order: 'order-42' },
      });
      expect(client.invoiceItems.create).toHaveBeenNthCalledWith(2, {
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        invoice: STRIPE_FIXTURES.INVOICE_ID,
        amount: 500,
        currency: 'eur',
        description: 'Clinic visit',
        metadata: { order: 'order-42' },
      });
    });

    it('should finalize and return the open invoice without paying it', async () => {
      const invoice = await invoices.create(BASE_PARAMS);

      expect(client.invoices.finalizeInvoice).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
      );
      expect(client.invoices.pay).not.toHaveBeenCalled();
      expect(invoice).toEqual({
        ...STRIPE_FIXTURES.EXPECTED_INVOICES[0],
        status: 'open',
        paidAt: null,
      });
      expect(invoice.hostedInvoiceUrl).toBe(
        'https://invoice.stripe.com/i/in_123',
      );
    });

    it('should pay the finalized invoice and return the paid invoice when charging now', async () => {
      const invoice = await invoices.create({
        ...BASE_PARAMS,
        collection: 'charge_automatically',
        chargeNow: true,
      });

      expect(client.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
      expect(client.invoices.pay).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
      );
      expect(invoice).toEqual(STRIPE_FIXTURES.EXPECTED_INVOICES[0]);
    });

    it('should derive an idempotency key for every step', async () => {
      await invoices.create({
        ...BASE_PARAMS,
        collection: 'charge_automatically',
        chargeNow: true,
        idempotencyKey: 'order-42',
      });

      expect(client.invoices.create).toHaveBeenCalledWith(expect.any(Object), {
        idempotencyKey: 'order-42-invoice',
      });
      expect(client.invoiceItems.create).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        { idempotencyKey: 'order-42-item-0' },
      );
      expect(client.invoiceItems.create).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        { idempotencyKey: 'order-42-item-1' },
      );
      expect(client.invoices.finalizeInvoice).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
        { idempotencyKey: 'order-42-finalize' },
      );
      expect(client.invoices.pay).toHaveBeenCalledWith(
        STRIPE_FIXTURES.INVOICE_ID,
        {},
        { idempotencyKey: 'order-42-pay' },
      );
    });

    it('should not pass request options without an idempotency key', async () => {
      await invoices.create(BASE_PARAMS);

      expect(client.invoices.create.mock.calls[0]).toHaveLength(1);
      expect(client.invoiceItems.create.mock.calls[0]).toHaveLength(1);
      expect(client.invoices.finalizeInvoice.mock.calls[0]).toHaveLength(2);
    });

    it('should throw PaymentFailedError when the card is declined while charging now', async () => {
      client.invoices.pay.mockRejectedValue(
        new Stripe.errors.StripeCardError({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          message: 'Your card was declined.',
          statusCode: 402,
        } as Stripe.StripeRawError),
      );

      await expect(
        invoices.create({
          ...BASE_PARAMS,
          collection: 'charge_automatically',
          chargeNow: true,
        }),
      ).rejects.toMatchObject({
        constructor: PaymentFailedError,
        provider: CashierProvider.Stripe,
        providerCode: 'card_declined',
        declineCode: 'insufficient_funds',
      });
    });

    it('should throw NotFoundError when the customer does not exist', async () => {
      client.invoices.create.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(invoices.create(BASE_PARAMS)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(client.invoiceItems.create).not.toHaveBeenCalled();
    });
  });
});
