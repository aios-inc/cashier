import * as recurly from 'recurly';
import { RecurlyPaymentsResource } from '../../src/drivers/recurly/resources/recurly-payments.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentFailedError } from '../../src/errors/payment-failed.error';
import { ProviderError } from '../../src/errors/provider.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import { RefundReason } from '../../src/types/payment.types';
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

const RELATIONS = ['refunds', 'subscription'] as const;

describe('RecurlyPaymentsResource', () => {
  let client: RecurlyClientMock;
  let payments: RecurlyPaymentsResource;

  beforeEach(() => {
    client = createRecurlyClientMock();
    payments = new RecurlyPaymentsResource(asRecurlyClient(client));
  });

  describe('list', () => {
    it('should request the account payment transactions with the limit', async () => {
      client.listAccountTransactions.mockReturnValue(createRecurlyPager([]));

      await payments.list({ customer: RECURLY_FIXTURES.ACCOUNT_ID });

      expect(client.listAccountTransactions).toHaveBeenCalledTimes(1);
      expect(client.listAccountTransactions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 100, type: 'payment' } },
      );
    });

    it('should map every transaction in minor units without relation fields by default', async () => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS),
      );

      const result = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(client.listAccountTransactions).toHaveBeenCalledTimes(1);
      expect(result).toEqual(RECURLY_FIXTURES.EXPECTED_PAYMENTS);
    });

    it('should add the refunded amounts and subscriptions with relations', async () => {
      client.listAccountTransactions
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS))
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.REFUNDS));

      const result = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: RELATIONS,
      });

      expect(result).toEqual(RECURLY_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS);
    });

    it('should list refunds created since the oldest refunded payment', async () => {
      client.listAccountTransactions
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS))
        .mockReturnValueOnce(createRecurlyPager([]));

      const [payment] = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['refunds'],
      });

      expect(client.listAccountTransactions).toHaveBeenLastCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          params: {
            limit: 200,
            type: 'refund',
            beginTime: new Date('2026-01-01T00:00:00Z'),
          },
        },
      );
      expect(payment?.amountRefunded).toBe(0);
    });

    it('should not list refunds when no payment was refunded', async () => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPager([RECURLY_FIXTURES.TRANSACTIONS[1]]),
      );

      const result = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: RELATIONS,
      });

      expect(client.listAccountTransactions).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        RECURLY_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS[1],
      ]);
    });

    it('should not list refunds when only the subscription is loaded', async () => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS),
      );

      const [payment] = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        with: ['subscription'],
      });

      expect(client.listAccountTransactions).toHaveBeenCalledTimes(1);
      expect(payment).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_PAYMENTS[0],
        subscription: { id: 'rec_sub_1', status: null, cancelAt: null },
      });
    });

    it.each(['dispute', 'receipt', 'reversal'])(
      'should reject the %s relation without calling Recurly',
      async (relation) => {
        await expect(
          payments.list({
            customer: RECURLY_FIXTURES.ACCOUNT_ID,
            with: [relation as 'refunds'],
          }),
        ).rejects.toMatchObject({
          constructor: UnsupportedOperationError,
          provider: CashierProvider.Recurly,
        });
        expect(client.listAccountTransactions).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['pending', 'pending'],
      ['processing', 'pending'],
      ['scheduled', 'pending'],
      ['error', 'failed'],
      ['void', 'canceled'],
      ['chargeback', 'unknown'],
    ])('should map the %s status to %s', async (recurlyStatus, status) => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPager([
          { ...RECURLY_FIXTURES.TRANSACTIONS[1], status: recurlyStatus },
        ]),
      );

      const [payment] = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(payment?.status).toBe(status);
    });

    it('should stop reading pages once the limit is reached', async () => {
      client.listAccountTransactions
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS))
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.REFUNDS));

      const result = await payments.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        limit: 1,
        with: RELATIONS,
      });

      expect(result).toEqual([
        RECURLY_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS[0],
      ]);
    });

    it('should map failures raised while paging', async () => {
      client.listAccountTransactions.mockReturnValue(
        createFailingRecurlyPager(new Error('Network down')),
      );

      await expect(
        payments.list({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it('should map failures raised while listing refunds', async () => {
      client.listAccountTransactions
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.TRANSACTIONS))
        .mockReturnValueOnce(
          createFailingRecurlyPager(new Error('Network down')),
        );

      await expect(
        payments.list({
          customer: RECURLY_FIXTURES.ACCOUNT_ID,
          with: RELATIONS,
        }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('cursorPaginate', () => {
    it('should request the first page and return the next cursor', async () => {
      client.listAccountTransactions
        .mockReturnValueOnce(
          createRecurlyPagePager(
            RECURLY_FIXTURES.TRANSACTIONS,
            RECURLY_FIXTURES.NEXT_PATH,
          ),
        )
        .mockReturnValueOnce(createRecurlyPager(RECURLY_FIXTURES.REFUNDS));

      const page = await payments.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        perPage: 2,
        with: RELATIONS,
      });

      expect(client.listAccountTransactions).toHaveBeenNthCalledWith(
        1,
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 2, type: 'payment' } },
      );
      expect(page).toEqual({
        data: RECURLY_FIXTURES.EXPECTED_PAYMENTS_WITH_RELATIONS,
        perPage: 2,
        hasMorePages: true,
        nextCursor: RECURLY_FIXTURES.CURSOR,
      });
    });

    it('should pass the cursor to Recurly', async () => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPagePager(
          [RECURLY_FIXTURES.TRANSACTIONS[1]],
          RECURLY_FIXTURES.NEXT_PATH,
        ),
      );

      await payments.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        perPage: 2,
        cursor: RECURLY_FIXTURES.CURSOR,
      });

      expect(client.listAccountTransactions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          params: {
            limit: 2,
            type: 'payment',
            cursor: RECURLY_FIXTURES.CURSOR,
          },
        },
      );
    });

    it('should return no next cursor on the last page', async () => {
      client.listAccountTransactions.mockReturnValue(
        createRecurlyPagePager([RECURLY_FIXTURES.TRANSACTIONS[1]]),
      );

      const page = await payments.cursorPaginate({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        cursor: null,
      });

      expect(client.listAccountTransactions).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 100, type: 'payment' } },
      );
      expect(page).toEqual({
        data: [RECURLY_FIXTURES.EXPECTED_PAYMENTS[1]],
        perPage: 100,
        hasMorePages: false,
        nextCursor: null,
      });
    });

    it('should map failures raised while paging', async () => {
      client.listAccountTransactions.mockReturnValue(
        createFailingRecurlyPager(new Error('Network down')),
      );

      await expect(
        payments.cursorPaginate({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });

  describe('create', () => {
    const PARAMS = {
      customer: RECURLY_FIXTURES.ACCOUNT_ID,
      currency: 'gbp',
      amount: 12900,
      paymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
      description: 'Wegovy 0.5mg',
    };
    const PURCHASE = {
      chargeInvoice: {
        ...RECURLY_FIXTURES.PAID_INVOICE,
        transactions: [RECURLY_FIXTURES.SUCCESSFUL_TRANSACTION],
      },
    };

    beforeEach(() => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.ACCOUNT);
      client.createPurchase.mockResolvedValue(PURCHASE);
    });

    it('should make one automatic purchase in major units with the billing info', async () => {
      await payments.create({ ...PARAMS, amount: 1999 });

      expect(client.createPurchase).toHaveBeenCalledTimes(1);
      expect(client.createPurchase).toHaveBeenCalledWith({
        currency: 'GBP',
        account: { code: RECURLY_FIXTURES.ACCOUNT_CODE },
        collectionMethod: 'automatic',
        billingInfoId: RECURLY_FIXTURES.BILLING_INFO_ID,
        lineItems: [
          {
            currency: 'GBP',
            unitAmount: 19.99,
            type: 'charge',
            description: 'Wegovy 0.5mg',
          },
        ],
      });
    });

    it('should keep zero-decimal amounts unchanged', async () => {
      await payments.create({ ...PARAMS, currency: 'JPY', amount: 5000 });

      expect(client.createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: [expect.objectContaining({ unitAmount: 5000 })],
        }),
      );
    });

    it('should pass the idempotency key as a request header', async () => {
      await payments.create({ ...PARAMS, idempotencyKey: 'order-42' });

      expect(client.createPurchase).toHaveBeenCalledWith(expect.any(Object), {
        headers: { 'Idempotency-Key': 'order-42' },
      });
    });

    it('should return the purchase transaction as a payment that can be refunded', async () => {
      client.getTransaction.mockResolvedValue(
        RECURLY_FIXTURES.SUCCESSFUL_TRANSACTION,
      );
      client.refundInvoice.mockResolvedValue(RECURLY_FIXTURES.CREDIT_INVOICE);

      const payment = await payments.create(PARAMS);
      await payments.refund(payment.id);

      expect(payment).toEqual(RECURLY_FIXTURES.EXPECTED_PAYMENTS[0]);
      expect(client.getTransaction).toHaveBeenCalledWith(
        RECURLY_FIXTURES.PAYMENT_ID,
      );
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

      await expect(payments.create(PARAMS)).rejects.toMatchObject({
        constructor: PaymentFailedError,
        provider: CashierProvider.Recurly,
        providerStatus: 422,
        providerCode: 'declined',
        declineCode: 'do_not_honor',
      });
    });

    it('should throw ProviderError when the purchase ran no transaction', async () => {
      client.createPurchase.mockResolvedValue({
        chargeInvoice: { ...RECURLY_FIXTURES.PAID_INVOICE, transactions: [] },
      });

      await expect(payments.create(PARAMS)).rejects.toBeInstanceOf(
        ProviderError,
      );
    });
  });

  describe('refund', () => {
    const refundWith = async (creditInvoice: Partial<recurly.Invoice>) => {
      client.refundInvoice.mockResolvedValue({
        ...RECURLY_FIXTURES.CREDIT_INVOICE,
        ...creditInvoice,
      });

      return payments.refund(RECURLY_FIXTURES.PAYMENT_ID);
    };

    beforeEach(() => {
      client.getTransaction.mockResolvedValue(
        RECURLY_FIXTURES.SUCCESSFUL_TRANSACTION,
      );
      client.refundInvoice.mockResolvedValue(RECURLY_FIXTURES.CREDIT_INVOICE);
    });

    it("should refund the invoice's refundable amount when no amount is given", async () => {
      const refund = await payments.refund(RECURLY_FIXTURES.PAYMENT_ID);

      expect(client.getTransaction).toHaveBeenCalledWith(
        RECURLY_FIXTURES.PAYMENT_ID,
      );
      expect(client.refundInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        { type: 'amount' },
      );
      expect(refund).toEqual(RECURLY_FIXTURES.EXPECTED_REFUND);
    });

    it.each([
      ['gbp', 4050, 40.5],
      ['jpy', 3000, 3000],
    ])(
      'should refund part of a %s invoice, converting %s minor units to %s',
      async (currency, amount, recurlyAmount) => {
        client.getTransaction.mockResolvedValue({
          ...RECURLY_FIXTURES.SUCCESSFUL_TRANSACTION,
          currency,
        });

        await payments.refund(RECURLY_FIXTURES.PAYMENT_ID, { amount });

        expect(client.refundInvoice).toHaveBeenCalledWith(
          RECURLY_FIXTURES.INVOICE_ID,
          { type: 'amount', amount: recurlyAmount },
        );
      },
    );

    it('should pass an amount of 0 to Recurly instead of refunding in full', async () => {
      await payments.refund(RECURLY_FIXTURES.PAYMENT_ID, { amount: 0 });

      expect(client.refundInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        { type: 'amount', amount: 0 },
      );
    });

    it('should ignore the reason and metadata, which Recurly cannot store', async () => {
      const refund = await payments.refund(RECURLY_FIXTURES.PAYMENT_ID, {
        amount: 4050,
        reason: RefundReason.RequestedByCustomer,
        metadata: { customer: 'customer-42' },
      });

      expect(client.refundInvoice).toHaveBeenCalledWith(
        RECURLY_FIXTURES.INVOICE_ID,
        { type: 'amount', amount: 40.5 },
      );
      expect(refund.reason).toBeNull();
    });

    it('should throw ValidationError when the payment has no invoice', async () => {
      client.getTransaction.mockResolvedValue(
        RECURLY_FIXTURES.DECLINED_TRANSACTION,
      );

      await expect(payments.refund('rec_txn_2')).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
        message: 'Payment rec_txn_2 has no invoice to refund',
      });
      expect(client.refundInvoice).not.toHaveBeenCalled();
    });

    it('should use the id of the loaded transaction as the payment id', async () => {
      const refund = await payments.refund('uuid-62b7a7d9a5b9e3e5');

      expect(client.getTransaction).toHaveBeenCalledWith(
        'uuid-62b7a7d9a5b9e3e5',
      );
      expect(refund.paymentId).toBe(RECURLY_FIXTURES.PAYMENT_ID);
    });

    it('should fall back to the first refund transaction when none refunds the payment', async () => {
      const [otherRefund] = RECURLY_FIXTURES.CREDIT_INVOICE.transactions ?? [];

      const refund = await refundWith({ transactions: [otherRefund!] });

      expect(refund).toMatchObject({ id: 'rec_txn_8', amount: 2000 });
    });

    it('should map the credit invoice when Recurly issued the refund as credit', async () => {
      const refund = await refundWith({ transactions: [] });

      expect(refund).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_REFUND,
        id: 'rec_inv_4',
        status: 'unknown',
      });
    });

    it.each([
      ['pending', 'pending'],
      ['processing', 'pending'],
      ['scheduled', 'pending'],
      ['declined', 'failed'],
      ['error', 'failed'],
      ['void', 'canceled'],
      ['chargeback', 'unknown'],
    ])('should map the %s status to %s', async (recurlyStatus, status) => {
      const [, paymentRefund] =
        RECURLY_FIXTURES.CREDIT_INVOICE.transactions ?? [];

      const refund = await refundWith({
        transactions: [{ ...paymentRefund, status: recurlyStatus }],
      });

      expect(refund.status).toBe(status);
    });

    it('should throw NotFoundError when the payment does not exist', async () => {
      client.getTransaction.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError(
            "Couldn't find Transaction",
            'not_found',
            {},
          ),
          404,
        ),
      );

      await expect(
        payments.refund(RECURLY_FIXTURES.PAYMENT_ID),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Recurly,
        providerStatus: 404,
      });
      expect(client.refundInvoice).not.toHaveBeenCalled();
    });

    it.each([
      ['the invoice is already refunded', 'Invoice has already been refunded'],
      [
        'the amount is more than what is left',
        'Amount cannot exceed the refundable amount',
      ],
    ])('should throw ValidationError when %s', async (_case, message) => {
      client.refundInvoice.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.ValidationError(message, 'validation', {}),
          422,
        ),
      );

      await expect(
        payments.refund(RECURLY_FIXTURES.PAYMENT_ID, { amount: 99999 }),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
        providerStatus: 422,
        providerCode: 'validation',
        message,
      });
    });
  });
});
