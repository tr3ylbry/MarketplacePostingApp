import type { MediaFixtureFactory, SimulatedMediaGateway } from "../../application/ebayMediaAttempt";
// Deliberately no real transport, credential lookup or environment toggle.
export function mediaRuntime(): { enabled: false } | { enabled: true; fixture: MediaFixtureFactory; gateway: SimulatedMediaGateway } { return { enabled: false }; }
