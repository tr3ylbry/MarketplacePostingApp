import { acquirePhotoCapacity, borrowPhotoCapacity, releasePhotoCapacity } from "./photoCapacity";

it("shares two opaque slots, refuses forged/concurrent borrows and holds an early-closed parent until its child settles", () => {
  const a = acquirePhotoCapacity(), b = acquirePhotoCapacity(); let child: (() => void) | undefined;
  try {
    expect(() => acquirePhotoCapacity()).toThrow(); expect(() => borrowPhotoCapacity({})).toThrow();
    child = borrowPhotoCapacity(a); expect(() => borrowPhotoCapacity(a)).toThrow();
    releasePhotoCapacity(a); expect(() => acquirePhotoCapacity()).toThrow();
    child(); child = undefined; const c = acquirePhotoCapacity(); releasePhotoCapacity(c);
    expect(() => borrowPhotoCapacity(a)).toThrow(); releasePhotoCapacity(a);
  } finally { child?.(); releasePhotoCapacity(a); releasePhotoCapacity(b); }
  const next = acquirePhotoCapacity(); releasePhotoCapacity(next);
});
