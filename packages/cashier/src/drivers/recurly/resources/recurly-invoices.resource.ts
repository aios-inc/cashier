import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreateInvoiceParams,
  CursorPaginateInvoicesParams,
  GetInvoiceParams,
  Invoice,
  InvoiceWith,
  InvoicesResource,
  ListInvoicesParams,
  PayInvoiceParams,
  ProviderInvoiceRelation,
} from '../../../types/invoice.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_DAYS_UNTIL_DUE,
  DEFAULT_LIST_LIMIT,
  MILLISECONDS_PER_DAY,
  RECURLY_COLLECTION_METHODS,
  RECURLY_INVOICE_RELATIONS,
} from '../../../constants/cashier.constants';
import { UnsupportedOperationError } from '../../../errors/unsupported-operation.error';
import { validateCreateInvoiceParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import { mapRecurlyInvoice } from '../mappers/recurly-invoice.mapper';
import { readRecurlyItems, readRecurlyPage } from '../recurly-page';
import {
  createRecurlyPurchase,
  toRecurlyPurchaseLineItem,
} from '../recurly-purchase';
import { recurlyRequest } from '../recurly-request';

type RecurlyInvoiceRelation = ProviderInvoiceRelation<CashierProvider.Recurly>;

const toInvoiceMapper = <Relation extends RecurlyInvoiceRelation>(
  requested?: readonly Relation[],
): ((invoice: recurly.Invoice) => InvoiceWith<Relation>) => {
  const relations = resolveRelations(
    CashierProvider.Recurly,
    'invoices',
    RECURLY_INVOICE_RELATIONS,
    requested,
  );

  return (invoice) =>
    mapRecurlyInvoice(invoice, relations) as InvoiceWith<Relation>;
};

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
      const map = toInvoiceMapper(params.with);

      return map(await this.client.getInvoice(invoiceId));
    });
  }

  list<Relation extends RecurlyInvoiceRelation = never>({
    customer,
    status,
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListInvoicesParams<Relation>): Promise<InvoiceWith<Relation>[]> {
    return recurlyRequest(async () => {
      const map = toInvoiceMapper(relations);

      return (
        await readRecurlyItems(this.invoices(customer, limit, status), limit)
      ).map(map);
    });
  }

  cursorPaginate<Relation extends RecurlyInvoiceRelation = never>({
    customer,
    status,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginateInvoicesParams<Relation>): Promise<
    CursorPaginator<InvoiceWith<Relation>>
  > {
    return recurlyRequest(async () => {
      const map = toInvoiceMapper(relations);
      const page = await readRecurlyPage(
        this.invoices(customer, perPage, status, cursor),
      );

      return {
        data: page.items.map(map),
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

  private invoices(
    customer: string,
    limit: number,
    status?: 'paid',
    cursor?: string | null,
  ): recurly.Pager<recurly.Invoice> {
    return this.client.listAccountInvoices(customer, {
      params: {
        limit,
        ...(status ? { state: status } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });
  }
}
