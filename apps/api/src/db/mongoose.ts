import { randomUUID } from "node:crypto";
import mongoose, { Schema, type Model } from "mongoose";
import type { Coll, Filter, FindOpts, Store } from "./types.js";

/**
 * Production adapter. Faithful to the plan's MongoDB model (§4).
 * Uses flexible schemas (strict:false) so the document shape stays the single
 * source of truth in @kosh/shared; indexes are declared here (§4).
 * NOTE: not exercised in the credential-less sandbox — selected only when
 * MONGODB_URI is set. The in-memory adapter is the default.
 */

function flexSchema(indexes: (s: Schema) => void): Schema {
  const s = new Schema({ _id: { type: String, default: () => randomUUID() } }, { strict: false, versionKey: false, minimize: false });
  s.set("toJSON", {
    virtuals: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = ret._id;
      delete ret._id;
      return ret;
    },
  });
  indexes(s);
  return s;
}

function toPlain<T>(doc: unknown): T {
  const o = (doc as { toObject?: () => Record<string, unknown> }).toObject
    ? (doc as { toObject: () => Record<string, unknown> }).toObject()
    : ({ ...(doc as Record<string, unknown>) });
  o.id = o._id;
  delete o._id;
  delete o.__v;
  return o as T;
}

function translate(filter: Filter): Filter {
  if (!("id" in filter)) return filter;
  const { id, ...rest } = filter;
  return { ...rest, _id: id };
}

/**
 * Split a patch into $set (defined fields) and $unset (fields explicitly set to undefined).
 * Mongoose strips `undefined` from `$set`, so clearing a field (e.g. restore → deletedAt:undefined)
 * would otherwise never persist — the field would keep its old value. $unset removes it.
 */
function toUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) $unset[k] = "";
    else $set[k] = v;
  }
  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

function mongoColl<T extends { id: string }>(model: Model<Record<string, unknown>>): Coll<T> {
  return {
    async create(doc) {
      const created = await model.create({ _id: doc.id ?? randomUUID(), ...doc });
      return toPlain<T>(created);
    },
    async findById(id) {
      const d = await model.findById(id).lean();
      return d ? toPlain<T>(d) : null;
    },
    async findOne(filter) {
      const d = await model.findOne(translate(filter)).lean();
      return d ? toPlain<T>(d) : null;
    },
    async find(filter = {}, opts = {}) {
      let q = model.find(translate(filter));
      if (opts.sort) q = q.sort(opts.sort as Record<string, 1 | -1>);
      if (opts.skip) q = q.skip(opts.skip);
      if (opts.limit != null) q = q.limit(opts.limit);
      const docs = await q.lean();
      return docs.map((d) => toPlain<T>(d));
    },
    async updateById(id, patch) {
      const d = await model.findByIdAndUpdate(id, toUpdate(patch as Record<string, unknown>), { new: true }).lean();
      return d ? toPlain<T>(d) : null;
    },
    async updateOne(filter, patch) {
      const d = await model.findOneAndUpdate(translate(filter), toUpdate(patch as Record<string, unknown>), { new: true }).lean();
      return d ? toPlain<T>(d) : null;
    },
    async deleteById(id) {
      const r = await model.findByIdAndDelete(id).lean();
      return !!r;
    },
    async count(filter = {}) {
      return model.countDocuments(translate(filter) as FindOpts);
    },
  };
}

export async function createMongoStore(uri: string): Promise<Store> {
  await mongoose.connect(uri);

  const models = {
    users: mongoose.model("User", flexSchema((s) => s.index({ githubId: 1 }, { unique: true, sparse: true }))),
    items: mongoose.model(
      "Item",
      flexSchema((s) => {
        // Partial (not sparse): a COMPOUND sparse index still indexes docs that have userId but no
        // urlHash (prompts, skills, files), so the 2nd such doc per user collides on (userId, null)
        // → E11000. A partial index only enforces uniqueness on docs that actually have a urlHash.
        s.index({ userId: 1, urlHash: 1 }, { unique: true, partialFilterExpression: { urlHash: { $type: "string" } } });
        s.index({ userId: 1, kind: 1, deletedAt: 1, createdAt: -1 });
        s.index({ userId: 1, stage: 1 });
      }),
    ),
    skills: mongoose.model("Skill", flexSchema((s) => s.index({ userId: 1, name: 1 }))),
    collections: mongoose.model("Collection", flexSchema((s) => s.index({ userId: 1, slug: 1 }))),
    apiKeys: mongoose.model("ApiKey", flexSchema((s) => s.index({ keyHash: 1 }, { unique: true }))),
    storageObjects: mongoose.model("StorageObject", flexSchema((s) => s.index({ userId: 1, sha256: 1 }, { unique: true }))),
    uploadSessions: mongoose.model("UploadSession", flexSchema((s) => s.index({ expiresAt: 1 }))),
  };

  return {
    users: mongoColl(models.users),
    items: mongoColl(models.items),
    skills: mongoColl(models.skills),
    collections: mongoColl(models.collections),
    apiKeys: mongoColl(models.apiKeys),
    storageObjects: mongoColl(models.storageObjects),
    uploadSessions: mongoColl(models.uploadSessions),
    async ping() {
      await mongoose.connection.db?.admin().ping();
      return true;
    },
    async close() {
      await mongoose.disconnect();
    },
  };
}
