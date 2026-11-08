import { CashierProvider, ProviderCapabilities } from './cashier.types';
import { LoadedRelations, WithParams } from './relation.types';

export interface Customer {
  id: string;
  code: string | null;
  email: string | null;
  name: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
  provider: CashierProvider;
}

export interface CustomerBalance {
  currency: string;
  amount: number;
}

export interface CustomerRelationFields {
  balances: { balances: CustomerBalance[] };
}

export type CustomerRelation = keyof CustomerRelationFields;

export type CustomerWith<Relation extends CustomerRelation = never> = Customer &
  LoadedRelations<CustomerRelationFields, Relation>;

export type GetCustomerParams<Relation extends CustomerRelation = never> =
  WithParams<Relation>;

export interface BalanceTransaction {
  id: string;
  customerId: string | null;
  amount: number;
  currency: string;
  description: string | null;
  endingBalance: number | null;
  createdAt: Date;
  provider: CashierProvider;
}

export interface AdjustBalanceParams {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface ListCustomersParams {
  email?: string;
  limit?: number;
}

export interface SearchCustomersParams {
  email: string;
  limit?: number;
}

export interface CreateCustomerParams {
  email: string;
  code?: string;
  firstName?: string;
  lastName?: string;
  metadata?: Record<string, string>;
}

export interface UpdateCustomerParams {
  email?: string;
  firstName?: string;
  lastName?: string;
  metadata?: Record<string, string>;
  defaultPaymentMethod?: string;
}

export interface CustomerSearch {
  search(params: SearchCustomersParams): Promise<Customer[]>;
}

export interface CashierCustomerCapabilities {
  stripe: CustomerSearch;
  recurly: Record<never, never>;
}

export interface CustomersResourceMethods {
  get<Relation extends CustomerRelation = never>(
    customerId: string,
    params?: GetCustomerParams<Relation>,
  ): Promise<CustomerWith<Relation>>;
  list(params?: ListCustomersParams): Promise<Customer[]>;
  create(params: CreateCustomerParams): Promise<Customer>;
  update(customerId: string, params: UpdateCustomerParams): Promise<Customer>;
  creditBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction>;
  debitBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction>;
}

export type CustomersResource<
  Provider extends CashierProvider = CashierProvider,
> = CustomersResourceMethods &
  ProviderCapabilities<CashierCustomerCapabilities, Provider>;
