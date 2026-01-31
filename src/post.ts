import type { MentionTarget } from "./mention.js";

type PostElement = {
  tag: "text" | "a" | "at" | "img" | "md";
  text?: string;
  href?: string;
  user_id?: string;
  user_name?: string;
  image_key?: string;
};

type PostLocalePayload = {
  title?: string;
  content?: PostElement[][];
};

type PostPayload = {
  zh_cn?: PostLocalePayload;
  en_us?: PostLocalePayload;
  post?: {
    zh_cn?: PostLocalePayload;
    en_us?: PostLocalePayload;
  };
  title?: string;
  content?: PostElement[][];
};

function resolvePostPayload(parsed: PostPayload): PostLocalePayload {
  return (
    parsed.zh_cn ||
    parsed.en_us ||
    parsed.post?.zh_cn ||
    parsed.post?.en_us ||
    {
      title: parsed.title,
      content: parsed.content,
    }
  );
}

function buildPostElements(messageText: string, mentions?: MentionTarget[]): PostElement[][] {
  const elements: PostElement[] = [];

  if (mentions && mentions.length > 0) {
    for (const mention of mentions) {
      elements.push({
        tag: "at",
        user_id: mention.openId,
        user_name: mention.name,
      });
      elements.push({ tag: "text", text: " " });
    }
  }

  elements.push({
    tag: "md",
    text: messageText,
  });

  return [elements];
}

export function buildFeishuPostMessagePayload(params: {
  messageText: string;
  mentions?: MentionTarget[];
}): {
  content: string;
  msgType: "post";
} {
  const { messageText, mentions } = params;
  const contentBlocks = buildPostElements(messageText, mentions);

  const payload = {
    zh_cn: { content: contentBlocks },
    en_us: { content: contentBlocks },
  };

  return {
    content: JSON.stringify(payload),
    msgType: "post",
  };
}

/**
 * Parse post (rich text) content and extract embedded image keys.
 * Post structure: { title?: string, content: [[{ tag, text?, image_key?, ... }]] }
 */
export function parsePostContent(content: string): {
  textContent: string;
  imageKeys: string[];
} {
  try {
    const parsed = JSON.parse(content) as PostPayload;
    const resolved = resolvePostPayload(parsed);
    const title = resolved.title || "";
    const contentBlocks = resolved.content || [];
    let textContent = title ? `${title}\n\n` : "";
    const imageKeys: string[] = [];

    for (const paragraph of contentBlocks) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          if (element.tag === "text") {
            textContent += element.text || "";
          } else if (element.tag === "a") {
            // Link: show text or href
            textContent += element.text || element.href || "";
          } else if (element.tag === "at") {
            // Mention: @username
            textContent += `@${element.user_name || element.user_id || ""}`;
          } else if (element.tag === "img" && element.image_key) {
            // Embedded image
            imageKeys.push(element.image_key);
          } else if (element.tag === "md") {
            textContent += element.text || "";
          }
        }
        textContent += "\n";
      }
    }

    return {
      textContent: textContent.trim() || "[富文本消息]",
      imageKeys,
    };
  } catch {
    return { textContent: "[富文本消息]", imageKeys: [] };
  }
}
