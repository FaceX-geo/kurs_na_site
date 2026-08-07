import type { Icon } from "@tabler/icons-react";
import {
  IconBriefcase2,
  IconBuildingSkyscraper,
  IconChartBar,
  IconHome2,
  IconNews,
  IconNotes,
  IconSettings,
  IconTruckDelivery,
  IconUsers,
} from "@tabler/icons-react";
import { CRM_PATHS } from "@/app/paths";
import { hasBusinessRole, hasPermission } from "@/shared/auth/policy";
import type { AuthSession, BusinessRole } from "@/shared/auth/types";

export type NavigationItem = {
  id: string;
  label: string;
  to: string;
  icon: Icon;
  businessRoles: readonly BusinessRole[];
  requiredPermission?: string;
  end?: boolean;
};

export const primaryNavigation: readonly NavigationItem[] = [
  {
    id: "work",
    label: "Моя работа",
    to: CRM_PATHS.dashboard,
    icon: IconHome2,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.dashboard.read",
    end: true,
  },
  {
    id: "relocation",
    label: "Заявки и воронки",
    to: CRM_PATHS.relocation,
    icon: IconTruckDelivery,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.case.list",
  },
  {
    id: "people",
    label: "Участники",
    to: CRM_PATHS.people,
    icon: IconBriefcase2,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.case.list",
  },
  {
    id: "tasks",
    label: "Задачи",
    to: CRM_PATHS.tasks,
    icon: IconNotes,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.task.read",
  },
  {
    id: "employers",
    label: "Работодатели",
    to: CRM_PATHS.employers,
    icon: IconBuildingSkyscraper,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.employer.read",
  },
  {
    id: "reports",
    label: "Отчёты",
    to: CRM_PATHS.reports,
    icon: IconChartBar,
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.report.build",
  },
  {
    id: "admin-users",
    label: "Пользователи",
    to: CRM_PATHS.adminUsers,
    icon: IconUsers,
    businessRoles: ["SUPER_ADMIN"],
    requiredPermission: "identity.users.read",
  },
  {
    id: "admin-vacancies",
    label: "Вакансии лендинга",
    to: CRM_PATHS.adminVacancies,
    icon: IconSettings,
    businessRoles: ["SUPER_ADMIN"],
    requiredPermission: "content.vacancy.read",
  },
  {
    id: "admin-stories",
    label: "Истории лендинга",
    to: CRM_PATHS.adminStories,
    icon: IconNews,
    businessRoles: ["SUPER_ADMIN"],
    requiredPermission: "content.story.read",
  },
];

export function navigationForSession(session: AuthSession | null): NavigationItem[] {
  return primaryNavigation.filter(
    (item) =>
      hasBusinessRole(session, item.businessRoles) &&
      (!item.requiredPermission || hasPermission(session, item.requiredPermission)),
  );
}

export const routeOperations: Record<string, readonly string[]> = {
  [CRM_PATHS.dashboard]: ["GetCrmDashboard"],
  [CRM_PATHS.relocation]: ["ListCases", "ListCrmFunnels"],
  [CRM_PATHS.people]: ["ListCrmPeople"],
  [`${CRM_PATHS.root}/cases/:caseId`]: ["GetCase", "GetCandidateSummary"],
  [CRM_PATHS.employers]: ["ListEmployers"],
  [CRM_PATHS.tasks]: ["ListCrmTasks"],
  [CRM_PATHS.notifications]: ["ListNotifications", "MarkCrmNotificationRead"],
  [CRM_PATHS.reports]: ["ListCrmReportRuns", "BuildCrmReport"],
  [CRM_PATHS.adminUsers]: ["ListUsers", "ListProvisionableEmployees", "ProvisionSpecialist"],
  [CRM_PATHS.adminVacancies]: [
    "ListAdminVacancies",
    "CreateVacancy",
    "UpdateVacancy",
    "PublishVacancy",
    "ArchiveVacancy",
  ],
  [CRM_PATHS.adminStories]: [
    "ListAdminStories",
    "CreateStory",
    "UpdateStory",
    "PublishStory",
    "ArchiveStory",
  ],
};
