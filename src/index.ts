// Pi reloads the extension on session swaps, so these managers are session-scoped.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createApi } from "./api.ts";
import { createConfig } from "./config.ts";
import { createDispatcher } from "./dispatch.ts";
import { createMedia } from "./media.ts";
import { createPolling } from "./polling.ts";
import { createPreview } from "./preview.ts";
import { createTranscription } from "./transcription.ts";
import { createTurn } from "./turn.ts";

export default async function (pi: ExtensionAPI) {
	const config = await createConfig();
	const api = createApi(config);
	const preview = createPreview(api);
	const transcription = createTranscription(pi, () => config.get().transcription);
	const media = createMedia(api, transcription);
	const turn = createTurn({ pi, api, media, preview });
	const dispatch = createDispatcher({ pi, api, turn, transcription });
	createPolling({ pi, api, config, dispatch });
}
