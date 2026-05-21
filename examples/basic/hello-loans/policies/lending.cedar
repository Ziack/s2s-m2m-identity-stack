// Permits any authenticated caller in the `lending` context to invoke /api/hello.
// Used by examples/basic to demonstrate the simplest possible Cedar wiring.
permit (
    principal,
    action == Action::"hello",
    resource
) when {
    principal has bounded_context && principal.bounded_context == "lending"
};
