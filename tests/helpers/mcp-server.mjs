/** Isolated MCP protocol fixture. No external effects, secrets or application imports. */
import { createInterface } from "node:readline";
const schema = {
  type: "object",
  properties: { title: { type: "string", minLength: 1 } },
  required: ["title"],
  additionalProperties: false,
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const r = JSON.parse(line);
  if (r.id === undefined) return;
  let result;
  if (r.method === "initialize")
    result = {
      protocolVersion: r.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "isolated-fixture", version: "1" },
    };
  else if (r.method === "tools/list")
    result = {
      tools: [
        {
          name: "add_note",
          description: "Capture a written reminder",
          inputSchema: schema,
        },
      ],
    };
  else if (r.method === "tools/call")
    result = {
      content: [{ type: "text", text: "Recorded " + r.params.arguments.title }],
      structuredContent: {
        id: "protocol-fixture",
        ambient_secret: !!process.env.ARY_TEST_AMBIENT_SECRET,
      },
    };
  else if (r.method === "ping") result = {};
  else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: r.id,
        error: { code: -32601, message: "Unknown method" },
      }) + "\n",
    );
    return;
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: r.id, result }) + "\n",
  );
});
