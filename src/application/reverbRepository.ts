import type { ReverbEnvironment, ReverbOption, ReverbRemoteListing } from "./reverbGateway";

export interface EncryptedCredential { encryptedToken: string; iv: string; authTag: string }
export interface ReverbConnection extends EncryptedCredential {
  ownerId: string; environment: ReverbEnvironment; version: string; shopId: string; shopName: string;
  connectedAt: string; updatedAt: string; needsReconnect: boolean;
}
export interface ReverbSelection { category: ReverbOption; condition: ReverbOption; shippingProfile?: ReverbOption }
export interface DraftReview {
  id: string; ownerId: string; listingId: string; environment: ReverbEnvironment; shopId: string;
  connectionVersion: string; listingVersion: string; selection: ReverbSelection; expiresAt: string;
}
export interface DraftClaim { review: DraftReview; attemptId: string; postAttempted: boolean; externalId?: string }
export interface ManagementClaim {
  ownerId: string; listingId: string; environment: ReverbEnvironment; shopId: string;
  connectionVersion: string; listingVersion: string; token: string;
  externalId?: string; postAttempted: boolean;
}
export interface ReverbRepository {
  connection(ownerId: string, environment: ReverbEnvironment): Promise<ReverbConnection | null>;
  connect(connection: ReverbConnection): Promise<void>;
  disconnect(ownerId: string, environment: ReverbEnvironment): Promise<void>;
  markReconnect(ownerId: string, environment: ReverbEnvironment, version: string): Promise<void>;
  prepare(review: DraftReview): Promise<void>;
  claim(ownerId: string, environment: ReverbEnvironment, reviewId: string): Promise<DraftClaim>;
  markPosting(claim: DraftClaim): Promise<void>;
  rejectedPost(claim: DraftClaim): Promise<void>;
  finish(claim: DraftClaim, remote: ReverbRemoteListing): Promise<void>;
  release(claim: DraftClaim): Promise<void>;
  claimManagement(ownerId: string, environment: ReverbEnvironment, listingId: string): Promise<ManagementClaim>;
  verifyManagement(claim: ManagementClaim): Promise<void>;
  reconcile(claim: ManagementClaim, remote: ReverbRemoteListing | null): Promise<void>;
  releaseManagement(claim: ManagementClaim): Promise<void>;
}
