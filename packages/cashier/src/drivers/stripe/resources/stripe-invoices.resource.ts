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
  InvoiceLineItemRefund,
  InvoiceRefund,
  RefundInvoiceLineItemsParams,
} from '../../../types/invoice.types';
import { CursorPaginator } from '../../../types/pagination.types';
import { SendReceiptParams } from '../../../types/payment.types';
import {
  DEFAULT_DAYS_UNTIL_DUE,
  DEFAULT_LIST_LIMIT,
  STRIPE_CREDIT_NOTE_REASONS,
  STRIPE_IDEMPOTENCY_METADATA_KEY,
  STRIPE_INVOICE_RELATION_EXPAND,
  STRIPE_PRORATION_BEHAVIORS,
} from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { validateCreateInvoiceParams } from '../../../utils/create-params.utils';
import {
  assertPaymentCoversRefund,
  resolveRefundLineItems,
  validateRefundLineItemsParams,
} from '../../../utils/refund-line-items.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapStripeCreditNote,
  mapStripeInvoice,
  mapStripeInvoiceLineItem,
  mapStripeInvoicePreview,
} from '../mappers/stripe-invoice.mapper';
import {
  getExpanded,
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

interface StripeCreditNoteWithLines {
  creditNote: Stripe.CreditNote;
  lines: Stripe.CreditNoteLineItem[];
}

const toInvoiceLineItemRefunds = (
  lines: Stripe.CreditNoteLineItem[],
): InvoiceLineItemRefund[] =>
  lines.flatMap(({ invoice_line_item, amount }) =>
    invoice_line_item ? [{ lineItemId: invoice_line_item, amount }] : [],
  );

const sumCreditedByLineItem = (
  creditNotes: StripeCreditNoteWithLines[],
): Map<string, number> => {
  const amounts = new Map<string, number>();

  for (const { lineItemId, amount } of creditNotes.flatMap(({ lines }) =>
    toInvoiceLineItemRefunds(lines),
  )) {
    amounts.set(lineItemId, (amounts.get(lineItemId) ?? 0) + amount);
  }

  return amounts;
};

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

      return this.toInvoice<Relation>(invoice, relations);
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
      const invoice = await this.client.invoices.retrieve(invoiceId);

      await sendStripeReceipt(this.client, {
        subject: `Invoice ${invoiceId}`,
        paid: invoice.status === 'paid',
        charge: invoice.charge,
        email: email ?? invoice.customer_email,
      });
    });
  }

  refundLineItems(
    invoiceId: string,
    params: RefundInvoiceLineItemsParams,
  ): Promise<InvoiceRefund> {
    return stripeRequest(async () => {
      validateRefundLineItemsParams(params, CashierProvider.Stripe);

      const invoice = await this.withLineItems(
        await this.client.invoices.retrieve(invoiceId, { expand: ['charge'] }),
      );

      if (invoice.status !== 'paid') {
        throw new ValidationError(
          `Only a paid invoice can be refunded, and invoice ${invoiceId} is ${invoice.status}`,
          { provider: CashierProvider.Stripe },
        );
      }

      const creditNotes = await this.creditNotesOf(invoice);
      const earlierRefund = params.idempotencyKey
        ? creditNotes.find(
            ({ creditNote }) =>
              creditNote.metadata?.[STRIPE_IDEMPOTENCY_METADATA_KEY] ===
              params.idempotencyKey,
          )
        : undefined;

      if (earlierRefund) {
        return mapStripeCreditNote(
          await this.client.creditNotes.retrieve(earlierRefund.creditNote.id, {
            expand: ['refund'],
          }),
          toInvoiceLineItemRefunds(earlierRefund.lines),
        );
      }

      const amountsRefunded = sumCreditedByLineItem(creditNotes);
      const lineItems = resolveRefundLineItems(
        invoiceId,
        invoice.lines.data.map((lineItem) =>
          mapStripeInvoiceLineItem(lineItem, amountsRefunded.get(lineItem.id)),
        ),
        params,
        CashierProvider.Stripe,
      );
      const lines = lineItems.map(
        ({ lineItemId, amount }): Stripe.CreditNoteCreateParams.Line => ({
          type: 'invoice_line_item',
          invoice_line_item: lineItemId,
          amount,
        }),
      );
      const preview = await this.client.creditNotes.preview({
        invoice: invoiceId,
        lines,
      });
      const charge = getExpanded(invoice.charge);

      assertPaymentCoversRefund(
        invoiceId,
        preview.amount,
        charge ? charge.amount - charge.amount_refunded : invoice.amount_paid,
        CashierProvider.Stripe,
      );

      const reason = params.reason && STRIPE_CREDIT_NOTE_REASONS[params.reason];
      const metadata = {
        ...params.metadata,
        ...(params.idempotencyKey
          ? { [STRIPE_IDEMPOTENCY_METADATA_KEY]: params.idempotencyKey }
          : {}),
      };
      const creditNote = await this.client.creditNotes.create(
        {
          invoice: invoiceId,
          lines,
          refund_amount: preview.amount,
          ...(reason ? { reason } : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          expand: ['refund'],
        },
        ...toStripeRequestOptions(params.idempotencyKey),
      );

      return mapStripeCreditNote(creditNote, lineItems);
    });
  }

  private async toInvoice<Relation extends StripeInvoiceRelation>(
    invoice: Stripe.Invoice,
    relations: ReadonlySet<StripeInvoiceRelation>,
  ): Promise<InvoiceWith<Relation>> {
    if (!relations.has('lineItems')) {
      return mapStripeInvoice(invoice, relations) as InvoiceWith<Relation>;
    }

    const withLineItems = await this.withLineItems(invoice);

    return mapStripeInvoice(
      withLineItems,
      relations,
      sumCreditedByLineItem(await this.creditNotesOf(withLineItems)),
    ) as InvoiceWith<Relation>;
  }

  private async creditNotesOf(
    invoice: Stripe.Invoice,
  ): Promise<StripeCreditNoteWithLines[]> {
    if (!invoice.post_payment_credit_notes_amount) return [];

    const listCreditNotes = (startingAfter?: string) =>
      this.client.creditNotes.list({
        invoice: invoice.id,
        limit: STRIPE_LINE_ITEMS_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    const creditNotes = await readAllStripeItems(
      await listCreditNotes(),
      listCreditNotes,
    );

    return Promise.all(
      creditNotes
        .filter(
          (creditNote) =>
            creditNote.type === 'post_payment' && creditNote.status !== 'void',
        )
        .map(async (creditNote) => ({
          creditNote,
          lines: await readAllStripeItems(creditNote.lines, (startingAfter) =>
            this.client.creditNotes.listLineItems(creditNote.id, {
              limit: STRIPE_LINE_ITEMS_PAGE_SIZE,
              starting_after: startingAfter,
            }),
          ),
        })),
    );
  }

  private async withLineItems(
    invoice: Stripe.Invoice,
  ): Promise<Stripe.Invoice> {
    if (!invoice.lines?.has_more) {
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
        response.data.map((invoice) =>
          this.toInvoice<Relation>(invoice, relations),
        ),
      );

      return toStripeCursorPaginator(
        { ...response, data: invoices },
        perPage,
        (invoice) => invoice,
      );
    });
  }
}
