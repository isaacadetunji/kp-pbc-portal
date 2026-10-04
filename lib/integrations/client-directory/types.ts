/**
 * Client directory integration contract.
 *
 * The firm's existing client database is the source of truth for client master
 * data. The portal reads from it through this interface only, so swapping the
 * mock for the real API (or a different vendor later) touches nothing else.
 */
export interface DirectoryContact {
  externalId?: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  position?: string | null;
  isPrimary?: boolean;
}

export interface DirectoryClient {
  externalId: string;
  name: string;
  rcNumber?: string | null;
  tin?: string | null;
  industry?: string | null;
  natureOfBusiness?: string | null;
  address?: string | null;
  /** 1-12 */
  yearEndMonth?: number | null;
  /** 1-31 */
  yearEndDay?: number | null;
  email?: string | null;
  phone?: string | null;
  isActive: boolean;
  /** Parent / group the entity belongs to, if the client database tracks it */
  groupName?: string | null;
  contacts: DirectoryContact[];
  /** Original payload, kept for traceability */
  raw?: unknown;
}

export interface ClientDirectory {
  readonly mode: "mock" | "rest";
  /** All clients (optionally only those changed since an ISO timestamp). */
  listClients(options?: { updatedSince?: string }): Promise<DirectoryClient[]>;
  getClient(externalId: string): Promise<DirectoryClient | null>;
  searchClients(query: string): Promise<DirectoryClient[]>;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}
