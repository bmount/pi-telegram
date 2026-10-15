import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hostedAudio, hostedVocabulary, transcriptText } from "../src/remote-transcription.ts";

const provider = { kind: "openrouter" as const, key: "synthetic-private-key" };

test("hosted vocabulary uses independent fast model and bounded temporary context", async () => {
	const previous = globalThis.fetch;
	try {
		globalThis.fetch = async (url, options) => {
			assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
			assert.equal(options?.redirect, "error");
			const body = JSON.parse(String(options?.body));
			assert.equal(body.model, "google/gemini-2.5-flash-lite");
			assert.equal(body.messages[1].content, "Shannon Nook, Pimwell");
			return Response.json({ choices: [{ message: { content: '["Shannon Nook","Pimwell"]' } }] });
		};
		assert.equal(
			await hostedVocabulary(provider, {}, "data only", "Shannon Nook, Pimwell", new AbortController().signal),
			'["Shannon Nook","Pimwell"]',
		);
	} finally {
		globalThis.fetch = previous;
	}
});

test("OpenRouter sends audio plus spelling hints, never asks for a conversational answer", async () => {
	const previous = globalThis.fetch;
	const dir = await mkdtemp(join(tmpdir(), "voice-hosted-test-"));
	try {
		const wav = join(dir, "voice.wav");
		await writeFile(wav, "synthetic-audio-bytes");
		globalThis.fetch = async (_url, options) => {
			const body = JSON.parse(String(options?.body));
			assert.match(body.messages[0].content, /verbatim/);
			assert.match(body.messages[1].content[0].text, /Shannon Nook/);
			assert.equal(body.messages[1].content[1].input_audio.format, "wav");
			return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Shannon Nook." } }] });
		};
		assert.equal(
			await hostedAudio(provider, {}, wav, "Shannon Nook", "en", new AbortController().signal),
			"Shannon Nook.",
		);
	} finally {
		globalThis.fetch = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("Groq uses its own key, Whisper turbo and the same prompt on the audio endpoint", async () => {
	const previous = globalThis.fetch;
	const dir = await mkdtemp(join(tmpdir(), "voice-groq-test-"));
	try {
		const wav = join(dir, "voice.wav");
		await writeFile(wav, "synthetic-audio");
		globalThis.fetch = async (url, options) => {
			assert.equal(String(url), "https://api.groq.com/openai/v1/audio/transcriptions");
			const form = options?.body as FormData;
			assert.equal(form.get("model"), "whisper-large-v3-turbo");
			assert.equal(form.get("prompt"), "Pimwell");
			return Response.json({ text: "Pimwell." });
		};
		assert.equal(
			await hostedAudio(
				{ kind: "groq", key: "synthetic-groq" },
				{},
				wav,
				"Pimwell",
				"en",
				new AbortController().signal,
			),
			"Pimwell.",
		);
	} finally {
		globalThis.fetch = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("remote errors do not expose provider bodies or keys; malformed transcripts reject", async () => {
	const previous = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response("synthetic-private-key secret", { status: 429 });
		await assert.rejects(hostedVocabulary(provider, {}, "data", "context", new AbortController().signal), (error) => {
			assert.doesNotMatch(String(error), /synthetic-private-key|secret/);
			return true;
		});
		for (const value of [undefined, "", " ", {}, "x".repeat(64_001)]) assert.throws(() => transcriptText(value));
	} finally {
		globalThis.fetch = previous;
	}
});
