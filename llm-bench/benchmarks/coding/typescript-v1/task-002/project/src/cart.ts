export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CartCalculation {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export function calculateCartTotal(
  items: CartItem[],
  couponCode?: string,
  taxRate: number = 0.08
): CartCalculation {
  // UNIMPLEMENTED STUB
  return {
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
  };
}
