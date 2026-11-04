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
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapRecurlyInvoice,
  mapRecurlyInvoicePreview,
  mapRecurlySubscriptionPreview,
} from '../mappers/recurly-invoice.mapper';
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
        invoices.map(
          async (invoice) =>
            mapRecurlyInvoice(
              relations.has('lineItems')
                ? await this.withLineItems(invoice)
                : invoice,
              relations,
            ) as InvoiceWith<Relation>,
        ),
      );
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
