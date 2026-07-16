import { randomBytes } from "node:crypto";

const collections = new Map();

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function id() {
  return randomBytes(12).toString("hex");
}

function getCollection(name) {
  if (!collections.has(name)) collections.set(name, []);
  return collections.get(name);
}

function getByPath(document, path) {
  return path.split(".").reduce((value, key) => value?.[key], document);
}

function setByPath(document, path, value) {
  const parts = String(path).split(".");
  const last = parts.pop();
  let target = document;
  for (const part of parts) {
    if (!target[part] || typeof target[part] !== "object") target[part] = {};
    target = target[part];
  }
  target[last] = value;
}

function deleteByPath(document, path) {
  const parts = String(path).split(".");
  const last = parts.pop();
  const target = parts.reduce((value, key) => value?.[key], document);
  if (target && typeof target === "object") delete target[last];
}

function comparable(value, other) {
  if (value instanceof Date || other instanceof Date) {
    return new Date(value).valueOf();
  }
  return value;
}

function expressionValue(document, value) {
  return typeof value === "string" && value.startsWith("$")
    ? getByPath(document, value.slice(1))
    : value;
}

function matchesExpression(document, expression = {}) {
  const [[operator, operands] = []] = Object.entries(expression);
  if (!operator || !Array.isArray(operands) || operands.length !== 2) return false;
  const left = expressionValue(document, operands[0]);
  const right = expressionValue(document, operands[1]);
  if (operator === "$lt") return comparable(left, right) < comparable(right, left);
  if (operator === "$lte") return comparable(left, right) <= comparable(right, left);
  if (operator === "$gt") return comparable(left, right) > comparable(right, left);
  if (operator === "$gte") return comparable(left, right) >= comparable(right, left);
  if (operator === "$eq") return String(left) === String(right);
  return false;
}

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "$expr") return matchesExpression(document, expected);
    if (key === "$or") return expected.some((item) => matches(document, item));
    if (key === "$and") return expected.every((item) => matches(document, item));
    const actual = getByPath(document, key);
    if (expected instanceof RegExp) return expected.test(String(actual || ""));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (expected instanceof Date) {
        return new Date(actual).valueOf() === expected.valueOf();
      }
      if (typeof expected.toHexString === "function") {
        return String(actual) === String(expected);
      }
      if ("$gte" in expected && !(comparable(actual, expected.$gte) >= comparable(expected.$gte, actual))) return false;
      if ("$gt" in expected && !(comparable(actual, expected.$gt) > comparable(expected.$gt, actual))) return false;
      if ("$lte" in expected && !(comparable(actual, expected.$lte) <= comparable(expected.$lte, actual))) return false;
      if ("$lt" in expected && !(comparable(actual, expected.$lt) < comparable(expected.$lt, actual))) return false;
      if ("$ne" in expected && String(actual) === String(expected.$ne)) return false;
      if ("$in" in expected) {
        const expectedValues = expected.$in.map(String);
        const values = Array.isArray(actual) ? actual.map(String) : [String(actual)];
        if (!values.some((value) => expectedValues.includes(value))) return false;
      }
      if ("$nin" in expected) {
        const blockedValues = expected.$nin.map(String);
        const values = Array.isArray(actual) ? actual.map(String) : [String(actual)];
        if (values.some((value) => blockedValues.includes(value))) return false;
      }
      if ("$exists" in expected && (actual !== undefined) !== Boolean(expected.$exists)) return false;
      return true;
    }
    if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
    return String(actual) === String(expected);
  });
}

function applyUpdate(document, update = {}, query = {}) {
  Object.entries(query).forEach(([key, value]) => {
    if (!key.startsWith("$") && typeof value !== "object" && document[key] === undefined) {
      document[key] = value;
    }
  });
  if (update.$setOnInsert && !document._id) {
    Object.entries(update.$setOnInsert).forEach(([key, value]) => setByPath(document, key, value));
  }
  if (update.$set) {
    Object.entries(update.$set).forEach(([key, value]) => setByPath(document, key, value));
  }
  if (update.$inc) {
    Object.entries(update.$inc).forEach(([key, value]) => {
      setByPath(document, key, Number(getByPath(document, key) || 0) + value);
    });
  }
  if (update.$addToSet) {
    Object.entries(update.$addToSet).forEach(([key, value]) => {
      const current = getByPath(document, key);
      const values = Array.isArray(current) ? current : [];
      if (!values.map(String).includes(String(value))) {
        values.push(value);
      }
      setByPath(document, key, values);
    });
  }
  if (update.$unset) {
    Object.keys(update.$unset).forEach((key) => deleteByPath(document, key));
  }
  if (update.$push) {
    Object.entries(update.$push).forEach(([key, value]) => {
      const current = getByPath(document, key);
      const values = Array.isArray(current) ? current : [];
      values.push(value);
      setByPath(document, key, values);
    });
  }
  Object.entries(update).forEach(([key, value]) => {
    if (!key.startsWith("$")) setByPath(document, key, value);
  });
}

function applySelect(doc, fields = "") {
  if (!fields || !doc) return doc;
  const names = String(fields)
    .split(/\s+/)
    .map((field) => field.trim())
    .filter(Boolean);
  if (!names.length) return doc;
  const include = !names.some((field) => field.startsWith("-"));
  if (!include) {
    const copy = { ...doc };
    names.forEach((field) => {
      if (field.startsWith("-")) delete copy[field.slice(1)];
    });
    return copy;
  }
  const picked = {};
  names.forEach((field) => {
    if (!field.startsWith("-") && doc[field] !== undefined) picked[field] = doc[field];
  });
  if (doc._id !== undefined && picked._id === undefined) picked._id = doc._id;
  return picked;
}

