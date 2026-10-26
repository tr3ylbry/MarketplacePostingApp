import type { ListingImage, BlobImageSource } from "../domain/listingImage";
import type { OwnerId } from "./owner";
import type { ImageUpload, UploadInput } from "./imageStorage";

export interface ImageRepository {
  retainForProvider(owner: OwnerId, listingId: string, imageId: string, retainUntil: string): Promise<string>;
  reserve(owner: OwnerId, listingId: string, input: UploadInput): Promise<ImageUpload>;
  resolveUpload(owner: OwnerId, listingId: string, imageId: string): Promise<ImageUpload | null>;
  finalize(owner: OwnerId, listingId: string, imageId: string, source: BlobImageSource): Promise<void>;
  get(owner: OwnerId, listingId: string, imageId: string): Promise<ListingImage | null>;
  remove(owner: OwnerId, listingId: string, imageId: string): Promise<string[]>;
  reorder(owner: OwnerId, listingId: string, imageIds: string[]): Promise<void>;
  cancel(owner: OwnerId, listingId: string, imageId: string): Promise<string[]>;
}
