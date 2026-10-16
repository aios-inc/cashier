import * as recurly from 'recurly';
import { CashierProvider } from '../../types/cashier.types';
import { ProviderError } from '../../errors/provider.error';
import { toMajorUnits } from '../../utils/money.utils';
import { toRecurlyCustomFields } from './mappers/recurly-subscription.mapper';

interface RecurlyPurchaseClient {
  createPurchase(
    body: recurly.PurchaseCreate,
    options?: { headers: Record<string, string> },
  ): Promise<recurly.InvoiceCollection>;
}

export interface RecurlyPurchaseLineItem {
  amount: number;
  description?: string;
  metadata?: Record<string, string>;
}

export const toRecurlyPurchaseLineItem = (
  currency: string,
  { amount, description, metadata }: RecurlyPurchaseLineItem,
): recurly.LineItemCreate => ({
  currency,
  unitAmount: toMajorUnits(amount, currency),
  type: 'charge',
  ...(description ? { description } : {}),
  ...(metadata ? { customFields: toRecurlyCustomFields(metadata) } : {}),
});

export const createRecurlyPurchase = async (
  client: recurly.Client,
  body: recurly.PurchaseCreate,
  idempotencyKey?: string,
): Promise<recurly.Invoice> => {
  const purchases = client as unknown as RecurlyPurchaseClient;
  const collection = idempotencyKey
    ? await purchases.createPurchase(body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    : await purchases.createPurchase(body);

  if (!collection.chargeInvoice) {
    throw new ProviderError('Recurly did not return a charge invoice', {
      provider: CashierProvider.Recurly,
    });
  }

  return collection.chargeInvoice;
};
