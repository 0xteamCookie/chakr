import { EventEmitter } from "node:events";

/** In-process event bus, streamed to the dashboard over Server-Sent Events. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
