// Any authenticated caller in the chain may create an order.
permit (
  principal,
  action == Action::"createOrder",
  resource
);

// Approving requires the inbound user to be a manager.
permit (
  principal,
  action == Action::"approveOrder",
  resource
) when {
  context.user.roles.contains("manager")
};

// Reading an order is open to any authenticated caller.
permit (
  principal,
  action == Action::"readOrder",
  resource
);
