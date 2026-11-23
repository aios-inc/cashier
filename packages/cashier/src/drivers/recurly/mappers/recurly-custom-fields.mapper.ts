import * as recurly from 'recurly';

export const mapCustomFields = (
  customFields: recurly.CustomField[] | null | undefined,
): Record<string, string> =>
  Object.fromEntries(
    (customFields ?? [])
      .filter((field) => field.name)
      .map((field) => [field.name as string, field.value ?? '']),
  );

export const toRecurlyCustomFields = (
  metadata: Record<string, string>,
): recurly.CustomField[] =>
  Object.entries(metadata).map(([name, value]) => ({ name, value }));
