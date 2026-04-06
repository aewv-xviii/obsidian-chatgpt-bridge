"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ChatGPTBridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/httpServer.ts
var import_obsidian = require("obsidian");
var BridgeHttpServer = class {
  constructor(app, getSettings, pluginVersion) {
    this.app = app;
    this.getSettings = getSettings;
    this.pluginVersion = pluginVersion;
    this.server = null;
  }
  isRunning() {
    return this.server !== null;
  }
  getAddressLabel() {
    const settings = this.getSettings();
    return `${settings.host}:${settings.port}`;
  }
  async start() {
    if (this.server) {
      await this.stop();
    }
    const { createServer } = require("node:http");
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise((resolve, reject) => {
      const activeServer = this.server;
      if (!activeServer) {
        reject(new Error("Server initialization failed."));
        return;
      }
      activeServer.once("error", reject);
      activeServer.listen(this.getSettings().port, this.getSettings().host, () => {
        activeServer.off("error", reject);
        resolve();
      });
    });
  }
  async stop() {
    const activeServer = this.server;
    this.server = null;
    if (!activeServer) {
      return;
    }
    await new Promise((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  async handleRequest(req, res) {
    this.setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!this.isAuthorized(req)) {
      this.respondJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    try {
      const requestUrl = new URL(req.url ?? "/", `http://${this.getAddressLabel()}`);
      const body = req.method === "POST" ? await this.parseJsonBody(req) : {};
      if (req.method === "GET" && requestUrl.pathname === "/health") {
        this.respondJson(res, 200, {
          ok: true,
          result: {
            pluginVersion: this.pluginVersion,
            listening: this.isRunning(),
            address: this.getAddressLabel()
          }
        });
        return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/vault/info") {
        this.respondJson(res, 200, {
          ok: true,
          result: this.getVaultInfo()
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/list") {
        const target = this.getOptionalFolderPath(body.path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.listPath(target)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/read") {
        const path = this.getRequiredPath(body.path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.readFile(path)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/write") {
        const path = this.getRequiredPath(body.path);
        const content = this.getRequiredContent(body.content);
        const overwrite = Boolean(body.overwrite);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.writeFile(path, content, overwrite)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/append") {
        const path = this.getRequiredPath(body.path);
        const content = this.getRequiredContent(body.content);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.appendFile(path, content)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/move") {
        const fromPath = this.getRequiredPath(body.fromPath);
        const toPath = this.getRequiredPath(body.toPath);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.movePath(fromPath, toPath)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/create-folder") {
        const path = this.getRequiredPath(body.path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.createFolder(path)
        });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/vault/delete") {
        const path = this.getRequiredPath(body.path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.deletePath(path)
        });
        return;
      }
      this.respondJson(res, 404, { ok: false, error: "Route not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.respondJson(res, 400, { ok: false, error: message });
    }
  }
  setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Obsidian-Token");
  }
  respondJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
  }
  async parseJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      const size = chunks.reduce((total, current) => total + current.length, 0);
      if (size > 2e6) {
        throw new Error("Request body too large.");
      }
    }
    if (chunks.length === 0) {
      return {};
    }
    const rawBody = Buffer.concat(chunks).toString("utf8").trim();
    if (!rawBody) {
      return {};
    }
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object.");
    }
    return parsed;
  }
  isAuthorized(req) {
    const token = this.getSettings().authToken.trim();
    if (!token) {
      return false;
    }
    let supplied = "";
    const authorization = req.headers.authorization;
    if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
      supplied = authorization.slice("bearer ".length).trim();
    } else {
      const headerToken = req.headers["x-obsidian-token"];
      if (typeof headerToken === "string") {
        supplied = headerToken.trim();
      } else if (Array.isArray(headerToken)) {
        supplied = headerToken[0]?.trim() ?? "";
      }
    }
    return this.secureEqual(supplied, token);
  }
  secureEqual(left, right) {
    const { timingSafeEqual } = require("node:crypto");
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }
  getVaultInfo() {
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof import_obsidian.FileSystemAdapter ? adapter.getBasePath() : null;
    return {
      name: this.app.vault.getName(),
      path: vaultPath,
      configDir: this.app.vault.configDir
    };
  }
  getOptionalFolderPath(value) {
    if (value === void 0 || value === null || value === "" || value === "/" || value === ".") {
      return "";
    }
    return this.normalizeUserPath(value);
  }
  getRequiredPath(value) {
    const normalized = this.normalizeUserPath(value);
    if (!normalized) {
      throw new Error("A non-root path is required.");
    }
    return normalized;
  }
  getRequiredContent(value) {
    if (typeof value !== "string") {
      throw new Error("Content must be a string.");
    }
    return value;
  }
  normalizeUserPath(value) {
    if (typeof value !== "string") {
      throw new Error("Path must be a string.");
    }
    const trimmed = value.trim().replace(/\\/g, "/");
    if (!trimmed) {
      return "";
    }
    const normalized = (0, import_obsidian.normalizePath)(trimmed).replace(/^\/+/, "");
    if (normalized === "." || normalized === "/") {
      return "";
    }
    return normalized;
  }
  async listPath(path) {
    const target = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!target) {
      throw new Error(`Path not found: ${path}`);
    }
    if (target instanceof import_obsidian.TFolder) {
      return {
        path,
        type: "folder",
        children: target.children.map((child) => this.serializeEntry(child))
      };
    }
    return {
      path,
      type: "file",
      file: this.serializeEntry(target)
    };
  }
  async readFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian.TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    const content = await this.app.vault.read(file);
    return {
      path,
      content,
      stat: {
        size: file.stat.size,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime
      }
    };
  }
  async writeFile(path, content, overwrite) {
    await this.ensureParentFolder(path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFolder) {
      throw new Error(`A folder already exists at ${path}`);
    }
    if (existing instanceof import_obsidian.TFile) {
      if (!overwrite) {
        throw new Error(`File already exists: ${path}`);
      }
      await this.app.vault.process(existing, () => content);
      return { path, created: false, updated: true };
    }
    await this.app.vault.create(path, content);
    return { path, created: true, updated: false };
  }
  async appendFile(path, content) {
    await this.ensureParentFolder(path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFolder) {
      throw new Error(`A folder already exists at ${path}`);
    }
    if (existing instanceof import_obsidian.TFile) {
      await this.app.vault.process(existing, (current) => current + content);
      return { path, created: false, appended: true };
    }
    await this.app.vault.create(path, content);
    return { path, created: true, appended: false };
  }
  async movePath(fromPath, toPath) {
    const target = this.app.vault.getAbstractFileByPath(fromPath);
    if (!target) {
      throw new Error(`Path not found: ${fromPath}`);
    }
    if (this.app.vault.getAbstractFileByPath(toPath)) {
      throw new Error(`Destination already exists: ${toPath}`);
    }
    await this.ensureParentFolder(toPath);
    await this.app.fileManager.renameFile(target, toPath);
    return { fromPath, toPath };
  }
  async createFolder(path) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFolder) {
      return { path, created: false };
    }
    if (existing instanceof import_obsidian.TFile) {
      throw new Error(`A file already exists at ${path}`);
    }
    await this.ensureFolderExists(path);
    return { path, created: true };
  }
  async deletePath(path) {
    if (!this.getSettings().allowDelete) {
      throw new Error("Delete operations are disabled in settings.");
    }
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!target) {
      throw new Error(`Path not found: ${path}`);
    }
    await this.app.fileManager.trashFile(target);
    return { path, deleted: true };
  }
  async ensureParentFolder(path) {
    const lastSlashIndex = path.lastIndexOf("/");
    if (lastSlashIndex <= 0) {
      return;
    }
    const parentPath = path.slice(0, lastSlashIndex);
    await this.ensureFolderExists(parentPath);
  }
  async ensureFolderExists(path) {
    const normalized = this.normalizeUserPath(path);
    if (!normalized) {
      return;
    }
    const segments = normalized.split("/").filter(Boolean);
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (existing instanceof import_obsidian.TFolder) {
        continue;
      }
      if (existing instanceof import_obsidian.TFile) {
        throw new Error(`Cannot create folder because a file exists at ${currentPath}`);
      }
      await this.app.vault.createFolder(currentPath);
    }
  }
  serializeEntry(entry) {
    if (entry instanceof import_obsidian.TFile) {
      return {
        path: entry.path,
        name: entry.name,
        parentPath: entry.parent?.path ?? null,
        type: "file",
        extension: entry.extension,
        size: entry.stat.size,
        ctime: entry.stat.ctime,
        mtime: entry.stat.mtime
      };
    }
    if (entry instanceof import_obsidian.TFolder) {
      return {
        path: entry.path,
        name: entry.name,
        parentPath: entry.parent?.path ?? null,
        type: "folder",
        childCount: entry.children.length
      };
    }
    throw new Error(`Unsupported vault entry type: ${entry.path}`);
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  enabled: false,
  host: "127.0.0.1",
  port: 27124,
  authToken: "",
  allowDelete: false
};

