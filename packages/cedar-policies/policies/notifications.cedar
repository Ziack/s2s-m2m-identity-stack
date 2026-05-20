// notifications.cedar — Notifications bounded-context M2M authorization.

permit (
  principal == M2M::ServicePrincipal::"notifications-service-client-id",
  action in [M2M::Action::"POST_notification", M2M::Action::"GET_notification_status"],
  resource in M2M::ResourceGroup::"notifications-resources"
) when {
  context.dpop_confirmed == true &&
  context.source_domain == "notifications" &&
  ((action == M2M::Action::"POST_notification" && context.scopes.contains("notifications/write")) ||
   (action == M2M::Action::"GET_notification_status" && context.scopes.contains("notifications/read")))
};

// Marketing notifications require an explicit scope.
forbid (
  principal,
  action == M2M::Action::"POST_notification",
  resource in M2M::ResourceGroup::"notifications-marketing"
) unless {
  context.scopes.contains("notifications/marketing")
};
