import { moneySchema, type Money } from "../domain/money";

interface ReverbValues {
  brand?: string;
  model?: string;
  category?: string;
  title?: string;
  description?: string;
  price?: Money;
  shippingRate?: Money;
}

export function reverbRequiredErrors(values: ReverbValues) {
  const errors: Partial<Record<keyof ReverbValues, string>> = {};
  if (!values.brand?.trim()) errors.brand = "Brand / Make is required for Reverb.";
  if (!values.model?.trim()) errors.model = "Model is required for Reverb.";
  if (!values.category?.trim()) errors.category = "Category is required for Reverb; confirm a suggested category when posting.";
  if (!values.title?.trim()) errors.title = "Listing title is required for Reverb.";
  if (!values.description?.trim()) errors.description = "Description is required for Reverb.";
  if (!moneySchema.safeParse(values.price).success || !(values.price && values.price.amount > 0)) {
    errors.price = "Listing price is required for Reverb.";
  }
  if (!moneySchema.safeParse(values.shippingRate).success) errors.shippingRate = "Shipping rate is required for Reverb.";
  return errors;
}
