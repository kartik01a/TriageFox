import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("logger redaction", () => {
  it("never writes secrets, tokens or message content", () => {
    const { lines, stream } = capture();
    const log = createLogger("test", stream);
    log.info(
      {
        token: "tok_abc",
        user: { password: "hunter2", email: "a@b.co" },
        headers: { authorization: "Bearer xyz", cookie: "s=1" },
        msg: { content: "my secret chat message" },
      },
      "hello",
    );
    const out = lines.join("");
    for (const bad of ["tok_abc", "hunter2", "Bearer xyz", "s=1", "my secret chat message"]) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain("[redacted]");
    expect(out).toContain("a@b.co");
  });
});
