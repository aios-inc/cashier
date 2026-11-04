import { CashierProvider, ProviderCapabilities } from './cashier.types';
import { CursorPaginateParams, CursorPaginator } from './pagination.types';
import { Payment, SendReceiptParams } from './payment.types';
import {
  LoadedRelations,
  ProviderRelation,
  WithParams,
} from './relation.types';
import { SubscriptionProration } from './subscription.types';

export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'past_due'
  | 'failed'
  | 'void'
  | 'uncollectible'
  | 'closed'
  | 'unknown';

export interface Invoice {
  id: string;
  number: string | null;
  customerId: string | null;
  subscriptionIds: string[];
  billingReason: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountRemaining: number;
  attemptCount: number;
  hostedInvoiceUrl: string | null;
  createdAt: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  provider: CashierProvider;
}

export interface InvoiceLineItem {
  id: string;
  description: string | null;
  amount: number;
  quantity: number | null;
  unitAmount: number | null;
  priceId: string | null;
  subscriptionId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  proration: boolean;
}

export type InvoiceEventType =
  'created' | 'finalized' | 'paid' | 'failed' | 'voided' | 'uncollectible';

export interface InvoiceEvent {
  type: InvoiceEventType;
  at: Date;
}

export interface InvoiceRelationFields {
  refunds: { amountRefunded: number };
  lineItems: { lineItems: InvoiceLineItem[] };
  payments: { payments: Payment[] };
  startingBalance: { startingBalance: number };
  timeline: { timeline: InvoiceEvent[] };
}

export type InvoiceRelation = keyof InvoiceRelationFields;

export interface CashierInvoiceRelations {
  stripe: 'refunds' | 'lineItems' | 'payments' | 'startingBalance' | 'timeline';
  recurly: 'refunds' | 'lineItems' | 'payments' | 'timeline';
}

export type ProviderInvoiceRelation<Provider extends CashierProvider> = Extract<
  ProviderRelation<CashierInvoiceRelations, Provider>,
  InvoiceRelation
>;

export type InvoiceWith<Relation extends InvoiceRelation = never> = Invoice &
  LoadedRelations<InvoiceRelationFields, Relation>;

export type GetInvoiceParams<Relation extends InvoiceRelation = never> =
  WithParams<Relation>;

export type InvoiceScope =
  | { customer: string; subscription?: string }
  | { customer?: string; subscription: string };

export type ListInvoicesParams<Relation extends InvoiceRelation = never> =
  WithParams<Relation> &
    InvoiceScope & {
      status?: 'paid';
      limit?: number;
    };

export type CursorPaginateInvoicesParams<
  Relation extends InvoiceRelation = never,
> = Omit<CursorPaginateParams, 'customer'> &
  WithParams<Relation> &
  InvoiceScope & {
    status?: 'paid';
  };

export type InvoiceCollection = 'charge_automatically' | 'send_invoice';

export interface CreateInvoiceLineItem {
  description: string;
  amount: number;
}

export interface CreateInvoiceParams {
  customer: string;
  currency: string;
  lineItems: CreateInvoiceLineItem[];
  collection: InvoiceCollection;
  chargeNow?: boolean;
  description?: string;
  dueDate?: Date;
  daysUntilDue?: number;
  paymentMethod?: string;
  paymentMethodTypes?: string[];
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface PayInvoiceParams {
  paymentMethod?: string;
}

export interface PreviewInvoiceParams {
  subscription: string;
  price?: string;
  quantity?: number;
  proration?: SubscriptionProration;
}

export interface InvoicePreview {
  customerId: string | null;
  subscriptionId: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountDue: number;
  lineItems: InvoiceLineItem[];
  nextPaymentAt: Date | null;
  provider: CashierProvider;
}

export interface InvoiceReceipts {
  sendReceipt(invoiceId: string, params?: SendReceiptParams): Promise<void>;
}

export interface CashierInvoiceCapabilities {
  stripe: InvoiceReceipts;
  recurly: Record<never, never>;
}

export interface InvoicesResourceMethods<
  Provider extends CashierProvider = CashierProvider,
> {
  get<Relation extends ProviderInvoiceRelation<Provider> = never>(
    invoiceId: string,
    params?: GetInvoiceParams<Relation>,
  ): Promise<InvoiceWith<Relation>>;
  list<Relation extends ProviderInvoiceRelation<Provider> = never>(
    params: ListInvoicesParams<Relation>,
  ): Promise<InvoiceWith<Relation>[]>;
  cursorPaginate<Relation extends ProviderInvoiceRelation<Provider> = never>(
    params: CursorPaginateInvoicesParams<Relation>,
  ): Promise<CursorPaginator<InvoiceWith<Relation>>>;
  create(params: CreateInvoiceParams): Promise<Invoice>;
  pay(invoiceId: string, params?: PayInvoiceParams): Promise<Invoice>;
  void(invoiceId: string): Promise<Invoice>;
  preview(params: PreviewInvoiceParams): Promise<InvoicePreview>;
}

export type InvoicesResource<
  Provider extends CashierProvider = CashierProvider,
> = InvoicesResourceMethods<Provider> &
  ProviderCapabilities<CashierInvoiceCapabilities, Provider>;
