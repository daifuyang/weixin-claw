import { EventEmitter } from "node:events";

import {
  WeixinClient,
  setContextToken,
  SessionExpiredError,
} from "../client/index.js";
import type { WeixinMessage } from "../client/types.js";
import { MessageItemType, MessageType } from "../client/types.js";

const ITEM_TYPE_NAMES: Record<number, string> = {
  1: "文本",
  2: "图片",
  3: "语音",
  4: "文件",
  5: "视频",
};

export function formatMessage(msg: WeixinMessage): string {
  const from = msg.from_user_id ?? "unknown";
  const parts: string[] = [];

  for (const item of msg.item_list ?? []) {
    const typeName = ITEM_TYPE_NAMES[item.type ?? 0] ?? `type=${item.type}`;
    switch (item.type) {
      case MessageItemType.TEXT:
        parts.push(item.text_item?.text ?? "");
        if (item.ref_msg) {
          const refTitle = item.ref_msg.title ?? "";
          const refText = item.ref_msg.message_item?.text_item?.text ?? "";
          if (refTitle || refText) {
            parts[parts.length - 1] = `[引用: ${refTitle || refText}]\n${parts[parts.length - 1]}`;
          }
        }
        break;
      case MessageItemType.IMAGE:
        parts.push(`[${typeName}]`);
        break;
      case MessageItemType.VOICE:
        if (item.voice_item?.text) {
          parts.push(`[${typeName}转文字] ${item.voice_item.text}`);
        } else {
          const dur = item.voice_item?.playtime
            ? `${Math.round(item.voice_item.playtime / 1000)}s`
            : "?s";
          parts.push(`[${typeName} ${dur}]`);
        }
        break;
      case MessageItemType.FILE:
        parts.push(`[${typeName}: ${item.file_item?.file_name ?? "unknown"}]`);
        break;
      case MessageItemType.VIDEO:
        parts.push(`[${typeName}]`);
        break;
      default:
        parts.push(`[${typeName}]`);
    }
  }

  return `\x1b[32m${from}\x1b[0m: ${parts.join(" ") || "(空消息)"}`;
}

export function extractText(msg: WeixinMessage): string {
  const parts: string[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(item.voice_item.text);
    }
  }
  return parts.join("\n");
}

export interface WeixinPollerEvents {
  message: [msg: WeixinMessage];
  error: [err: Error];
  expired: [];
}

export class WeixinPoller extends EventEmitter<WeixinPollerEvents> {
  private client: WeixinClient;
  private ac: AbortController | null = null;
  public lastFrom = "";

  constructor(client: WeixinClient) {
    super();
    this.client = client;
  }

  async start(): Promise<void> {
    this.ac = new AbortController();

    try {
      await this.client.poll((msg) => {
        if (msg.from_user_id) {
          this.lastFrom = msg.from_user_id;
        }
        this.emit("message", msg);
      }, this.ac.signal);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.emit("expired");
      } else {
        this.emit("error", err as Error);
      }
    }
  }

  stop(): void {
    this.ac?.abort();
    this.ac = null;
  }
}
