import Stripe from 'stripe';
import { CashierProvider } from '../../../types/cashier.types';
import {
  PaymentMethod,
  PaymentMethodDetails,
  PaymentMethodWallet,
} from '../../../types/payment-method.types';
import { SubscriptionPaymentMethod } from '../../../types/subscription.types';
import {
  STRIPE_BANK_ACCOUNT_TYPES,
  STRIPE_WALLETS,
} from '../../../constants/cashier.constants';
import { getExpandableId, getExpanded } from './stripe-mapper.utils';

interface StripeCardDetails {
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
  wallet?: { type?: string | null } | null;
}

export interface StripePaymentMethodDetails {
  type: string;
  card?: StripeCardDetails | null;
}

const toWallet = (
  type: string | null | undefined,
): PaymentMethodWallet | null =>
  type ? (STRIPE_WALLETS[type] ?? 'other') : null;

const getBankAccountLast4 = (
  details: StripePaymentMethodDetails,
): string | null =>
  (
    details as unknown as Record<
      string,
      { last4?: string | null } | null | undefined
    >
  )[details.type]?.last4 ?? null;

export const mapStripePaymentMethodDetails = (
  details: StripePaymentMethodDetails,
): PaymentMethodDetails => {
  if (details.type === 'card') {
    const { card } = details;

    return {
      type: 'card',
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
      wallet: toWallet(card?.wallet?.type),
    };
  }

  const isBankAccount = STRIPE_BANK_ACCOUNT_TYPES.has(details.type);

  return {
    type: isBankAccount
      ? 'bank_account'
      : details.type === 'paypal'
        ? 'paypal'
        : 'other',
    brand: null,
    last4: isBankAccount ? getBankAccountLast4(details) : null,
    expMonth: null,
    expYear: null,
    wallet: details.type === 'link' ? 'link' : null,
  };
};

export const mapStripePaymentMethod = (
  paymentMethod: Stripe.PaymentMethod,
  defaultPaymentMethodId: string | null,
): PaymentMethod => ({
  id: paymentMethod.id,
  customerId: getExpandableId(paymentMethod.customer),
  ...mapStripePaymentMethodDetails(paymentMethod),
  isDefault: paymentMethod.id === defaultPaymentMethodId,
  createdAt: new Date(paymentMethod.created * 1000),
  provider: CashierProvider.Stripe,
});

export const mapStripeSubscriptionPaymentMethod = (
  paymentMethod: string | Stripe.PaymentMethod | null | undefined,
): SubscriptionPaymentMethod | null => {
  const expanded = getExpanded(paymentMethod);

  return expanded
    ? { id: expanded.id, ...mapStripePaymentMethodDetails(expanded) }
    : null;
};
