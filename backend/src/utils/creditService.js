import User from "../models/User.js";

export async function deductCredit(userId, amount = 1) {
  const user = await User.findOneAndUpdate(
    { _id: userId, credit: { $gte: amount } },
    { $inc: { credit: -amount } },
    { new: true }
  );

  if (!user) {
    throw Object.assign(new Error("Not enough credit"), { status: 402 });
  }

  return user;
}

export async function addCredit(userId, amount) {
  const user = await User.findByIdAndUpdate(userId, { $inc: { credit: amount } }, { new: true });
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }
  return user;
}
