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
  ebayCategory: "",
  offerupCategory: "",
  offerupSubcategory: "",
  facebookCategory: "",
  craigslistCategory: "",
  reverbCategory: "",
  reverbSubcategory: "",
  reverbAdditionalSubcategory: "",
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
    ebayCategory: listing.ebayCategory,
    offerupCategory: listing.offerupCategory,
    offerupSubcategory: listing.offerupSubcategory,
    facebookCategory: listing.facebookCategory,
    craigslistCategory: listing.craigslistCategory,
    reverbCategory: listing.reverbCategory,
    reverbSubcategory: listing.reverbSubcategory,
    reverbAdditionalSubcategory: listing.reverbAdditionalSubcategory,
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

function formatCurrencyDigits(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return (Number(digits) / 100).toFixed(2);
}

function parseCurrencyValue(value: string) {
  return value ? Number(value) : 0;
}

function RequiredLabel({
  label,
  required,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <span className="field-label">
      {label}
      {required ? <span className="required-indicator">*</span> : null}
    </span>
  );
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
  const [submitAttempted, setSubmitAttempted] = useState(false);
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
    setSubmitAttempted(false);
  }, [initialSelectedPlatforms, listing, mode, selectedListingPhotos]);

  const orderedPhotos = useMemo(() => {
    const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
    const rankedPhotos = orderedPhotoIds
      .map((photoId) => photoMap.get(photoId))
      .filter((photo): photo is ListingPhotoUpload => Boolean(photo));
    const remainingPhotos = photos.filter((photo) => !orderedPhotoIds.includes(photo.id));

    return [...rankedPhotos, ...remainingPhotos];
  }, [orderedPhotoIds, photos]);

  const nextInput = useMemo<CreateListingInput>(
    () => ({
      ...form,
      imageNames:
        orderedPhotos.length > 0 ? orderedPhotos.map((photo) => photo.name) : form.imageNames,
    }),
    [form, orderedPhotos],
  );

  const validationErrors = useMemo(() => validateListingInput(nextInput), [nextInput]);
  const activeErrors = submitAttempted ? validationErrors : [];

  const usesEbay = form.selectedPlatforms.includes("ebay");
  const usesOfferUp = form.selectedPlatforms.includes("offerup");
  const usesFacebook = form.selectedPlatforms.includes("facebook-marketplace");
  const usesCraigslist = form.selectedPlatforms.includes("craigslist");
  const usesReverb = form.selectedPlatforms.includes("reverb");

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

  function updateMoneyStringField<Key extends keyof CreateListingInput>(field: Key, value: string) {
    updateField(field, formatCurrencyDigits(value) as CreateListingInput[Key]);
  }

  function handlePriceChange(value: string) {
    updateField("price", parseCurrencyValue(formatCurrencyDigits(value)));
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
    setOrderedPhotoIds((current) =>
      current.includes(photoId) ? current : [...current, photoId],
    );
  }

  function undoPhotoOrder() {
    setOrderedPhotoIds((current) => current.slice(0, -1));
  }

  function handleDelete() {
    if (!listing) {
      return;
    }

    onDelete(listing.id);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);

    if (validationErrors.length > 0) {
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
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">{mode === "edit" ? "Edit Listing" : "Create Listing"}</p>
            <h2>{mode === "edit" ? "Update Listing" : "Create Listing"}</h2>
          </div>
          <div className="preview-actions">
            {mode === "edit" ? (
              <button className="secondary-button" onClick={onStartCreate} type="button">
                Create A Listing
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
          <section className="form-section">
            <div className="form-section-header">
              <h3>Shared Fields</h3>
            </div>

            <div className="field-row single">
              <label>
                <RequiredLabel label="Title" required />
                <input
                  maxLength={35}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="Fender Player Stratocaster"
                  value={form.title}
                />
              </label>
            </div>

            <div className="field-row single">
              <label>
                <RequiredLabel label="Description" required />
                <textarea
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="Include condition details, included accessories, pickup or shipping notes, and anything a buyer should know."
                  rows={7}
                  value={form.description}
                />
              </label>
            </div>

            <div className="field-row">
              <label>
                <RequiredLabel label="Price" required />
                <input
                  inputMode="numeric"
                  onChange={(event) => handlePriceChange(event.target.value)}
                  placeholder="39.00"
                  type="text"
                  value={form.price > 0 ? form.price.toFixed(2) : ""}
                />
              </label>

              {(usesOfferUp || usesFacebook || usesCraigslist) ? (
                <label>
                  <RequiredLabel label="Condition" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("condition", event.target.value)}
                    placeholder="Like New"
                    value={form.condition}
                  />
                </label>
              ) : null}
            </div>
          </section>

          {usesEbay ? (
            <section className="form-section">
              <div className="form-section-header">
                <h3>eBay Fields</h3>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Category (eBay)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("ebayCategory", event.target.value)}
                    placeholder="Suggested Later"
                    value={form.ebayCategory}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {(usesOfferUp || usesFacebook) ? (
            <section className="form-section">
              <div className="form-section-header">
                <h3>
                  {usesOfferUp && usesFacebook
                    ? "OfferUp / Facebook Marketplace Fields"
                    : usesOfferUp
                      ? "OfferUp Fields"
                      : "Facebook Marketplace Fields"}
                </h3>
              </div>

              <div className="field-row">
                {usesOfferUp ? (
                  <label>
                    <RequiredLabel label="Category (OfferUp)" required />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("offerupCategory", event.target.value)}
                      placeholder="Suggested Later"
                      value={form.offerupCategory}
                    />
                  </label>
                ) : null}

                {usesFacebook ? (
                  <label>
                    <RequiredLabel label="Category (Facebook Marketplace)" required />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("facebookCategory", event.target.value)}
                      placeholder="Suggested Later"
                      value={form.facebookCategory}
                    />
                  </label>
                ) : null}
              </div>

              {usesOfferUp ? (
                <div className="field-row">
                  <label>
                    <RequiredLabel label="Sub-category (OfferUp)" required />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("offerupSubcategory", event.target.value)}
                      placeholder="Suggested Later"
                      value={form.offerupSubcategory}
                    />
                  </label>

                  <label>
                    <RequiredLabel label="Brand (OfferUp)" />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("brand", event.target.value)}
                      placeholder="Boss"
                      value={form.brand}
                    />
                  </label>

                  <label>
                    <RequiredLabel label="Type (OfferUp)" />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("type", event.target.value)}
                      placeholder="Looper"
                      value={form.type}
                    />
                  </label>
                </div>
              ) : null}
            </section>
          ) : null}

          {usesCraigslist ? (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Craigslist Fields</h3>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Category (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistCategory", event.target.value)}
                    placeholder="Suggested Later"
                    value={form.craigslistCategory}
                  />
                </label>

                <label>
                  <RequiredLabel label="Make / Manufacturer (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("brand", event.target.value)}
                    placeholder="Yamaha"
                    value={form.brand}
                  />
                </label>

                <label>
                  <RequiredLabel label="Model Name / Number (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("model", event.target.value)}
                    placeholder="P-125"
                    value={form.model}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="City (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistCity", event.target.value)}
                    placeholder="North Phoenix"
                    value={form.craigslistCity}
                  />
                </label>

                <label>
                  <RequiredLabel label="Zip Code (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistZipCode", event.target.value)}
                    placeholder="85032"
                    value={form.craigslistZipCode}
                  />
                </label>

                <label>
                  <RequiredLabel label="Contact Name (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistContactName", event.target.value)}
                    placeholder="Trey"
                    value={form.craigslistContactName}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Phone Number (Craigslist)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistPhoneNumber", event.target.value)}
                    placeholder="602-555-0199"
                    value={form.craigslistPhoneNumber}
                  />
                </label>

                <label>
                  <RequiredLabel label="Size / Dimensions (Craigslist)" />
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
                  <RequiredLabel label="Street (Craigslist)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistStreet", event.target.value)}
                    placeholder="Greenway Rd"
                    value={form.craigslistStreet}
                  />
                </label>
              </div>

              <div className="field-row single">
                <label>
                  <RequiredLabel label="Cross Street (Craigslist)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistCrossStreet", event.target.value)}
                    placeholder="32nd St"
                    value={form.craigslistCrossStreet}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {usesReverb ? (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Reverb Fields</h3>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Brand (Reverb)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("brand", event.target.value)}
                    placeholder="Gibson"
                    value={form.brand}
                  />
                </label>

                <label>
                  <RequiredLabel label="Model (Reverb)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("model", event.target.value)}
                    placeholder="Les Paul Studio"
                    value={form.model}
                  />
                </label>

                <label>
                  <RequiredLabel label="Category (Reverb)" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("reverbCategory", event.target.value)}
                    placeholder="Suggested Later"
                    value={form.reverbCategory}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Subcategory (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("reverbSubcategory", event.target.value)}
                    placeholder="Electric Guitars"
                    value={form.reverbSubcategory}
                  />
                </label>

                <label>
                  <RequiredLabel label="Additional Subcategory (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) =>
                      updateField("reverbAdditionalSubcategory", event.target.value)
                    }
                    placeholder="Solid Body"
                    value={form.reverbAdditionalSubcategory}
                  />
                </label>

                <label>
                  <RequiredLabel label="Shipping Rate (Reverb)" required />
                  <input
                    inputMode="numeric"
                    onChange={(event) => updateMoneyStringField("shippingRate", event.target.value)}
                    placeholder="49.99"
                    type="text"
                    value={form.shippingRate}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Year (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("year", event.target.value)}
                    placeholder="2018"
                    value={form.year}
                  />
                </label>

                <label>
                  <RequiredLabel label="Finish (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("finish", event.target.value)}
                    placeholder="Smokehouse Burst"
                    value={form.finish}
                  />
                </label>

                <label>
                  <RequiredLabel label="Manufacturer's Country (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("manufacturerCountry", event.target.value)}
                    placeholder="USA"
                    value={form.manufacturerCountry}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="What You Paid (Reverb)" />
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      updateMoneyStringField("purchasePrice", event.target.value)
                    }
                    placeholder="850.00"
                    type="text"
                    value={form.purchasePrice}
                  />
                </label>

                <label>
                  <RequiredLabel label="YouTube Link (Reverb)" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("youtubeLink", event.target.value)}
                    placeholder="youtu.be/demo"
                    value={form.youtubeLink}
                  />
                </label>
              </div>
            </section>
          ) : null}

          <section className="form-section">
            <div className="form-section-header">
              <h3>Photos</h3>
            </div>

            <div className="field-row single">
              <label>
                <RequiredLabel label="Photos" />
                <input accept="image/*" multiple onChange={handleImageChange} type="file" />
              </label>
            </div>

            {photos.length > 0 ? (
              <div className="photo-toolbar">
                <span className="summary-pill">
                  {orderedPhotoIds.length > 0
                    ? `${orderedPhotoIds.length} Ranked`
                    : `${photos.length} Uploaded`}
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
          </section>

          <button className="primary-button" type="submit">
            {mode === "edit" ? "Save Changes" : "Save Listing"}
          </button>
        </form>
      </section>

      {activeErrors.length > 0 ? (
        <aside className="validation-dock">
          <div className="validation-card">
            <p className="panel-kicker">Missing Fields</p>
            <h2>Complete These Fields</h2>
            <ul className="validation-list">
              {activeErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </>
  );
}
