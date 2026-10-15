# pi-telegram

[![CI](https://github.com/Qusic/pi-telegram/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/Qusic/pi-telegram/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40qusic%2Fpi-telegram)](https://www.npmjs.com/package/@qusic/pi-telegram)
[![pi](https://img.shields.io/npm/dependency-version/%40qusic%2Fpi-telegram/dev/%40earendil-works%2Fpi-coding-agent?label=pi)](https://github.com/earendil-works/pi)
[![License](https://img.shields.io/npm/l/%40qusic%2Fpi-telegram)](LICENSE)

A Telegram DM bridge for [pi](https://pi.dev) — chat with your pi coding agent from anywhere through a Telegram bot. Based on [badlogic/pi-telegram](https://github.com/badlogic/pi-telegram), rewritten with AI to better fit my personal preferences and needs.

## Features

- **Two-way Telegram ↔ pi bridge** over long-polling `getUpdates`
- **Streamed replies** with live previews, including extended thinking (separated from the answer by 💭 / ✏️ markers); long answers grow incrementally instead of only appearing at the end
- **Markdown rendering** to native Telegram formatting (headings, bold, italics, links, inline & fenced code, blockquotes, lists, tables, task lists, footnotes, LaTeX), robust to partial mid-stream snippets
- **Attachments in**: photos, albums, documents, video, audio, voice, animations and stickers; images are inlined as image inputs, everything else is referenced by local path
- **Attachments out**: a `telegram_attach` tool lets the agent send generated files with its reply
- **Tool call breadcrumbs**: grouped progress that updates as tools run
- **Mid-turn steering**: messages sent while the agent is busy are injected into the running turn
- **Typing indicator** while the agent is working
- **Single-user authorization** by Telegram user id

### Telegram-side commands

Auto-published as the bot menu at boot. Anything else is forwarded to pi as a user turn.

| Command    | Description                                  |
| ---------- | -------------------------------------------- |
| `/new`     | Start a new pi session                       |
| `/resume`  | List recent sessions; `/resumeN` to switch   |
| `/stop`    | Abort the current turn                       |
| `/status`  | Model, token usage, cost and context window  |
| `/compact` | Compact the conversation                     |
| `/skills`  | List skills available to the agent           |

Resuming a session echoes that session's last reply back to the chat, so it reflects where you left off (the TUI already shows the full history).

## Differences vs. upstream `badlogic/pi-telegram`

| Area                  | Upstream                                                                        | This fork                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Setup & lifecycle     | `/telegram-setup` / `/telegram-connect` / `/telegram-disconnect` commands; explicit per-session connect | No pi-side commands; you write `~/.pi/agent/telegram.json` yourself, polling auto-starts per session       |
| Authorization         | First DM user is auto-paired                                                    | First DM sender id is shown as a warning in pi; unauthorized senders receive no response                   |
| Commands & bot menu   | Telegram-side commands limited to `/status`, `/compact`, `stop`, `/help`, `/start`; no menu published | Adds `/new`, `/resume`, `/skills` and publishes the menu via `setMyCommands`; session switching from Telegram |
| Concurrency           | Extra messages while busy are queued and dispatched after the current turn ends | Extra messages are steered into the running turn                                                           |
| Aborted-turn replay   | After `stop`, queued messages are re-injected as a synthetic history block      | No replay — `stop` just aborts                                                                             |
| Prompt prefix         | Each message prefixed with `[telegram]`, plus a system-prompt suffix            | Forwarded as-is                                                                                            |
| Rendering             | Plain text only; URL preview cards enabled                                      | Native Rich Message (`sendRichMessage`, GitHub-Flavored Markdown) for every outgoing message                |
| Streaming             | Probes `sendMessageDraft`, falls back to `sendMessage` + `editMessageText`; previews truncated at 4096 chars, full answer only appears at `agent_end` | `sendRichMessageDraft` live previews committed with `sendRichMessage`; oversized previews are promoted into real messages mid-stream so long answers grow live |
| Tool call breadcrumbs | None                                                                            | Grouped progress that updates as tools run                                                                |
| Thinking blocks       | Stripped                                                                        | Streamed, separated by 💭 / ✏️ markers                                                                     |
| Status bar            | Rich colored status                                                             | Only transient polling errors                                                                              |

Media-group debouncing and the `telegram_attach` tool surface match upstream. Internally the fork is split into small manager closures instead of a single file.

## Install

Only one pi session should poll a given bot token at a time, so load this per-session instead of installing globally:

```bash
pi -e npm:@qusic/pi-telegram
```

To use the Git checkout instead:

```bash
pi -e git:github.com/Qusic/pi-telegram
```

## Configure

1. Talk to [@BotFather](https://t.me/BotFather), run `/newbot`, copy the bot token.
2. Create `~/.pi/agent/telegram.json`:

   ```json
   { "botToken": "123456:ABC-your-token-here" }
   ```

3. Start pi — polling starts automatically.
4. DM your bot once. pi shows a warning with your Telegram user id; add `"allowedUserId": <id>` to the config and restart. The bot stays silent until authorized.

## Hosted-first context-aware voice transcription (fork feature)

`transcription.backend: "auto"` prefers direct Groq when `GROQ_API_KEY` (or `~/.config/pi-telegram/groq.key`) exists; otherwise it uses OpenRouter with `OPENROUTER_API_KEY` (or private `openrouter.key` in that directory), then local Whisper on missing credentials/hosted failure. Key files must be mode 0600 and never shared. Groq uses `whisper-large-v3-turbo`; OpenRouter defaults to `google/gemini-2.5-flash-lite` audio input. OpenRouter does not currently expose Groq audio transcription; the two credentials are not interchangeable. `backend: "local"` opts out of hosted audio, and `groq`/`openrouter` select a particular host with local fallback.

Hosted mode uploads the voice recording and temporary spelling hints to the chosen provider. Hosted hint extraction uses a separate fast model, not the main coding model. With OpenRouter, `vocabularyModel` and `openrouterModel` are independently configurable; Groq uses `llama-3.3-70b-versatile` for hints. Context remains the last 20 visible messages with no permanent dictionary. Raw echo is unchanged. Cancel propagates through HTTP/conversion, no redirects are followed, each hosted request is limited to 25 seconds, and provider error bodies are not shown. `/transcription` includes actual backend and local-fallback status. After changing code/configuration, use `/reload` once in the existing Pi bridge; do not start a second poller.

Validated: live OpenRouter hint extraction ~0.74 s and audio ~2.23 s on one supplied short voice note (not a latency guarantee); simulated hosted outage successfully ran real local Whisper. Hosted protocol/size/text/error tests and existing Telegram regression tests pass.

Enable hosted-first voice transcription in `~/.pi/agent/telegram.json` (provide your own Groq or OpenRouter key as described above):

```json
{
  "botToken": "YOUR_TOKEN",
  "allowedUserId": 123456789,
  "transcription": {
    "enabled": true,
    "backend": "auto",
    "modelPath": "/absolute/path/to/ggml-base.en.bin",
    "language": "en"
  }
}
```

Alternatively, put just the transcription settings in `~/.pi/agent/telegram-transcription.json`. Explicit inline `transcription` settings take precedence. The separate file is useful when enabling the feature while an older bridge is still running and updating `telegram.json`.

Requires `ffmpeg` and `ffprobe` on `PATH`. Local transcription/fallback additionally requires `whisper-cli` (whisper.cpp) on `PATH` and a separately downloaded Whisper model. No binaries or models are downloaded automatically. Transcription is disabled unless explicitly enabled. The default local model path is `~/.local/share/whisper/models/ggml-base.en.bin`.

For local audio processing only, set `"backend": "local"`. This prevents hosted audio uploads, but temporary hint extraction still sends recent conversation text to the selected Pi model. Hosted mode sends that bounded text to the chosen hosted hint model. If no hosted credentials are available in auto mode, recent text supplies local fallback hints without a model request.

For each Telegram **voice note**:

1. Read the last 20 visible user/assistant messages from the active session branch. Tool output and thinking blocks are excluded. Each message is capped at 2,000 characters for the extraction request.
2. Ask the applicable hint model to extract temporary proper-name, acronym and technical-term hints, prioritizing explicit spelling/corrections over earlier ASR mistakes. If extraction fails, the last two visible messages supply bounded fallback context. Selected-Pi-model hint usage is included in `/status`; direct Groq/OpenRouter request usage and charges are not currently included there.
3. Pass the ranked hints to the selected transcription backend, falling back to local Whisper on hosted failure. Hints are capped at 800 characters; all candidate terms are not guaranteed to fit.
4. Echo the raw recognition verbatim to Telegram before forwarding it to the agent. No silent spelling rewrite or post-processing correction is performed.

There is **no permanent vocabulary** and no automatic name collection across sessions. `/transcription` shows the last raw transcript, actual hints and whether fallback was used. `/stop` cancels preprocessing as well as active agent work. Input preparation is serialized without blocking Telegram polling. `/new` and `/resume` require preparation to finish or be stopped. `/reload` reloads extensions through Pi's command context.

Voice notes are limited to 20 MB / 10 minutes, with bounded subprocess time and temporary WAV cleanup. Processing uses argument arrays, not a shell. Ordinary audio/document uploads remain attachment-only. Recognition can still be wrong even with correct context; the raw echo is there for checking. Web search and permanent transcription fixtures are not implemented.

For development, use a local checkout (`pi install /path/to/pi-telegram`) so package updates do not overwrite your edits. The fork remote for this device is `https://github.com/bmount/pi-telegram`.

## Usage

Just chat with your bot. Text becomes the next pi turn; photos/files are downloaded and referenced in the prompt (images also inlined); ask pi for an artifact and it can call `telegram_attach` to send files back; `/stop` aborts.

## License

MIT. See [LICENSE](./LICENSE).
