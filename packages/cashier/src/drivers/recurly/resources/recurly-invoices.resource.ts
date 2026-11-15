import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreateInvoiceParams,
  CursorPaginateInvoicesParams,
  GetInvoiceParams,
  Invoice,
  InvoicePreview,
  InvoiceScope,
  InvoiceWith,
  InvoicesResource,
  ListInvoicesParams,
  PayInvoiceParams,
  PreviewInvoiceParams,
  ProviderInvoiceRelation,
  InvoiceRefund,
  RefundInvoiceLineItemsParams,
} from '../../../types/invoice.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_DAYS_UNTIL_DUE,
  DEFAULT_LIST_LIMIT,
  MILLISECONDS_PER_DAY,
  RECURLY_COLLECTION_METHODS,
  RECURLY_INVOICE_RELATIONS,
  RECURLY_MAX_LIST_LIMIT,
} from '../../../constants/cashier.constants';
import { UnsupportedOperationError } from '../../../errors/unsupported-operation.error';
import { ValidationError } from '../../../errors/validation.error';
import { validateCreateInvoiceParams } from '../../../utils/create-params.utils';
import { toMinorUnits } from '../../../utils/money.utils';
import {
  assertPaymentCoversRefund,
  resolveRefundLineItems,
  validateRefundLineItemsParams,
} from '../../../utils/refund-line-items.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapRecurlyCreditInvoice,
  mapRecurlyInvoice,
  mapRecurlyInvoiceLineItem,
  mapRecurlyInvoicePreview,
  mapRecurlySubscriptionPreview,
} from '../mappers/recurly-invoice.mapper';
import { refundRecurlyLineItems } from '../recurly-line-item-refund';
import { readRecurlyItems, readRecurlyPage } from '../recurly-page';
import {
  createRecurlyPurchase,
  toRecurlyPurchaseLineItem,
} from '../recurly-purchase';
import { recurlyRequest } from '../recurly-request';
import { toRecurlySubscriptionChange } from '../recurly-subscription-change';

type RecurlyInvoiceRelation = ProviderInvoiceRelation<CashierProvider.Recurly>;

type RecurlyInvoiceMapper<Relation extends RecurlyInvoiceRelation> = (
  invoices: recurly.Invoice[],
) => Promise<InvoiceWith<Relation>[]>;

const toRecurlyNetTerms = ({
  collection,
  dueDate,
  daysUntilDue = DEFAULT_DAYS_UNTIL_DUE,
}: CreateInvoiceParams): Pick<
  recurly.PurchaseCreate,
  'netTerms' | 'netTermsType'
> => {
  if (collection !== 'send_invoice') return {};

  return {
    netTerms: dueDate
      ? Math.ceil((dueDate.getTime() - Date.now()) / MILLISECONDS_PER_DAY)
      : daysUntilDue,
    netTermsType: 'net',
  };
};

export class RecurlyInvoicesResource implements InvoicesResource<CashierProvider.Recurly> {
  constructor(private readonly client: recurly.Client) {}

  get<Relation extends RecurlyInvoiceRelation = never>(
    invoiceId: string,
    params: GetInvoiceParams<Relation> = {},
  ): Promise<InvoiceWith<Relation>> {
    return recurlyRequest(async () => {
      const map = this.toInvoiceMapper(params.with);
      const [invoice] = await map([await this.client.getInvoice(invoiceId)]);

      return invoice as InvoiceWith<Relation>;
    });
  }

