const crypto = require("node:crypto");

const DEFAULT_REALM = "HubNews Admin";

type AnyRecord = Record<string, any>;

function escapeRealm(value: any) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function challenge(res: any, realm: string, message: string) {
  res.set("WWW-Authenticate", `Basic realm="${escapeRealm(realm)}"`);
  return res.status(401).json({ error: message });
}

function hasConfiguredCredentials(username: any, password: any) {
  return (
    typeof username === "string" &&
    username.length > 0 &&
    typeof password === "string" &&
    password.length > 0
  );
}

function parseBasicAuthHeader(header: any) {
  if (!header || typeof header !== "string") return null;

  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return null;

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1)
  };
}

function timingSafeStringEqual(actual: any, expected: any) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createBasicAuth(options: AnyRecord = {}) {
  const username = options.username;
  const password = options.password;
  const realm = options.realm || DEFAULT_REALM;

  return function basicAuth(req: any, res: any, next: any) {
    if (!hasConfiguredCredentials(username, password)) {
      return challenge(res, realm, "Admin credentials are not configured");
    }

    const credentials = parseBasicAuthHeader(req.get("authorization"));
    if (
      !credentials ||
      !timingSafeStringEqual(credentials.username, username) ||
      !timingSafeStringEqual(credentials.password, password)
    ) {
      return challenge(res, realm, "Authentication required");
    }

    return next();
  };
}

module.exports = {
  createBasicAuth,
  parseBasicAuthHeader
};
