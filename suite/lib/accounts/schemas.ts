import { z } from "zod";
export { check } from "@/lib/sync/schemas";

export const inviteEmailSchema = z.object({
  email: z.email("That does not look like an email address."),
});

/** Token from `create_invite`: two concatenated UUIDs with hyphens stripped. 64 hex characters. */
export const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-f0-9]+$/, "That is not an invite token.");
