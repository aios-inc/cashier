# Cashier documentation

Start with the [main README](../README.md) for installation and a quick start. These pages cover each part of the API in detail.

## Guides

- [TypeScript](typescript.md): creating a Cashier, `use()`, credentials at runtime, passing it to your classes and testing.
- [NestJS](nestjs.md): `CashierModule.forRoot` and `forRootAsync`, `CashierService`, the exception filter and testing.
- [Express](express.md): `req.cashier`, the error handler and testing.
- [Drivers and conventions](drivers.md): what a driver has, amounts, currencies, metadata, ids and pagination.
- [Errors](errors.md): every error class, how provider errors are mapped, and the HTTP responses.

## API reference

| Resource                          | Methods                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Customers](customers.md)         | [`get`](customers.md#customersgetcustomerid), [`list`](customers.md#customerslistparams), [`create`](customers.md#customerscreateparams), [`update`](customers.md#customersupdatecustomerid-params)                                                                                                                                                                                        |
| [Invoices](invoices.md)           | [`get`](invoices.md#invoicesgetinvoiceid-params), [`list`](invoices.md#invoiceslistparams), [`cursorPaginate`](invoices.md#invoicescursorpaginateparams), [`create`](invoices.md#invoicescreateparams), [`pay`](invoices.md#invoicespayinvoiceid-params), [`void`](invoices.md#invoicesvoidinvoiceid)                                                                                      |
| [Payments](payments.md)           | [`list`](payments.md#paymentslistparams), [`cursorPaginate`](payments.md#paymentscursorpaginateparams), [`create`](payments.md#paymentscreateparams), [`refund`](payments.md#paymentsrefundpaymentid-params)                                                                                                                                                                               |
| [Products](products.md)           | [`get`](products.md#productsgetproductid), [`list`](products.md#productslistparams)                                                                                                                                                                                                                                                                                                        |
| [Prices](prices.md)               | [`get`](prices.md#pricesgetpriceid), [`list`](prices.md#priceslistparams)                                                                                                                                                                                                                                                                                                                  |
| [Subscriptions](subscriptions.md) | [`list`](subscriptions.md#subscriptionslistparams), [`cursorPaginate`](subscriptions.md#subscriptionscursorpaginateparams), [`create`](subscriptions.md#subscriptionscreateparams), [`get`](subscriptions.md#subscriptionsgetsubscriptionid), [`update`](subscriptions.md#subscriptionsupdatesubscriptionid-params), [`cancel`](subscriptions.md#subscriptionscancelsubscriptionid-params) |

Each resource page lists the parameters, what the method does on Stripe and on Recurly, and the shape of the object it returns.
