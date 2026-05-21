// No end-user is involved. Trust the actor chain — any S2S caller from the
// 'platform' bounded context may invoke /internal/*.
permit (
  principal,
  action,
  resource
) when {
  context.actor_chain.contains("platform") &&
  (action == Action::"readInternalStatus" || action == Action::"refreshCache")
};
