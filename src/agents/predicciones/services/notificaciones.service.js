export async function notifyInferenceReady(payload) {
  const flowUrl = process.env.PA_FLOW_URL;
  if (!flowUrl) {
    console.warn("[PA] PA_FLOW_URL not set. Skipping Teams notify.");
    return { ok: false, skipped: true };
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.PA_FLOW_API_KEY) {
    headers["x-api-key"] = process.env.PA_FLOW_API_KEY;
  }

  try {
    const res = await fetch(flowUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[PA] notify failed:", res.status, txt);
      return { ok: false, status: res.status, body: txt };
    }

    return { ok: true };
  } catch (err) {
    console.warn("[PA] notify error:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}