function compareSortValues(field, left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === "") return -1;
  if (right === undefined || right === null || right === "") return 1;
  if (left instanceof Date || right instanceof Date || /At$/.test(field)) {
    const leftTime = new Date(left).valueOf();
    const rightTime = new Date(right).valueOf();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function chain(result, isArray = true, projection = "") {
  return {
    sort(sortSpec = {}) {
      const fields = Object.entries(sortSpec);
      const sorted = [...result].sort((a, b) => {
        for (const [field, direction] of fields) {
          const comparison = compareSortValues(field, getByPath(a, field), getByPath(b, field));
          if (comparison) return direction < 0 ? -comparison : comparison;
        }
        return 0;
      });
      return chain(sorted, isArray, projection);
    },
    limit(count) {
      return chain(result.slice(0, count), isArray, projection);
    },
    skip(count) {
      return chain(result.slice(Math.max(0, Number(count) || 0)), isArray, projection);
    },
    select(fields = "") {
      return chain(result, isArray, fields);
    },
    lean() {
      return chain(result, isArray, projection);
    },
    populate(field, props) {
      const collectionMap = {
        userId: "User",
        referrerId: "User",
        referredUserId: "User",
        packageId: "TopupPackage",
        planId: "MembershipPlan",
        modelId: "MarketplaceModel",
        categoryId: "MarketplaceCategory",
        parentId: "MarketplaceCategory",
        parentCategoryId: "MarketplaceCategory",
        applicablePackageIds: "TopupPackage",
        createdBy: "User",
      };
      const targetName = collectionMap[field];
      if (targetName) {
        const targetCol = getCollection(targetName);
        result.forEach((doc) => {
          if (Array.isArray(doc[field])) {
            doc[field] = doc[field].map((value) => {
              const idToFind = value?._id || value;
              const rel = targetCol.find((r) => String(r._id) === String(idToFind));
              if (!rel) return value;
              if (!props) return rel;
              const picked = { _id: rel._id };
              props.split(" ").forEach((p) => { picked[p] = rel[p]; });
              return picked;
            });
          } else if (doc[field] && (typeof doc[field] === "string" || typeof doc[field] === "object")) {
            const idToFind = doc[field]?._id || doc[field];
            const rel = targetCol.find((r) => String(r._id) === String(idToFind));
            if (rel) {
              if (props) {
                const picked = { _id: rel._id };
                props.split(" ").forEach((p) => { picked[p] = rel[p]; });
                doc[field] = picked;
              } else {
                doc[field] = rel;
              }
            }
          }
        });
      }
      return chain(result, isArray, projection);
    },
    then(resolve, reject) {
      const selected = isArray
        ? result.map((doc) => applySelect(doc, projection))
        : applySelect(result[0] || null, projection);
      return Promise.resolve(clone(selected)).then(resolve, reject);
    }
  };
}

export function createMemoryModel(name) {
  const collection = getCollection(name);

  return {
    async create(data) {
      const now = new Date().toISOString();
      const document = { ...clone(data), _id: id(), createdAt: now, updatedAt: now };
      collection.push(document);
      return clone(document);
    },
    async insertMany(items) {
      return Promise.all(items.map((item) => this.create(item)));
    },
    find(query = {}) {
      return chain(clone(collection.filter((document) => matches(document, query))), true);
    },
    findOne(query = {}) {
      return chain(clone(collection.filter((document) => matches(document, query))), false);
    },
    findById(idValue) {
      return chain(
        clone(collection.filter((document) => String(document._id) === String(idValue))),
        false,
      );
    },
    async findOneAndUpdate(query, update, options = {}) {
      let document = collection.find((item) => matches(item, query));
      if (!document && options.upsert) {
        document = {};
        applyUpdate(document, update, query);
        const now = new Date().toISOString();
        document._id = id();
        document.createdAt = now;
        document.updatedAt = now;
        collection.push(document);
      } else if (document) {
        applyUpdate(document, update, query);
        document.updatedAt = new Date().toISOString();
      }
      return clone(document || null);
    },
    async findByIdAndUpdate(idValue, update, _options = {}) {
      const document = collection.find((item) => String(item._id) === String(idValue));
      if (!document) return null;
      applyUpdate(document, update);
      document.updatedAt = new Date().toISOString();
      return clone(document);
    },
    async findByIdAndDelete(idValue) {
      const index = collection.findIndex((item) => String(item._id) === String(idValue));
      if (index === -1) return null;
      const [document] = collection.splice(index, 1);
      return clone(document);
    },
    async findOneAndDelete(query = {}, _options = {}) {
      const index = collection.findIndex((item) => matches(item, query));
      if (index === -1) return null;
      const [document] = collection.splice(index, 1);
      return clone(document);
    },
    async countDocuments(query = {}) {
      return collection.filter((document) => matches(document, query)).length;
    },
    async exists(query = {}) {
      const document = collection.find((item) => matches(item, query));
      return document ? { _id: document._id } : null;
    },
    async deleteOne(query = {}) {
      const index = collection.findIndex((item) => matches(item, query));
      if (index === -1) return { acknowledged: true, deletedCount: 0 };
      collection.splice(index, 1);
      return { acknowledged: true, deletedCount: 1 };
    },
    async deleteMany(query = {}) {
      let deletedCount = 0;
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        if (!matches(collection[index], query)) continue;
        collection.splice(index, 1);
        deletedCount += 1;
      }
      return { acknowledged: true, deletedCount };
    }
  };
}

export function useMemoryDb() {
  globalThis.__USE_MEMORY_DB__ = true;
}

export function isMemoryDb() {
  return Boolean(globalThis.__USE_MEMORY_DB__);
}
