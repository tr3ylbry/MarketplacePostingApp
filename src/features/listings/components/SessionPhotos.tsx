"use client";
import { createContext, useContext, useRef, useEffect } from "react";
import type { ListingPhotoUpload } from "../types";

const PhotoContext = createContext<Map<string, ListingPhotoUpload[]> | null>(null);
export function SessionPhotos({ children }: { children: React.ReactNode }) {
  const photos = useRef(new Map<string, ListingPhotoUpload[]>());
  useEffect(() => {
    const map = photos.current;
    return () => {
      for (const entries of map.values()) for (const photo of entries) if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      map.clear();
    };
  }, []);
  return <PhotoContext.Provider value={photos.current}>{children}</PhotoContext.Provider>;
}
export function useSessionPhotos() {
  const photos = useContext(PhotoContext);
  if (!photos) throw new Error("SessionPhotos provider missing.");
  return photos;
}