  list<Relation extends RecurlyInvoiceRelation = never>({
    customer,
    subscription,
    status,
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListInvoicesParams<Relation>): Promise<InvoiceWith<Relation>[]> {
    return recurlyRequest(async () => {
      const map = this.toInvoiceMapper(relations);

      return map(
        await readRecurlyItems(
          this.invoices(
            { customer, subscription } as InvoiceScope,
            limit,
            status,
          ),
          limit,
        ),
      );
    });
  }

  cursorPaginate<Relation extends RecurlyInvoiceRelation = never>({
    customer,
    subscription,
    status,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginateInvoicesParams<Relation>): Promise<
    CursorPaginator<InvoiceWith<Relation>>
  > {
    return recurlyRequest(async () => {
      const map = this.toInvoiceMapper(relations);
      const page = await readRecurlyPage(
        this.invoices(
          { customer, subscription } as InvoiceScope,
          perPage,
          status,
          cursor,
        ),
      );

      return {
        data: await map(page.items),
        perPage,
        hasMorePages: page.hasMorePages,
        nextCursor: page.nextCursor,
      };
    });
  }

  create(params: CreateInvoiceParams): Promise<Invoice> {
    return recurlyRequest(async () => {
      validateCreateInvoiceParams(params, CashierProvider.Recurly);

      if (params.paymentMethodTypes) {
        throw new UnsupportedOperationError(
          'Recurly cannot restrict the payment method types of an invoice',
          { provider: CashierProvider.Recurly },
        );
      }

      const {
        customer,
        lineItems,
        collection,
        description,
        paymentMethod,
        metadata,
        idempotencyKey,
      } = params;
      const currency = params.currency.toUpperCase();
      const account = await this.client.getAccount(customer);

      return mapRecurlyInvoice(
        await createRecurlyPurchase(
          this.client,
          {
            currency,
            account: { code: account.code },
            collectionMethod: RECURLY_COLLECTION_METHODS[collection],
            lineItems: lineItems.map((lineItem) =>
              toRecurlyPurchaseLineItem(currency, {
                amount: lineItem.amount,
                description: lineItem.description || description,
                metadata,
              }),
            ),
            ...toRecurlyNetTerms(params),
            ...(collection === 'charge_automatically' && paymentMethod
              ? { billingInfoId: paymentMethod }
              : {}),
            ...(description ? { customerNotes: description } : {}),
          },
          idempotencyKey,
        ),
      );
    });
  }

  pay(invoiceId: string, params: PayInvoiceParams = {}): Promise<Invoice> {
    return recurlyRequest(async () =>
      mapRecurlyInvoice(
        await this.client.collectInvoice(
          invoiceId,
          params.paymentMethod
            ? { body: { billingInfoId: params.paymentMethod } }
            : undefined,
        ),
      ),
    );
  }

  void(invoiceId: string): Promise<Invoice> {
    return recurlyRequest(async () =>
      mapRecurlyInvoice(await this.client.voidInvoice(invoiceId)),
    );
  }

  preview({
    subscription,
    price,
    quantity,
    proration,
  }: PreviewInvoiceParams): Promise<InvoicePreview> {
    return recurlyRequest(async () => {
      const current = await this.client.getSubscription(subscription);

      if (price === undefined && quantity === undefined) {
        return mapRecurlySubscriptionPreview(current);
      }

      const change = await this.client.previewSubscriptionChange(
        subscription,
        toRecurlySubscriptionChange({ price, quantity, proration }),
      );
      const chargeInvoice = change.invoiceCollection?.chargeInvoice;

      return chargeInvoice
        ? mapRecurlyInvoicePreview(chargeInvoice, current.id ?? subscription)
        : mapRecurlySubscriptionPreview(current, change);
    });
  }

  refundLineItems(
    invoiceId: string,
    params: RefundInvoiceLineItemsParams,
  ): Promise<InvoiceRefund> {
    return recurlyRequest(async () => {
      validateRefundLineItemsParams(params, CashierProvider.Recurly);

      const isRetrySafe = params.idempotencyKey !== undefined;

      if (
        isRetrySafe &&
        params.lineItems.some(({ amount }) => amount === undefined)
      ) {
        throw new ValidationError(
          'Recurly needs an amount for every line item when an idempotency key is passed',
          { provider: CashierProvider.Recurly },
        );
      }

      const invoice = await this.withLineItems(
        await this.client.getInvoice(invoiceId),
      );

      if (invoice.state !== 'paid') {
        throw new ValidationError(
          `Only a paid invoice can be refunded, and invoice ${invoiceId} is ${invoice.state}`,
          { provider: CashierProvider.Recurly },
        );
      }

      const currency = (invoice.currency ?? '').toUpperCase();
      const amountsRefunded = isRetrySafe
        ? new Map<string, number>()
        : await this.amountsRefundedByLineItem(invoice);
      const lineItems = resolveRefundLineItems(
        invoiceId,
        (invoice.lineItems ?? []).map((lineItem) =>
          mapRecurlyInvoiceLineItem(
            lineItem,
            currency,
            amountsRefunded.get(lineItem.id ?? ''),
          ),
        ),
        params,
        CashierProvider.Recurly,
        { checkRemaining: !isRetrySafe },
      );

      if (!isRetrySafe) {
        assertPaymentCoversRefund(
          invoiceId,
          lineItems.reduce((total, { amount }) => total + amount, 0),
          toMinorUnits(invoice.refundableAmount ?? invoice.paid ?? 0, currency),
          CashierProvider.Recurly,
        );
      }

      return mapRecurlyCreditInvoice(
        await refundRecurlyLineItems(
          this.client,
          invoiceId,
          currency,
          lineItems,
          params.idempotencyKey,
        ),
        invoiceId,
        lineItems,
      );
    });
  }

  private toInvoiceMapper<Relation extends RecurlyInvoiceRelation>(
    requested?: readonly Relation[],
  ): RecurlyInvoiceMapper<Relation> {
    const relations: ReadonlySet<RecurlyInvoiceRelation> = resolveRelations(
      CashierProvider.Recurly,
      'invoices',
      RECURLY_INVOICE_RELATIONS,
      requested,
    );

    return async (invoices) =>
      Promise.all(
        invoices.map(async (invoice) => {
          if (!relations.has('lineItems')) {
            return mapRecurlyInvoice(
              invoice,
              relations,
            ) as InvoiceWith<Relation>;
          }

          const withLineItems = await this.withLineItems(invoice);

          return mapRecurlyInvoice(
            withLineItems,
            relations,
            await this.amountsRefundedByLineItem(withLineItems),
          ) as InvoiceWith<Relation>;
        }),
      );
  }

  private async amountsRefundedByLineItem(
    invoice: recurly.Invoice,
  ): Promise<Map<string, number>> {
    const amounts = new Map<string, number>();
    const currency = (invoice.currency ?? '').toUpperCase();
    const refundable = invoice.refundableAmount;

    if (
      !invoice.id ||
      invoice.type !== 'charge' ||
      typeof refundable !== 'number' ||
      toMinorUnits(invoice.paid ?? 0, currency) <=
        toMinorUnits(refundable, currency)
    ) {
      return amounts;
    }

    const relatedInvoices = await readRecurlyItems(
      this.client.listRelatedInvoices(invoice.id, {
        params: { limit: RECURLY_MAX_LIST_LIMIT },
      }),
    );
    const creditInvoices = await Promise.all(
      relatedInvoices
        .filter(
          (related) => related.type === 'credit' && related.state !== 'voided',
        )
        .map((related) => this.withLineItems(related)),
    );

    for (const lineItem of creditInvoices.flatMap(
      (creditInvoice) => creditInvoice.lineItems ?? [],
    )) {
      if (!lineItem.previousLineItemId) continue;

      amounts.set(
        lineItem.previousLineItemId,
        (amounts.get(lineItem.previousLineItemId) ?? 0) +
          toMinorUnits(
            Math.abs(lineItem.amount ?? 0),
            (lineItem.currency ?? currency).toUpperCase(),
          ),
      );
    }

    return amounts;
  }

  private async withLineItems(
    invoice: recurly.Invoice,
  ): Promise<recurly.Invoice> {
    if (!invoice.hasMoreLineItems || !invoice.id) return invoice;

    const lineItems = await readRecurlyItems(
      this.client.listInvoiceLineItems(invoice.id, {
        params: { limit: RECURLY_MAX_LIST_LIMIT },
      }),
    );

    return { ...invoice, lineItems, hasMoreLineItems: false };
  }

  private invoices(
    { customer, subscription }: InvoiceScope,
    limit: number,
    status?: 'paid',
    cursor?: string | null,
  ): recurly.Pager<recurly.Invoice> {
    const options = {
      params: {
        limit,
        ...(status ? { state: status } : {}),
        ...(cursor ? { cursor } : {}),
      },
    };

    if (subscription) {
      return this.client.listSubscriptionInvoices(subscription, options);
    }

    if (!customer) {
      throw new ValidationError(
        'Listing invoices requires a customer or a subscription',
        { provider: CashierProvider.Recurly },
      );
    }

    return this.client.listAccountInvoices(customer, options);
  }
}
