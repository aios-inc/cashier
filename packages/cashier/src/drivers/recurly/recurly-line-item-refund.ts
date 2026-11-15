import * as recurly from 'recurly';
import { RECURLY_LINE_ITEM_REFUND_METHOD } from '../../constants/cashier.constants';
import { InvoiceLineItemRefund } from '../../types/invoice.types';
import { toMajorUnits } from '../../utils/money.utils';

interface RecurlyRefundClient {
  refundInvoice(
    invoiceId: string,
    body: recurly.InvoiceRefund,
    options?: { headers: Record<string, string> },
  ): Promise<recurly.Invoice>;
}

export const refundRecurlyLineItems = (
  client: recurly.Client,
  invoiceId: string,
  currency: string,
  lineItems: InvoiceLineItemRefund[],
  idempotencyKey?: string,
): Promise<recurly.Invoice> => {
  const refunds = client as unknown as RecurlyRefundClient;
  const body: recurly.InvoiceRefund = {
    type: 'line_items',
    refundMethod: RECURLY_LINE_ITEM_REFUND_METHOD,
    lineItems: lineItems.map(({ lineItemId, amount }) => ({
      id: lineItemId,
      amount: toMajorUnits(amount, currency),
    })),
  };

  return idempotencyKey
    ? refunds.refundInvoice(invoiceId, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    : refunds.refundInvoice(invoiceId, body);
};
