import * as recurly from 'recurly';

interface RecurlyLineItemClient {
  createLineItem(
    accountId: string,
    body: recurly.LineItemCreate,
    options?: { headers: Record<string, string> },
  ): Promise<recurly.LineItem>;
}

export const createRecurlyLineItem = (
  client: recurly.Client,
  accountId: string,
  body: recurly.LineItemCreate,
  idempotencyKey?: string,
): Promise<recurly.LineItem> => {
  const lineItems = client as unknown as RecurlyLineItemClient;

  return idempotencyKey
    ? lineItems.createLineItem(accountId, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    : lineItems.createLineItem(accountId, body);
};
