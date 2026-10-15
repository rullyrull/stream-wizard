import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/youtube/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");
        const { publicOriginFromRequest, decodeOAuthState, safeOAuthReturnOrigin } =
          await import("@/lib/youtube.server");
        const parsedState = decodeOAuthState(state);
        // Token exchange wajib memakai host callback yang didaftarkan ke Google,
        // sedangkan browser kembali ke host preview asal agar tidak terkena Forbidden.
        const callbackOrigin = publicOriginFromRequest(request);
        const returnOrigin = safeOAuthReturnOrigin(parsedState.origin, callbackOrigin);
        const home = `${returnOrigin}/`;

        if (error || !code) {
          return Response.redirect(
            `${home}?yt_error=${encodeURIComponent(error ?? "missing_code")}`,
            302,
          );
        }

        try {
          const { exchangeCode, redirectUriFor, saveAccount, fetchChannelInfo, DRIVE_ACCOUNT_ID } =
            await import("@/lib/youtube.server");
          const tokens = await exchangeCode(code, redirectUriFor(callbackOrigin));

          if (!tokens.refresh_token) {
            return Response.redirect(
              `${home}?yt_error=${encodeURIComponent(
                "Google tidak mengirim refresh token. Cabut akses aplikasi di akun Google lalu coba lagi.",
              )}`,
              302,
            );
          }
          if (parsedState.flow === "drive") {

            await saveAccount({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              channel_id: DRIVE_ACCOUNT_ID,
              channel_title: "Google Drive",
            });
            return Response.redirect(`${home}?drive_connected=1`, 302);
          }
          // Pemilih Brand Account Google sudah menentukan satu channel untuk token ini.
          // Cukup satu panggilan API; mengambil semua channel sekaligus memboroskan kuota
          // dan tidak konsisten untuk akun merek.
          const channel = await fetchChannelInfo(tokens.access_token);
          if (!channel.id) {
            return Response.redirect(
              `${home}?yt_error=${encodeURIComponent(
                "Tidak menemukan channel YouTube pada akun Google yang dipilih.",
              )}`,
              302,
            );
          }
          await saveAccount({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            channel_id: channel.id,
            channel_title: channel.title,
          });
          // Channel baru langsung masuk ke "Jadwal upload semua channel".
          await import("@/lib/autopilot.server")
            .then(({ syncChannelToSchedule }) => syncChannelToSchedule(channel.id!, channel.title))
            .catch((e) => console.error("[sync schedule]", e));
          return Response.redirect(`${home}?yt_connected=1`, 302);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return Response.redirect(`${home}?yt_error=${encodeURIComponent(message)}`, 302);
        }
      },
    },
  },
});
