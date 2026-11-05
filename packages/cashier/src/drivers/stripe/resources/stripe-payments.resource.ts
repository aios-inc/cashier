import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreatePaymentParams,
  CursorPaginatePaymentsParams,
  GetPaymentParams,
  ListPaymentsParams,
  Payment,
  PaymentWith,
  PaymentsResource,
  ProviderPaymentRelation,
  Refund,
  RefundPaymentParams,
  SendReceiptParams,
} from '../../../types/payment.types';
import { CursorPaginator } from '../../../types/pagination.types';
import {
  DEFAULT_LIST_LIMIT,
  STRIPE_OFF_SESSION_PAYMENT_METHOD_TYPES,
  STRIPE_PAYMENT_RELATION_EXPAND,
  STRIPE_REFUND_REASONS,
} from '../../../constants/cashier.constants';
import { validateCreatePaymentParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import { mapStripePayment } from '../mappers/stripe-payment.mapper';
import { mapStripeRefund } from '../mappers/stripe-refund.mapper';
import {
  toStripeCursorPaginator,
  toStripeExpand,
  toStripeRequestOptions,
} from '../mappers/stripe-mapper.utils';
import { getStripeCustomerEmail, sendStripeReceipt } from '../stripe-receipt';
import { stripeRequest } from '../stripe-request';

type StripePaymentRelation = ProviderPaymentRelation<CashierProvider.Stripe>;

const STRIPE_PAYMENT_RELATIONS: ReadonlySet<string> = new Set(
  Object.keys(STRIPE_PAYMENT_RELATION_EXPAND),
);

const resolvePaymentRelations = <Relation extends StripePaymentRelation>(
  requested?: readonly Relation[],
): ReadonlySet<Relation> =>
  resolveRelations(
    CashierProvider.Stripe,
    'payments',
    STRIPE_PAYMENT_RELATIONS,
    requested,
  );

export class StripePaymentsResource implements PaymentsResource<CashierProvider.Stripe> {
  constructor(private readonly client: Stripe) {}

  get<Relation extends StripePaymentRelation = never>(
    paymentId: string,
    params: GetPaymentParams<Relation> = {},
  ): Promise<PaymentWith<Relation>> {
    return stripeRequest(async () => {
      const relations = resolvePaymentRelations(params.with);

      return mapStripePayment(
        await this.client.paymentIntents.retrieve(
          paymentId,
          toStripeExpand(relations, STRIPE_PAYMENT_RELATION_EXPAND),
        ),
        relations,
      ) as PaymentWith<Relation>;
    });
  }

  async list<Relation extends StripePaymentRelation = never>({
    customer,
    limit = DEFAULT_LIST_LIMIT,
    with: relations,
  }: ListPaymentsParams<Relation>): Promise<PaymentWith<Relation>[]> {
    return (await this.fetch<Relation>({ customer, limit }, limit, relations))
      .data;
  }

  cursorPaginate<Relation extends StripePaymentRelation = never>({
    customer,
    perPage = DEFAULT_LIST_LIMIT,
    cursor,
    with: relations,
  }: CursorPaginatePaymentsParams<Relation>): Promise<
    CursorPaginator<PaymentWith<Relation>>
  > {
    return this.fetch<Relation>(
      {
        customer,
        limit: perPage,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      perPage,
      relations,
    );
  }

  create(params: CreatePaymentParams): Promise<Payment> {
    return stripeRequest(async () => {
      validateCreatePaymentParams(params, CashierProvider.Stripe);

      const {
        customer,
        currency,
        amount,
        paymentMethod,
        description,
        metadata,
        idempotencyKey,
      } = params;

      return mapStripePayment(
        await this.client.paymentIntents.create(
          {
            amount,
            currency: currency.toLowerCase(),
            customer,
            payment_method: paymentMethod,
            payment_method_types: STRIPE_OFF_SESSION_PAYMENT_METHOD_TYPES,
            confirm: true,
            off_session: true,
            ...(description ? { description } : {}),
            ...(metadata ? { metadata } : {}),
          },
          ...toStripeRequestOptions(idempotencyKey),
        ),
      );
    });
  }

  refund(paymentId: string, params: RefundPaymentParams = {}): Promise<Refund> {
    return stripeRequest(async () =>
      mapStripeRefund(
        await this.client.refunds.create({
          payment_intent: paymentId,
          ...(params.amount === undefined ? {} : { amount: params.amount }),
          ...(params.reason
            ? { reason: STRIPE_REFUND_REASONS[params.reason] }
            : {}),
          ...(params.metadata ? { metadata: params.metadata } : {}),
        }),
      ),
    );
  }

  sendReceipt(
    paymentId: string,
    { email }: SendReceiptParams = {},
  ): Promise<void> {
    return stripeRequest(async () => {
      const paymentIntent = await this.client.paymentIntents.retrieve(
        paymentId,
        { expand: ['customer'] },
      );

      await sendStripeReceipt(this.client, {
        subject: `Payment ${paymentId}`,
        paid: paymentIntent.status === 'succeeded',
        charge: paymentIntent.latest_charge,
        email:
          email ??
          paymentIntent.receipt_email ??
          getStripeCustomerEmail(paymentIntent.customer),
      });
    });
  }

  private fetch<Relation extends StripePaymentRelation>(
    params: Stripe.PaymentIntentListParams,
    perPage: number,
    requested?: readonly Relation[],
  ): Promise<CursorPaginator<PaymentWith<Relation>>> {
    return stripeRequest(async () => {
      const relations = resolvePaymentRelations(requested);

      return toStripeCursorPaginator(
        await this.client.paymentIntents.list({
          ...params,
          ...toStripeExpand(relations, STRIPE_PAYMENT_RELATION_EXPAND, 'data.'),
        }),
        perPage,
        (paymentIntent) =>
          mapStripePayment(paymentIntent, relations) as PaymentWith<Relation>,
      );
    });
  }
}
