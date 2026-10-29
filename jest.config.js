module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/tests/**/*.spec.ts'],
  moduleNameMapper: {
    '^@aios-inc/cashier$': '<rootDir>/packages/cashier/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  collectCoverageFrom: ['packages/*/src/**/*.ts'],
  coverageDirectory: 'coverage',
};
