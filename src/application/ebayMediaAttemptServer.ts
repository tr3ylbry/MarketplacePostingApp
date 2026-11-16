import "server-only";
import { mediaRuntime } from "@ebay-media";
import { ebayRuntime } from "@ebay-runtime";
import { imageStorage } from "@image-storage";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleEbayMediaRepository } from "../infrastructure/repositories/drizzleEbayMediaRepository";
import { exportImageValidator } from "../infrastructure/storage/validateExportImage";
import { MediaAttemptError } from "./ebayMediaAttempt";
import { createMediaAttemptService } from "./ebayMediaAttemptService";

export function mediaAttemptService() {
  const runtime = mediaRuntime();
  if (!runtime.enabled) throw new MediaAttemptError("disabled");
  return createMediaAttemptService(new DrizzleEbayMediaRepository(getDatabase()), imageStorage, exportImageValidator,
    runtime.fixture, runtime.gateway, ebayRuntime().config.fingerprint);
}
