import Stripe from 'stripe';
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
import { SendReceiptParams } from '../../../types/payment.types';
import {
  DEFAULT_DAYS_UNTIL_DUE,
  DEFAULT_LIST_LIMIT,
  STRIPE_INVOICE_RELATION_EXPAND,
  STRIPE_PRORATION_BEHAVIORS,
} from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { validateCreateInvoiceParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapStripeInvoice,
  mapStripeInvoicePreview,
} from '../mappers/stripe-invoice.mapper';
import {
  toStripeCursorPaginator,
  toStripeExpand,
  toStripeRequestOptions,
  toUnixSeconds,
} from '../mappers/stripe-mapper.utils';
import { readAllStripeItems } from '../stripe-list';
import { sendStripeReceipt } from '../stripe-receipt';
import { stripeRequest } from '../stripe-request';
import { getStripeSubscriptionItemId } from '../stripe-subscription-item';

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

const STRIPE_LINE_ITEMS_PAGE_SIZE = 100;

const toStripeInvoiceScope = ({
  customer,
  subscription,
}: InvoiceScope): Pick<
  Stripe.InvoiceListParams,
  'customer' | 'subscription'
> => {
  if (!customer && !subscription) {
    throw new ValidationError(
      'Listing invoices requires a customer or a subscription',
      { provider: CashierProvider.Stripe },
    );
  }

  return {
    ...(customer ? { customer } : {}),
    ...(subscription ? { subscription } : {}),
  };
};

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
      const invoice = await this.client.invoices.retrieve(
        invoiceId,
        toStripeExpand(relations, STRIPE_INVOICE_RELATION_EXPAND),
      );

      return mapStripeInvoice(
        await this.withLineItems(invoice, relations),
        relations,
      ) as InvoiceWith<Relation>;
    });
  }

  list<Relation extends StripeInvoiceRelation = never>({
    customer,
    subscription,
    status,
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListInvoicesParams<Relation>): Promise<InvoiceWith<Relation>[]> {
    return stripeRequest(
      async () =>
        (
          await this.fetch<Relation>(
            {
              ...toStripeInvoiceScope({
                customer,
                subscription,
              } as InvoiceScope),
              limit,
              ...(status ? { status } : {}),
            },
            limit,
            relations,
          )
        ).data,
    );
  }

  cursorPaginate<Relation extends StripeInvoiceRelation = never>({
    customer,
    subscription,
    status,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginateInvoicesParams<Relation>): Promise<
    CursorPaginator<InvoiceWith<Relation>>
  > {
    return stripeRequest(() =>
      this.fetch<Relation>(
        {
          ...toStripeInvoiceScope({ customer, subscription } as InvoiceScope),
          limit: perPage,
          ...(status ? { status } : {}),
          ...(cursor ? { starting_after: cursor } : {}),
        },
        perPage,
        relations,
      ),
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

  preview({
    subscription,
    price,
    quantity,
    proration,
  }: PreviewInvoiceParams): Promise<InvoicePreview> {
    return stripeRequest(async () => {
      const isItemChange = price !== undefined || quantity !== undefined;
      const params: Stripe.InvoiceRetrieveUpcomingParams = {
        subscription,
        ...(isItemChange
          ? {
              subscription_items: [
                {
                  id: await getStripeSubscriptionItemId(
                    this.client,
                    subscription,
                  ),
                  ...(price ? { price } : {}),
                  ...(quantity !== undefined ? { quantity } : {}),
                },
              ],
            }
          : {}),
        ...(proration
          ? {
              subscription_proration_behavior:
                STRIPE_PRORATION_BEHAVIORS[proration],
            }
          : {}),
      };
      const upcoming = await this.client.invoices.retrieveUpcoming(params);
      const lineItems = await readAllStripeItems(
        upcoming.lines,
        (startingAfter) =>
          this.client.invoices.listUpcomingLines({
            ...params,
            limit: STRIPE_LINE_ITEMS_PAGE_SIZE,
            starting_after: startingAfter,
          }),
      );

      return mapStripeInvoicePreview(upcoming, subscription, lineItems);
    });
  }

  sendReceipt(
    invoiceId: string,
    { email }: SendReceiptParams = {},
  ): Promise<void> {
    return stripeRequest(async () => {
      const invoice = await this.client.invoices.retrieve(invoiceId, {
        expand: ['charge'],
      });

      await sendStripeReceipt(this.client, {
        subject: `Invoice ${invoiceId}`,
        paid: invoice.status === 'paid',
        charge: invoice.charge,
        email: email ?? invoice.customer_email,
      });
    });
  }

  private async withLineItems(
    invoice: Stripe.Invoice,
    relations: ReadonlySet<StripeInvoiceRelation>,
  ): Promise<Stripe.Invoice> {
    if (!relations.has('lineItems') || !invoice.lines?.has_more) {
      return invoice;
    }

    const data = await readAllStripeItems(invoice.lines, (startingAfter) =>
      this.client.invoices.listLineItems(invoice.id, {
        limit: STRIPE_LINE_ITEMS_PAGE_SIZE,
        starting_after: startingAfter,
      }),
    );

    return { ...invoice, lines: { ...invoice.lines, data, has_more: false } };
  }

  private fetch<Relation extends StripeInvoiceRelation>(
    params: Stripe.InvoiceListParams,
    perPage: number,
    requested?: readonly Relation[],
  ): Promise<CursorPaginator<InvoiceWith<Relation>>> {
    return stripeRequest(async () => {
      const relations = resolveInvoiceRelations(requested);
      const response = await this.client.invoices.list({
        ...params,
        ...toStripeExpand(relations, STRIPE_INVOICE_RELATION_EXPAND, 'data.'),
      });
      const invoices = await Promise.all(
        response.data.map((invoice) => this.withLineItems(invoice, relations)),
      );

      return toStripeCursorPaginator(
        { ...response, data: invoices },
        perPage,
        (invoice) =>
          mapStripeInvoice(invoice, relations) as InvoiceWith<Relation>,
      );
    });
  }
}
