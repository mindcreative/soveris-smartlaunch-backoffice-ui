import { createBillingSubscription } from './billingApi'

/** Kept only for historical hook tests. The active Backoffice route uses localSubscriptionApi. */
export const legacyBillingApi = { createSubscription: createBillingSubscription }
