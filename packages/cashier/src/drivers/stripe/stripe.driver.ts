import Stripe from 'stripe';
import { CashierDriver, CashierProvider } from '../../types/cashier.types';
import { StripeAccountResource } from './resources/stripe-account.resource';
import { StripeCustomersResource } from './resources/stripe-customers.resource';
import { StripeInvoicesResource } from './resources/stripe-invoices.resource';
import { StripePaymentMethodsResource } from './resources/stripe-payment-methods.resource';
import { StripePaymentsResource } from './resources/stripe-payments.resource';
import { StripeProductsResource } from './resources/stripe-products.resource';
import { StripePricesResource } from './resources/stripe-prices.resource';
import { StripeSubscriptionsResource } from './resources/stripe-subscriptions.resource';

export class StripeDriver implements CashierDriver<CashierProvider.Stripe> {
  readonly provider = CashierProvider.Stripe;
  readonly account: StripeAccountResource;
  readonly customers: StripeCustomersResource;
  readonly invoices: StripeInvoicesResource;
  readonly payments: StripePaymentsResource;
  readonly paymentMethods: StripePaymentMethodsResource;
  readonly products: StripeProductsResource;
  readonly prices: StripePricesResource;
  readonly subscriptions: StripeSubscriptionsResource;

  constructor(client: Stripe) {
    this.account = new StripeAccountResource(client);
    this.customers = new StripeCustomersResource(client);
    this.invoices = new StripeInvoicesResource(client);
    this.payments = new StripePaymentsResource(client);
    this.paymentMethods = new StripePaymentMethodsResource(client);
    this.products = new StripeProductsResource(client);
    this.prices = new StripePricesResource(client);
    this.subscriptions = new StripeSubscriptionsResource(client);
  }
}
