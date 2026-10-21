import "server-only";
import { betterAuth } from "better-auth";
import { getDatabase } from "../infrastructure/db/client";
import { authOptions } from "./options";

let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  return instance ??= betterAuth(authOptions(getDatabase(), process.env));
}
