import type {
  CreateApplicationCommand,
  CursorPage,
  IdempotentWriteResult,
  IntakeRepositoryPort,
  IntakeStoragePort,
  PublicVacancyQuery,
  StoreUploadCommand,
} from "../src/modules/intake/ports.js";
import type {
  ApplicationPayload,
  ApplicationReceipt,
  MapPoint,
  Sphere,
  UploadReceipt,
  Vacancy,
} from "../src/modules/intake/schemas.js";

export const sphere: Sphere = { value: "medicine", label: "Медицина" };

export const mapPoint: MapPoint = {
  id: "murmansk",
  name: "Мурманск",
  longitude: 33.075,
  latitude: 68.97,
  sectors: ["medicine"],
  status: "published",
};

export const vacancy: Vacancy = {
  id: "vac_medicine_01",
  sector: "medicine",
  title: "Врач-терапевт",
  city: "Мурманск",
  employer: "Работодатель проекта",
  salaryText: "от 150 000 ₽",
  summary: "Работа в городской поликлинике.",
  responsibilities: ["Приём пациентов"],
  requirements: ["Высшее медицинское образование"],
  conditions: ["Поддержка переезда"],
  applicantType: "relocation",
  sphere: "medicine",
  published: true,
};

export const applicationPayload: ApplicationPayload = {
  personal: {
    surname: "Иванов",
    name: "Иван",
    middlename: "Иванович",
    birthdate: "1990-06-12",
    email: "Ivanov@Example.com",
    phone: "+7 (911) 111-22-33",
  },
  application: {
    applicantType: "relocation",
    region: "Санкт-Петербург",
    sphere: "medicine",
    wishPost: "Врач-терапевт",
    wishSalary: "150000",
  },
  consents: { privacyAccepted: true },
  attachments: { resumeFileId: "file_resume_01" },
  meta: {
    source: "web",
    entryPoint: {
      source: "direct",
      vacancyId: "",
      vacancySector: "",
    },
    utm: { utm_source: "vk", utm_campaign: "kns-2026" },
    timestamp: "2026-08-06T09:00:00.000Z",
    clientFingerprint: "fp_123",
  },
};

export const canonicalApplicationPayload: ApplicationPayload = {
  ...applicationPayload,
  consents: {
    privacyAccepted: true,
    privacyPolicyVersion: "landing-inline-2026-08-06",
    acceptedAt: "2026-08-06T08:59:00.000Z",
  },
  attachments: {
    resumeFileId: "file_resume_01",
    resumeFileBindingToken: "ub1.test-binding-token-that-is-at-least-thirty-two-characters",
  },
};

export const applicationReceipt: ApplicationReceipt = {
  applicationId: "app_01",
  status: "received",
  createdAt: "2026-08-06T09:00:00.000Z",
};

export const uploadReceipt: UploadReceipt = {
  fileId: "file_resume_01",
  bindingToken: "ub1.test-binding-token-that-is-at-least-thirty-two-characters",
  name: "resume.pdf",
  size: 15,
  status: "quarantined",
};

export class FakeIntakeRepository implements IntakeRepositoryPort {
  readonly vacancyQueries: PublicVacancyQuery[] = [];
  readonly applicationCommands: CreateApplicationCommand[] = [];

  spheres: readonly Sphere[] = [sphere];
  mapPoints: readonly MapPoint[] = [mapPoint];
  vacancyPage: CursorPage<Vacancy> = { items: [vacancy], nextCursor: "cursor_next" };
  applicationResult: IdempotentWriteResult<ApplicationReceipt> = {
    state: "created",
    value: applicationReceipt,
  };

  async listSpheres(): Promise<readonly Sphere[]> {
    return this.spheres;
  }

  async listMapPoints(): Promise<readonly MapPoint[]> {
    return this.mapPoints;
  }

  async listVacancies(query: PublicVacancyQuery): Promise<CursorPage<Vacancy>> {
    this.vacancyQueries.push(query);
    return this.vacancyPage;
  }

  async findPublishedVacancyById(vacancyId: string): Promise<Vacancy | null> {
    return this.vacancyPage.items.find((item) => item.published && item.id === vacancyId) ?? null;
  }

  async createApplication(
    command: CreateApplicationCommand,
  ): Promise<IdempotentWriteResult<ApplicationReceipt>> {
    this.applicationCommands.push(command);
    return this.applicationResult;
  }
}

export class FakeIntakeStorage implements IntakeStoragePort {
  readonly commands: StoreUploadCommand[] = [];
  result: IdempotentWriteResult<UploadReceipt> = { state: "created", value: uploadReceipt };

  async storeUpload(command: StoreUploadCommand): Promise<IdempotentWriteResult<UploadReceipt>> {
    this.commands.push(command);
    return this.result;
  }
}

export function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.7\n%%EOF\n", "ascii");
}

export function multipartBody(
  boundary: string,
  fileName: string,
  mediaType: string,
  bytes: Uint8Array,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
      "utf8",
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}
