import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  type CreateListingInput,
  type ListingCategory,
  type ListingCondition,
  validateListingInput,
} from "../../../domain/listing";

interface ListingFormProps {
  onCreate: (input: CreateListingInput) => void;
}

const categories: ListingCategory[] = [
  "electronics",
  "instruments",
  "home",
  "collectibles",
  "other",
];

const conditions: ListingCondition[] = [
  "new",
  "like-new",
  "good",
  "fair",
  "parts-or-repair",
];

const initialState: CreateListingInput = {
  title: "",
  description: "",
  price: 0,
  category: "electronics",
  condition: "good",
  imageNames: [],
};

export function ListingForm({ onCreate }: ListingFormProps) {
  const [form, setForm] = useState<CreateListingInput>(initialState);
  const [errors, setErrors] = useState<string[]>([]);

  function updateField<Key extends keyof CreateListingInput>(
    field: Key,
    value: CreateListingInput[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    updateField(
      "imageNames",
      files.map((file) => file.name),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateListingInput(form);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    onCreate(form);
    setForm(initialState);
    setErrors([]);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">V1 Input</p>
          <h2>Create listing</h2>
        </div>
      </div>

      <form className="listing-form" onSubmit={handleSubmit}>
        <label>
          Title
          <input
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="Fender Player Stratocaster"
          />
        </label>

        <label>
          Description
          <textarea
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            rows={7}
            placeholder="Include condition details, included accessories, pickup or shipping notes, and anything a buyer should know."
          />
        </label>

        <div className="form-grid">
          <label>
            Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price || ""}
              onChange={(event) => updateField("price", Number(event.target.value))}
              placeholder="899.00"
            />
          </label>

          <label>
            Category
            <select
              value={form.category}
              onChange={(event) =>
                updateField("category", event.target.value as ListingCategory)
              }
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            Condition
            <select
              value={form.condition}
              onChange={(event) =>
                updateField("condition", event.target.value as ListingCondition)
              }
            >
              {conditions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Images
          <input type="file" multiple onChange={handleImageChange} />
        </label>

        {form.imageNames.length > 0 ? (
          <div className="image-chip-row">
            {form.imageNames.map((imageName) => (
              <span className="image-chip" key={imageName}>
                {imageName}
              </span>
            ))}
          </div>
        ) : null}

        {errors.length > 0 ? (
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        <button className="primary-button" type="submit">
          Save listing
        </button>
      </form>
    </section>
  );
}
