import type { Icon } from "@tabler/icons-react";
import {
  IconBell,
  IconBriefcase2,
  IconBuildingSkyscraper,
  IconChartBar,
  IconHome2,
  IconMessageCircle,
  IconNews,
  IconNotes,
  IconSchool,
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
  group: "work" | "directory" | "admin";
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
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.dashboard.read",
    end: true,
  },
  {
    id: "relocation",
    label: "Заявки и воронки",
    to: CRM_PATHS.relocation,
    icon: IconTruckDelivery,
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.case.list",
  },
  {
    id: "students",
    label: "Студенты",
    to: CRM_PATHS.students,
    icon: IconSchool,
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.case.list",
  },
  {
    id: "people",
    label: "Участники",
    to: CRM_PATHS.people,
    icon: IconBriefcase2,
    group: "directory",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.case.list",
  },
  {
    id: "tasks",
    label: "Задачи",
    to: CRM_PATHS.tasks,
    icon: IconNotes,
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.task.read",
  },
  {
    id: "employers",
    label: "Работодатели",
    to: CRM_PATHS.employers,
    icon: IconBuildingSkyscraper,
    group: "directory",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.employer.read",
  },
  {
    id: "reports",
    label: "Отчёты",
    to: CRM_PATHS.reports,
    icon: IconChartBar,
    group: "directory",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.report.build",
  },
  {
    id: "communications",
    label: "Коммуникации",
    to: CRM_PATHS.communications,
    icon: IconMessageCircle,
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.communication.read",
  },
  {
    id: "notifications",
    label: "Уведомления",
    to: CRM_PATHS.notifications,
    icon: IconBell,
    group: "work",
    businessRoles: ["SPECIALIST", "SUPER_ADMIN"],
    requiredPermission: "crm.notification.read",
  },
  {
    id: "admin-users",
    label: "Пользователи",
    to: CRM_PATHS.adminUsers,
    icon: IconUsers,
    group: "admin",
    businessRoles: ["SUPER_ADMIN"],
    requiredPermission: "identity.users.read",
  },
  {
    id: "admin-vacancies",
    label: "Вакансии лендинга",
    to: CRM_PATHS.adminVacancies,
    icon: IconSettings,
    group: "admin",
    businessRoles: ["SUPER_ADMIN"],
    requiredPermission: "content.vacancy.read",
  },
  {
    id: "admin-stories",
    label: "Истории лендинга",
    to: CRM_PATHS.adminStories,
    icon: IconNews,
    group: "admin",
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
  [CRM_PATHS.students]: ["ListCases", "ListCrmFunnels"],
  [CRM_PATHS.people]: ["ListCrmPeople"],
  [`${CRM_PATHS.root}/cases/:caseId`]: ["GetCase", "GetCandidateSummary"],
  [CRM_PATHS.employers]: ["ListEmployers"],
  [CRM_PATHS.tasks]: ["ListCrmTasks"],
  [CRM_PATHS.communications]: ["ListCrmActivities"],
  [CRM_PATHS.notifications]: ["ListNotifications", "MarkCrmNotificationRead"],
  [CRM_PATHS.reports]: ["ListCrmReportRuns", "GetCrmReportRun", "BuildCrmReport"],
  [CRM_PATHS.settingsSecurity]: ["ListOwnSessions", "RevokeOwnSession"],
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
