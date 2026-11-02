import { AiError, type AiProvider, transcribeCostUsd } from "@triagefox/ai";
import {
  CRISP_FILE_HOSTS,
  type CrispConversation,
  type SafeDownloadOptions,
  safeDownload,
} from "@triagefox/connectors";
import type { PipelineLogger } from "./deps";

/** Newest customer voice messages transcribed per analysis; longer or extra ones are left as files. */
const MAX_VOICE_NOTES = 3;
const MAX_VOICE_SECONDS = 5 * 60;
/** OpenAI's upload limit for speech to text. */
const MAX_VOICE_BYTES = 25 * 1024 * 1024;

export interface VoiceResult {
  /** Crisp message fingerprint → transcript. Held in memory for this analysis only, never stored. */
  transcripts: Map<string, string>;
  costUsd: number;
  /** Voice messages that could not be transcribed (too long, download or provider failure). */
  skipped: number;
}

/**
 * Speech to text for the customer's voice messages (ADR 0014), so the AI can read what they said.
 * Best effort: a failure leaves that message as an attachment and never stops the analysis, except a
 * rejected key or missing credit, which the caller handles like any other AI call.
 */
export async function transcribeVoiceNotes(args: {
  conversation: CrispConversation;
  provider: AiProvider;
  model: string;
  log: PipelineLogger;
  download?: Partial<SafeDownloadOptions>;
}): Promise<VoiceResult> {
  const out: VoiceResult = { transcripts: new Map(), costUsd: 0, skipped: 0 };
  const voice = args.conversation.messages.filter(
    (m) => m.role === "customer" && m.kind === "file" && m.file?.mime.startsWith("audio/"),
  );
  if (voice.length === 0 || !args.provider.transcribe) return out;

  const chosen = voice.slice(-MAX_VOICE_NOTES);
  out.skipped += voice.length - chosen.length;
  for (const m of chosen) {
    const file = m.file;
    if (!file || (file.durationSec ?? 0) > MAX_VOICE_SECONDS) {
      out.skipped++;
      continue;
    }
    try {
      const d = await safeDownload(file.url, {
        allowedHosts: CRISP_FILE_HOSTS,
        maxBytes: MAX_VOICE_BYTES,
        ...args.download,
      });
      const audio = await new Response(d.stream, {
        headers: { "content-type": d.contentType },
      }).blob();
      const r = await args.provider.transcribe({ model: args.model, audio, fileName: file.name });
      const text = r.text.trim();
      if (text) out.transcripts.set(m.fingerprint, text);
      out.costUsd += transcribeCostUsd(args.model, r.seconds ?? file.durationSec ?? 0);
    } catch (err) {
      if (err instanceof AiError && (err.kind === "auth" || err.kind === "no_quota")) throw err;
      out.skipped++;
      args.log.warn(
        { kind: err instanceof AiError ? err.kind : "download" },
        "voice message not transcribed",
      );
    }
  }
  return out;
}
