import * as recurly from 'recurly';
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
import {
  DEFAULT_LIST_LIMIT,
  RECURLY_MAX_LIST_LIMIT,
} from '../../../constants/cashier.constants';
import { ValidationError } from '../../../errors/validation.error';
import { validateAdjustBalanceParams } from '../../../utils/create-params.utils';
import { toMajorUnits } from '../../../utils/money.utils';
import { resolveRelations } from '../../../utils/relations.utils';
import {
  mapRecurlyAccount,
  mapRecurlyAccountBalances,
  mapRecurlyBalanceTransaction,
} from '../mappers/recurly-account.mapper';
import { toRecurlyCustomFields } from '../mappers/recurly-subscription.mapper';
import { getRecurlyBillingInfo } from '../recurly-billing-info';
import { readRecurlyItems } from '../recurly-page';
import { recurlyRequest } from '../recurly-request';

const RECURLY_CUSTOMER_RELATIONS: ReadonlySet<string> = new Set(['balances']);

interface RecurlyLineItemClient {
  createLineItem(
    accountId: string,
    body: recurly.LineItemCreate,
    options?: { headers: Record<string, string> },
  ): Promise<recurly.LineItem>;
}

export class RecurlyCustomersResource implements CustomersResource<CashierProvider.Recurly> {
  constructor(private readonly client: recurly.Client) {}

  get<Relation extends CustomerRelation = never>(
    customerId: string,
    params: GetCustomerParams<Relation> = {},
  ): Promise<CustomerWith<Relation>> {
    return recurlyRequest(async () => {
      const relations: ReadonlySet<CustomerRelation> = resolveRelations(
        CashierProvider.Recurly,
        'customers',
        RECURLY_CUSTOMER_RELATIONS,
        params.with,
      );
      const customer = mapRecurlyAccount(
        await this.client.getAccount(customerId),
      );

      if (!relations.has('balances')) return customer as CustomerWith<Relation>;

      const [balance, pendingLineItems] = await Promise.all([
        this.client.getAccountBalance(customerId),
        readRecurlyItems(
          this.client.listAccountLineItems(customerId, {
            params: { state: 'pending', limit: RECURLY_MAX_LIST_LIMIT },
          }),
        ),
      ]);

      const loaded: Customer & Partial<CustomerWith<CustomerRelation>> = {
        ...customer,
        balances: mapRecurlyAccountBalances(balance, pendingLineItems),
      };

      return loaded as CustomerWith<Relation>;
    });
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

  creditBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction> {
    return this.adjustBalance(customerId, params, 'credit');
  }

  debitBalance(
    customerId: string,
    params: AdjustBalanceParams,
  ): Promise<BalanceTransaction> {
    return this.adjustBalance(customerId, params, 'charge');
  }

  private adjustBalance(
    customerId: string,
    params: AdjustBalanceParams,
    type: 'credit' | 'charge',
  ): Promise<BalanceTransaction> {
    return recurlyRequest(async () => {
      validateAdjustBalanceParams(params, CashierProvider.Recurly);

      const currency = params.currency.toUpperCase();
      const lineItems = this.client as unknown as RecurlyLineItemClient;
      const body: recurly.LineItemCreate = {
        type,
        currency,
        unitAmount: toMajorUnits(params.amount, currency),
        ...(params.description ? { description: params.description } : {}),
        ...(params.metadata
          ? { customFields: toRecurlyCustomFields(params.metadata) }
          : {}),
      };

      return mapRecurlyBalanceTransaction(
        params.idempotencyKey
          ? await lineItems.createLineItem(customerId, body, {
              headers: { 'Idempotency-Key': params.idempotencyKey },
            })
          : await lineItems.createLineItem(customerId, body),
      );
    });
  }
}
