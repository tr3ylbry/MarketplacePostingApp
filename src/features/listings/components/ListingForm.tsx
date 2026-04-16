import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { type CreateListingInput, type Listing, validateListingInput } from "../../../domain/listing";
import type { ListingPhotoUpload } from "../types";

interface ListingFormProps {
  listing: Listing | null;
  photos: ListingPhotoUpload[];
  onCreate: (input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onUpdate: (listingId: string, input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onDelete: (listingId: string) => void;
}

const initialState: CreateListingInput = {
  isMusicalItem: true,
  brand: "",
  model: "",
  type: "",
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
  craigslistCity: "",
  craigslistZipCode: "",
  craigslistSizeDimensions: "",
  craigslistPhoneNumber: "",
  craigslistContactName: "",
  craigslistStreet: "",
  craigslistCrossStreet: "",
  imageNames: [],
};

function getFormState(listing: Listing | null): CreateListingInput {
  if (!listing) {
    return initialState;
  }

  return {
    isMusicalItem: listing.isMusicalItem,
    brand: listing.brand,
    model: listing.model,
    type: listing.type,
    year: listing.year,
    finish: listing.finish,
    manufacturerCountry: listing.manufacturerCountry,
    category: listing.category,
    subcategory: listing.subcategory,
    additionalSubcategory: listing.additionalSubcategory,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    condition: listing.condition,
    youtubeLink: listing.youtubeLink,
    purchasePrice: listing.purchasePrice,
    shippingRate: listing.shippingRate,
    craigslistCity: listing.craigslistCity,
    craigslistZipCode: listing.craigslistZipCode,
    craigslistSizeDimensions: listing.craigslistSizeDimensions,
    craigslistPhoneNumber: listing.craigslistPhoneNumber,
    craigslistContactName: listing.craigslistContactName,
    craigslistStreet: listing.craigslistStreet,
    craigslistCrossStreet: listing.craigslistCrossStreet,
    imageNames: listing.imageNames,
  };
}

export function ListingForm({
  listing,
  photos: selectedListingPhotos,
  onCreate,
  onUpdate,
  onDelete,
}: ListingFormProps) {
  const [form, setForm] = useState<CreateListingInput>(initialState);
  const [errors, setErrors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<ListingPhotoUpload[]>([]);
  const [orderedPhotoIds, setOrderedPhotoIds] = useState<string[]>([]);
  const [showPhotoOrdering, setShowPhotoOrdering] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  useEffect(() => {
    setForm(getFormState(isCreatingNew ? null : listing));
    setPhotos(isCreatingNew ? [] : selectedListingPhotos);
    setOrderedPhotoIds([]);
    setShowPhotoOrdering(false);
    setPhotoError(null);
    setErrors([]);
  }, [isCreatingNew, listing, selectedListingPhotos]);

  function updateField<Key extends keyof CreateListingInput>(
    field: Key,
    value: CreateListingInput[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const nextFiles = files.slice(0, 25);
    const nextPhotos = nextFiles.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPhotoError(files.length > 25 ? "You can upload up to 25 photos." : null);
    setPhotos(nextPhotos);
    setOrderedPhotoIds([]);
    updateField(
      "imageNames",
      nextFiles.map((file) => file.name),
    );
  }

  const orderedPhotos = useMemo(() => {
    const selectedById = new Map(photos.map((photo) => [photo.id, photo]));
    const ranked = orderedPhotoIds
      .map((photoId) => selectedById.get(photoId))
      .filter((photo): photo is ListingPhotoUpload => Boolean(photo));
    const remaining = photos.filter((photo) => !orderedPhotoIds.includes(photo.id));

    return [...ranked, ...remaining];
  }, [orderedPhotoIds, photos]);

  useEffect(() => {
    updateField(
      "imageNames",
      orderedPhotos.map((photo) => photo.name),
    );
  }, [orderedPhotos]);

  function handlePhotoOrderClick(photoId: string) {
    setOrderedPhotoIds((current) => {
      if (current.includes(photoId)) {
        return current;
      }

      return [...current, photoId];
    });
  }

  function undoPhotoOrder() {
    setOrderedPhotoIds((current) => current.slice(0, -1));
  }

  function resetForNewListing() {
    setIsCreatingNew(true);
    setForm(initialState);
    setErrors([]);
    setPhotoError(null);
    setOrderedPhotoIds([]);
    setShowPhotoOrdering(false);
    setPhotos([]);
  }

  function handleDelete() {
    if (!listing || isCreatingNew) {
      return;
    }

    onDelete(listing.id);
    resetForNewListing();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextInput = {
      ...form,
      imageNames: orderedPhotos.map((photo) => photo.name),
    };
    const nextErrors = validateListingInput(nextInput);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (listing && !isCreatingNew) {
      onUpdate(listing.id, nextInput, orderedPhotos);
    } else {
      onCreate(nextInput, orderedPhotos);
      setIsCreatingNew(false);
    }

    setErrors([]);
  }

  const isEditing = Boolean(listing) && !isCreatingNew;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{isEditing ? "Edit Listing" : "V1 Input"}</p>
          <h2>{isEditing ? "Update listing" : "Create listing"}</h2>
        </div>
        <div className="preview-actions">
          <button className="secondary-button" onClick={resetForNewListing} type="button">
            New listing
          </button>
          {isCreatingNew && listing ? (
            <button
              className="secondary-button"
              onClick={() => setIsCreatingNew(false)}
              type="button"
            >
              Edit selected
            </button>
          ) : null}
          {isEditing ? (
            <button className="danger-button" onClick={handleDelete} type="button">
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <form className="listing-form" onSubmit={handleSubmit}>
        <label className="checkbox-row">
          <input
            checked={form.isMusicalItem}
            onChange={(event) => updateField("isMusicalItem", event.target.checked)}
            type="checkbox"
          />
          <span>Is this a musical item?</span>
        </label>

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
              min="0"
              placeholder="899.00"
              step="0.01"
              type="number"
              value={form.price || ""}
              onChange={(event) => updateField("price", Number(event.target.value))}
            />
          </label>

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
            Condition
            <input
              maxLength={35}
              value={form.condition}
              onChange={(event) => updateField("condition", event.target.value)}
              placeholder="Like new"
            />
          </label>
        </div>

        <div className="form-grid">
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

          <label>
            Type
            <input
              maxLength={35}
              value={form.type}
              onChange={(event) => updateField("type", event.target.value)}
              placeholder="Electric Guitar"
            />
          </label>
        </div>

        {form.isMusicalItem ? (
          <>
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
          </>
        ) : null}

        <div className="form-grid">
          <label>
            Craigslist city or neighborhood
            <input
              maxLength={35}
              value={form.craigslistCity}
              onChange={(event) => updateField("craigslistCity", event.target.value)}
              placeholder="North Phoenix"
            />
          </label>

          <label>
            Craigslist zip code
            <input
              maxLength={35}
              value={form.craigslistZipCode}
              onChange={(event) => updateField("craigslistZipCode", event.target.value)}
              placeholder="85032"
            />
          </label>

          <label>
            Craigslist contact name
            <input
              maxLength={35}
              value={form.craigslistContactName}
              onChange={(event) =>
                updateField("craigslistContactName", event.target.value)
              }
              placeholder="Trey"
            />
          </label>
        </div>

        <div className="form-grid">
          <label>
            Craigslist phone number
            <input
              maxLength={35}
              value={form.craigslistPhoneNumber}
              onChange={(event) =>
                updateField("craigslistPhoneNumber", event.target.value)
              }
              placeholder="602-555-0199"
            />
          </label>

          <label>
            Craigslist size / dimensions
            <input
              maxLength={35}
              value={form.craigslistSizeDimensions}
              onChange={(event) =>
                updateField("craigslistSizeDimensions", event.target.value)
              }
              placeholder="24 x 16 x 6"
            />
          </label>

          <label>
            Craigslist street
            <input
              maxLength={35}
              value={form.craigslistStreet}
              onChange={(event) => updateField("craigslistStreet", event.target.value)}
              placeholder="Greenway Rd"
            />
          </label>
        </div>

        <label>
          Craigslist cross street
          <input
            maxLength={35}
            value={form.craigslistCrossStreet}
            onChange={(event) => updateField("craigslistCrossStreet", event.target.value)}
            placeholder="32nd St"
          />
        </label>

        <label>
          Photos
          <input accept="image/*" multiple type="file" onChange={handleImageChange} />
        </label>

        {photos.length > 0 ? (
          <div className="photo-toolbar">
            <span className="summary-pill">
              {orderedPhotoIds.length > 0
                ? `${orderedPhotoIds.length} ranked`
                : `${photos.length} uploaded`}
            </span>
            <button
              className="secondary-button"
              onClick={() => setShowPhotoOrdering((current) => !current)}
              type="button"
            >
              {showPhotoOrdering ? "Hide Photo Order" : "Order Photos"}
            </button>
            <button
              className="secondary-button"
              disabled={orderedPhotoIds.length === 0}
              onClick={undoPhotoOrder}
              type="button"
            >
              Undo
            </button>
          </div>
        ) : null}

        {showPhotoOrdering && photos.length > 0 ? (
          <div className="photo-order-panel">
            <p className="photo-order-copy">
              Click photos from most important to least important. Number badges
              show the upload order each platform preview will use first.
            </p>
            <div className="photo-grid">
              {photos.map((photo) => {
                const order = orderedPhotoIds.indexOf(photo.id);

                return (
                  <button
                    className={`photo-tile ${order >= 0 ? "ranked" : ""}`}
                    key={photo.id}
                    onClick={() => handlePhotoOrderClick(photo.id)}
                    type="button"
                  >
                    <img alt={photo.name} src={photo.previewUrl} />
                    <span className="photo-name">{photo.name}</span>
                    {order >= 0 ? <span className="photo-rank">{order + 1}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {orderedPhotos.length > 0 ? (
          <div className="image-chip-row">
            {orderedPhotos.map((photo, index) => (
              <span className="image-chip" key={photo.id}>
                {index + 1}. {photo.name}
              </span>
            ))}
          </div>
        ) : null}

        {photoError ? <p className="photo-error">{photoError}</p> : null}

        {errors.length > 0 ? (
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        <button className="primary-button" type="submit">
          {isEditing ? "Save changes" : "Save listing"}
        </button>
      </form>
    </section>
  );
}
