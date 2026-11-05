import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import {
  PaymentMethod,
  PaymentMethodDetails,
  PaymentMethodType,
} from '../../../types/payment-method.types';
import { SubscriptionPaymentMethod } from '../../../types/subscription.types';
import {
  RECURLY_BANK_ACCOUNT_OBJECTS,
  RECURLY_CARD_BRANDS,
  RECURLY_PAYPAL_OBJECTS,
  RECURLY_WALLETS,
} from '../../../constants/cashier.constants';

const mapRecurlyCardBrand = (
  cardType: string | null | undefined,
): string | null => {
  const brand = cardType?.toLowerCase();

  return brand ? (RECURLY_CARD_BRANDS[brand] ?? brand) : null;
};

const mapRecurlyPaymentMethodType = (
  object: string,
  isCard: boolean,
): PaymentMethodType => {
  if (isCard) return 'card';
  if (RECURLY_BANK_ACCOUNT_OBJECTS.has(object)) return 'bank_account';
  if (RECURLY_PAYPAL_OBJECTS.has(object)) return 'paypal';

  return 'other';
};

export const mapRecurlyPaymentMethodDetails = (
  paymentMethod: recurly.PaymentMethod,
): PaymentMethodDetails => {
  const object = paymentMethod.object ?? '';
  const wallet = RECURLY_WALLETS[object] ?? null;
  const isCard = object === 'credit_card' || wallet !== null;

  return {
    type: mapRecurlyPaymentMethodType(object, isCard),
    brand: isCard ? mapRecurlyCardBrand(paymentMethod.cardType) : null,
    last4: paymentMethod.lastFour ?? null,
    expMonth: isCard ? (paymentMethod.expMonth ?? null) : null,
    expYear: isCard ? (paymentMethod.expYear ?? null) : null,
    wallet,
  };
};

const mapRecurlyBillingInfoDetails = (
  billingInfo: recurly.BillingInfo,
): PaymentMethodDetails =>
  mapRecurlyPaymentMethodDetails(billingInfo.paymentMethod ?? {});

export const mapRecurlyBillingInfo = (
  billingInfo: recurly.BillingInfo,
  isDefault: boolean,
): PaymentMethod => ({
  id: billingInfo.id ?? '',
  customerId: billingInfo.accountId ?? null,
  ...mapRecurlyBillingInfoDetails(billingInfo),
  isDefault,
  createdAt: billingInfo.createdAt ?? null,
  provider: CashierProvider.Recurly,
});

export const mapRecurlySubscriptionPaymentMethod = (
  billingInfo: recurly.BillingInfo | null,
): SubscriptionPaymentMethod | null =>
  billingInfo
    ? { id: billingInfo.id ?? '', ...mapRecurlyBillingInfoDetails(billingInfo) }
    : null;
