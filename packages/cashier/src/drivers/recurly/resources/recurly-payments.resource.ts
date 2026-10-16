import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreatePaymentParams,
  CursorPaginatePaymentsParams,
  ListPaymentsParams,
  Payment,
  PaymentWith,
  PaymentsResource,
  ProviderPaymentRelation,
  Refund,
  RefundPaymentParams,
} from '../../../types/payment.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_LIST_LIMIT,
  RECURLY_MAX_LIST_LIMIT,
  RECURLY_PAYMENT_RELATIONS,
} from '../../../constants/cashier.constants';
import { ProviderError } from '../../../errors/provider.error';
import { ValidationError } from '../../../errors/validation.error';
import { validateCreatePaymentParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import { toMajorUnits } from '../../../utils/money.utils';
import {
  mapRecurlyPayment,
  sumRecurlyRefunds,
} from '../mappers/recurly-payment.mapper';
import { mapRecurlyRefund } from '../mappers/recurly-refund.mapper';
import { readRecurlyItems, readRecurlyPage } from '../recurly-page';
import {
  createRecurlyPurchase,
  toRecurlyPurchaseLineItem,
} from '../recurly-purchase';
import { recurlyRequest } from '../recurly-request';

type RecurlyPaymentRelation = ProviderPaymentRelation<CashierProvider.Recurly>;

const resolvePaymentRelations = <Relation extends RecurlyPaymentRelation>(
  requested?: readonly Relation[],
): ReadonlySet<Relation> =>
  resolveRelations(
    CashierProvider.Recurly,
    'payments',
    RECURLY_PAYMENT_RELATIONS,
    requested,
  );

const getOldestCreatedAt = (transactions: recurly.Transaction[]): Date =>
  new Date(
    Math.min(
      ...transactions.map(
        (transaction) => transaction.createdAt?.getTime() ?? 0,
      ),
    ),
  );

export class RecurlyPaymentsResource implements PaymentsResource<CashierProvider.Recurly> {
  constructor(private readonly client: recurly.Client) {}

  list<Relation extends RecurlyPaymentRelation = never>({
    customer,
    limit = DEFAULT_LIST_LIMIT,
    with: requested,
  }: ListPaymentsParams<Relation>): Promise<PaymentWith<Relation>[]> {
    return recurlyRequest(async () => {
      const relations = resolvePaymentRelations(requested);

      return this.map<Relation>(
        customer,
        await readRecurlyItems(this.payments(customer, limit), limit),
        relations,
      );
    });
  }

  cursorPaginate<Relation extends RecurlyPaymentRelation = never>({
    customer,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: requested,
  }: CursorPaginatePaymentsParams<Relation>): Promise<
    CursorPaginator<PaymentWith<Relation>>
  > {
    return recurlyRequest(async () => {
      const relations = resolvePaymentRelations(requested);
      const page = await readRecurlyPage(
        this.payments(customer, perPage, cursor),
      );

      return {
        data: await this.map<Relation>(customer, page.items, relations),
        perPage,
        hasMorePages: page.hasMorePages,
        nextCursor: page.nextCursor,
      };
    });
  }

  create(params: CreatePaymentParams): Promise<Payment> {
    return recurlyRequest(async () => {
      validateCreatePaymentParams(params, CashierProvider.Recurly);

      const {
        customer,
        amount,
        paymentMethod,
        description,
        metadata,
        idempotencyKey,
      } = params;
      const currency = params.currency.toUpperCase();
      const account = await this.client.getAccount(customer);
      const invoice = await createRecurlyPurchase(
        this.client,
        {
          currency,
          account: { code: account.code },
          collectionMethod: 'automatic',
          billingInfoId: paymentMethod,
          lineItems: [
            toRecurlyPurchaseLineItem(currency, {
              amount,
              description,
              metadata,
            }),
          ],
        },
        idempotencyKey,
      );
      const transaction = invoice.transactions?.find(
        (candidate) => candidate.type === 'purchase',
      );

      if (!transaction) {
        throw new ProviderError(
          `Recurly did not run a transaction for invoice ${invoice.id}`,
          { provider: CashierProvider.Recurly },
        );
      }

      return mapRecurlyPayment(transaction);
    });
  }

  refund(
    paymentId: string,
    { amount }: RefundPaymentParams = {},
  ): Promise<Refund> {
    return recurlyRequest(async () => {
      const transaction = await this.client.getTransaction(paymentId);
      const invoiceId = transaction.invoice?.id;

      if (!invoiceId) {
        throw new ValidationError(
          `Payment ${paymentId} has no invoice to refund`,
          { provider: CashierProvider.Recurly },
        );
      }

      const currency = (transaction.currency ?? '').toUpperCase();

      return mapRecurlyRefund(
        await this.client.refundInvoice(invoiceId, {
          type: 'amount',
          ...(amount === undefined
            ? {}
            : { amount: toMajorUnits(amount, currency) }),
        }),
        transaction.id ?? paymentId,
      );
    });
  }

  private payments(
    customer: string,
    limit: number,
    cursor?: string | null,
  ): recurly.Pager<recurly.Transaction> {
    return this.client.listAccountTransactions(customer, {
      params: { limit, type: 'payment', ...(cursor ? { cursor } : {}) },
    });
  }

  private async map<Relation extends RecurlyPaymentRelation>(
    customer: string,
    transactions: recurly.Transaction[],
    relations: ReadonlySet<RecurlyPaymentRelation>,
  ): Promise<PaymentWith<Relation>[]> {
    const refundedPayments = relations.has('refunds')
      ? transactions.filter((transaction) => transaction.refunded)
      : [];
    const refunded =
      refundedPayments.length > 0
        ? sumRecurlyRefunds(
            await this.refunds(customer, getOldestCreatedAt(refundedPayments)),
          )
        : new Map<string, number>();

    return transactions.map(
      (transaction) =>
        mapRecurlyPayment(
          transaction,
          relations,
          refunded.get(transaction.id ?? '') ?? 0,
        ) as PaymentWith<Relation>,
    );
  }

  private refunds(
    customer: string,
    beginTime: Date,
  ): Promise<recurly.Transaction[]> {
    return readRecurlyItems(
      this.client.listAccountTransactions(customer, {
        params: { limit: RECURLY_MAX_LIST_LIMIT, type: 'refund', beginTime },
      }),
    );
  }
}