// src/main.ts
var ChatGPTBridgePlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.server = null;
  }
  async onload() {
    await this.loadSettings();
    await this.ensureAuthToken();
    this.server = new BridgeHttpServer(this.app, () => this.settings, this.manifest.version);
    this.addSettingTab(new ChatGPTBridgeSettingTab(this));
    this.addCommand({
      id: "restart-local-bridge",
      name: "Restart local bridge",
      callback: async () => {
        await this.restartServer();
      }
    });
    this.addCommand({
      id: "show-local-bridge-status",
      name: "Show local bridge status",
      callback: () => {
        const tokenPreview = this.settings.authToken.slice(0, 8);
        const status = this.server?.isRunning() ? "running" : "stopped";
        new import_obsidian2.Notice(
          `Bridge ${status} at ${this.settings.host}:${this.settings.port} | token ${tokenPreview}...`
        );
      }
    });
    this.addCommand({
      id: "regenerate-auth-token",
      name: "Regenerate auth token",
      callback: async () => {
        await this.regenerateToken();
      }
    });
    if (!import_obsidian2.Platform.isDesktopApp) {
      new import_obsidian2.Notice("ChatGPT Bridge is desktop-only.");
      return;
    }
    if (this.settings.enabled) {
      await this.startServer(false);
    }
  }
  async onunload() {
    await this.server?.stop();
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded ?? {}
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async setEnabled(enabled) {
    this.settings.enabled = enabled;
    await this.saveSettings();
    if (enabled) {
      await this.startServer();
    } else {
      await this.stopServer();
    }
  }
  async restartServer(showNotice = true) {
    if (!this.settings.enabled) {
      new import_obsidian2.Notice("Enable the bridge first.");
      return;
    }
    await this.startServer(showNotice);
  }
  async regenerateToken() {
    this.settings.authToken = createAuthToken();
    await this.saveSettings();
    new import_obsidian2.Notice("Auth token regenerated.");
  }
  async ensureAuthToken() {
    if (this.settings.authToken.trim()) {
      return;
    }
    this.settings.authToken = createAuthToken();
    await this.saveSettings();
  }
  async startServer(showNotice = true) {
    if (!this.server) {
      return;
    }
    try {
      await this.server.start();
      if (showNotice) {
        new import_obsidian2.Notice(`Bridge listening on ${this.settings.host}:${this.settings.port}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new import_obsidian2.Notice(`Failed to start bridge: ${message}`);
    }
  }
  async stopServer(showNotice = true) {
    if (!this.server) {
      return;
    }
    try {
      await this.server.stop();
      if (showNotice) {
        new import_obsidian2.Notice("Bridge stopped.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new import_obsidian2.Notice(`Failed to stop bridge: ${message}`);
    }
  }
};
var ChatGPTBridgeSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("Enable local bridge").setDesc("Start an authenticated localhost API for this vault.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
        await this.plugin.setEnabled(value);
        this.display();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Host").setDesc("Hostname to bind. Restart the bridge after changing this value.").addText(
      (text) => text.setPlaceholder("127.0.0.1").setValue(this.plugin.settings.host).onChange(async (value) => {
        this.plugin.settings.host = value.trim() || DEFAULT_SETTINGS.host;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Port").setDesc("TCP port to bind. Restart the bridge after changing this value.").addText(
      (text) => text.setPlaceholder("27124").setValue(String(this.plugin.settings.port)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_SETTINGS.port;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auth token").setDesc("Bearer token required by every request.").addText(
      (text) => text.setValue(this.plugin.settings.authToken).onChange(async (value) => {
        this.plugin.settings.authToken = value.trim();
        await this.plugin.saveSettings();
      })
    ).addButton(
      (button) => button.setButtonText("Regenerate").onClick(async () => {
        await this.plugin.regenerateToken();
        this.display();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Allow delete operations").setDesc("Required before the API can trash files or folders.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.allowDelete).onChange(async (value) => {
        this.plugin.settings.allowDelete = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Server status").setDesc(
      this.plugin.settings.enabled ? `Configured for ${this.plugin.settings.host}:${this.plugin.settings.port}` : "Disabled"
    ).addButton(
      (button) => button.setButtonText("Restart bridge").onClick(async () => {
        await this.plugin.restartServer();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Routes").setDesc(
      "GET /health, GET /vault/info, POST /vault/list, /vault/read, /vault/write, /vault/append, /vault/move, /vault/create-folder, /vault/delete"
    );
  }
};
function createAuthToken() {
  const { randomBytes } = require("node:crypto");
  return randomBytes(24).toString("hex");
}
