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
  return /\.(heic|heif)$/i.test(name) ? name.replace(/\.(heic|heif)$/i, ".jpg") : `${name}.jpg`;
}

export async function convertImageForUpload(file: File) {
  return isHeicFile(file) ? convertHeicFile(file) : file;
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

  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
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
      const extension = browserReadableType === "image/jpeg" ? "jpg" : browserReadableType === "image/png" ? "png" : "webp";
      const name = `${file.name.replace(/\.[^.]*$/, "")}.${extension}`;
      return new File([file], name, {
        lastModified: file.lastModified,
        type: browserReadableType,
      });
    }

    throw error;
  }
}
