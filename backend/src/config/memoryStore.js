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
    const actual = getByPath(document, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      if ("$gt" in expected && !(new Date(actual) > new Date(expected.$gt))) return false;
      return true;
    }
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
  Object.entries(update).forEach(([key, value]) => {
    if (!key.startsWith("$")) document[key] = value;
  });
}

function chain(result, isArray = true) {
  return {
    sort(sortSpec = {}) {
      const [[field, dir] = []] = Object.entries(sortSpec);
      const sorted = [...result].sort((a, b) => {
        const av = new Date(a[field] || 0).valueOf();
        const bv = new Date(b[field] || 0).valueOf();
        return dir < 0 ? bv - av : av - bv;
      });
      return chain(sorted, isArray);
    },
    limit(count) {
      return Promise.resolve(clone(result.slice(0, count)));
    },
    populate(field, props) {
      const collectionMap = {
        userId: "User",
        packageId: "TopupPackage"
      };
      const targetName = collectionMap[field];
      if (targetName) {
        const targetCol = getCollection(targetName);
        result.forEach((doc) => {
          if (doc[field] && typeof doc[field] === "string" || typeof doc[field] === "object") {
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
      return chain(result, isArray);
    },
    then(resolve, reject) {
      return Promise.resolve(clone(isArray ? result : (result[0] || null))).then(resolve, reject);
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
