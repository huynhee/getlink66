import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client();

export async function verifyGoogleOneTapCredential(
  credential,
  { clientId = process.env.GOOGLE_CLIENT_ID, verifyIdToken = (options) => googleClient.verifyIdToken(options) } = {},
) {
  const token = String(credential || "");
  if (!clientId || token.length < 100 || token.length > 10_000) {
    throw new Error("Invalid Google credential");
  }

  const ticket = await verifyIdToken({ idToken: token, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email || payload.email_verified !== true) {
    throw new Error("Google account email is not verified");
  }

  return {
    subject: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    avatar: payload.picture || "",
    hostedDomain: payload.hd || "",
  };
}
