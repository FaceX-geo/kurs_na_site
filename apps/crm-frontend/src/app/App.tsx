import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/app/layout/AppShell";
import { CRM_PATHS } from "@/app/paths";
import {
  AccessDeniedScreen,
  NotFoundScreen,
  RoleHomeRedirect,
  StudentsBoundaryScreen,
} from "@/app/screens/RouteFallbacks";
import {
  CredentialSetupPage,
  LoginPage,
  MaxChallengePage,
  MaxEnrollPage,
  MaxRecoveryPage,
} from "@/features/auth";
import { CasesScreen } from "@/features/cases";
import { CommunicationsScreen } from "@/features/communications";
import { DashboardScreen } from "@/features/dashboard";
import { EmployersScreen } from "@/features/employers";
import { NotificationsScreen } from "@/features/notifications";
import { CandidateScreen, PeopleRegistryScreen } from "@/features/people";
import { ReportsScreen } from "@/features/reports";
import {
  AccessSettingsScreen,
  AdminStoriesScreen,
  AdminVacanciesScreen,
  SecuritySettingsScreen,
} from "@/features/settings";
import { TasksScreen } from "@/features/tasks";
import {
  AUTH_PATHS,
  AuthProvider,
  RequireAuth,
  RequireBusinessRole,
  RequirePermission,
} from "@/shared/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 20_000,
    },
    mutations: {
      retry: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <CrmRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export function CrmRoutes() {
  return (
    <Routes>
      <Route path={AUTH_PATHS.login} element={<LoginPage />} />
      <Route path={AUTH_PATHS.acceptInvite} element={<CredentialSetupPage flow="invite" />} />
      <Route
        path={AUTH_PATHS.completePasswordReset}
        element={<CredentialSetupPage flow="password-reset" />}
      />
      <Route path={AUTH_PATHS.mfa} element={<MaxChallengePage />} />
      <Route path={AUTH_PATHS.recovery} element={<MaxRecoveryPage />} />
      <Route path={AUTH_PATHS.enroll} element={<MaxEnrollPage />} />
      <Route path="/" element={<Navigate replace to={AUTH_PATHS.home} />} />
      <Route path="/cabinet" element={<Navigate replace to={AUTH_PATHS.home} />} />

      <Route element={<RequireAuth />}>
        <Route path={CRM_PATHS.root} element={<AppShell />}>
          <Route index element={<RoleHomeRedirect />} />
          <Route path="denied" element={<AccessDeniedScreen />} />

          <Route element={<RequireBusinessRole allowed={["SPECIALIST", "SUPER_ADMIN"]} />}>
            <Route
              path="dashboard"
              element={
                <RequirePermission allOf={["crm.dashboard.read"]}>
                  <DashboardScreen />
                </RequirePermission>
              }
            />
            <Route
              path="people"
              element={
                <RequirePermission allOf={["crm.case.list"]}>
                  <PeopleRegistryScreen />
                </RequirePermission>
              }
            />
            <Route
              path="cases/:caseId"
              element={
                <RequirePermission allOf={["crm.case.read"]}>
                  <CandidateScreen />
                </RequirePermission>
              }
            />
            <Route
              path="relocation"
              element={
                <RequirePermission allOf={["crm.case.list"]}>
                  <CasesScreen />
                </RequirePermission>
              }
            />
            <Route
              path="students"
              element={
                <RequirePermission allOf={["crm.case.list"]}>
                  <StudentsBoundaryScreen />
                </RequirePermission>
              }
            />
            <Route
              path="employers"
              element={
                <RequirePermission allOf={["crm.employer.read"]}>
                  <EmployersScreen />
                </RequirePermission>
              }
            />
            <Route
              path="tasks"
              element={
                <RequirePermission allOf={["crm.task.read"]}>
                  <TasksScreen />
                </RequirePermission>
              }
            />
            <Route
              path="communications"
              element={
                <RequirePermission allOf={["crm.communication.read"]}>
                  <CommunicationsScreen />
                </RequirePermission>
              }
            />
            <Route
              path="notifications"
              element={
                <RequirePermission allOf={["crm.notification.read"]}>
                  <NotificationsScreen />
                </RequirePermission>
              }
            />
            <Route
              path="reports"
              element={
                <RequirePermission allOf={["crm.report.build"]}>
                  <ReportsScreen />
                </RequirePermission>
              }
            />
          </Route>

          <Route element={<RequireBusinessRole allowed={["SUPER_ADMIN"]} />}>
            <Route path="admin" element={<Navigate replace to={CRM_PATHS.dashboard} />} />
            <Route
              path="admin/users"
              element={
                <RequirePermission allOf={["identity.users.read", "identity.employees.read"]}>
                  <AccessSettingsScreen />
                </RequirePermission>
              }
            />
            <Route
              path="settings/access"
              element={
                <RequirePermission allOf={["identity.users.read", "identity.employees.read"]}>
                  <AccessSettingsScreen />
                </RequirePermission>
              }
            />
            <Route
              path="admin/vacancies"
              element={
                <RequirePermission allOf={["content.vacancy.read"]}>
                  <AdminVacanciesScreen />
                </RequirePermission>
              }
            />
            <Route
              path="admin/stories"
              element={
                <RequirePermission allOf={["content.story.read"]}>
                  <AdminStoriesScreen />
                </RequirePermission>
              }
            />
          </Route>

          <Route path="settings" element={<RoleHomeRedirect />} />
          <Route path="settings/security" element={<SecuritySettingsScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Route>
      </Route>
    </Routes>
  );
}
