import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/youtube/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const flow = requestUrl.searchParams.get("flow") === "drive" ? "drive" : "youtube";
        const {
          DRIVE_SCOPE,
          YOUTUBE_SCOPE,
          encodeOAuthState,
          getGoogleCredentials,
          publicOriginFromRequest,
          returnOriginFromRequest,
          redirectUriFor,
        } = await import("@/lib/youtube.server");

        const origin = publicOriginFromRequest(request);
        const returnOrigin = returnOriginFromRequest(request, origin);
        const { clientId, clientSecret } = await getGoogleCredentials();
        if (!clientId || !clientSecret) {
          return Response.redirect(
            `${returnOrigin}/?yt_error=${encodeURIComponent(
              "Kredensial Google OAuth belum valid. Perbarui Client ID dan Client secret terlebih dahulu.",
            )}`,
            302,
          );
        }

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUriFor(origin),
          response_type: "code",
          scope:
            flow === "drive"
              ? DRIVE_SCOPE
              : `${YOUTUBE_SCOPE} https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly`,
          access_type: "offline",
          prompt: "consent select_account",
          state: encodeOAuthState(flow, returnOrigin),
        });
        if (flow === "youtube") params.set("include_granted_scopes", "true");

        return Response.redirect(
          `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          302,
        );
      },
    },
  },
});