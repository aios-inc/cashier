import { CashierProvider } from './cashier.types';
import { CursorPaginateParams, CursorPaginator } from './pagination.types';
import {
  LoadedRelations,
  ProviderRelation,
  WithParams,
} from './relation.types';

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
  attemptCount: number;
  hostedInvoiceUrl: string | null;
  createdAt: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  provider: CashierProvider;
}

export interface InvoiceRelationFields {
  refunds: { amountRefunded: number };
}

export type InvoiceRelation = keyof InvoiceRelationFields;

export interface CashierInvoiceRelations {
  stripe: 'refunds';
  recurly: 'refunds';
}

export type ProviderInvoiceRelation<Provider extends CashierProvider> = Extract<
  ProviderRelation<CashierInvoiceRelations, Provider>,
  InvoiceRelation
>;

export type InvoiceWith<Relation extends InvoiceRelation = never> = Invoice &
  LoadedRelations<InvoiceRelationFields, Relation>;

export type GetInvoiceParams<Relation extends InvoiceRelation = never> =
  WithParams<Relation>;

export interface ListInvoicesParams<
  Relation extends InvoiceRelation = never,
> extends WithParams<Relation> {
  customer: string;
  status?: 'paid';
  limit?: number;
}

export interface CursorPaginateInvoicesParams<
  Relation extends InvoiceRelation = never,
>
  extends CursorPaginateParams, WithParams<Relation> {
  status?: 'paid';
}

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

export interface InvoicesResource<
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
}
