# Changelog

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every merge to `main` with a `feat` or `fix` commit is released automatically, and the notes for each version are generated from its commit messages and published on [GitHub Releases](https://github.com/aios-inc/cashier/releases).

The first release is summarized below.

## [0.1.0]

### Added

- `Cashier` class and a shared `cashier` instance with `use('stripe' | 'recurly', { apiKey })`.
- Stripe driver built on `stripe` v13 with the API version pinned to `2023-08-16`.
- Recurly driver built on `recurly` v4.
- Customers, invoices, products, prices and subscriptions resources with one set of types for both providers.
- Amounts in minor units and uppercase ISO 4217 currency codes for every provider.
- Typed errors that extend `CashierError`, mapped from Stripe and Recurly errors.
- CommonJS and ES module builds with TypeScript declarations.

[0.1.0]: https://github.com/aios-inc/cashier/releases/tag/v0.1.0
