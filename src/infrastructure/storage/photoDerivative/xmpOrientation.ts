import { XMLParser, XMLValidator } from "fast-xml-parser";
import { PhotoDerivativeError } from "../../../application/photoDerivative";

const namespaces: Record<string, string> = {
  x: "adobe:ns:meta/", rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", dc: "http://purl.org/dc/elements/1.1/",
  tiff: "http://ns.adobe.com/tiff/1.0/", exif: "http://ns.adobe.com/exif/1.0/", xmp: "http://ns.adobe.com/xap/1.0/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/", xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
};
export function xmpOrientation(bytes: Buffer): number | null {
  const invalid = (): never => { throw new PhotoDerivativeError("invalid"); };
  if (bytes.length > 64 * 1024) invalid();
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // No DTD/entities/CDATA/comments, extended XMP or unknown processing language.
  if (/<!|<\?(?!xml\s|xpacket\s)/i.test(xml)) invalid();
  if ((xml.match(/<[^>]*>/g) ?? []).length > 2048 || XMLValidator.validate(xml) !== true ||
    /&(?!(?:amp|lt|gt|quot|apos);|#(?:[0-9]+|x[0-9a-fA-F]+);)/.test(xml)) invalid();
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false,
    trimValues: true, processEntities: false, maxNestedTags: 16, ignoreDeclaration: true, ignorePiTags: true }).parse(xml);
  const orientations: number[] = [], declared = new Set<string>(), referenced = new Set<string>(); let nodes = 0;
  function visit(value: unknown, level: number) {
    if (++nodes > 4096 || level > 16) invalid();
    if (Array.isArray(value)) { for (const item of value) visit(item, level + 1); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("@_xmlns:")) {
        const prefix = key.slice(8); if (!namespaces[prefix] || item !== namespaces[prefix]) invalid(); declared.add(prefix); continue;
      }
      if (key === "@_xmlns") invalid();
      const name = key.replace(/^@_/, "");
      if (name !== "#text" && !name.includes(":")) invalid();
      // The first subset does not interpret XMP color calibration/HDR hints.
      if (["colorspace", "gamma", "whitepoint", "primarychromaticities", "photometricinterpretation", "transferfunction", "iccprofile"]
        .includes(name.split(":").slice(-1)[0].toLowerCase())) invalid();
      if (name.split(":").slice(-1)[0].toLowerCase() === "orientation") {
        if (name !== "tiff:Orientation" || typeof item !== "string" || !/^[1-8]$/.test(item)) invalid();
        orientations.push(Number(item));
      }
      if (name.includes(":")) {
        const prefix = name.split(":")[0]; if (!namespaces[prefix] && prefix !== "xml") invalid(); referenced.add(prefix);
      }
      visit(item, level + 1);
    }
  }
  if (!parsed || typeof parsed !== "object" || !("x:xmpmeta" in parsed)) invalid();
  visit(parsed, 0);
  if (orientations.length > 1 || [...referenced].some(prefix => prefix !== "xml" && !declared.has(prefix))) invalid();
  return orientations[0] ?? null;
}
