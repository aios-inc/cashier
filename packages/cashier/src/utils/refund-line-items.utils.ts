import { CashierProvider } from '../types/cashier.types';
import {
  InvoiceLineItem,
  InvoiceLineItemRefund,
  RefundInvoiceLineItemsParams,
} from '../types/invoice.types';
import { ValidationError } from '../errors/validation.error';

const fail = (message: string, provider: CashierProvider): never => {
  throw new ValidationError(message, { provider });
};

export const validateRefundLineItemsParams = (
  { lineItems }: RefundInvoiceLineItemsParams,
  provider: CashierProvider,
): void => {
  if (!lineItems?.length) {
    fail('A refund requires at least one line item', provider);
  }

  const lineItemIds = lineItems.map(({ lineItemId }) => lineItemId);

  if (new Set(lineItemIds).size !== lineItemIds.length) {
    fail('Each line item can only be refunded once per refund', provider);
  }

  if (
    !lineItems.every(
      ({ amount }) =>
        amount === undefined || (Number.isInteger(amount) && amount > 0),
    )
  ) {
    fail(
      'Every refund amount must be a positive integer in minor units',
      provider,
    );
  }
};

export const resolveRefundLineItems = (
  invoiceId: string,
  invoiceLineItems: InvoiceLineItem[],
  { lineItems }: RefundInvoiceLineItemsParams,
  provider: CashierProvider,
  { checkRemaining = true }: { checkRemaining?: boolean } = {},
): InvoiceLineItemRefund[] =>
  lineItems.map(({ lineItemId, amount }) => {
    const lineItem = invoiceLineItems.find(({ id }) => id === lineItemId);

    if (!lineItem) {
      return fail(
        `Line item ${lineItemId} is not on invoice ${invoiceId}`,
        provider,
      );
    }

    const refundable = Math.max(lineItem.amount - lineItem.amountRefunded, 0);
    const refundAmount = amount ?? refundable;

    if (!checkRemaining && amount !== undefined) {
      return { lineItemId, amount };
    }

    if (refundAmount <= 0 || refundAmount > refundable) {
      return fail(
        `Line item ${lineItemId} has ${refundable} left to refund`,
        provider,
      );
    }

    return { lineItemId, amount: refundAmount };
  });

export const assertPaymentCoversRefund = (
  invoiceId: string,
  refundAmount: number,
  paymentRemaining: number,
  provider: CashierProvider,
): void => {
  if (refundAmount > paymentRemaining) {
    fail(
      `Invoice ${invoiceId} has ${Math.max(paymentRemaining, 0)} left to refund on its payment`,
      provider,
    );
  }
};
