import type { ApplicationReceipt, MapPoint, Sphere, UploadReceipt, Vacancy } from "./schemas.js";

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface PublicVacancyQuery {
  readonly sector: Vacancy["sector"] | null;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface NormalizedEntryPoint {
  readonly code: string;
  readonly role: string | null;
  readonly sphere: string | null;
  readonly city: string | null;
  readonly applicantType: "relocation" | "student" | null;
  readonly vacancyId: string | null;
  readonly vacancySector: Vacancy["sector"] | null;
}

export interface NormalizedAttributionTouch {
  readonly capturedAt: string | null;
  readonly landingUrl: string | null;
  readonly referrer: string | null;
  readonly utm: Readonly<Record<string, string>>;
  readonly clickIds: Readonly<Record<string, string>>;
}

export interface NormalizedMeta {
  readonly source: string;
  readonly entryPoint: NormalizedEntryPoint;
  readonly legacyUtm: Readonly<Record<string, string>>;
  readonly submittedAt: string | null;
  readonly legacyClientFingerprint: string | null;
  readonly sessionId: string | null;
  readonly consentState: "necessary" | "all" | null;
  readonly landing: {
    readonly host: string | null;
    readonly path: string | null;
    readonly url: string | null;
  };
  readonly firstTouch: NormalizedAttributionTouch | null;
  readonly lastTouch: NormalizedAttributionTouch | null;
}

export interface NormalizedPersonalData {
  readonly surname: string;
  readonly name: string;
  readonly middlename: string | null;
  readonly birthdate: string;
  readonly email: string;
  readonly phoneE164: string;
}

interface NormalizedApplicationBase {
  readonly referralCode: string | null;
  readonly region: string;
  readonly comment: string | null;
  readonly vacancyId: string | null;
  readonly vacancySector: Vacancy["sector"] | null;
}

export interface NormalizedRelocationApplication extends NormalizedApplicationBase {
  readonly applicantType: "relocation";
  readonly sphere: string;
  readonly wishPost: string;
  readonly wishSalaryRub: number | null;
}

export interface NormalizedStudentApplication extends NormalizedApplicationBase {
  readonly applicantType: "student";
  readonly studentProfile: {
    readonly institution: string;
    readonly specialty: string;
    readonly graduationYear: number;
    readonly status: "1" | "2" | "3" | "4" | "5" | "6" | "graduated";
    readonly practicePeriod: {
      readonly start: string;
      readonly end: string;
    } | null;
  };
}

export type NormalizedApplication = NormalizedRelocationApplication | NormalizedStudentApplication;

export interface NormalizedApplicationInput {
  readonly schemaVersion: string;
  readonly personal: NormalizedPersonalData;
  readonly application: NormalizedApplication;
  readonly consent: {
    readonly privacyAccepted: true;
    readonly privacyPolicyVersion: string | null;
    readonly acceptedAt: string | null;
    readonly evidence: "client" | "server-received-compat";
  };
  readonly attachments: {
    readonly resumeFileId: string;
    /** Raw one-time credential. Adapters must verify it and must never persist or log it. */
    readonly resumeFileBindingToken: string | null;
  };
  readonly meta: NormalizedMeta;
}

export interface CreateApplicationCommand {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly receivedAt: string;
  readonly input: NormalizedApplicationInput;
  /** True for /public/v1; only the explicitly deprecated alias may set this to false. */
  readonly requireUploadBinding: boolean;
}

export interface StoreUploadCommand {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly receivedAt: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export type IdempotentWriteResult<T> =
  | { readonly state: "created" | "replayed"; readonly value: T }
  | { readonly state: "conflict" };

export interface IntakeRepositoryPort {
  listSpheres(): Promise<readonly Sphere[]>;
  listMapPoints(): Promise<readonly MapPoint[]>;
  listVacancies(query: PublicVacancyQuery): Promise<CursorPage<Vacancy>>;
  findPublishedVacancyById(vacancyId: string): Promise<Vacancy | null>;
  /**
   * Implementations must enforce idempotency atomically with the application insert and verify
   * that resumeFileId points to an upload that is eligible for this public application.
   */
  createApplication(command: CreateApplicationCommand): Promise<IdempotentWriteResult<ApplicationReceipt>>;
}

export interface IntakeStoragePort {
  /** Implementations must persist the upload and its idempotency record in one atomic unit. */
  storeUpload(command: StoreUploadCommand): Promise<IdempotentWriteResult<UploadReceipt>>;
}
