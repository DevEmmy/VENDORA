import { z } from "zod";
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
    (value) => [...value].length >= 6 && [...value].length <= 128,
    "Password must contain 6-128 characters",
  );
export const schemas = {
  register: z.object({ phone, password }).strict(),
  login: z.object({ phone, password: credential }).strict(),
  destination: z.object({ phone }).strict(),
  reset: z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password })
    .strict(),
  change: z.object({ currentPassword: credential, password }).strict(),
  reauthenticate: z.object({ password: credential }).strict(),
  empty: z.object({}).strict(),
};
