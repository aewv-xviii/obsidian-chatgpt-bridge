import {
  App,
  FileSystemAdapter,
  normalizePath,
  TAbstractFile,
  TFile,
  TFolder
} from "obsidian";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ChatGPTBridgeSettings } from "./types";

interface SerializedEntry {
  path: string;
  name: string;
  parentPath: string | null;
  type: "file" | "folder";
  extension?: string;
  size?: number;
  ctime?: number;
  mtime?: number;
  childCount?: number;
}

export class BridgeHttpServer {
  private server: Server | null = null;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => ChatGPTBridgeSettings,
    private readonly pluginVersion: string
  ) {}

  isRunning(): boolean {
    return this.server !== null;
  }

  getAddressLabel(): string {
    const settings = this.getSettings();
    return `${settings.host}:${settings.port}`;
  }

  async start(): Promise<void> {
    if (this.server) {
      await this.stop();
    }

    const { createServer } = require("node:http") as typeof import("node:http");
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
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

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = null;

    if (!activeServer) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      activeServer.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
        const target = this.getOptionalFolderPath((body as Record<string, unknown>).path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.listPath(target)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/read") {
        const path = this.getRequiredPath((body as Record<string, unknown>).path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.readFile(path)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/write") {
        const path = this.getRequiredPath((body as Record<string, unknown>).path);
        const content = this.getRequiredContent((body as Record<string, unknown>).content);
        const overwrite = Boolean((body as Record<string, unknown>).overwrite);

        this.respondJson(res, 200, {
          ok: true,
          result: await this.writeFile(path, content, overwrite)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/append") {
        const path = this.getRequiredPath((body as Record<string, unknown>).path);
        const content = this.getRequiredContent((body as Record<string, unknown>).content);

        this.respondJson(res, 200, {
          ok: true,
          result: await this.appendFile(path, content)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/move") {
        const fromPath = this.getRequiredPath((body as Record<string, unknown>).fromPath);
        const toPath = this.getRequiredPath((body as Record<string, unknown>).toPath);

        this.respondJson(res, 200, {
          ok: true,
          result: await this.movePath(fromPath, toPath)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/create-folder") {
        const path = this.getRequiredPath((body as Record<string, unknown>).path);
        this.respondJson(res, 200, {
          ok: true,
          result: await this.createFolder(path)
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/vault/delete") {
        const path = this.getRequiredPath((body as Record<string, unknown>).path);
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

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Obsidian-Token");
  }

  private respondJson(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
  }

  private async parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);

      const size = chunks.reduce((total, current) => total + current.length, 0);
      if (size > 2_000_000) {
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

    return parsed as Record<string, unknown>;
  }

  private isAuthorized(req: IncomingMessage): boolean {
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

  private secureEqual(left: string, right: string): boolean {
    const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private getVaultInfo(): Record<string, unknown> {
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;

    return {
      name: this.app.vault.getName(),
      path: vaultPath,
      configDir: this.app.vault.configDir
    };
  }

  private getOptionalFolderPath(value: unknown): string {
    if (value === undefined || value === null || value === "" || value === "/" || value === ".") {
      return "";
    }

    return this.normalizeUserPath(value);
  }

  private getRequiredPath(value: unknown): string {
    const normalized = this.normalizeUserPath(value);
    if (!normalized) {
      throw new Error("A non-root path is required.");
    }

    return normalized;
  }

  private getRequiredContent(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error("Content must be a string.");
    }

    return value;
  }

  private normalizeUserPath(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error("Path must be a string.");
    }

    const trimmed = value.trim().replace(/\\/g, "/");
    if (!trimmed) {
      return "";
    }

    const normalized = normalizePath(trimmed).replace(/^\/+/, "");
    if (normalized === "." || normalized === "/") {
      return "";
    }

    return normalized;
  }

  private async listPath(path: string): Promise<Record<string, unknown>> {
    const target = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!target) {
      throw new Error(`Path not found: ${path}`);
    }

    if (target instanceof TFolder) {
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

  private async readFile(path: string): Promise<Record<string, unknown>> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
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

  private async writeFile(path: string, content: string, overwrite: boolean): Promise<Record<string, unknown>> {
    await this.ensureParentFolder(path);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      throw new Error(`A folder already exists at ${path}`);
    }

    if (existing instanceof TFile) {
      if (!overwrite) {
        throw new Error(`File already exists: ${path}`);
      }

      await this.app.vault.process(existing, () => content);
      return { path, created: false, updated: true };
    }

    await this.app.vault.create(path, content);
    return { path, created: true, updated: false };
  }

  private async appendFile(path: string, content: string): Promise<Record<string, unknown>> {
    await this.ensureParentFolder(path);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      throw new Error(`A folder already exists at ${path}`);
    }

    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (current) => current + content);
      return { path, created: false, appended: true };
    }

    await this.app.vault.create(path, content);
    return { path, created: true, appended: false };
  }

  private async movePath(fromPath: string, toPath: string): Promise<Record<string, unknown>> {
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

  private async createFolder(path: string): Promise<Record<string, unknown>> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      return { path, created: false };
    }

    if (existing instanceof TFile) {
      throw new Error(`A file already exists at ${path}`);
    }

    await this.ensureFolderExists(path);
    return { path, created: true };
  }

  private async deletePath(path: string): Promise<Record<string, unknown>> {
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

  private async ensureParentFolder(path: string): Promise<void> {
    const lastSlashIndex = path.lastIndexOf("/");
    if (lastSlashIndex <= 0) {
      return;
    }

    const parentPath = path.slice(0, lastSlashIndex);
    await this.ensureFolderExists(parentPath);
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const normalized = this.normalizeUserPath(path);
    if (!normalized) {
      return;
    }

    const segments = normalized.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);

      if (existing instanceof TFolder) {
        continue;
      }

      if (existing instanceof TFile) {
        throw new Error(`Cannot create folder because a file exists at ${currentPath}`);
      }

      await this.app.vault.createFolder(currentPath);
    }
  }

  private serializeEntry(entry: TAbstractFile): SerializedEntry {
    if (entry instanceof TFile) {
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

    if (entry instanceof TFolder) {
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
}
