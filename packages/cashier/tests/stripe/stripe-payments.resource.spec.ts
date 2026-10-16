import Stripe from 'stripe';
import { StripePaymentsResource } from '../../src/drivers/stripe/resources/stripe-payments.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { STRIPE_FIXTURES } from '../fixtures/stripe.fixtures';
import {
  StripeClientMock,
  asStripeClient,
  createStripeClientMock,
  createStripeMissingResourceError,
} from '../fixtures/stripe-client.mock';
import { CashierProvider } from '../../src/types/cashier.types';
import { RefundReason } from '../../src/types/payment.types';

const RELATIONS = [
  'refunds',
  'dispute',
  'receipt',
  'reversal',
  'subscription',
] as const;

const createInvalidRequestError = (code: string, message: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code,
    message,
    statusCode: 400,
  } as Stripe.StripeRawError);

const EXPAND = [
  'data.latest_charge',
  'data.latest_charge.dispute',
  'data.latest_charge.refunds',
  'data.invoice.subscription',
];

describe('StripePaymentsResource', () => {
  let client: StripeClientMock;
  let payments: StripePaymentsResource;

  const mapOne = async (overrides: Record<string, unknown>) => {
    client.paymentIntents.list.mockResolvedValue({
      data: [{ ...STRIPE_FIXTURES.SUCCEEDED_PAYMENT_INTENT, ...overrides }],
    });

    const [payment] = await payments.list({
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      with: RELATIONS,
    });

    return payment;
  };

  const withCharge = (overrides: Record<string, unknown>) =>
    mapOne({
      latest_charge: { ...STRIPE_FIXTURES.REFUNDED_CHARGE, ...overrides },
    });

  const withSubscription = (overrides: Record<string, unknown>) =>
    mapOne({
      invoice: {
        id: STRIPE_FIXTURES.INVOICE_ID,
        subscription: { ...STRIPE_FIXTURES.SUBSCRIPTION, ...overrides },
      },
    });

  beforeEach(() => {
    client = createStripeClientMock();
    payments = new StripePaymentsResource(asStripeClient(client));
  });

  describe('list', () => {
    it('should request payment intents with the default limit and no expansions', async () => {
      client.paymentIntents.list.mockResolvedValue({ data: [] });

      await payments.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
      });
    });

    it('should pass the given limit', async () => {
      client.paymentIntents.list.mockResolvedValue({ data: [] });

      await payments.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID, limit: 10 });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 10,
      });
    });

    it('should map every payment intent without relation fields by default', async () => {
      client.paymentIntents.list.mockResolvedValue({
        data: STRIPE_FIXTURES.PAYMENT_INTENTS,
      });

      const result = await payments.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
      });

      expect(result).toEqual(STRIPE_FIXTURES.EXPECTED_PAYMENTS);
    });

    it('should expand and map every relation, including missing and unexpanded charges and invoices', async () => {
      client.paymentIntents.list.mockResolvedValue({
        data: STRIPE_FIXTURES.PAYMENT_INTENTS,
      });

      const result = await payments.list({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        with: RELATIONS,
      });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
        expand: EXPAND,
      });
      expect(result).toEqual(STRIPE_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS);
    });

    it.each([
      ['refunds', ['data.latest_charge'], 'amountRefunded'],
      ['dispute', ['data.latest_charge.dispute'], 'dispute'],
      ['receipt', ['data.latest_charge'], 'receiptUrl'],
      ['reversal', ['data.latest_charge.refunds'], 'reversed'],
      ['subscription', ['data.invoice.subscription'], 'subscription'],
    ] as const)(
      'should only expand and add what the %s relation needs',
      async (relation, expand, field) => {
        client.paymentIntents.list.mockResolvedValue({
          data: [STRIPE_FIXTURES.SUCCEEDED_PAYMENT_INTENT],
        });

        const [payment] = await payments.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          with: [relation],
        });

        expect(client.paymentIntents.list).toHaveBeenCalledWith({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          limit: 100,
          expand,
        });
        expect(payment).toEqual({
          ...STRIPE_FIXTURES.EXPECTED_PAYMENTS[0],
          [field]: STRIPE_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS[0]?.[field],
        });
      },
    );

    it('should reject a relation Stripe does not support without calling Stripe', async () => {
      await expect(
        payments.list({
          customer: STRIPE_FIXTURES.CUSTOMER_ID,
          with: ['charges' as 'refunds'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Stripe,
      });
      expect(client.paymentIntents.list).not.toHaveBeenCalled();
    });

    it.each([
      ['processing', 'pending'],
      ['requires_capture', 'pending'],
      ['requires_confirmation', 'incomplete'],
      ['requires_payment_method', 'incomplete'],
      ['canceled', 'canceled'],
      ['some_new_status', 'unknown'],
    ])('should map the %s status to %s', async (stripeStatus, status) => {
      const payment = await mapOne({ status: stripeStatus });

      expect(payment?.status).toBe(status);
    });

    it('should throw NotFoundError when the customer does not exist', async () => {
      client.paymentIntents.list.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        payments.list({ customer: STRIPE_FIXTURES.CUSTOMER_ID }),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Stripe,
        providerStatus: 404,
      });
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page without a cursor', async () => {
      client.paymentIntents.list.mockResolvedValue({
        data: STRIPE_FIXTURES.PAYMENT_INTENTS,
        has_more: true,
      });

      const page = await payments.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        perPage: 3,
        with: RELATIONS,
      });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 3,
        expand: EXPAND,
      });
      expect(page).toEqual({
        data: STRIPE_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS,
        perPage: 3,
        hasMorePages: true,
        nextCursor: 'pi_789',
      });
    });

    it('should request the page after the cursor', async () => {
      client.paymentIntents.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUCCEEDED_PAYMENT_INTENT],
        has_more: true,
      });

      const page = await payments.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        perPage: 1,
        cursor: 'pi_000',
      });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 1,
        starting_after: 'pi_000',
      });
      expect(page.nextCursor).toBe(STRIPE_FIXTURES.PAYMENT_CURSOR);
    });

    it('should return no next cursor on the last page', async () => {
      client.paymentIntents.list.mockResolvedValue({
        data: [STRIPE_FIXTURES.SUCCEEDED_PAYMENT_INTENT],
        has_more: false,
      });

      const page = await payments.cursorPaginate({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        cursor: null,
      });

      expect(client.paymentIntents.list).toHaveBeenCalledWith({
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        limit: 100,
      });
      expect(page).toMatchObject({
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });

    it('should throw NotFoundError when the customer does not exist', async () => {
      client.paymentIntents.list.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        payments.cursorPaginate({ customer: STRIPE_FIXTURES.CUSTOMER_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('dispute', () => {
    it('should be null when the charge has no dispute', async () => {
      const payment = await withCharge({ dispute: null });

      expect(payment?.dispute).toBeNull();
    });

    it('should be null when the dispute is not expanded', async () => {
      const payment = await withCharge({ dispute: 'dp_123' });

      expect(payment?.dispute).toBeNull();
    });

    it('should map an unknown dispute status to unknown and a missing due date to null', async () => {
      const payment = await withCharge({
        dispute: {
          ...STRIPE_FIXTURES.DISPUTE,
          status: 'prevented',
          evidence_details: { due_by: null },
        },
      });

      expect(payment?.dispute).toMatchObject({
        status: 'unknown',
        evidenceDueBy: null,
      });
    });
  });

  describe('reversed', () => {
    it.each([
      ['the refunds are not expanded', { refunds: null }],
      ['there are no refunds', { refunds: { data: [] } }],
      [
        'no refund is a card reversal',
        { refunds: { data: [{ id: 're_1', destination_details: null }] } },
      ],
    ])('should be false when %s', async (_case, charge) => {
      const payment = await withCharge(charge);

      expect(payment?.reversed).toBe(false);
    });
  });

  describe('subscription', () => {
    it('should use cancel_at when the subscription is scheduled to cancel', async () => {
      const payment = await withSubscription({
        cancel_at: 1768262400,
        cancel_at_period_end: false,
      });

      expect(payment?.subscription).toEqual({
        id: STRIPE_FIXTURES.SUBSCRIPTION_ID,
        status: 'active',
        cancelAt: new Date(1768262400 * 1000),
      });
    });

    it('should have no cancelAt when the subscription is not canceling', async () => {
      const payment = await withSubscription({
        cancel_at: null,
        cancel_at_period_end: false,
      });

      expect(payment?.subscription?.cancelAt).toBeNull();
    });

    it('should be null when the invoice has no subscription', async () => {
      const payment = await mapOne({
        invoice: { id: STRIPE_FIXTURES.INVOICE_ID, subscription: null },
      });

      expect(payment?.subscription).toBeNull();
    });

    it('should be null when the invoice is not expanded', async () => {
      const payment = await mapOne({ invoice: STRIPE_FIXTURES.INVOICE_ID });

      expect(payment?.subscription).toBeNull();
      expect(payment?.invoiceId).toBe(STRIPE_FIXTURES.INVOICE_ID);
    });
  });

  describe('create', () => {
    const PARAMS = {
      customer: STRIPE_FIXTURES.CUSTOMER_ID,
      currency: 'EUR',
      amount: 12900,
      paymentMethod: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
      description: 'Wegovy 0.5mg',
      metadata: { order: 'order-42' },
    };

    beforeEach(() => {
      client.paymentIntents.create.mockResolvedValue(
        STRIPE_FIXTURES.SUCCEEDED_PAYMENT_INTENT,
      );
    });

    it('should confirm an off-session payment intent limited to card and link', async () => {
      await payments.create(PARAMS);

      expect(client.paymentIntents.create).toHaveBeenCalledWith({
        amount: 12900,
        currency: 'eur',
        customer: STRIPE_FIXTURES.CUSTOMER_ID,
        payment_method: STRIPE_FIXTURES.PAYMENT_METHOD_ID,
        payment_method_types: ['card', 'link'],
        confirm: true,
        off_session: true,
        description: 'Wegovy 0.5mg',
        metadata: { order: 'order-42' },
      });
    });

    it('should pass the idempotency key as is', async () => {
      await payments.create({ ...PARAMS, idempotencyKey: 'order-42' });

      expect(client.paymentIntents.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'order-42' },
      );
    });

    it('should return a payment whose id can be refunded', async () => {
      client.refunds.create.mockResolvedValue(STRIPE_FIXTURES.REFUND);

      const payment = await payments.create(PARAMS);
      await payments.refund(payment.id);

      expect(payment).toEqual(STRIPE_FIXTURES.EXPECTED_PAYMENTS[0]);
      expect(client.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_123',
      });
    });

    it('should return an incomplete payment when it requires action', async () => {
      client.paymentIntents.create.mockResolvedValue(
        STRIPE_FIXTURES.PAYMENT_INTENTS[2],
      );

      const payment = await payments.create(PARAMS);

      expect(payment.status).toBe('incomplete');
    });

    it('should throw PaymentFailedError when the card is declined', async () => {
      client.paymentIntents.create.mockRejectedValue(
        new Stripe.errors.StripeCardError({
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          message: 'Your card was declined.',
          statusCode: 402,
        } as Stripe.StripeRawError),
      );

      await expect(payments.create(PARAMS)).rejects.toMatchObject({
        constructor: PaymentFailedError,
        provider: CashierProvider.Stripe,
        providerStatus: 402,
        providerCode: 'card_declined',
        declineCode: 'insufficient_funds',
      });
    });
  });

  describe('refund', () => {
    const refundWith = async (overrides: Record<string, unknown>) => {
      client.refunds.create.mockResolvedValue({
        ...STRIPE_FIXTURES.REFUND,
        ...overrides,
      });

      return payments.refund(STRIPE_FIXTURES.PAYMENT_ID);
    };

    beforeEach(() => {
      client.refunds.create.mockResolvedValue(STRIPE_FIXTURES.REFUND);
    });

    it('should refund what is left of the payment intent when no amount is given', async () => {
      const refund = await payments.refund(STRIPE_FIXTURES.PAYMENT_ID);

      expect(client.refunds.create).toHaveBeenCalledWith({
        payment_intent: STRIPE_FIXTURES.PAYMENT_ID,
      });
      expect(refund).toEqual(STRIPE_FIXTURES.EXPECTED_REFUND);
    });

    it('should refund part of the payment intent with the amount in minor units', async () => {
      await payments.refund(STRIPE_FIXTURES.PAYMENT_ID, { amount: 5000 });

      expect(client.refunds.create).toHaveBeenCalledWith({
        payment_intent: STRIPE_FIXTURES.PAYMENT_ID,
        amount: 5000,
      });
    });

    it('should pass an amount of 0 to Stripe instead of refunding in full', async () => {
      await payments.refund(STRIPE_FIXTURES.PAYMENT_ID, { amount: 0 });

      expect(client.refunds.create).toHaveBeenCalledWith({
        payment_intent: STRIPE_FIXTURES.PAYMENT_ID,
        amount: 0,
      });
    });

    it.each([
      [RefundReason.Duplicate, 'duplicate'],
      [RefundReason.Fraudulent, 'fraudulent'],
      [RefundReason.RequestedByCustomer, 'requested_by_customer'],
    ])(
      'should pass %s to Stripe as the %s reason, with the metadata',
      async (reason, stripeReason) => {
        await payments.refund(STRIPE_FIXTURES.PAYMENT_ID, {
          amount: 5000,
          reason,
          metadata: { customer: 'customer-42' },
        });

        expect(client.refunds.create).toHaveBeenCalledWith({
          payment_intent: STRIPE_FIXTURES.PAYMENT_ID,
          amount: 5000,
          reason: stripeReason,
          metadata: { customer: 'customer-42' },
        });
      },
    );

    it('should pass the metadata to Stripe without a reason', async () => {
      await payments.refund(STRIPE_FIXTURES.PAYMENT_ID, {
        metadata: { customer: 'customer-42' },
      });

      expect(client.refunds.create).toHaveBeenCalledWith({
        payment_intent: STRIPE_FIXTURES.PAYMENT_ID,
        metadata: { customer: 'customer-42' },
      });
    });

    it.each([
      [RefundReason.Duplicate, 'duplicate'],
      [RefundReason.Fraudulent, 'fraudulent'],
      [RefundReason.RequestedByCustomer, 'requested_by_customer'],
      [null, 'expired_uncaptured_charge'],
      [null, null],
    ])(
      'should map the reason to %s when Stripe has %s',
      async (reason, stripeReason) => {
        const refund = await refundWith({ reason: stripeReason });

        expect(refund.reason).toBe(reason);
      },
    );

    it('should read the payment id from an expanded payment intent', async () => {
      const refund = await refundWith({
        payment_intent: { id: STRIPE_FIXTURES.PAYMENT_ID },
      });

      expect(refund.paymentId).toBe(STRIPE_FIXTURES.PAYMENT_ID);
    });

    it.each([
      ['succeeded', 'succeeded'],
      ['pending', 'pending'],
      ['requires_action', 'pending'],
      ['failed', 'failed'],
      ['canceled', 'canceled'],
      ['some_new_status', 'unknown'],
      [null, 'unknown'],
    ])('should map the %s status to %s', async (stripeStatus, status) => {
      const refund = await refundWith({ status: stripeStatus });

      expect(refund.status).toBe(status);
    });

    it('should throw NotFoundError when the payment intent does not exist', async () => {
      client.refunds.create.mockRejectedValue(
        createStripeMissingResourceError(),
      );

      await expect(
        payments.refund(STRIPE_FIXTURES.PAYMENT_ID),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Stripe,
        providerCode: 'resource_missing',
      });
    });

    it.each([
      [
        'the payment intent is already refunded',
        'charge_already_refunded',
        'Charge ch_123 has already been refunded.',
      ],
      [
        'the amount is more than what is left',
        'amount_too_large',
        'Refund amount is greater than unrefunded amount on charge.',
      ],
    ])('should throw ValidationError when %s', async (_case, code, message) => {
      client.refunds.create.mockRejectedValue(
        createInvalidRequestError(code, message),
      );

      await expect(
        payments.refund(STRIPE_FIXTURES.PAYMENT_ID, { amount: 99999 }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Stripe,
        providerCode: code,
        message,
      });
    });
  });
});
