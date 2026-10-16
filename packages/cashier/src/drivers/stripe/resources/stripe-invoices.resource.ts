import Stripe from 'stripe';
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
  STRIPE_INVOICE_RELATION_EXPAND,
} from '../../../constants/cashier.constants';
import { validateCreateInvoiceParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import { mapStripeInvoice } from '../mappers/stripe-invoice.mapper';
import {
  toStripeCursorPaginator,
  toStripeExpand,
  toStripeRequestOptions,
  toUnixSeconds,
} from '../mappers/stripe-mapper.utils';
import { stripeRequest } from '../stripe-request';

type StripeInvoiceRelation = ProviderInvoiceRelation<CashierProvider.Stripe>;

const STRIPE_INVOICE_RELATIONS: ReadonlySet<string> = new Set(
  Object.keys(STRIPE_INVOICE_RELATION_EXPAND),
);

const resolveInvoiceRelations = <Relation extends StripeInvoiceRelation>(
  requested?: readonly Relation[],
): ReadonlySet<Relation> =>
  resolveRelations(
    CashierProvider.Stripe,
    'invoices',
    STRIPE_INVOICE_RELATIONS,
    requested,
  );

const toStripeDueTerms = ({
  collection,
  dueDate,
  daysUntilDue = DEFAULT_DAYS_UNTIL_DUE,
}: CreateInvoiceParams): Pick<
  Stripe.InvoiceCreateParams,
  'due_date' | 'days_until_due'
> => {
  if (collection !== 'send_invoice') return {};

  return dueDate
    ? { due_date: toUnixSeconds(dueDate) }
    : { days_until_due: daysUntilDue };
};

const toStripeInvoiceCreateParams = (
  params: CreateInvoiceParams,
): Stripe.InvoiceCreateParams => {
  const {
    customer,
    currency,
    collection,
    chargeNow = false,
    description,
    paymentMethod,
    paymentMethodTypes,
    metadata,
  } = params;

  return {
    customer,
    currency: currency.toLowerCase(),
    collection_method: collection,
    auto_advance: !chargeNow,
    pending_invoice_items_behavior: 'exclude',
    ...(description ? { description } : {}),
    ...(metadata ? { metadata } : {}),
    ...toStripeDueTerms(params),
    ...(collection === 'charge_automatically' && paymentMethod
      ? { default_payment_method: paymentMethod }
      : {}),
    ...(paymentMethodTypes
      ? {
          payment_settings: {
            payment_method_types:
              paymentMethodTypes as Stripe.InvoiceCreateParams.PaymentSettings.PaymentMethodType[],
          },
        }
      : {}),
  };
};

export class StripeInvoicesResource implements InvoicesResource<CashierProvider.Stripe> {
  constructor(private readonly client: Stripe) {}

  get<Relation extends StripeInvoiceRelation = never>(
    invoiceId: string,
    params: GetInvoiceParams<Relation> = {},
  ): Promise<InvoiceWith<Relation>> {
    return stripeRequest(async () => {
      const relations = resolveInvoiceRelations(params.with);

      return mapStripeInvoice(
        await this.client.invoices.retrieve(
          invoiceId,
          toStripeExpand(relations, STRIPE_INVOICE_RELATION_EXPAND),
        ),
        relations,
      ) as InvoiceWith<Relation>;
    });
  }

  async list<Relation extends StripeInvoiceRelation = never>({
    customer,
    status,
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListInvoicesParams<Relation>): Promise<InvoiceWith<Relation>[]> {
    return (
      await this.fetch<Relation>(
        { customer, limit, ...(status ? { status } : {}) },
        limit,
        relations,
      )
    ).data;
  }

  cursorPaginate<Relation extends StripeInvoiceRelation = never>({
    customer,
    status,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginateInvoicesParams<Relation>): Promise<
    CursorPaginator<InvoiceWith<Relation>>
  > {
    return this.fetch<Relation>(
      {
        customer,
        limit: perPage,
        ...(status ? { status } : {}),
        ...(cursor ? { starting_after: cursor } : {}),
      },
      perPage,
      relations,
    );
  }

  create(params: CreateInvoiceParams): Promise<Invoice> {
    return stripeRequest(async () => {
      validateCreateInvoiceParams(params, CashierProvider.Stripe);

      const { customer, currency, lineItems, description, metadata } = params;
      const options = (step: string) =>
        toStripeRequestOptions(params.idempotencyKey, step);

      const invoice = await this.client.invoices.create(
        toStripeInvoiceCreateParams(params),
        ...options('invoice'),
      );

      for (const [index, lineItem] of lineItems.entries()) {
        const itemDescription = lineItem.description || description;

        await this.client.invoiceItems.create(
          {
            customer,
            invoice: invoice.id,
            amount: lineItem.amount,
            currency: currency.toLowerCase(),
            ...(itemDescription ? { description: itemDescription } : {}),
            ...(metadata ? { metadata } : {}),
          },
          ...options(`item-${index}`),
        );
      }

      const finalized = await this.client.invoices.finalizeInvoice(
        invoice.id,
        {},
        ...options('finalize'),
      );

      return mapStripeInvoice(
        params.chargeNow
          ? await this.client.invoices.pay(invoice.id, {}, ...options('pay'))
          : finalized,
      );
    });
  }

  pay(invoiceId: string, params: PayInvoiceParams = {}): Promise<Invoice> {
    return stripeRequest(async () =>
      mapStripeInvoice(
        await this.client.invoices.pay(
          invoiceId,
          params.paymentMethod ? { payment_method: params.paymentMethod } : {},
        ),
      ),
    );
  }

  void(invoiceId: string): Promise<Invoice> {
    return stripeRequest(async () =>
      mapStripeInvoice(await this.client.invoices.voidInvoice(invoiceId)),
    );
  }

  private fetch<Relation extends StripeInvoiceRelation>(
    params: Stripe.InvoiceListParams,
    perPage: number,
    requested?: readonly Relation[],
  ): Promise<CursorPaginator<InvoiceWith<Relation>>> {
    return stripeRequest(async () => {
      const relations = resolveInvoiceRelations(requested);

      return toStripeCursorPaginator(
        await this.client.invoices.list({
          ...params,
          ...toStripeExpand(relations, STRIPE_INVOICE_RELATION_EXPAND, 'data.'),
        }),
        perPage,
        (invoice) =>
          mapStripeInvoice(invoice, relations) as InvoiceWith<Relation>,
      );
    });
  }
}
