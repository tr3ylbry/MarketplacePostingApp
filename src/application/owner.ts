import { z } from "zod";

export const LEGACY_OWNER_ID = "legacy-unclaimed";
// Identity is supplied by trusted server session code, never a mutation payload.
export const ownerIdSchema = z.string().min(1).max(200).refine(id => id !== LEGACY_OWNER_ID);
export type OwnerId = string;
