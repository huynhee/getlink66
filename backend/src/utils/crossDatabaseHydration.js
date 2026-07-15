import User from "../models/User.js";

const DEFAULT_USER_FIELDS = "name email avatar credit role proUntil";

function referenceId(value) {
  return String(value?._id || value || "");
}

export async function atlasUsersById(values = [], fields = DEFAULT_USER_FIELDS) {
  const ids = [...new Set(values.map(referenceId).filter((id) => /^[a-f0-9]{24}$/i.test(id)))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select(fields).lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

export async function hydrateAtlasUserField(rows = [], field = "userId", fields = DEFAULT_USER_FIELDS) {
  const list = Array.isArray(rows) ? rows : [rows];
  const references = list.flatMap((row) => {
    const value = row?.[field];
    return Array.isArray(value) ? value : [value];
  });
  const users = await atlasUsersById(references, fields);
  list.forEach((row) => {
    if (!row) return;
    if (Array.isArray(row[field])) {
      row[field] = row[field].map((value) => users.get(referenceId(value)) || value);
      return;
    }
    row[field] = users.get(referenceId(row[field])) || row[field] || null;
  });
  return rows;
}

export async function hydrateAtlasUserFields(rows = [], fields = []) {
  for (const field of fields) await hydrateAtlasUserField(rows, field);
  return rows;
}
