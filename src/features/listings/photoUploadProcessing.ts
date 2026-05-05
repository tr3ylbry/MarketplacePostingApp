import type { ListingPhotoUpload } from "./types";

const MAX_IMAGE_COUNT = 40;
const HEIC_CONCURRENCY_LIMIT = 4;

export interface PhotoConversionProgress {
  completed: number;
  total: number;
}

export interface PhotoUploadBatch {
  photoError: string | null;
  progress: PhotoConversionProgress;
  uploads: ListingPhotoUpload[];
}

function isHeicFile(file: File) {
  const normalizedName = file.name.toLowerCase();
  const normalizedType = file.type.toLowerCase();

  return (
    normalizedType === "image/heic" ||
    normalizedType === "image/heif" ||
    normalizedName.endsWith(".heic") ||
    normalizedName.endsWith(".heif")
  );
}

function buildJpegName(name: string) {
  return name.replace(/\.(heic|heif)$/i, ".jpg");
}

async function detectBrowserReadableType(file: File) {
  const headerBuffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(headerBuffer);
  const header = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (header.startsWith("ffd8ff")) {
    return "image/jpeg";
  }

  if (header.startsWith("89504e470d0a1a0a")) {
    return "image/png";
  }

  if (header.startsWith("47494638")) {
    return "image/gif";
  }

  if (header.startsWith("424d")) {
    return "image/bmp";
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function createUploadEntry(file: File): ListingPhotoUpload {
  const heic = isHeicFile(file);
  const outputName = heic ? buildJpegName(file.name) : file.name;

  return {
    id: crypto.randomUUID(),
    name: outputName,
    file,
    previewUrl: heic ? null : URL.createObjectURL(file),
    status: heic ? "converting" : "ready",
  };
}

async function convertHeicFile(file: File) {
  const { default: heic2any } = await import("heic2any");

  try {
    const conversionResult = await heic2any({
      blob: file,
      quality: 0.92,
      toType: "image/jpeg",
    });

    const jpegBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;

    return new File([jpegBlob], buildJpegName(file.name), {
      lastModified: file.lastModified,
      type: "image/jpeg",
    });
  } catch (error) {
    const browserReadableType = await detectBrowserReadableType(file);

    if (browserReadableType) {
      return new File([file], file.name, {
        lastModified: file.lastModified,
        type: browserReadableType,
      });
    }

    throw error;
  }
}

export function preparePhotoUploadBatch(files: File[]): PhotoUploadBatch {
  const limitedFiles = files.slice(0, MAX_IMAGE_COUNT);
  const uploads = limitedFiles.map(createUploadEntry);
  const totalConversions = limitedFiles.filter(isHeicFile).length;

  return {
    photoError: files.length > MAX_IMAGE_COUNT ? "You can upload up to 40 photos." : null,
    progress: {
      completed: 0,
      total: totalConversions,
    },
    uploads,
  };
}

export async function processPhotoUploadBatch(
  uploads: ListingPhotoUpload[],
  onProgress: (progress: PhotoConversionProgress) => void,
  onUpdate: (uploadId: string, nextUpload: ListingPhotoUpload) => void,
) {
  const pendingUploads = uploads.filter((upload) => upload.status === "converting");
  let completed = 0;

  if (pendingUploads.length === 0) {
    onProgress({ completed: 0, total: 0 });
    return;
  }

  onProgress({
    completed,
    total: pendingUploads.length,
  });

  let nextIndex = 0;

  async function worker() {
    while (nextIndex < pendingUploads.length) {
      const upload = pendingUploads[nextIndex];
      nextIndex += 1;

      try {
        const convertedFile = await convertHeicFile(upload.file);
        const readyUpload: ListingPhotoUpload = {
          ...upload,
          file: convertedFile,
          name: convertedFile.name,
          previewUrl: URL.createObjectURL(convertedFile),
          status: "ready",
          errorMessage: undefined,
        };

        onUpdate(upload.id, readyUpload);
      } catch {
        onUpdate(upload.id, {
          ...upload,
          status: "error",
          errorMessage: "HEIC conversion failed",
        });
      } finally {
        completed += 1;
        onProgress({
          completed,
          total: pendingUploads.length,
        });
      }
    }
  }

  const workerCount = Math.min(HEIC_CONCURRENCY_LIMIT, pendingUploads.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
