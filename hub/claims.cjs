function decodeClaims(jwt) {
  const payload = String(jwt ?? "").split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function authClaims(accessToken) {
  return decodeClaims(accessToken)["https://api.openai.com/auth"] ?? {};
}

module.exports = { decodeClaims, authClaims };
