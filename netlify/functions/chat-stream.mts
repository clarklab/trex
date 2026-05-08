import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_SYSTEM_PROMPT } from "../lib/chat-system-prompt.js";

const MAX_HISTORY_MESSAGES = 12;
const MAX_USER_CHARS = 1500;

interface IncomingMessage {
  role?: string;
  content?: string;
}

function sanitizeMessages(raw: IncomingMessage[]): {
  role: "user" | "assistant";
  content: string;
}[] {
  return raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_USER_CHARS),
    }))
    .slice(-MAX_HISTORY_MESSAGES);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { messages?: IncomingMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = sanitizeMessages(body.messages ?? []);
  if (messages.length === 0) {
    return new Response("No valid messages", { status: 400 });
  }
  if (messages[messages.length - 1].role !== "user") {
    return new Response("Last message must be user", { status: 400 });
  }

  const anthropic = new Anthropic({ timeout: 60_000 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        const aiStream = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: CHAT_SYSTEM_PROMPT,
          messages,
          stream: true,
        });

        for await (const event of aiStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send({ type: "delta", text: event.delta.text });
          } else if (event.type === "message_stop") {
            send({ type: "done" });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("chat-stream failed:", msg);
        send({ type: "error", message: "Sorry, I lost my train of thought. Try again?" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
};

export const config: Config = {
  path: "/api/chat-stream",
};
