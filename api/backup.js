const stateHandler = require("./state");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const capture = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };

  await stateHandler({ method: "GET" }, capture);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="plant-attendance-db-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.status(capture.statusCode).send(JSON.stringify(capture.body, null, 2));
};
