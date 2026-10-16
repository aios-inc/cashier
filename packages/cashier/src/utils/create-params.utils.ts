import { CashierProvider } from '../types/cashier.types';
import { CreateInvoiceParams } from '../types/invoice.types';
import { CreatePaymentParams } from '../types/payment.types';
import { ValidationError } from '../errors/validation.error';

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const fail = (message: string, provider: CashierProvider): never => {
  throw new ValidationError(message, { provider });
};

const validateCurrency = (
  currency: string,
  provider: CashierProvider,
): void => {
  if (!currency?.trim()) fail('A currency is required', provider);
};

export const validateCreateInvoiceParams = (
  {
    currency,
    lineItems,
    collection,
    chargeNow,
    dueDate,
    daysUntilDue,
  }: CreateInvoiceParams,
  provider: CashierProvider,
): void => {
  validateCurrency(currency, provider);

  if (!lineItems?.length) {
    fail('An invoice requires at least one line item', provider);
  }

  if (!lineItems.every((lineItem) => isPositiveInteger(lineItem.amount))) {
    fail(
      'Every line item amount must be a positive integer in minor units',
      provider,
    );
  }

  if (dueDate !== undefined && daysUntilDue !== undefined) {
    fail('Pass either dueDate or daysUntilDue, not both', provider);
  }

  if (
    collection !== 'send_invoice' &&
    (dueDate !== undefined || daysUntilDue !== undefined)
  ) {
    fail(
      "dueDate and daysUntilDue are only allowed with collection 'send_invoice'",
      provider,
    );
  }

  if (collection !== 'charge_automatically' && chargeNow) {
    fail(
      "chargeNow is only allowed with collection 'charge_automatically'",
      provider,
    );
  }

  if (
    daysUntilDue !== undefined &&
    !(Number.isInteger(daysUntilDue) && daysUntilDue >= 0)
  ) {
    fail('daysUntilDue must be a non-negative integer', provider);
  }

  if (dueDate !== undefined && !(dueDate.getTime() > Date.now())) {
    fail('dueDate must be in the future', provider);
  }
};

export const validateCreatePaymentParams = (
  { currency, amount }: CreatePaymentParams,
  provider: CashierProvider,
): void => {
  validateCurrency(currency, provider);

  if (!isPositiveInteger(amount)) {
    fail('The amount must be a positive integer in minor units', provider);
  }
};
