import * as recurly from 'recurly';
import { NotFoundError } from '../../errors/not-found.error';
import { PaymentMethodError } from '../../errors/payment-method.error';
import { mapRecurlyError } from './recurly-error.mapper';

export const getRecurlyBillingInfo = async (
  client: recurly.Client,
  accountId: string,
  billingInfoId: string,
): Promise<recurly.BillingInfo> => {
  try {
    return await client.getABillingInfo(accountId, billingInfoId);
  } catch (error) {
    const mapped = mapRecurlyError(error);

    if (!(mapped instanceof NotFoundError)) throw mapped;

    throw new PaymentMethodError(
      `Billing info ${billingInfoId} does not belong to account ${accountId}`,
      {
        provider: mapped.provider,
        providerStatus: mapped.providerStatus,
        providerCode: mapped.providerCode,
        cause: error,
      },
    );
  }
};
