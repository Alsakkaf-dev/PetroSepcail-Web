// The checkout summary shows delivery fee and points-redemption discount as
// their own rows, but until this existed the "Total" row above them was
// cart.totals.total on its own — fixed at the moment the cart was fetched,
// never adjusted for either. A customer saw one figure through all four
// checkout steps and was charged a different one (confirmed against a real
// order: the two only ever matched when delivery was free and no points
// were redeemed). The server has always charged correctly; only this
// on-screen running total was wrong.
export interface DisplayTotalInput {
  cartTotal: string | number;
  deliveryFee?: string | number | null;
  pointsDiscount?: string | number | null;
}

export function computeCheckoutDisplayTotal({ cartTotal, deliveryFee, pointsDiscount }: DisplayTotalInput): string {
  let total = Number(cartTotal);
  if (deliveryFee != null) total += Number(deliveryFee);
  if (pointsDiscount != null) total -= Number(pointsDiscount);
  return total.toFixed(2);
}
