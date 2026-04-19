// Re-exports the shared evaluation rules so local bot files can use a short path.
export {
  evaluateOffer,
  loadPendingOffers,
  markOfferDecided,
  type EvalDecision,
} from '@vinted-system/shared';
