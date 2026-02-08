import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendMarkdownCardFeishu } from "./send.js";
import type { FeishuConfig } from "./types.js";
import type { MentionTarget } from "./mention.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";

/**
 * Detect if text contains markdown elements that benefit from card rendering.
 * Used by auto render mode.
 */
function shouldUseCard(text: string): boolean {
  // Code blocks (fenced)
  if (/```[\s\S]*?```/.test(text)) return true;
  // Tables (at least header + separator row with |)
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

const TOOL_LABEL_TRANSLATIONS: Record<string, string> = {
  exec: "正在执行",
  process: "正在处理进程",
  apply_patch: "正在应用补丁",
  read: "正在读取",
  edit: "正在编辑",
  write: "正在写入",
  image: "正在识别",
  search: "正在搜索",
  fetch: "正在获取",
  web: "正在浏览",
  browser: "正在浏览",
  canvas: "正在绘制",
  nodes: "正在查询节点",
  cron: "正在处理定时任务",
  message: "正在发送消息",
  tts: "正在合成语音",
  gateway: "正在调用网关",
  agents_list: "正在列出代理",
  "agents list": "正在列出代理",
  sessions_list: "正在列出会话",
  "sessions list": "正在列出会话",
  sessions_history: "正在读取会话历史",
  "sessions history": "正在读取会话历史",
  sessions_send: "正在发送会话消息",
  "sessions send": "正在发送会话消息",
  sessions_spawn: "正在创建会话",
  "sessions spawn": "正在创建会话",
  session_status: "正在获取会话状态",
  "session status": "正在获取会话状态",
  web_search: "正在搜索网页",
  "web search": "正在搜索网页",
  web_fetch: "正在抓取网页",
  "web fetch": "正在抓取网页",
  memory_search: "正在检索记忆",
  "memory search": "正在检索记忆",
  memory_get: "正在读取记忆",
  "memory get": "正在读取记忆",
  whatsapp_login: "正在登录 WhatsApp",
  "whatsapp login": "正在登录 WhatsApp",
  whatsapp: "正在操作 WhatsApp",
  discord: "正在操作 Discord",
  slack: "正在操作 Slack",
  telegram: "正在操作 Telegram",
  download: "正在下载",
  upload: "正在上传",
  "feishu doc": "正在操作飞书文档",
  feishu_doc: "正在操作飞书文档",
  "feishu drive": "正在操作飞书云盘",
  feishu_drive: "正在操作飞书云盘",
  "feishu wiki": "正在操作飞书知识库",
  feishu_wiki: "正在操作飞书知识库",
  "feishu perm": "正在处理权限",
  feishu_perm: "正在处理权限",
  "feishu scopes": "正在检查权限范围",
  feishu_scopes: "正在检查权限范围",
  "feishu app scopes": "正在检查权限范围",
  feishu_app_scopes: "正在检查权限范围",
};

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

function localizeToolLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return label;
  const mapped = TOOL_LABEL_TRANSLATIONS[trimmed.toLowerCase()];
  if (mapped) return mapped;
  if (trimmed.startsWith("正在")) return trimmed;
  return `正在使用工具 ${trimmed}`;
}

function localizeToolMessage(text: string): string {
  const lines = text.split("\n");
  if (lines.length === 0) return text;
  const header = lines[0];
  if (!header) return text;

  const emojiMatch = /^(\S+)\s+([^:]+?)(:.*)?$/.exec(header);
  if (emojiMatch && EMOJI_REGEX.test(emojiMatch[1])) {
    const [, emoji, label, rest] = emojiMatch;
    lines[0] = `${emoji} ${localizeToolLabel(label)}${rest ?? ""}`;
    return lines.join("\n");
  }

  const plainMatch = /^([^:]+?)(:.*)?$/.exec(header);
  if (!plainMatch) return text;
  const [, label, rest] = plainMatch;
  const localized = localizeToolLabel(label);
  if (localized === label) return text;
  lines[0] = `${localized}${rest ?? ""}`;
  return lines.join("\n");
}

function containsFeishuDomainLink(text: string): boolean {
  return /https?:\/\/(?:[a-z0-9-]+\.)?(?:feishu\.cn|larksuite\.com|lark\.com)(?:\/|$)/i.test(
    text,
  );
}

function isProcessPollSummary(text: string): boolean {
  const normalized = text.replace(/`/g, "");
  return /process:\s*poll\b/i.test(normalized);
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  /** Mention targets, will be auto-included in replies */
  mentionTargets?: MentionTarget[];
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets } = params;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Feishu doesn't have a native typing indicator API.
  // We use message reactions as a typing indicator substitute.
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) return;
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId });
      params.runtime.log?.(`feishu: added typing indicator reaction`);
    },
    stop: async () => {
      if (!typingState) return;
      await removeTypingIndicator({ cfg, state: typingState });
      typingState = null;
      params.runtime.log?.(`feishu: removed typing indicator reaction`);
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "feishu",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload, info) => {
        params.runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)}`);
        const rawText = payload.text ?? "";
        if (!rawText.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        // Check render mode: post (default), auto, raw, or card
        const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
        const suppressProcessPoll = feishuCfg?.toolMessages?.suppressProcessPoll ?? true;
        if (info?.kind === "tool" && suppressProcessPoll && isProcessPollSummary(rawText)) {
          return;
        }
        const text = info?.kind === "tool" ? localizeToolMessage(rawText) : rawText;
        const renderMode = feishuCfg?.renderMode ?? "post";

        // Determine if we should use card for this message
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));
        const usePost = renderMode === "post" && !containsFeishuDomainLink(text);

        // Only include @mentions in the first chunk (avoid duplicate @s)
        let isFirstChunk = true;

        if (useCard) {
          // Card mode: send as interactive card with markdown rendering
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
          params.runtime.log?.(`feishu deliver: sending ${chunks.length} card chunks to ${chatId}`);
          for (const chunk of chunks) {
            await sendMarkdownCardFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
            });
            isFirstChunk = false;
          }
        } else {
          // Raw or post mode: send as plain text or rich post with table conversion
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
          const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
          params.runtime.log?.(
            `feishu deliver: sending ${chunks.length} ${usePost ? "post" : "text"} chunks to ${chatId}`,
          );
          for (const chunk of chunks) {
            await sendMessageFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
              messageType: usePost ? "post" : "text",
            });
            isFirstChunk = false;
          }
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(`feishu ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
