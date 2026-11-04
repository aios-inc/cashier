import * as recurly from 'recurly';
import { RecurlyCustomersResource } from '../../src/drivers/recurly/resources/recurly-customers.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { PaymentMethodError } from '../../src/errors/payment-method.error';
import { ValidationError } from '../../src/errors/validation.error';
import { CashierProvider } from '../../src/types/cashier.types';
import {
  RECURLY_FIXTURES,
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
});
