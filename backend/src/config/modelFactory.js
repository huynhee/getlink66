import mongoose from "mongoose";
import { marketplaceDbConnection } from "./db.js";

export function coreModel(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

export function marketplaceModel(name, schema) {
  const connection = marketplaceDbConnection();
  return connection.models[name] || connection.model(name, schema);
}
