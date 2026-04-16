import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  type CreateListingInput,
  type Listing,
  type PlatformSiteKey,
  validateListingInput,
} from "../../../domain/listing";
import type { ListingPhotoUpload } from "../types";

interface ListingFormProps {
  mode: "create" | "edit";
  listing: Listing | null;
  photos: ListingPhotoUpload[];
  initialSelectedPlatforms: PlatformSiteKey[];
  onCreate: (input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onUpdate: (listingId: string, input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onDelete: (listingId: string) => void;
  onStartCreate: () => void;
}

const emptyState: CreateListingInput = {
  selectedPlatforms: [],
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

function buildInitialState(
  listing: Listing | null,
  initialSelectedPlatforms: PlatformSiteKey[],
): CreateListingInput {
  if (!listing) {
    return {
      ...emptyState,
      selectedPlatforms: initialSelectedPlatforms,
    };
  }

  return {
    selectedPlatforms: listing.selectedPlatforms,
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
  mode,
  listing,
  photos: selectedListingPhotos,
  initialSelectedPlatforms,
  onCreate,
  onUpdate,
  onDelete,
  onStartCreate,
}: ListingFormProps) {
  const [form, setForm] = useState<CreateListingInput>(
    buildInitialState(listing, initialSelectedPlatforms),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<ListingPhotoUpload[]>([]);
  const [orderedPhotoIds, setOrderedPhotoIds] = useState<string[]>([]);
  const [showPhotoOrdering, setShowPhotoOrdering] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    setForm(buildInitialState(mode === "edit" ? listing : null, initialSelectedPlatforms));
    setPhotos(mode === "edit" ? selectedListingPhotos : []);
    setOrderedPhotoIds([]);
    setShowPhotoOrdering(false);
    setPhotoError(null);
    setErrors([]);
  }, [initialSelectedPlatforms, listing, mode, selectedListingPhotos]);

  const orderedPhotos = useMemo(() => {
    const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
    const rankedPhotos = orderedPhotoIds
      .map((photoId) => photoMap.get(photoId))
      .filter((photo): photo is ListingPhotoUpload => Boolean(photo));
    const remainingPhotos = photos.filter((photo) => !orderedPhotoIds.includes(photo.id));

    return [...rankedPhotos, ...remainingPhotos];
  }, [orderedPhotoIds, photos]);

  const usesOfferUp = form.selectedPlatforms.includes("offerup");
  const usesFacebook = form.selectedPlatforms.includes("facebook-marketplace");
  const usesCraigslist = form.selectedPlatforms.includes("craigslist");
  const usesReverb = form.selectedPlatforms.includes("reverb");
  const usesOfferUpFacebook = usesOfferUp || usesFacebook;
  const showBrand = usesOfferUp || usesCraigslist || usesReverb;
  const showModel = usesCraigslist || usesReverb;
  const showSubcategory = usesOfferUp || usesReverb;

  const selectedPlatformLabels = form.selectedPlatforms.map((platform) => {
    switch (platform) {
      case "ebay":
        return "eBay";
      case "offerup":
        return "OfferUp";
      case "facebook-marketplace":
        return "Facebook Marketplace";
      case "craigslist":
        return "Craigslist";
      case "reverb":
        return "Reverb";
    }
  });

  function updateField<Key extends keyof CreateListingInput>(
    field: Key,
    value: CreateListingInput[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const nextFiles = files.slice(0, 25);

    setPhotoError(files.length > 25 ? "You can upload up to 25 photos." : null);
    setPhotos((current) => {
      for (const photo of current) {
        URL.revokeObjectURL(photo.previewUrl);
      }

      return nextFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    });
    setOrderedPhotoIds([]);
  }

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

  function handleDelete() {
    if (!listing) {
      return;
    }

    if (!window.confirm("Are you sure you want to delete this listing?")) {
      return;
    }

    onDelete(listing.id);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextInput: CreateListingInput = {
      ...form,
      imageNames:
        orderedPhotos.length > 0
          ? orderedPhotos.map((photo) => photo.name)
          : form.imageNames,
    };
    const nextErrors = validateListingInput(nextInput);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (mode === "edit" && listing) {
      onUpdate(listing.id, nextInput, orderedPhotos.length > 0 ? orderedPhotos : selectedListingPhotos);
      return;
    }

    onCreate(nextInput, orderedPhotos);
  }

  const displayImageNames =
    orderedPhotos.length > 0 ? orderedPhotos.map((photo) => photo.name) : form.imageNames;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{mode === "edit" ? "Edit Listing" : "Create Listing"}</p>
          <h2>{mode === "edit" ? "Update listing" : "Create listing"}</h2>
        </div>
        <div className="preview-actions">
          {mode === "edit" ? (
            <button className="secondary-button" onClick={onStartCreate} type="button">
              Create a listing
            </button>
          ) : null}
          {mode === "edit" && listing ? (
            <button className="danger-button" onClick={handleDelete} type="button">
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="image-chip-row">
        {selectedPlatformLabels.map((label) => (
          <span className="image-chip" key={label}>
            {label}
          </span>
        ))}
      </div>

      <form className="listing-form" onSubmit={handleSubmit}>
        <label>
          Title
          <input
            maxLength={35}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="Fender Player Stratocaster"
            value={form.title}
          />
        </label>

        <label>
          Description
          <textarea
            onChange={(event) => updateField("description", event.target.value)}
            placeholder="Include condition details, included accessories, pickup or shipping notes, and anything a buyer should know."
            rows={7}
            value={form.description}
          />
        </label>

        <div className="form-grid">
          <label>
            Price
            <input
              min="0"
              onChange={(event) => updateField("price", Number(event.target.value))}
              placeholder="899.00"
              step="0.01"
              type="number"
              value={form.price || ""}
            />
          </label>

          <label>
            Category
            <input
              maxLength={35}
              onChange={(event) => updateField("category", event.target.value)}
              placeholder="Guitars"
              value={form.category}
            />
          </label>

          <label>
            Condition
            <input
              maxLength={35}
              onChange={(event) => updateField("condition", event.target.value)}
              placeholder="Like new"
              value={form.condition}
            />
          </label>
        </div>

        {showBrand || showModel || usesOfferUp ? (
          <div className="form-grid">
            {showBrand ? (
              <label>
                {usesCraigslist && !usesOfferUp && !usesReverb
                  ? "Make / Manufacturer (Craigslist)"
                  : "Brand / Make"}
                <input
                  maxLength={35}
                  onChange={(event) => updateField("brand", event.target.value)}
                  placeholder="Fender"
                  value={form.brand}
                />
              </label>
            ) : null}

            {showModel ? (
              <label>
                {usesCraigslist && !usesReverb ? "Model name / number (Craigslist)" : "Model"}
                <input
                  maxLength={35}
                  onChange={(event) => updateField("model", event.target.value)}
                  placeholder="Player Stratocaster"
                  value={form.model}
                />
              </label>
            ) : null}

            {usesOfferUp ? (
              <label>
                Type (OfferUp)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("type", event.target.value)}
                  placeholder="Electric Guitar"
                  value={form.type}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {usesReverb ? (
          <>
            <div className="form-grid">
              <label>
                Year (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("year", event.target.value)}
                  placeholder="2020"
                  value={form.year}
                />
              </label>

              <label>
                Finish (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("finish", event.target.value)}
                  placeholder="Sunburst"
                  value={form.finish}
                />
              </label>

              <label>
                Manufacturer's country (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("manufacturerCountry", event.target.value)}
                  placeholder="Mexico"
                  value={form.manufacturerCountry}
                />
              </label>
            </div>

            <div className="form-grid">
              {showSubcategory ? (
                <label>
                  {usesOfferUp ? "Subcategory" : "Subcategory (Reverb)"}
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("subcategory", event.target.value)}
                    placeholder="Electric Guitars"
                    value={form.subcategory}
                  />
                </label>
              ) : null}

              <label>
                Additional subcategory (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("additionalSubcategory", event.target.value)}
                  placeholder="Solid Body"
                  value={form.additionalSubcategory}
                />
              </label>

              <label>
                Shipping rate (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("shippingRate", event.target.value)}
                  placeholder="49.99"
                  value={form.shippingRate}
                />
              </label>
            </div>

            <div className="form-grid">
              <label>
                What you paid (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("purchasePrice", event.target.value)}
                  placeholder="650.00"
                  value={form.purchasePrice}
                />
              </label>

              <label>
                YouTube link (Reverb)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("youtubeLink", event.target.value)}
                  placeholder="youtu.be/..."
                  value={form.youtubeLink}
                />
              </label>
            </div>
          </>
        ) : showSubcategory ? (
          <div className="form-grid">
            <label>
              Sub-category (OfferUp)
              <input
                maxLength={35}
                onChange={(event) => updateField("subcategory", event.target.value)}
                placeholder="Electric Guitars"
                value={form.subcategory}
              />
            </label>
          </div>
        ) : null}

        {usesCraigslist ? (
          <>
            <div className="form-grid">
              <label>
                City (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("craigslistCity", event.target.value)}
                  placeholder="North Phoenix"
                  value={form.craigslistCity}
                />
              </label>

              <label>
                Zip code (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("craigslistZipCode", event.target.value)}
                  placeholder="85032"
                  value={form.craigslistZipCode}
                />
              </label>

              <label>
                Contact name (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("craigslistContactName", event.target.value)}
                  placeholder="Trey"
                  value={form.craigslistContactName}
                />
              </label>
            </div>

            <div className="form-grid">
              <label>
                Phone number (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("craigslistPhoneNumber", event.target.value)}
                  placeholder="602-555-0199"
                  value={form.craigslistPhoneNumber}
                />
              </label>

              <label>
                Size / dimensions (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) =>
                    updateField("craigslistSizeDimensions", event.target.value)
                  }
                  placeholder="24 x 16 x 6"
                  value={form.craigslistSizeDimensions}
                />
              </label>

              <label>
                Street (Craigslist)
                <input
                  maxLength={35}
                  onChange={(event) => updateField("craigslistStreet", event.target.value)}
                  placeholder="Greenway Rd"
                  value={form.craigslistStreet}
                />
              </label>
            </div>

            <label>
              Cross street (Craigslist)
              <input
                maxLength={35}
                onChange={(event) => updateField("craigslistCrossStreet", event.target.value)}
                placeholder="32nd St"
                value={form.craigslistCrossStreet}
              />
            </label>
          </>
        ) : null}

        <label>
          Photos
          <input accept="image/*" multiple onChange={handleImageChange} type="file" />
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

        {displayImageNames.length > 0 ? (
          <div className="image-chip-row">
            {displayImageNames.map((imageName, index) => (
              <span className="image-chip" key={`${imageName}-${index}`}>
                {index + 1}. {imageName}
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
          {mode === "edit" ? "Save changes" : "Save listing"}
        </button>
      </form>
    </section>
  );
}
