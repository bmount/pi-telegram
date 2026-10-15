// Loads telegram.json at construction, persists on update.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { TranscriptionConfig } from "./transcription.ts";

interface TelegramConfig {
	transcription?: TranscriptionConfig;
	apiRoot?: string;
	botToken?: string;
	allowedUserId?: number;
	lastUpdateId?: number;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "telegram.json");

async function readConfig(): Promise<TelegramConfig> {
	try {
		const content = await readFile(CONFIG_PATH, "utf8");
		return JSON.parse(content) as TelegramConfig;
	} catch {
		return {};
	}
}

async function writeConfig(config: TelegramConfig): Promise<void> {
	await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
}

function validateConfig(config: TelegramConfig): void {
	if (!config.botToken) {
		throw new Error(
			`Telegram bridge: ${CONFIG_PATH} missing "botToken". ` +
				`Create the file with {"botToken": "<bot-token-from-BotFather>"} and restart. ` +
				`Optionally set "allowedUserId" too — if omitted, pi will show the sender's user id as a warning when the bot first receives a DM.`,
		);
	}
}

type ConfigManager = {
	get(): TelegramConfig;
	update(patch: Partial<TelegramConfig>): Promise<void>;
};

export async function createConfig(): Promise<ConfigManager> {
	let config = await readConfig();
	// A separate optional file allows enabling voice while an older bridge is
	// still polling/writing telegram.json. Explicit inline config takes precedence.
	if (config.transcription === undefined) {
		try {
			config.transcription = JSON.parse(
				await readFile(join(homedir(), ".pi", "agent", "telegram-transcription.json"), "utf8"),
			) as TranscriptionConfig;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	validateConfig(config);
	return {
		get: () => config,
		update: async (patch) => {
			config = { ...config, ...patch };
			await writeConfig(config);
		},
	};
}
