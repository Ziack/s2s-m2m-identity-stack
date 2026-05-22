/**
 * Insecure-TLS escape hatch for PoC / fixture environments only.
 *
 * Behind the s2s platform ALB, TLS is terminated at the load balancer. The
 * fixture ALB uses a SELF-SIGNED certificate (see modules/s2s-platform/alb.tf),
 * so outbound HTTPS calls between services (calling → receiving → ledger) fail
 * certificate verification.
 *
 * Rather than hardcode `NODE_TLS_REJECT_UNAUTHORIZED=0` (which would silently
 * disable TLS verification for ALL outbound TLS, in every environment), this
 * helper makes the bypass an EXPLICIT, default-OFF opt-in: it only takes effect
 * when `ALLOW_INSECURE_TLS=true` is set in the environment.
 *
 * PRODUCTION MUST attach a real ACM certificate to the ALB (see the
 * s2s-platform README) so this flag is never needed and TLS verification stays
 * on. Do NOT set ALLOW_INSECURE_TLS in production.
 */
export function applyInsecureTlsEscapeHatch(
  env: NodeJS.ProcessEnv = process.env,
  log: (msg: string) => void = (msg) => console.warn(msg),
): boolean {
  if ((env.ALLOW_INSECURE_TLS ?? '').toLowerCase() !== 'true') {
    return false;
  }
  // Loud, unmissable warning — this disables outbound TLS cert verification.
  log(
    '[SECURITY WARNING] ALLOW_INSECURE_TLS=true — disabling outbound TLS ' +
      'certificate verification (NODE_TLS_REJECT_UNAUTHORIZED=0). This is for ' +
      'self-signed-cert PoC/fixture use ONLY. Production MUST use a real ACM ' +
      'certificate and leave ALLOW_INSECURE_TLS unset.',
  );
  env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  return true;
}
