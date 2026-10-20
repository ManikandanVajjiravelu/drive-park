// Request-body schemas for the mobile-facing /api/public/* endpoints.
// Reuses the same validators as the web app so mobile and web stay in sync.
import { z } from "zod";
import {
  nameSchema,
  phoneSchema,
  vehicleNumberSchema,
  vehicleModelSchema,
} from "@/lib/validation";

/** POST /api/public/profile — only name and phone are writable. */
export const updateProfileSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
  })
  .strict();

const plateSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(vehicleNumberSchema);

const optionalModel = z
  .union([vehicleModelSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));

const optionalColour = z
  .union([z.string().trim().max(30), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));

/** POST /api/public/vehicles — discriminated union on `action`. */
export const vehiclesActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      plate: plateSchema,
      make: optionalModel,
      colour: optionalColour,
      is_default: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("set_default"), id: z.string().uuid() }).strict(),
]);

/** POST /api/public/notifications — discriminated union on `action`. */
export const notificationsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_read"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("mark_all_read") }).strict(),
]);
