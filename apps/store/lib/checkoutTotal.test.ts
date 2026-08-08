import { describe, expect, it } from "vitest";
import { computeCheckoutDisplayTotal } from "./checkoutTotal";

describe("computeCheckoutDisplayTotal", () => {
  it("returns the cart total unchanged when no delivery fee or points discount apply", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: "177.10" })).toBe("177.10");
  });

  it("adds the delivery fee — the exact regression a real checkout run surfaced (154.00 + 23.10 VAT + 15.00 delivery = 192.10, shown as 177.10 before this fix)", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: "177.10", deliveryFee: "15.00" })).toBe("192.10");
  });

  it("ignores a null delivery fee (free-delivery quote)", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: "177.10", deliveryFee: null })).toBe("177.10");
  });

  it("subtracts a points-redemption discount", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: "177.10", pointsDiscount: "20.00" })).toBe("157.10");
  });

  it("applies delivery fee and points discount together", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: "177.10", deliveryFee: "15.00", pointsDiscount: "20.00" })).toBe(
      "172.10"
    );
  });

  it("accepts numeric input the same as string input", () => {
    expect(computeCheckoutDisplayTotal({ cartTotal: 177.1, deliveryFee: 15 })).toBe("192.10");
  });
});
