export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch("https://devnet.rialo.io:4101", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();

    res.status(response.status);
    res.setHeader("content-type", "application/json");
    res.send(text);
  } catch (error) {
    console.error("Rialo DevNet proxy error:", error);

    res.status(502).json({
      error: "Rialo DevNet unavailable"
    });
  }
}
