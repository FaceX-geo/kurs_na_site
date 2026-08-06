import { crmApiClient, requireApiData, requireApiSuccess } from "@/shared/api/client";
import type { operations } from "@/shared/api/generated/openapi";
import { buildMutationHeaders, createIdempotencyKey } from "@/shared/api/request-descriptor";

type JsonResponse<Operation, Status extends number> = Operation extends {
  responses: infer Responses;
}
  ? Status extends keyof Responses
    ? Responses[Status] extends { content: { "application/json": infer Body } }
      ? Body
      : never
    : never
  : never;

type JsonRequestBody<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

export type DashboardResponse = JsonResponse<operations["GetCrmDashboard"], 200>;
export type CasesResponse = JsonResponse<operations["ListCases"], 200>;
export type CaseResponse = JsonResponse<operations["GetCase"], 200>;
export type CandidateSummaryResponse = JsonResponse<operations["GetCandidateSummary"], 200>;
export type FunnelsResponse = JsonResponse<operations["ListCrmFunnels"], 200>;
export type PeopleResponse = JsonResponse<operations["ListCrmPeople"], 200>;
export type TasksResponse = JsonResponse<operations["ListCrmTasks"], 200>;
export type EmployersResponse = JsonResponse<operations["ListEmployers"], 200>;
export type ReportRunsResponse = JsonResponse<operations["ListCrmReportRuns"], 200>;
export type UsersResponse = JsonResponse<operations["ListUsers"], 200>;
export type InviteUserRequest = JsonRequestBody<operations["InviteUser"]>;
export type InviteUserResponse = JsonResponse<operations["InviteUser"], 202>;
export type ProvisionableEmployeesResponse = JsonResponse<
  operations["ListProvisionableEmployees"],
  200
>;
export type ProvisionSpecialistRequest = JsonRequestBody<operations["ProvisionSpecialist"]>;
export type ProvisionSpecialistResponse = JsonResponse<operations["ProvisionSpecialist"], 202>;
export type AdminVacanciesResponse = JsonResponse<operations["ListAdminVacancies"], 200>;
export type AdminVacancy = AdminVacanciesResponse["items"][number];
export type CreateVacancyRequest = JsonRequestBody<operations["CreateVacancy"]>;
export type UpdateVacancyRequest = JsonRequestBody<operations["UpdateVacancy"]>;
export type AdminStoriesResponse = JsonResponse<operations["ListAdminStories"], 200>;
export type AdminStory = AdminStoriesResponse["items"][number];
export type CreateStoryRequest = JsonRequestBody<operations["CreateStory"]>;
export type UpdateStoryRequest = JsonRequestBody<operations["UpdateStory"]>;
export type NotificationsResponse = JsonResponse<operations["ListNotifications"], 200>;
export type NotificationResponse = JsonResponse<operations["MarkCrmNotificationRead"], 200>;
export type OwnSessionListResponse = JsonResponse<operations["ListOwnSessions"], 200>;
export type ActivitiesResponse = JsonResponse<operations["ListCrmActivities"], 200>;

export interface CasesQuery {
  cursor?: string;
  funnelCode?: string;
  limit?: number;
  search?: string;
  stageCode?: string;
  status?: string;
}

export interface PeopleQuery {
  cursor?: string;
  dataQualityState?: string;
  limit?: number;
  profileState?: string;
  programType?: string;
  search?: string;
}

export interface TasksQuery {
  cursor?: string;
  limit?: number;
  overdue?: boolean;
  state?: string;
}

export interface EmployersQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: string;
}

export interface UsersQuery {
  accountState?: "active" | "disabled" | "archived";
  limit?: number;
  mfaState?: "not_enrolled" | "enrollment_required" | "enrolled" | "recovery_required";
  search?: string;
  cursor?: string;
}

