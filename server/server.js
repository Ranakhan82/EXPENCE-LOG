"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 5000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "EXPENSE_CLAIM";
const SESSION_SECRET = process.env.SESSION_SECRET;
const WEB_ROOT = path.resolve(__dirname, "..");
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

let mongoClient;
let users;
let claims;
let dropdowns;
let recoveryCodes;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again in 15 minutes." }
});

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function userIdFrom(req) {
  const id = req.session?.userId;
  return id && ObjectId.isValid(id) ? id : null;
}

function publicUser(user) {
  return { id: user._id.toString(), email: user.email, profile: user.profile || {}, createdAt: user.createdAt };
}

function cleanProfile(input = {}) {
  return {
    fullName: String(input.fullName || "").trim().slice(0, 120),
    jobTitle: String(input.jobTitle || "").trim().slice(0, 120),
    address: String(input.address || "").trim().slice(0, 300),
    city: String(input.city || "").trim().slice(0, 100),
    country: String(input.country || "").trim().slice(0, 100)
  };
}

function recoveryDigest(userId, code) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`${userId}:${code}`).digest("hex");
}

function sameDigest(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireLogin(req, res, next) {
  if (!userIdFrom(req)) return sendError(res, 401, "Please log in to continue.");
  next();
}

function claimPayload(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  return {
    name: String(input.name || "Expense claim").trim().slice(0, 180),
    number: String(input.number || "").trim().slice(0, 80),
    date: String(input.date || "").trim().slice(0, 40),
    costCenter: String(input.costCenter || "").trim().slice(0, 180),
    currency: String(input.currency || "SAR").trim().slice(0, 12),
    createdTime: String(input.createdTime || "").trim().slice(0, 40),
    items: items.slice(0, 500).map((item = {}) => ({
      invoiceNumber: String(item.invoiceNumber || "").trim().slice(0, 180),
      date: String(item.date || "").trim().slice(0, 40),
      description: String(item.description || "").trim().slice(0, 500),
      purpose: String(item.purpose || "").trim().slice(0, 500),
      amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0,
      category: String(item.category || "").trim().slice(0, 120)
    }))
  };
}

const DROPDOWN_KEYS = ["costCenters", "currencies", "invoiceNames", "itemDescriptions", "purposes", "categories"];

function normalizeDropdownPayload(input = {}) {
  const result = {};
  for (const key of DROPDOWN_KEYS) {
    const values = Array.isArray(input[key]) ? input[key] : [];
    result[key] = [...new Set(values.map(value => String(value || "").trim().slice(0, 180)).filter(Boolean))].slice(0, 500);
  }
  return result;
}

async function startServer() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is missing from server/.env");
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in server/.env");

  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const database = mongoClient.db(DB_NAME);
  users = database.collection("users");
  claims = database.collection("claims");
  dropdowns = database.collection("dropdowns");
  recoveryCodes = database.collection("password_recovery_codes");
  await users.createIndex({ email: 1 }, { unique: true });
  await claims.createIndex({ userId: 1, updatedAt: -1 });
  await dropdowns.createIndex({ userId: 1 }, { unique: true });
  await recoveryCodes.createIndex({ userId: 1 }, { unique: true });

  app.use(session({
    name: "expense_claim_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({ client: mongoClient, dbName: DB_NAME, collectionName: "sessions", ttl: 7 * 24 * 60 * 60 }),
    cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_MAX_AGE }
  }));

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || "");
      if (!isValidEmail(email)) return sendError(res, 400, "Enter a valid email address.");
      if (password.length < 6 || password.length > 200) return sendError(res, 400, "Password must be between 6 and 200 characters.");
      const user = { email, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date() };
      const inserted = await users.insertOne(user);
      user._id = inserted.insertedId;
      req.session.regenerate(error => {
        if (error) return next(error);
        req.session.userId = user._id.toString();
        req.session.userEmail = user.email;
        req.session.save(saveError => {
          if (saveError) return next(saveError);
          res.status(201).json({ success: true, message: "Account created. You are now logged in.", user: publicUser(user) });
        });
      });
    } catch (error) {
      if (error.code === 11000) return sendError(res, 409, "This email is already registered. Please log in.");
      next(error);
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || "");
      if (!email || !password) return sendError(res, 400, "Enter your email and password.");
      const user = await users.findOne({ email });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return sendError(res, 401, "Invalid email or password.");
      req.session.regenerate(error => {
        if (error) return next(error);
        req.session.userId = user._id.toString();
        req.session.userEmail = user.email;
        req.session.save(saveError => {
          if (saveError) return next(saveError);
          res.json({ success: true, message: "Login successful.", user: publicUser(user) });
        });
      });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/reset-password", authLimiter, async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const recoveryCode = String(req.body.recoveryCode || "").replace(/[^a-f0-9]/gi, "").toUpperCase();
      const password = String(req.body.password || "");
      if (!isValidEmail(email) || !/^[A-F0-9]{48}$/.test(recoveryCode)) return sendError(res, 400, "Enter your account email and valid recovery code.");
      if (password.length < 6 || password.length > 200) return sendError(res, 400, "Password must be between 6 and 200 characters.");
      const user = await users.findOne({ email });
      if (!user) return sendError(res, 400, "Email or recovery code is incorrect.");
      const key = user._id.toString();
      const digest = recoveryDigest(key, recoveryCode);
      const consumed = await recoveryCodes.deleteOne({ userId: key, digest });
      if (!consumed.deletedCount) return sendError(res, 400, "Email or recovery code is incorrect.");
      await users.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(password, 12), passwordUpdatedAt: new Date() } });
      await mongoClient.db(DB_NAME).collection("sessions").deleteMany({ "session.userId": key });
      res.json({ success: true, message: "Password reset. Please log in with your new password. Create a new recovery code after logging in." });
    } catch (error) { next(error); }
  });

  app.post("/api/account/recovery-code", requireLogin, async (req, res, next) => {
    try {
      const currentPassword = String(req.body.currentPassword || "");
      const user = await users.findOne({ _id: new ObjectId(userIdFrom(req)) });
      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return sendError(res, 401, "Current password is incorrect.");
      const raw = crypto.randomBytes(24).toString("hex").toUpperCase();
      const code = raw.match(/.{1,8}/g).join("-");
      const key = user._id.toString();
      await recoveryCodes.updateOne({ userId: key }, { $set: { userId: key, digest: recoveryDigest(key, raw), updatedAt: new Date() } }, { upsert: true });
      res.json({ success: true, message: "Save this recovery code somewhere private. It will only be shown once.", recoveryCode: code });
    } catch (error) { next(error); }
  });

  app.put("/api/account/email", requireLogin, async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.currentPassword || "");
      const id = new ObjectId(userIdFrom(req));
      const user = await users.findOne({ _id: id });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return sendError(res, 401, "Current password is incorrect.");
      if (!isValidEmail(email)) return sendError(res, 400, "Enter a valid new email address.");
      try { await users.updateOne({ _id: id }, { $set: { email } }); }
      catch (error) { if (error.code === 11000) return sendError(res, 409, "That email is already in use."); throw error; }
      req.session.userEmail = email;
      res.json({ success: true, message: "Email updated successfully.", user: publicUser({ ...user, email }) });
    } catch (error) { next(error); }
  });

  app.put("/api/account/password", requireLogin, async (req, res, next) => {
    try {
      const currentPassword = String(req.body.currentPassword || "");
      const password = String(req.body.newPassword || "");
      const user = await users.findOne({ _id: new ObjectId(userIdFrom(req)) });
      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return sendError(res, 401, "Current password is incorrect.");
      if (password.length < 6 || password.length > 200) return sendError(res, 400, "New password must be between 6 and 200 characters.");
      await users.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(password, 12), passwordUpdatedAt: new Date() } });
      res.json({ success: true, message: "Password updated successfully." });
    } catch (error) { next(error); }
  });

  app.put("/api/profile", requireLogin, async (req, res, next) => {
    try {
      const profile = cleanProfile(req.body);
      await users.updateOne({ _id: new ObjectId(userIdFrom(req)) }, { $set: { profile } });
      const user = await users.findOne({ _id: new ObjectId(userIdFrom(req)) }, { projection: { passwordHash: 0 } });
      res.json({ success: true, message: "Profile saved.", user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.get("/api/auth/me", async (req, res, next) => {
    try {
      const id = userIdFrom(req);
      if (!id) return sendError(res, 401, "Not logged in.");
      const user = await users.findOne({ _id: new ObjectId(id) }, { projection: { passwordHash: 0 } });
      if (!user) {
        return req.session.destroy(() => sendError(res, 401, "Please log in again."));
      }
      res.json({ success: true, user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/logout", (req, res, next) => {
    if (!req.session) return res.json({ success: true });
    req.session.destroy(error => {
      if (error) return next(error);
      res.clearCookie("expense_claim_session", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      res.json({ success: true, message: "Logged out successfully." });
    });
  });

  app.get("/api/claims", requireLogin, async (req, res, next) => {
    try {
      const records = await claims.find({ userId: userIdFrom(req) }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
      res.json({ success: true, claims: records });
    } catch (error) { next(error); }
  });

  app.post("/api/claims", requireLogin, async (req, res, next) => {
    try {
      const now = new Date();
      const claim = { ...claimPayload(req.body), userId: userIdFrom(req), createdAt: now, updatedAt: now };
      const result = await claims.insertOne(claim);
      res.status(201).json({ success: true, message: "Claim saved successfully.", claim: { ...claim, _id: result.insertedId } });
    } catch (error) { next(error); }
  });

  app.put("/api/claims/:id", requireLogin, async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return sendError(res, 400, "Invalid claim ID.");
      const filter = { _id: new ObjectId(req.params.id), userId: userIdFrom(req) };
      const result = await claims.updateOne(filter, { $set: { ...claimPayload(req.body), updatedAt: new Date() } });
      if (!result.matchedCount) return sendError(res, 404, "Claim not found.");
      const claim = await claims.findOne(filter);
      res.json({ success: true, message: "Claim updated successfully.", claim });
    } catch (error) { next(error); }
  });

  app.delete("/api/claims/:id", requireLogin, async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return sendError(res, 400, "Invalid claim ID.");
      const result = await claims.deleteOne({ _id: new ObjectId(req.params.id), userId: userIdFrom(req) });
      if (!result.deletedCount) return sendError(res, 404, "Claim not found.");
      res.json({ success: true, message: "Claim deleted successfully." });
    } catch (error) { next(error); }
  });

  app.get("/api/dropdowns", requireLogin, async (req, res, next) => {
    try {
      const record = await dropdowns.findOne({ userId: userIdFrom(req) });
      res.json({ success: true, dropdowns: record?.data || null });
    } catch (error) { next(error); }
  });

  app.put("/api/dropdowns", requireLogin, async (req, res, next) => {
    try {
      const now = new Date();
      await dropdowns.updateOne(
        { userId: userIdFrom(req) },
        { $set: { userId: userIdFrom(req), data: normalizeDropdownPayload(req.body), updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      res.json({ success: true, message: "Dropdown options saved successfully." });
    } catch (error) { next(error); }
  });

  app.get("/api/health", async (req, res) => {
    try { await mongoClient.db("admin").command({ ping: 1 }); res.json({ success: true, database: "connected", message: "Expense Claim server and MongoDB are working." }); }
    catch { res.status(503).json({ success: false, database: "disconnected", message: "MongoDB connection is unavailable." }); }
  });

  app.use("/api", (req, res) => sendError(res, 404, "API route not found."));
  app.get("/", (req, res) => res.sendFile(path.join(WEB_ROOT, "index.html")));
  app.get("/index.html", (req, res) => res.sendFile(path.join(WEB_ROOT, "index.html")));
  app.get("/style.css", (req, res) => res.sendFile(path.join(WEB_ROOT, "style.css")));
  app.get("/script.js", (req, res) => res.sendFile(path.join(WEB_ROOT, "script.js")));
  app.get("/excel-export-layout.js", (req, res) => res.sendFile(path.join(WEB_ROOT, "excel-export-layout.js")));
  app.use(express.static(path.join(WEB_ROOT, "assets"), { fallthrough: true, dotfiles: "deny" }));

  app.use((error, req, res, next) => {
    console.error("Request error:", error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ success: false, message: "An unexpected server error occurred." });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Expense Claim server running at http://localhost:${PORT}`);
    console.log(`MongoDB connected to database: ${DB_NAME}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await mongoClient.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

startServer().catch(async error => {
  console.error("Server startup failed:", error.message);
  if (mongoClient) await mongoClient.close().catch(() => {});
  process.exit(1);
});
