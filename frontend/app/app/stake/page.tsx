import { redirect } from "next/navigation";

/**
 * GHB-196: stake feature parked until the Anchor program is redeployed
 * (tracked in GHB-195). StakeClient.tsx is preserved as frozen code for
 * fast reactivation — restore this file by uncommenting the previous
 * implementation when GHB-195 lands.
 */
export default function StakePage() {
  redirect("/app/credentials");
}
