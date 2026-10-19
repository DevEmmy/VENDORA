import { z } from "zod";
import { passwordProblem } from '../services/password-policy';
export const phone = z
  .string()
  .max(20)
  .transform((value) => {
    let digits = value.replace(/[ +()-]/g, "");
    if (/^0\d{10}$/.test(digits)) digits = "234" + digits.slice(1);
    return digits;
  })
  .pipe(z.string().regex(/^[1-9]\d{9,14}$/));
export const credential = z.string().min(1).max(512);
export const password = z
  .string()
  .refine(
    (value) => passwordProblem(value) === null,
    "Use 8–128 characters and avoid common passwords",
  );
export const schemas = {
  register: z.object({
    phone,
    password,
    name: z.string().trim().min(2).max(200),
    businessName: z.string().trim().min(2).max(200),
    businessType: z.enum([
      "Foodstuff", "Provisions", "Clothing", "Phones & accessories",
      "Cosmetics", "Pharmacy", "Other",
    ]).or(z.literal("")).default(""),
    city: z.string().trim().max(200).default(""),
  }).strict(),
  login: z.object({ phone, password: credential }).strict(),
  destination: z.object({ phone }).strict(),
  reset: z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password })
    .strict(),
  change: z.object({ currentPassword: credential, password }).strict(),
  reauthenticate: z.object({ password: credential }).strict(),
  empty: z.object({}).strict(),
};
export type Registration = z.infer<typeof schemas.register>;
