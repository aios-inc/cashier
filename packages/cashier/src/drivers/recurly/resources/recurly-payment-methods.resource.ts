import * as recurly from 'recurly';
import {
  ListPaymentMethodsParams,
  PaymentMethod,
  PaymentMethodsResource,
} from '../../../types/payment-method.types';
import { DEFAULT_LIST_LIMIT } from '../../../constants/cashier.constants';
import { mapRecurlyBillingInfo } from '../mappers/recurly-payment-method.mapper';
import { readRecurlyItems } from '../recurly-page';
import { recurlyRequest } from '../recurly-request';

export class RecurlyPaymentMethodsResource implements PaymentMethodsResource {
  constructor(private readonly client: recurly.Client) {}

  list({
    customer,
    limit = DEFAULT_LIST_LIMIT,
  }: ListPaymentMethodsParams): Promise<PaymentMethod[]> {
    return recurlyRequest(async () => {
      const billingInfos = await readRecurlyItems(
        this.client.listBillingInfos(customer, { params: { limit } }),
        limit,
      );
      const hasPrimary = billingInfos.some(
        (billingInfo) => billingInfo.primaryPaymentMethod,
      );

      return billingInfos.map((billingInfo) =>
        mapRecurlyBillingInfo(
          billingInfo,
          hasPrimary
            ? billingInfo.primaryPaymentMethod === true
            : billingInfos.length === 1,
        ),
      );
    });
  }
}
