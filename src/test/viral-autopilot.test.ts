import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
import { autoRateNewDriveVideos, saveRatings } from "@/lib/viral.server";

describe("Automatic video screening prerequisites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ error: null });
    const query = { upsert: mocks.upsert, select: vi.fn(), eq: vi.fn(), maybeSingle: mocks.maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    mocks.from.mockReturnValue(query);
  });

  it("restores missing settings without overwriting existing choices and excludes 07:00", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "default", autopilot_enabled: false }, error: null });
    expect(await autoRateNewDriveVideos()).toEqual({ skipped: "manual" });
    expect(mocks.upsert).toHaveBeenCalledWith(
      { id: "default", autopilot_enabled: true, slot_times: "12:00,19:00", timezone: "Asia/Jakarta" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  });

  it("reports settings initialization failures rather than silently skipping", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "denied" } });
    await expect(autoRateNewDriveVideos()).rejects.toThrow("denied");
  });

  it("does not report success when screening results fail to persist", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "write failed" } });
    await expect(saveRatings("channel", [{ fileId: "video", name: "Video", webViewLink: "", verdict: "berpotensi", reason: "clear" }])).rejects.toThrow("write failed");
  });
});