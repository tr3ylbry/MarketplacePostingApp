import { z } from "zod";

export const moneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.literal("USD"),
});
export type Money = z.infer<typeof moneySchema>;

export function createMoney(amount: number): Money {
  return moneySchema.parse({ amount, currency: "USD" });
}

export function formatMoney(money: Money | undefined): string {
  return money ? money.amount.toFixed(2) : "";
}
