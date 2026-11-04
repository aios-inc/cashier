import * as recurly from 'recurly';
import { RecurlyPaymentMethodsResource } from '../../src/drivers/recurly/resources/recurly-payment-methods.resource';
import { NotFoundError } from '../../src/errors/not-found.error';
import { CashierProvider } from '../../src/types/cashier.types';
import { PaymentMethod } from '../../src/types/payment-method.types';
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

const createBillingInfo = (
  id: string,
  paymentMethod: recurly.PaymentMethod,
  primaryPaymentMethod: boolean | null = false,
) =>
  ({
    id,
    accountId: RECURLY_FIXTURES.ACCOUNT_ID,
    paymentMethod,
    primaryPaymentMethod,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }) as recurly.BillingInfo;

const CARD = {
  object: 'credit_card',
  cardType: 'Visa',
  lastFour: '4242',
  expMonth: 12,
  expYear: 2028,
};

describe('RecurlyPaymentMethodsResource', () => {
  let client: RecurlyClientMock;
  let paymentMethods: RecurlyPaymentMethodsResource;

  const listOne = async (paymentMethod: recurly.PaymentMethod) => {
    client.listBillingInfos.mockReturnValue(
      createRecurlyPager([createBillingInfo('bi_1', paymentMethod, true)]),
    );

    const [result] = await paymentMethods.list({
      customer: RECURLY_FIXTURES.ACCOUNT_ID,
    });

    return result;
  };

  beforeEach(() => {
    client = createRecurlyClientMock();
    paymentMethods = new RecurlyPaymentMethodsResource(asRecurlyClient(client));
  });

  describe('list', () => {
    it('should list the account billing infos with the default limit and map them', async () => {
      client.listBillingInfos.mockReturnValue(
        createRecurlyPager([
          createBillingInfo('bi_1', CARD, true),
          createBillingInfo('bi_2', {
            object: 'paypal_billing_agreement',
            billingAgreementId: 'B-123',
          }),
        ]),
      );

      const result = await paymentMethods.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(client.listBillingInfos).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 100 } },
      );
      expect(result).toEqual([
        {
          id: 'bi_1',
          customerId: RECURLY_FIXTURES.ACCOUNT_ID,
          type: 'card',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2028,
          wallet: null,
          isDefault: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          provider: CashierProvider.Recurly,
        },
        {
          id: 'bi_2',
          customerId: RECURLY_FIXTURES.ACCOUNT_ID,
          type: 'paypal',
          brand: null,
          last4: null,
          expMonth: null,
          expYear: null,
          wallet: null,
          isDefault: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          provider: CashierProvider.Recurly,
        },
      ] satisfies PaymentMethod[]);
    });

    it('should pass the given limit and stop reading once it is reached', async () => {
      client.listBillingInfos.mockReturnValue(
        createRecurlyPager([
          createBillingInfo('bi_1', CARD, true),
          createBillingInfo('bi_2', CARD),
        ]),
      );

      const result = await paymentMethods.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
        limit: 1,
      });

      expect(client.listBillingInfos).toHaveBeenCalledWith(
        RECURLY_FIXTURES.ACCOUNT_ID,
        { params: { limit: 1 } },
      );
      expect(result).toHaveLength(1);
    });

    it.each([
      ['Visa', 'visa'],
      ['MasterCard', 'mastercard'],
      ['American Express', 'amex'],
      ['Diners Club', 'diners'],
      ['Union Pay', 'unionpay'],
      ['Elo', 'elo'],
    ])('should map the %s card type to %s', async (cardType, brand) => {
      const result = await listOne({ ...CARD, cardType });

      expect(result?.brand).toBe(brand);
    });

    it.each([
      ['apple_pay', 'apple_pay'],
      ['braintree_apple_pay', 'apple_pay'],
      ['google_pay', 'google_pay'],
      ['google_pay_device_pan', 'google_pay'],
    ])('should map a %s wallet to a card', async (object, wallet) => {
      const result = await listOne({ ...CARD, object });

      expect(result).toMatchObject({
        type: 'card',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2028,
        wallet,
      });
    });

    it.each([
      ['paypal_billing_agreement', 'paypal'],
      ['braintree_paypal', 'paypal'],
      ['iban_bank_account', 'bank_account'],
      ['bank_account_info', 'bank_account'],
      ['amazon_billing_agreement', 'other'],
    ])('should map a %s billing info to %s', async (object, type) => {
      const result = await listOne({
        object,
        cardType: 'Visa',
        lastFour: '6789',
        expMonth: 1,
        expYear: 2030,
      });

      expect(result).toMatchObject({
        type,
        brand: null,
        last4: '6789',
        expMonth: null,
        expYear: null,
        wallet: null,
      });
    });

    it('should map a billing info without a payment method to other', async () => {
      client.listBillingInfos.mockReturnValue(
        createRecurlyPager([{ id: 'bi_1' } as recurly.BillingInfo]),
      );

      const [result] = await paymentMethods.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(result).toEqual({
        id: 'bi_1',
        customerId: null,
        type: 'other',
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null,
        wallet: null,
        isDefault: true,
        createdAt: null,
        provider: CashierProvider.Recurly,
      });
    });

    it('should treat a single billing info without the primary flag as the default', async () => {
      client.listBillingInfos.mockReturnValue(
        createRecurlyPager([createBillingInfo('bi_1', CARD, null)]),
      );

      const [result] = await paymentMethods.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(result?.isDefault).toBe(true);
    });

    it('should not mark any billing info as default when several have no primary flag', async () => {
      client.listBillingInfos.mockReturnValue(
        createRecurlyPager([
          createBillingInfo('bi_1', CARD, null),
          createBillingInfo('bi_2', CARD, null),
        ]),
      );

      const result = await paymentMethods.list({
        customer: RECURLY_FIXTURES.ACCOUNT_ID,
      });

      expect(result.map((method) => method.isDefault)).toEqual([false, false]);
    });

    it('should map a missing account to NotFoundError', async () => {
      client.listBillingInfos.mockReturnValue(
        createFailingRecurlyPager(
          withRecurlyStatus(
            new recurly.errors.NotFoundError('Not found', 'not_found', {}),
            404,
          ),
        ),
      );

      await expect(
        paymentMethods.list({ customer: RECURLY_FIXTURES.ACCOUNT_ID }),
      ).rejects.toMatchObject({
        constructor: NotFoundError,
        provider: CashierProvider.Recurly,
      });
    });
  });
});
