import { CashierProvider } from './cashier.types';

export type PaymentMethodType =
  'card' | 'bank_account' | 'paypal' | 'link' | 'other';

export type PaymentMethodWallet = 'apple_pay' | 'google_pay' | 'link' | 'other';

export interface PaymentMethodDetails {
  type: PaymentMethodType;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  wallet: PaymentMethodWallet | null;
}

export interface PaymentMethod extends PaymentMethodDetails {
  id: string;
  customerId: string | null;
  isDefault: boolean;
  createdAt: Date | null;
  provider: CashierProvider;
}

export interface ListPaymentMethodsParams {
  customer: string;
  limit?: number;
}

export interface PaymentMethodsResource {
  list(params: ListPaymentMethodsParams): Promise<PaymentMethod[]>;
}
