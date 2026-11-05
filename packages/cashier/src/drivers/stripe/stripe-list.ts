import Stripe from 'stripe';

export const readAllStripeItems = async <Item extends { id: string }>(
  first: Stripe.ApiList<Item>,
  fetchPage: (startingAfter: string) => Promise<Stripe.ApiList<Item>>,
): Promise<Item[]> => {
  const items = [...first.data];
  let hasMore = first.has_more;
  let last = items.at(-1);

  while (hasMore && last) {
    const page = await fetchPage(last.id);

    items.push(...page.data);
    hasMore = page.has_more;
    last = items.at(-1);
  }

  return items;
};
