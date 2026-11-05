import Stripe from 'stripe';
import {
  ListPaymentMethodsParams,
  PaymentMethod,
  PaymentMethodsResource,
} from '../../../types/payment-method.types';
import { DEFAULT_LIST_LIMIT } from '../../../constants/cashier.constants';
import { mapStripePaymentMethod } from '../mappers/stripe-payment-method.mapper';
import { getExpandableId } from '../mappers/stripe-mapper.utils';
import { retrieveStripeCustomer } from '../stripe-customer';
import { stripeRequest } from '../stripe-request';

export class StripePaymentMethodsResource implements PaymentMethodsResource {
  constructor(private readonly client: Stripe) {}

  list({
    customer,
    limit = DEFAULT_LIST_LIMIT,
  }: ListPaymentMethodsParams): Promise<PaymentMethod[]> {
    return stripeRequest(async () => {
      const [stripeCustomer, paymentMethods] = await Promise.all([
        retrieveStripeCustomer(this.client, customer),
        this.client.customers.listPaymentMethods(customer, { limit }),
      ]);
      const defaultPaymentMethodId = getExpandableId(
        stripeCustomer.invoice_settings?.default_payment_method,
      );

      return paymentMethods.data.map((paymentMethod) =>
        mapStripePaymentMethod(paymentMethod, defaultPaymentMethodId),
      );
    });
  }
}
