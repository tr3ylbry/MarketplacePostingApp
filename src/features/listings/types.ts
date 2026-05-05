export interface ListingPhotoUpload {
  id: string;
  name: string;
  file: File;
  previewUrl: string | null;
  status: "ready" | "converting" | "error";
  errorMessage?: string;
}
