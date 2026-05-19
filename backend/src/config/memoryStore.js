const collections = new Map();

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function id() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function getCollection(name) {
  if (!collections.has(name)) collections.set(name, []);
  return collections.get(name);
}

function getByPath(document, path) {
  return path.split(".").reduce((value, key) => value?.[key], document);
}

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "$expr") return true;
    if (key === "$or") return expected.some((item) => matches(document, item));
    if (key === "$and") return expected.every((item) => matches(document, item));
    const actual = getByPath(document, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      if ("$gt" in expected && !(new Date(actual) > new Date(expected.$gt))) return false;
      if ("$lte" in expected && !(actual <= expected.$lte)) return false;
      if ("$lt" in expected && !(new Date(actual) < new Date(expected.$lt))) return false;
      if ("$ne" in expected && String(actual) === String(expected.$ne)) return false;
      if ("$in" in expected && !expected.$in.map(String).includes(String(actual))) return false;
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
  if (update.$setOnInsert && !document._id) Object.assign(document, update.$setOnInsert);
  if (update.$set) Object.assign(document, update.$set);
  if (update.$inc) {
    Object.entries(update.$inc).forEach(([key, value]) => {
      document[key] = (document[key] || 0) + value;
    });
  }
  if (update.$addToSet) {
    Object.entries(update.$addToSet).forEach(([key, value]) => {
      if (!Array.isArray(document[key])) document[key] = [];
      if (!document[key].map(String).includes(String(value))) {
        document[key].push(value);
      }
    });
  }
  Object.entries(update).forEach(([key, value]) => {
    if (!key.startsWith("$")) document[key] = value;
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

function chain(result, isArray = true, projection = "") {
  return {
    sort(sortSpec = {}) {
      const [[field, dir] = []] = Object.entries(sortSpec);
      const sorted = [...result].sort((a, b) => {
        const av = new Date(a[field] || 0).valueOf();
        const bv = new Date(b[field] || 0).valueOf();
        return dir < 0 ? bv - av : av - bv;
      });
      return chain(sorted, isArray, projection);
    },
    limit(count) {
      return chain(result.slice(0, count), isArray, projection);
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
      return chain(collection.filter((document) => matches(document, query)), true);
    },
    findOne(query = {}) {
      return chain(collection.filter((document) => matches(document, query)), false);
    },
    async findById(idValue) {
      return clone(collection.find((document) => String(document._id) === String(idValue)) || null);
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
    async findByIdAndUpdate(idValue, update) {
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
    async findOneAndDelete(query = {}) {
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
    async deleteMany() {
      collection.splice(0, collection.length);
    }
  };
}

export function useMemoryDb() {
  globalThis.__USE_MEMORY_DB__ = true;
}

export function isMemoryDb() {
  return Boolean(globalThis.__USE_MEMORY_DB__);
}
