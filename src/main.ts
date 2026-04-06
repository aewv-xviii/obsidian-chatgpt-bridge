import {
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";
import { BridgeHttpServer } from "./httpServer";
import { ChatGPTBridgeSettings, DEFAULT_SETTINGS } from "./types";

export default class ChatGPTBridgePlugin extends Plugin {
  settings: ChatGPTBridgeSettings = { ...DEFAULT_SETTINGS };
  private server: BridgeHttpServer | null = null;

  async onload(): Promise<void> {
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
        new Notice(
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

    if (!Platform.isDesktopApp) {
      new Notice("ChatGPT Bridge is desktop-only.");
      return;
    }

    if (this.settings.enabled) {
      await this.startServer(false);
    }
  }

  async onunload(): Promise<void> {
    await this.server?.stop();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {})
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.settings.enabled = enabled;
    await this.saveSettings();

    if (enabled) {
      await this.startServer();
    } else {
      await this.stopServer();
    }
  }

  async restartServer(showNotice = true): Promise<void> {
    if (!this.settings.enabled) {
      new Notice("Enable the bridge first.");
      return;
    }

    await this.startServer(showNotice);
  }

  async regenerateToken(): Promise<void> {
    this.settings.authToken = createAuthToken();
    await this.saveSettings();
    new Notice("Auth token regenerated.");
  }

  private async ensureAuthToken(): Promise<void> {
    if (this.settings.authToken.trim()) {
      return;
    }

    this.settings.authToken = createAuthToken();
    await this.saveSettings();
  }

  private async startServer(showNotice = true): Promise<void> {
    if (!this.server) {
      return;
    }

    try {
      await this.server.start();
      if (showNotice) {
        new Notice(`Bridge listening on ${this.settings.host}:${this.settings.port}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to start bridge: ${message}`);
    }
  }

  private async stopServer(showNotice = true): Promise<void> {
    if (!this.server) {
      return;
    }

    try {
      await this.server.stop();
      if (showNotice) {
        new Notice("Bridge stopped.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to stop bridge: ${message}`);
    }
  }
}

class ChatGPTBridgeSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ChatGPTBridgePlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable local bridge")
      .setDesc("Start an authenticated localhost API for this vault.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          await this.plugin.setEnabled(value);
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Host")
      .setDesc("Hostname to bind. Restart the bridge after changing this value.")
      .addText((text) =>
        text.setPlaceholder("127.0.0.1").setValue(this.plugin.settings.host).onChange(async (value) => {
          this.plugin.settings.host = value.trim() || DEFAULT_SETTINGS.host;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc("TCP port to bind. Restart the bridge after changing this value.")
      .addText((text) =>
        text.setPlaceholder("27124")
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.port =
              Number.isInteger(parsed) && parsed > 0 && parsed < 65536
                ? parsed
                : DEFAULT_SETTINGS.port;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auth token")
      .setDesc("Bearer token required by every request.")
      .addText((text) =>
        text.setValue(this.plugin.settings.authToken).onChange(async (value) => {
          this.plugin.settings.authToken = value.trim();
          await this.plugin.saveSettings();
        })
      )
      .addButton((button) =>
        button.setButtonText("Regenerate").onClick(async () => {
          await this.plugin.regenerateToken();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Allow delete operations")
      .setDesc("Required before the API can trash files or folders.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.allowDelete).onChange(async (value) => {
          this.plugin.settings.allowDelete = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Server status")
      .setDesc(
        this.plugin.settings.enabled
          ? `Configured for ${this.plugin.settings.host}:${this.plugin.settings.port}`
          : "Disabled"
      )
      .addButton((button) =>
        button.setButtonText("Restart bridge").onClick(async () => {
          await this.plugin.restartServer();
        })
      );

    new Setting(containerEl).setName("Routes").setDesc(
      "GET /health, GET /vault/info, POST /vault/list, /vault/read, /vault/write, /vault/append, /vault/move, /vault/create-folder, /vault/delete"
    );
  }
}

function createAuthToken(): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(24).toString("hex");
}
