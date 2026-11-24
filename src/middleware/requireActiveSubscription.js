// The platform billing feature reuses the school-wide entitlement middleware
// that already guards members, plans, memberships, attendance, expenses,
// reports and staff. This file exposes the canonical import path expected by
// the platform billing module without duplicating the implementation.

export { requireActiveSubscription } from "./subscription.js";
