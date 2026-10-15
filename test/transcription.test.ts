import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { createApi } from "../src/api.ts";
import { createMedia } from "../src/media.ts";
import type { createPreview } from "../src/preview.ts";
import type { createTranscription } from "../src/transcription.ts";
import { contextForExtraction, recentConversation, vocabularyPrompt } from "../src/transcription.ts";
import { createTurn } from "../src/turn.ts";

function branch(messages: unknown[]) {
	return messages.map((message) => ({ type: "message", message })) as unknown as Parameters<
		typeof recentConversation
	>[0];
}

test("recent context uses only the last 20 visible user/assistant messages", () => {
	const messages = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `message ${i}` }));
	const entries = branch([
		...messages,
		{ role: "toolResult", content: [{ type: "text", text: "secret tool output" }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }] },
	]);
	const recent = recentConversation(entries);
	assert.equal(recent.length, 20);
	assert.equal(recent[0]?.text, "message 5");
	assert.equal(recent.at(-1)?.text, "message 24");
	assert.ok(!contextForExtraction(recent).includes("secret tool output"));
	assert.ok(!contextForExtraction(recent).includes("private reasoning"));
});

test("spelling evidence and later mistaken recognition both remain in extraction context", () => {
	const recent = recentConversation(
		branch([
			{ role: "user", content: "G-R-I-M-I-C and J-E-L-Q-O-N-I-V-I-T-C-H" },
			{ role: "assistant", content: [{ type: "text", text: "ASR mistakenly said Grimich and Jill Connovich" }] },
		]),
	);
	const input = contextForExtraction(recent);
	assert.match(input, /G-R-I-M-I-C/);
	assert.match(input, /J-E-L-Q-O-N-I-V-I-T-C-H/);
	assert.match(input, /ASR mistakenly/);
});

test("no names leak into a new or unrelated branch", () => {
	assert.deepEqual(recentConversation([]), []);
	const context = contextForExtraction(
		recentConversation(branch([{ role: "user", content: "Discuss roof drainage" }])),
	);
	assert.ok(!context.includes("GRIMIC"));
});

test("Whisper hint list is unique and bounded and never guesses spellings", () => {
	assert.equal(vocabularyPrompt(["GRIMIC", "JELQONIVITCH", "GRIMIC", 17]), "GRIMIC, JELQONIVITCH");
	assert.ok(vocabularyPrompt(Array.from({ length: 60 }, (_, i) => `term-${i}-${"x".repeat(70)}`)).length <= 800);
	assert.throws(() => vocabularyPrompt({ terms: [] }));
});

test("context gives each recent message a bounded share of extractor input", () => {
	const input = contextForExtraction([
		{ role: "user", text: "a".repeat(10_000) },
		{ role: "assistant", text: "spelling correction" },
	]);
	assert.ok(input.length < 2100);
	assert.match(input, /spelling correction/);
});

test("voice transcription is echoed verbatim with plain Telegram text before agent delivery", async () => {
	const events: string[] = [];
	const api = {
		download: async () => "/tmp/voice.ogg",
		call: async (method: string, body: Record<string, unknown>) => {
			assert.equal(method, "sendMessage");
			events.push(String(body.text));
		},
	} as unknown as ReturnType<typeof createApi>;
	const transcription = {
		enabled: () => true,
		transcribe: async () => "Mr. GRIMIC and Mr. JELQONIVITCH. **raw**",
	} as unknown as ReturnType<typeof createTranscription>;
	const media = createMedia(api, transcription);
	const content = await media.buildPromptContent(
		[{ message_id: 1, chat: { id: 42, type: "private" }, voice: { file_id: "voice", mime_type: "audio/ogg" } }],
		{} as ExtensionContext,
		new AbortController().signal,
	);
	assert.deepEqual(events, ["Raw voice transcription:\n\nMr. GRIMIC and Mr. JELQONIVITCH. **raw**"]);
	assert.ok(content[0]?.type === "text" && content[0].text.includes("Mr. GRIMIC and Mr. JELQONIVITCH. **raw**"));
});

test("disabled transcription retains the original attachment-only behaviour", async () => {
	const api = { download: async () => "/tmp/voice.ogg" } as unknown as ReturnType<typeof createApi>;
	const media = createMedia(api);
	const content = await media.buildPromptContent([
		{ message_id: 1, chat: { id: 42, type: "private" }, voice: { file_id: "voice" } },
	]);
	assert.deepEqual(content, [{ type: "text", text: "Attachments saved locally:\n- /tmp/voice.ogg" }]);
});

test("cancelled transcription cannot echo or dispatch a transcript", async () => {
	let echoed = false;
	const api = {
		download: async () => "/tmp/voice.ogg",
		call: async () => {
			echoed = true;
		},
	} as unknown as ReturnType<typeof createApi>;
	const transcription = { enabled: () => true, transcribe: async () => "should not run" } as unknown as ReturnType<
		typeof createTranscription
	>;
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		createMedia(api, transcription).buildPromptContent(
			[{ message_id: 1, chat: { id: 42, type: "private" }, voice: { file_id: "voice" } }],
			{} as ExtensionContext,
			controller.signal,
		),
	);
	assert.equal(echoed, false);
});

test("/stop can cancel input preparation without waiting for Whisper or dispatching stale text", async () => {
	let delivered = 0;
	let notices = 0;
	let markStarted = () => {};
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	const pi = {
		registerTool: () => {},
		on: () => () => {},
		sendUserMessage: () => {
			delivered++;
		},
	} as unknown as ExtensionAPI;
	const api = {
		sendText: async () => {
			notices++;
		},
	} as unknown as ReturnType<typeof createApi>;
	const media = {
		buildPromptContent: async (_messages: unknown, _ctx: unknown, signal: AbortSignal) => {
			markStarted();
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true });
			});
		},
	} as unknown as ReturnType<typeof createMedia>;
	const turn = createTurn({ pi, api, media, preview: {} as ReturnType<typeof createPreview> });
	await turn.handleIncoming(
		[{ message_id: 1, chat: { id: 42, type: "private" }, voice: { file_id: "voice" } }],
		{} as ExtensionContext,
	);
	await started;
	assert.equal(turn.isPreparing(), true);
	assert.equal(turn.abort(), true);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(turn.isPreparing(), false);
	assert.equal(delivered, 0);
	assert.equal(notices, 0);
});
