import * as recurly from 'recurly';
import { CashierDriver, CashierProvider } from '../../types/cashier.types';
import { RecurlyCustomersResource } from './resources/recurly-customers.resource';
import { RecurlyInvoicesResource } from './resources/recurly-invoices.resource';
import { RecurlyPaymentMethodsResource } from './resources/recurly-payment-methods.resource';
import { RecurlyPaymentsResource } from './resources/recurly-payments.resource';
import { RecurlyProductsResource } from './resources/recurly-products.resource';
import { RecurlyPricesResource } from './resources/recurly-prices.resource';
import { RecurlySubscriptionsResource } from './resources/recurly-subscriptions.resource';

export class RecurlyDriver implements CashierDriver<CashierProvider.Recurly> {
  readonly provider = CashierProvider.Recurly;
  readonly customers: RecurlyCustomersResource;
  readonly invoices: RecurlyInvoicesResource;
  readonly payments: RecurlyPaymentsResource;
  readonly paymentMethods: RecurlyPaymentMethodsResource;
  readonly products: RecurlyProductsResource;
  readonly prices: RecurlyPricesResource;
  readonly subscriptions: RecurlySubscriptionsResource;

  constructor(client: recurly.Client) {
    this.customers = new RecurlyCustomersResource(client);
    this.invoices = new RecurlyInvoicesResource(client);
    this.payments = new RecurlyPaymentsResource(client);
    this.paymentMethods = new RecurlyPaymentMethodsResource(client);
    this.products = new RecurlyProductsResource(client);
    this.prices = new RecurlyPricesResource();
    this.subscriptions = new RecurlySubscriptionsResource(client);
  }
}
