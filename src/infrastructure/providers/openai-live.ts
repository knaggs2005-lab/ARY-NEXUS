import WebSocket from "ws";
import { z } from "zod";
import {
  ARY_LIVE_INSTRUCTIONS,
  type LiveControl,
  type LiveEvent,
  type LiveProvider,
} from "../../domain/live-voice";

export class OpenAILiveProvider implements LiveProvider {
  readonly model = "gpt-live-1";
  constructor(
    private key: string,
    private request: typeof fetch = fetch,
  ) {}
  async create(sdp: string, signal: AbortSignal) {
    if (!this.key) throw new Error("LIVE_NOT_CONFIGURED");
    const response = await this.request(
      "https://api.openai.com/v1/live/sessions",
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            model: this.model,
            instructions: ARY_LIVE_INSTRUCTIONS,
            delegation: { type: "client" },
            store: false,
          },
          transport: { type: "webrtc", sdp },
        }),
      },
    );
    // Never include provider response bodies, SDP, headers or credentials in errors.
    if (!response.ok) throw new Error(`LIVE_HTTP_${response.status}`);
    const result = z
      .object({
        session: z.object({ id: z.string().min(1).max(200) }),
        transport: z.object({
          type: z.literal("webrtc"),
          sdp: z.string().min(1).max(65536),
        }),
      })
      .parse(await response.json());
    return { id: result.session.id, sdp: result.transport.sdp };
  }
  attach(
    id: string,
    onEvent: (event: LiveEvent) => void,
    onFailure: () => void,
  ): Promise<LiveControl> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,
        {
          headers: { Authorization: `Bearer ${this.key}` },
          maxPayload: 262144,
          handshakeTimeout: 10000,
        },
      );
      let closing = false,
        settled = false;
      const fail = () => {
        if (closing) return;
        closing = true;
        ws.terminate();
        if (!settled) reject(new Error("LIVE_SIDEBAND_FAILED"));
        else onFailure();
      };
      ws.on("error", fail);
      ws.on("close", () => {
        if (!closing) fail();
      });
      ws.on("open", () => {
        settled = true;
        resolve({
          send(event) {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify(event));
            else throw new Error("LIVE_CLOSED");
          },
          close() {
            if (closing) return;
            closing = true;
            ws.close();
          },
        });
      });
      ws.on("message", (raw) => {
        try {
          const event = JSON.parse(raw.toString());
          if (typeof event.type !== "string") return;
          // Reflected PCM is intentionally discarded, never retained/logged.
          if (
            event.type === "session.input_audio.append" ||
            event.type === "session.output_audio.delta"
          )
            return;
          onEvent(event);
        } catch {
          fail();
        }
      });
    });
  }
}
