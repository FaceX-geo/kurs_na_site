import { crmApiClient, requireApiData } from "@/shared/api/client";
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  CompletePasswordResetRequest,
  CompletePasswordResetResponse,
} from "@/shared/api/contracts";

export const credentialApi = {
  async acceptInvite(body: AcceptInviteRequest): Promise<AcceptInviteResponse> {
    return requireApiData(await crmApiClient.POST("/internal/v1/auth/invite/accept", { body }));
  },

  async completePasswordReset(
    body: CompletePasswordResetRequest,
  ): Promise<CompletePasswordResetResponse> {
    return requireApiData(
      await crmApiClient.POST("/internal/v1/auth/password/reset/complete", { body }),
    );
  },
};
