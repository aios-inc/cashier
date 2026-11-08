import * as recurly from 'recurly';
import { RecurlyCustomersResource } from '../../src/drivers/recurly/resources/recurly-customers.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { UnsupportedOperationError } from '../../src/errors/unsupported-operation.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  RECURLY_FIXTURES,
  createFailingRecurlyPager,
  createRecurlyPager,
  withRecurlyStatus,
} from '../fixtures/recurly.fixtures';
import {
  RecurlyClientMock,
  asRecurlyClient,
  createRecurlyClientMock,
} from '../fixtures/recurly-client.mock';

describe('RecurlyCustomersResource', () => {
  let client: RecurlyClientMock;
  let customers: RecurlyCustomersResource;

  beforeEach(() => {
    client = createRecurlyClientMock();
    customers = new RecurlyCustomersResource(asRecurlyClient(client));
  });

  describe('get', () => {
    it('should retrieve the account and map it to a customer', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);

      const customer = await customers.get(RECURLY_FIXTURES.ACCOUNT_ID);

      expect(client.getAccount).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
      );
      expect(customer).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]);
    });

    it('should map a missing account to NotFoundError', async () => {
      client.getAccount.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        customers.get(RECURLY_FIXTURES.ACCOUNT_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list', () => {
    it('should list accounts with the default limit and map them', async () => {
      client.listAccounts.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.ACCOUNTS),
      );

      const result = await customers.list();

      expect(client.listAccounts).toHaveBeenCalledWith({
        params: { limit: 100 },
      });
      expect(result).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS);
    });

    it('should filter accounts by email', async () => {
      client.listAccounts.mockReturnValue(createRecurlyPager([]));

      await customers.list({ email: RECURLY_FIXTURES.CUSTOMER_EMAIL });

      expect(client.listAccounts).toHaveBeenCalledWith({
        params: { limit: 100, email: RECURLY_FIXTURES.CUSTOMER_EMAIL },
      });
    });

    it('should stop reading pages once the limit is reached', async () => {
      client.listAccounts.mockReturnValue(
        createRecurlyPager(RECURLY_FIXTURES.ACCOUNTS),
      );

      const result = await customers.list({ limit: 1 });

      expect(result).toEqual([RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]]);
    });
  });

  describe('create', () => {
    it('should create the account with its code, name parts and custom fields', async () => {
      client.createAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);

      const customer = await customers.create({
        email: RECURLY_FIXTURES.CUSTOMER_EMAIL,
        code: RECURLY_FIXTURES.ACCOUNT_CODE,
        firstName: 'Jane',
        lastName: 'Doe',
        metadata: { source: 'checkout' },
      });

      expect(client.createAccount).toHaveBeenCalledWith({
        code: RECURLY_FIXTURES.ACCOUNT_CODE,
        email: RECURLY_FIXTURES.CUSTOMER_EMAIL,
        firstName: 'Jane',
        lastName: 'Doe',
        customFields: [{ name: 'source', value: 'checkout' }],
      });
      expect(customer).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]);
    });

    it('should reject a customer without a code without calling Recurly', async () => {
      await expect(
        customers.create({ email: RECURLY_FIXTURES.CUSTOMER_EMAIL }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(client.createAccount).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update only the fields that are given', async () => {
      client.updateAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);

      const customer = await customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
        lastName: 'Doe',
        metadata: { source: 'checkout' },
      });

      expect(client.updateAccount).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          lastName: 'Doe',
          customFields: [{ name: 'source', value: 'checkout' }],
        },
      );
      expect(customer).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]);
    });

    it('should make the billing info the primary payment method without updating the account', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
        primaryPaymentMethod: false,
      });
      client.updateABillingInfo.mockResolvedValue({});

      const customer = await customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
        defaultPaymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
      });

      expect(client.getABillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        RECURLY_FIXTURES.BILLING_INFO_ID,
      );
      expect(client.updateABillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        RECURLY_FIXTURES.BILLING_INFO_ID,
        { primaryPaymentMethod: true },
      );
      expect(client.updateAccount).not.toHaveBeenCalled();
      expect(customer).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]);
    });

    it('should leave a billing info that is already primary unchanged', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
        primaryPaymentMethod: true,
      });

      const customer = await customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
        defaultPaymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
      });

      expect(client.updateABillingInfo).not.toHaveBeenCalled();
      expect(customer).toEqual(RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0]);
    });

    it('should update the account fields and the primary billing info together', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getABillingInfo.mockResolvedValue({
        id: RECURLY_FIXTURES.BILLING_INFO_ID,
        primaryPaymentMethod: false,
      });
      client.updateAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.updateABillingInfo.mockResolvedValue({});

      await customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
        email: RECURLY_FIXTURES.CUSTOMER_EMAIL,
        defaultPaymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
      });

      expect(client.updateAccount).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { email: RECURLY_FIXTURES.CUSTOMER_EMAIL },
      );
      expect(client.updateABillingInfo).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        RECURLY_FIXTURES.BILLING_INFO_ID,
        { primaryPaymentMethod: true },
      );
    });

    it('should reject a billing info that is not on the account with PaymentMethodError, before any write', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getABillingInfo.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
          email: RECURLY_FIXTURES.CUSTOMER_EMAIL,
          defaultPaymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        }),
      ).rejects.toMatchObject({
        constructor: PaymentMethodError,
        provider: CashierProvider.Recurly,
        providerStatus: 404,
        providerCode: 'not_found',
      });
      expect(client.updateAccount).not.toHaveBeenCalled();
      expect(client.updateABillingInfo).not.toHaveBeenCalled();
    });

    it('should keep a missing account as NotFoundError', async () => {
      client.getAccount.mockRejectedValue(
        withRecurlyStatus(
          new recurly.errors.NotFoundError('Not found', 'not_found', {}),
          404,
        ),
      );

      await expect(
        customers.update(RECURLY_FIXTURES.ACCOUNT_ID, {
          defaultPaymentMethod: RECURLY_FIXTURES.BILLING_INFO_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(client.getABillingInfo).not.toHaveBeenCalled();
    });
  });

  describe('get with balances', () => {
    it('should combine available credit and pending line items per currency', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getAccountBalance.mockResolvedValue({
        balances: [
          { currency: 'usd', amount: 20, availableCreditAmount: 25 },
          { currency: 'JPY', amount: 0, availableCreditAmount: 0 },
        ],
      });
      client.listAccountLineItems.mockReturnValue(
        createRecurlyPager([
          { currency: 'USD', amount: 10.5 },
          { currency: 'usd', amount: -4 },
          { currency: 'EUR', amount: -12.25 },
        ]),
      );

      const customer = await customers.get(RECURLY_FIXTURES.ACCOUNT_ID, {
        with: ['balances'],
      });

      expect(client.getAccountBalance).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
      );
      expect(client.listAccountLineItems).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { state: 'pending', limit: 200 } },
      );
      expect(customer).toEqual({
        ...RECURLY_FIXTURES.EXPECTED_CUSTOMERS[0],
        balances: [
          { currency: 'USD', amount: -1850 },
          { currency: 'JPY', amount: 0 },
          { currency: 'EUR', amount: -1225 },
        ],
      });
    });

    it('should return no balances for an account without any', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getAccountBalance.mockResolvedValue({ balances: null });
      client.listAccountLineItems.mockReturnValue(createRecurlyPager([]));

      const customer = await customers.get(RECURLY_FIXTURES.ACCOUNT_ID, {
        with: ['balances'],
      });

      expect(customer.balances).toEqual([]);
    });

    it('should not request balances without the relation', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);

      await customers.get(RECURLY_FIXTURES.ACCOUNT_ID);

      expect(client.getAccountBalance).not.toHaveBeenCalled();
      expect(client.listAccountLineItems).not.toHaveBeenCalled();
    });

    it('should reject a relation Recurly does not support without calling Recurly', async () => {
      await expect(
        customers.get(RECURLY_FIXTURES.ACCOUNT_ID, {
          with: ['invoices' as 'balances'],
        }),
      ).rejects.toMatchObject({
        constructor: UnsupportedOperationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.getAccount).not.toHaveBeenCalled();
    });

    it('should map a failing pending line items request', async () => {
      client.getAccount.mockResolvedValue(RECURLY_FIXTURES.FULL_ACCOUNT);
      client.getAccountBalance.mockResolvedValue({ balances: [] });
      client.listAccountLineItems.mockReturnValue(
        createFailingRecurlyPager(
          withRecurlyStatus(
            new recurly.errors.NotFoundError('Not found', 'not_found', {}),
            404,
          ),
        ),
      );

      await expect(
        customers.get(RECURLY_FIXTURES.ACCOUNT_ID, { with: ['balances'] }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('creditBalance', () => {
    it('should add a pending credit line item in major units', async () => {
      client.createLineItem.mockResolvedValue({
        id: 'li_1',
        account: { id: RECURLY_FIXTURES.ACCOUNT_ID },
        currency: 'USD',
        amount: -25,
        description: 'Goodwill',
        createdAt: new Date('2026-01-10T00:00:00Z'),
      });

      const transaction = await customers.creditBalance(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { amount: 2500, currency: 'usd', description: 'Goodwill' },
      );

      expect(client.createLineItem).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          type: 'credit',
          currency: 'USD',
          unitAmount: 25,
          description: 'Goodwill',
        },
      );
      expect(transaction).toEqual({
        id: 'li_1',
        customerId: RECURLY_FIXTURES.ACCOUNT_ID,
        amount: -2500,
        currency: 'USD',
        description: 'Goodwill',
        endingBalance: null,
        createdAt: new Date('2026-01-10T00:00:00Z'),
        provider: CashierProvider.Recurly,
      });
    });

    it('should save the metadata as custom fields and pass the idempotency key as a request header', async () => {
      client.createLineItem.mockResolvedValue({
        id: 'li_1',
        currency: 'USD',
        amount: -25,
      });

      await customers.creditBalance(RECURLY_FIXTURES.ACCOUNT_ID, {
        amount: 2500,
        currency: 'USD',
        metadata: { source: 'support' },
        idempotencyKey: 'credit-42',
      });

      expect(client.createLineItem).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        {
          type: 'credit',
          currency: 'USD',
          unitAmount: 25,
          customFields: [{ name: 'source', value: 'support' }],
        },
        { headers: { 'Idempotency-Key': 'credit-42' } },
      );
    });
  });

  describe('debitBalance', () => {
    it('should add a pending charge line item without a description', async () => {
      client.createLineItem.mockResolvedValue({
        id: 'li_2',
        account: null,
        currency: 'JPY',
        amount: 1000,
        description: null,
        createdAt: null,
      });

      const transaction = await customers.debitBalance(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { amount: 1000, currency: 'JPY' },
      );

      expect(client.createLineItem).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { type: 'charge', currency: 'JPY', unitAmount: 1000 },
      );
      expect(transaction).toEqual({
        id: 'li_2',
        customerId: null,
        amount: 1000,
        currency: 'JPY',
        description: null,
        endingBalance: null,
        createdAt: new Date(0),
        provider: CashierProvider.Recurly,
      });
    });

    it.each([
      ['a zero amount', { amount: 0, currency: 'USD' }],
      ['a fractional amount', { amount: 10.5, currency: 'USD' }],
      ['a missing currency', { amount: 1000, currency: ' ' }],
    ])('should reject %s without calling Recurly', async (_case, params) => {
      await expect(
        customers.debitBalance(RECURLY_FIXTURES.ACCOUNT_ID, params),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        provider: CashierProvider.Recurly,
      });
      expect(client.createLineItem).not.toHaveBeenCalled();
    });
  });
});
