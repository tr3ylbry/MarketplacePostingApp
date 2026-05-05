import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import {
  type CreateListingInput,
  type Listing,
  type PlatformSiteKey,
  validateListingInput,
} from "../../../domain/listing";
import { buildListingPhotoBundle } from "../photoBundle";
import {
  preparePhotoUploadBatch,
  processPhotoUploadBatch,
  type PhotoConversionProgress,
} from "../photoUploadProcessing";
import type { ListingPhotoUpload } from "../types";

interface ListingFormProps {
  hasSavedListings: boolean;
  mode: "create" | "edit";
  listing: Listing | null;
  onContinueToPreview: () => void;
  photos: ListingPhotoUpload[];
  initialSelectedPlatforms: PlatformSiteKey[];
  onCreate: (input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onCreateAndExit: (input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onUpdate: (listingId: string, input: CreateListingInput, photos: ListingPhotoUpload[]) => void;
  onDelete: (listingId: string) => void;
  onExitToHome: () => void;
  onOpenManage: () => void;
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
  craigslistCity: "Tucson",
  craigslistZipCode: "",
  craigslistSizeDimensions: "",
  craigslistPhoneNumber: "5855078535",
  craigslistContactName: "Trey",
  craigslistStreet: "Bermuda",
  craigslistCrossStreet: "Country Club and Glenn",
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

function normalizeCurrencyInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/[^0-9.]/g, "");

  if (!normalized) {
    return "";
  }

  if (!normalized.includes(".")) {
    const wholeDollars = Number(normalized);
    return Number.isFinite(wholeDollars) ? `${wholeDollars.toFixed(2)}` : "";
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

const lowercaseWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

const wordOverrides: Record<string, string> = {
  ebay: "eBay",
  facebook: "Facebook",
  youtube: "YouTube",
};

function formatLabelText(label: string) {
  return label
    .split(" ")
    .map((word, wordIndex) =>
      word
        .split("-")
        .map((segment, segmentIndex) => {
          const normalized = segment.toLowerCase();

          if (wordOverrides[normalized]) {
            return wordOverrides[normalized];
          }

          if (!normalized) {
            return segment;
          }

          if (wordIndex > 0 && segmentIndex === 0 && lowercaseWords.has(normalized)) {
            return normalized;
          }

          return normalized.charAt(0).toUpperCase() + normalized.slice(1);
        })
        .join("-"),
    )
    .join(" ");
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
      {formatLabelText(label)}
      {required ? <span className="required-indicator">*</span> : null}
    </span>
  );
}

export function ListingForm({
  hasSavedListings,
  mode,
  listing,
  onContinueToPreview,
  photos: selectedListingPhotos,
  initialSelectedPlatforms,
  onCreate,
  onCreateAndExit,
  onUpdate,
  onDelete,
  onExitToHome,
  onOpenManage,
  onStartCreate,
}: ListingFormProps) {
  const [form, setForm] = useState<CreateListingInput>(
    buildInitialState(listing, initialSelectedPlatforms),
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [photos, setPhotos] = useState<ListingPhotoUpload[]>([]);
  const [orderedPhotoIds, setOrderedPhotoIds] = useState<string[]>([]);
  const [photoOrderHistory, setPhotoOrderHistory] = useState<string[][]>([]);
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const [showPhotoOrdering, setShowPhotoOrdering] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(mode === "edit" && Boolean(listing));
  const [isDirty, setIsDirty] = useState(false);
  const [isDownloadingBundle, setIsDownloadingBundle] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [photoConversionProgress, setPhotoConversionProgress] = useState<PhotoConversionProgress>({
    completed: 0,
    total: 0,
  });
  const uploadBatchIdRef = useRef(0);

  useEffect(() => {
    setForm(buildInitialState(mode === "edit" ? listing : null, initialSelectedPlatforms));
    setPhotos(mode === "edit" ? selectedListingPhotos : []);
    setOrderedPhotoIds(mode === "edit" ? selectedListingPhotos.map((photo) => photo.id) : []);
    setPhotoOrderHistory([]);
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
    setShowPhotoOrdering(false);
    setPhotoError(null);
    setSubmitAttempted(false);
    setShowExitModal(false);
    setHasSavedDraft(mode === "edit" && Boolean(listing));
    setIsDirty(false);
    setIsDownloadingBundle(false);
    setShowSavedToast(false);
    setPhotoConversionProgress({ completed: 0, total: 0 });
  }, [initialSelectedPlatforms, listing, mode, selectedListingPhotos]);

  useEffect(() => {
    if (!showSavedToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSavedToast(false);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showSavedToast]);

  const orderedPhotos = useMemo(() => {
    const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
    const arrangedPhotos = orderedPhotoIds
      .map((photoId) => photoMap.get(photoId))
      .filter((photo): photo is ListingPhotoUpload => Boolean(photo));

    return arrangedPhotos;
  }, [orderedPhotoIds, photos]);
  const readyOrderedPhotos = useMemo(
    () => orderedPhotos.filter((photo) => photo.status === "ready"),
    [orderedPhotos],
  );
  const isProcessingPhotos = photoConversionProgress.total > photoConversionProgress.completed;
  const hasPhotoConversionErrors = photos.some((photo) => photo.status === "error");

  const nextInput = useMemo<CreateListingInput>(
    () => ({
      ...form,
      imageNames:
        readyOrderedPhotos.length > 0
          ? readyOrderedPhotos.map((photo) => photo.name)
          : form.imageNames,
    }),
    [form, readyOrderedPhotos],
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
    setIsDirty(true);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateMoneyStringField<Key extends keyof CreateListingInput>(field: Key, value: string) {
    updateField(field, value as CreateListingInput[Key]);
  }

  function handlePriceChange(value: string) {
    updateField("price", Number(value.replace(/[^0-9.]/g, "")) || 0);
  }

  function handlePriceBlur(value: string) {
    const normalized = normalizeCurrencyInput(value);
    updateField("price", normalized ? Number(normalized) : 0);
  }

  function handleMoneyBlur<Key extends keyof CreateListingInput>(field: Key, value: string) {
    updateField(field, normalizeCurrencyInput(value) as CreateListingInput[Key]);
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setIsDirty(true);
    uploadBatchIdRef.current += 1;
    const currentBatchId = uploadBatchIdRef.current;

    try {
      const { photoError: nextPhotoError, progress, uploads } = preparePhotoUploadBatch(files);

      setPhotoError(nextPhotoError);
      setPhotos((current) => {
        for (const photo of current) {
          if (photo.previewUrl) {
            URL.revokeObjectURL(photo.previewUrl);
          }
        }

        return uploads;
      });
      setOrderedPhotoIds(uploads.map((file) => file.id));
      setPhotoOrderHistory([]);
      setDraggedPhotoId(null);
      setDragOverPhotoId(null);
      setPhotoConversionProgress(progress);

      processPhotoUploadBatch(
        uploads,
        (nextProgress) => {
          if (uploadBatchIdRef.current !== currentBatchId) {
            return;
          }

          setPhotoConversionProgress(nextProgress);
        },
        (uploadId, nextUpload) => {
          if (uploadBatchIdRef.current !== currentBatchId) {
            if (nextUpload.previewUrl) {
              URL.revokeObjectURL(nextUpload.previewUrl);
            }
            return;
          }

          setPhotos((current) =>
            current.map((photo) => {
              if (photo.id !== uploadId) {
                return photo;
              }

              if (photo.previewUrl && photo.previewUrl !== nextUpload.previewUrl) {
                URL.revokeObjectURL(photo.previewUrl);
              }

              return nextUpload;
            }),
          );
        },
      ).catch(() => {
        if (uploadBatchIdRef.current !== currentBatchId) {
          return;
        }

        setPhotoError("One or more HEIC photos could not be converted to JPEG.");
      });
    } catch {
      setPhotoError("One or more HEIC photos could not be converted to JPEG.");
    }
  }

  function reorderPhotoIds(currentOrder: string[], sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      return currentOrder;
    }

    const nextOrder = [...currentOrder];
    const sourceIndex = nextOrder.indexOf(sourceId);
    const targetIndex = nextOrder.indexOf(targetId);

    if (sourceIndex === -1 || targetIndex === -1) {
      return currentOrder;
    }

    const [movedPhotoId] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, movedPhotoId);

    return nextOrder;
  }

  function handlePhotoDragStart(photoId: string) {
    setDraggedPhotoId(photoId);
    setDragOverPhotoId(photoId);
  }

  function handlePhotoDragOver(event: DragEvent<HTMLButtonElement>, photoId: string) {
    event.preventDefault();

    if (!draggedPhotoId || draggedPhotoId === photoId) {
      return;
    }

    setDragOverPhotoId(photoId);
  }

  function handlePhotoDrop(photoId: string) {
    if (!draggedPhotoId || draggedPhotoId === photoId) {
      setDraggedPhotoId(null);
      setDragOverPhotoId(null);
      return;
    }

    setOrderedPhotoIds((current) => {
      const nextOrder = reorderPhotoIds(current, draggedPhotoId, photoId);

      if (nextOrder === current) {
        return current;
      }

      setPhotoOrderHistory((history) => [...history, current]);
      return nextOrder;
    });
    setIsDirty(true);
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
  }

  function handlePhotoDragEnd() {
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
  }

  function undoPhotoOrder() {
    setPhotoOrderHistory((history) => {
      const previousOrder = history[history.length - 1];

      if (!previousOrder) {
        return history;
      }

      setOrderedPhotoIds(previousOrder);
      setIsDirty(true);
      return history.slice(0, -1);
    });
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
      onUpdate(
        listing.id,
        nextInput,
        readyOrderedPhotos.length > 0 ? readyOrderedPhotos : selectedListingPhotos,
      );
      setHasSavedDraft(true);
      setIsDirty(false);
      setShowSavedToast(true);
      return;
    }

    onCreate(nextInput, readyOrderedPhotos);
    setHasSavedDraft(true);
    setIsDirty(false);
    setShowSavedToast(true);
  }

  function handleExitClick() {
    setShowExitModal(true);
  }

  function handleExitWithoutSaving() {
    setShowExitModal(false);
    onExitToHome();
  }

  function handleSaveAndExit() {
    setSubmitAttempted(true);

    if (validationErrors.length > 0) {
      setShowExitModal(false);
      return;
    }

    onCreateAndExit(nextInput, readyOrderedPhotos);
    setShowExitModal(false);
  }

  async function handleBundleDownload() {
    if (readyOrderedPhotos.length === 0) {
      return;
    }

    setIsDownloadingBundle(true);

    try {
      const bundle = await buildListingPhotoBundle(nextInput, readyOrderedPhotos);
      const url = URL.createObjectURL(bundle);
      const link = document.createElement("a");

      link.href = url;
      link.download = `${form.title || "Listing"}_PhotoBundle.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingBundle(false);
    }
  }

  const displayImageNames =
    readyOrderedPhotos.length > 0 ? readyOrderedPhotos.map((photo) => photo.name) : form.imageNames;
  const canContinue = hasSavedDraft && !isDirty;
  const isSaveDisabled =
    !isDirty || validationErrors.length > 0 || isProcessingPhotos || hasPhotoConversionErrors;
  const photoInputId = `listing-photo-input-${mode}`;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">{mode === "edit" ? "Edit Listing" : "Create Listing"}</p>
            <h2>{mode === "edit" ? "Update Listing" : "Create Listing"}</h2>
          </div>
          <div className="preview-actions">
            {mode === "create" ? (
              <>
                {hasSavedListings ? (
                  <button className="secondary-button" onClick={onOpenManage} type="button">
                    Edit & Delete
                  </button>
                ) : null}
                <button className="secondary-button" onClick={handleExitClick} type="button">
                  Exit To Home
                </button>
              </>
            ) : null}
            {mode === "edit" ? (
              <button className="secondary-button" onClick={handleExitClick} type="button">
                Exit To Home
              </button>
            ) : null}
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

        <div className="image-chip-row listing-platform-row">
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
                  onBlur={(event) => handlePriceBlur(event.target.value)}
                  placeholder="39.00"
                  type="text"
                  value={form.price > 0 ? String(form.price) : ""}
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
              <p className="section-helper">
                Title, category, and condition will be pulled from the shared fields.
                Category will still be suggested automatically in the eBay preview.
              </p>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Brand" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("brand", event.target.value)}
                    placeholder="Tiptop Audio"
                    value={form.brand}
                  />
                </label>

                <label>
                  <RequiredLabel label="Type" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("type", event.target.value)}
                    placeholder="Power Cable"
                    value={form.type}
                  />
                </label>

                <label>
                  <RequiredLabel label="Model" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("model", event.target.value)}
                    placeholder="10 To 16 Pin Eurorack Cable"
                    value={form.model}
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

              <p className="section-helper">
                Category suggestions for these previews will be generated from the
                listing title and description.
              </p>

              {usesOfferUp ? (
                <div className="field-row">
                  <label>
                    <RequiredLabel label="Brand" />
                    <input
                      maxLength={35}
                      onChange={(event) => updateField("brand", event.target.value)}
                      placeholder="Boss"
                      value={form.brand}
                    />
                  </label>

                  <label>
                    <RequiredLabel label="Type" />
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

              <p className="section-helper">
                Craigslist category will be suggested automatically in the preview.
              </p>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Make / Manufacturer" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("brand", event.target.value)}
                    placeholder="Yamaha"
                    value={form.brand}
                  />
                </label>

                <label>
                  <RequiredLabel label="Model Name / Number" required />
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
                  <RequiredLabel label="City" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistCity", event.target.value)}
                    placeholder="North Phoenix"
                    value={form.craigslistCity}
                  />
                </label>

                <label>
                  <RequiredLabel label="Zip Code" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistZipCode", event.target.value)}
                    placeholder="85032"
                    value={form.craigslistZipCode}
                  />
                </label>

                <label>
                  <RequiredLabel label="Contact Name" required />
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
                  <RequiredLabel label="Phone Number" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("craigslistPhoneNumber", event.target.value)}
                    placeholder="602-555-0199"
                    value={form.craigslistPhoneNumber}
                  />
                </label>

                <label>
                  <RequiredLabel label="Size / Dimensions" />
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
                  <RequiredLabel label="Street" />
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
                  <RequiredLabel label="Cross Street" />
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

              <p className="section-helper">
                Reverb categories will be suggested automatically in the preview.
              </p>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Brand" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("brand", event.target.value)}
                    placeholder="Gibson"
                    value={form.brand}
                  />
                </label>

                <label>
                  <RequiredLabel label="Model" required />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("model", event.target.value)}
                    placeholder="Les Paul Studio"
                    value={form.model}
                  />
                </label>
              </div>

              <div className="field-row single">
                <label>
                  <RequiredLabel label="Shipping Rate" required />
                  <input
                    inputMode="numeric"
                    onChange={(event) => updateMoneyStringField("shippingRate", event.target.value)}
                    onBlur={(event) => handleMoneyBlur("shippingRate", event.target.value)}
                    placeholder="49.99"
                    type="text"
                    value={form.shippingRate}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  <RequiredLabel label="Year" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("year", event.target.value)}
                    placeholder="2018"
                    value={form.year}
                  />
                </label>

                <label>
                  <RequiredLabel label="Finish" />
                  <input
                    maxLength={35}
                    onChange={(event) => updateField("finish", event.target.value)}
                    placeholder="Smokehouse Burst"
                    value={form.finish}
                  />
                </label>

                <label>
                  <RequiredLabel label="Manufacturer's Country" />
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
                  <RequiredLabel label="What You Paid" />
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      updateMoneyStringField("purchasePrice", event.target.value)
                    }
                    onBlur={(event) => handleMoneyBlur("purchasePrice", event.target.value)}
                    placeholder="850.00"
                    type="text"
                    value={form.purchasePrice}
                  />
                </label>

                <label>
                  <RequiredLabel label="YouTube Link" />
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
                <div className="file-input-stack">
                  <input
                    accept="image/*,.heic,.heif"
                    className="visually-hidden-file-input"
                    id={photoInputId}
                    multiple
                    onChange={handleImageChange}
                    type="file"
                  />
                  <label className="file-picker-button" htmlFor={photoInputId}>
                    Choose Files
                  </label>
                  <p className="file-picker-copy">
                    {photos.length > 0
                      ? `${photos.length} photo${photos.length === 1 ? "" : "s"} selected`
                      : "Upload up to 40 photos"}
                  </p>
                </div>
              </label>
            </div>

            {photos.length > 0 ? (
              <div className="photo-toolbar">
                <span className="summary-pill">
                  {photos.length > 0 ? `${photos.length} In Order` : "No Photos"}
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
                  disabled={photoOrderHistory.length === 0}
                  onClick={undoPhotoOrder}
                  type="button"
                >
                  Undo
                </button>
                {hasSavedDraft ? (
                  <button
                    className="secondary-button"
                    disabled={readyOrderedPhotos.length === 0 || isDownloadingBundle || isProcessingPhotos}
                    onClick={handleBundleDownload}
                    type="button"
                  >
                    {isDownloadingBundle ? "Building Bundle..." : "Download Photo Bundle"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {photoConversionProgress.total > 0 ? (
              <div className="conversion-progress-card">
                <div className="conversion-progress-header">
                  <strong>
                    {isProcessingPhotos
                      ? `Converting ${photoConversionProgress.completed}/${photoConversionProgress.total} Images...`
                      : `Converted ${photoConversionProgress.total}/${photoConversionProgress.total} Images`}
                  </strong>
                  <span>
                    {Math.round(
                      (photoConversionProgress.completed / photoConversionProgress.total) * 100,
                    )}
                    %
                  </span>
                </div>
                <div aria-hidden="true" className="conversion-progress-bar">
                  <span
                    className="conversion-progress-fill"
                    style={{
                      width: `${(photoConversionProgress.completed / photoConversionProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {showPhotoOrdering && photos.length > 0 ? (
              <div className="photo-order-panel">
                <p className="photo-order-copy">
                  Drag photos to set upload order from most important to least important.
                  The arranged order is what each marketplace will use first.
                </p>
                <div className="photo-grid">
                  {orderedPhotos.map((photo) => {
                    const isDragged = draggedPhotoId === photo.id;
                    const isDropTarget = dragOverPhotoId === photo.id && draggedPhotoId !== photo.id;

                    return (
                      <button
                        className={`photo-tile ranked ${isDragged ? "dragging" : ""} ${isDropTarget ? "drag-over" : ""}`}
                        draggable
                        onDragEnd={handlePhotoDragEnd}
                        onDragOver={(event) => handlePhotoDragOver(event, photo.id)}
                        onDragStart={() => handlePhotoDragStart(photo.id)}
                        onDrop={() => handlePhotoDrop(photo.id)}
                        key={photo.id}
                        type="button"
                      >
                        {photo.previewUrl ? (
                          <img alt={photo.name} src={photo.previewUrl} />
                        ) : (
                          <div className={`photo-preview-placeholder ${photo.status}`}>
                            {photo.status === "converting" ? (
                              <span className="photo-spinner" aria-hidden="true" />
                            ) : (
                              <span className="photo-error-badge">Failed</span>
                            )}
                          </div>
                        )}
                        <span className="photo-name">{photo.name}</span>
                        {photo.status === "converting" ? (
                          <span className="photo-status-text">Converting...</span>
                        ) : null}
                        {photo.status === "error" ? (
                          <span className="photo-status-text error">
                            {photo.errorMessage ?? "Conversion failed"}
                          </span>
                        ) : null}
                        <span className="photo-drag-badge">Drag</span>
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

          <div className="form-footer-actions">
            <button className="primary-button" disabled={isSaveDisabled} type="submit">
              {mode === "edit" ? "Save Changes" : "Save Listing"}
            </button>
            {canContinue ? (
              <button
                className="secondary-button continue-button"
                onClick={onContinueToPreview}
                type="button"
              >
                Continue
              </button>
            ) : null}
          </div>
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

      {showSavedToast ? (
        <div aria-live="polite" className="save-toast" role="status">
          <strong>Saved!</strong>
          <span>Your listing changes are ready.</span>
        </div>
      ) : null}

      {showExitModal ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="exit-create-title"
            aria-modal="true"
            className="modal-card"
            role="dialog"
          >
            <p className="panel-kicker">Exit Create Listing</p>
            <h2 id="exit-create-title">Save Before Leaving?</h2>
            <p className="modal-copy">
              You can save this listing before returning to the home page, or leave
              without saving.
            </p>
            <div className="modal-actions">
              <button className="primary-button" onClick={handleSaveAndExit} type="button">
                Save And Exit
              </button>
              <button
                className="secondary-button"
                onClick={handleExitWithoutSaving}
                type="button"
              >
                Exit Without Saving
              </button>
              <button
                className="secondary-button"
                onClick={() => setShowExitModal(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
