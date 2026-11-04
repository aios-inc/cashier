import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  CreateCustomerParams,
  Customer,
  CustomersResource,
  ListCustomersParams,
  UpdateCustomerParams,
} from '../../../types/customer.types';
import { DEFAULT_LIST_LIMIT } from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { mapRecurlyAccount } from '../mappers/recurly-account.mapper';
import { toRecurlyCustomFields } from '../mappers/recurly-subscription.mapper';
import { getRecurlyBillingInfo } from '../recurly-billing-info';
import { recurlyRequest } from '../recurly-request';

export class RecurlyCustomersResource implements CustomersResource {
  constructor(private readonly client: recurly.Client) {}

  get(customerId: string): Promise<Customer> {
    return recurlyRequest(async () =>
      mapRecurlyAccount(await this.client.getAccount(customerId)),
    );
  }

  list({
    email,
    limit = DEFAULT_LIST_LIMIT,
  }: ListCustomersParams = {}): Promise<Customer[]> {
    return recurlyRequest(async () => {
      const pager = this.client.listAccounts({
        params: { limit, ...(email ? { email } : {}) },
      });

      const customers: Customer[] = [];

      for await (const account of pager.each()) {
        customers.push(mapRecurlyAccount(account));

        if (customers.length >= limit) break;
      }

      return customers;
    });
  }

  create({
    email,
    code,
    firstName,
    lastName,
    metadata,
  }: CreateCustomerParams): Promise<Customer> {
    if (!code) {
      return Promise.reject(
        new ValidationError('Recurly requires a code to create a customer', {
          provider: CashierProvider.Recurly,
        }),
      );
    }

    return recurlyRequest(async () =>
      mapRecurlyAccount(
        await this.client.createAccount({
          code,
          email,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(metadata
            ? { customFields: toRecurlyCustomFields(metadata) }
            : {}),
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
    const changes: recurly.AccountUpdate = {
      ...(email ? { email } : {}),
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(metadata ? { customFields: toRecurlyCustomFields(metadata) } : {}),
    };

    if (!defaultPaymentMethod) {
      return recurlyRequest(async () =>
        mapRecurlyAccount(await this.client.updateAccount(customerId, changes)),
      );
    }

    return recurlyRequest(async () => {
      let account = await this.client.getAccount(customerId);
      const billingInfo = await getRecurlyBillingInfo(
        this.client,
        customerId,
        defaultPaymentMethod,
      );

      if (Object.keys(changes).length > 0) {
        account = await this.client.updateAccount(customerId, changes);
      }

      if (!billingInfo.primaryPaymentMethod) {
        await this.client.updateABillingInfo(customerId, defaultPaymentMethod, {
          primaryPaymentMethod: true,
        });
      }

      return mapRecurlyAccount(account);
    });
  }
}
