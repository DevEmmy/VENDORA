import type { Session, User } from "../generated/prisma/client";
export type AuthContext = { session: Session; user: User };
export const safeUser = (user: User) => ({
  id: user.id,
  phone: user.phone,
  phoneVerified: user.phoneVerifiedAt !== null,
});
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
