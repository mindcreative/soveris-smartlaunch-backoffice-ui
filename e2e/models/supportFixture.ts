export interface SupportFixtureActor {
  id: string
  email: string
  password: string
}

export interface OwnedSupportFixture {
  operator: SupportFixtureActor
  owner: SupportFixtureActor
  other: SupportFixtureActor
  editor: SupportFixtureActor
  viewer: SupportFixtureActor
  targetClientId: string
  targetClientName: string
  ambiguousCustomerName: string
  productName: string
  productSlug: string
  productId: string
  draftCanary: string
  liveCanary: string
  reasonCanary: string
}
