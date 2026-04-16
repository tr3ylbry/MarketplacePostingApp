import { useState, type ChangeEvent, type FormEvent } from "react";
import { type CreateListingInput, validateListingInput } from "../../../domain/listing";

interface ListingFormProps {
  onCreate: (input: CreateListingInput) => void;
}

const initialState: CreateListingInput = {
  brand: "",
  model: "",
  year: "",
  finish: "",
  manufacturerCountry: "",
  category: "",
  subcategory: "",
  additionalSubcategory: "",
  title: "",
  description: "",
  price: 0,
  condition: "",
  youtubeLink: "",
  purchasePrice: "",
  shippingRate: "",
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
          Brand
          <input
            maxLength={35}
            value={form.brand}
            onChange={(event) => updateField("brand", event.target.value)}
            placeholder="Fender"
          />
        </label>

        <label>
          Model
          <input
            maxLength={35}
            value={form.model}
            onChange={(event) => updateField("model", event.target.value)}
            placeholder="Player Stratocaster"
          />
        </label>

        <div className="form-grid">
          <label>
            Year
            <input
              maxLength={35}
              value={form.year}
              onChange={(event) => updateField("year", event.target.value)}
              placeholder="2020"
            />
          </label>

          <label>
            Finish
            <input
              maxLength={35}
              value={form.finish}
              onChange={(event) => updateField("finish", event.target.value)}
              placeholder="Sunburst"
            />
          </label>

          <label>
            Manufacturer's country
            <input
              maxLength={35}
              value={form.manufacturerCountry}
              onChange={(event) =>
                updateField("manufacturerCountry", event.target.value)
              }
              placeholder="Mexico"
            />
          </label>
        </div>

        <div className="form-grid">
          <label>
            Category
            <input
              maxLength={35}
              value={form.category}
              onChange={(event) => updateField("category", event.target.value)}
              placeholder="Guitars"
            />
          </label>

          <label>
            Subcategory
            <input
              maxLength={35}
              value={form.subcategory}
              onChange={(event) => updateField("subcategory", event.target.value)}
              placeholder="Electric Guitars"
            />
          </label>

          <label>
            Additional subcategory
            <input
              maxLength={35}
              value={form.additionalSubcategory}
              onChange={(event) =>
                updateField("additionalSubcategory", event.target.value)
              }
              placeholder="Solid Body"
            />
          </label>
        </div>

        <label>
          Title
          <input
            maxLength={35}
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
            Condition
            <input
              maxLength={35}
              value={form.condition}
              onChange={(event) => updateField("condition", event.target.value)}
              placeholder="Like new"
            />
          </label>

          <label>
            Shipping rate
            <input
              maxLength={35}
              value={form.shippingRate}
              onChange={(event) => updateField("shippingRate", event.target.value)}
              placeholder="49.99"
            />
          </label>
        </div>

        <div className="form-grid">
          <label>
            What you paid
            <input
              maxLength={35}
              value={form.purchasePrice}
              onChange={(event) => updateField("purchasePrice", event.target.value)}
              placeholder="650.00"
            />
          </label>

          <label>
            YouTube link
            <input
              maxLength={35}
              value={form.youtubeLink}
              onChange={(event) => updateField("youtubeLink", event.target.value)}
              placeholder="youtu.be/..."
            />
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
