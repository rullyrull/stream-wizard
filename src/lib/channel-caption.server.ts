/** Caption tetap per channel: diisi manual oleh pengguna, dipakai untuk semua video channel itu. */

export async function getChannelCaption(channelId: string | null): Promise<string> {
  if (!channelId) return "";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("channel_settings")
    .select("description")
    .eq("channel_id", channelId)
    .maybeSingle();
  return (data?.description ?? "").trim();
}
