import { CashierProvider } from './cashier.types';

export interface Customer {
  id: string;
  code: string | null;
  email: string | null;
  name: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
  provider: CashierProvider;
}

export interface ListCustomersParams {
  email?: string;
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

export interface CustomersResource {
  get(customerId: string): Promise<Customer>;
  list(params?: ListCustomersParams): Promise<Customer[]>;
  create(params: CreateCustomerParams): Promise<Customer>;
  update(customerId: string, params: UpdateCustomerParams): Promise<Customer>;
}
