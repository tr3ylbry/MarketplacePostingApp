import type { ListingImage, BlobImageSource } from "../domain/listingImage";
import type { OwnerId } from "./owner";
import type { ImageUpload, UploadInput } from "./imageStorage";

export interface ImageRepository {
  reserve(owner: OwnerId, listingId: string, input: UploadInput): Promise<ImageUpload>;
  finalize(owner: OwnerId, listingId: string, imageId: string, verify: (upload: ImageUpload) => Promise<BlobImageSource>): Promise<void>;
  get(owner: OwnerId, listingId: string, imageId: string): Promise<ListingImage | null>;
  remove(owner: OwnerId, listingId: string, imageId: string): Promise<string[]>;
  reorder(owner: OwnerId, listingId: string, imageIds: string[]): Promise<void>;
  cancel(owner: OwnerId, listingId: string, imageId: string): Promise<string[]>;
}