export interface ProvisionableEmployeesQuery {
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface AdminContentQuery {
  cursor?: string;
  limit?: number;
  state?: "draft" | "published" | "archived";
}

export interface NotificationsQuery {
  limit?: number;
  typeCode?: string;
  unreadOnly?: boolean;
}

export interface ActivitiesQuery {
  activityType?: string;
  direction?: string;
  limit?: number;
}

async function contentStateMutation(
  path:
    | "/internal/v1/admin/content/vacancies/{contentId}/publish"
    | "/internal/v1/admin/content/vacancies/{contentId}/archive",
  contentId: string,
  version: number,
  reason: string,
  idempotencyKey: string,
): Promise<AdminVacancy> {
  const headers = buildMutationHeaders({
    csrf: "required",
    idempotencyKey,
    ifMatch: String(version),
  });
  const csrfToken = headers["x-csrf-token"];
  const idempotencyHeader = headers["idempotency-key"];
  const ifMatch = headers["if-match"];
  if (!csrfToken || !idempotencyHeader || !ifMatch) {
    throw new Error("Vacancy state mutation header invariant failed");
  }
  return requireApiData(
    await crmApiClient.POST(path, {
      body: { reason },
      params: {
        path: { contentId },
        header: {
          "idempotency-key": idempotencyHeader,
          "x-csrf-token": csrfToken,
          "if-match": ifMatch,
        },
      },
    }),
  );
}

async function storyStateMutation(
  path:
    | "/internal/v1/admin/content/stories/{contentId}/publish"
    | "/internal/v1/admin/content/stories/{contentId}/archive",
  contentId: string,
  version: number,
  reason: string,
  idempotencyKey: string,
): Promise<AdminStory> {
  const headers = buildMutationHeaders({
    csrf: "required",
    idempotencyKey,
    ifMatch: String(version),
  });
  const csrfToken = headers["x-csrf-token"];
  const idempotencyHeader = headers["idempotency-key"];
  const ifMatch = headers["if-match"];
  if (!csrfToken || !idempotencyHeader || !ifMatch) {
    throw new Error("Story state mutation header invariant failed");
  }
  return requireApiData(
    await crmApiClient.POST(path, {
      body: { reason },
      params: {
        path: { contentId },
        header: {
          "idempotency-key": idempotencyHeader,
          "x-csrf-token": csrfToken,
          "if-match": ifMatch,
        },
      },
    }),
  );
}

export const crmApi = {
  async getDashboard(timezone = "Europe/Moscow"): Promise<DashboardResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/dashboard", {
        params: { query: { timezone } },
      }),
    );
  },

  async listCases(query: CasesQuery = {}): Promise<CasesResponse> {
    return requireApiData(await crmApiClient.GET("/internal/v1/crm/cases", { params: { query } }));
  },

  async getCase(caseId: string): Promise<CaseResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/cases/{caseId}", {
        params: { path: { caseId } },
      }),
    );
  },

  async getCandidateSummary(personId: string): Promise<CandidateSummaryResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/people/{personId}/summary", {
        params: { path: { personId } },
      }),
    );
  },

  async listFunnels(): Promise<FunnelsResponse> {
    return requireApiData(await crmApiClient.GET("/internal/v1/crm/funnels"));
  },

  async listPeople(query: PeopleQuery = {}): Promise<PeopleResponse> {
    return requireApiData(await crmApiClient.GET("/internal/v1/crm/people", { params: { query } }));
  },

  async listTasks(query: TasksQuery = {}): Promise<TasksResponse> {
    return requireApiData(await crmApiClient.GET("/internal/v1/crm/tasks", { params: { query } }));
  },

  async listEmployers(query: EmployersQuery = {}): Promise<EmployersResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/employers", { params: { query } }),
    );
  },

  async listReportRuns(limit = 50): Promise<ReportRunsResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/report-runs", {
        params: { query: { limit } },
      }),
    );
  },

  async listUsers(query: UsersQuery = {}): Promise<UsersResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/admin/users", { params: { query } }),
    );
  },

  async inviteUser(body: InviteUserRequest): Promise<InviteUserResponse> {
    const headers = buildMutationHeaders({ csrf: "required" });
    const csrfToken = headers["x-csrf-token"];
    if (!csrfToken) throw new Error("CSRF header invariant failed");
    return requireApiData(
      await crmApiClient.POST("/internal/v1/admin/users/invitations", {
        body,
        params: { header: { "x-csrf-token": csrfToken } },
      }),
    );
  },

  async listProvisionableEmployees(
    query: ProvisionableEmployeesQuery = {},
  ): Promise<ProvisionableEmployeesResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/admin/employees", { params: { query } }),
    );
  },

  async provisionSpecialist(
    body: ProvisionSpecialistRequest,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<ProvisionSpecialistResponse> {
    const headers = buildMutationHeaders({ csrf: "required", idempotencyKey });
    const csrfToken = headers["x-csrf-token"];
    const idempotencyHeader = headers["idempotency-key"];
    if (!csrfToken || !idempotencyHeader) {
      throw new Error("Specialist provisioning header invariant failed");
    }
    return requireApiData(
      await crmApiClient.POST("/internal/v1/admin/specialists", {
        body,
        params: {
          header: {
            "idempotency-key": idempotencyHeader,
            "x-csrf-token": csrfToken,
          },
        },
      }),
    );
  },

  async listAdminVacancies(query: AdminContentQuery = {}): Promise<AdminVacanciesResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/admin/content/vacancies", {
        params: { query },
      }),
    );
  },

  async createVacancy(
    body: CreateVacancyRequest,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminVacancy> {
    const headers = buildMutationHeaders({
      csrf: "required",
      idempotencyKey,
    });
    const csrfToken = headers["x-csrf-token"];
    const idempotencyHeader = headers["idempotency-key"];
    if (!csrfToken || !idempotencyHeader) {
      throw new Error("Vacancy creation header invariant failed");
    }
    return requireApiData(
      await crmApiClient.POST("/internal/v1/admin/content/vacancies", {
        body,
        params: {
          header: {
            "idempotency-key": idempotencyHeader,
            "x-csrf-token": csrfToken,
          },
        },
      }),
    );
  },

  async updateVacancy(
    contentId: string,
    version: number,
    body: UpdateVacancyRequest,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminVacancy> {
    const headers = buildMutationHeaders({
      csrf: "required",
      idempotencyKey,
      ifMatch: String(version),
    });
    const csrfToken = headers["x-csrf-token"];
    const idempotencyHeader = headers["idempotency-key"];
    const ifMatch = headers["if-match"];
    if (!csrfToken || !idempotencyHeader || !ifMatch) {
      throw new Error("Vacancy update header invariant failed");
    }
    return requireApiData(
      await crmApiClient.PATCH("/internal/v1/admin/content/vacancies/{contentId}", {
        body,
        params: {
          path: { contentId },
          header: {
            "idempotency-key": idempotencyHeader,
            "x-csrf-token": csrfToken,
            "if-match": ifMatch,
          },
        },
      }),
    );
  },

  async publishVacancy(
    contentId: string,
    version: number,
    reason: string,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminVacancy> {
    return contentStateMutation(
      "/internal/v1/admin/content/vacancies/{contentId}/publish",
      contentId,
      version,
      reason,
      idempotencyKey,
    );
  },

  async archiveVacancy(
    contentId: string,
    version: number,
    reason: string,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminVacancy> {
    return contentStateMutation(
      "/internal/v1/admin/content/vacancies/{contentId}/archive",
      contentId,
      version,
      reason,
      idempotencyKey,
    );
  },

  async listAdminStories(query: AdminContentQuery = {}): Promise<AdminStoriesResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/admin/content/stories", {
        params: { query },
      }),
    );
  },

  async createStory(
    body: CreateStoryRequest,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminStory> {
    const headers = buildMutationHeaders({
      csrf: "required",
      idempotencyKey,
    });
    const csrfToken = headers["x-csrf-token"];
    const idempotencyHeader = headers["idempotency-key"];
    if (!csrfToken || !idempotencyHeader) {
      throw new Error("Story creation header invariant failed");
    }
    return requireApiData(
      await crmApiClient.POST("/internal/v1/admin/content/stories", {
        body,
        params: {
          header: {
            "idempotency-key": idempotencyHeader,
            "x-csrf-token": csrfToken,
          },
        },
      }),
    );
  },

  async updateStory(
    contentId: string,
    version: number,
    body: UpdateStoryRequest,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminStory> {
    const headers = buildMutationHeaders({
      csrf: "required",
      idempotencyKey,
      ifMatch: String(version),
    });
    const csrfToken = headers["x-csrf-token"];
    const idempotencyHeader = headers["idempotency-key"];
    const ifMatch = headers["if-match"];
    if (!csrfToken || !idempotencyHeader || !ifMatch) {
      throw new Error("Story update header invariant failed");
    }
    return requireApiData(
      await crmApiClient.PATCH("/internal/v1/admin/content/stories/{contentId}", {
        body,
        params: {
          path: { contentId },
          header: {
            "idempotency-key": idempotencyHeader,
            "x-csrf-token": csrfToken,
            "if-match": ifMatch,
          },
        },
      }),
    );
  },

  async publishStory(
    contentId: string,
    version: number,
    reason: string,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminStory> {
    return storyStateMutation(
      "/internal/v1/admin/content/stories/{contentId}/publish",
      contentId,
      version,
      reason,
      idempotencyKey,
    );
  },

  async archiveStory(
    contentId: string,
    version: number,
    reason: string,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<AdminStory> {
    return storyStateMutation(
      "/internal/v1/admin/content/stories/{contentId}/archive",
      contentId,
      version,
      reason,
      idempotencyKey,
    );
  },

  async listNotifications(query: NotificationsQuery = {}): Promise<NotificationsResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/notifications", { params: { query } }),
    );
  },

  async markNotificationRead(
    notificationId: string,
    version: number,
  ): Promise<NotificationResponse> {
    const headers = buildMutationHeaders({ csrf: "required", ifMatch: String(version) });
    const csrfToken = headers["x-csrf-token"];
    const ifMatch = headers["if-match"];
    if (!csrfToken || !ifMatch) throw new Error("Notification mutation header invariant failed");
    return requireApiData(
      await crmApiClient.POST("/internal/v1/crm/notifications/{notificationId}/read", {
        params: {
          path: { notificationId },
          header: { "x-csrf-token": csrfToken, "if-match": ifMatch },
        },
      }),
    );
  },

  async listOwnSessions(limit = 100): Promise<OwnSessionListResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/auth/sessions", {
        params: { query: { limit } },
      }),
    );
  },

  async revokeOwnSession(sessionId: string, reason: string): Promise<void> {
    const headers = buildMutationHeaders({ csrf: "required" });
    const csrfToken = headers["x-csrf-token"];
    if (!csrfToken) throw new Error("CSRF header invariant failed");
    requireApiSuccess(
      await crmApiClient.POST("/internal/v1/auth/sessions/{sessionId}/revoke", {
        params: {
          path: { sessionId },
          header: { "x-csrf-token": csrfToken },
        },
        body: { reason },
      }),
    );
  },

  async listActivities(query: ActivitiesQuery = {}): Promise<ActivitiesResponse> {
    return requireApiData(
      await crmApiClient.GET("/internal/v1/crm/activities", { params: { query } }),
    );
  },
};
