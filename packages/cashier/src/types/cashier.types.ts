import { AccountResource } from './account.types';
import { CustomersResource } from './customer.types';
import { InvoicesResource } from './invoice.types';
import { PaymentMethodsResource } from './payment-method.types';
import { PaymentsResource } from './payment.types';
import { PricesResource } from './price.types';
import { ProductsResource } from './product.types';
import { SubscriptionsResource } from './subscription.types';

export enum CashierProvider {
  Stripe = 'stripe',
  Recurly = 'recurly',
}

export interface StripeOptions {
  apiKey: string;
}

export interface RecurlyOptions {
  apiKey: string;
}

export interface CashierProviderOptions {
  stripe: StripeOptions;
  recurly: RecurlyOptions;
}

export type CashierProvidersConfig = {
  [Provider in CashierProvider]?: CashierProviderOptions[Provider];
};

export interface CashierConfig {
  default?: CashierProvider;
  providers?: CashierProvidersConfig;
}

export type ProviderCapabilities<
  Capabilities extends Record<CashierProvider, object>,
  Provider extends CashierProvider,
> = Pick<Capabilities[Provider], keyof Capabilities[Provider]>;

export interface CashierDriverCapabilities {
  stripe: { readonly account: AccountResource };
  recurly: Record<never, never>;
}

export interface CashierDriverResources<
  Provider extends CashierProvider = CashierProvider,
> {
  readonly provider: Provider;
  readonly customers: CustomersResource;
  readonly invoices: InvoicesResource<Provider>;
  readonly payments: PaymentsResource<Provider>;
  readonly paymentMethods: PaymentMethodsResource;
  readonly products: ProductsResource;
  readonly prices: PricesResource;
  readonly subscriptions: SubscriptionsResource<Provider>;
}

export type CashierDriver<Provider extends CashierProvider = CashierProvider> =
  CashierDriverResources<Provider> &
    ProviderCapabilities<CashierDriverCapabilities, Provider>;
