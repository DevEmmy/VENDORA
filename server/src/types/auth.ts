import type { Business, Session, User } from "../generated/prisma/client";
export type AuthContext = { session: Session; user: User };
export const safeUser = (user: User) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  phoneVerified: user.phoneVerifiedAt !== null,
});
export const safeBusiness = (business: Business) => ({
  id: business.id,
  phone: business.phone,
  businessName: business.businessName,
  businessType: business.businessType,
  city: business.city,
});
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
