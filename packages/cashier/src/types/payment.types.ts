import { CashierProvider, ProviderCapabilities } from './cashier.types';
import { CursorPaginateParams, CursorPaginator } from './pagination.types';
import { PaymentMethodDetails } from './payment-method.types';
import {
  LoadedRelations,
  ProviderRelation,
  WithParams,
} from './relation.types';
import { SubscriptionStatus } from './subscription.types';

export type PaymentStatus =
  'succeeded' | 'pending' | 'incomplete' | 'failed' | 'canceled' | 'unknown';

export type PaymentDisputeStatus =
  | 'warning_needs_response'
  | 'warning_under_review'
  | 'warning_closed'
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'unknown';

export enum RefundReason {
  Duplicate = 'duplicate',
  Fraudulent = 'fraudulent',
  RequestedByCustomer = 'requested_by_customer',
}

export type RefundStatus =
  'succeeded' | 'pending' | 'failed' | 'canceled' | 'unknown';

export interface PaymentDispute {
  id: string;
  status: PaymentDisputeStatus;
  reason: string;
  createdAt: Date;
  evidenceDueBy: Date | null;
}

export interface PaymentSubscription {
  id: string;
  status: SubscriptionStatus | null;
  cancelAt: Date | null;
}

export interface Payment {
  id: string;
  customerId: string | null;
  invoiceId: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  description: string | null;
  createdAt: Date;
  provider: CashierProvider;
}

export interface Refund {
  id: string;
  paymentId: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  reason: RefundReason | null;
  createdAt: Date;
  provider: CashierProvider;
}

export type PaymentEventType =
  'created' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'disputed';

export interface PaymentEvent {
  type: PaymentEventType;
  at: Date;
  amount: number | null;
}

export interface PaymentRelationFields {
  refunds: { amountRefunded: number; refunds: Refund[] };
  dispute: { dispute: PaymentDispute | null };
  receipt: { receiptUrl: string | null };
  reversal: { reversed: boolean };
  subscription: { subscription: PaymentSubscription | null };
  paymentMethod: { paymentMethod: PaymentMethodDetails | null };
  fees: { fee: number | null; net: number | null };
  statementDescriptor: { statementDescriptor: string | null };
  timeline: { timeline: PaymentEvent[] };
}

export type PaymentRelation = keyof PaymentRelationFields;

export interface CashierPaymentRelations {
  stripe:
    | 'refunds'
    | 'dispute'
    | 'receipt'
    | 'reversal'
    | 'subscription'
    | 'paymentMethod'
    | 'fees'
    | 'statementDescriptor'
    | 'timeline';
  recurly: 'refunds' | 'subscription' | 'paymentMethod' | 'timeline';
}

export type ProviderPaymentRelation<Provider extends CashierProvider> = Extract<
  ProviderRelation<CashierPaymentRelations, Provider>,
  PaymentRelation
>;

export type PaymentWith<Relation extends PaymentRelation = never> = Payment &
  LoadedRelations<PaymentRelationFields, Relation>;

export type GetPaymentParams<Relation extends PaymentRelation = never> =
  WithParams<Relation>;

export interface ListPaymentsParams<
  Relation extends PaymentRelation = never,
> extends WithParams<Relation> {
  customer: string;
  limit?: number;
}

export interface CursorPaginatePaymentsParams<
  Relation extends PaymentRelation = never,
>
  extends CursorPaginateParams, WithParams<Relation> {}

export interface CreatePaymentParams {
  customer: string;
  currency: string;
  amount: number;
  paymentMethod: string;
  description?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface RefundPaymentParams {
  amount?: number;
  reason?: RefundReason;
  metadata?: Record<string, string>;
}

export interface SendReceiptParams {
  email?: string;
}

export interface PaymentReceipts {
  sendReceipt(paymentId: string, params?: SendReceiptParams): Promise<void>;
}

export interface CashierPaymentCapabilities {
  stripe: PaymentReceipts;
  recurly: Record<never, never>;
}

export interface PaymentsResourceMethods<
  Provider extends CashierProvider = CashierProvider,
> {
  get<Relation extends ProviderPaymentRelation<Provider> = never>(
    paymentId: string,
    params?: GetPaymentParams<Relation>,
  ): Promise<PaymentWith<Relation>>;
  list<Relation extends ProviderPaymentRelation<Provider> = never>(
    params: ListPaymentsParams<Relation>,
  ): Promise<PaymentWith<Relation>[]>;
  cursorPaginate<Relation extends ProviderPaymentRelation<Provider> = never>(
    params: CursorPaginatePaymentsParams<Relation>,
  ): Promise<CursorPaginator<PaymentWith<Relation>>>;
  create(params: CreatePaymentParams): Promise<Payment>;
  refund(paymentId: string, params?: RefundPaymentParams): Promise<Refund>;
}

export type PaymentsResource<
  Provider extends CashierProvider = CashierProvider,
> = PaymentsResourceMethods<Provider> &
  ProviderCapabilities<CashierPaymentCapabilities, Provider>;
