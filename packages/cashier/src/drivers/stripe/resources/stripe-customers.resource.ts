import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  AdjustBalanceParams,
  BalanceTransaction,
  CreateCustomerParams,
  Customer,
  CustomerRelation,
  CustomerWith,
  CustomersResource,
  GetCustomerParams,
  ListCustomersParams,
  UpdateCustomerParams,
} from '../../../types/customer.types';
import { DEFAULT_LIST_LIMIT } from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { validateAdjustBalanceParams } from '../../../utils/create-params.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapStripeBalanceTransaction,
  mapStripeCustomer,
  mapStripeCustomerBalances,
  toStripeCustomerName,
} from '../mappers/stripe-customer.mapper';
import { toStripeRequestOptions } from '../mappers/stripe-mapper.utils';
import { retrieveStripeCustomer } from '../stripe-customer';
import { stripeRequest } from '../stripe-request';

const STRIPE_CUSTOMER_RELATIONS: ReadonlySet<string> = new Set(['balances']);

export class StripeCustomersResource implements CustomersResource {
  constructor(private readonly client: Stripe) {}

  get<Relation extends CustomerRelation = never>(
    customerId: string,
    params: GetCustomerParams<Relation> = {},
  ): Promise<CustomerWith<Relation>> {
    return stripeRequest(async () => {
      const relations: ReadonlySet<CustomerRelation> = resolveRelations(
        CashierProvider.Stripe,
        'customers',
        STRIPE_CUSTOMER_RELATIONS,
        params.with,
      );
      const customer = await retrieveStripeCustomer(this.client, customerId);

      return {
        ...mapStripeCustomer(customer),
        ...(relations.has('balances')
          ? { balances: mapStripeCustomerBalances(customer) }
          : {}),
      } as CustomerWith<Relation>;
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

  creditBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction> {
    return this.adjustBalance(customerId, params, -1);
  }

  debitBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction> {
    return this.adjustBalance(customerId, params, 1);
  }

  private adjustBalance(
    customerId: string,
    params: AdjustBalanceParams,
    sign: 1 | -1,
  ): Promise<BalanceTransaction> {
    return stripeRequest(async () => {
      validateAdjustBalanceParams(params, CashierProvider.Stripe);

      return mapStripeBalanceTransaction(
        await this.client.customers.createBalanceTransaction(
          customerId,
          {
            amount: sign * params.amount,
            currency: params.currency.toLowerCase(),
            ...(params.description ? { description: params.description } : {}),
            ...(params.metadata ? { metadata: params.metadata } : {}),
          },
          ...toStripeRequestOptions(params.idempotencyKey),
        ),
      );
    });
  }
}
