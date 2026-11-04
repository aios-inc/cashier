import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreateCustomerParams,
  Customer,
  CustomersResource,
  ListCustomersParams,
  UpdateCustomerParams,
} from '../../../types/customer.types';
import { DEFAULT_LIST_LIMIT } from '../../../constants/cashier.constants';
import { NotFoundError } from '../../../errors/not-found.error';
import { ValidationError } from '../../../errors/validation.error';
import {
  mapStripeCustomer,
  toStripeCustomerName,
} from '../mappers/stripe-customer.mapper';
import { stripeRequest } from '../stripe-request';

export class StripeCustomersResource implements CustomersResource {
  constructor(private readonly client: Stripe) {}

  get(customerId: string): Promise<Customer> {
    return stripeRequest(async () => {
      const customer = await this.client.customers.retrieve(customerId);

      if (customer.deleted) {
        throw new NotFoundError(`Customer ${customerId} has been deleted`, {
          provider: CashierProvider.Stripe,
        });
      }

      return mapStripeCustomer(customer);
    });
  }

  list({
    email,
    limit = DEFAULT_LIST_LIMIT,
  }: ListCustomersParams = {}): Promise<Customer[]> {
    return stripeRequest(async () => {
      const response = await this.client.customers.list({
        limit,
        ...(email ? { email } : {}),
      });

      return response.data.map(mapStripeCustomer);
    });
  }

  create({
    email,
    firstName,
    lastName,
    metadata,
  }: CreateCustomerParams): Promise<Customer> {
    const name = toStripeCustomerName(firstName, lastName);

    return stripeRequest(async () =>
      mapStripeCustomer(
        await this.client.customers.create({
          email,
          ...(name ? { name } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      ),
    );
  }

  update(
    customerId: string,
    {
      email,
      firstName,
      lastName,
      metadata,
      defaultPaymentMethod,
    }: UpdateCustomerParams,
  ): Promise<Customer> {
    if ((firstName === undefined) !== (lastName === undefined)) {
      return Promise.reject(
        new ValidationError(
          'Stripe stores a single name, so firstName and lastName must be updated together',
          { provider: CashierProvider.Stripe },
        ),
      );
    }

    const name = toStripeCustomerName(firstName, lastName);

    return stripeRequest(async () =>
      mapStripeCustomer(
        await this.client.customers.update(customerId, {
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
          ...(metadata ? { metadata } : {}),
          ...(defaultPaymentMethod
            ? {
                invoice_settings: {
                  default_payment_method: defaultPaymentMethod,
                },
              }
            : {}),
        }),
      ),
    );
  }
}
