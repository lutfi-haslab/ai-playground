import { test, expect, describe } from "bun:test";
import { calculateCartTotal } from "../src/cart";

describe("calculateCartTotal", () => {
  const sampleItems = [
    { id: "item-1", name: "Keyboard", price: 50, quantity: 2 }, // 100
    { id: "item-2", name: "Mouse", price: 25, quantity: 1 },    // 25 -> Subtotal: 125
  ];

  test("calculates subtotal and tax without coupon", () => {
    const result = calculateCartTotal(sampleItems, undefined, 0.08);
    expect(result.subtotal).toBe(125);
    expect(result.discount).toBe(0);
    expect(result.tax).toBe(10); // 125 * 0.08
    expect(result.total).toBe(135);
  });

  test("applies SAVE10 percentage discount coupon", () => {
    const result = calculateCartTotal(sampleItems, "SAVE10", 0.08);
    expect(result.subtotal).toBe(125);
    expect(result.discount).toBe(12.5); // 10% of 125
    expect(result.tax).toBe(9); // (125 - 12.5) * 0.08 = 112.5 * 0.08 = 9
    expect(result.total).toBe(121.5);
  });

  test("applies FLAT5 discount coupon", () => {
    const result = calculateCartTotal(sampleItems, "FLAT5", 0.10);
    expect(result.subtotal).toBe(125);
    expect(result.discount).toBe(5);
    expect(result.tax).toBe(12); // (125 - 5) * 0.10 = 120 * 0.10 = 12
    expect(result.total).toBe(132);
  });

  test("handles empty cart", () => {
    const result = calculateCartTotal([], "SAVE10", 0.08);
    expect(result.subtotal).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.total).toBe(0);
  });
});
