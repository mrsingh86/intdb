// Supabase Database Types
// To regenerate: npx supabase login && npx supabase gen types typescript --project-id jkvlggqkccozyouvipso > types/database.types.ts

// For now, use the manual types from:
// - types/email-intelligence.ts (existing email/document types)
// - types/intelligence-platform.ts (stakeholders, documents, notifications, action center)

export * from './email-intelligence'
export * from './intelligence-platform'
