import { CashierProvider } from './cashier.types';
import { CursorPaginateParams, CursorPaginator } from './pagination.types';
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

export interface PaymentRelationFields {
  refunds: { amountRefunded: number };
  dispute: { dispute: PaymentDispute | null };
  receipt: { receiptUrl: string | null };
  reversal: { reversed: boolean };
  subscription: { subscription: PaymentSubscription | null };
}

export type PaymentRelation = keyof PaymentRelationFields;

export interface CashierPaymentRelations {
  stripe: 'refunds' | 'dispute' | 'receipt' | 'reversal' | 'subscription';
  recurly: 'refunds' | 'subscription';
}

export type ProviderPaymentRelation<Provider extends CashierProvider> = Extract<
  ProviderRelation<CashierPaymentRelations, Provider>,
  PaymentRelation
>;

export type PaymentWith<Relation extends PaymentRelation = never> = Payment &
  LoadedRelations<PaymentRelationFields, Relation>;

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

export interface PaymentsResource<
  Provider extends CashierProvider = CashierProvider,
> {
  list<Relation extends ProviderPaymentRelation<Provider> = never>(
    params: ListPaymentsParams<Relation>,
  ): Promise<PaymentWith<Relation>[]>;
  cursorPaginate<Relation extends ProviderPaymentRelation<Provider> = never>(
    params: CursorPaginatePaymentsParams<Relation>,
  ): Promise<CursorPaginator<PaymentWith<Relation>>>;
  create(params: CreatePaymentParams): Promise<Payment>;
  refund(paymentId: string, params?: RefundPaymentParams): Promise<Refund>;
}
