"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "../../../domain/listing";
import { imageName, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT } from "../../../domain/listingImage";
import { prepareImageAction, finalizeImageAction, removeImageAction, reorderImagesAction } from "../../../app/listings/imageActions";
import { convertImageForUpload } from "../photoUploadProcessing";

export function imageReadPath(listingId: string, imageId: string) {
  return `/api/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(imageId)}`;
}
function uploadFile(url: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.timeout = 120000;
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = request.ontimeout = () => reject(new Error("Upload interrupted. Try again; unfinished uploads expire after five minutes."));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("Upload rejected. Check the file and try again."));
    request.send(file);
  });
}

export function ImageGallery({ listing, onChange, disabled = false }: { listing: Listing; onChange?: (listing: Listing) => void; disabled?: boolean }) {
  const [ready, setReady] = useState(false);
  // Server-rendered controls must not accept files before handlers are attached.
  useEffect(() => { setReady(true); }, []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failedReads, setFailedReads] = useState<string[]>([]);
  const [readVersion, setReadVersion] = useState(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const photoItems = useRef(new Map<string, HTMLLIElement>());
  const focusAfterChange = useRef<{ id: string | null } | null>(null);
  const mounted = useRef(false);
  const bundleOperation = useRef<{ controller: AbortController; timedOut: boolean } | null>(null);
  const downloadCleanups = useRef(new Set<() => void>());
  const bundleButton = useRef<HTMLButtonElement>(null);
  const focusBundle = useRef(false);
  const [bundling, setBundling] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const cleanups = downloadCleanups.current;
    return () => {
      mounted.current = false;
      bundleOperation.current?.controller.abort();
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  useEffect(() => {
    if (busy) return;
    if (focusBundle.current) { bundleButton.current?.focus(); focusBundle.current = false; }
    if (!focusAfterChange.current) return;
    const { id } = focusAfterChange.current;
    (id ? photoItems.current.get(id) : uploadInput.current)?.focus();
    focusAfterChange.current = null;
  }, [busy, listing.images]);
  const images = [...listing.images].sort((a, b) => a.order - b.order);
  async function run(operation: () => Promise<string>) {
    setBusy(true); setError(null); setStatus("");
    try { setStatus(await operation()); }
    catch (error) { setStatus(""); setError(error instanceof Error ? error.message : "Image operation failed. Try again."); }
    finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    await run(async () => {
      if (images.length + files.length > MAX_IMAGE_COUNT) throw new Error(`Choose no more than ${MAX_IMAGE_COUNT - images.length} additional images.`);
      for (const original of files) {
        // Bound conversion input as well as the final upload to limit browser memory.
        if (original.size > MAX_IMAGE_BYTES) throw new Error("Each image must be 10 MiB or smaller.");
        setStatus(`Preparing ${original.name}…`);
        const file = await convertImageForUpload(original);
        const prepared = await prepareImageAction(listing.id, { filename: file.name, contentType: file.type, size: file.size });
        if (!prepared.ok) throw new Error(prepared.error);
        await uploadFile(prepared.data.url, file, percent => setStatus(`Uploading ${file.name}: ${percent}%`));
        setStatus(`Saving ${file.name}…`);
        // Retry once after a lost response with the same image ID, not another slot.
        const finalize = () => finalizeImageAction(listing.id, prepared.data.imageId);
        const finalized = await finalize().catch(() => finalize());
        if (!finalized.ok) throw new Error(finalized.error);
        onChange?.(finalized.data);
      }
      return `${files.length} photo${files.length === 1 ? "" : "s"} saved privately.`;
    });
  }
  async function move(index: number, offset: number) {
    await run(async () => {
      const ids = images.map(image => image.id);
      [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
      const result = await reorderImagesAction(listing.id, ids);
      if (!result.ok) throw new Error(result.error);
      onChange?.(result.data);
      focusAfterChange.current = { id: images[index].id };
      return `Moved ${imageName(images[index])} to position ${index + offset + 1} of ${images.length}.`;
    });
  }
  async function remove(id: string) {
    await run(async () => {
      const result = await removeImageAction(listing.id, id);
      if (!result.ok) throw new Error(result.error);
      onChange?.(result.data);
      const index = images.findIndex(image => image.id === id);
      focusAfterChange.current = { id: images[index + 1]?.id ?? images[index - 1]?.id ?? null };
      return "Photo removed from this local listing.";
    });
  }
  async function bundle() {
    // A synchronous ref guard also covers clicks before React commits disabled controls.
    if (bundleOperation.current || busy || disabled) return;
    const operation = { controller: new AbortController(), timedOut: false };
    bundleOperation.current = operation;
    const { signal } = operation.controller;
    const current = () => mounted.current && bundleOperation.current === operation;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setBusy(true); setBundling(true); setError(null); setStatus("Planning photo bundle…");
    try {
      const [{ planListingPhotoBundle, buildListingPhotoBundle }, { readBundlePhoto, initiateBundleDownload, BUNDLE_TIMEOUT_MS }] = await Promise.all([
        import("../photoBundle"), import("../photoBundleDownload"),
      ]);
      signal.throwIfAborted();
      const plan = planListingPhotoBundle(listing, images.flatMap(image => image.source.kind === "vercel-blob"
        ? [{ id: image.id, name: imageName(image), size: image.source.size }] : []));
      deadline = setTimeout(() => { operation.timedOut = true; operation.controller.abort(); }, BUNDLE_TIMEOUT_MS);
      const zip = await buildListingPhotoBundle(plan,
        (photo, signal) => readBundlePhoto(imageReadPath(listing.id, photo.id), photo.size, signal),
        { signal, onProgress: (phase, completed, total) => { if (current()) setStatus(`${phase} photo bundle: ${completed} of ${total}…`); } });
      signal.throwIfAborted();
      const cleanup = initiateBundleDownload(zip, plan.downloadName, signal, cleanup => downloadCleanups.current.delete(cleanup));
      downloadCleanups.current.add(cleanup);
      if (current()) setStatus("Photo bundle prepared.");
    } catch (error) {
      if (current()) {
        setStatus(signal.aborted && !operation.timedOut ? "Photo bundle cancelled." : "");
        if (operation.timedOut) setError("Photo bundle timed out. Check your connection and try again with fewer photos.");
        else if (!signal.aborted) setError(error instanceof Error ? error.message : "Photo bundle failed. Try again.");
      }
    } finally {
      clearTimeout(deadline);
      if (current()) { focusBundle.current = true; setBusy(false); setBundling(false); }
      if (bundleOperation.current === operation) bundleOperation.current = null;
    }
  }
  return <section className="panel" aria-label="Listing photos" aria-busy={busy}>
    <h3>Photos</h3>
    <p>Private, saved images · JPEG, PNG, WebP · 10 MiB each · up to 40. HEIC/HEIF converts to JPEG before upload.</p>
    <fieldset disabled={!ready || disabled || busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {onChange ? <label>Upload photos<input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files); }} /></label> : null}
      {!images.length ? <p>No photos yet. Upload a file to save a private photo.</p> : null}
      {images.some(image => image.source.kind === "vercel-blob") ? <>
        <button ref={bundleButton} className="secondary-button" type="button" onClick={bundle} aria-describedby="photo-bundle-limits">Download Photo Bundle</button>
        <p id="photo-bundle-limits">Bundle limits: 32 MiB of needed photos and 64 MiB ZIP. Marketplace folders may repeat photos.</p>
      </> : null}
      <ol className="photo-grid" style={{ listStyle: "none", padding: 0 }}>
        {images.map((image, index) => <li key={image.id} data-image-id={image.id} tabIndex={-1} aria-label={`Photo ${index + 1}: ${imageName(image)}`} ref={element => { if (element) photoItems.current.set(image.id, element); else photoItems.current.delete(image.id); }}>
          {image.source.kind === "vercel-blob" ? <>
            <Image unoptimized width={180} height={180} referrerPolicy="no-referrer" src={`${imageReadPath(listing.id, image.id)}?v=${readVersion}`} alt={image.altText ?? imageName(image)} onError={() => setFailedReads(current => current.includes(image.id) ? current : [...current, image.id])} />
            {failedReads.includes(image.id) ? <button type="button" aria-label={`Retry ${imageName(image)}`} onClick={() => { setFailedReads([]); setReadVersion(value => value + 1); }}>Retry image</button> : null}
          </> : <p>Legacy filename only — bytes unavailable. Upload the original file, then remove this entry.</p>}
          <p>{index + 1}. {imageName(image)}</p>
          {onChange ? <div>
            <button type="button" disabled={index === 0} aria-label={`Move ${imageName(image)} earlier`} onClick={() => move(index, -1)}>Earlier</button>{" "}
            <button type="button" disabled={index === images.length - 1} aria-label={`Move ${imageName(image)} later`} onClick={() => move(index, 1)}>Later</button>{" "}
            <button type="button" aria-label={`Remove ${imageName(image)}`} onClick={() => remove(image.id)}>Remove</button>
          </div> : null}
        </li>)}
      </ol>
    </fieldset>
    {bundling ? <button type="button" className="secondary-button" onClick={() => bundleOperation.current?.controller.abort()}>Cancel photo bundle</button> : null}
    <p role="status">{status}</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
