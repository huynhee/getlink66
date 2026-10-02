import User from "../models/User.js";
import { awardReferralSignup, ensureReferralCode } from "./referralService.js";

function accountConflict() {
  const error = new Error("This email is linked to another Google account. Use the existing sign-in method.");
  error.status = 409;
  error.code = "GOOGLE_ACCOUNT_CONFLICT";
  return error;
}

export async function upsertGoogleAccount({
  subject,
  email,
  name,
  avatar = "",
  referralCode = "",
  allowUnhostedEmailLink = false,
  hostedDomain = "",
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const googleSubject = String(subject || "").trim();
  if (!normalizedEmail || !googleSubject) throw new Error("Google account is missing identity details");

  const role = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .some((value) => value.trim().toLowerCase() === normalizedEmail)
    ? "admin"
    : "user";
  const authoritativeEmail = normalizedEmail.endsWith("@gmail.com") || Boolean(hostedDomain);
  let user = await User.findOne({ googleSubject });
  if (user && user.email !== normalizedEmail) {
    const emailOwner = await User.findOne({ email: normalizedEmail });
    if (emailOwner && String(emailOwner._id) !== String(user._id)) throw accountConflict();
  }

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });
    if (user?.googleSubject && user.googleSubject !== googleSubject) throw accountConflict();
    if (user && !authoritativeEmail && !allowUnhostedEmailLink) throw accountConflict();
  }

  const updates = {
    googleSubject,
    email: normalizedEmail,
    role,
    name: String(name || normalizedEmail),
    avatar: String(avatar || ""),
  };
  if (user) {
    user = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
  } else {
    user = await User.create({ ...updates, credit: 0 });
    await ensureReferralCode(user);
    if (referralCode) await awardReferralSignup(user, referralCode);
    return User.findById(user._id);
  }

  await ensureReferralCode(user);
  return user;
}
