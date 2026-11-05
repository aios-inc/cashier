import { CashierProvider } from './cashier.types';

export interface Account {
  id: string;
  name: string | null;
  statementDescriptor: string | null;
  statementDescriptorPrefix: string | null;
  provider: CashierProvider;
}

export interface AccountResource {
  get(): Promise<Account>;
}
