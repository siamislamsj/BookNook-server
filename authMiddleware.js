const { createRemoteJWKSet, jwtVerify } = require("jose");

let jwks;

async function verifyToken(req, res, next) {
  try {
    const authUrl = process.env.AUTH_BASE_URL;
    const header = req.headers.authorization;

    if (!authUrl || !header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Please login first" });
    }

    const token = header.slice(7);
    if (!jwks) jwks = createRemoteJWKSet(new URL(`${authUrl}/api/auth/jwks`));

    const { payload } = await jwtVerify(token, jwks, {
      issuer: authUrl,
      audience: authUrl
    });

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email
    };
    next();
  } catch (error) {
    console.error("JWT verification:", error.message);
    return res.status(401).json({ message: "Invalid or expired session. Please sign in again." });
  }
}

module.exports = verifyToken;
