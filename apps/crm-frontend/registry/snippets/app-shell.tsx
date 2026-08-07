// component-id: ui.app-shell
import { IconBriefcase, IconBuilding, IconChartBar, IconHome, IconMapPin } from "@tabler/icons-react";
import { AppShell, type AppShellNavigationItem } from "@/shared/ui";

const navigation: AppShellNavigationItem[] = [
  { id: "work", label: "Моя работа", href: "/cabinet/crm/dashboard", icon: <IconHome />, businessRoles: ["SPECIALIST", "SUPER_ADMIN"], requiredPermission: "crm.dashboard.read" },
  { id: "relocation", label: "Заявки и воронки", href: "/cabinet/crm/relocation", icon: <IconMapPin />, businessRoles: ["SPECIALIST", "SUPER_ADMIN"], requiredPermission: "crm.case.list" },
  { id: "employers", label: "Работодатели", href: "/cabinet/crm/employers", icon: <IconBuilding />, businessRoles: ["SPECIALIST", "SUPER_ADMIN"], requiredPermission: "crm.employer.read" },
  { id: "reports", label: "Отчёты", href: "/cabinet/crm/reports", icon: <IconChartBar />, businessRoles: ["SPECIALIST", "SUPER_ADMIN"], requiredPermission: "crm.report.build" },
  { id: "admin-users", label: "Пользователи", href: "/cabinet/crm/admin/users", icon: <IconBriefcase />, businessRoles: ["SUPER_ADMIN"], requiredPermission: "identity.users.read" },
];

export function AppShellSnippet() {
  const businessRole = "SPECIALIST" as const;
  const permissions = new Set(["crm.dashboard.read", "crm.case.list", "crm.employer.read", "crm.report.build"]);
  const authorizedNavigation = navigation.filter(
    (item) =>
      item.businessRoles?.includes(businessRole) &&
      (!item.requiredPermission || permissions.has(item.requiredPermission)),
  );
  return (
    <AppShell navigation={authorizedNavigation} activeRoute="/cabinet/crm/dashboard">
      <section aria-labelledby="example-title">
        <h1 id="example-title">Моя работа</h1>
      </section>
    </AppShell>
  );
}
