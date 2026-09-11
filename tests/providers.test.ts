import { afterEach, expect, it, vi } from "vitest";
import {
  CompatibleEmbeddings,
  CompatibleLanguageModel,
} from "../src/infrastructure/providers/compatible";
afterEach(() => vi.unstubAllGlobals());
it("enforces the embedding dimension and nonzero contract", async () => {
  const provider = new CompatibleEmbeddings({
    baseUrl: "https://model.example/v1",
    model: "semantic",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ embedding: [1, 2, 3] }] })),
  );
  await expect(provider.embed("test")).rejects.toThrow();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ embedding: Array(384).fill(0) }] }),
      ),
  );
  await expect(provider.embed("test")).rejects.toThrow("zero vector");
  const vector = [1, ...Array(383).fill(0)];
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json({ data: [{ embedding: vector }] }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await provider.embed("test")).toEqual(vector);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://model.example/v1/embeddings",
  );
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
    "Authorization",
  );
});
it("validates extracted memory payloads rather than accepting model-supplied ownership", async () => {
  const provider = new CompatibleLanguageModel({
    baseUrl: "https://model.example/v1",
    model: "chat",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                memories: [{ content: "A fact", user_id: "forged" }],
              }),
            },
          },
        ],
      }),
    ),
  );
  await expect(provider.extractMemories("A fact")).rejects.toThrow();
});
it("reports provider HTTP failures without exposing upstream response bodies", async () => {
  const provider = new CompatibleEmbeddings({
    baseUrl: "https://model.example/v1",
    model: "semantic",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("private provider details", { status: 503 }),
      ),
  );
  await expect(provider.embed("test")).rejects.toThrow("HTTP 503");
});
