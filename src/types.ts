export interface ChatGPTBridgeSettings {
  enabled: boolean;
  host: string;
  port: number;
  authToken: string;
  allowDelete: boolean;
}

export const DEFAULT_SETTINGS: ChatGPTBridgeSettings = {
  enabled: false,
  host: "127.0.0.1",
  port: 27124,
  authToken: "",
  allowDelete: false
};

