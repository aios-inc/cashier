import * as recurly from 'recurly';
import { CashierProvider } from '../../../types/cashier.types';
import { Refund, RefundStatus } from '../../../types/payment.types';
import { toMinorUnits } from '../../../utils/money.utils';

const RECURLY_REFUND_STATUSES: Record<string, RefundStatus> = {
  success: 'succeeded',
  pending: 'pending',
  processing: 'pending',
  scheduled: 'pending',
  declined: 'failed',
  error: 'failed',
  void: 'canceled',
};

const findRefundTransaction = (
  transactions: recurly.Transaction[] | null | undefined,
  paymentId: string,
): recurly.Transaction | undefined => {
  const refunds = (transactions ?? []).filter(
    (transaction) => transaction.type === 'refund',
  );

  return (
    refunds.find(
      (transaction) => transaction.originalTransactionId === paymentId,
    ) ?? refunds[0]
  );
};

export const mapRecurlyRefund = (
  creditInvoice: recurly.Invoice,
  paymentId: string,
): Refund => {
  const transaction = findRefundTransaction(
    creditInvoice.transactions,
    paymentId,
  );
  const currency = (
    transaction?.currency ??
    creditInvoice.currency ??
    ''
  ).toUpperCase();

  return {
    id: transaction?.id ?? creditInvoice.id ?? '',
    paymentId,
    status: transaction
      ? (RECURLY_REFUND_STATUSES[transaction.status ?? ''] ?? 'unknown')
      : 'unknown',
    amount: toMinorUnits(
      Math.abs(transaction?.amount ?? creditInvoice.total ?? 0),
      currency,
    ),
    currency,
    reason: null,
    createdAt: transaction?.createdAt ?? creditInvoice.createdAt ?? new Date(0),
    provider: CashierProvider.Recurly,
  };
};

export const mapRecurlyRefundTransaction = (
  transaction: recurly.Transaction,
  paymentId: string,
): Refund => {
  const currency = (transaction.currency ?? '').toUpperCase();

  return {
    id: transaction.id ?? '',
    paymentId,
    status: RECURLY_REFUND_STATUSES[transaction.status ?? ''] ?? 'unknown',
    amount: toMinorUnits(Math.abs(transaction.amount ?? 0), currency),
    currency,
    reason: null,
    createdAt: transaction.createdAt ?? new Date(0),
    provider: CashierProvider.Recurly,
  };
};
