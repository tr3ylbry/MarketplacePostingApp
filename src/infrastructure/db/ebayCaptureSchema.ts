import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import type { CaptureReport } from "../../application/ebayCaptureReport";
import { ebayRealMediaAttempts } from "./ebayRealMediaSchema";

export const ebayMediaCaptures=pgTable("ebay_media_captures",{
  id:text("id").primaryKey(),attemptId:text("attempt_id").notNull().references(()=>ebayRealMediaAttempts.id,{onDelete:"restrict"}),
  report:jsonb("report").$type<CaptureReport>().notNull(),fingerprint:text("fingerprint").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true,mode:"string",precision:3}).notNull().defaultNow(),
},t=>[
  uniqueIndex("media_capture_repeat").on(t.attemptId,t.fingerprint),
  check("media_capture_report",sql`public.capture_report_valid(${t.report})`),
  check("media_capture_fingerprint",sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
]);
